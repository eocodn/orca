import type { IPty } from 'node-pty'
import type * as NodePty from 'node-pty'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveWindowsGitBashShellPath } from '../main/git-bash'
import { WINDOWS_GIT_BASH_SHELL } from '../shared/windows-terminal-shell'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import {
  resolveDefaultShell,
  resolveDefaultCwd,
  resolveProcessCwd,
  processHasChildren,
  getForegroundProcessName,
  isProcessAlive,
  listShellProfiles
} from './pty-shell-utils'
import { getRelayShellLaunchConfig } from './pty-shell-launch'
import { DEFAULT_SSH_RELAY_GRACE_PERIOD_SECONDS } from '../shared/ssh-types'
import { shouldUseShellReadyStartupDelivery } from '../shared/codex-startup-delivery'
import { buildStartupCommandSubmission } from '../shared/startup-command-submission'
import { resolveSetupAgentSequenceLaunchCommand } from '../shared/setup-agent-sequencing'
import {
  isPathInsideOrEqual,
  normalizeRuntimePathForComparison
} from '../shared/cross-platform-path'
import { splitWorktreeId } from '../shared/worktree-id'
import { PhysicalExitTracker } from '../shared/physical-exit-tracker'
import { areValidTerminalDimensions } from '../shared/terminal-dimensions'
import {
  createShellReadyScanState,
  drainShellReadyHeldBytes,
  scanForShellReady,
  type ShellReadyScanState
} from '../main/shell-ready-marker-scanner'
import { applyTerminalGitCredentialPromptGuard } from '../shared/terminal-git-credential-guard'
import {
  gitCredentialPromptGuardEnv,
  mergeGitConfigEnvProtocol
} from '../shared/git-credential-prompt-env'
import { isTuiAgent } from '../shared/tui-agent-config'
import type { TuiAgent } from '../shared/types'
import { forceKillPosixPtyProcessGroups } from '../main/pty/posix-pty-process-groups'
import { stripInheritedBuildModeEnv } from '../main/pty/build-mode-env'
import {
  PTY_STARTUP_INGRESS_VERSION,
  PtyStartupIngress,
  parsePtyStartupIngressIntent,
  type PtyIngressEmission
} from '../shared/pty-startup-ingress'
import { resolvePtyOwnerBackend, type PtyOwnerBackend } from '../shared/pty-owner-backend'
import { RecentPtyOutputBuffer } from '../main/runtime/recent-pty-output-buffer'
import {
  agentSessionOwnerBindingsEqual,
  ClaimedAgentPtyOwnerRegistry
} from '../shared/claimed-agent-pty-owner'
import type { RelayPtySourceOutput } from './relay-pty-source-output'
import type { RelayPtySourcePublication } from './relay-pty-source-publication'
import type {
  PtySourceRecoveryRequest,
  PtySourceRecoveryResult
} from '../shared/pty-source-recovery-contract'
import type { PtySourceReceivingActivation } from '../shared/pty-source-receiving-activation'
import {
  AGENT_SESSION_CREATE_OPERATION_PROTOCOL_VERSION,
  AGENT_SESSION_EXECUTION_OWNER_PROTOCOL_VERSION,
  isAgentSessionExecutionClaim,
  isAgentSessionSurfaceBinding,
  type AgentSessionOwnerBinding
} from '../shared/agent-session-host-authority'

// Why: only Linux compiles node-pty (no prebuilt), so the build-tools remedy is a closable setup gap
// there and wrong advice anywhere node-pty ships one. The relay only sees an unloadable binding, never
// why — a skipped compile and a later Node/ABI flip look identical here — so Linux hedges both causes.
export function formatNodePtyUnavailableMessage(platform: NodeJS.Platform): string {
  const remedy =
    platform === 'linux'
      ? "node-pty's native binding is not loadable on this host. If it is missing the C/C++ build tools needed to compile node-pty, install make, a C++ compiler, and python3 on the remote host, then reconnect. Otherwise reconnect to reinstall the relay's native modules, and check that the remote Node.js version and architecture match the installed binding."
      : "node-pty's native binding failed to load on this host. Reconnect to reinstall the relay's native modules; if it persists, check that the remote Node.js version and architecture match the installed binding."
  return `Remote terminals are unavailable: ${remedy}`
}

function isMissingNodePtyNativeBinding(error: unknown): boolean {
  return (
    error instanceof Error &&
    /Failed to load native module: (?:conpty|pty)\.node(?:,|$)/.test(error.message)
  )
}

function parseSourceRecoveryRequest(value: unknown): PtySourceRecoveryRequest | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const input = value as Record<string, unknown>
  if (input.status === 'checkpointUnavailable') {
    return Object.freeze({ status: 'checkpointUnavailable' })
  }
  if (
    input.status !== 'checkpoint' ||
    typeof input.deliveryToken !== 'string' ||
    input.deliveryToken.length === 0 ||
    typeof input.ptyIncarnation !== 'string' ||
    input.ptyIncarnation.length === 0 ||
    !Number.isSafeInteger(input.clientGeneration) ||
    Number(input.clientGeneration) <= 0 ||
    !Number.isSafeInteger(input.ownerGeneration) ||
    Number(input.ownerGeneration) <= 0 ||
    !Number.isSafeInteger(input.acceptedSourceEndSu) ||
    Number(input.acceptedSourceEndSu) < 0
  ) {
    return Object.freeze({ status: 'checkpointUnavailable' })
  }
  return Object.freeze({
    status: 'checkpoint',
    deliveryToken: input.deliveryToken,
    ptyIncarnation: input.ptyIncarnation,
    clientGeneration: Number(input.clientGeneration),
    ownerGeneration: Number(input.ownerGeneration),
    acceptedSourceEndSu: Number(input.acceptedSourceEndSu)
  })
}

type ManagedPty = {
  id: string
  incarnationId: string
  pty: IPty
  initialCwd: string
  /** Why a chunk deque: rebuilding a rolling 100KB string per PTY chunk copied the
   * whole window on every write once saturated. Readers are attach/adopt/revive only. */
  buffered: RecentPtyOutputBuffer
  /** Timer for SIGKILL fallback after a graceful SIGTERM shutdown. */
  killTimer?: ReturnType<typeof setTimeout>
  /** True once disposeManagedPty has run; blocks double-dispose and makes post-dispose calls fail "not found" not silently. */
  disposed?: boolean
  /** True once external cleanup observers have been notified. */
  exitListenerNotified?: boolean
  /** Renderer-supplied paneKey (ORCA_PANE_KEY); captured so exit observers can evict per-pane cache state. */
  paneKey?: string
  tabId?: string
  /** Attach-only identity metadata (RPC). Separate from paneKey/tabId, which also drive shell env/revive hooks. */
  attachIdentity?: PtyIdentity
  worktreeId?: string
  terminalHandle?: string
  explicitTerm?: string
  envToDelete: string[]
  gitCredentialPromptGuarded: boolean
  startupCommand?: ManagedStartupCommand
  physicalExit?: PhysicalExitTracker
  forceKillSent?: boolean
  gracefulKillSent?: boolean
  startupIngress?: PtyStartupIngress
  startupIngressIntent?: ReturnType<typeof parsePtyStartupIngressIntent>
  ownerBackend: PtyOwnerBackend
  agentSessionOwners?: AgentSessionOwnerBinding[]
}

type RelayAgentSessionCreateResult = {
  id: string
  incarnationId: string
  replay?: string
  agentSessionEnsure?: unknown
  sourceActivation?: PtySourceReceivingActivation
}

const AGENT_SESSION_CREATE_OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/
const AGENT_SESSION_CREATE_OPERATION_RETENTION_MS = 24 * 60 * 60 * 1000
const AGENT_SESSION_CREATE_OPERATION_LIMIT = 4_096

type PendingPtyOutput = RelayPtySourceOutput & {
  data: string
  interactive?: boolean
  sourceChunk?: RelayPtySourceOutput
}

type ManagedStartupCommand = {
  command: string
  delivered: boolean
  waitForShellReady: boolean
  scanState: ShellReadyScanState | null
  timer: ReturnType<typeof setTimeout> | null
}

// Why: node-pty's Windows agent throws on any signal arg (ConPTY has no signal semantics); drop it there, forward on POSIX.
function killPtyProcess(pty: IPty, signal: string): void {
  if (process.platform === 'win32') {
    pty.kill()
    return
  }
  if (signal === 'SIGKILL') {
    forceKillPosixPtyProcessGroups(pty.pid, () => pty.kill(signal))
    return
  }
  pty.kill(signal)
}

function finishPtyCreationOperations(operations: readonly (() => void)[]): void {
  // Why: the relay still targets Node 18, which lacks Array.prototype.toReversed.
  for (let index = operations.length - 1; index >= 0; index--) {
    operations[index]()
  }
}

function disposeManagedPty(managed: ManagedPty): void {
  if (managed.disposed) {
    return
  }
  managed.disposed = true
  // Why: clear the SIGKILL fallback timer so it can't fire pty.kill on an already-disposed instance.
  if (managed.killTimer) {
    clearTimeout(managed.killTimer)
    managed.killTimer = undefined
  }
  // Why: neutralize pty.kill before destroy() so UnixTerminal's async 'close' SIGHUP can't hit a recycled pid.
  // Windows exempt: its destroy() IS a kill() (via _deferNoArgs), so neutralizing leaks the ConPTY agent.
  if (process.platform !== 'win32') {
    ;(managed.pty as unknown as { kill: (sig?: string) => void }).kill = () => {}
  } else if (managed.gracefulKillSent || managed.forceKillSent) {
    // Why: WindowsTerminal.destroy() calls kill(); a prior bare kill already closed ConPTY, so skip to avoid double-close.
    return
  }
  try {
    ;(managed.pty as unknown as { destroy?: () => void }).destroy?.()
  } catch {
    /* swallow */
  }
}
const DEFAULT_GRACE_TIME_MS = DEFAULT_SSH_RELAY_GRACE_PERIOD_SECONDS * 1000
export const IMMEDIATE_PTY_EXIT_TIMEOUT_MS = 8_000
export const MAX_RELAY_PTY_SESSIONS = 50
export const REPLAY_BUFFER_MAX = 100 * 1024
const PTY_OUTPUT_BATCH_INTERVAL_MS = 8
const PTY_OUTPUT_DRAIN_CONTINUE_MS = 1
const PTY_OUTPUT_FLUSH_CHUNK_CHARS = 16 * 1024
const PTY_OUTPUT_FLUSH_MAX_WRITES = 2
const PTY_OUTPUT_PRODUCER_HIGH_BYTES = 128 * 1024
const PTY_OUTPUT_PRODUCER_LOW_BYTES = 64 * 1024
const INTERACTIVE_OUTPUT_WINDOW_MS = 100
const INTERACTIVE_OUTPUT_MAX_CHARS = 1024
const INTERACTIVE_REDRAW_MAX_CHARS = PTY_OUTPUT_FLUSH_CHUNK_CHARS
const INTERACTIVE_OUTPUT_BUDGET_CHARS = 32 * 1024
const STARTUP_COMMAND_WRITE_DELAY_MS = 50
const STARTUP_COMMAND_SHELL_READY_FALLBACK_MS = 1500
const PTY_FORCE_KILL_RETRY_DELAY_MS = 250
const PTY_FORCE_KILL_MAX_ATTEMPTS = 2
const ALLOWED_SIGNALS = new Set([
  'SIGINT',
  'SIGTERM',
  'SIGHUP',
  'SIGKILL',
  'SIGTSTP',
  'SIGCONT',
  'SIGWINCH',
  'SIGUSR1',
  'SIGUSR2'
])

const ALLOWED_WINDOWS_SHELL_OVERRIDES = new Set([
  'powershell.exe',
  'powershell',
  'pwsh.exe',
  'pwsh',
  'cmd.exe',
  'cmd',
  'wsl.exe',
  'wsl',
  WINDOWS_GIT_BASH_SHELL
])

function resolvePtyShellOverride(shellOverride: string): string {
  if (!shellOverride) {
    return ''
  }
  if (process.platform !== 'win32') {
    return ''
  }
  const normalized = shellOverride.toLowerCase()
  if (!ALLOWED_WINDOWS_SHELL_OVERRIDES.has(normalized)) {
    throw new Error(`Unsupported Windows shell override: ${shellOverride}`)
  }
  return resolveWindowsGitBashShellPath(shellOverride) ?? shellOverride
}

type PtyProcessSummary = {
  id: string
  incarnationId: string
  cwd: string
  title: string
  worktreeId?: string
  terminalHandle?: string
  agentSessionOwners?: AgentSessionOwnerBinding[]
}

type SerializedPtyEntry = {
  id: string
  pid: number
  cols: number
  rows: number
  cwd: string
  paneKey?: string
  tabId?: string
  attachIdentity?: PtyIdentity
  worktreeId?: string
  terminalHandle?: string
  explicitTerm?: string
  envToDelete?: string[]
  /** Optional for state serialized by relays predating the credential guard. */
  gitCredentialPromptGuarded?: boolean
  agentSessionOwners?: AgentSessionOwnerBinding[]
}

function sanitizeEnvToDelete(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((key): key is string => typeof key === 'string' && key.length > 0)
        .slice(0, 1_024)
    : []
}

export type PtyExitListener = (event: { id: string; paneKey?: string }) => void

type PtyIdentity = { paneKey?: string; tabId?: string }

/**
 * True when a reattach's expected pane identity contradicts the target PTY's own.
 * Rejects cross-relay-generation id collisions (a reset relay reuses `pty-N`).
 * Only compares fields present on both sides; absent identity stays permissive.
 */
export function attachIdentityMismatches(expected: PtyIdentity, managed: PtyIdentity): boolean {
  return Boolean(
    (expected.paneKey && managed.paneKey && expected.paneKey !== managed.paneKey) ||
    (expected.tabId && managed.tabId && expected.tabId !== managed.tabId)
  )
}
/** Returns env to merge into the PTY's spawn env. Receives spawn context so augmenters can derive per-PTY identity from paneKey.
 *  `command` is the renderer-chosen agent launch command (`pi`, `omp`, …); undefined for CLI-launched bare shells. */
export type PtyEnvAugmenter = (ctx: {
  id: string
  paneKey?: string
  shell: string
  env: Record<string, string>
  command?: string
  launchAgent?: TuiAgent
}) => Record<string, string>

export type RelayPtyWorktreeRemovalCoordinator = {
  beginWorktreePtySpawn(operationPath: string): () => void
}

import { PtyHandler } from './pty-session-stage-state'
export class PtyHandlerStage1Capacity extends PtyHandler {
  setConsumerDeliveryPaused(id: string, paused: boolean): void {
    if (paused) {
      this.consumerPausedOutputPtys.add(id)
      this.pausePtyOutput(id)
      return
    }
    this.consumerPausedOutputPtys.delete(id)
    this.maybeResumePtyOutput(id)
  }

  setSourcePublication(publication: RelayPtySourcePublication): void {
    this.sourcePublication = publication
  }

  handleSourceCreditAvailable(id: string): void {
    this.sourcePublication?.onCreditAvailable(id)
  }

  handleSourcePublicationCapacity(id: string): void {
    if (this.pendingOutputByPty.has(id)) {
      this.scheduleOutputFlush(0)
    }
    this.maybeResumePtyOutput(id)
    this.publishPendingExit(id)
  }

  protected async loadPty(): Promise<typeof NodePty | null> {
    if (this.ptyModule) {
      return this.ptyModule
    }
    if (this.ptyModuleLoadPromise) {
      return this.ptyModuleLoadPromise
    }
    this.ptyModuleLoadPromise = this.loadPtyUncached()
    try {
      return await this.ptyModuleLoadPromise
    } finally {
      this.ptyModuleLoadPromise = null
    }
  }

  protected async loadPtyUncached(): Promise<typeof NodePty | null> {
    if (!this.reloadPtyModuleFromDisk) {
      try {
        this.ptyModule = await import('node-pty')
        return this.ptyModule
      } catch {
        this.reloadPtyModuleFromDisk = true
      }
    }
    // Why: tie module resolution to the deployed bundle dir, not cwd.
    const moduleEntry = join(__dirname, 'node_modules', 'node-pty', 'lib', 'index.js')
    if (!existsSync(moduleEntry)) {
      return null
    }
    try {
      this.ptyModule = require(moduleEntry) as typeof NodePty
      return this.ptyModule
    } catch {
      return null
    }
  }

  protected invalidatePtyModuleAfterBindingFailure(): void {
    this.ptyModule = null
    this.reloadPtyModuleFromDisk = true
    const moduleRoot = join(__dirname, 'node_modules', 'node-pty')
    for (const cachedPath of Object.keys(require.cache)) {
      if (isPathInsideOrEqual(moduleRoot, cachedPath)) {
        delete require.cache[cachedPath]
      }
    }
  }

  setGraceTimeMs(graceTimeMs: number): void {
    this.graceTimeMs = Math.max(0, Math.floor(graceTimeMs))
  }

  setWorktreeRemovalCoordinator(coordinator: RelayPtyWorktreeRemovalCoordinator | null): void {
    this.worktreeRemovalCoordinator = coordinator
  }

  async shutdownForWorktreePath(rootPath: string): Promise<void> {
    const matchingIds = [...this.ptys.values()]
      .filter((managed) => {
        const ownedPath = managed.worktreeId
          ? splitWorktreeId(managed.worktreeId)?.worktreePath
          : undefined
        return (
          (ownedPath !== undefined && isPathInsideOrEqual(rootPath, ownedPath)) ||
          isPathInsideOrEqual(rootPath, managed.initialCwd)
        )
      })
      .map((managed) => managed.id)
    await Promise.all(matchingIds.map((id) => this.shutdown({ id, immediate: true })))
  }

  get configuredGraceTimeMs(): number {
    return this.graceTimeMs
  }

  /** Subscribe to PTY-exit events (relay-hook server uses this to evict per-paneKey caches). */
  setExitListener(listener: PtyExitListener | null): void {
    this.exitListener = listener
  }

  /** Register an env augmenter merged into every spawn env *after* process.env and renderer env.
   *  Used by the relay-hook server to inject ORCA_AGENT_HOOK_* coords. See docs/design/agent-status-over-ssh.md §3. */
  addEnvAugmenter(augmenter: PtyEnvAugmenter): () => void {
    this.envAugmenters.push(augmenter)
    return () => {
      const idx = this.envAugmenters.indexOf(augmenter)
      if (idx !== -1) {
        this.envAugmenters.splice(idx, 1)
      }
    }
  }

  /** Build augmented spawn env; augmenter values win over process.env/renderer env. Shared by spawn()/revive() so precedence can't drift. */
  protected buildSpawnEnv(
    rendererEnv: Record<string, string> | undefined,
    ctx: {
      id: string
      paneKey?: string
      shell: string
      command?: string
      launchAgent?: TuiAgent
    },
    envToDelete: readonly string[] = []
  ): Record<string, string> {
    const baseEnv = mergeGitConfigEnvProtocol(
      {
        ...stripInheritedBuildModeEnv(process.env),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        TERM_PROGRAM: 'Orca',
        TERM_PROGRAM_VERSION:
          rendererEnv?.ORCA_APP_VERSION || process.env.ORCA_APP_VERSION || '0.0.0-dev',
        FORCE_HYPERLINK: '1'
      },
      rendererEnv
    ) as Record<string, string>
    const augmented: Record<string, string> = {}
    for (const augmenter of this.envAugmenters) {
      try {
        Object.assign(augmented, augmenter({ ...ctx, env: baseEnv }))
      } catch (err) {
        process.stderr.write(
          `[pty-handler] env augmenter threw: ${err instanceof Error ? err.message : String(err)}\n`
        )
      }
    }
    const result = mergeGitConfigEnvProtocol(baseEnv, augmented) as Record<string, string>
    // Why: match local/daemon precedence so defaults/augmenters can't resurrect explicitly-removed values.
    for (const key of envToDelete) {
      delete result[key]
    }
    if (
      !envToDelete.includes('TERM') &&
      rendererEnv &&
      Object.prototype.hasOwnProperty.call(rendererEnv, 'TERM')
    ) {
      result.TERM = rendererEnv.TERM
    }
    // Why: node-pty defaults missing/empty TERM per-platform; normalize so POSIX and Windows children agree.
    if (!result.TERM) {
      result.TERM = 'xterm-256color'
    }
    return result
  }

}
