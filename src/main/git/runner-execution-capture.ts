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
import { GIT_OUTPUT_LOCALE_SHELL_PREFIX,
  DEFAULT_GIT_MAX_BUFFER,
  type GitExecOptions,
  type CommandExecOptions,
  isMissingCommandError,
  hasPathSeparator,
  shouldRetryWindowsCommandShim,
  createAbortError,
  WINDOWS_TREE_KILL_WAIT_MS,
  killSpawnedCommandTree,
  type ExecFileCaptureOptions,
  emptyExecFileOutput,
  isExecFileResultObject,
  execFileCapture,
  spawnCommandCapture } from './runner-execution-foundation'
import { resolveCommand } from './runner-command-resolution'

export function gitOptionalLocksDisabledEnv(
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return {
    ...env,
    GIT_OPTIONAL_LOCKS: '0'
  }
}

/**
 * Append git config via the GIT_CONFIG_COUNT/KEY_n/VALUE_n env protocol (git >= 2.31),
 * composing with any count already in `env` so we never clobber a caller's config.
 */
export { appendGitConfigEnv }

/**
 * Pin Orca-spawned git to untranslated English output so stderr/progress parsers
 * work under any user locale (issue #7808). Terminal git is untouched.
 */
export function untranslatedGitOutputEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, ...UNTRANSLATED_GIT_OUTPUT_ENV }
}

export function promptGuardGitEnv(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  return gitCredentialPromptGuardEnv(untranslatedGitOutputEnv(env), platform)
}

/**
 * Credential-prompt guard for a general-purpose shell (PTYs, hook scripts):
 * like promptGuardGitEnv but without the issue-7808 locale pins, which would
 * change the locale of every child process, not just git's.
 */
export function promptGuardShellEnv(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  return gitCredentialPromptGuardEnv(env, platform)
}

/**
 * Force git non-interactive so it fails fast instead of hanging on a prompt with
 * no terminal to answer it; on headless `serve` those stuck calls wedge every
 * client (issue #5308).
 *
 * - GIT_TERMINAL_PROMPT=0: git errors instead of prompting for credentials.
 * - GIT_ASKPASS / SSH_ASKPASS: emptied when unset so no GUI helper blocks; a
 *   caller-provided askpass is preserved (custom setups serve creds non-interactively).
 * - GIT_SSH_COMMAND BatchMode=yes: SSH errors instead of prompting (doesn't change
 *   host trust); only added when the caller hasn't set its own.
 */
export function nonInteractiveGitEnv(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const next = promptGuardGitEnv(env, platform)
  if (!next.GIT_SSH_COMMAND) {
    next.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes'
    if (platform === 'win32') {
      // Why: forward GIT_SSH_COMMAND to WSL only when we set it — a caller's Windows-specific value must not leak into Linux git.
      addWslEnvKeys(next, ['GIT_SSH_COMMAND'])
    }
  }
  return next
}

export type GitSshPolicyMode =
  | 'default'
  | 'explicit-env'
  | 'fallback'
  | 'configured-openssh'
  | 'configured-wrapper-passthrough'

export const CORE_SSH_COMMAND_PROBE_TIMEOUT_MS = 2500

export function commandBasename(command: string): string {
  const pieces = command.split(/[\\/]+/)
  return pieces.at(-1)?.toLowerCase() ?? command.toLowerCase()
}

export function isMergeableOpenSshCommand(command: string): boolean {
  const basename = commandBasename(command)
  return basename === 'ssh' || basename === 'ssh.exe'
}

export function shellTokenize(command: string): string[] | null {
  const tokens: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null
  let escaped = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      const next = command[i + 1]
      if (next && /[\s'"\\]/.test(next)) {
        escaped = true
      } else {
        current += char
      }
      continue
    }
    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    if (';&|<>()`'.includes(char)) {
      return null
    }
    current += char
  }

  if (escaped || quote) {
    return null
  }
  if (current) {
    tokens.push(current)
  }
  return tokens
}

export function shellQuoteToken(token: string): string {
  return /^[A-Za-z0-9_@%+=:,./~-]+$/.test(token) ? token : quotePosixShell(token)
}

export function containsShellExpansionSyntax(command: string): boolean {
  return command.includes('$')
}

export function withoutBatchModeOptions(tokens: string[]): string[] {
  const next: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const lower = token.toLowerCase()
    if (lower === '-o') {
      const option = tokens[i + 1]?.toLowerCase()
      if (option?.startsWith('batchmode')) {
        i += 1
        continue
      }
    }
    if (lower.startsWith('-obatchmode')) {
      continue
    }
    next.push(token)
  }
  return next
}

export function buildOpenSshBatchModeCommand(configuredCommand: string): string | null {
  if (containsShellExpansionSyntax(configuredCommand)) {
    return null
  }
  const tokens = shellTokenize(configuredCommand)
  if (!tokens || tokens.length === 0 || !isMergeableOpenSshCommand(tokens[0])) {
    return null
  }
  return [...withoutBatchModeOptions(tokens), '-o', 'BatchMode=yes'].map(shellQuoteToken).join(' ')
}

export async function buildNetworkSshPolicyEnv(options: GitExecOptions): Promise<{
  env: NodeJS.ProcessEnv
  mode: GitSshPolicyMode
}> {
  const promptEnv = promptGuardGitEnv(options.env)
  if (promptEnv.GIT_SSH_COMMAND) {
    return { env: promptEnv, mode: 'explicit-env' }
  }

  const resolved = resolveCommand(
    'git',
    ['config', '--get', 'core.sshCommand'],
    options.cwd,
    options.wslDistro,
    { useWslLoginShell: Boolean(options.wslDistro) }
  )
  let configuredCommand = ''
  try {
    const { stdout } = await execFileCapture(resolved.binary, resolved.args, {
      cwd: resolved.cwd,
      encoding: 'utf-8',
      maxBuffer: DEFAULT_GIT_MAX_BUFFER,
      timeout: CORE_SSH_COMMAND_PROBE_TIMEOUT_MS,
      env: promptEnv,
      signal: options.signal
    })
    configuredCommand = String(stdout).trim()
  } catch {
    configuredCommand = ''
  }

  if (!configuredCommand) {
    const env = { ...promptEnv, GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }
    // Why: WSL routing can come from either an explicit distro or a UNC cwd.
    if (resolved.wsl) {
      addWslEnvKeys(env, ['GIT_SSH_COMMAND'])
    }
    return { env, mode: 'fallback' }
  }

  const batchModeCommand = buildOpenSshBatchModeCommand(configuredCommand)
  if (!batchModeCommand) {
    // Why: custom SSH wrappers are user policy; rewriting their argv is riskier than relying on prompt guards + timeout.
    return { env: promptEnv, mode: 'configured-wrapper-passthrough' }
  }

  const env = { ...promptEnv, GIT_SSH_COMMAND: batchModeCommand }
  if (resolved.wsl) {
    addWslEnvKeys(env, ['GIT_SSH_COMMAND'])
  }
  return { env, mode: 'configured-openssh' }
}

/**
 * Async git command execution. Drop-in replacement for
 * `execFileAsync('git', args, { cwd, encoding, ... })`.
 */
export async function gitExecFileAsync(
  args: string[],
  options: GitExecOptions
): Promise<{ stdout: string; stderr: string }> {
  // Why: span the user-visible `git <subcommand>` form, not the resolved binary, so dashboards group by intent.
  return withGitSpan(
    { args, ...(options.cwd !== undefined ? { cwd: options.cwd } : {}) },
    async () => {
      const resolved = resolveCommand('git', args, options.cwd, options.wslDistro, {
        useWslLoginShell: Boolean(options.wslDistro)
      })
      const policy = options.useConfiguredSshCommandForNetwork
        ? await buildNetworkSshPolicyEnv(options)
        : { env: nonInteractiveGitEnv(options.env), mode: 'default' as const }
      let result: { stdout: string | Buffer; stderr: string | Buffer }
      try {
        result = await execFileCapture(resolved.binary, resolved.args, {
          cwd: resolved.cwd,
          encoding: (options.encoding ?? 'utf-8') as BufferEncoding,
          maxBuffer: options.maxBuffer,
          timeout: options.timeout,
          stdin: options.stdin,
          // Why: never let a git read-path call block on an interactive prompt (issue #5308) — fail fast.
          env: policy.env,
          signal: options.signal
        })
      } catch (error) {
        if (options.useConfiguredSshCommandForNetwork && error && typeof error === 'object') {
          Object.assign(error, { gitSshPolicyMode: policy.mode })
        }
        throw error
      }
      const { stdout, stderr } = result
      return { stdout: stdout as string, stderr: stderr as string }
    }
  )
}

/**
 * Async command execution with the same WSL cwd translation as repo-scoped git.
 * Keep this for fixed binary+argv call sites; never pass shell fragments.
 */
export async function commandExecFileAsync(
  command: string,
  args: string[],
  options: CommandExecOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const { wslDistro, ...execOptions } = options
  const resolved = resolveCommand(command, args, options.cwd, wslDistro)
  const binary =
    resolved.wsl === null ? resolveWindowsCommand(resolved.binary, options.env) : resolved.binary
  if (isWindowsBatchScript(binary)) {
    return spawnCommandCapture(binary, resolved.args, {
      ...execOptions,
      cwd: resolved.cwd
    })
  }
  try {
    const { stdout, stderr } = await execFileCapture(binary, resolved.args, {
      cwd: resolved.cwd,
      encoding: execOptions.encoding ?? 'utf-8',
      maxBuffer: execOptions.maxBuffer,
      timeout: execOptions.timeout,
      env: execOptions.env,
      signal: execOptions.signal
    })
    return { stdout: stdout as string, stderr: stderr as string }
  } catch (error) {
    if (shouldRetryWindowsCommandShim(error, resolved)) {
      return spawnCommandCapture(
        resolveWindowsCommand(`${resolved.binary}.cmd`, options.env),
        resolved.args,
        {
          ...execOptions,
          cwd: resolved.cwd
        }
      )
    }
    throw error
  }
}

/**
 * Async git command execution that returns a Buffer.
 * Used for reading binary blobs (git show).
 */
export async function gitExecFileAsyncBuffer(
  args: string[],
  options: { cwd: string; maxBuffer?: number; wslDistro?: string }
): Promise<{ stdout: Buffer }> {
  const resolved = resolveCommand('git', args, options.cwd, options.wslDistro, {
    useWslLoginShell: Boolean(options.wslDistro)
  })
  const { stdout } = (await execFileCapture(resolved.binary, resolved.args, {
    cwd: resolved.cwd,
    encoding: 'buffer',
    maxBuffer: options.maxBuffer,
    env: untranslatedGitOutputEnv()
  })) as { stdout: Buffer }
  return { stdout }
}

/** Result of a streamed git command; `stoppedEarly` is true when onStdout asked to stop before the child exited. */
export type GitStreamResult = { stoppedEarly: boolean }
