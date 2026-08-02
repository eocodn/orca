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

export class RateLimitServiceBase  {
  protected state: InternalRateLimitState = {
    claude: null,
    codex: null,
    gemini: null,
    opencodeGo: null,
    kimi: null,
    antigravity: null,
    minimax: null,
    grok: null
  }
  protected grokAuthConfigured = readGrokAuthSession().status === 'ok'
  protected pollInterval: number = DEFAULT_POLL_MS
  protected timer: ReturnType<typeof setInterval> | null = null
  protected deferredStartupRefreshTimer: ReturnType<typeof setTimeout> | null = null
  // Why: throttle repeated focus/show/restore events so one outage doesn't create a tight provider retry loop.
  protected lastActiveFailureRetryAtByProvider: Record<ActiveRateLimitProvider, number> = {
    claude: 0,
    codex: 0,
    gemini: 0,
    'opencode-go': 0,
    kimi: 0,
    minimax: 0,
    grok: 0,
    antigravity: 0
  }
  // Why: consecutive failures drive exponential backoff of the fast activation-retry lane; reset on any success/unavailable result.
  protected activeFailureStreakByProvider: Record<ActiveRateLimitProvider, number> = {
    claude: 0,
    codex: 0,
    gemini: 0,
    'opencode-go': 0,
    kimi: 0,
    minimax: 0,
    grok: 0,
    antigravity: 0
  }
  protected mainWindow: BrowserWindow | null = null
  protected detachWindowListeners: (() => void) | null = null
  protected isFetching = false
  protected fullFetchQueued = false
  protected codexOnlyFetchQueued = false
  protected claudeOnlyFetchQueued = false
  protected grokOnlyFetchQueued = false
  protected activeFetchAbortControllers = new Set<AbortController>()
  protected fetchIdleResolvers: (() => void)[] = []
  protected codexFetchGeneration = 0
  protected claudeFetchGeneration = 0
  // Why: statusline ingest must attribute live windows to the selected account without re-running the side-effectful auth sync per post.
  protected lastClaudeAuthSnapshot: { configDir: string | null; provenance: string } | null = null
  protected opencodeFetchGeneration = 0
  protected minimaxFetchGeneration = 0
  protected lastOpencodeConfigHash = ''
  protected lastMiniMaxConfigHash = ''
  protected codexHomePathResolver: CodexHomePathResolver | null = null
  protected codexFetchTarget: NormalizedCodexAccountSelectionTarget = {
    runtime: 'host',
    wslDistro: null
  }
  protected claudeAuthPreparationResolver: ClaudeAuthPreparationResolver | null = null
  protected claudeFetchTarget: NormalizedClaudeAccountSelectionTarget = {
    runtime: 'host',
    wslDistro: null
  }
  protected openCodeGoConfigResolver: (() => OpenCodeGoRateLimitConfig) | null = null
  protected miniMaxConfigResolver: (() => MiniMaxRateLimitConfig) | null = null
  protected geminiCliOAuthEnabledResolver: GeminiCliOAuthEnabledResolver | null = null
  protected inactiveClaudeAccountsResolver: (() => InactiveClaudeAccountInfo[]) | null = null
  protected inactiveCodexAccountsResolver: (() => InactiveCodexAccountInfo[]) | null = null
  protected networkProxySettingsResolver: (() => NetworkProxySettings) | null = null
  protected inactiveClaudeCache = new Map<string, ProviderRateLimits>()
  protected inactiveCodexCache = new Map<string, ProviderRateLimits>()
  protected inactiveClaudeFetching = new Set<string>()
  protected inactiveCodexFetching = new Set<string>()
  protected lastInactiveClaudeFetchAt = 0
  protected inactiveClaudeAccountsGeneration = 0
  protected lastInactiveCodexFetchAt = 0
  protected inactiveCodexAccountsGeneration = 0
  protected stateListeners = new Set<(state: RateLimitState) => void>()

  constructor() {}

  onStateChange(listener: (state: RateLimitState) => void): () => void {
    this.stateListeners.add(listener)
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  setCodexHomePathResolver(resolver: CodexHomePathResolver): void {
    this.codexHomePathResolver = resolver
  }

  setCodexFetchTarget(target?: CodexAccountSelectionTarget): void {
    this.codexFetchTarget = normalizeCodexAccountSelectionTarget(target)
  }

  setClaudeAuthPreparationResolver(resolver: ClaudeAuthPreparationResolver): void {
    this.claudeAuthPreparationResolver = resolver
  }

  setClaudeFetchTarget(target?: ClaudeAccountSelectionTarget): void {
    this.claudeFetchTarget = normalizeClaudeAccountSelectionTarget(target)
  }

  setOpenCodeGoConfigResolver(resolver: () => OpenCodeGoRateLimitConfig): void {
    this.openCodeGoConfigResolver = resolver
  }

  setMiniMaxConfigResolver(resolver: () => MiniMaxRateLimitConfig): void {
    this.miniMaxConfigResolver = resolver
  }

  setGeminiCliOAuthEnabledResolver(resolver: GeminiCliOAuthEnabledResolver): void {
    this.geminiCliOAuthEnabledResolver = resolver
  }

  setNetworkProxySettingsResolver(resolver: () => NetworkProxySettings): void {
    this.networkProxySettingsResolver = resolver
  }

  setInactiveClaudeAccountsResolver(resolver: () => InactiveClaudeAccountInfo[]): void {
    this.inactiveClaudeAccountsResolver = resolver
    this.inactiveClaudeAccountsGeneration += 1
  }

  setInactiveCodexAccountsResolver(resolver: () => InactiveCodexAccountInfo[]): void {
    this.inactiveCodexAccountsResolver = resolver
    this.inactiveCodexAccountsGeneration += 1
    this.pruneInactiveCodexState()
  }
  protected isCurrentInactiveClaudeAccount(..._args: any[]): any {}
  protected isCurrentInactiveCodexAccount(..._args: any[]): any {}
  protected pruneInactiveClaudeState(..._args: any[]): any {}
  protected pruneInactiveCodexState(..._args: any[]): any {}
  protected startTimer(..._args: any[]): any {}
  protected stopTimer(..._args: any[]): any {}
  protected scheduleDeferredStartupRefresh(..._args: any[]): any {}
  protected clearDeferredStartupRefresh(..._args: any[]): any {}
  protected shouldBackgroundPoll(..._args: any[]): any {}
  protected getActiveProviderState(..._args: any[]): any {}
  protected getActiveWindowRefreshPlan(..._args: any[]): any {}
  protected runActiveWindowRefreshPlan(..._args: any[]): any {}
  protected refreshIfWindowActive(..._args: any[]): any {}
  protected fetchAll(..._args: any[]): any {}
  protected fetchCodexOnly(..._args: any[]): any {}
  protected fetchClaudeOnly(..._args: any[]): any {}
  protected fetchGrokOnly(..._args: any[]): any {}
  protected waitForFetchIdle(..._args: any[]): any {}
  protected resolveFetchIdleWaiters(..._args: any[]): any {}
  protected beginFetchCycle(..._args: any[]): any {}
  protected finishFetchCycle(..._args: any[]): any {}
  protected runWithFetchAbortSignal(..._args: any[]): any {}
  protected abortActiveFetchCycle(..._args: any[]): any {}
  protected clearQueuedFetches(..._args: any[]): any {}
  protected resolveAndClearFetchIdleWaiters(..._args: any[]): any {}
  protected isSameCodexTarget(..._args: any[]): any {}
  protected isSameClaudeTarget(..._args: any[]): any {}
  protected getCodexProvenance(..._args: any[]): any {}
  protected getMissingWslCodexHomeResult(..._args: any[]): any {}
  protected fetchCodexResetResultState(..._args: any[]): any {}
  protected shouldAllowCodexPtyFallback(..._args: any[]): any {}
  protected shouldAllowClaudePtyFallback(..._args: any[]): any {}
  protected shouldAllowClaudeUsagePanelSupplement(..._args: any[]): any {}
  protected resolveMiniMaxConfig(..._args: any[]): any {}
  protected getMiniMaxCredentialError(..._args: any[]): any {}
  protected isRetryAfterActive(..._args: any[]): any {}
  protected isLiveClaudeUsageFresh(..._args: any[]): any {}
  protected shouldSkipAutomatedClaudeFetch(..._args: any[]): any {}
  protected resolveClaudeFetchApply(..._args: any[]): any {}
  protected rememberClaudeAuthSnapshot(..._args: any[]): any {}
  protected trackActiveFailureStreak(..._args: any[]): any {}
  protected withFetchingStatus(..._args: any[]): any {}
  protected runFetchAllCycle(..._args: any[]): any {}
  protected runFetchCodexOnlyCycle(..._args: any[]): any {}
  protected runFetchClaudeOnlyCycle(..._args: any[]): any {}
  protected runFetchGrokOnlyCycle(..._args: any[]): any {}
  protected applyStalePolicy(..._args: any[]): any {}
  protected buildInactiveArray(..._args: any[]): any {}
  protected updateState(..._args: any[]): any {}
  protected pushToRenderer(..._args: any[]): any {}
}

