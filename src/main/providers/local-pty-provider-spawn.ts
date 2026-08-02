import { basename, delimiter, win32 as pathWin32 } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveWindowsShellLaunchArgs } from './windows-shell-args'
import {
  resolveEffectiveWindowsPowerShell,
  shouldProbeWindowsPowerShellAvailability,
  type WindowsPowerShellShellFamily
} from './windows-powershell'
import { buildWindowsPowerShellSpawnAttempts } from './windows-shell-fallback-chain'
import { resolveProcessCwd } from './process-cwd'
import { existsSync } from 'node:fs'
import * as pty from 'node-pty'
import { getDefaultWslDistro, parseWslPath, isWslAvailable } from '../wsl'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree-id'
import {
  injectHistoryEnv,
  updateHistFileForFallback,
  logHistoryInjection
} from '../terminal-history'
import type { IPtyProvider, PtyProcessInfo, PtySpawnOptions, PtySpawnResult } from './types'
import {
  ensureNodePtySpawnHelperExecutable,
  validateWorkingDirectory,
  spawnShellWithFallback
} from './local-pty-utils'
import { prepareMacosTccLoginShell } from './macos-tcc-login-shell'
import {
  getAttributionShellLaunchConfig,
  getShellReadyLaunchConfig,
  createShellReadyScanState,
  drainShellReadyHeldBytes,
  scanForShellReady,
  writeStartupCommandWhenShellReady,
  STARTUP_COMMAND_READY_MAX_WAIT_MS
} from './local-pty-shell-ready'
import type { ShellReadySignal } from './local-pty-shell-ready'
import { removeInheritedNoColor } from '../pty/terminal-color-env'
import { removeAppImageRuntimeEnv } from '../pty/appimage-terminal-env'
import { stripInheritedBuildModeEnv } from '../pty/build-mode-env'
import { isHostCodexHomeForWsl, isWslCodexHomeForHost } from '../pty/codex-home-wsl-env'
import { addWslEnvKeys } from '../wsl-env'
import {
  POWERLEVEL10K_WIZARD_DISABLE_ENV,
  seedPowerlevel10kWizardEnv
} from '../pty/powerlevel10k-wizard-env'
import {
  isWindowsGitBashShellPath,
  resolveGitBashPath,
  resolveWindowsGitBashShellPath
} from '../git-bash'
import { WINDOWS_GIT_BASH_SHELL } from '../../shared/windows-terminal-shell'
import { resolveAgentForegroundProcessWithAvailability } from './agent-foreground-process'
import { resolveStableForegroundProcess } from './stable-foreground-process'
import { getAgentForegroundContextPaths } from './agent-foreground-context-paths'
import { recognizeAgentProcessFromCommandLine } from '../../shared/agent-process-recognition'
import { killWithDescendantSweep } from '../pty-descendant-termination'
import { readWindowsConptyProcessIds } from './windows-conpty-process-membership'
import { canConfirmAgentFromConsolePresence } from './windows-console-foreground'
import { forceKillPosixPtyProcessGroups } from '../pty/posix-pty-process-groups'
import { shouldUseShellReadyStartupDelivery } from '../../shared/codex-startup-delivery'
import { assertSafeAgentStartupCwd, resolveSafePtyDefaultCwd } from './pty-default-cwd'
import { ORCA_HERMES_STARTUP_QUERY_ENV } from '../../shared/hermes-startup-query'
import { PhysicalExitTracker } from '../../shared/physical-exit-tracker'
import { mergeGitConfigEnvProtocol } from '../../shared/git-credential-prompt-env'
import { PtyStartupIngress, type PtyIngressEmission } from '../../shared/pty-startup-ingress'
import { resolvePtyOwnerBackend } from '../../shared/pty-owner-backend'

export const PANE_IDENTITY_ENV_KEYS = [
  'ORCA_PANE_KEY',
  'ORCA_TAB_ID',
  'ORCA_WORKTREE_ID',
  'ORCA_AGENT_LAUNCH_TOKEN'
] as const

export let ptyCounter = 0
export const ptyProcesses = new Map<string, pty.IPty>()
export const ptyIncarnations = new Map<string, string>()
// Why: only agent sessions get descendant tree-kill (tool children run in detached groups SIGHUP can't reach); plain terminals skip it so nohup-detached children survive.
export const ptyAgentSessionIds = new Set<string>()
// Why: descendant capture is async, so reattach/duplicate shutdown must wait for the original owner, not return a dying PTY.
export type PtyShutdownOperation = {
  promise: Promise<void>
  immediate: boolean
  rootSignalled: boolean
  proc: pty.IPty
}
export const ptyShutdownOperations = new Map<string, PtyShutdownOperation>()
export type PendingLocalPtySpawn = {
  canceled: boolean
}
export const pendingLocalPtySpawns = new Map<string, Set<PendingLocalPtySpawn>>()
export const ptyShellName = new Map<string, string>()
export const ptyAgentForegroundContextPaths = new Map<string, string[]>()
// Why: remember the last recognized agent foreground so a degraded scan doesn't report the shell and look like an exit.
export const ptyLastRecognizedForeground = new Map<string, string>()
export const ptyTerminalHandle = new Map<string, string>()
export const ptyWorktreeId = new Map<string, string>()
export const ptyInitialCwd = new Map<string, string>()
// Why: reattach carries current settings, not the live process's launch context; keep the first creator's WSL/native identity.
export const ptyWslDistroById = new Map<string, string | null>()
// Why: node-pty callbacks dispose before env teardown, but onExit separately owns physical-exit proof during termination.
export const ptyDisposables = new Map<string, { dispose: () => void }[]>()
export const ptyExitDisposables = new Map<string, { dispose: () => void }>()
export const ptyCleanupCallbacks = new Map<string, () => void>()
export const ptyTerminationMode = new Map<string, 'graceful' | 'force'>()
export const ptyPhysicalExits = new Map<string, PhysicalExitTracker>()
export const ptyForceKillTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const LOCAL_PTY_PHYSICAL_EXIT_TIMEOUT_MS = 8_000
export const LOCAL_PTY_GRACEFUL_FORCE_TIMEOUT_MS = 5_000
export const LOCAL_PTY_FORCE_KILL_RETRY_MS = 250

export let loadGeneration = 0
export const ptyLoadGeneration = new Map<string, number>()

export type DataCallback = (payload: {
  id: string
  incarnationId: string
  data: string
  sequenceChars?: number
  transformed?: boolean
  seq?: number
}) => void
export type ExitCallback = (payload: { id: string; code: number; incarnationId?: string }) => void

export const dataListeners = new Set<DataCallback>()
export const exitListeners = new Set<ExitCallback>()
export const startupIngressByPty = new Map<string, PtyStartupIngress>()

/**
 * Returns a stable default cwd for locally spawned PTYs.
 */
export function getDefaultCwd(): string {
  return resolveSafePtyDefaultCwd()
}

/**
 * Removes inherited pane identity unless this PTY explicitly supplies it.
 */
export function removeUnspecifiedPaneIdentityEnv(
  env: Record<string, string>,
  explicitEnv: Record<string, string> | undefined
): void {
  for (const key of PANE_IDENTITY_ENV_KEYS) {
    if (!explicitEnv || !Object.hasOwn(explicitEnv, key)) {
      delete env[key]
    }
  }
}

/**
 * Promotes the agent-teams shim path ahead of inherited PATH entries.
 */
export function promoteAgentTeamsShimPath(
  env: Record<string, string>,
  requestedPath: string | undefined
): void {
  if (!env.ORCA_AGENT_TEAMS_TEAM_ID || !requestedPath) {
    return
  }
  const shimDir = requestedPath.split(delimiter)[0]
  if (!shimDir) {
    return
  }
  const currentParts = env.PATH?.split(delimiter).filter(Boolean) ?? []
  env.PATH = [shimDir, ...currentParts.filter((part) => part !== shimDir)].join(delimiter)
}

/**
 * Disposes native node-pty listeners registered for a PTY id.
 */
export function disposePtyListeners(id: string): void {
  const disposables = ptyDisposables.get(id)
  if (disposables) {
    for (const d of disposables) {
      d.dispose()
    }
    ptyDisposables.delete(id)
  }
}

export function disposePtyExitListener(id: string): void {
  ptyExitDisposables.get(id)?.dispose()
  ptyExitDisposables.delete(id)
}

export function clearLocalPtyForceKillTimer(id: string): void {
  const timer = ptyForceKillTimers.get(id)
  if (timer) {
    clearTimeout(timer)
    ptyForceKillTimers.delete(id)
  }
}

export function runPtyCleanup(id: string): void {
  const cleanup = ptyCleanupCallbacks.get(id)
  if (!cleanup) {
    return
  }
  ptyCleanupCallbacks.delete(id)
  cleanup()
}

/**
 * Resolves a WSL context from a worktree id whose path is already a WSL path.
 */
export function getWslContextFromWorktreeId(
  worktreeId: string | undefined
): { distro: string; treatPosixCwdAsWsl: true } | undefined {
  // Why: strip any synthetic `::workspace:<uuid>` suffix so WSL detection parses the real path, not a nonexistent identifier.
  const worktreePath = worktreeId
    ? splitWorktreeIdForFilesystem(worktreeId)?.worktreePath
    : undefined
  const wslInfo = worktreePath ? parseWslPath(worktreePath) : null
  return wslInfo ? { distro: wslInfo.distro, treatPosixCwdAsWsl: true } : undefined
}

/**
 * Resolves a WSL launch context from a user-selected distro name.
 */
export function getWslContextFromPreferredDistro(
  distro: string | null | undefined
): { distro: string } | undefined {
  const trimmed = distro?.trim()
  return trimmed ? { distro: trimmed } : undefined
}

/**
 * Removes all local tracking state for a PTY id after teardown.
 */
export function clearPtyState(id: string): void {
  clearLocalPtyForceKillTimer(id)
  runPtyCleanup(id)
  disposePtyListeners(id)
  disposePtyExitListener(id)
  ptyProcesses.delete(id)
  ptyIncarnations.delete(id)
  ptyAgentSessionIds.delete(id)
  ptyShellName.delete(id)
  ptyAgentForegroundContextPaths.delete(id)
  ptyLastRecognizedForeground.delete(id)
  ptyTerminalHandle.delete(id)
  ptyWorktreeId.delete(id)
  ptyInitialCwd.delete(id)
  ptyWslDistroById.delete(id)
  ptyLoadGeneration.delete(id)
  ptyTerminationMode.delete(id)
  ptyPhysicalExits.delete(id)
}

export function createPtyPhysicalExit(id: string): void {
  ptyPhysicalExits.set(id, new PhysicalExitTracker())
}

export function waitForPtyPhysicalExit(id: string, physicalExit?: PhysicalExitTracker): Promise<void> {
  if (!physicalExit) {
    return Promise.reject(new Error(`PTY "${id}" exit tracking unavailable`))
  }
  return physicalExit.waitForExit(
    LOCAL_PTY_PHYSICAL_EXIT_TIMEOUT_MS,
    () => new Error(`Timed out waiting for PTY process exit: ${id}`)
  )
}

export function killLocalPtyProcess(proc: pty.IPty, immediate: boolean): void {
  if (process.platform === 'win32') {
    proc.kill()
    return
  }
  if (!immediate) {
    proc.kill('SIGTERM')
    return
  }
  forceKillPosixPtyProcessGroups(proc.pid, () => proc.kill('SIGKILL'))
}

export function armLocalPtyForceKill(
  id: string,
  proc: pty.IPty,
  options: { delayMs?: number; attemptsRemaining?: number } = {}
): void {
  if (ptyProcesses.get(id) !== proc || ptyTerminationMode.get(id) !== 'graceful') {
    return
  }
  const attemptsRemaining = options.attemptsRemaining ?? 2
  const timer = setTimeout(() => {
    ptyForceKillTimers.delete(id)
    if (ptyProcesses.get(id) !== proc || ptyTerminationMode.get(id) !== 'graceful') {
      return
    }
    ptyTerminationMode.set(id, 'force')
    try {
      killLocalPtyProcess(proc, true)
    } catch (error) {
      ptyTerminationMode.set(id, 'graceful')
      console.error('[pty] failed to force-kill PTY after graceful deadline', { id, error })
      // Why: a transient native rejection must not consume the only SIGKILL owner while shutdown still awaits physical exit.
      if (attemptsRemaining > 1) {
        armLocalPtyForceKill(id, proc, {
          delayMs: LOCAL_PTY_FORCE_KILL_RETRY_MS,
          attemptsRemaining: attemptsRemaining - 1
        })
      }
    }
  }, options.delayMs ?? LOCAL_PTY_GRACEFUL_FORCE_TIMEOUT_MS)
  timer.unref?.()
  ptyForceKillTimers.set(id, timer)
}

/**
 * Allocates either a stable caller-provided PTY id or a new numeric id.
 */
export function allocatePtyId(sessionId: string | undefined): string {
  const requested = normalizeLocalCallerSessionId(sessionId)
  if (requested) {
    return requested
  }
  let id: string
  do {
    id = String(++ptyCounter)
  } while (ptyProcesses.has(id))
  return id
}

async function prepareLocalPtySpawn(id: string): Promise<void> {
  const pendingSpawn: PendingLocalPtySpawn = { canceled: false }
  const pending = pendingLocalPtySpawns.get(id) ?? new Set()
  pending.add(pendingSpawn)
  pendingLocalPtySpawns.set(id, pending)
  try {
    // Why: shutdown must be able to cancel a stable session id during the async macOS capability probe, before node-pty exists.
    await prepareMacosTccLoginShell()
    if (pendingSpawn.canceled) {
      throw new Error(`PTY spawn canceled: ${id}`)
    }
  } finally {
    pending.delete(pendingSpawn)
    if (pending.size === 0) {
      pendingLocalPtySpawns.delete(id)
    }
  }
}

export function cancelPendingLocalPtySpawns(id: string): void {
  const pending = pendingLocalPtySpawns.get(id)
  if (!pending) {
    return
  }
  for (const pendingSpawn of pending) {
    pendingSpawn.canceled = true
  }
}

export function cancelAllPendingLocalPtySpawns(): void {
  for (const id of pendingLocalPtySpawns.keys()) {
    cancelPendingLocalPtySpawns(id)
  }
}

/**
 * Normalizes renderer session ids that should be reused for local PTY reattach.
 */
export function normalizeLocalCallerSessionId(sessionId: string | undefined): string | null {
  const requested = sessionId?.trim()
  if (!requested || /^\d+$/.test(requested)) {
    return null
  }
  return requested
}

export function reattachLocalPty(id: string, cols: number, rows: number): PtySpawnResult | null {
  const existing = ptyProcesses.get(id)
  if (!existing) {
    return null
  }
  try {
    existing.resize(cols, rows)
  } catch {
    /* Existing PTY may reject resize during teardown; still return the live handle. */
  }
  return {
    id,
    pid: existing.pid,
    ...(ptyWslDistroById.has(id) ? { wslDistro: ptyWslDistroById.get(id) ?? null } : {}),
    isReattach: true
  }
}

/**
 * Normalizes node-pty foreground process strings to executable basenames.
 */
export function normalizeForegroundProcessName(processName: string | null | undefined): string | null {
  const trimmed = processName?.trim().replace(/^["']|["']$/g, '') ?? ''
  if (!trimmed || trimmed === 'xterm-256color') {
    return null
  }
  return trimmed.split(/[\\/]/).pop() || null
}

/**
 * Falls back to the spawned Windows shell when node-pty reports a terminal name.
 */
export function resolveForegroundFallbackProcess(
  processName: string | null | undefined,
  shellName: string | undefined
): string | null {
  if (process.platform !== 'win32' || normalizeForegroundProcessName(processName)) {
    return processName || null
  }
  // Why: Windows node-pty may expose only the terminal name (`xterm-256color`); the spawned shell is the best foreground fallback.
  return shellName ?? processName ?? null
}

/** Basename of the spawned shell path, parsed for the *target* platform.
 *  Why: POSIX `basename` won't split a Windows `\` path (non-Windows host/CI), so it'd break the foreground comparison. */
export function getSpawnedShellName(shellPath: string): string {
  return process.platform === 'win32' ? pathWin32.basename(shellPath) : basename(shellPath)
}

/**
 * Disposes the native PTY handle while avoiding recycled-pid signals on POSIX.
 */
export function destroyPtyProcess(proc: pty.IPty, options: { alreadyKilled?: boolean } = {}): void {
  // Why: neutralize proc.kill before destroy(), whose close-listener SIGHUPs a possibly-recycled POSIX pid; destroy() frees the ptmx fd (docs/fix-pty-fd-leak.md); on Windows destroy() is itself kill().
  if (process.platform === 'win32' && options.alreadyKilled) {
    return
  }
  if (process.platform !== 'win32') {
    ;(proc as unknown as { kill: (sig?: string) => void }).kill = () => {}
  }
  try {
    ;(proc as unknown as { destroy?: () => void }).destroy?.()
  } catch {
    /* swallow — already torn down */
  }
}

/**
 * Requests local PTY termination while retaining physical-exit ownership.
 */
export function requestPtyTermination(id: string, proc: pty.IPty): void {
  runPtyCleanup(id)
  disposePtyListeners(id)
  const previousMode = ptyTerminationMode.get(id)
  // Why: cleanup neutralizes proc.kill below, so escalate an outstanding graceful request before its deadline is disabled.
  if (previousMode !== 'force') {
    clearLocalPtyForceKillTimer(id)
    ptyTerminationMode.set(id, 'force')
    try {
      killLocalPtyProcess(proc, true)
    } catch {
      if (previousMode === 'graceful') {
        ptyTerminationMode.set(id, previousMode)
        armLocalPtyForceKill(id, proc, {
          delayMs: LOCAL_PTY_FORCE_KILL_RETRY_MS,
          attemptsRemaining: 1
        })
      } else {
        ptyTerminationMode.delete(id)
      }
      /* Process may already be dead. */
      return
    }
  }
  // Why: shutdown and orphan cleanup can race; keep onExit + tracker installed until the OS proves the child was reaped.
  destroyPtyProcess(proc, { alreadyKilled: true })
}

export type LocalPtyProviderOptions = {
  /** Why: `ctx.command` (pi/omp/claude) must drive overlay source-dir selection — a disk-presence fallback shadows the other agent's extensions. */
  buildSpawnEnv?: (
    id: string,
    baseEnv: Record<string, string>,
    ctx?: {
      command?: string
      launchAgent?: PtySpawnOptions['launchAgent']
      codexHomePathOverride?: PtySpawnOptions['codexHomePathOverride']
      cwd?: string
      shellPath?: string
      isWsl?: boolean
      wslDistro?: string | null
    }
  ) => Record<string, string>
  /** Whether worktree-scoped shell history is enabled; when true (or absent) with a worktreeId, HISTFILE is scoped per-worktree. */
  isHistoryEnabled?: () => boolean
  /** Why: COMSPEC is always cmd.exe, so this callback injects the user's persisted shell preference. Undefined when none set. */
  getWindowsShell?: () => string | undefined
  getWindowsPowerShellImplementation?: () => 'auto' | 'powershell.exe' | 'pwsh.exe' | undefined
  pwshAvailable?: () => boolean
  onSpawned?: (id: string, incarnationId: string) => void
  onExit?: (id: string, code: number, incarnationId: string) => void
  onData?: (
    id: string,
    incarnationId: string,
    data: string,
    timestamp: number,
    sequenceChars?: number,
    transformed?: boolean
  ) => void
}


export function advanceLocalPtyGeneration(): number {
  return ++loadGeneration
}

export function resetLocalPtyGeneration(): void {
  loadGeneration = 0
}

export class LocalPtyProviderSpawn implements IPtyProvider {
  protected opts: LocalPtyProviderOptions

  constructor(opts: LocalPtyProviderOptions = {}) {
    this.opts = opts
  }

  /** Reconfigure the provider with new hooks (e.g. after window re-creation). */
  configure(opts: LocalPtyProviderOptions): void {
    this.opts = opts
  }

  /**
   * Spawns or reattaches a local PTY session for the renderer process.
   *
   * Windows launches can pre-deliver startup commands in argv, so the stdin fallback only runs when needed.
   */
  async spawn(args: PtySpawnOptions): Promise<PtySpawnResult> {
    const reattachId = normalizeLocalCallerSessionId(args.sessionId)
    if (reattachId) {
      const pendingShutdown = ptyShutdownOperations.get(reattachId)
      if (pendingShutdown) {
        await pendingShutdown.promise
      }
      const existing = reattachLocalPty(reattachId, args.cols, args.rows)
      if (existing) {
        return existing
      }
    }
    const id = allocatePtyId(reattachId ?? undefined)
    const incarnationId = randomUUID()

    const startupAgentRecognition = args.command
      ? recognizeAgentProcessFromCommandLine(args.command)
      : null

    const defaultCwd = getDefaultCwd()
    const cwd = args.cwd || defaultCwd
    // Why: gate on the effective cwd, not raw args.cwd — an omitted cwd becomes a safe default and must not be rejected as root-like.
    if (args.command && startupAgentRecognition) {
      assertSafeAgentStartupCwd(cwd, args.command)
    }
    const wslInfo = process.platform === 'win32' ? parseWslPath(cwd) : null
    const worktreeWslContext =
      process.platform === 'win32' ? getWslContextFromWorktreeId(args.worktreeId) : undefined
    const preferredWslContext =
      process.platform === 'win32'
        ? getWslContextFromPreferredDistro(args.terminalWindowsWslDistro)
        : undefined
    let launchWslContext =
      wslInfo !== null
        ? getWslContextFromPreferredDistro(wslInfo.distro)
        : (worktreeWslContext ?? preferredWslContext)

    let shellPath: string
    let shellArgs: string[]
    let effectiveCwd: string
    let validationCwd: string
    let startupCommandDeliveredInShellArgs = false
    let windowsFallbackAttempts: ReturnType<typeof buildWindowsPowerShellSpawnAttempts> = []
    let shellReadyLaunch: ReturnType<typeof getShellReadyLaunchConfig> | null = null
    let getFallbackShellReadyConfig:
      | ((shell: string) => ReturnType<typeof getShellReadyLaunchConfig>)
      | undefined
    if (wslInfo) {
      shellPath = 'wsl.exe'
      const resolved = resolveWindowsShellLaunchArgs(shellPath, cwd, defaultCwd)
      shellArgs = resolved.shellArgs
      effectiveCwd = resolved.effectiveCwd
      validationCwd = resolved.validationCwd
    } else if (process.platform === 'win32') {
      // Why: shellOverride opens one tab in a non-default shell without changing the user's setting; it wins over the setting.
      const requestedShellFamily =
        args.shellOverride ||
        this.opts.getWindowsShell?.() ||
        process.env.COMSPEC ||
        'powershell.exe'
      const shellFamily = worktreeWslContext ? 'wsl.exe' : requestedShellFamily
      if (!launchWslContext && pathWin32.basename(shellFamily).toLowerCase() === 'wsl.exe') {
        launchWslContext = getWslContextFromPreferredDistro(getDefaultWslDistro())
      }
      const normalizedShellFamily = pathWin32.basename(shellFamily).toLowerCase()
      const resolvedGitBashPath = resolveWindowsGitBashShellPath(shellFamily)
      // Why: normalize setting-value and path forms to the PowerShell family so the resolver can fall back to inbox powershell.exe.
      const powerShellImplementation = this.opts.getWindowsPowerShellImplementation?.()
      const resolvedShellFamily: WindowsPowerShellShellFamily =
        normalizedShellFamily === 'powershell.exe' || normalizedShellFamily === 'pwsh.exe'
          ? normalizedShellFamily
          : normalizedShellFamily === 'cmd.exe' || normalizedShellFamily === 'wsl.exe'
            ? normalizedShellFamily
            : undefined
      const shouldProbePwsh = shouldProbeWindowsPowerShellAvailability({
        shellFamily: resolvedShellFamily,
        implementation: powerShellImplementation
      })
      const shouldResolvePowerShellFamily =
        powerShellImplementation !== undefined || pathWin32.basename(shellFamily) === shellFamily
      if (resolvedGitBashPath) {
        shellPath = resolvedGitBashPath
      } else if (shellFamily === WINDOWS_GIT_BASH_SHELL) {
        shellPath = 'powershell.exe'
      } else {
        shellPath = shouldResolvePowerShellFamily
          ? (resolveEffectiveWindowsPowerShell({
              shellFamily: resolvedShellFamily,
              implementation: powerShellImplementation,
              pwshAvailable: shouldProbePwsh ? (this.opts.pwshAvailable?.() ?? false) : false
            }) ?? shellFamily)
          : shellFamily
      }
      // Why: bare `pwsh.exe` resolves to the Store App Execution Alias stub whose spawn fails (code 5); use an absolute exe + cmd.exe fallback.
      windowsFallbackAttempts = buildWindowsPowerShellSpawnAttempts({
        shellPath,
        cwd,
        defaultCwd,
        wslContext: launchWslContext,
        startupCommand: args.command
      })
      const primaryAttempt = windowsFallbackAttempts[0]
      if (primaryAttempt) {
        shellPath = primaryAttempt.shellPath
        shellArgs = primaryAttempt.shellArgs
        effectiveCwd = primaryAttempt.effectiveCwd
        validationCwd = primaryAttempt.validationCwd
        startupCommandDeliveredInShellArgs = primaryAttempt.startupCommandDeliveredInShellArgs
      } else {
        const resolved = resolveWindowsShellLaunchArgs(
          shellPath,
          cwd,
          defaultCwd,
          launchWslContext,
          args.command
        )
        shellArgs = resolved.shellArgs
        effectiveCwd = resolved.effectiveCwd
        validationCwd = resolved.validationCwd
        startupCommandDeliveredInShellArgs = resolved.startupCommandDeliveredInShellArgs === true
      }
    } else {
      shellPath = args.env?.SHELL || process.env.SHELL || '/bin/zsh'
      shellArgs = ['-l']
      effectiveCwd = cwd
      validationCwd = cwd
    }

    ensureNodePtySpawnHelperExecutable()
    validateWorkingDirectory(validationCwd)

    const spawnEnv: Record<string, string> = {
      ...mergeGitConfigEnvProtocol(stripInheritedBuildModeEnv(process.env), args.env),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'Orca',
      // Why: TUIs feature-gate on TERM_PROGRAM_VERSION; the fallback keeps tests and non-Electron runs working.
      TERM_PROGRAM_VERSION: process.env.ORCA_APP_VERSION ?? '0.0.0-dev',
      // Why: supports-hyperlinks rejects TERM_PROGRAM=Orca, so tools drop OSC 8 links; force it since xterm.js parses them.
      FORCE_HYPERLINK: '1'
    } as Record<string, string>
    // Why: Orca can be launched from an Orca terminal; pane identity belongs to the child PTY, not the parent shell.
    removeUnspecifiedPaneIdentityEnv(spawnEnv, args.env)
    removeAppImageRuntimeEnv(spawnEnv)
    removeInheritedNoColor(spawnEnv)
    for (const key of args.envToDelete ?? []) {
      delete spawnEnv[key]
    }
    if (args.env?.TERM) {
      spawnEnv.TERM = args.env.TERM
    }

    spawnEnv.LANG ??= 'en_US.UTF-8'

    // Why: on Windows LANG doesn't set the console code page; PYTHONUTF8=1 forces Python UTF-8 stdio to avoid garbled CJK.
    if (process.platform === 'win32') {
      spawnEnv.PYTHONUTF8 ??= '1'
      if (isWindowsGitBashShellPath(shellPath)) {
        // Why: Git for Windows login files otherwise cd to $HOME, ignoring node-pty's cwd for repo-scoped terminals.
        spawnEnv.CHERE_INVOKING ??= '1'
      }
    }

    const isWslShell = Boolean(wslInfo) || pathWin32.basename(shellPath).toLowerCase() === 'wsl.exe'
    const launchWslDistro = isWslShell ? (launchWslContext?.distro ?? null) : null
    const finalEnv = this.opts.buildSpawnEnv
      ? this.opts.buildSpawnEnv(id, spawnEnv, {
          command: args.command,
          launchAgent: args.launchAgent,
          codexHomePathOverride: args.codexHomePathOverride,
          cwd,
          shellPath,
          isWsl: isWslShell,
          wslDistro: launchWslDistro
        })
      : spawnEnv
    // Why: app-level env hooks can re-add scrubbed vars; delete last so shims like Claude Agent Teams keep their PATH.
    for (const key of args.envToDelete ?? []) {
      delete finalEnv[key]
    }
    if (args.env?.TERM) {
      finalEnv.TERM = args.env.TERM
    }
    if (process.platform === 'win32') {
      const codexHomeWslInfo = finalEnv.CODEX_HOME ? parseWslPath(finalEnv.CODEX_HOME) : null
      if (pathWin32.basename(shellPath).toLowerCase() === 'wsl.exe') {
        if (codexHomeWslInfo) {
          if (launchWslDistro && launchWslDistro !== codexHomeWslInfo.distro) {
            delete finalEnv.CODEX_HOME
            delete finalEnv.ORCA_CODEX_HOME
          } else {
            finalEnv.CODEX_HOME = codexHomeWslInfo.linuxPath
            finalEnv.ORCA_CODEX_HOME = codexHomeWslInfo.linuxPath
            // Why: wsl.exe only imports non-default env vars named in WSLENV.
            addWslEnvKeys(finalEnv, ['CODEX_HOME', 'ORCA_CODEX_HOME'])
            if (!launchWslDistro) {
              const resolved = resolveWindowsShellLaunchArgs(shellPath, cwd, defaultCwd, {
                distro: codexHomeWslInfo.distro
              })
              shellArgs = resolved.shellArgs
              effectiveCwd = resolved.effectiveCwd
              validationCwd = resolved.validationCwd
              startupCommandDeliveredInShellArgs =
                resolved.startupCommandDeliveredInShellArgs === true
            }
          }
        } else if (isHostCodexHomeForWsl(finalEnv.CODEX_HOME)) {
          // Why: Orca's Codex home is host-local; WSL Codex must use its Linux-side ~/.codex, not a Windows path.
          delete finalEnv.CODEX_HOME
          delete finalEnv.ORCA_CODEX_HOME
        } else if (finalEnv.CODEX_HOME) {
          addWslEnvKeys(finalEnv, ['CODEX_HOME', 'ORCA_CODEX_HOME'])
        }
        if (finalEnv.CLAUDE_CONFIG_DIR) {
          // Why: managed WSL Claude passes a Linux CLAUDE_CONFIG_DIR through wsl.exe; non-default vars need WSLENV import.
          addWslEnvKeys(finalEnv, ['CLAUDE_CONFIG_DIR'])
        }
        if (finalEnv[ORCA_HERMES_STARTUP_QUERY_ENV] !== undefined) {
          // Why: wsl.exe drops custom Windows env vars; the startup wrapper needs this imported inside WSL.
          addWslEnvKeys(finalEnv, [ORCA_HERMES_STARTUP_QUERY_ENV])
        }
      } else if (codexHomeWslInfo || isWslCodexHomeForHost(finalEnv.CODEX_HOME)) {
        // Why: WSL Codex homes are Linux paths Windows can't use; also drop ORCA_CODEX_HOME (shell-ready restores CODEX_HOME from it).
        delete finalEnv.CODEX_HOME
        delete finalEnv.ORCA_CODEX_HOME
      }
    }
    seedPowerlevel10kWizardEnv(finalEnv, { envToDelete: args.envToDelete })
    if (
      finalEnv[POWERLEVEL10K_WIZARD_DISABLE_ENV] !== undefined &&
      process.platform === 'win32' &&
      pathWin32.basename(shellPath).toLowerCase() === 'wsl.exe'
    ) {
      addWslEnvKeys(finalEnv, [POWERLEVEL10K_WIZARD_DISABLE_ENV])
    }
    if (!wslInfo && process.platform !== 'win32') {
      // Why: OpenCode/Codex PATH restoration and OMP's status wrapper need shell-ready code after user startup files run.
      const needsNoMarkerWrapper =
        finalEnv.ORCA_ATTRIBUTION_SHIM_DIR ||
        finalEnv.ORCA_OPENCODE_CONFIG_DIR ||
        finalEnv.ORCA_MIMOCODE_HOME ||
        finalEnv.ORCA_OMP_STATUS_EXTENSION ||
        finalEnv.ORCA_CODEX_HOME ||
        finalEnv.ORCA_AGENT_TEAMS_SHIM_DIR
      const isCodexStartupCommand = startupAgentRecognition?.agent === 'codex'
      let shellLaunch: ReturnType<typeof getShellReadyLaunchConfig> | null = null
      if (args.command && isCodexStartupCommand) {
        const shouldWaitForShellReady = shouldUseShellReadyStartupDelivery({
          command: args.command,
          startupCommandDelivery: args.startupCommandDelivery
        })
        // Why: payload-bearing Codex startup can be lost to rc-file noise; plain Codex stays markerless for startup speed.
        getFallbackShellReadyConfig = (shell) =>
          shouldWaitForShellReady
            ? getShellReadyLaunchConfig(shell)
            : getAttributionShellLaunchConfig(shell)
        shellLaunch = shouldWaitForShellReady
          ? getShellReadyLaunchConfig(shellPath)
          : getAttributionShellLaunchConfig(shellPath)
      } else if (args.command) {
        getFallbackShellReadyConfig = (shell) => getShellReadyLaunchConfig(shell)
        shellLaunch = getShellReadyLaunchConfig(shellPath)
      } else if (needsNoMarkerWrapper) {
        getFallbackShellReadyConfig = (shell) => getAttributionShellLaunchConfig(shell)
        shellLaunch = getAttributionShellLaunchConfig(shellPath)
      } else {
        getFallbackShellReadyConfig = undefined
      }
      if (shellLaunch) {
        Object.assign(finalEnv, shellLaunch.env)
        shellArgs = shellLaunch.args ?? shellArgs
        shellReadyLaunch = args.command ? shellLaunch : null
      }
    }
    promoteAgentTeamsShimPath(finalEnv, args.env?.PATH)

    // Why: worktree-scoped HISTFILE — without it worktrees share one global history (terminal-history-scope-design §7–§10).
    const worktreeId = args.worktreeId
    const historyEnabled = worktreeId && (this.opts.isHistoryEnabled?.() ?? true)
    // Effective shell for history injection: WSL's outer exe is wsl.exe but the inner login shell is bash.
    const isWslTerminal =
      Boolean(wslInfo || worktreeWslContext || preferredWslContext) ||
      pathWin32.basename(shellPath).toLowerCase() === 'wsl.exe'
    const effectiveShellPath = isWslTerminal ? 'bash' : shellPath
    let historyResult: ReturnType<typeof injectHistoryEnv> | null = null
    if (historyEnabled) {
      historyResult = injectHistoryEnv(finalEnv, worktreeId, effectiveShellPath, cwd, {
        wslDistro: launchWslDistro
      })
      logHistoryInjection(worktreeId, historyResult)
    }

    await prepareLocalPtySpawn(id)
    if (args.signal?.aborted) {
      throw new Error('client_disconnected')
    }
    // Why: another same-id request can win while this one awaits preflight; attach before launching a redundant shell.
    const concurrentWinner = reattachId ? reattachLocalPty(id, args.cols, args.rows) : null
    if (concurrentWinner) {
      return concurrentWinner
    }
    const spawnResult = spawnShellWithFallback({
      shellPath,
      shellArgs,
      cols: args.cols,
      rows: args.rows,
      cwd: effectiveCwd,
      env: finalEnv,
      termName: finalEnv.TERM,
      ptySpawn: pty.spawn,
      getShellReadyConfig: getFallbackShellReadyConfig,
      // Why: on zsh→bash fallback HISTFILE still points to zsh_history; update before spawn so the child inherits it (design doc §8).
      onBeforeFallbackSpawn: historyResult?.histFile
        ? (env, fallbackShell) => updateHistFileForFallback(env, fallbackShell)
        : undefined,
      windowsFallbackAttempts
    })
    args.onPtySpawnCommitted?.()
    shellPath = spawnResult.shellPath
    // Why: a Windows fallback embeds its startup command in argv; honor the winning shell's delivery flag to avoid a double write.
    if (spawnResult.startupCommandDeliveredInShellArgs !== undefined) {
      startupCommandDeliveredInShellArgs = spawnResult.startupCommandDeliveredInShellArgs
    }
    if (args.command && getFallbackShellReadyConfig) {
      shellReadyLaunch = getFallbackShellReadyConfig(shellPath)
    }

    if (process.platform !== 'win32') {
      finalEnv.SHELL = shellPath
    }

    const proc = spawnResult.process
    const spawnedShellIsWsl =
      process.platform === 'win32' && pathWin32.basename(shellPath).toLowerCase() === 'wsl.exe'
    const spawnedWslDistro = spawnedShellIsWsl
      ? (launchWslDistro ?? undefined)
      : process.platform === 'win32'
        ? null
        : undefined
    createPtyPhysicalExit(id)
    ptyProcesses.set(id, proc)
    ptyInitialCwd.set(id, cwd)
    if (spawnedWslDistro !== undefined) {
      ptyWslDistroById.set(id, spawnedWslDistro)
    }
    // Why both: launchAgent is explicit intent that survives command rewrites; recognition catches bare agent command lines.
    if (args.launchAgent || startupAgentRecognition) {
      ptyAgentSessionIds.add(id)
    }
    ptyShellName.set(id, getSpawnedShellName(shellPath))
    if (finalEnv.ORCA_TERMINAL_HANDLE) {
      ptyTerminalHandle.set(id, finalEnv.ORCA_TERMINAL_HANDLE)
    }
    if (args.worktreeId) {
      ptyWorktreeId.set(id, args.worktreeId)
    }
    ptyAgentForegroundContextPaths.set(
      id,
      getAgentForegroundContextPaths({ cwd: args.cwd, worktreeId: args.worktreeId })
    )
    ptyLoadGeneration.set(id, loadGeneration)
    ptyIncarnations.set(id, incarnationId)
    this.opts.onSpawned?.(id, incarnationId)

    const emitIngressData = (emission: PtyIngressEmission): void => {
      const sequenceChars = emission.rawEndSeq - emission.rawStartSeq
      if (emission.transformed || sequenceChars !== emission.data.length) {
        this.opts.onData?.(id, incarnationId, emission.data, Date.now(), sequenceChars, true)
      } else {
        this.opts.onData?.(id, incarnationId, emission.data, Date.now())
      }
      for (const cb of dataListeners) {
        cb(
          emission.transformed || sequenceChars !== emission.data.length
            ? {
                id,
                incarnationId,
                data: emission.data,
                sequenceChars,
                seq: emission.rawEndSeq,
                transformed: true
              }
            : { id, incarnationId, data: emission.data }
        )
      }
    }
    const startupIngress = new PtyStartupIngress({
      ...(args.startupIngress ? { intent: args.startupIngress } : {}),
      ownerBackend: resolvePtyOwnerBackend({
        platform: process.platform,
        shellPath,
        wslDistro: spawnedWslDistro
      }),
      write: (data) => proc.write(data),
      onEmission: emitIngressData
    })
    startupIngressByPty.set(id, startupIngress)

    // Shell-ready startup command support
    let resolveShellReady: ((signal: ShellReadySignal) => void) | null = null
    let shellReadyTimeout: ReturnType<typeof setTimeout> | null = null
    const shellReadyScanState = shellReadyLaunch?.supportsReadyMarker
      ? createShellReadyScanState()
      : null
    const shellReadyPromise = args.command
      ? new Promise<ShellReadySignal>((resolve) => {
          resolveShellReady = resolve
        })
      : Promise.resolve({ postMarkerBytesObserved: false })
    const finishShellReady = (signal: ShellReadySignal): void => {
      if (!resolveShellReady) {
        return
      }
      if (shellReadyTimeout) {
        clearTimeout(shellReadyTimeout)
        shellReadyTimeout = null
      }
      const resolve = resolveShellReady
      resolveShellReady = null
      resolve(signal)
    }
    const releaseHeldShellReadyBytes = (): void => {
      if (!shellReadyScanState) {
        return
      }
      const heldBytes = drainShellReadyHeldBytes(shellReadyScanState)
      if (heldBytes.length === 0) {
        return
      }
      startupIngress.accept(heldBytes)
    }
    if (args.command) {
      if (shellReadyLaunch?.supportsReadyMarker) {
        shellReadyTimeout = setTimeout(() => {
          releaseHeldShellReadyBytes()
          finishShellReady({ postMarkerBytesObserved: false })
        }, STARTUP_COMMAND_READY_MAX_WAIT_MS)
      } else {
        finishShellReady({ postMarkerBytesObserved: false })
      }
    }
    let startupCommandCleanup: (() => void) | null = null
    if (args.command) {
      ptyCleanupCallbacks.set(id, () => {
        if (shellReadyTimeout) {
          clearTimeout(shellReadyTimeout)
          shellReadyTimeout = null
        }
        releaseHeldShellReadyBytes()
        startupCommandCleanup?.()
        startupCommandCleanup = null
        resolveShellReady = null
      })
    }

    const disposables: { dispose: () => void }[] = []
    const onDataDisposable = proc.onData((rawData) => {
      let data = rawData
      if (shellReadyScanState && resolveShellReady) {
        const scanned = scanForShellReady(shellReadyScanState, rawData)
        data = scanned.output
        if (scanned.matched) {
          finishShellReady({ postMarkerBytesObserved: scanned.postMarkerBytesObserved })
        }
      }
      startupIngress.accept(data)
    })
    if (onDataDisposable) {
      disposables.push(onDataDisposable)
    }

    const onExitDisposable = proc.onExit(({ exitCode }) => {
      const wasTerminationRequested = ptyTerminationMode.has(id)
      ptyPhysicalExits.get(id)?.markExited()
      // Why: neutralize proc.kill before destroy — node-pty SIGHUPs on socket 'close', which can race here and signal a reaped/recycled pid.
      if (process.platform !== 'win32') {
        ;(proc as unknown as { kill: (sig?: string) => void }).kill = () => {}
      }
      if (shellReadyTimeout) {
        clearTimeout(shellReadyTimeout)
        shellReadyTimeout = null
      }
      startupCommandCleanup?.()
      clearPtyState(id)
      startupIngress.drainAndClose()
      startupIngressByPty.delete(id)
      // Why: release the master ptmx fd on natural exit, else a clean exit leaks the fd until GC. See docs/fix-pty-fd-leak.md.
      destroyPtyProcess(proc, { alreadyKilled: wasTerminationRequested })
      this.opts.onExit?.(id, exitCode, incarnationId)
      for (const cb of exitListeners) {
        cb({ id, code: exitCode, incarnationId })
      }
    })
    if (onExitDisposable) {
      ptyExitDisposables.set(id, onExitDisposable)
    }
    ptyDisposables.set(id, disposables)

    if (args.command && !startupCommandDeliveredInShellArgs) {
      // Why: only POSIX bash/zsh have bracketed-paste armed so multiline startup prompts paste literally; others use raw submit.
      const spawnedShellName = getSpawnedShellName(shellPath).toLowerCase()
      const bracketedPasteSafe =
        process.platform !== 'win32' && (spawnedShellName === 'bash' || spawnedShellName === 'zsh')
      writeStartupCommandWhenShellReady(
        shellReadyPromise,
        proc,
        args.command,
        (cleanup) => {
          startupCommandCleanup = cleanup
        },
        { bracketedPasteSafe }
      )
    }

    // Why: publish the OS pid for the memory collector; proc.pid can be briefly 0/undefined before node-pty sees the child.
    const rawPid = proc.pid
    const pid = typeof rawPid === 'number' && Number.isFinite(rawPid) && rawPid > 0 ? rawPid : null
    return {
      id,
      incarnationId,
      pid,
      ...(spawnedWslDistro !== undefined ? { wslDistro: spawnedWslDistro } : {})
    }
  }

}

