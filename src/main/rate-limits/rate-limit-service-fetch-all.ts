import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { fetchClaudeRateLimits } from './claude-fetcher'
import { fetchCodexRateLimits } from './codex-fetcher'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth-service'
import {
  type ClaudeAccountSelectionTarget,
} from '../claude-accounts/runtime-selection'
import { fetchGeminiRateLimits } from './gemini-usage-fetcher'
import { fetchKimiRateLimits } from './kimi-fetcher'
import { fetchGrokRateLimits } from './grok-fetcher'
import { readGrokAuthSession } from './grok-auth'
import { fetchMiniMaxRateLimits } from './minimax-fetcher'
import { fetchOpenCodeGoRateLimits } from './opencode-go-usage-fetcher'
import {
  type CodexAccountSelectionTarget,
} from '../codex-accounts/runtime-selection'

export type InactiveCodexAccountInfo = {
  id: string
  managedHomePath: string
}
type CodexHomePathResolver = (target?: CodexAccountSelectionTarget) => string | null
type ClaudeAuthPreparationResolver = (
  target?: ClaudeAccountSelectionTarget
) => Promise<ClaudeRuntimeAuthPreparation>

type OpenCodeGoRateLimitConfig = {
  sessionCookie: string
  workspaceIdOverride: string
}

type MiniMaxRateLimitConfig = {
  sessionCookie: string
  groupId: string
  models: string
}

type MiniMaxResolvedConfig = {
  config: MiniMaxRateLimitConfig
  error: string | null
}

type GeminiCliOAuthEnabledResolver = () => boolean
type ActiveRateLimitProvider = ProviderRateLimits['provider']
type ActiveProviderState = {
  provider: ActiveRateLimitProvider
  limits: ProviderRateLimits | null
}
type ActiveWindowRefreshPlan =
  | { kind: 'none' }
  | { kind: 'full' }
  | { kind: 'providers'; providers: ActiveRateLimitProvider[] }

// Why: Claude's usage endpoint has a tight budget and quota is only informational; prefer a recent snapshot over polling into 429s.
const DEFAULT_POLL_MS = 15 * 60 * 1000 // 15 minutes
const MIN_POLL_MS = 30 * 1000 // 30 seconds — renderer input should never create a tight loop.
const MAX_POLL_MS = 2_147_483_647 // Max safe setInterval delay before Node clamps back to 1ms.
const MIN_REFETCH_MS = 5 * 60 * 1000 // 5 minutes — debounce resume/manual refresh bursts
const ACTIVE_FAILURE_REFETCH_MS = MIN_POLL_MS
// Why: retrying a persistent failure at the 30s floor hammers endpoints into 429s; back off per failure, capped at the poll cadence.
const MAX_ACTIVE_FAILURE_REFETCH_MS = DEFAULT_POLL_MS
const MAX_ACTIVE_FAILURE_STREAK = 8
// Why: these providers have a dedicated fetch cycle, so an activation retry refreshes just the failing one; others force a full fetchAll.
const INDIVIDUALLY_REFRESHABLE_PROVIDERS: ReadonlySet<ActiveRateLimitProvider> = new Set([
  'claude',
  'codex',
  'grok'
])
const STALE_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes — after this, stale data is dropped
// Why: usage-endpoint 429 windows can outlast the generic threshold (Retry-After ~1h); quota is informational, so a stale snapshot beats a bare "Limited".
const RATE_LIMITED_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000
// Why: statusline posts arrive on every turn; skip renderer pushes for identical windows so streaming sessions don't spam state updates.
const LIVE_CLAUDE_INGEST_DEDUPE_MS = 30 * 1000
const INACTIVE_FETCH_DEBOUNCE_MS = 60 * 1000 // 60 seconds — debounce fetch-on-open
const DEFERRED_STARTUP_ACTIVE_REFRESH_MS = 1000

// Why: inactive account arrays are derived from provider caches on demand in getState()/pushToRenderer().
type InternalRateLimitState = {
  claude: ProviderRateLimits | null
  codex: ProviderRateLimits | null
  gemini: ProviderRateLimits | null
  opencodeGo: ProviderRateLimits | null
  kimi: ProviderRateLimits | null
  antigravity: ProviderRateLimits | null
  minimax: ProviderRateLimits | null
  grok: ProviderRateLimits | null
}

function normalizePollingInterval(ms: number): number {
  if (!Number.isFinite(ms)) {
    return DEFAULT_POLL_MS
  }
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, ms))
}

function isSystemDefaultClaudeAuth(
  authPreparation: ClaudeRuntimeAuthPreparation | undefined
): boolean {
  // Why: fetch cycles treat missing Claude auth as system-default; align the PTY gate so refresh can't trigger auth flows.
  if (!authPreparation) {
    return true
  }
  const provenance = authPreparation?.provenance
  return provenance === 'system' || Boolean(provenance?.endsWith(':system'))
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeClaudeConfigDir(dir: string | null | undefined): string | null {
  // Why: the same dir can arrive with mixed separators (Windows env vs statusline JSON); unify them so attribution compares paths, not spellings. Case is left alone — Linux paths are case-sensitive.
  const trimmed = dir?.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return trimmed || null
}

function isSameUsageWindow(
  a: ProviderRateLimits['session'],
  b: ProviderRateLimits['session']
): boolean {
  if (!a || !b) {
    return a === b
  }
  return a.usedPercent === b.usedPercent && a.resetsAt === b.resetsAt
}
import { RateLimitServiceFetchPolicy } from './rate-limit-service-fetch-policy'


export class RateLimitServiceFetchAll extends RateLimitServiceFetchPolicy {
protected async runFetchAllCycle(
    signal: AbortSignal,
    options?: { force?: boolean }
  ): Promise<void> {
    if (signal.aborted) {
      return
    }
    const claudeTarget = this.claudeFetchTarget
    // Why: capture before the resolver await so an account switch during it invalidates both the snapshot and the state apply.
    const claudeGeneration = this.claudeFetchGeneration
    const claudeAuthPreparation = await this.claudeAuthPreparationResolver?.(claudeTarget)
    if (signal.aborted) {
      return
    }
    this.rememberClaudeAuthSnapshot(claudeAuthPreparation, claudeGeneration, claudeTarget)
    const claudeProvenance = claudeAuthPreparation?.provenance ?? 'system'
    const codexTarget = this.codexFetchTarget
    const codexHomePath = this.codexHomePathResolver?.(codexTarget) ?? null
    const codexProvenance = this.getCodexProvenance(codexTarget, codexHomePath)
    const codexGeneration = this.codexFetchGeneration
    const previousState = this.state
    const openCodeGoConfig = this.openCodeGoConfigResolver?.()
    const cookie = openCodeGoConfig?.sessionCookie ?? ''
    const workspaceIdOverride = openCodeGoConfig?.workspaceIdOverride ?? ''
    const miniMaxConfigResult = this.resolveMiniMaxConfig()
    const miniMaxCookie = miniMaxConfigResult.config.sessionCookie
    const miniMaxGroupId = miniMaxConfigResult.config.groupId
    const miniMaxModels = miniMaxConfigResult.config.models
    const geminiCliOAuthEnabled = this.geminiCliOAuthEnabledResolver?.() ?? false
    // Why: getState() is hot (renderer pushes + mobile snapshots); keep Grok's sync auth-file probe on fetch cycles instead.
    const grokAuthReadResult = readGrokAuthSession()
    this.grokAuthConfigured = grokAuthReadResult.status === 'ok'

    // Discard stale data on config change — it belongs to a different session/workspace.
    const currentConfigHash = `${cookie}|${workspaceIdOverride}`
    const opencodeConfigChanged = currentConfigHash !== this.lastOpencodeConfigHash
    if (opencodeConfigChanged) {
      this.lastOpencodeConfigHash = currentConfigHash
      this.opencodeFetchGeneration += 1
    }
    const opencodeGeneration = this.opencodeFetchGeneration

    const currentMiniMaxConfigHash = `${miniMaxCookie}|${miniMaxGroupId}|${miniMaxModels}|${miniMaxConfigResult.error ?? ''}`
    const miniMaxConfigChanged = currentMiniMaxConfigHash !== this.lastMiniMaxConfigHash
    if (miniMaxConfigChanged) {
      this.lastMiniMaxConfigHash = currentMiniMaxConfigHash
      this.minimaxFetchGeneration += 1
    }
    const miniMaxGeneration = this.minimaxFetchGeneration

    // Mark all providers fetching while keeping previous data visible (Codex is cleared separately on account change).
    this.updateState({
      ...previousState,
      claude: this.withFetchingStatus(previousState.claude, 'claude'),
      codex: this.withFetchingStatus(previousState.codex, 'codex'),
      gemini: this.withFetchingStatus(previousState.gemini, 'gemini'),
      opencodeGo: opencodeConfigChanged
        ? this.withFetchingStatus(null, 'opencode-go')
        : this.withFetchingStatus(previousState.opencodeGo, 'opencode-go'),
      kimi: this.withFetchingStatus(previousState.kimi, 'kimi'),
      antigravity: this.withFetchingStatus(previousState.antigravity, 'antigravity'),
      minimax: miniMaxConfigChanged
        ? this.withFetchingStatus(null, 'minimax')
        : this.withFetchingStatus(previousState.minimax, 'minimax'),
      grok: this.withFetchingStatus(previousState.grok, 'grok')
    })

    const missingWslCodexHome = codexHomePath
      ? null
      : this.getMissingWslCodexHomeResult(codexTarget)
    const grokResultPromise = fetchGrokRateLimits({
      signal,
      authReadResult: grokAuthReadResult
    }).then(
      (value) => ({ status: 'fulfilled', value }) as const,
      (reason) => ({ status: 'rejected', reason }) as const
    )

    // Why: skip automated Claude fetches while a Retry-After window is open or a live session feed is fresher than the OAuth poll would be.
    const claudeFetchGated =
      !options?.force && this.shouldSkipAutomatedClaudeFetch(previousState.claude)

    const [claudeResult, codexResult, geminiResult, opencodeGoResult, kimiResult, miniMaxResult] =
      await Promise.allSettled([
        claudeFetchGated
          ? Promise.resolve(previousState.claude as ProviderRateLimits)
          : fetchClaudeRateLimits({
              authPreparation: claudeAuthPreparation,
              allowPtyFallback: this.shouldAllowClaudePtyFallback(claudeAuthPreparation),
              allowUsagePanelSupplement: this.shouldAllowClaudeUsagePanelSupplement(),
              networkProxySettings: this.networkProxySettingsResolver?.(),
              signal
            }),
        missingWslCodexHome ??
          fetchCodexRateLimits({
            codexHomePath,
            allowPtyFallback: this.shouldAllowCodexPtyFallback(),
            signal
          }),
        fetchGeminiRateLimits(geminiCliOAuthEnabled),
        fetchOpenCodeGoRateLimits(
          cookie,
          workspaceIdOverride || undefined,
          this.networkProxySettingsResolver?.()
        ),
        fetchKimiRateLimits(),
        miniMaxConfigResult.error
          ? Promise.resolve(this.getMiniMaxCredentialError(miniMaxConfigResult.error))
          : fetchMiniMaxRateLimits({
              cookie: miniMaxCookie,
              groupId: miniMaxGroupId,
              models: miniMaxModels
            })
      ])

    if (signal.aborted) {
      return
    }

    const claude =
      claudeResult.status === 'fulfilled'
        ? claudeResult.value
        : ({
            provider: 'claude',
            session: null,
            weekly: null,
            updatedAt: Date.now(),
            error:
              claudeResult.reason instanceof Error ? claudeResult.reason.message : 'Unknown error',
            status: 'error'
          } satisfies ProviderRateLimits)

    const codex =
      codexResult.status === 'fulfilled'
        ? codexResult.value
        : ({
            provider: 'codex',
            session: null,
            weekly: null,
            updatedAt: Date.now(),
            error:
              codexResult.reason instanceof Error ? codexResult.reason.message : 'Unknown error',
            status: 'error'
          } satisfies ProviderRateLimits)

    const gemini =
      geminiResult.status === 'fulfilled'
        ? geminiResult.value
        : ({
            provider: 'gemini',
            session: null,
            weekly: null,
            updatedAt: Date.now(),
            error:
              geminiResult.reason instanceof Error ? geminiResult.reason.message : 'Unknown error',
            status: 'error'
          } satisfies ProviderRateLimits)

    // Why: Antigravity shares Gemini credentials today; mirror the Gemini snapshot so its status-bar UI gets a real lifecycle instead of null.
    const antigravity: ProviderRateLimits = {
      ...gemini,
      provider: 'antigravity'
    }

    const opencodeGo =
      opencodeGoResult.status === 'fulfilled'
        ? opencodeGoResult.value
        : ({
            provider: 'opencode-go',
            session: null,
            weekly: null,
            monthly: null,
            updatedAt: Date.now(),
            error:
              opencodeGoResult.reason instanceof Error
                ? opencodeGoResult.reason.message
                : 'Unknown error',
            status: 'error'
          } satisfies ProviderRateLimits)

    const kimi =
      kimiResult.status === 'fulfilled'
        ? kimiResult.value
        : ({
            provider: 'kimi',
            session: null,
            weekly: null,
            updatedAt: Date.now(),
            error: kimiResult.reason instanceof Error ? kimiResult.reason.message : 'Unknown error',
            status: 'error'
          } satisfies ProviderRateLimits)

    const miniMax =
      miniMaxResult.status === 'fulfilled'
        ? miniMaxResult.value
        : ({
            provider: 'minimax',
            session: null,
            weekly: null,
            updatedAt: Date.now(),
            error:
              miniMaxResult.reason instanceof Error
                ? miniMaxResult.reason.message
                : 'Unknown error',
            status: 'error'
          } satisfies ProviderRateLimits)

    const latestCodexHomePath = this.codexHomePathResolver?.(codexTarget) ?? null
    const latestClaudeAuthPreparation = await this.claudeAuthPreparationResolver?.(claudeTarget)
    if (signal.aborted) {
      return
    }
    const latestClaudeProvenance = latestClaudeAuthPreparation?.provenance ?? 'system'
    const latestCodexProvenance = this.getCodexProvenance(codexTarget, latestCodexHomePath)
    const shouldApplyCodex =
      codexGeneration === this.codexFetchGeneration && codexProvenance === latestCodexProvenance
    // Why: a gated cycle made no Claude attempt; applying its passthrough result would grow the failure streak and reset stale-policy clocks for free.
    const shouldApplyClaude =
      !claudeFetchGated &&
      claudeGeneration === this.claudeFetchGeneration &&
      claudeProvenance === latestClaudeProvenance &&
      this.isSameClaudeTarget(claudeTarget, this.claudeFetchTarget)
    const shouldApplyOpencode = opencodeGeneration === this.opencodeFetchGeneration
    const shouldApplyMiniMax = miniMaxGeneration === this.minimaxFetchGeneration

    if (shouldApplyClaude) {
      this.trackActiveFailureStreak('claude', claude)
    }
    if (shouldApplyCodex) {
      this.trackActiveFailureStreak('codex', codex)
    }
    this.trackActiveFailureStreak('gemini', gemini)
    this.trackActiveFailureStreak('antigravity', antigravity)
    if (shouldApplyOpencode) {
      this.trackActiveFailureStreak('opencode-go', opencodeGo)
    }
    this.trackActiveFailureStreak('kimi', kimi)
    if (shouldApplyMiniMax) {
      this.trackActiveFailureStreak('minimax', miniMax)
    }

    // Why: apply a Codex result only when provenance and generation still match, else a raced in-flight fetch overwrites the new account.
    this.updateState({
      ...this.state,
      claude: shouldApplyClaude
        ? this.resolveClaudeFetchApply(claude, previousState.claude)
        : this.state.claude,
      codex: shouldApplyCodex
        ? this.applyStalePolicy(codex, previousState.codex)
        : this.state.codex,
      gemini: this.applyStalePolicy(gemini, previousState.gemini),
      opencodeGo: shouldApplyOpencode
        ? opencodeConfigChanged
          ? opencodeGo
          : this.applyStalePolicy(opencodeGo, previousState.opencodeGo)
        : this.state.opencodeGo,
      kimi: this.applyStalePolicy(kimi, previousState.kimi),
      antigravity: this.applyStalePolicy(antigravity, previousState.antigravity),
      minimax: shouldApplyMiniMax
        ? miniMaxConfigChanged
          ? miniMax
          : this.applyStalePolicy(miniMax, previousState.minimax)
        : this.state.minimax
    })

    const grokResult = await grokResultPromise
    if (signal.aborted) {
      return
    }
    const grok =
      grokResult.status === 'fulfilled'
        ? grokResult.value
        : ({
            provider: 'grok',
            session: null,
            weekly: null,
            updatedAt: Date.now(),
            error: grokResult.reason instanceof Error ? grokResult.reason.message : 'Unknown error',
            status: 'error'
          } satisfies ProviderRateLimits)
    this.trackActiveFailureStreak('grok', grok)
    this.updateState({
      ...this.state,
      grok: this.applyStalePolicy(grok, previousState.grok)
    })
  }


}
