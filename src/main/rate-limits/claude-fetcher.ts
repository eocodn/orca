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
async function ensureProxyFromEnv(): Promise<void> {
  await ensureElectronProxyFromEnvironment({
    proxySession: session.defaultSession,
    probeUrl: OAUTH_USAGE_URL
  }).catch(() => {})
}

function resolveOAuthCredentialReadOptions(
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

function buildClaudeUsageFetchDiagnostic(
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

function warnClaudeUsageFetchFailure(
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

import { abortedClaudeRateLimitResult, fetchViaOAuth } from './claude-oauth-fetch'
import {
  recordAttempt,
  withClaudeUsageMetadata,
  makeClaudeUsageResult,
  metadataForAttempt,
  classifyClaudeCliUsageFailure,
  fetchClaudeUsageViaCli,
  isManagedClaudeAuth,
  canSupplementOAuthUsageFromCli,
  mergeClaudeUsageWindows,
  supplementOAuthUsageFromCli,
  completeOAuthUsageSuccess,
  canRetryWithLegacyKeychainToken,
  retryOAuthWithLegacyKeychainToken,
  shouldDeferForLiveClaude,
  liveClaudeDeferredResult,
  errorResultForClassification,
  attemptCliRepairThenRetryOAuth
} from './claude-oauth-attribution'
import type {
  ClaudeUsageAttemptState,
  FetchClaudeRateLimitsOptions,
  FetchManagedAccountUsageOptions
} from './claude-oauth-attribution'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchClaudeRateLimits(
  options?: FetchClaudeRateLimitsOptions
): Promise<ProviderRateLimits> {
  if (options?.signal?.aborted) {
    return abortedClaudeRateLimitResult()
  }
  const attempts: ClaudeUsageAttemptState = { attemptedSources: [] }
  const allowCliFallback = options?.allowPtyFallback !== false
  const plan = resolveClaudeUsageRefreshPlan({
    authPreparation: options?.authPreparation,
    allowCliFallback
  })

  if (options?.authPreparation?.runtime === 'wsl' && !options.authPreparation.wslLinuxConfigDir) {
    return makeClaudeUsageResult(
      'error',
      `WSL Claude config unavailable for ${options.authPreparation.wslDistro ?? 'default distro'}`,
      {
        attemptedSources: [],
        failureKind: 'cli-unavailable',
        authProvenance: options.authPreparation.provenance
      }
    )
  }

  const oauthCredentials = await readOAuthCredentials(
    resolveOAuthCredentialReadOptions(options?.authPreparation)
  )
  if (options?.signal?.aborted) {
    return abortedClaudeRateLimitResult()
  }

  if (plan.steps.some((step) => step.source === 'oauth') && oauthCredentials.token) {
    recordAttempt(attempts, 'oauth')
    try {
      const oauthLimits = await fetchViaOAuth(oauthCredentials.token, options?.signal)
      if (options?.signal?.aborted) {
        return abortedClaudeRateLimitResult()
      }
      return await completeOAuthUsageSuccess({ oauthLimits, oauthCredentials, attempts, options })
    } catch (err) {
      warnClaudeUsageFetchFailure(options?.authPreparation, oauthCredentials, err)
      const classification = classifyClaudeOAuthUsageError(err)

      if (
        canRetryWithLegacyKeychainToken({
          classification,
          oauthCredentials,
          authPreparation: options?.authPreparation
        })
      ) {
        const legacyResult = await retryOAuthWithLegacyKeychainToken({
          failedToken: oauthCredentials.token,
          attempts,
          options
        })
        if (legacyResult) {
          return legacyResult
        }
      }

      if (shouldDeferForLiveClaude(options?.authPreparation, classification)) {
        return liveClaudeDeferredResult({
          attempts,
          oauthCredentials,
          authPreparation: options?.authPreparation
        })
      }

      if (classification.shouldAttemptDelegatedRefresh && allowCliFallback) {
        const repaired = await attemptCliRepairThenRetryOAuth({
          options,
          attempts,
          oauthCredentials
        })
        if (repaired) {
          return repaired
        }
      }

      if (classification.shouldAttemptCliFallback && allowCliFallback) {
        try {
          return await fetchClaudeUsageViaCli({
            authPreparation: options?.authPreparation,
            oauthCredentials,
            attempts,
            networkProxySettings: options?.networkProxySettings,
            signal: options?.signal
          })
        } catch (ptyError) {
          warnClaudeUsageFetchFailure(options?.authPreparation, oauthCredentials, ptyError)
        }
      }

      return errorResultForClassification({
        error: err,
        classification,
        attempts,
        oauthCredentials,
        authPreparation: options?.authPreparation
      })
    }
  }

  const credentialClassification = classifyClaudeCredentialAbsence({
    hasRefreshableCredentials: oauthCredentials.hasRefreshableCredentials,
    keychainUnavailable: oauthCredentials.keychainUnavailable,
    managedRefreshDeferredByLivePty: options?.authPreparation?.managedRefreshDeferredByLivePty
  })

  if (shouldDeferForLiveClaude(options?.authPreparation, credentialClassification)) {
    return liveClaudeDeferredResult({
      attempts,
      oauthCredentials,
      authPreparation: options?.authPreparation
    })
  }

  if (
    oauthCredentials.hasRefreshableCredentials &&
    credentialClassification.shouldAttemptDelegatedRefresh &&
    allowCliFallback
  ) {
    const repaired = await attemptCliRepairThenRetryOAuth({
      options,
      attempts,
      oauthCredentials
    })
    if (repaired) {
      return repaired
    }
  }

  if (
    (oauthCredentials.token ||
      oauthCredentials.hasRefreshableCredentials ||
      oauthCredentials.keychainUnavailable) &&
    credentialClassification.shouldAttemptCliFallback &&
    allowCliFallback
  ) {
    try {
      return await fetchClaudeUsageViaCli({
        authPreparation: options?.authPreparation,
        oauthCredentials,
        attempts,
        networkProxySettings: options?.networkProxySettings,
        signal: options?.signal
      })
    } catch (err) {
      warnClaudeUsageFetchFailure(options?.authPreparation, oauthCredentials, err)
      return makeClaudeUsageResult('error', withMacTailscaleDnsHint(describeError(err)), {
        ...metadataForAttempt({
          attemptedSources: attempts.attemptedSources,
          oauthCredentials,
          authPreparation: options?.authPreparation,
          failureKind:
            credentialClassification.failureKind === 'keychain-unavailable'
              ? 'keychain-unavailable'
              : 'cli-unavailable'
        })
      })
    }
  }

  if (oauthCredentials.keychainUnavailable) {
    return makeClaudeUsageResult('error', 'Claude Keychain credentials unavailable', {
      ...metadataForAttempt({
        attemptedSources: attempts.attemptedSources,
        oauthCredentials,
        authPreparation: options?.authPreparation,
        failureKind: 'keychain-unavailable'
      })
    })
  }

  if (oauthCredentials.hasRefreshableCredentials) {
    return makeClaudeUsageResult('error', 'Claude OAuth access token unavailable', {
      ...metadataForAttempt({
        attemptedSources: attempts.attemptedSources,
        oauthCredentials,
        authPreparation: options?.authPreparation,
        failureKind: credentialClassification.failureKind
      })
    })
  }

  if (allowCliFallback && plan.steps.some((step) => step.source === 'cli')) {
    try {
      return await fetchClaudeUsageViaCli({
        authPreparation: options?.authPreparation,
        oauthCredentials,
        attempts,
        networkProxySettings: options?.networkProxySettings,
        signal: options?.signal
      })
    } catch (err) {
      warnClaudeUsageFetchFailure(options?.authPreparation, oauthCredentials, err)
    }
  }

  return makeClaudeUsageResult('unavailable', 'No subscription plan — API key billing', {
    ...metadataForAttempt({
      attemptedSources: attempts.attemptedSources,
      oauthCredentials,
      authPreparation: options?.authPreparation,
      failureKind: 'missing-credentials'
    })
  })
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

// ---------------------------------------------------------------------------
// Managed account usage (inactive accounts — fetch-on-open)
// ---------------------------------------------------------------------------

export type { InactiveClaudeAccountInfo } from './claude-managed-credentials'

async function fetchManagedUsagePanelSupplement(input: {
  account: InactiveClaudeAccountInfo
  location: ManagedCredentialsLocation
  credentialsJson: string
  oauthLimits: ProviderRateLimits
  networkProxySettings?: NetworkProxySettings
  signal?: AbortSignal
}): Promise<ProviderRateLimits | null> {
  if (input.signal?.aborted) {
    return null
  }
  const authPreparation = getManagedUsagePanelAuthPreparation(input.account, input.location)
  if (!authPreparation) {
    return null
  }
  return withManagedPreviewKeychainCredentials(input.location, input.credentialsJson, async () => {
    const cliLimits = await fetchViaPty({
      authPreparation,
      networkProxySettings: input.networkProxySettings,
      signal: input.signal
    })
    if (input.signal?.aborted) {
      return null
    }
    if (
      !canTrustManagedUsagePanelSupplement(input.oauthLimits, cliLimits, {
        requireMatchingOAuthWindow: input.location.kind === 'keychain'
      })
    ) {
      return null
    }
    const refreshedCredentials = await readStagedManagedPreviewCredentials(input.location)
    if (refreshedCredentials && refreshedCredentials !== input.credentialsJson) {
      await writeManagedCredentialsJson(input.location, refreshedCredentials)
    }
    return cliLimits
  })
}

export async function fetchManagedAccountUsage(
  account: InactiveClaudeAccountInfo,
  options: FetchManagedAccountUsageOptions = {}
): Promise<ProviderRateLimits> {
  if (options.signal?.aborted) {
    return abortedClaudeRateLimitResult()
  }
  const location = resolveManagedCredentialsLocation(account)
  let credentialsJson = location ? await readManagedCredentials(location) : null
  if (options.signal?.aborted) {
    return abortedClaudeRateLimitResult()
  }
  if (!location || !credentialsJson) {
    return {
      provider: 'claude',
      session: null,
      weekly: null,
      updatedAt: Date.now(),
      error: 'No credentials',
      status: 'error'
    }
  }

  // Why: refresh+persist an expiring token now so inactive accounts' single-use refresh tokens stay fresh for a later switch-in (persist failure is non-fatal).
  let token = parseOAuthCredentialsJson(credentialsJson, 'credentials-file').token
  if (isOauthTokenExpiring(credentialsJson)) {
    const refreshed = await refreshClaudeOauthCredentials(credentialsJson)
    if (options.signal?.aborted) {
      return abortedClaudeRateLimitResult()
    }
    if (refreshed) {
      try {
        await writeManagedCredentialsJson(location, refreshed)
      } catch {
        // Keep the refreshed token in memory; next poll refreshes again if the write failed.
      }
      credentialsJson = refreshed
      token = parseOAuthCredentialsJson(refreshed, 'credentials-file').token
    }
  }

  if (!token) {
    return {
      provider: 'claude',
      session: null,
      weekly: null,
      updatedAt: Date.now(),
      error: 'No credentials',
      status: 'error'
    }
  }

  // Why: no PTY fallback for inactive accounts — PTY only supplements after OAuth succeeds.
  const oauthLimits = await fetchViaOAuth(token, options.signal)
  if (options.signal?.aborted) {
    return abortedClaudeRateLimitResult()
  }
  if (
    !canSupplementOAuthUsageFromCli({
      oauthLimits,
      authPreparation: undefined,
      allowUsagePanelSupplement: options.allowUsagePanelSupplement === true
    })
  ) {
    return oauthLimits
  }
  try {
    const cliLimits = await fetchManagedUsagePanelSupplement({
      account,
      location,
      credentialsJson,
      oauthLimits,
      networkProxySettings: options.networkProxySettings,
      signal: options.signal
    })
    return mergeClaudeUsageWindows(oauthLimits, cliLimits)
  } catch (err) {
    warnClaudeUsageFetchFailure(
      undefined,
      parseOAuthCredentialsJson(credentialsJson, 'credentials-file'),
      err
    )
    return oauthLimits
  }
}
