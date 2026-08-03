/**
 * Centralized git/gh/command runner with transparent WSL support.
 *
 * Why: when a repo lives on a WSL filesystem, native Windows binaries (git.exe,
 * gh.exe, rg.exe) are absent or slow, so this routes execution through
 * `wsl.exe -d <distro>` with translated Linux paths.
 */
import {
  execFile,
  spawn,
  type ChildProcess,
  type ExecFileOptions
} from 'node:child_process'
import { recordSubprocessSpawn } from '../diagnostics/main-thread-churn-probe'
import { getSpawnArgsForWindows } from '../win32-utils'
import { UNTRANSLATED_GIT_OUTPUT_ENV } from '../../shared/git-output-locale'
import { endSubprocessStdin } from '../../shared/subprocess-stdin-write'
// ─── Core resolution ────────────────────────────────────────────────

// Env-assignment prefix for WSL-routed git, where spawn env can't cross the wsl.exe boundary; values are shell-safe unquoted.
export const GIT_OUTPUT_LOCALE_SHELL_PREFIX = Object.entries(UNTRANSLATED_GIT_OUTPUT_ENV)
  .map(([key, value]) => `${key}=${value}`)
  .join(' ')
import { type ResolvedCommand } from './runner-command-resolution'
export const DEFAULT_GIT_MAX_BUFFER = 10 * 1024 * 1024

export type GitExecOptions = {
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

export type CommandExecOptions = {
  cwd?: string
  encoding?: BufferEncoding
  maxBuffer?: number
  timeout?: number
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  wslDistro?: string
}

export function isMissingCommandError(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT'
  )
}

export function hasPathSeparator(command: string): boolean {
  return command.includes('/') || command.includes('\\')
}

export function shouldRetryWindowsCommandShim(error: unknown, resolved: ResolvedCommand): boolean {
  return (
    process.platform === 'win32' &&
    resolved.wsl === null &&
    isMissingCommandError(error) &&
    !hasPathSeparator(resolved.binary) &&
    !/\.[A-Za-z0-9]+$/.test(resolved.binary)
  )
}

export function createAbortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

export const WINDOWS_TREE_KILL_WAIT_MS = 2_000

export function killSpawnedCommandTree(child: ChildProcess): Promise<void> {
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

export type ExecFileCaptureOptions = Omit<ExecFileOptions, 'timeout'> & {
  timeout?: number
  stdin?: string
}

export function emptyExecFileOutput(options: ExecFileCaptureOptions): string | Buffer {
  return options.encoding === 'buffer' ? Buffer.alloc(0) : ''
}

export function isExecFileResultObject(
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

export function execFileCapture(
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

export async function spawnCommandCapture(
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
