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
import { RateLimitServicePolling } from './rate-limit-service-polling'

export class RateLimitServiceQueue extends RateLimitServicePolling {
protected async fetchAll(options?: { force?: boolean }): Promise<void> {
    if (this.isFetching) {
      if (options?.force) {
        this.fullFetchQueued = true
        return this.waitForFetchIdle()
      }
      return
    }
    this.isFetching = true

    try {
      let shouldContinue = true
      // Why: only user-directed (force) fetches may bypass a provider's Retry-After gate; queued reruns inherit force because only forced calls queue them.
      let cycleForce = options?.force ?? false
      while (shouldContinue) {
        const signal = await this.runWithFetchAbortSignal((fetchSignal) =>
          this.runFetchAllCycle(fetchSignal, { force: cycleForce })
        )
        shouldContinue = false
        cycleForce = true
        if (signal.aborted) {
          break
        }
        if (this.fullFetchQueued) {
          this.fullFetchQueued = false
          shouldContinue = true
          continue
        }
        if (this.codexOnlyFetchQueued) {
          this.codexOnlyFetchQueued = false
          const codexSignal = await this.runWithFetchAbortSignal((fetchSignal) =>
            this.runFetchCodexOnlyCycle(fetchSignal)
          )
          if (codexSignal.aborted) {
            break
          }
        }
        if (this.claudeOnlyFetchQueued) {
          this.claudeOnlyFetchQueued = false
          const claudeSignal = await this.runWithFetchAbortSignal((fetchSignal) =>
            this.runFetchClaudeOnlyCycle(fetchSignal, { force: true })
          )
          if (claudeSignal.aborted) {
            break
          }
        }
        if (this.grokOnlyFetchQueued) {
          this.grokOnlyFetchQueued = false
          const grokSignal = await this.runWithFetchAbortSignal((fetchSignal) =>
            this.runFetchGrokOnlyCycle(fetchSignal)
          )
          if (grokSignal.aborted) {
            break
          }
        }
      }
    } finally {
      this.isFetching = false
      this.resolveFetchIdleWaiters()
    }
  }

  protected async fetchCodexOnly(options?: { force?: boolean }): Promise<void> {
    if (this.isFetching) {
      if (options?.force) {
        this.codexOnlyFetchQueued = true
        return this.waitForFetchIdle()
      }
      return
    }
    this.isFetching = true

    try {
      let shouldContinue = true
      while (shouldContinue) {
        const signal = await this.runWithFetchAbortSignal((fetchSignal) =>
          this.runFetchCodexOnlyCycle(fetchSignal)
        )
        shouldContinue = false
        if (signal.aborted) {
          break
        }
        if (this.fullFetchQueued) {
          this.fullFetchQueued = false
          const fullSignal = await this.runWithFetchAbortSignal((fetchSignal) =>
            this.runFetchAllCycle(fetchSignal, { force: true })
          )
          if (fullSignal.aborted) {
            break
          }
          continue
        }
        if (this.codexOnlyFetchQueued) {
          this.codexOnlyFetchQueued = false
          shouldContinue = true
        }
        if (this.claudeOnlyFetchQueued) {
          this.claudeOnlyFetchQueued = false
          const claudeSignal = await this.runWithFetchAbortSignal((fetchSignal) =>
            this.runFetchClaudeOnlyCycle(fetchSignal, { force: true })
          )
          if (claudeSignal.aborted) {
            break
          }
        }
        if (this.grokOnlyFetchQueued) {
          this.grokOnlyFetchQueued = false
          const grokSignal = await this.runWithFetchAbortSignal((fetchSignal) =>
            this.runFetchGrokOnlyCycle(fetchSignal)
          )
          if (grokSignal.aborted) {
            break
          }
        }
      }
    } finally {
      this.isFetching = false
      this.resolveFetchIdleWaiters()
    }
  }

  protected async fetchClaudeOnly(options?: { force?: boolean }): Promise<void> {
    if (this.isFetching) {
      if (options?.force) {
        this.claudeOnlyFetchQueued = true
        return this.waitForFetchIdle()
      }
      return
    }
    this.isFetching = true

    try {
      let shouldContinue = true
      // Why: only user-directed (force) fetches may bypass a provider's Retry-After gate; queued reruns inherit force because only forced calls queue them.
      let cycleForce = options?.force ?? false
      while (shouldContinue) {
        const signal = await this.runWithFetchAbortSignal((fetchSignal) =>
          this.runFetchClaudeOnlyCycle(fetchSignal, { force: cycleForce })
        )
        shouldContinue = false
        cycleForce = true
        if (signal.aborted) {
          break
        }
        if (this.fullFetchQueued) {
          this.fullFetchQueued = false
          const fullSignal = await this.runWithFetchAbortSignal((fetchSignal) =>
            this.runFetchAllCycle(fetchSignal, { force: true })
          )
          if (fullSignal.aborted) {
            break
          }
          continue
        }
        if (this.claudeOnlyFetchQueued) {
          this.claudeOnlyFetchQueued = false
          shouldContinue = true
        }
        if (this.codexOnlyFetchQueued) {
          this.codexOnlyFetchQueued = false
          const codexSignal = await this.runWithFetchAbortSignal((fetchSignal) =>
            this.runFetchCodexOnlyCycle(fetchSignal)
          )
          if (codexSignal.aborted) {
            break
          }
        }
        if (this.grokOnlyFetchQueued) {
          this.grokOnlyFetchQueued = false
          const grokSignal = await this.runWithFetchAbortSignal((fetchSignal) =>
            this.runFetchGrokOnlyCycle(fetchSignal)
          )
          if (grokSignal.aborted) {
            break
          }
        }
      }
    } finally {
      this.isFetching = false
      this.resolveFetchIdleWaiters()
    }
  }

  protected async fetchGrokOnly(options?: { force?: boolean }): Promise<void> {
    if (this.isFetching) {
      if (options?.force) {
        this.grokOnlyFetchQueued = true
        return this.waitForFetchIdle()
      }
      return
    }
    this.isFetching = true

    try {
      let shouldContinue = true
      while (shouldContinue) {
        const signal = await this.runWithFetchAbortSignal((fetchSignal) =>
          this.runFetchGrokOnlyCycle(fetchSignal)
        )
        shouldContinue = false
        if (signal.aborted) {
          break
        }
        if (this.fullFetchQueued) {
          this.fullFetchQueued = false
          const fullSignal = await this.runWithFetchAbortSignal((fetchSignal) =>
            this.runFetchAllCycle(fetchSignal, { force: true })
          )
          if (fullSignal.aborted) {
            break
          }
          continue
        }
        if (this.grokOnlyFetchQueued) {
          this.grokOnlyFetchQueued = false
          shouldContinue = true
        }
        if (this.codexOnlyFetchQueued) {
          this.codexOnlyFetchQueued = false
          const codexSignal = await this.runWithFetchAbortSignal((fetchSignal) =>
            this.runFetchCodexOnlyCycle(fetchSignal)
          )
          if (codexSignal.aborted) {
            break
          }
        }
        if (this.claudeOnlyFetchQueued) {
          this.claudeOnlyFetchQueued = false
          const claudeSignal = await this.runWithFetchAbortSignal((fetchSignal) =>
            this.runFetchClaudeOnlyCycle(fetchSignal, { force: true })
          )
          if (claudeSignal.aborted) {
            break
          }
        }
      }
    } finally {
      this.isFetching = false
      this.resolveFetchIdleWaiters()
    }
  }

  protected waitForFetchIdle(): Promise<void> {
    if (
      !this.isFetching &&
      !this.fullFetchQueued &&
      !this.codexOnlyFetchQueued &&
      !this.claudeOnlyFetchQueued &&
      !this.grokOnlyFetchQueued
    ) {
      return Promise.resolve()
    }
    // Why: explicit-refresh callers must await the queued follow-up cycle when a poll is in flight, else the UI stops spinning early.
    return new Promise((resolve) => {
      this.fetchIdleResolvers.push(resolve)
    })
  }

  protected resolveFetchIdleWaiters(): void {
    if (
      this.isFetching ||
      this.fullFetchQueued ||
      this.codexOnlyFetchQueued ||
      this.claudeOnlyFetchQueued ||
      this.grokOnlyFetchQueued
    ) {
      return
    }
    const resolvers = this.fetchIdleResolvers
    this.fetchIdleResolvers = []
    for (const resolve of resolvers) {
      resolve()
    }
  }

  protected beginFetchCycle(): AbortController {
    const controller = new AbortController()
    this.activeFetchAbortControllers.add(controller)
    return controller
  }

  protected finishFetchCycle(controller: AbortController): void {
    this.activeFetchAbortControllers.delete(controller)
  }

  protected async runWithFetchAbortSignal(
    fn: (signal: AbortSignal) => Promise<void>
  ): Promise<AbortSignal> {
    const controller = this.beginFetchCycle()
    try {
      await fn(controller.signal)
      return controller.signal
    } finally {
      this.finishFetchCycle(controller)
    }
  }

  protected abortActiveFetchCycle(): void {
    for (const controller of this.activeFetchAbortControllers) {
      controller.abort()
    }
    this.activeFetchAbortControllers.clear()
  }

  protected clearQueuedFetches(): void {
    this.fullFetchQueued = false
    this.codexOnlyFetchQueued = false
    this.claudeOnlyFetchQueued = false
    this.grokOnlyFetchQueued = false
  }

  protected resolveAndClearFetchIdleWaiters(): void {
    const resolvers = this.fetchIdleResolvers
    this.fetchIdleResolvers = []
    for (const resolve of resolvers) {
      resolve()
    }
  }
}


