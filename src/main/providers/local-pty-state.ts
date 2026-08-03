import { basename, delimiter, win32 as pathWin32 } from 'node:path'
import type * as pty from 'node-pty'
import { parseWslPath } from '../wsl'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree-id'
import type { PtySpawnResult } from './types'
import { prepareMacosTccLoginShell } from './macos-tcc-login-shell'
import { forceKillPosixPtyProcessGroups } from '../pty/posix-pty-process-groups'
import { resolveSafePtyDefaultCwd } from './pty-default-cwd'
import { PhysicalExitTracker } from '../../shared/physical-exit-tracker'
import type { PtyStartupIngress } from '../../shared/pty-startup-ingress'

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

let loadGeneration = 0
export const ptyLoadGeneration = new Map<string, number>()

export function getLocalPtyGeneration(): number {
  return loadGeneration
}

export function advanceLocalPtyGeneration(): number {
  return ++loadGeneration
}

export function resetLocalPtyGeneration(): void {
  loadGeneration = 0
}

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

export function waitForPtyPhysicalExit(
  id: string,
  physicalExit?: PhysicalExitTracker
): Promise<void> {
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

export async function prepareLocalPtySpawn(id: string): Promise<void> {
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
export function normalizeForegroundProcessName(
  processName: string | null | undefined
): string | null {
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
