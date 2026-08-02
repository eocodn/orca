import * as pty from 'node-pty'
import { statSync } from 'node:fs'
import { delimiter, win32 as pathWin32 } from 'node:path'
import { DaemonProtocolError } from './types'
import {
  ensureNodePtySpawnHelperExecutable,
  getNodePtySpawnHelperCandidates,
  validateWorkingDirectory
} from '../providers/local-pty-utils'
import { wrapShellSpawnForMacosTccAttribution } from '../providers/macos-tcc-login-shell'
import type { WindowsShellSpawnAttempt } from '../providers/windows-shell-fallback-chain'
import {
  gitCredentialPromptGuardEnv,
  mergeGitConfigEnvProtocol
} from '../../shared/git-credential-prompt-env'
import { TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV } from '../../shared/terminal-git-credential-guard'
import { recognizeAgentProcess } from '../../shared/agent-process-recognition'
import { shouldInspectOuterWrapperForegroundProcess } from '../../shared/foreground-wrapper-agent'
import type { StartupCommandDelivery } from '../../shared/codex-startup-delivery'
import { resolveSafePtyDefaultCwd } from '../providers/pty-default-cwd'
import type { TuiAgent } from '../../shared/types'
import { buildWindowsPowerShellSpawnAttempts } from '../providers/windows-shell-fallback-chain'

const PANE_IDENTITY_ENV_KEYS = [
  'ORCA_PANE_KEY',
  'ORCA_TAB_ID',
  'ORCA_WORKTREE_ID',
  'ORCA_AGENT_LAUNCH_TOKEN'
] as const
export const FOREGROUND_AGENT_CACHE_TTL_MS = 1000
export const SHELL_FOREGROUND_REFRESH_RETRY_MS = 5_000
// Why: a Windows refresh forks a heavy powershell.exe CIM scan (~10-40x POSIX `ps`); idle shells retry slower, output re-arms the fast retry.
export const WINDOWS_IDLE_SHELL_FOREGROUND_REFRESH_RETRY_MS = 15_000
export const SHELL_FOREGROUND_OUTPUT_HOT_WINDOW_MS = 10_000
export const STARTUP_AGENT_FOREGROUND_BOOTSTRAP_MS = 5_000
const PTY_SPAWN_HEALTH_TIMEOUT_MS = 4_000
// Why: retry once so a transient slow spawn doesn't route every terminal to the local fallback, losing daemon persistence.
const PTY_SPAWN_HEALTH_RETRY_ATTEMPTS = 2
export const PENDING_PRE_LISTENER_DATA_MAX_CHARS = 512 * 1024

export function shouldInspectOuterWrapperFallback(processName: string | null): boolean {
  const recognized = recognizeAgentProcess(processName)
  return recognized !== null && shouldInspectOuterWrapperForegroundProcess(recognized)
}

export function composeGuardedDaemonGitConfigEnv(
  env: Record<string, string>,
  explicitEnv: Record<string, string> | undefined,
  launchAgent: TuiAgent | undefined
): void {
  const policy = explicitEnv?.[TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV]
  delete env[TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV]
  if (policy !== 'guard' && launchAgent === undefined) {
    return
  }
  // Why: the daemon can outlive Electron, so its process.env is the authoritative inherited config; append only the guard.
  Object.assign(env, gitCredentialPromptGuardEnv(env, process.platform))
}

export type PtySubprocessOptions = {
  sessionId: string
  cols: number
  rows: number
  cwd?: string
  env?: Record<string, string>
  envToDelete?: string[]
  command?: string
  startupCommandDelivery?: StartupCommandDelivery
  launchAgent?: TuiAgent
  /** Explicit shell executable path/basename the renderer asked for.
   *  Overrides env.COMSPEC / env.SHELL resolution inside the daemon so a user
   *  who picks "New WSL terminal" from the "+" menu actually gets WSL. */
  shellOverride?: string
  terminalWindowsWslDistro?: string | null
  terminalWindowsPowerShellImplementation?: 'auto' | 'powershell.exe' | 'pwsh.exe'
}

export function deleteRequestedDaemonEnvKeys(
  env: Record<string, string>,
  keys: readonly string[] | undefined
): void {
  // Why: the persistent daemon's inherited env can differ from Electron's.
  // Compare ownership here so real-home routing neither leaks an Orca overlay
  // nor deletes a user-owned CODEX_HOME chosen by the daemon's host context.
  const deleteOrcaOwnedCodexHome =
    keys?.includes('ORCA_CODEX_HOME') === true &&
    env.ORCA_CODEX_HOME !== undefined &&
    env.CODEX_HOME === env.ORCA_CODEX_HOME
  for (const key of keys ?? []) {
    delete env[key]
  }
  if (deleteOrcaOwnedCodexHome) {
    delete env.CODEX_HOME
  }
}

/**
 * Returns a stable default working directory for daemon-spawned PTYs.
 */
export function getDefaultCwd(): string {
  return resolveSafePtyDefaultCwd()
}

/**
 * Removes pane identity inherited from the daemon parent unless explicitly set.
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
 * Removes stale development hook endpoints inherited by daemon children.
 */
export function removeInheritedDevAgentHookEndpoint(
  env: Record<string, string>,
  explicitEnv: Record<string, string> | undefined
): void {
  if (explicitEnv?.ORCA_AGENT_HOOK_ENV === 'development' && !explicitEnv.ORCA_AGENT_HOOK_ENDPOINT) {
    // Why: strip only stale inherited endpoints; a fresh explicit one is needed by hooks that scrub token-like env vars before exec.
    delete env.ORCA_AGENT_HOOK_ENDPOINT
  }
}

/**
 * Strips Electron's internal run-as-node flag from user shell environments.
 */
export function removeInheritedElectronRunAsNode(env: Record<string, string>): void {
  // Why: user shells must not inherit ELECTRON_RUN_AS_NODE or nested Electron commands run as plain Node.
  delete env.ELECTRON_RUN_AS_NODE
}

/**
 * Formats a daemon preflight failure with the same ENOENT details node-pty exposes.
 */
function formatMissingDaemonPathError(kind: 'helper' | 'cwd', path: string): DaemonProtocolError {
  const detailName = kind === 'helper' ? 'helper' : 'cwd'
  const step = kind === 'helper' ? 'posix_spawn' : 'daemon_cwd'
  return new DaemonProtocolError(
    `Daemon's ${kind === 'helper' ? 'node-pty install' : 'working directory'} is gone ` +
      `(worktree deleted?). Restart Orca. node-pty: ${step} failed: ENOENT ` +
      `(errno 2, No such file or directory) - ${detailName}='${path}'`
  )
}

/**
 * Checks whether a path currently exists and is a directory.
 */
function isExistingDirectory(path: string | undefined): path is string {
  if (!path) {
    return false
  }
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Moves the daemon process to a stable cwd after its original cwd disappears.
 */
function repairDaemonCwd(): string | null {
  const candidates = [process.env.ORCA_USER_DATA_PATH]
  try {
    candidates.push(getDefaultCwd())
  } catch {
    // Keep daemon cwd repair best-effort even when no user terminal cwd is safe.
  }
  candidates.push(process.platform === 'win32' ? 'C:\\' : '/')
  for (const candidate of candidates) {
    if (isExistingDirectory(candidate)) {
      try {
        process.chdir(candidate)
        return candidate
      } catch {
        // Try the next stable cwd candidate.
      }
    }
  }
  return null
}

/**
 * Ensures the daemon cwd is valid before native PTY spawning.
 */
function preflightDaemonCwd(): void {
  let daemonCwd = '<unavailable>'
  try {
    daemonCwd = process.cwd()
    if (isExistingDirectory(daemonCwd)) {
      return
    }
  } catch {
    // Recover below; process.cwd() throws after the original cwd is deleted.
  }

  // Why: if the daemon's launch worktree disappears, node-pty's macOS spawn-helper fails even when the terminal cwd is valid.
  if (repairDaemonCwd()) {
    return
  }
  throw formatMissingDaemonPathError('cwd', daemonCwd)
}

/**
 * Validates macOS node-pty helper availability before spawning terminals.
 */
function preflightMacNodePtySpawnEnvironment(): void {
  if (process.platform !== 'darwin') {
    return
  }

  let candidates: string[]
  try {
    candidates = getNodePtySpawnHelperCandidates()
  } catch {
    throw formatMissingDaemonPathError('helper', '<unresolved>')
  }

  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) {
        return
      }
    } catch {
      // Try the next node-pty native location.
    }
  }

  throw formatMissingDaemonPathError('helper', candidates[0] ?? '<unresolved>')
}

/**
 * Ensures POSIX daemon-owned native PTY spawn prerequisites are still valid.
 */
export function preflightUnixPtySpawnEnvironment(): void {
  if (process.platform === 'win32') {
    return
  }

  // Why: detached daemons can outlive their launch cwd; repair before every spawn so Linux/macOS don't wait for health recovery.
  preflightDaemonCwd()
  preflightMacNodePtySpawnEnvironment()
}

/**
 * Detects native Windows paths that should be validated before spawn.
 */
function isNativeWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

/**
 * Validates explicit native Windows cwd paths before ConPTY launch.
 */
export function preflightWindowsPtySpawnEnvironment(args: {
  validationCwd: string
  cwdWasExplicit: boolean
}): void {
  if (process.platform !== 'win32' || !args.cwdWasExplicit) {
    return
  }

  if (!isNativeWindowsPath(args.validationCwd)) {
    return
  }

  validateWorkingDirectory(args.validationCwd)
}

/**
 * Validates POSIX spawn cwd before node-pty can fail with an opaque ENOENT.
 */
export function preflightPosixPtySpawnEnvironment(validationCwd: string): void {
  if (process.platform === 'win32') {
    return
  }
  validateWorkingDirectory(validationCwd)
}

/**
 * Wraps native PTY spawn failures with shell and cwd context.
 */
export function formatPtySpawnError(err: unknown, shellPath: string, spawnCwd: string): Error {
  const message = err instanceof Error ? err.message : String(err)
  const formatted = new DaemonProtocolError(
    `Daemon failed to spawn shell "${shellPath}" with cwd "${spawnCwd}": ${message}`
  )
  if (err instanceof Error && err.stack) {
    formatted.stack = err.stack
  }
  return formatted
}

/**
 * Runs one short native PTY spawn probe (spawn `/bin/sh -c 'exit 0'`).
 */
function runSinglePtySpawnHealthProbe(): Promise<void> {
  const cwd = isExistingDirectory(process.env.ORCA_USER_DATA_PATH)
    ? process.env.ORCA_USER_DATA_PATH
    : getDefaultCwd()

  let proc: pty.IPty
  try {
    proc = pty.spawn('/bin/sh', ['-c', 'exit 0'], {
      name: 'xterm-256color',
      cols: 2,
      rows: 1,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color'
      }
    })
  } catch (err) {
    throw formatPtySpawnError(err, '/bin/sh', cwd)
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false
    let exitDisposable: { dispose(): void } | undefined
    const finish = (error?: Error, opts?: { kill?: boolean }): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      exitDisposable?.dispose()
      if (opts?.kill) {
        try {
          proc.kill()
        } catch {
          // Best-effort cleanup for a short-lived health probe.
        }
      }
      if (error) {
        reject(error)
        return
      }
      resolve()
    }
    const timer = setTimeout(() => {
      finish(new Error(`PTY spawn health check timed out after ${PTY_SPAWN_HEALTH_TIMEOUT_MS}ms`), {
        kill: true
      })
    }, PTY_SPAWN_HEALTH_TIMEOUT_MS)

    // Why: ping only proves the protocol is alive; a real spawn catches stale node-pty helper paths.
    exitDisposable = proc.onExit(({ exitCode }) => {
      if (exitCode === 0) {
        finish()
        return
      }
      finish(new Error(`PTY spawn health check exited with code ${exitCode}`))
    })
  })
}

/**
 * Runs a short native PTY spawn probe for daemon health checks, retrying once
 * so a transient stall (e.g. a busy machine right after an upgrade) does not
 * mis-classify a healthy daemon as unable to spawn PTYs.
 */
export async function checkPtySpawnHealth(): Promise<void> {
  if (process.platform === 'win32') {
    return
  }

  // Why: a real short-lived spawn catches a deleted cwd or stale native PTY path before panes are routed to a daemon that can't spawn.
  if (process.platform === 'darwin') {
    ensureNodePtySpawnHelperExecutable()
  }
  preflightUnixPtySpawnEnvironment()

  let lastError: unknown
  for (let attempt = 1; attempt <= PTY_SPAWN_HEALTH_RETRY_ATTEMPTS; attempt++) {
    try {
      await runSinglePtySpawnHealthProbe()
      return
    } catch (err) {
      lastError = err
      if (attempt < PTY_SPAWN_HEALTH_RETRY_ATTEMPTS) {
        console.warn(
          `[daemon] PTY spawn health probe attempt ${attempt} failed; retrying`,
          err instanceof Error ? err.message : err
        )
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/**
 * Normalizes node-pty foreground process strings to executable basenames.
 */
function normalizeForegroundProcessName(processName: string | null | undefined): string | null {
  const trimmed = processName?.trim().replace(/^["']|["']$/g, '') ?? ''
  if (!trimmed || trimmed === 'xterm-256color') {
    return null
  }
  return trimmed.split(/[\\/]/).pop() || null
}

/**
 * Falls back to the spawned Windows shell when node-pty reports a terminal name.
 */
export function resolveFallbackForegroundProcess(
  processName: string | null | undefined,
  shellPath: string
): string | null {
  const normalized = normalizeForegroundProcessName(processName)
  if (normalized || process.platform !== 'win32') {
    return normalized
  }
  // Why: Windows node-pty can report the terminal name instead of the shell; fall back to the spawned shell.
  return normalizeForegroundProcessName(pathWin32.basename(shellPath))
}

/**
 * Spawns the daemon PTY, walking the Windows PowerShell -> cmd.exe fallback
 * chain when ConPTY rejects the primary shell with ERROR_ACCESS_DENIED.
 *
 * Why: the daemon has no LocalPtyProvider, so it owns its chain walk; later attempts recompute args so the cmd.exe fallback still gets `chcp 65001`.
 */
export function spawnDaemonPtyWithWindowsFallback(args: {
  shellPath: string
  shellArgs: string[]
  spawnCwd: string
  env: Record<string, string>
  cols: number
  rows: number
  windowsFallbackAttempts: WindowsShellSpawnAttempt[]
}): {
  process: pty.IPty
  shellPath: string
  spawnCwd: string
  startupCommandDeliveredInShellArgs?: boolean
} {
  const spawnAt = (shellPath: string, shellArgs: string[], cwd: string): pty.IPty => {
    const wrapped = wrapShellSpawnForMacosTccAttribution(shellPath, shellArgs, args.env)
    return pty.spawn(wrapped.file, wrapped.args, {
      name: args.env.TERM ?? 'xterm-256color',
      cols: args.cols,
      rows: args.rows,
      cwd,
      env: args.env,
      // Why: legacy system ConPTY can corrupt full-width TUI rows in scrollback; bundled ConPTY has the wrap-marker behavior xterm expects.
      ...(process.platform === 'win32' ? { useConptyDll: true } : {})
    })
  }

  try {
    return {
      process: spawnAt(args.shellPath, args.shellArgs, args.spawnCwd),
      shellPath: args.shellPath,
      spawnCwd: args.spawnCwd
    }
  } catch (primaryErr) {
    if (process.platform !== 'win32') {
      throw primaryErr
    }
    // Skip the first entry: it is the primary that already failed above.
    for (const attempt of args.windowsFallbackAttempts.slice(1)) {
      try {
        const process = spawnAt(attempt.shellPath, attempt.shellArgs, attempt.effectiveCwd)
        const message = primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
        console.warn(
          `[daemon/pty] Primary shell "${args.shellPath}" failed (${message}), fell back to "${attempt.shellPath}"`
        )
        return {
          process,
          shellPath: attempt.shellPath,
          spawnCwd: attempt.effectiveCwd,
          startupCommandDeliveredInShellArgs: attempt.startupCommandDeliveredInShellArgs
        }
      } catch {
        // This fallback shell also failed -- try the next link in the chain.
      }
    }
    throw primaryErr
  }
}

/**
 * Spawns the daemon-owned PTY subprocess for a terminal session.
 *
 * The returned handle records whether the startup command was already embedded
 * in Windows shell args so the daemon host does not write it a second time.
 */
