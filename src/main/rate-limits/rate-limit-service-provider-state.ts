import type { BrowserWindow } from 'electron'
import type {
  CodexRateLimitResetResult,
  RateLimitState,
  ProviderRateLimits,
  InactiveAccountUsage,
  RateLimitRuntimeTarget
} from '../../shared/rate-limit-types'
import { fetchClaudeRateLimits, fetchManagedAccountUsage } from './claude-fetcher'
import type { InactiveClaudeAccountInfo } from './claude-fetcher'
import { mapClaudeUsageWindow } from './claude-usage-window'
import type { ClaudeStatusLineRateLimits } from '../../shared/claude-statusline-rate-limits'
import { consumeCodexRateLimitResetCredit, fetchCodexRateLimits } from './codex-fetcher'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth-service'
import type { NetworkProxySettings } from '../../shared/network-proxy'
import {
  normalizeClaudeAccountSelectionTarget,
  type ClaudeAccountSelectionTarget,
  type NormalizedClaudeAccountSelectionTarget
} from '../claude-accounts/runtime-selection'
import { fetchGeminiRateLimits } from './gemini-usage-fetcher'
import { fetchKimiRateLimits } from './kimi-fetcher'
import { fetchGrokRateLimits } from './grok-fetcher'
import { readGrokAuthSession } from './grok-auth'
import { hasMiniMaxSessionCookie } from '../minimax/minimax-cookie-store'
import { fetchMiniMaxRateLimits } from './minimax-fetcher'
import { fetchOpenCodeGoRateLimits } from './opencode-go-usage-fetcher'
import {
  normalizeCodexAccountSelectionTarget,
  type CodexAccountSelectionTarget,
  type NormalizedCodexAccountSelectionTarget
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
import { RateLimitServiceQueue } from './rate-limit-service-queue'

export class RateLimitServiceProviderState extends RateLimitServiceQueue {
protected isSameCodexTarget(
    left: NormalizedCodexAccountSelectionTarget,
    right: NormalizedCodexAccountSelectionTarget
  ): boolean {
    return left.runtime === right.runtime && left.wslDistro === right.wslDistro
  }

  protected isSameClaudeTarget(
    left: NormalizedClaudeAccountSelectionTarget,
    right: NormalizedClaudeAccountSelectionTarget
  ): boolean {
    return left.runtime === right.runtime && left.wslDistro === right.wslDistro
  }

  protected getCodexProvenance(
    target: NormalizedCodexAccountSelectionTarget,
    codexHomePath: string | null
  ): string {
    const targetKey = target.runtime === 'wsl' ? `wsl:${target.wslDistro ?? '__default__'}` : 'host'
    return codexHomePath ? `${targetKey}:managed:${codexHomePath}` : `${targetKey}:system`
  }

  protected getMissingWslCodexHomeResult(
    target: NormalizedCodexAccountSelectionTarget
  ): ProviderRateLimits | null {
    if (target.runtime !== 'wsl') {
      return null
    }
    return {
      provider: 'codex',
      session: null,
      weekly: null,
      updatedAt: Date.now(),
      error: `WSL Codex home unavailable for ${target.wslDistro ?? 'default distro'}`,
      status: 'error'
    }
  }

  protected async fetchCodexResetResultState(
    target: NormalizedCodexAccountSelectionTarget,
    codexHomePath: string | null,
    stateBeforeReset: RateLimitState
  ): Promise<RateLimitState> {
    const controller = this.beginFetchCycle()
    let fresh: ProviderRateLimits
    try {
      fresh = await fetchCodexRateLimits({
        codexHomePath,
        allowPtyFallback: this.shouldAllowCodexPtyFallback(),
        signal: controller.signal
      })
    } catch (error) {
      fresh = {
        provider: 'codex',
        session: null,
        weekly: null,
        updatedAt: Date.now(),
        error: toErrorMessage(error),
        status: 'error'
      }
    } finally {
      this.finishFetchCycle(controller)
    }

    const scopedCodex = this.applyStalePolicy(fresh, stateBeforeReset.codex)
    const currentHomePath = this.codexHomePathResolver?.(target) ?? null
    const stillActive =
      this.isSameCodexTarget(this.codexFetchTarget, target) &&
      this.getCodexProvenance(target, currentHomePath) ===
        this.getCodexProvenance(target, codexHomePath)
    if (stillActive) {
      // Why: this post-redemption read is newer than every Codex fetch that
      // started before it, so invalidate those results before publishing it.
      this.codexFetchGeneration += 1
      this.trackActiveFailureStreak('codex', fresh)
      this.updateState({
        ...this.state,
        codex: this.applyStalePolicy(fresh, this.state.codex)
      })
    }

    // Why: the caller must receive the redeemed target even if the global UI
    // switched targets while the provider mutation was in flight.
    return { ...stateBeforeReset, codex: scopedCodex, codexTarget: target }
  }

  protected shouldAllowCodexPtyFallback(): boolean {
    // Why: hidden PTY fallback can crash inside ConPTY on Windows; prefer RPC-only degradation there for background quota refresh.
    return process.platform !== 'win32'
  }

  protected shouldAllowClaudePtyFallback(
    authPreparation: ClaudeRuntimeAuthPreparation | undefined
  ): boolean {
    // Why: Windows hidden PTY support is less reliable than host/WSL shells.
    if (process.platform === 'win32') {
      return false
    }
    // Why: system-default Claude isn't Orca-managed; refresh may read existing OAuth but must not launch Claude and trigger auth/browser flows.
    return !isSystemDefaultClaudeAuth(authPreparation)
  }

  protected shouldAllowClaudeUsagePanelSupplement(): boolean {
    // Why: keep this supplement off on Windows where hidden PTYs are still less reliable.
    return process.platform !== 'win32'
  }

  protected resolveMiniMaxConfig(): MiniMaxResolvedConfig {
    try {
      return {
        config: this.miniMaxConfigResolver?.() ?? {
          sessionCookie: '',
          groupId: '',
          models: 'general'
        },
        error: null
      }
    } catch (error) {
      // Why: one unreadable cookie must not abort every provider's refresh; surface it as MiniMax-only state instead.
      return {
        config: {
          sessionCookie: '',
          groupId: '',
          models: 'general'
        },
        error: toErrorMessage(error)
      }
    }
  }

  protected getMiniMaxCredentialError(message: string): ProviderRateLimits {
    return {
      provider: 'minimax',
      session: null,
      weekly: null,
      updatedAt: Date.now(),
      error: message,
      status: 'error',
      usageMetadata: { failureKind: 'keychain-unavailable', source: 'web' }
    }
  }

  // Why: hitting a usage endpoint before its Retry-After expires burns the budget for nothing and keeps the 429 window alive.
  protected isRetryAfterActive(limits: ProviderRateLimits | null): boolean {
    return Boolean(
      limits?.status === 'error' &&
      limits.usageMetadata?.retryAtMs &&
      limits.usageMetadata.retryAtMs > Date.now()
    )
  }

  // Why: a live Claude session already streams fresh usage windows; spending the OAuth usage endpoint's tight budget on the same data invites 429s.
  protected isLiveClaudeUsageFresh(limits: ProviderRateLimits | null): boolean {
    return Boolean(
      limits?.status === 'ok' &&
      limits.usageMetadata?.source === 'live-session' &&
      Date.now() - limits.updatedAt < MIN_REFETCH_MS
    )
  }

  protected shouldSkipAutomatedClaudeFetch(limits: ProviderRateLimits | null): boolean {
    return this.isRetryAfterActive(limits) || this.isLiveClaudeUsageFresh(limits)
  }

  protected resolveClaudeFetchApply(
    fresh: ProviderRateLimits,
    previous: ProviderRateLimits | null
  ): ProviderRateLimits {
    // Why: a live statusline post can land while an OAuth cycle is in flight; a failed fetch must not
    // roll the bar back to the pre-cycle snapshot or flip the just-refreshed live data to error.
    const current = this.state.claude
    if (fresh.status !== 'ok' && current && this.isLiveClaudeUsageFresh(current)) {
      return current
    }
    return this.applyStalePolicy(fresh, previous)
  }

  protected rememberClaudeAuthSnapshot(
    authPreparation: ClaudeRuntimeAuthPreparation | undefined,
    claudeGeneration: number,
    claudeTarget: NormalizedClaudeAccountSelectionTarget
  ): void {
    // Why: an account switch during the resolver await already cleared the snapshot; restoring the outgoing account's configDir here would cross-attribute its live posts to the new bar.
    if (
      claudeGeneration !== this.claudeFetchGeneration ||
      !this.isSameClaudeTarget(claudeTarget, this.claudeFetchTarget)
    ) {
      return
    }
    this.lastClaudeAuthSnapshot = {
      configDir: normalizeClaudeConfigDir(authPreparation?.envPatch.CLAUDE_CONFIG_DIR),
      provenance: authPreparation?.provenance ?? 'system'
    }
  }

  /** Live usage windows forwarded from a Claude session's statusLine command. */
  ingestLiveClaudeRateLimits(event: ClaudeStatusLineRateLimits): void {
    // Why: attribution needs the selected account's config dir; until a fetch cycle captures it, drop posts rather than guess the account.
    const snapshot = this.lastClaudeAuthSnapshot
    if (!snapshot) {
      // Why: breadcrumbs make a silently dark live feed diagnosable — dropped posts are otherwise invisible.
      console.debug('[rate-limits] dropped live Claude usage: no auth snapshot yet', {
        eventConfigDir: event.configDir
      })
      return
    }
    // Why: sessions of other accounts (or other runtimes) report their own quota; mixing them into the active account's bar would lie.
    if (normalizeClaudeConfigDir(event.configDir) !== snapshot.configDir) {
      console.debug('[rate-limits] dropped live Claude usage: configDir mismatch', {
        eventConfigDir: event.configDir,
        snapshotConfigDir: snapshot.configDir
      })
      return
    }
    const freshSession = mapClaudeUsageWindow(event.fiveHour ?? undefined, 300)
    const freshWeekly = mapClaudeUsageWindow(event.sevenDay ?? undefined, 10080)
    if (!freshSession && !freshWeekly) {
      return
    }
    const previous = this.state.claude
    // Why: statusline payloads can carry a single window; an absent one means "no update", not "cleared" — keep the other bar populated.
    const session = freshSession ?? previous?.session ?? null
    const weekly = freshWeekly ?? previous?.weekly ?? null
    if (
      previous?.status === 'ok' &&
      previous.usageMetadata?.source === 'live-session' &&
      Date.now() - previous.updatedAt < LIVE_CLAUDE_INGEST_DEDUPE_MS &&
      isSameUsageWindow(previous.session, session) &&
      isSameUsageWindow(previous.weekly, weekly)
    ) {
      return
    }
    this.activeFailureStreakByProvider.claude = 0
    this.updateState({
      ...this.state,
      claude: {
        provider: 'claude',
        session,
        weekly,
        // Why: the statusline payload has no Fable scoped window; keep the last OAuth-provided one visible.
        // Tradeoff: while live posts keep the OAuth poll gated, fableWeekly stays frozen until the session idles past the freshness window.
        fableWeekly: previous?.fableWeekly ?? null,
        updatedAt: Date.now(),
        error: null,
        status: 'ok',
        usageMetadata: {
          source: 'live-session',
          lastSuccessfulSource: 'live-session',
          credentialSource: previous?.usageMetadata?.credentialSource,
          authProvenance: snapshot.provenance
        }
      }
    })
  }

  protected trackActiveFailureStreak(
    provider: ActiveRateLimitProvider,
    fresh: ProviderRateLimits
  ): void {
    if (fresh.status === 'error') {
      this.activeFailureStreakByProvider[provider] = Math.min(
        this.activeFailureStreakByProvider[provider] + 1,
        MAX_ACTIVE_FAILURE_STREAK
      )
      return
    }
    if (fresh.status === 'ok' || fresh.status === 'unavailable') {
      this.activeFailureStreakByProvider[provider] = 0
    }
  }

  protected withFetchingStatus(
    current: ProviderRateLimits | null,
    provider:
      | 'claude'
      | 'codex'
      | 'gemini'
      | 'opencode-go'
      | 'kimi'
      | 'minimax'
      | 'grok'
      | 'antigravity'
  ): ProviderRateLimits {
    if (!current) {
      return {
        provider,
        session: null,
        weekly: null,
        updatedAt: 0,
        error: null,
        status: 'fetching'
      }
    }
    // Why: keep a settled chip visible during background refetch so a persistently failing provider doesn't flash "…" → error each cycle.
    if (current.status === 'ok' || current.status === 'error' || current.status === 'unavailable') {
      return current
    }
    return { ...current, status: 'fetching' }
  }
}



