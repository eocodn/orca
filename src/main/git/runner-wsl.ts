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
import { resolveCommand } from './runner-command-resolution'
function wslAwareSpawn(
  command: string,
  args: string[],
  options: SpawnOptions & { cwd?: string; wslDistro?: string; useWslLoginShell?: boolean }
): ChildProcess {
  const { wslDistro, useWslLoginShell, ...spawnOptions } = options
  const resolved = resolveCommand(command, args, options.cwd, wslDistro, {
    useWslLoginShell
  })
  const spawnStartedAt = performance.now()
  const child = spawn(resolved.binary, resolved.args, {
    ...spawnOptions,
    cwd: resolved.cwd
  })
  recordSubprocessSpawn(resolved.binary, resolved.args, performance.now() - spawnStartedAt)
  return child
}

// ─── Path translation helpers ───────────────────────────────────────

/**
 * Translate absolute Linux paths in git output back to Windows UNC paths.
 * Why: git-in-WSL emits Linux-native paths, but Orca reads files via Node fs, which needs Windows UNC.
 */
function translateWslOutputPaths(
  output: string,
  originalCwd: string,
  options: { wslDistro?: string } = {}
): string {
  const wsl = parseWslPath(originalCwd)
  const distro = wsl?.distro ?? options.wslDistro
  if (!distro) {
    return output
  }

  // Rewrite absolute Linux paths in structured git output (e.g. "worktree /home/user/repo/feature") to Windows UNC.
  return output.replace(/(?<=worktree )(\/.+)$/gm, (_match, linuxPath: string) =>
    toWindowsWslPath(linuxPath, distro)
  )
}

/** Convenience re-export of wsl.ts path helpers so consumers don't import it directly. */
export { parseWslPath, toLinuxPath, toWindowsWslPath, isWslPath } from '../wsl'

export { wslAwareSpawn, translateWslOutputPaths }

