/**
 * Centralized git/gh/command runner with transparent WSL support.
 *
 * Why: when a repo lives on a WSL filesystem, native Windows binaries (git.exe,
 * gh.exe, rg.exe) are absent or slow, so this routes execution through
 * `wsl.exe -d <distro>` with translated Linux paths.
 */
import {
  execFileSync,
  spawn,
  type ChildProcess,
  type SpawnOptions
} from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { withGitSpan } from '../observability/instrumentation'
import { recordSubprocessSpawn } from '../diagnostics/main-thread-churn-probe'
// ─── Core resolution ────────────────────────────────────────────────

// Env-assignment prefix for WSL-routed git, where spawn env can't cross the wsl.exe boundary; values are shell-safe unquoted.
import {
  untranslatedGitOutputEnv,
  nonInteractiveGitEnv,
  type GitStreamResult
} from './runner-execution-capture'
import {
  DEFAULT_GIT_MAX_BUFFER,
  createAbortError,
  killSpawnedCommandTree
} from './runner-execution-foundation'
import { resolveCommand } from './runner-command-resolution'

export type GitStreamOptions = {
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
export async function gitStreamStdout(
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
export const GIT_EXEC_SYNC_TIMEOUT_MS = 15_000

/**
 * Sync git command execution. Drop-in replacement for
 * `execFileSync('git', args, { cwd, encoding, ... })`.
 *
 * Returns trimmed stdout as a string.
 */
export function gitExecFileSync(
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
export function gitSpawn(
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
