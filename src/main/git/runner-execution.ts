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
import { type ResolvedCommand, resolveCommand } from './runner-command-resolution'
const DEFAULT_GIT_MAX_BUFFER = 10 * 1024 * 1024

type GitExecOptions = {
  cwd: string
  encoding?: BufferEncoding | 'buffer'
  maxBuffer?: number
  timeout?: number
  stdin?: string
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  wslDistro?: string
  useConfiguredSshCommandForNetwork?: boolean
}

type CommandExecOptions = {
  cwd?: string
  encoding?: BufferEncoding
  maxBuffer?: number
  timeout?: number
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  wslDistro?: string
}

function isMissingCommandError(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT'
  )
}

function hasPathSeparator(command: string): boolean {
  return command.includes('/') || command.includes('\\')
}

function shouldRetryWindowsCommandShim(error: unknown, resolved: ResolvedCommand): boolean {
  return (
    process.platform === 'win32' &&
    resolved.wsl === null &&
    isMissingCommandError(error) &&
    !hasPathSeparator(resolved.binary) &&
    !/\.[A-Za-z0-9]+$/.test(resolved.binary)
  )
}

function createAbortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

const WINDOWS_TREE_KILL_WAIT_MS = 2_000

function killSpawnedCommandTree(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (!pid || process.platform !== 'win32') {
    child.kill()
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    let killer: ChildProcess
    try {
      // Why: Windows shims/wsl.exe own descendants; wait for /t tree cleanup so a timed-out command can't outlive its probe.
      killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true
      })
      if (!killer || typeof killer.unref !== 'function') {
        child.kill()
        resolve()
        return
      }
    } catch {
      child.kill()
      resolve()
      return
    }
    let settled = false
    let timer: NodeJS.Timeout | null = null
    const finish = (fallbackToChildKill: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer) {
        clearTimeout(timer)
      }
      killer.removeAllListeners()
      if (fallbackToChildKill) {
        child.kill()
      }
      resolve()
    }
    killer.once('error', () => finish(true))
    killer.once('close', (code) => finish(code !== 0))
    timer = setTimeout(() => {
      killer.kill()
      finish(true)
    }, WINDOWS_TREE_KILL_WAIT_MS)
    killer.unref()
  })
}

type ExecFileCaptureOptions = Omit<ExecFileOptions, 'timeout'> & {
  timeout?: number
  stdin?: string
}

function emptyExecFileOutput(options: ExecFileCaptureOptions): string | Buffer {
  return options.encoding === 'buffer' ? Buffer.alloc(0) : ''
}

function isExecFileResultObject(
  value: unknown
): value is { stdout: string | Buffer; stderr: string | Buffer } {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Buffer.isBuffer(value) &&
    'stdout' in value &&
    'stderr' in value
  )
}

function execFileCapture(
  command: string,
  args: string[],
  options: ExecFileCaptureOptions
): Promise<{ stdout: string | Buffer; stderr: string | Buffer }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(createAbortError())
      return
    }

    let settled = false
    let terminating = false
    let child: ChildProcess | null = null
    let timer: NodeJS.Timeout | null = null
    const cleanup = (): void => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      options.signal?.removeEventListener('abort', onAbort)
    }
    const finish = (
      error: Error | null,
      stdout: string | Buffer = emptyExecFileOutput(options),
      stderr: string | Buffer = emptyExecFileOutput(options)
    ): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      if (error) {
        const enriched = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer }
        enriched.stdout ??= stdout
        enriched.stderr ??= stderr
        reject(enriched)
        return
      }
      resolve({ stdout, stderr })
    }
    const onAbort = (): void => {
      if (settled || terminating) {
        return
      }
      terminating = true
      const abortError = createAbortError()
      if (!child) {
        terminating = false
        finish(abortError)
        return
      }
      void killSpawnedCommandTree(child).then(() => {
        terminating = false
        finish(abortError)
      })
    }

    try {
      const spawnStartedAt = performance.now()
      // Why: our abort listener owns tree cleanup; Node's signal handler could kill wsl.exe before taskkill sees its children.
      child = execFile(
        command,
        args,
        {
          cwd: options.cwd,
          encoding: options.encoding,
          maxBuffer: options.maxBuffer ?? DEFAULT_GIT_MAX_BUFFER,
          env: options.env
        },
        (error, stdout, stderr) => {
          if (terminating) {
            return
          }
          if (!error && stderr === undefined && isExecFileResultObject(stdout)) {
            finish(null, stdout.stdout, stdout.stderr)
            return
          }
          finish(error, stdout, stderr)
        }
      )
      recordSubprocessSpawn(command, args, performance.now() - spawnStartedAt)
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
      return
    }

    child.once('error', (error) => {
      if (!terminating) {
        finish(error)
      }
    })

    if (options.stdin !== undefined) {
      endSubprocessStdin(child.stdin, options.stdin)
    }

    // Why: Node's timeout waits forever on signal-ignoring CLIs; enforce our own deadline with bounded tree cleanup.
    if (options.timeout && options.timeout > 0) {
      timer = setTimeout(() => {
        if (settled || terminating) {
          return
        }
        terminating = true
        const timeoutError = new Error(`${command} timed out.`)
        if (!child) {
          terminating = false
          finish(timeoutError)
          return
        }
        void killSpawnedCommandTree(child).then(() => {
          terminating = false
          finish(timeoutError)
        })
      }, options.timeout)
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function spawnCommandCapture(
  command: string,
  args: string[],
  options: CommandExecOptions
): Promise<{ stdout: string; stderr: string }> {
  const { spawnCmd, spawnArgs } = getSpawnArgsForWindows(command, args)
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(createAbortError())
      return
    }
    let settled = false
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    const spawnStartedAt = performance.now()
    const child = spawn(spawnCmd, spawnArgs, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    recordSubprocessSpawn(spawnCmd, spawnArgs, performance.now() - spawnStartedAt)
    let timer: NodeJS.Timeout | null = null
    const onAbort = (): void => {
      void killSpawnedCommandTree(child)
      finish(createAbortError())
    }
    const cleanupListeners = (): void => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      options.signal?.removeEventListener('abort', onAbort)
      child.stdout?.off('data', onStdoutData)
      child.stderr?.off('data', onStderrData)
      child.off('error', onError)
      child.off('close', onClose)
    }
    const finish = (error: Error | null): void => {
      if (settled) {
        return
      }
      settled = true
      cleanupListeners()
      if (error) {
        reject(Object.assign(error, { stdout, stderr }))
        return
      }
      resolve({ stdout, stderr })
    }
    timer = options.timeout
      ? setTimeout(() => {
          void killSpawnedCommandTree(child)
          finish(new Error(`${command} timed out.`))
        }, options.timeout)
      : null
    options.signal?.addEventListener('abort', onAbort, { once: true })
    function onStdoutData(chunk: Buffer): void {
      stdoutBytes += chunk.byteLength
      if (options.maxBuffer && stdoutBytes > options.maxBuffer) {
        void killSpawnedCommandTree(child)
        finish(new Error(`${command} stdout exceeded maxBuffer.`))
        return
      }
      stdout += chunk.toString(options.encoding ?? 'utf-8')
    }
    function onStderrData(chunk: Buffer): void {
      stderrBytes += chunk.byteLength
      if (options.maxBuffer && stderrBytes > options.maxBuffer) {
        void killSpawnedCommandTree(child)
        finish(new Error(`${command} stderr exceeded maxBuffer.`))
        return
      }
      stderr += chunk.toString(options.encoding ?? 'utf-8')
    }
    function onError(error: Error): void {
      finish(error)
    }
    function onClose(code: number | null): void {
      if (code === 0) {
        finish(null)
        return
      }
      finish(new Error(`${command} exited with ${code}.`))
    }
    child.stdout?.on('data', onStdoutData)
    child.stderr?.on('data', onStderrData)
    child.on('error', onError)
    child.on('close', onClose)
  })
}

function gitOptionalLocksDisabledEnv(
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
function untranslatedGitOutputEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, ...UNTRANSLATED_GIT_OUTPUT_ENV }
}

function promptGuardGitEnv(
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
function promptGuardShellEnv(
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
function nonInteractiveGitEnv(
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

type GitSshPolicyMode =
  | 'default'
  | 'explicit-env'
  | 'fallback'
  | 'configured-openssh'
  | 'configured-wrapper-passthrough'

const CORE_SSH_COMMAND_PROBE_TIMEOUT_MS = 2500

function commandBasename(command: string): string {
  const pieces = command.split(/[\\/]+/)
  return pieces.at(-1)?.toLowerCase() ?? command.toLowerCase()
}

function isMergeableOpenSshCommand(command: string): boolean {
  const basename = commandBasename(command)
  return basename === 'ssh' || basename === 'ssh.exe'
}

function shellTokenize(command: string): string[] | null {
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

function shellQuoteToken(token: string): string {
  return /^[A-Za-z0-9_@%+=:,./~-]+$/.test(token) ? token : quotePosixShell(token)
}

function containsShellExpansionSyntax(command: string): boolean {
  return command.includes('$')
}

function withoutBatchModeOptions(tokens: string[]): string[] {
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

function buildOpenSshBatchModeCommand(configuredCommand: string): string | null {
  if (containsShellExpansionSyntax(configuredCommand)) {
    return null
  }
  const tokens = shellTokenize(configuredCommand)
  if (!tokens || tokens.length === 0 || !isMergeableOpenSshCommand(tokens[0])) {
    return null
  }
  return [...withoutBatchModeOptions(tokens), '-o', 'BatchMode=yes'].map(shellQuoteToken).join(' ')
}

async function buildNetworkSshPolicyEnv(options: GitExecOptions): Promise<{
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
async function gitExecFileAsync(
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
async function commandExecFileAsync(
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
async function gitExecFileAsyncBuffer(
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
type GitStreamResult = { stoppedEarly: boolean }

type GitStreamOptions = {
  cwd: string
  env?: NodeJS.ProcessEnv
  wslDistro?: string
  signal?: AbortSignal
  /** Byte backstop; defaults to DEFAULT_GIT_MAX_BUFFER. */
  maxBuffer?: number
  /**
   * Called for each decoded stdout chunk. Return true to stop: the child is
   * killed and the promise resolves with stoppedEarly=true.
   */
  onStdout: (chunk: string) => boolean | void
}

/**
 * Stream a git command's stdout incrementally instead of buffering it whole.
 *
 * Why: output larger than V8's max string (e.g. status on a repo with a huge
 * un-ignored folder) crashes the process when buffered; streaming keeps memory
 * bounded and lets the parser stop git early. Built on gitSpawn for WSL routing.
 */
async function gitStreamStdout(
  args: string[],
  options: GitStreamOptions
): Promise<GitStreamResult> {
  const maxBuffer = options.maxBuffer ?? DEFAULT_GIT_MAX_BUFFER
  return withGitSpan({ args, cwd: options.cwd }, async () => {
    return new Promise<GitStreamResult>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(createAbortError())
        return
      }
      const child = gitSpawn(args, {
        cwd: options.cwd,
        env: nonInteractiveGitEnv(options.env),
        stdio: ['ignore', 'pipe', 'pipe'],
        wslDistro: options.wslDistro,
        windowsHide: true
      })

      let settled = false
      let stoppedEarly = false
      let stdoutBytes = 0
      let stderr = ''
      let stderrBytes = 0
      // Why: decode statefully so a multibyte UTF-8 char split across chunks isn't corrupted into replacement chars.
      const stdoutDecoder = new StringDecoder('utf8')
      const stderrDecoder = new StringDecoder('utf8')

      const cleanup = (): void => {
        child.stdout?.off('data', onStdoutData)
        child.stderr?.off('data', onStderrData)
        child.off('error', onError)
        child.off('close', onClose)
        options.signal?.removeEventListener('abort', onAbort)
        // Flush any bytes the decoders were holding for an incomplete sequence.
        stdoutDecoder.end()
        stderrDecoder.end()
      }
      const finish = (error: Error | null): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        if (error) {
          reject(Object.assign(error, { stderr }))
          return
        }
        resolve({ stoppedEarly })
      }

      function onStdoutData(chunk: Buffer): void {
        stdoutBytes += chunk.byteLength
        if (stdoutBytes > maxBuffer) {
          void killSpawnedCommandTree(child)
          finish(new Error('git stdout exceeded maxBuffer.'))
          return
        }
        const decoded = stdoutDecoder.write(chunk)
        if (decoded.length === 0) {
          return
        }
        // Why: a throw from the caller's parser would escape this event handler and crash main; convert to a rejection.
        let shouldStop: boolean | void
        try {
          shouldStop = options.onStdout(decoded)
        } catch (error) {
          void killSpawnedCommandTree(child)
          finish(error instanceof Error ? error : new Error(String(error)))
          return
        }
        if (shouldStop === true) {
          // Parser hit its limit: kill git and resolve cleanly with the partial output.
          stoppedEarly = true
          void killSpawnedCommandTree(child)
          finish(null)
        }
      }
      function onStderrData(chunk: Buffer): void {
        stderrBytes += chunk.byteLength
        if (stderrBytes > maxBuffer) {
          void killSpawnedCommandTree(child)
          finish(new Error('git stderr exceeded maxBuffer.'))
          return
        }
        stderr += stderrDecoder.write(chunk)
      }
      function onError(error: Error): void {
        finish(error)
      }
      function onClose(code: number | null): void {
        if (stoppedEarly || code === 0) {
          finish(null)
          return
        }
        finish(new Error(`git exited with ${code}: ${stderr}`))
      }
      function onAbort(): void {
        if (!child.pid) {
          // Why: failed spawn reports ENOENT after abort cleanup; retain a listener so it cannot crash main.
          child.once('error', () => {})
        }
        void killSpawnedCommandTree(child)
        finish(createAbortError())
      }

      child.stdout?.on('data', onStdoutData)
      child.stderr?.on('data', onStderrData)
      child.on('error', onError)
      child.on('close', onClose)
      options.signal?.addEventListener('abort', onAbort, { once: true })
      if (options.signal?.aborted) {
        onAbort()
      }
    })
  })
}

// Why: sync git blocks the main thread; a dead network drive can hang git for minutes without a timeout (issue #7225's 127s freeze).
const GIT_EXEC_SYNC_TIMEOUT_MS = 15_000

/**
 * Sync git command execution. Drop-in replacement for
 * `execFileSync('git', args, { cwd, encoding, ... })`.
 *
 * Returns trimmed stdout as a string.
 */
function gitExecFileSync(
  args: string[],
  options: {
    cwd: string
    encoding?: BufferEncoding
    stdio?: SpawnOptions['stdio']
    timeout?: number
  }
): string {
  const resolved = resolveCommand('git', args, options.cwd)
  const spawnStartedAt = performance.now()
  try {
    return execFileSync(resolved.binary, resolved.args, {
      cwd: resolved.cwd,
      encoding: options.encoding ?? 'utf-8',
      env: untranslatedGitOutputEnv(),
      stdio: options.stdio ?? ['pipe', 'pipe', 'pipe'],
      timeout: options.timeout ?? GIT_EXEC_SYNC_TIMEOUT_MS
    }) as string
  } finally {
    // Sync exec blocks the main thread for its whole duration — the cost issue #7576 flags.
    recordSubprocessSpawn(resolved.binary, resolved.args, performance.now() - spawnStartedAt)
  }
}

/**
 * Spawn a git child process. Drop-in replacement for
 * `spawn('git', args, { cwd, stdio, ... })`.
 */
function gitSpawn(
  args: string[],
  options: SpawnOptions & { cwd: string; wslDistro?: string }
): ChildProcess {
  const { wslDistro, ...spawnOptions } = options
  const resolved = resolveCommand('git', args, options.cwd, wslDistro, {
    useWslLoginShell: Boolean(wslDistro)
  })
  const spawnStartedAt = performance.now()
  const child = spawn(resolved.binary, resolved.args, {
    ...spawnOptions,
    env: untranslatedGitOutputEnv(spawnOptions.env ?? process.env),
    cwd: resolved.cwd
  })
  recordSubprocessSpawn(resolved.binary, resolved.args, performance.now() - spawnStartedAt)
  return child
}

// ─── gh CLI runners ─────────────────────────────────────────────────

// `cwd?` omitted for non-repo-scoped gh calls (rate_limit, listAccessibleProjects) so one WSL-aware wrapper serves both.
// `wslDistro?` routes global cwd-less gh through `wsl.exe -d <distro>` on WSL-only Windows where gh.exe isn't on host PATH.
// `idempotent?` gates transient-error retry (auto-detected from argv); retrying a write that already reached GitHub would duplicate it.

export { DEFAULT_GIT_MAX_BUFFER, isMissingCommandError, hasPathSeparator, shouldRetryWindowsCommandShim, createAbortError, WINDOWS_TREE_KILL_WAIT_MS, killSpawnedCommandTree, emptyExecFileOutput, isExecFileResultObject, execFileCapture, spawnCommandCapture, gitOptionalLocksDisabledEnv, untranslatedGitOutputEnv, promptGuardGitEnv, promptGuardShellEnv, nonInteractiveGitEnv, CORE_SSH_COMMAND_PROBE_TIMEOUT_MS, commandBasename, isMergeableOpenSshCommand, shellTokenize, shellQuoteToken, containsShellExpansionSyntax, withoutBatchModeOptions, buildOpenSshBatchModeCommand, buildNetworkSshPolicyEnv, gitExecFileAsync, commandExecFileAsync, gitExecFileAsyncBuffer, gitStreamStdout, GIT_EXEC_SYNC_TIMEOUT_MS, gitExecFileSync, gitSpawn }
export { type GitExecOptions, type CommandExecOptions, type ExecFileCaptureOptions, type GitSshPolicyMode, type GitStreamResult, type GitStreamOptions }

