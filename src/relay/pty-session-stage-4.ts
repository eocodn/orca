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

import { PtyHandlerStage3 } from './pty-session-stage-3'
export class PtyHandlerStage4 extends PtyHandlerStage3 {
  protected async attach(
    params: Record<string, unknown>,
    context?: RequestContext
  ): Promise<{
    incarnationId: string
    replay?: string
    sourceRecovery?: PtySourceRecoveryResult
    sourceActivation?: PtySourceReceivingActivation
  }> {
    const id = params.id as string
    const managed = this.ptys.get(id)
    // Why: after dispose, pty.kill is a POSIX no-op; treat disposed as not-found so failures aren't silent.
    if (!managed || managed.disposed) {
      throw new Error(`PTY "${id}" not found`)
    }

    // Why: a shell can die without node-pty firing onExit (reaped out-of-band); prove liveness so attach doesn't strand a dead, lingering lease.
    if (managed.pty.pid && !isProcessAlive(managed.pty.pid)) {
      managed.physicalExit?.markExited()
      this.releaseRelayIngress(managed)
      this.flushPtyOutput(id)
      this.notifyExitListener(managed)
      this.agentSessionOwners.release(managed.id)
      disposeManagedPty(managed)
      this.ptys.delete(id)
      this.clearPtyFlowState(id)
      throw new Error(`PTY "${id}" not found`)
    }

    // Why: a relay generation reset can reuse pty-N for a different pane; reject on identity disagreement (absent identity permissive).
    const mismatch = attachIdentityMismatches(
      {
        paneKey: typeof params.expectedPaneKey === 'string' ? params.expectedPaneKey : undefined,
        tabId: typeof params.expectedTabId === 'string' ? params.expectedTabId : undefined
      },
      managed.attachIdentity ?? { paneKey: managed.paneKey, tabId: managed.tabId }
    )
    if (mismatch) {
      throw new Error(`PTY "${id}" not found (identity mismatch)`)
    }

    managed.startupIngress?.snapshotBarrier()
    let sourceRecovery = parseSourceRecoveryRequest(params.sourceRecovery)
    if (
      sourceRecovery?.status === 'checkpoint' &&
      this.sourcePublication &&
      !(await this.sourcePublication.waitForPendingSend(id))
    ) {
      sourceRecovery = Object.freeze({ status: 'checkpointUnavailable' })
    }
    const activation = this.sourcePublication?.activate(
      id,
      managed.incarnationId,
      context,
      sourceRecovery
    )
    const sourceActivation =
      context && this.sourcePublication?.receivingActivation?.(id, context.clientId)
    if (typeof activation === 'object') {
      return {
        incarnationId: managed.incarnationId,
        sourceRecovery: activation,
        ...(sourceActivation ? { sourceActivation } : {})
      }
    }
    if (activation === 'existing' && this.sourcePublication?.accepts(id)) {
      return {
        incarnationId: managed.incarnationId,
        ...(sourceActivation ? { sourceActivation } : {})
      }
    }

    // Why: renderer hasn't registered replay handlers yet during spawn, so return to the caller instead of notifying too early.
    // Why: buffer intentionally NOT cleared after replay (client clears xterm first) so later restarts still replay full history.
    const replay = managed.buffered.read()
    if (replay) {
      // Why: drop pending batched bytes already in the replay buffer so attach doesn't render them twice.
      this.pendingOutputByPty.delete(id)
      this.clearOutputFlushTimerIfIdle()
      this.maybeResumePtyOutput(id)
      if (params.suppressReplayNotification) {
        return {
          incarnationId: managed.incarnationId,
          replay,
          ...(sourceActivation ? { sourceActivation } : {})
        }
      }
      this.dispatcher.notify('pty.replay', { id, data: replay })
    }
    return {
      incarnationId: managed.incarnationId,
      ...(sourceActivation ? { sourceActivation } : {})
    }
  }

  protected writeData(params: Record<string, unknown>): void {
    const id = params.id as string
    const data = params.data as string
    if (typeof data !== 'string') {
      return
    }
    const managed = this.ptys.get(id)
    if (managed && !managed.disposed) {
      this.lastInputAtByPty.set(id, performance.now())
      this.interactiveOutputCharsByPty.set(id, 0)
      managed.pty.write(data)
    }
  }

  protected resize(params: Record<string, unknown>): void {
    const id = params.id as string
    const cols = Math.max(1, Math.min(500, Math.floor(Number(params.cols) || 80)))
    const rows = Math.max(1, Math.min(500, Math.floor(Number(params.rows) || 24)))
    const managed = this.ptys.get(id)
    if (managed && !managed.disposed) {
      managed.pty.resize(cols, rows)
    }
  }

  protected async resizeIfCurrent(
    params: Record<string, unknown>
  ): Promise<{ applied: boolean }> {
    const id = params.id as string
    const expectedIncarnationId = params.expectedIncarnationId
    const cols = Number(params.cols)
    const rows = Number(params.rows)
    const managed = this.ptys.get(id)
    if (
      !managed ||
      managed.disposed ||
      typeof expectedIncarnationId !== 'string' ||
      managed.incarnationId !== expectedIncarnationId ||
      !areValidTerminalDimensions(cols, rows)
    ) {
      return { applied: false }
    }
    managed.pty.resize(cols, rows)
    return { applied: true }
  }

  protected async getSize(
    params: Record<string, unknown>
  ): Promise<{ cols: number; rows: number } | null> {
    const managed = this.ptys.get(params.id as string)
    if (!managed || managed.disposed) {
      return null
    }
    return { cols: managed.pty.cols, rows: managed.pty.rows }
  }

  protected async shutdown(params: Record<string, unknown>): Promise<void> {
    const id = params.id as string
    const immediate = params.immediate as boolean
    const managed = this.ptys.get(id)
    if (!managed) {
      return
    }

    if (immediate) {
      this.releaseStartupCommand(managed)
      this.flushPtyOutput(id)
      this.requestForceKill(managed)
      // Why: remote Git deletion must not race the child's native handles; on timeout keep the map entry so onExit/retry still owns it.
      await this.waitForPhysicalExit(managed, IMMEDIATE_PTY_EXIT_TIMEOUT_MS)
    } else {
      this.releaseStartupCommand(managed)
      this.requestGracefulKill(managed, 'force-kill')
    }
  }

  protected async sendSignal(params: Record<string, unknown>): Promise<void> {
    const id = params.id as string
    const signal = params.signal as string
    if (!ALLOWED_SIGNALS.has(signal)) {
      throw new Error(`Signal not allowed: ${signal}`)
    }
    const managed = this.ptys.get(id)
    // Why: dispose neutralizes pty.kill on POSIX; treat disposed as not-found so signals don't silently no-op.
    if (!managed || managed.disposed) {
      throw new Error(`PTY "${id}" not found`)
    }
    managed.pty.kill(signal)
  }

  protected waitForPhysicalExit(managed: ManagedPty, timeoutMs: number): Promise<void> {
    const physicalExit = managed.physicalExit
    if (!physicalExit) {
      return Promise.reject(new Error(`PTY "${managed.id}" exit tracking unavailable`))
    }
    return physicalExit.waitForExit(
      timeoutMs,
      () => new Error(`Timed out waiting for PTY process exit: ${managed.id}`)
    )
  }

  protected requestGracefulKill(
    managed: ManagedPty,
    fallbackAction: 'terminate stale' | 'force-kill'
  ): void {
    if (managed.gracefulKillSent) {
      return
    }
    managed.gracefulKillSent = true
    if (process.platform === 'win32') {
      // Why: ConPTY's bare kill is already force-final; block any later close of the handle.
      managed.forceKillSent = true
    }
    try {
      killPtyProcess(managed.pty, 'SIGTERM')
    } catch (error) {
      managed.gracefulKillSent = false
      managed.forceKillSent = false
      throw error
    }
    if (process.platform === 'win32') {
      return
    }
    // Why: POSIX children may ignore SIGTERM; arm a bounded SIGKILL fallback.
    this.armForceKillFallback(managed, fallbackAction, 5000, PTY_FORCE_KILL_MAX_ATTEMPTS)
  }

  protected armForceKillFallback(
    managed: ManagedPty,
    fallbackAction: 'terminate stale' | 'force-kill',
    delayMs: number,
    attemptsRemaining: number
  ): void {
    managed.killTimer = setTimeout(() => {
      managed.killTimer = undefined
      const still = this.ptys.get(managed.id)
      if (!still || still.disposed) {
        return
      }
      try {
        this.requestForceKill(still)
      } catch (error) {
        process.stderr.write(
          `[pty-handler] failed to ${fallbackAction} PTY ${managed.id}: ${error instanceof Error ? error.message : String(error)}\n`
        )
        // Why: a transient SIGKILL failure must not strand an unreachable remote shell.
        if (attemptsRemaining > 1 && this.ptys.get(still.id) === still && !still.disposed) {
          this.armForceKillFallback(
            still,
            fallbackAction,
            PTY_FORCE_KILL_RETRY_DELAY_MS,
            attemptsRemaining - 1
          )
        }
      }
    }, delayMs)
  }

  protected requestForceKill(managed: ManagedPty): void {
    if (managed.forceKillSent || (process.platform === 'win32' && managed.gracefulKillSent)) {
      return
    }
    managed.forceKillSent = true
    try {
      killPtyProcess(managed.pty, 'SIGKILL')
    } catch (error) {
      managed.forceKillSent = false
      throw error
    }
  }

  protected async getCwd(params: Record<string, unknown>): Promise<string> {
    const id = params.id as string
    const managed = this.ptys.get(id)
    if (!managed || managed.disposed) {
      throw new Error(`PTY "${id}" not found`)
    }
    return resolveProcessCwd(managed.pty.pid, managed.initialCwd)
  }

  protected async getInitialCwd(params: Record<string, unknown>): Promise<string> {
    const id = params.id as string
    const managed = this.ptys.get(id)
    if (!managed || managed.disposed) {
      throw new Error(`PTY "${id}" not found`)
    }
    return managed.initialCwd
  }

  protected async clearBuffer(params: Record<string, unknown>): Promise<void> {
    const id = params.id as string
    const managed = this.ptys.get(id)
    if (managed && !managed.disposed) {
      managed.startupIngress?.snapshotBarrier()
      managed.pty.clear()
    }
  }

  protected async hasChildProcesses(params: Record<string, unknown>): Promise<boolean> {
    const id = params.id as string
    const managed = this.ptys.get(id)
    if (!managed || managed.disposed) {
      return false
    }
    return await processHasChildren(managed.pty.pid)
  }

  protected async getForegroundProcess(params: Record<string, unknown>): Promise<string | null> {
    const id = params.id as string
    const managed = this.ptys.get(id)
    if (!managed || managed.disposed) {
      return null
    }
    return await getForegroundProcessName(managed.pty.pid, managed.pty.process || null)
  }

  protected async inspectProcess(params: Record<string, unknown>): Promise<{
    foregroundProcess: string | null
    hasChildProcesses: boolean
  }> {
    const id = params.id as string
    const managed = this.ptys.get(id)
    if (!managed || managed.disposed) {
      throw new Error('terminal_gone')
    }
    const foregroundProcess = await getForegroundProcessName(
      managed.pty.pid,
      managed.pty.process || null
    )
    return {
      foregroundProcess,
      hasChildProcesses: await processHasChildren(managed.pty.pid)
    }
  }

  protected async listProcesses(): Promise<PtyProcessSummary[]> {
    const results: PtyProcessSummary[] = []
    for (const [id, managed] of this.ptys) {
      const title =
        (await getForegroundProcessName(managed.pty.pid, managed.pty.process || null)) || 'shell'
      results.push({
        id,
        incarnationId: managed.incarnationId,
        cwd: managed.initialCwd,
        title,
        ...(managed.worktreeId ? { worktreeId: managed.worktreeId } : {}),
        ...(managed.terminalHandle ? { terminalHandle: managed.terminalHandle } : {}),
        ...(this.agentSessionOwners.listForPty(id).length
          ? { agentSessionOwners: this.agentSessionOwners.listForPty(id) }
          : {})
      })
    }
    return results
  }

  protected async serialize(params: Record<string, unknown>): Promise<string> {
    const ids = params.ids as string[]
    const entries: SerializedPtyEntry[] = []
    for (const id of ids) {
      const managed = this.ptys.get(id)
      if (!managed) {
        continue
      }
      const { pid, cols, rows } = managed.pty
      entries.push({
        id,
        pid,
        cols,
        rows,
        cwd: managed.initialCwd,
        paneKey: managed.paneKey,
        tabId: managed.tabId,
        attachIdentity: managed.attachIdentity,
        worktreeId: managed.worktreeId,
        ...(managed.explicitTerm !== undefined ? { explicitTerm: managed.explicitTerm } : {}),
        envToDelete: managed.envToDelete,
        gitCredentialPromptGuarded: managed.gitCredentialPromptGuarded,
        ...(managed.terminalHandle ? { terminalHandle: managed.terminalHandle } : {})
      })
    }
    return JSON.stringify(entries)
  }

  protected async revive(params: Record<string, unknown>): Promise<void> {
    const state = params.state as string
    const entries = JSON.parse(state) as SerializedPtyEntry[]

    for (const entry of entries) {
      if (this.ptys.has(entry.id) || this.pendingReviveIds.has(entry.id)) {
        continue
      }
      // Only re-attach if the original process is still alive
      try {
        process.kill(entry.pid, 0)
      } catch {
        continue
      }
      const ownedPath = entry.worktreeId
        ? splitWorktreeId(entry.worktreeId)?.worktreePath
        : undefined
      const finishCreation = this.beginPtyCreation([ownedPath, entry.cwd])
      this.pendingReviveIds.add(entry.id)
      try {
        await this.reviveEntry(entry)
      } finally {
        this.pendingReviveIds.delete(entry.id)
        finishCreation()
      }
    }
  }

}
