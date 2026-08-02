import type {
  ProviderRateLimits,
  RateLimitWindow,
  UsageRateLimitFailureKind,
  UsageRateLimitMetadata,
  UsageRateLimitSource
} from '../../shared/rate-limit-types'
import type { NetworkProxySettings } from '../../shared/network-proxy'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth-service'
import { OAuthUsageError } from './claude-oauth-usage-error'
import { mapClaudeUsageWindow } from './claude-usage-window'
import { withMacTailscaleDnsHint } from '../network/macos-tailscale-dns-diagnostic'
import {
  classifyClaudeOAuthUsageError,
  type ClaudeUsageErrorClassification
} from './claude-usage-error-classification'
import {
  readOAuthCredentials,
  type OAuthCredentialReadResult
} from './claude-oauth-credentials'
import {
  abortedClaudeRateLimitResult,
  fetchViaOAuth,
  type OAuthUsageWindow,
  type OAuthUsageLimit,
  type OAuthUsageResponse
} from './claude-oauth-fetch'

export function recordAttempt(
  state: ClaudeUsageAttemptState,
  source: UsageRateLimitSource
): UsageRateLimitSource[] {
  if (!state.attemptedSources.includes(source)) {
    state.attemptedSources.push(source)
  }
  return state.attemptedSources
}
export function withClaudeUsageMetadata(
  limits: ProviderRateLimits,
  metadata: UsageRateLimitMetadata
): ProviderRateLimits {
  return {
    ...limits,
    usageMetadata: {
      ...limits.usageMetadata,
      ...metadata,
      attemptedSources: metadata.attemptedSources ?? limits.usageMetadata?.attemptedSources
    }
  }
}

export function makeClaudeUsageResult(
  status: ProviderRateLimits['status'],
  error: string | null,
  metadata: UsageRateLimitMetadata
): ProviderRateLimits {
  return {
    provider: 'claude',
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    error,
    status,
    usageMetadata: metadata
  }
}

export function metadataForAttempt(input: {
  attemptedSources: UsageRateLimitSource[]
  oauthCredentials: OAuthCredentialReadResult
  authPreparation?: ClaudeRuntimeAuthPreparation
  source?: UsageRateLimitSource
  failureKind?: UsageRateLimitFailureKind
  deferredByLiveClaudeSession?: boolean
  retryAtMs?: number
}): UsageRateLimitMetadata {
  return {
    source: input.source,
    attemptedSources: [...input.attemptedSources],
    failureKind: input.failureKind,
    credentialSource: input.oauthCredentials.source,
    authProvenance: input.authPreparation?.provenance ?? 'system',
    deferredByLiveClaudeSession: input.deferredByLiveClaudeSession,
    retryAtMs: input.retryAtMs
  }
}

export function classifyClaudeCliUsageFailure(
  limits: ProviderRateLimits
): UsageRateLimitFailureKind | undefined {
  if (!limits.error) {
    return undefined
  }
  if (/rate limited/i.test(limits.error)) {
    return 'rate-limited'
  }
  if (/plan usage is unavailable|usage is unavailable/i.test(limits.error)) {
    return 'usage-unavailable'
  }
  return 'cli-unavailable'
}

export async function fetchClaudeUsageViaCli(input: {
  authPreparation?: ClaudeRuntimeAuthPreparation
  oauthCredentials: OAuthCredentialReadResult
  attempts: ClaudeUsageAttemptState
  networkProxySettings?: NetworkProxySettings
  signal?: AbortSignal
}): Promise<ProviderRateLimits> {
  recordAttempt(input.attempts, 'cli')
  const limits = await fetchViaPty({
    authPreparation: input.authPreparation,
    networkProxySettings: input.networkProxySettings,
    signal: input.signal
  })
  return withClaudeUsageMetadata(
    limits,
    metadataForAttempt({
      attemptedSources: input.attempts.attemptedSources,
      oauthCredentials: input.oauthCredentials,
      authPreparation: input.authPreparation,
      source: 'cli',
      failureKind: classifyClaudeCliUsageFailure(limits)
    })
  )
}

export function isManagedClaudeAuth(authPreparation: ClaudeRuntimeAuthPreparation | undefined): boolean {
  return authPreparation?.provenance.startsWith('managed:') === true
}

export function canSupplementOAuthUsageFromCli(input: {
  oauthLimits: ProviderRateLimits
  authPreparation?: ClaudeRuntimeAuthPreparation
  allowUsagePanelSupplement: boolean
}): boolean {
  // Why: Fable shows in Claude's /usage panel even when the OAuth endpoint reports only 5h/7d windows; supplement only after OAuth already succeeded.
  return Boolean(
    input.allowUsagePanelSupplement &&
    !input.authPreparation?.managedRefreshDeferredByLivePty &&
    !input.oauthLimits.fableWeekly &&
    (input.oauthLimits.session || input.oauthLimits.weekly)
  )
}

export function mergeClaudeUsageWindows(
  primary: ProviderRateLimits,
  supplement: ProviderRateLimits | null
): ProviderRateLimits {
  if (!supplement) {
    return primary
  }
  return {
    ...primary,
    session: primary.session ?? supplement.session,
    weekly: primary.weekly ?? supplement.weekly,
    fableWeekly: primary.fableWeekly ?? supplement.fableWeekly ?? null
  }
}

export async function supplementOAuthUsageFromCli(input: {
  oauthLimits: ProviderRateLimits
  authPreparation?: ClaudeRuntimeAuthPreparation
  oauthCredentials: OAuthCredentialReadResult
  attempts: ClaudeUsageAttemptState
  allowUsagePanelSupplement: boolean
  networkProxySettings?: NetworkProxySettings
  signal?: AbortSignal
}): Promise<ProviderRateLimits> {
  if (input.signal?.aborted || !canSupplementOAuthUsageFromCli(input)) {
    return input.oauthLimits
  }
  try {
    const cliLimits = await fetchClaudeUsageViaCli({
      authPreparation: input.authPreparation,
      oauthCredentials: input.oauthCredentials,
      attempts: input.attempts,
      networkProxySettings: input.networkProxySettings,
      signal: input.signal
    })
    return mergeClaudeUsageWindows(input.oauthLimits, cliLimits)
  } catch (err) {
    warnClaudeUsageFetchFailure(input.authPreparation, input.oauthCredentials, err)
    return input.oauthLimits
  }
}

export async function completeOAuthUsageSuccess(input: {
  oauthLimits: ProviderRateLimits
  oauthCredentials: OAuthCredentialReadResult
  attempts: ClaudeUsageAttemptState
  options?: FetchClaudeRateLimitsOptions
}): Promise<ProviderRateLimits> {
  const limits = await supplementOAuthUsageFromCli({
    oauthLimits: input.oauthLimits,
    authPreparation: input.options?.authPreparation,
    oauthCredentials: input.oauthCredentials,
    attempts: input.attempts,
    networkProxySettings: input.options?.networkProxySettings,
    allowUsagePanelSupplement:
      input.options?.allowUsagePanelSupplement ??
      isManagedClaudeAuth(input.options?.authPreparation),
    signal: input.options?.signal
  })
  if (input.options?.signal?.aborted) {
    return abortedClaudeRateLimitResult()
  }
  return withClaudeUsageMetadata(
    limits,
    metadataForAttempt({
      attemptedSources: input.attempts.attemptedSources,
      oauthCredentials: input.oauthCredentials,
      authPreparation: input.options?.authPreparation,
      source: 'oauth'
    })
  )
}

export function canRetryWithLegacyKeychainToken(input: {
  classification: ClaudeUsageErrorClassification
  oauthCredentials: OAuthCredentialReadResult
  authPreparation?: ClaudeRuntimeAuthPreparation
}): boolean {
  // Why: only host auth may fall back to the legacy keychain item when a scoped item holds a dead token that 401s forever; managed/WSL must never use the host's legacy account.
  return (
    input.classification.failureKind === 'stale-token' &&
    input.oauthCredentials.source === 'scoped-keychain' &&
    (input.authPreparation?.runtime ?? 'host') === 'host' &&
    !isManagedClaudeAuth(input.authPreparation)
  )
}

export async function retryOAuthWithLegacyKeychainToken(input: {
  failedToken: string | null
  attempts: ClaudeUsageAttemptState
  options?: FetchClaudeRateLimitsOptions
}): Promise<ProviderRateLimits | null> {
  const legacyCredentials = await readOAuthCredentials({ keychainConfigDir: undefined })
  if (!legacyCredentials.token || legacyCredentials.token === input.failedToken) {
    return null
  }
  if (input.options?.signal?.aborted) {
    return abortedClaudeRateLimitResult()
  }
  try {
    const oauthLimits = await fetchViaOAuth(legacyCredentials.token, input.options?.signal)
    if (input.options?.signal?.aborted) {
      return abortedClaudeRateLimitResult()
    }
    return await completeOAuthUsageSuccess({
      oauthLimits,
      oauthCredentials: legacyCredentials,
      attempts: input.attempts,
      options: input.options
    })
  } catch (err) {
    warnClaudeUsageFetchFailure(input.options?.authPreparation, legacyCredentials, err)
    return null
  }
}

export function shouldDeferForLiveClaude(
  authPreparation: ClaudeRuntimeAuthPreparation | undefined,
  classification: ClaudeUsageErrorClassification
): boolean {
  return Boolean(
    authPreparation?.managedRefreshDeferredByLivePty &&
    (classification.failureKind === 'stale-token' ||
      classification.failureKind === 'refreshable-credentials-without-token' ||
      classification.failureKind === 'deferred-by-live-session')
  )
}

export function liveClaudeDeferredResult(input: {
  attempts: ClaudeUsageAttemptState
  oauthCredentials: OAuthCredentialReadResult
  authPreparation?: ClaudeRuntimeAuthPreparation
}): ProviderRateLimits {
  return makeClaudeUsageResult('error', LIVE_CLAUDE_REFRESH_DEFERRED_MESSAGE, {
    ...metadataForAttempt({
      attemptedSources: input.attempts.attemptedSources,
      oauthCredentials: input.oauthCredentials,
      authPreparation: input.authPreparation,
      failureKind: 'deferred-by-live-session',
      deferredByLiveClaudeSession: true
    })
  })
}

export function errorResultForClassification(input: {
  error: unknown
  classification: ClaudeUsageErrorClassification
  attempts: ClaudeUsageAttemptState
  oauthCredentials: OAuthCredentialReadResult
  authPreparation?: ClaudeRuntimeAuthPreparation
}): ProviderRateLimits {
  const message =
    input.error instanceof Error ? input.error.message : String(input.error || 'Unknown error')
  // Why: refetching before Retry-After expires wastes the endpoint's tight budget and keeps usage stuck on "Limited"; let the service wait it out.
  const retryAfterMs = input.error instanceof OAuthUsageError ? input.error.retryAfterMs : null
  return makeClaudeUsageResult('error', withMacTailscaleDnsHint(message), {
    ...metadataForAttempt({
      attemptedSources: input.attempts.attemptedSources,
      oauthCredentials: input.oauthCredentials,
      authPreparation: input.authPreparation,
      failureKind: input.classification.failureKind,
      retryAtMs: retryAfterMs ? Date.now() + retryAfterMs : undefined
    })
  })
}

export async function attemptCliRepairThenRetryOAuth(input: {
  options?: FetchClaudeRateLimitsOptions
  attempts: ClaudeUsageAttemptState
  oauthCredentials: OAuthCredentialReadResult
}): Promise<ProviderRateLimits | null> {
  if (input.options?.signal?.aborted) {
    return abortedClaudeRateLimitResult()
  }
  let cliResult: ProviderRateLimits | null = null
  try {
    cliResult = await fetchClaudeUsageViaCli({
      authPreparation: input.options?.authPreparation,
      oauthCredentials: input.oauthCredentials,
      attempts: input.attempts,
      networkProxySettings: input.options?.networkProxySettings,
      signal: input.options?.signal
    })
  } catch (err) {
    warnClaudeUsageFetchFailure(input.options?.authPreparation, input.oauthCredentials, err)
  }

  // Why: bail before credential I/O if the fetch cycle was stopped mid-CLI-repair.
  if (input.options?.signal?.aborted) {
    return abortedClaudeRateLimitResult()
  }

  const refreshedCredentials = await readOAuthCredentials(
    resolveOAuthCredentialReadOptions(input.options?.authPreparation)
  )
  if (input.options?.signal?.aborted) {
    return abortedClaudeRateLimitResult()
  }
  if (refreshedCredentials.token) {
    recordAttempt(input.attempts, 'oauth')
    try {
      const oauthRetry = await fetchViaOAuth(refreshedCredentials.token, input.options?.signal)
      if (input.options?.signal?.aborted) {
        return abortedClaudeRateLimitResult()
      }
      const supplemented = mergeClaudeUsageWindows(oauthRetry, cliResult)
      return withClaudeUsageMetadata(
        supplemented,
        metadataForAttempt({
          attemptedSources: input.attempts.attemptedSources,
          oauthCredentials: refreshedCredentials,
          authPreparation: input.options?.authPreparation,
          source: 'oauth'
        })
      )
    } catch (err) {
      warnClaudeUsageFetchFailure(input.options?.authPreparation, refreshedCredentials, err)
    }
  }

  return cliResult
}

export type FetchClaudeRateLimitsOptions = {
  authPreparation?: ClaudeRuntimeAuthPreparation
  allowPtyFallback?: boolean
  allowUsagePanelSupplement?: boolean
  networkProxySettings?: NetworkProxySettings
  signal?: AbortSignal
}

export type FetchManagedAccountUsageOptions = {
  allowUsagePanelSupplement?: boolean
  networkProxySettings?: NetworkProxySettings
  signal?: AbortSignal
}
