/**
 * Centralized git/gh/command runner with transparent WSL support.
 *
 * Why: when a repo lives on a WSL filesystem, native Windows binaries (git.exe,
 * gh.exe, rg.exe) are absent or slow, so this routes execution through
 * `wsl.exe -d <distro>` with translated Linux paths.
 */
import { UNTRANSLATED_GIT_OUTPUT_ENV } from '../../shared/git-output-locale'
import {
  type GhRateLimitBucket,
  classifyGhRateLimitBucket,
  createGhRateLimitBlockedError,
  getGhRateLimitBlockedUntilMs,
  ghRateLimitScopeKey,
  isGhPrimaryRateLimitStderr,
  isGhRateLimitProbe,
  notifyGhPrimaryRateLimit
} from './gh-rate-limit-breaker'
// Re-exported for existing importers; lightweight consumers should import from './exec-error' to avoid this heavy module.
import { extractExecError,parseRetryAfterMs } from './exec-error'
import { type ResolvedCommand,canFallBackToHostGitHubCli,isHostCommandMissing,resolveCommand,resolveDefaultWslCli,resolveHostGitHubCli } from './runner-command-resolution'
import { type GitExecOptions,execFileCapture } from './runner-execution'
// ─── Core resolution ────────────────────────────────────────────────

// Env-assignment prefix for WSL-routed git, where spawn env can't cross the wsl.exe boundary; values are shell-safe unquoted.
const GIT_OUTPUT_LOCALE_SHELL_PREFIX = Object.entries(UNTRANSLATED_GIT_OUTPUT_ENV)
  .map(([key, value]) => `${key}=${value}`)
  .join(' ')
type GhExecOptions = Omit<GitExecOptions, 'cwd'> & {
  cwd?: string
  wslDistro?: string
  idempotent?: boolean
  // Why: `gh api` and `--repo OWNER/REPO` shorthand resolve against gh's
  // default host, not the repo's remote. Carrying the host here lets the
  // runner qualify every spawn once, so call sites can't silently fall back
  // to github.com for GHES repos; it also scopes the rate-limit breaker.
  host?: string
}

const NON_IDEMPOTENT_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])
// `gh <noun> <verb>` write subcommands; reads are absent on purpose so they keep retrying.
const NON_IDEMPOTENT_GH_VERBS = new Set([
  'create',
  'edit',
  'update',
  'delete',
  'close',
  'reopen',
  'merge',
  'comment',
  'review',
  'ready',
  'lock',
  'unlock',
  'pin',
  'unpin',
  'transfer',
  'develop'
])

function argsLookIdempotent(args: string[]): boolean {
  let explicitMethodSeen = false
  let hasApiBodyField = false
  let hasGraphQlQuery = false
  const isGraphQlApi = args[0] === 'api' && args[1] === 'graphql'
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-X' || a === '--method') {
      explicitMethodSeen = true
      const next = args[i + 1]
      if (typeof next === 'string' && NON_IDEMPOTENT_METHODS.has(next.toUpperCase())) {
        return false
      }
    }
    // Single-token form `--method=POST` (gh accepts this).
    if (a.startsWith('--method=')) {
      explicitMethodSeen = true
      const value = a.slice('--method='.length)
      if (NON_IDEMPOTENT_METHODS.has(value.toUpperCase())) {
        return false
      }
    }
    // `gh api` auto-POSTs when -f/-F/--field body fields are given without -X; track them.
    if (a === '-f' || a === '-F' || a === '--field' || a === '--raw-field') {
      hasApiBodyField = true
    } else if (
      a.startsWith('-f=') ||
      a.startsWith('-F=') ||
      a.startsWith('--field=') ||
      a.startsWith('--raw-field=')
    ) {
      hasApiBodyField = true
    }
    // Detect GraphQL `query=mutation(…)` so endpoint writes also fail fast on transient errors.
    if (a.startsWith('query=')) {
      hasGraphQlQuery = true
      const trimmed = a.slice('query='.length).trimStart().toLowerCase()
      if (trimmed.startsWith('mutation')) {
        return false
      }
    }
  }
  // `gh api -f foo=bar` with no -X auto-POSTs → non-idempotent; GraphQL query bodies are the exception (still reads).
  if (
    args[0] === 'api' &&
    hasApiBodyField &&
    !explicitMethodSeen &&
    !(isGraphQlApi && hasGraphQlQuery)
  ) {
    return false
  }
  // `gh <noun> <verb>` writes (args[1]); `gh api` without -X defaults to idempotent GET, so it's excluded here.
  if (args.length >= 2 && args[0] !== 'api') {
    if (NON_IDEMPOTENT_GH_VERBS.has(args[1])) {
      return false
    }
  }
  return true
}

/**
 * Classify whether a gh execFile rejection is worth retrying.
 *
 * Why: gh surfaces HTTP status as stderr substrings ("HTTP 504", econnreset, …).
 * Retry 5xx/network resets and 429 only without Retry-After (propagate those so
 * the UI can show the wait); primary-rate-limit 403 is never transient.
 */
function isTransientGhError(stderr: string): boolean {
  const s = stderr.toLowerCase()
  if (
    s.includes('http 500') ||
    s.includes('http 502') ||
    s.includes('http 503') ||
    s.includes('http 504') ||
    s.includes('econnreset') ||
    s.includes('etimedout') ||
    s.includes('socket hang up')
  ) {
    return true
  }
  // 429 without Retry-After: retry. With Retry-After: propagate.
  if (s.includes('http 429')) {
    return parseRetryAfterMs(stderr) === null
  }
  return false
}

// Why: 3 attempts total (250ms → 1s backoff); array length defines retry count (total attempts = length + 1).
const GH_RETRY_DELAYS_MS = [250, 1000] as const

// Why: Retry-After is unbounded and untrusted; cap at 30s so a gh call can't block the IPC thread indefinitely.
const GH_RETRY_AFTER_MAX_MS = 30_000
const DEFAULT_GH_EXEC_TIMEOUT_MS = 30_000

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function defaultGhExecTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ORCA_GH_EXEC_TIMEOUT_MS
  if (!raw) {
    return DEFAULT_GH_EXEC_TIMEOUT_MS
  }
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GH_EXEC_TIMEOUT_MS
}

function nonInteractiveGhEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    GH_PROMPT_DISABLED: env.GH_PROMPT_DISABLED ?? '1'
  }
}

function hasGhHostnameFlag(args: readonly string[]): boolean {
  return args.some((arg) => arg === '--hostname' || arg.startsWith('--hostname='))
}

function hostQualifiedGhRepoValue(value: string, host: string): string {
  // URLs and already-qualified HOST/OWNER/REPO values pass through untouched.
  if (value.includes('://') || value.split('/').length !== 2) {
    return value
  }
  return `${host}/${value}`
}

/**
 * Host-qualify a gh invocation from `options.host`: `--hostname` for `api`
 * calls, `HOST/OWNER/REPO` for `--repo`/`-R` shorthand. SSH-backed repos run
 * gh with no cwd, so this is their only host signal (#8312).
 *
 * @internal exported for tests.
 */
function applyGhHostToArgs(args: string[], host?: string): string[] {
  if (!host) {
    return args
  }
  let result = args
  if (result[0] === 'api' && !hasGhHostnameFlag(result)) {
    result = ['api', '--hostname', host, ...result.slice(1)]
  }
  // Why: bare OWNER/REPO shorthand resolves against gh's default host — GH_HOST
  // when set — so github.com must be qualified too, not just GHES, or a
  // process-level GH_HOST redirects pinned github.com commands.
  // Combined short forms (`-Ra/b`, `-R=a/b`) are deliberately not rewritten:
  // no call site uses them, and prefix-matching `-R` corrupts free-text values
  // of other flags (e.g. a --title that happens to start with `-R`).
  const qualified: string[] = []
  for (let i = 0; i < result.length; i += 1) {
    const arg = result[i]
    if (arg === '--repo' || arg === '-R') {
      qualified.push(arg)
      const value = result[i + 1]
      if (value !== undefined) {
        qualified.push(hostQualifiedGhRepoValue(value, host))
        i += 1
      }
      continue
    }
    if (arg.startsWith('--repo=')) {
      qualified.push(`--repo=${hostQualifiedGhRepoValue(arg.slice('--repo='.length), host)}`)
      continue
    }
    qualified.push(arg)
  }
  return qualified
}

function explicitGhHostname(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--hostname') {
      const value = args[i + 1]?.trim()
      return value || undefined
    }
    if (args[i].startsWith('--hostname=')) {
      const value = args[i].slice('--hostname='.length).trim()
      return value || undefined
    }
  }
  return undefined
}

function explicitGhRepoHostname(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    let value: string | undefined
    if (args[i] === '--repo' || args[i] === '-R') {
      value = args[i + 1]
    } else if (args[i].startsWith('--repo=')) {
      value = args[i].slice('--repo='.length)
    }
    const parts = value?.trim().split('/')
    if (parts?.length === 3 && parts.every(Boolean)) {
      return parts[0]
    }
  }
  return undefined
}

function ghRateLimitScope(
  args: readonly string[],
  options: GhExecOptions,
  resolved: ResolvedCommand
): string {
  const runtime = resolved.wsl ? `wsl:${resolved.wsl.distro.toLowerCase()}` : 'native'
  // Why: an explicit argv hostname controls the actual gh request even when
  // GH_HOST or options.host disagree, so breaker state must follow that host.
  const host =
    explicitGhHostname(args) ??
    options.host ??
    explicitGhRepoHostname(args) ??
    options.env?.GH_HOST ??
    process.env.GH_HOST ??
    'github.com'
  return ghRateLimitScopeKey(runtime, host)
}

function assertGhRateLimitScopeAvailable(
  args: readonly string[],
  options: GhExecOptions,
  resolved: ResolvedCommand,
  bucket: GhRateLimitBucket,
  exemptProbe: boolean
): void {
  if (exemptProbe) {
    return
  }
  const blockedUntilMs = getGhRateLimitBlockedUntilMs(
    bucket,
    Date.now(),
    ghRateLimitScope(args, options, resolved)
  )
  if (blockedUntilMs !== null) {
    throw createGhRateLimitBlockedError(bucket, blockedUntilMs)
  }
}

/**
 * Async gh CLI execution. Drop-in replacement for
 * `execFileAsync('gh', args, { cwd, encoding, ... })`.
 *
 * Retries transient 5xx / 429-without-Retry-After / network-reset failures with
 * exponential backoff; other errors fail fast.
 */
async function ghExecFileAsync(
  args: string[],
  options: GhExecOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  // Why: retry safety must reflect the original call even when fallbacks replace the resolved command.
  const idempotent = options.idempotent ?? argsLookIdempotent(args)
  args = applyGhHostToArgs(args, options.host)
  let resolved = resolveCommand('gh', args, options.cwd, options.wslDistro)
  // Why: while a bucket is rate-limited every spawn returns 403 — fail fast; the probe is exempt so the breaker can learn the reset.
  // Why: scope by runtime and host so unrelated github.com, GHES, and WSL quotas cannot block each other.
  const rateLimitBucket = classifyGhRateLimitBucket(args)
  const rateLimitProbe = isGhRateLimitProbe(args)
  assertGhRateLimitScopeAvailable(args, options, resolved, rateLimitBucket, rateLimitProbe)
  let lastError: unknown
  let attemptedHostFallback = false
  let attemptedDefaultWslFallback = false
  for (let attempt = 0; attempt <= GH_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const { stdout, stderr } = await execFileCapture(resolved.binary, resolved.args, {
        cwd: resolved.cwd,
        encoding: (options.encoding ?? 'utf-8') as BufferEncoding,
        maxBuffer: options.maxBuffer,
        // Why: bound gh so one stuck child fails visibly instead of wedging the IPC lane.
        timeout: options.timeout ?? defaultGhExecTimeoutMs(options.env),
        env: nonInteractiveGhEnv(options.env)
      })
      return { stdout: stdout as string, stderr: stderr as string }
    } catch (err) {
      lastError = err
      const { stderr } = extractExecError(err)
      if (isGhPrimaryRateLimitStderr(stderr)) {
        notifyGhPrimaryRateLimit(rateLimitBucket, ghRateLimitScope(args, options, resolved))
      }
      if (
        process.platform === 'win32' &&
        !attemptedDefaultWslFallback &&
        resolved.wsl === null &&
        !options.cwd &&
        !options.wslDistro &&
        isHostCommandMissing(err, 'gh')
      ) {
        const wslResolved = resolveDefaultWslCli('gh', args)
        if (wslResolved) {
          // Why: WSL-only Windows installs have no host gh.exe, and global calls (rate_limit/auth) carry no cwd to route by.
          resolved = wslResolved
          attemptedDefaultWslFallback = true
          assertGhRateLimitScopeAvailable(args, options, resolved, rateLimitBucket, rateLimitProbe)
          attempt = -1
          continue
        }
      }
      if (!attemptedHostFallback && canFallBackToHostGitHubCli('gh', args, resolved, stderr)) {
        resolved = resolveHostGitHubCli('gh', args)
        attemptedHostFallback = true
        assertGhRateLimitScopeAvailable(args, options, resolved, rateLimitBucket, rateLimitProbe)
        attempt = -1
        continue
      }
      const isLastAttempt = attempt >= GH_RETRY_DELAYS_MS.length
      if (idempotent && !isLastAttempt && isTransientGhError(stderr)) {
        // Why: honor the server's Retry-After over our backoff (a shorter sleep just re-fails); cap so a huge hint can't stall IPC.
        const retryAfterMs = parseRetryAfterMs(stderr)
        const delayMs =
          retryAfterMs !== null
            ? Math.min(retryAfterMs, GH_RETRY_AFTER_MAX_MS)
            : GH_RETRY_DELAYS_MS[attempt]
        await sleep(delayMs)
        continue
      }
      throw err
    }
  }
  // Unreachable: the loop either returns or throws. Here for TS exhaustiveness.
  throw lastError
}

// ─── glab CLI runner ────────────────────────────────────────────────
// Why: cloned from the gh runner rather than abstracted behind a generic runner, to avoid touching the working gh path.

type GlabExecOptions = Omit<GitExecOptions, 'cwd'> & {
  cwd?: string
  wslDistro?: string
  idempotent?: boolean
  allowDefaultWslFallback?: boolean
}

/** Async glab CLI execution; drop-in for execFileAsync('glab', …). Retry policy mirrors ghExecFileAsync. */
/**
 * glab's `--hostname` rejects host:port, so a ported self-hosted GitLab must use the GITLAB_HOST env var instead — translate it.
 * @internal exported for tests.
 */
function redirectPortedHostnameToEnv(
  args: string[],
  options: GlabExecOptions
): { args: string[]; options: GlabExecOptions } {
  const i = args.indexOf('--hostname')
  if (i === -1 || i + 1 >= args.length) {
    return { args, options }
  }
  const host = args[i + 1]
  if (!/^[^/\s]+:\d+$/.test(host)) {
    return { args, options }
  }
  return {
    args: [...args.slice(0, i), ...args.slice(i + 2)],
    options: { ...options, env: { ...(options.env ?? process.env), GITLAB_HOST: host } }
  }
}

async function glabExecFileAsync(
  args: string[],
  options: GlabExecOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  ;({ args, options } = redirectPortedHostnameToEnv(args, options))
  let resolved = resolveCommand('glab', args, options.cwd, options.wslDistro)
  let lastError: unknown
  let attemptedDefaultWslFallback = false
  for (let attempt = 0; attempt <= GH_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const { stdout, stderr } = await execFileCapture(resolved.binary, resolved.args, {
        cwd: resolved.cwd,
        encoding: (options.encoding ?? 'utf-8') as BufferEncoding,
        maxBuffer: options.maxBuffer,
        timeout: options.timeout,
        env: options.env,
        signal: options.signal
      })
      return { stdout: stdout as string, stderr: stderr as string }
    } catch (err) {
      lastError = err
      const { stderr } = extractExecError(err)
      if (
        process.platform === 'win32' &&
        !attemptedDefaultWslFallback &&
        resolved.wsl === null &&
        !options.cwd &&
        !options.wslDistro &&
        options.allowDefaultWslFallback !== false &&
        isHostCommandMissing(err, 'glab')
      ) {
        const wslResolved = resolveDefaultWslCli('glab', args)
        if (wslResolved) {
          // Why: mirror gh's WSL-only fallback for global GitLab project/auth calls.
          resolved = wslResolved
          attemptedDefaultWslFallback = true
          attempt = -1
          continue
        }
      }
      const isLastAttempt = attempt >= GH_RETRY_DELAYS_MS.length
      // Why: mirror gh's write-safety gate — don't auto-retry a non-idempotent write that GitLab may already have applied.
      const idempotent = options.idempotent ?? argsLookIdempotent(args)
      if (idempotent && !isLastAttempt && isTransientGhError(stderr)) {
        const retryAfterMs = parseRetryAfterMs(stderr)
        const delayMs =
          retryAfterMs !== null
            ? Math.min(retryAfterMs, GH_RETRY_AFTER_MAX_MS)
            : GH_RETRY_DELAYS_MS[attempt]
        await sleep(delayMs)
        continue
      }
      throw err
    }
  }
  throw lastError
}

// ─── Generic command runner (for rg, etc.) ──────────────────────────

/**
 * Spawn any command with WSL awareness.
 * Used for non-git binaries like `rg` that also need WSL routing.
 */

export { DEFAULT_GH_EXEC_TIMEOUT_MS,GH_RETRY_AFTER_MAX_MS,GH_RETRY_DELAYS_MS,NON_IDEMPOTENT_GH_VERBS,NON_IDEMPOTENT_METHODS,applyGhHostToArgs,argsLookIdempotent,assertGhRateLimitScopeAvailable,defaultGhExecTimeoutMs,explicitGhHostname,explicitGhRepoHostname,ghExecFileAsync,ghRateLimitScope,glabExecFileAsync,hasGhHostnameFlag,hostQualifiedGhRepoValue,isTransientGhError,nonInteractiveGhEnv,redirectPortedHostnameToEnv,sleep,type GhExecOptions,type GlabExecOptions }
