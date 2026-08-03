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
import { RateLimitServiceInactive } from './rate-limit-service-inactive'

export class RateLimitServicePolling extends RateLimitServiceInactive {
setPollingInterval(ms: number): void {
    this.pollInterval = normalizePollingInterval(ms)
    if (this.timer) {
      this.stopTimer()
      this.startTimer()
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  protected startTimer(): void {
    this.stopTimer()
    this.timer = setInterval(() => {
      if (!this.shouldBackgroundPoll()) {
        return
      }
      void this.fetchAll()
    }, this.pollInterval)
  }

  protected stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  protected scheduleDeferredStartupRefresh(): void {
    this.clearDeferredStartupRefresh()
    this.deferredStartupRefreshTimer = setTimeout(() => {
      this.deferredStartupRefreshTimer = null
      void this.refreshIfWindowActive()
    }, DEFERRED_STARTUP_ACTIVE_REFRESH_MS)
  }

  protected clearDeferredStartupRefresh(): void {
    if (this.deferredStartupRefreshTimer) {
      clearTimeout(this.deferredStartupRefreshTimer)
      this.deferredStartupRefreshTimer = null
    }
  }

  protected shouldBackgroundPoll(): boolean {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return false
    }
    // Why: these fetches only power in-app UI; skip polling when hidden/minimized/unfocused to save CLI/API budget (refresh on activate).
    if (!this.mainWindow.isVisible() || this.mainWindow.isMinimized()) {
      return false
    }
    return this.mainWindow.isFocused()
  }

  protected getActiveProviderState(): ActiveProviderState[] {
    // Why: key by provider so a new provider is compile-forced an entry — a missing one silently never recovers from a startup error.
    const byProvider: Record<ActiveRateLimitProvider, ProviderRateLimits | null> = {
      claude: this.state.claude,
      codex: this.state.codex,
      gemini: this.state.gemini,
      'opencode-go': this.state.opencodeGo,
      kimi: this.state.kimi,
      minimax: this.state.minimax,
      grok: this.state.grok,
      antigravity: this.state.antigravity
    }
    return Object.entries(byProvider).map(([provider, limits]) => ({
      provider: provider as ActiveRateLimitProvider,
      limits
    }))
  }

  protected getActiveWindowRefreshPlan(now: number): ActiveWindowRefreshPlan {
    const retryableFailures: ActiveRateLimitProvider[] = []
    for (const { provider, limits } of this.getActiveProviderState()) {
      if (!limits || limits.status === 'idle' || limits.status === 'fetching') {
        return { kind: 'full' }
      }
      if (limits.status === 'ok' || limits.status === 'unavailable') {
        if (now - limits.updatedAt >= MIN_REFETCH_MS) {
          return { kind: 'full' }
        }
        continue
      }
      // Why: a failed startup read is not fresh data; keep it eligible for activation recovery, throttled per provider.
      if (limits.status === 'error') {
        // Why: the server told us when to come back (Retry-After); retrying earlier burns the endpoint's budget and keeps the 429 alive.
        if (this.isRetryAfterActive(limits)) {
          continue
        }
        const lastRetryAt = this.lastActiveFailureRetryAtByProvider[provider]
        const throttleMs = INDIVIDUALLY_REFRESHABLE_PROVIDERS.has(provider)
          ? Math.min(
              ACTIVE_FAILURE_REFETCH_MS *
                2 ** Math.max(0, this.activeFailureStreakByProvider[provider] - 1),
              MAX_ACTIVE_FAILURE_REFETCH_MS
            )
          : MIN_REFETCH_MS
        if (now - lastRetryAt >= throttleMs) {
          retryableFailures.push(provider)
        }
      }
    }

    if (retryableFailures.length === 0) {
      return { kind: 'none' }
    }
    return { kind: 'providers', providers: retryableFailures }
  }

  protected async runActiveWindowRefreshPlan(plan: ActiveWindowRefreshPlan): Promise<void> {
    if (plan.kind === 'none') {
      return
    }
    if (plan.kind === 'full') {
      // Why: a full fetch retries failing providers too; restart their retry clocks so the individual failure lane doesn't fire ahead of backoff.
      // Why: gated on !isFetching — the fetchAll below no-ops mid-flight, so don't consume the retry throttle for free.
      if (!this.isFetching) {
        const now = Date.now()
        for (const { provider, limits } of this.getActiveProviderState()) {
          if (limits?.status === 'error') {
            this.lastActiveFailureRetryAtByProvider[provider] = now
          }
        }
      }
      await this.fetchAll()
      return
    }

    // Why: an in-flight fetch will refresh these; skip without consuming the per-provider retry throttle so the next activation retries.
    if (this.isFetching) {
      return
    }

    const now = Date.now()
    for (const provider of plan.providers) {
      this.lastActiveFailureRetryAtByProvider[provider] = now
    }

    const canRefreshIndividually = plan.providers.every((provider) =>
      INDIVIDUALLY_REFRESHABLE_PROVIDERS.has(provider)
    )
    if (!canRefreshIndividually) {
      await this.fetchAll()
      return
    }

    // Why: recover partial failures of dedicated-fetch providers without re-reading healthy providers still inside their debounce.
    if (plan.providers.includes('claude')) {
      await this.fetchClaudeOnly()
    }
    if (plan.providers.includes('codex')) {
      await this.fetchCodexOnly()
    }
    if (plan.providers.includes('grok')) {
      await this.fetchGrokOnly()
    }
  }

  protected async refreshIfWindowActive(): Promise<void> {
    if (!this.shouldBackgroundPoll()) {
      return
    }
    const plan = this.getActiveWindowRefreshPlan(Date.now())
    await this.runActiveWindowRefreshPlan(plan)
  }
}


