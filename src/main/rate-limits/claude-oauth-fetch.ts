import { net, session } from 'electron'
import type {
  ProviderRateLimits,
  RateLimitWindow,
  UsageRateLimitFailureKind,
  UsageRateLimitMetadata,
  UsageRateLimitSource
} from '../../shared/rate-limit-types'
import type { NetworkProxySettings } from '../../shared/network-proxy'
import { fetchViaPty } from './claude-pty'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth-service'
import {
  isOauthTokenExpiring,
  refreshClaudeOauthCredentials
} from '../claude-accounts/oauth-refresh'
import { createOAuthUsageError, OAuthUsageError } from './claude-oauth-usage-error'
import { mapClaudeUsageWindow, type ClaudeUsageWindowInput } from './claude-usage-window'
import { withMacTailscaleDnsHint } from '../network/macos-tailscale-dns-diagnostic'
import { ensureElectronProxyFromEnvironment } from '../network/proxy-settings'
import { resolveClaudeUsageRefreshPlan } from './claude-usage-refresh-plan'
import {
  classifyClaudeCredentialAbsence,
  classifyClaudeOAuthUsageError,
  type ClaudeUsageErrorClassification
} from './claude-usage-error-classification'
import {
  parseOAuthCredentialsJson,
  readOAuthCredentials,
  type OAuthCredentialReadOptions,
  type OAuthCredentialReadResult
} from './claude-oauth-credentials'
import {
  canTrustManagedUsagePanelSupplement,
  getManagedUsagePanelAuthPreparation,
  readManagedCredentials,
  readStagedManagedPreviewCredentials,
  resolveManagedCredentialsLocation,
  type InactiveClaudeAccountInfo,
  type ManagedCredentialsLocation,
  withManagedPreviewKeychainCredentials,
  writeManagedCredentialsJson
} from './claude-managed-credentials'

const OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_BETA_HEADER = 'oauth-2025-04-20'
const CLAUDE_CODE_USER_AGENT = 'claude-code/2.1.0'
const API_TIMEOUT_MS = 10_000
const LIVE_CLAUDE_REFRESH_DEFERRED_MESSAGE =
  'Claude usage refresh is waiting for the live Claude terminal to rotate its credentials.'

/**
 * Bridge standard HTTP proxy env vars into Electron's session proxy config.
 * Why: net.fetch ignores HTTP_PROXY/HTTPS_PROXY; users behind a proxy for api.anthropic.com set those env vars (#521, #800).
 */
export async function ensureProxyFromEnv(): Promise<void> {
  await ensureElectronProxyFromEnvironment({
    proxySession: session.defaultSession,
    probeUrl: OAUTH_USAGE_URL
  }).catch(() => {})
}

export function resolveOAuthCredentialReadOptions(
  authPreparation?: ClaudeRuntimeAuthPreparation
): OAuthCredentialReadOptions | undefined {
  if (!authPreparation) {
    return undefined
  }
  // Why: Claude Code 2.1+ can scope even the default config dir's Keychain item; try scoped first, legacy as fallback.
  const readOptions: OAuthCredentialReadOptions = {
    credentialsFileConfigDir: authPreparation.configDir,
    keychainConfigDir: authPreparation.configDir
  }
  return readOptions
}

export function buildClaudeUsageFetchDiagnostic(
  authPreparation: ClaudeRuntimeAuthPreparation | undefined,
  oauthCredentials: OAuthCredentialReadResult
): Record<string, unknown> {
  return {
    provenance: authPreparation?.provenance ?? 'system',
    runtime: authPreparation?.runtime ?? 'host',
    wslDistro: authPreparation?.wslDistro ?? null,
    hasExplicitClaudeConfigDir: Boolean(authPreparation?.envPatch.CLAUDE_CONFIG_DIR),
    credentialSource: oauthCredentials.source,
    keychainUnavailable: oauthCredentials.keychainUnavailable,
    hasRefreshableCredentials: oauthCredentials.hasRefreshableCredentials
  }
}

export function warnClaudeUsageFetchFailure(
  authPreparation: ClaudeRuntimeAuthPreparation | undefined,
  oauthCredentials: OAuthCredentialReadResult,
  error: unknown
): void {
  const message = error instanceof Error ? error.message : String(error)
  const status = error instanceof OAuthUsageError ? error.status : null
  console.warn('[claude-rate-limits] Claude usage refresh failed', {
    ...buildClaudeUsageFetchDiagnostic(authPreparation, oauthCredentials),
    status,
    message
  })
}

// ---------------------------------------------------------------------------
// OAuth API fetch
// ---------------------------------------------------------------------------

export type OAuthUsageWindow = ClaudeUsageWindowInput

export type OAuthUsageLimit = {
  kind?: string
  percent?: number
  resets_at?: string | number
  is_active?: boolean
  scope?: { model?: { display_name?: string } | null } | null
}

export type OAuthUsageResponse = {
  five_hour?: OAuthUsageWindow
  seven_day?: OAuthUsageWindow
  fable_weekly?: OAuthUsageWindow
  fable_seven_day?: OAuthUsageWindow
  seven_day_fable?: OAuthUsageWindow
  limits?: OAuthUsageLimit[] | null
}

type ClaudeUsageAttemptState = {
  attemptedSources: UsageRateLimitSource[]
}

export function abortedClaudeRateLimitResult(): ProviderRateLimits {
  return {
    provider: 'claude',
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    error: 'Rate-limit fetch aborted',
    status: 'error'
  }
}

export function mapFableWeeklyWindow(data: OAuthUsageResponse): RateLimitWindow | null {
  // Why: model quotas moved to structured scoped limits; prefer them but keep legacy weekly fields for older responses.
  const scoped = Array.isArray(data.limits)
    ? data.limits.find(
        (limit) =>
          // Why: is_active marks the currently-binding limit, not data validity;
          // inactive Fable entries still carry a real percent/resets_at (#8979).
          limit?.kind === 'weekly_scoped' &&
          Number.isFinite(limit.percent) &&
          limit.scope?.model?.display_name?.trim().toLowerCase() === 'fable'
      )
    : undefined
  return (
    mapClaudeUsageWindow(
      scoped ? { used_percentage: scoped.percent, resets_at: scoped.resets_at } : undefined,
      10080
    ) ??
    mapClaudeUsageWindow(data.fable_weekly, 10080) ??
    mapClaudeUsageWindow(data.fable_seven_day, 10080) ??
    mapClaudeUsageWindow(data.seven_day_fable, 10080)
  )
}

export async function fetchViaOAuth(token: string, signal?: AbortSignal): Promise<ProviderRateLimits> {
  if (signal?.aborted) {
    return abortedClaudeRateLimitResult()
  }
  await ensureProxyFromEnv()
  if (signal?.aborted) {
    return abortedClaudeRateLimitResult()
  }

  // Compose caller cancel with the request timeout so either aborts the fetch.
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(API_TIMEOUT_MS)])
    : AbortSignal.timeout(API_TIMEOUT_MS)

  try {
    // Why: net.fetch uses Chromium's stack for OS proxy/certs; env-var proxies are bridged by ensureProxyFromEnv.
    const res = await net.fetch(OAUTH_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': OAUTH_BETA_HEADER,
        // Why: match the Claude Code CLI user-agent to stay aligned with the OAuth usage API contract.
        'User-Agent': CLAUDE_CODE_USER_AGENT
      },
      signal: requestSignal
    })

    if (!res.ok) {
      throw await createOAuthUsageError(res)
    }

    const data = (await res.json()) as OAuthUsageResponse
    if (signal?.aborted) {
      return abortedClaudeRateLimitResult()
    }

    return {
      provider: 'claude',
      session: mapClaudeUsageWindow(data.five_hour, 300),
      weekly: mapClaudeUsageWindow(data.seven_day, 10080),
      fableWeekly: mapFableWeeklyWindow(data),
      updatedAt: Date.now(),
      error: null,
      status: 'ok'
    }
  } catch (err) {
    if (signal?.aborted) {
      return abortedClaudeRateLimitResult()
    }
    throw err
  }
}
