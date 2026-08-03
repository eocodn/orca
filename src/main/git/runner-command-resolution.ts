/**
 * Centralized git/gh/command runner with transparent WSL support.
 *
 * Why: when a repo lives on a WSL filesystem, native Windows binaries (git.exe,
 * gh.exe, rg.exe) are absent or slow, so this routes execution through
 * `wsl.exe -d <distro>` with translated Linux paths.
 */
import {
  execFile,
  execFileSync,
  spawn,
  type ChildProcess,
  type ExecFileOptions,
  type SpawnOptions
} from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { withGitSpan } from '../observability/instrumentation'
import { recordSubprocessSpawn } from '../diagnostics/main-thread-churn-probe'
import {
  classifyGhRateLimitBucket,
  createGhRateLimitBlockedError,
  getGhRateLimitBlockedUntilMs,
  ghRateLimitScopeKey,
  isGhPrimaryRateLimitStderr,
  isGhRateLimitProbe,
  notifyGhPrimaryRateLimit,
  type GhRateLimitBucket
} from './gh-rate-limit-breaker'
import { getDefaultWslDistro, parseWslPath, toWindowsWslPath, type WslPathInfo } from '../wsl'
import { addWslEnvKeys } from '../wsl-env'
import {
  appendGitConfigEnv,
  gitCredentialPromptGuardEnv
} from '../../shared/git-credential-prompt-env'
import { getSpawnArgsForWindows, isWindowsBatchScript, resolveWindowsCommand } from '../win32-utils'
import {
  buildWslLoginShellCommand,
  escapeWslShCommandForWindows,
  quotePosixShell
} from '../../shared/wsl-login-shell-command'
import { UNTRANSLATED_GIT_OUTPUT_ENV } from '../../shared/git-output-locale'
import { endSubprocessStdin } from '../../shared/subprocess-stdin-write'
// Re-exported for existing importers; lightweight consumers should import from './exec-error' to avoid this heavy module.
import { extractExecError, parseRetryAfterMs } from './exec-error'
// ─── Core resolution ────────────────────────────────────────────────

// Env-assignment prefix for WSL-routed git, where spawn env can't cross the wsl.exe boundary; values are shell-safe unquoted.
const GIT_OUTPUT_LOCALE_SHELL_PREFIX = Object.entries(UNTRANSLATED_GIT_OUTPUT_ENV)
  .map(([key, value]) => `${key}=${value}`)
  .join(' ')
type ResolvedCommand = {
  binary: string
  args: string[]
  cwd: string | undefined
  /** Non-null when the command was routed through WSL. */
  wsl: WslPathInfo | null
}

/**
 * Translate Windows-style path arguments to Linux paths for commands run in WSL.
 *
 * Why: callers pass Windows paths as git arguments, which WSL git can't read.
 * UNC paths (\\wsl.localhost\…) become native Linux; drive paths (C:\…) → /mnt/c/…
 */
function translateArgsForWsl(args: string[]): string[] {
  return args.map(translateArgForWsl)
}

function translateArgForWsl(arg: string): string {
  // WSL UNC path → native linux path
  const wslInfo = parseWslPath(arg)
  if (wslInfo) {
    return wslInfo.linuxPath
  }

  // Windows drive path (e.g. C:\Users\...) → /mnt/c/Users/...
  const driveMatch = arg.match(/^([A-Za-z]):[/\\](.*)$/)
  if (driveMatch) {
    const driveLetter = driveMatch[1].toLowerCase()
    const rest = driveMatch[2].replace(/\\/g, '/')
    return `/mnt/${driveLetter}/${rest}`
  }

  return arg
}

function hasExplicitRepoArg(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    if (
      (args[i] === '--repo' || args[i] === '-R') &&
      typeof args[i + 1] === 'string' &&
      args[i + 1].trim()
    ) {
      return true
    }
    if (args[i].startsWith('--repo=') || args[i].startsWith('-R=')) {
      return args[i].slice(args[i].indexOf('=') + 1).trim().length > 0
    }
    if (args[i].startsWith('-R') && args[i].length > 2) {
      return args[i].slice(2).trim().length > 0
    }
  }
  return false
}

function argsUseGhApiPlaceholders(args: string[]): boolean {
  return args.some(
    (arg) => arg.includes('{owner}') || arg.includes('{repo}') || arg.includes('{branch}')
  )
}

function hasExplicitRepoViewTarget(args: string[]): boolean {
  const target = args[2]
  return (
    args[0] === 'repo' &&
    args[1] === 'view' &&
    typeof target === 'string' &&
    !target.startsWith('-') &&
    target.includes('/')
  )
}

function canRunGitHubCliWithoutRepoCwd(args: string[]): boolean {
  if (hasExplicitRepoArg(args)) {
    return true
  }
  if (args[0] === 'api') {
    return !argsUseGhApiPlaceholders(args)
  }
  return args[0] === 'auth' || hasExplicitRepoViewTarget(args)
}

function isMissingCommandInWsl(stderr: string, command: string): boolean {
  const s = stderr.toLowerCase()
  const c = command.toLowerCase()
  return s.includes(`${c}: command not found`) || s.includes(`${c}: not found`)
}

function canFallBackToHostGitHubCli(
  command: 'gh',
  args: string[],
  resolved: ResolvedCommand,
  stderr: string
): boolean {
  return (
    process.platform === 'win32' &&
    resolved.wsl !== null &&
    isMissingCommandInWsl(stderr, command) &&
    canRunGitHubCliWithoutRepoCwd(args)
  )
}

function resolveHostGitHubCli(command: 'gh', args: string[]): ResolvedCommand {
  return {
    binary: command,
    args,
    // Why: host gh can't use a WSL UNC cwd; we only fall back for commands with explicit repo/API context, so none is needed.
    cwd: undefined,
    wsl: null
  }
}

let defaultWslDistroOverride: string | null = null

// Why: allow host commands fallback to route through the user's pinned WSL distro when host execution fails.
function setDefaultWslDistroOverride(distro: string | null): void {
  defaultWslDistroOverride = distro
}

function resolveDefaultWslCli(command: 'gh' | 'glab', args: string[]): ResolvedCommand | null {
  const distro = defaultWslDistroOverride ?? getDefaultWslDistro()
  return distro ? resolveCommand(command, args, undefined, distro) : null
}

function isHostCommandMissing(err: unknown, command: 'gh' | 'glab'): boolean {
  if (!err || typeof err !== 'object') {
    return false
  }
  const e = err as { code?: unknown; message?: unknown; syscall?: unknown; path?: unknown }
  if (e.code === 'ENOENT') {
    return true
  }
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : ''
  return (
    message.includes('enoent') &&
    (message.includes(command) || e.path === command || e.syscall === 'spawn')
  )
}

/**
 * Resolve whether a command invocation should be routed through wsl.exe.
 *
 * Why `bash -c "cd … && …"` instead of `--cd`: wsl.exe's --cd fails with
 * ERROR_PATH_NOT_FOUND under Node's execFile/spawn in some configs.
 */
function resolveCommand(
  command: string,
  args: string[],
  cwd: string | undefined,
  wslDistroOverride?: string,
  options: { useWslLoginShell?: boolean } = {}
): ResolvedCommand {
  if (process.platform !== 'win32') {
    return { binary: command, args, cwd, wsl: null }
  }

  // Why: global gh callers (rate_limit, listAccessibleProjects) have no cwd to derive a distro from; a distro hint still routes through wsl.exe.
  // TODO(wsl-default-distro): no default-distro setting yet, so override-less global gh callers fall back to host gh.exe (ENOENT on WSL-only installs).
  const cwdWsl = cwd ? parseWslPath(cwd) : null
  const wsl: WslPathInfo | null =
    cwdWsl ?? (wslDistroOverride ? { distro: wslDistroOverride, linuxPath: '' } : null)
  if (!wsl) {
    return { binary: command, args, cwd, wsl: null }
  }

  const translatedArgs = translateArgsForWsl(args)
  // Why: env on wsl.exe stays Windows-side (WSLENV forwards only named vars), so the locale must ride the command string (issue #7808).
  const localePrefix = command === 'git' ? `${GIT_OUTPUT_LOCALE_SHELL_PREFIX} ` : ''
  const escapedCommand = quotePosixShell(command)
  // Why: shell-escape each arg to prevent word splitting / glob expansion inside the bash -c string.
  const escapedArgs = translatedArgs.map(quotePosixShell)
  // Why: prepend `cd <linuxPath> &&` for a UNC cwd; skip it when only a distro override was given (global gh needs no cwd).
  const linuxCwd = cwdWsl?.linuxPath ?? (cwd && wslDistroOverride ? translateArgForWsl(cwd) : null)
  const shellCmd = linuxCwd
    ? `cd ${quotePosixShell(linuxCwd)} && ${localePrefix}${escapedCommand} ${escapedArgs.join(' ')}`
    : `${localePrefix}${escapedCommand} ${escapedArgs.join(' ')}`

  if (options.useWslLoginShell) {
    return {
      binary: 'wsl.exe',
      args: [
        '-d',
        wsl.distro,
        '--',
        'sh',
        '-lc',
        escapeWslShCommandForWindows(buildWslLoginShellCommand(shellCmd))
      ],
      cwd: undefined,
      wsl
    }
  }

  return {
    binary: 'wsl.exe',
    args: ['-d', wsl.distro, '--', 'bash', '-c', shellCmd],
    // Why: the `cd` inside bash -c handles the directory; a UNC cwd on the Node process is redundant and can break Node internals.
    cwd: undefined,
    wsl
  }
}

// ─── Git-specific runners ───────────────────────────────────────────

// Why: execFile disables its cap when maxBuffer is undefined; unbounded output over V8's string max crashes main uncatchably — keep in sync with relay MAX_GIT_BUFFER.

export { translateArgsForWsl, translateArgForWsl, hasExplicitRepoArg, argsUseGhApiPlaceholders, hasExplicitRepoViewTarget, canRunGitHubCliWithoutRepoCwd, isMissingCommandInWsl, canFallBackToHostGitHubCli, resolveHostGitHubCli, defaultWslDistroOverride, setDefaultWslDistroOverride, resolveDefaultWslCli, isHostCommandMissing, resolveCommand }
export { type ResolvedCommand }

