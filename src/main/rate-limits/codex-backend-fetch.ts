import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CodexRateLimitResetOutcome,ProviderRateLimits,RateLimitWindow } from '../../shared/rate-limit-types'
import {
  buildWslLoginShellCommand,
  escapeWslShCommandForWindows
} from '../../shared/wsl-login-shell-command'
import { parseWslUncPath } from '../../shared/wsl-paths'
import { cancelUnreadResponseBody } from '../lib/unread-response-body'
import {
  createAuthFilesystemOperation,
  type SharedAuthFilesystemOperation
} from './auth-filesystem-operation'
import type { FetchCodexRateLimitsOptions } from './codex-fetcher'
import {
  classifyCodexRateLimitWindows,
  CODEX_SESSION_WINDOW_MINUTES,
  CODEX_WEEKLY_WINDOW_MINUTES,
  type CodexRateWindowSnapshot
} from './codex-rate-limit-window-classification'
import { getHiddenRateLimitWslCwdSetupCommands } from './hidden-rate-limit-pty-cwd'

const BACKEND_TIMEOUT_MS = 10_000
const REDEEM_BACKEND_TIMEOUT_MS = 30_000

type RateLimitResetCredits = {
  availableCount: number
  totalEarnedCount?: number
  nextExpiresAt?: number | null
  credits?: {
    status: string
    expiresAt: number | null
    grantedAt: number | null
  }[]
}

// Why: the Codex app-server wraps rate limit data as { rateLimits: { primary, secondary, ... } }.
type CodexAuthFile = {
  tokens?: {
    access_token?: string
    account_id?: string
  }
}

type BackendRateLimitResetCreditsResponse = {
  available_count?: number
  total_earned_count?: number
  credits?: {
    status?: string
    expires_at?: string | null
    granted_at?: string | null
  }[]
}

type BackendRateLimitWindow = {
  used_percent?: number
  limit_window_seconds?: number
  reset_at?: number
}

type BackendUsageResponse = {
  plan_type?: string
  rate_limit?: {
    primary_window?: BackendRateLimitWindow | null
    secondary_window?: BackendRateLimitWindow | null
  } | null
  rate_limit_reset_credits?: BackendRateLimitResetCreditsResponse | null
}

type BackendConsumeRateLimitResetCreditResponse = {
  code?: string
}

type CodexBackendAuthHeaders = {
  headers: Record<string, string>
}

type BackendAuthReadResult =
  | { content: string; error?: never }
  | { content?: never; error: unknown }

const backendAuthReadByPath = new Map<
  string,
  SharedAuthFilesystemOperation<BackendAuthReadResult>
>()

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

export function buildWslCodexCommand(
  codexHomePath: string,
  args: string[],
  options?: { isolateRpcStdio?: boolean }
): {
  command: string
  args: string[]
} | null {
  const wslInfo = parseWslUncPath(codexHomePath)
  if (process.platform !== 'win32' || !wslInfo) {
    return null
  }
  const setupCommands = [
    ...getHiddenRateLimitWslCwdSetupCommands(),
    `export CODEX_HOME=${shellQuote(wslInfo.linuxPath)}`
  ].join(' && ')
  const execSuffix = `${args.map(shellQuote).join(' ')}${
    options?.isolateRpcStdio ? ' <&3 >&4 3<&- 4>&-' : ''
  }`
  // Why: npm/nvm launchers use `#!/usr/bin/env node`; exec'ing them from plain sh loses Node's PATH and pins stale installs.
  const loginShellCommand = buildWslLoginShellCommand(
    [setupCommands, `exec codex ${execSuffix}`].join(' && ')
  )
  // Why: keep the outer sh non-login and hide RPC pipes before shell startup can read input or print banners.
  const command = options?.isolateRpcStdio
    ? ['exec 3<&0', 'exec 4>&1', 'exec </dev/null', 'exec >/dev/null', loginShellCommand].join('\n')
    : loginShellCommand
  return {
    command: 'wsl.exe',
    args: ['-d', wslInfo.distro, '--', 'sh', '-c', escapeWslShCommandForWindows(command)]
  }
}

export function cloneProcessEnvWithoutCodexHome(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.CODEX_HOME
  return env
}

function getCodexHomePath(codexHomePath?: string | null): string {
  return codexHomePath ?? process.env.CODEX_HOME ?? join(homedir(), '.codex')
}

function parseCreditTimestamp(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Why: reset-credit payloads may use Unix seconds or Unix milliseconds.
    return value < 10_000_000_000 ? value * 1000 : value
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  const trimmed = value.trim()
  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric
  }
  const timestamp = Date.parse(trimmed)
  return Number.isFinite(timestamp) ? timestamp : null
}

function normalizeCreditStatus(status: string | undefined): string {
  return status?.toLowerCase() ?? 'unknown'
}

function abortedCodexRateLimitResult(): ProviderRateLimits {
  return {
    provider: 'codex',
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    error: 'Rate-limit fetch aborted',
    status: 'error'
  }
}

function getNextAvailableCreditExpiry(
  credits: RateLimitResetCredits['credits'] | undefined
): number | null {
  const expiries =
    credits
      ?.filter((credit) => credit.status === 'available')
      .map((credit) => credit.expiresAt)
      .filter((expiresAt): expiresAt is number => typeof expiresAt === 'number')
      .sort((a, b) => a - b) ?? []
  return expiries[0] ?? null
}

function mapBackendRateLimitResetCredits(
  raw: BackendRateLimitResetCreditsResponse | null | undefined
): RateLimitResetCredits | null | undefined {
  if (!raw) {
    return raw
  }
  const credits = raw.credits?.map((credit) => ({
    status: normalizeCreditStatus(credit.status),
    expiresAt: parseCreditTimestamp(credit.expires_at),
    grantedAt: parseCreditTimestamp(credit.granted_at)
  }))
  const availableCount =
    typeof raw.available_count === 'number' && Number.isFinite(raw.available_count)
      ? raw.available_count
      : (credits?.filter((credit) => credit.status === 'available').length ?? null)
  if (availableCount === null) {
    return null
  }
  return {
    availableCount: Math.max(0, Math.floor(availableCount)),
    ...(typeof raw.total_earned_count === 'number' && Number.isFinite(raw.total_earned_count)
      ? { totalEarnedCount: Math.max(0, Math.floor(raw.total_earned_count)) }
      : {}),
    nextExpiresAt: getNextAvailableCreditExpiry(credits),
    ...(credits ? { credits } : {})
  }
}

function hasCompleteRateLimitResetCredits(
  credits: RateLimitResetCredits | null | undefined
): boolean {
  return Boolean(credits && (credits.availableCount === 0 || credits.nextExpiresAt != null))
}

function createBackendRequestSignal(
  callerSignal?: AbortSignal,
  timeoutMs = BACKEND_TIMEOUT_MS
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal
}

function getBackendAuthRead(
  authPath: string
): SharedAuthFilesystemOperation<BackendAuthReadResult> {
  const existing = backendAuthReadByPath.get(authPath)
  if (existing) {
    return existing
  }
  // Why: Node can't cancel an in-flight UNC read; keep one read per auth path so repeated refreshes don't stack them.
  const read = createAuthFilesystemOperation(authPath, () =>
    readFile(authPath, 'utf8').then(
      (content) => ({ content }),
      (error: unknown) => ({ error })
    )
  )
  backendAuthReadByPath.set(authPath, read)
  const clearRead = (): void => {
    if (backendAuthReadByPath.get(authPath) === read) {
      backendAuthReadByPath.delete(authPath)
    }
  }
  void read.result.then(clearRead, clearRead)
  return read
}

async function readBackendAuth(authPath: string, signal: AbortSignal): Promise<string> {
  const result = await getBackendAuthRead(authPath).wait(signal)
  if ('error' in result) {
    throw result.error
  }
  return result.content
}

async function getCodexBackendAuthHeaders(
  options: FetchCodexRateLimitsOptions | undefined,
  signal: AbortSignal
): Promise<CodexBackendAuthHeaders | null> {
  if (signal.aborted) {
    return null
  }
  const authPath = join(getCodexHomePath(options?.codexHomePath), 'auth.json')
  const auth = JSON.parse(await readBackendAuth(authPath, signal)) as CodexAuthFile
  const accessToken = auth.tokens?.access_token
  if (!accessToken) {
    return null
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': 'codex-cli',
    'OpenAI-Beta': 'codex-1',
    originator: 'Codex Desktop'
  }
  if (auth.tokens?.account_id) {
    headers['ChatGPT-Account-Id'] = auth.tokens.account_id
  }
  return { headers }
}

async function fetchBackendRateLimitResetCredits(
  options?: FetchCodexRateLimitsOptions
): Promise<RateLimitResetCredits | null> {
  if (options?.signal?.aborted) {
    return null
  }
  const signal = createBackendRequestSignal(options?.signal)
  const auth = await getCodexBackendAuthHeaders(options, signal)
  if (!auth) {
    return null
  }
  if (signal.aborted) {
    return null
  }
  // Why: Codex 0.140's app-server strips the reset-credit metadata this backend endpoint still returns.
  const response = await fetch('https://chatgpt.com/backend-api/wham/rate-limit-reset-credits', {
    ...auth,
    signal
  })
  if (!response.ok) {
    await cancelUnreadResponseBody(response)
    return null
  }
  const payload = (await response.json()) as BackendRateLimitResetCreditsResponse
  return mapBackendRateLimitResetCredits(payload) ?? null
}

export async function withBackendRateLimitResetCredits(
  limits: ProviderRateLimits,
  options?: FetchCodexRateLimitsOptions
): Promise<ProviderRateLimits> {
  if (
    options?.signal?.aborted ||
    limits.provider !== 'codex' ||
    hasCompleteRateLimitResetCredits(limits.rateLimitResetCredits)
  ) {
    return limits
  }
  try {
    const rateLimitResetCredits = await fetchBackendRateLimitResetCredits(options)
    return rateLimitResetCredits === null ? limits : { ...limits, rateLimitResetCredits }
  } catch {
    return limits
  }
}

function mapBackendConsumeOutcome(code: string | undefined): CodexRateLimitResetOutcome {
  if (code === 'reset') {
    return 'reset'
  }
  if (code === 'nothing_to_reset') {
    return 'nothingToReset'
  }
  if (code === 'no_credit') {
    return 'noCredit'
  }
  if (code === 'already_redeemed') {
    return 'alreadyRedeemed'
  }
  throw new Error(`Unknown Codex reset outcome: ${code ?? 'missing'}`)
}

export async function consumeCodexRateLimitResetCredit(options: {
  codexHomePath?: string | null
  idempotencyKey: string
}): Promise<CodexRateLimitResetOutcome> {
  if (!options.idempotencyKey.trim()) {
    throw new Error('Codex reset idempotency key is required')
  }
  const signal = createBackendRequestSignal(undefined, REDEEM_BACKEND_TIMEOUT_MS)
  const auth = await getCodexBackendAuthHeaders(options, signal)
  if (!auth) {
    throw new Error('Codex not signed in')
  }
  const response = await fetch(
    'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume',
    {
      method: 'POST',
      headers: {
        ...auth.headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ redeem_request_id: options.idempotencyKey }),
      signal
    }
  )
  if (!response.ok) {
    await cancelUnreadResponseBody(response)
    throw new Error(`Codex reset failed: HTTP ${response.status}`)
  }
  const payload = (await response.json()) as BackendConsumeRateLimitResetCreditResponse
  return mapBackendConsumeOutcome(payload.code)
}

function mapRpcWindow(
  raw: CodexRateWindowSnapshot | null | undefined,
  expectedWindowMinutes: number
): RateLimitWindow | null {
  if (!raw || typeof raw.usedPercent !== 'number' || !Number.isFinite(raw.usedPercent)) {
    return null
  }
  let resetDescription: string | null = null
  let resetsAt: number | null = null

  if (typeof raw.resetsAt === 'number' && Number.isFinite(raw.resetsAt) && raw.resetsAt > 0) {
    // Why: Codex returns resetsAt as Unix seconds, not milliseconds.
    const date = new Date(raw.resetsAt * 1000)
    if (!Number.isNaN(date.getTime())) {
      resetsAt = date.getTime()
      const now = new Date()
      const isToday = date.toDateString() === now.toDateString()
      resetDescription = isToday
        ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        : date.toLocaleDateString(undefined, {
            weekday: 'short',
            hour: 'numeric',
            minute: '2-digit'
          })
    }
  }

  return {
    usedPercent: Math.min(100, Math.max(0, raw.usedPercent)),
    // Why: older app-server builds can report canonical bucket lengths off by one minute.
    windowMinutes: expectedWindowMinutes,
    resetsAt,
    resetDescription
  }
}

function backendWindowToSnapshot(
  raw: BackendRateLimitWindow | null | undefined
): CodexRateWindowSnapshot | null {
  if (!raw) {
    return null
  }
  const limitWindowSeconds = raw.limit_window_seconds
  const windowDurationMins =
    typeof limitWindowSeconds === 'number' &&
    Number.isFinite(limitWindowSeconds) &&
    limitWindowSeconds > 0
      ? Math.ceil(limitWindowSeconds / 60)
      : undefined
  return { usedPercent: raw.used_percent, windowDurationMins, resetsAt: raw.reset_at }
}

function snapshotWindowMinutes(
  snapshot: CodexRateWindowSnapshot | null,
  fallbackWindowMinutes: number
): number {
  const duration = snapshot?.windowDurationMins
  return typeof duration === 'number' && Number.isFinite(duration) && duration > 0
    ? duration
    : fallbackWindowMinutes
}

export async function fetchViaBackend(
  options?: FetchCodexRateLimitsOptions
): Promise<ProviderRateLimits | null> {
  const signal = createBackendRequestSignal(options?.signal)
  const auth = await getCodexBackendAuthHeaders(options, signal)
  if (!auth || signal.aborted) {
    return null
  }
  // Why: reuse Codex's own get_rate_limit_status endpoint, avoiding a hidden app-server (and WSL login shell) per refresh.
  const response = await fetch('https://chatgpt.com/backend-api/wham/usage', {
    ...auth,
    signal
  })
  if (!response.ok) {
    await cancelUnreadResponseBody(response)
    return null
  }
  const payload = (await response.json()) as BackendUsageResponse
  // Why: plan_type is required by Codex's RateLimitStatusPayload; reject malformed JSON so the app-server fallback still runs.
  if (typeof payload.plan_type !== 'string') {
    return null
  }
  const classified = classifyCodexRateLimitWindows({
    primary: backendWindowToSnapshot(payload.rate_limit?.primary_window),
    secondary: backendWindowToSnapshot(payload.rate_limit?.secondary_window)
  })
  return {
    provider: 'codex',
    session: mapRpcWindow(
      classified.session,
      snapshotWindowMinutes(classified.session, CODEX_SESSION_WINDOW_MINUTES)
    ),
    weekly: mapRpcWindow(
      classified.weekly,
      snapshotWindowMinutes(classified.weekly, CODEX_WEEKLY_WINDOW_MINUTES)
    ),
    // Surfaced for the status-bar Usage row (e.g. "Codex · Plus").
    planType: payload.plan_type,
    ...(payload.rate_limit_reset_credits !== undefined
      ? {
          rateLimitResetCredits:
            mapBackendRateLimitResetCredits(payload.rate_limit_reset_credits) ?? null
        }
      : {}),
    updatedAt: Date.now(),
    error: null,
    status: 'ok'
  }
}

export async function withBackendSessionWindow(
  limits: ProviderRateLimits,
  options?: FetchCodexRateLimitsOptions
): Promise<ProviderRateLimits> {
  if (options?.signal?.aborted || limits.session || !limits.weekly) {
    return limits
  }
  try {
    const backend = await fetchViaBackend(options)
    if (!backend) {
      return limits
    }
    const rateLimitResetCredits = backend.rateLimitResetCredits ?? limits.rateLimitResetCredits
    if (!backend.session) {
      return rateLimitResetCredits === limits.rateLimitResetCredits
        ? limits
        : { ...limits, rateLimitResetCredits }
    }
    return {
      ...limits,
      session: backend.session,
      weekly: backend.weekly ?? limits.weekly,
      planType: backend.planType ?? limits.planType,
      ...(rateLimitResetCredits !== undefined ? { rateLimitResetCredits } : {}),
      updatedAt: backend.updatedAt
    }
  } catch {
    return limits
  }
}


