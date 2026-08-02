import { webContents } from 'electron'
import type {
  GitHubPRRefreshAlias,
  GitHubPRRefreshCandidate,
  GitHubPRRefreshEvent,
  GitHubPRRefreshReason,
  GitHubPRRefreshSkippedReason,
  PRRefreshOutcome
} from '../../shared/types'
import { getPRForBranchOutcome, type GitHubPRBranchLookupOptions } from './client'
import { getOriginGitHubApiRepository } from './github-api-repository'
import { ghRepoExecOptions, githubRepoContext } from './gh-utils'
import {
  getRateLimit,
  noteRepositoryRateLimitSpend,
  repositoryRateLimitGuard,
  spendsSharedGitHubComQuota
} from './rate-limit'
import { recordCoalescedCrashBreadcrumb } from '../crash-reporting/crash-breadcrumb-store'
import { sendToTrustedUIRenderer } from '../ipc/ui'
import { drainQueue } from './pr-refresh-queue-drain'
import { refreshPRNow } from './pr-refresh-coordinator-api'
type QueueEntry = {
  key: string
  candidate: GitHubPRRefreshCandidate
  aliases: Map<string, GitHubPRRefreshAlias>
  reason: GitHubPRRefreshReason
  priority: number
  dueAt: number
  queuedAt: number
  bypassBackgroundBudget?: boolean
  activeDelayNotified?: boolean
  windowId?: number
}

type PRRefreshOutcomeObserver = (
  candidate: GitHubPRRefreshCandidate,
  outcome: PRRefreshOutcome
) => void

type PRBranchLookupCandidate = Pick<
  GitHubPRRefreshCandidate,
  'localGitOptions' | 'linkedPRNumber' | 'fallbackPRNumber' | 'fallbackPRSource' | 'currentHeadOid'
>

function shouldAcceptMergedFallbackPR(candidate: PRBranchLookupCandidate): boolean {
  return (
    candidate.linkedPRNumber == null &&
    candidate.fallbackPRNumber != null &&
    candidate.fallbackPRSource != null
  )
}

function hostedReviewOptionArgs(
  candidate: PRBranchLookupCandidate
): [] | [GitHubPRBranchLookupOptions] {
  const options: GitHubPRBranchLookupOptions = {}
  if (candidate.localGitOptions?.wslDistro) {
    options.localGitExecOptions = { wslDistro: candidate.localGitOptions.wslDistro }
  }
  if (shouldAcceptMergedFallbackPR(candidate)) {
    options.acceptMergedFallbackPR = true
  }
  if (typeof candidate.currentHeadOid === 'string' && candidate.currentHeadOid.trim().length > 0) {
    options.currentHeadOid = candidate.currentHeadOid.trim()
  }
  return Object.keys(options).length > 0 ? [options] : []
}

const MIN_BACKGROUND_REFRESH_AGE_MS = 60_000
const MERGEABILITY_PENDING_REFRESH_MS = 10_000
const MANUAL_MERGEABILITY_PENDING_REFRESH_MS = 2_500
const BACKGROUND_BUDGET_WINDOW_MS = 5 * 60_000
const MIN_BACKGROUND_SPACING_MS = 10_000
const BACKGROUND_BUDGET_MAX = 20
const POST_PUSH_DELAY_MS = 2_500
const BACKOFF_BASE_MS = 60_000
const BACKOFF_MAX_MS = 15 * 60_000
const DIAGNOSTIC_BREADCRUMB_MIN_INTERVAL_MS = 30_000
const ACTIVE_BURST_WINDOW_MS = 30_000
const ACTIVE_BURST_MAX = 3

let sequence = 0
let queueOrder = 0
let draining = false
let drainTimer: ReturnType<typeof setTimeout> | null = null
const queue = new Map<string, QueueEntry>()
const backgroundStarts: number[] = []
const activeStartsByScope = new Map<string, number[]>()
const errorBackoff = new Map<string, { failures: number; retryAt: number }>()
// Per-key manual-retry cooldown (secondary rate-limit Retry-After); refreshPRNow refuses manual retry until this time so a stale renderer can't bypass it.
const manualRetryGates = new Map<string, number>()
let lastBackgroundStartAt = 0

/**
 * Track (or clear) the manual-retry cooldown for a key from a broadcast outcome.
 * Only a rate-limit outcome carrying `retryDisabledUntil` sets a gate; any other settled outcome clears it.
 */
function noteManualRetryGate(key: string, outcome: PRRefreshOutcome): void {
  if (outcome.kind === 'upstream-error' && outcome.retryDisabledUntil !== undefined) {
    manualRetryGates.set(key, outcome.retryDisabledUntil)
  } else {
    manualRetryGates.delete(key)
  }
}

/** Reset all per-key retry state (backoff + manual cooldown) when a key resets. */
function resetKeyRetryState(key: string): void {
  errorBackoff.delete(key)
  manualRetryGates.delete(key)
}
const visibleByWindow = new Map<number, { generation: number; keys: Set<string> }>()
let outcomeObserver: PRRefreshOutcomeObserver | null = null
const diagnosticsCounters = {
  enqueued: 0,
  coalesced: 0,
  skipped: 0,
  backgroundPauses: 0
}

function setPRRefreshOutcomeObserver(observer: PRRefreshOutcomeObserver | null): void {
  outcomeObserver = observer
}

function removeInvisibleVisibleRefreshes(): void {
  for (const [key, entry] of queue) {
    if (entry.reason === 'visible' && !isVisibleKey(key)) {
      queue.delete(key)
      resetKeyRetryState(key)
      broadcast({
        aliases: Array.from(entry.aliases.values()),
        reason: 'visible',
        status: 'skipped',
        skippedReason: 'fresh'
      })
    }
  }
}

function recordPRRefreshQueueDiagnostic(
  event: 'enqueued' | 'coalesced' | 'skipped' | 'background-pause',
  reason: GitHubPRRefreshReason,
  skippedReason?: GitHubPRRefreshSkippedReason
): void {
  recordCoalescedCrashBreadcrumb({
    name: 'pr_refresh_queue',
    coalesceKey: `pr-refresh-queue:${event}:${reason}:${skippedReason ?? ''}`,
    minIntervalMs: DIAGNOSTIC_BREADCRUMB_MIN_INTERVAL_MS,
    data: {
      event,
      reason,
      ...(skippedReason ? { skippedReason } : {}),
      enqueued: diagnosticsCounters.enqueued,
      coalesced: diagnosticsCounters.coalesced,
      skipped: diagnosticsCounters.skipped,
      backgroundPauses: diagnosticsCounters.backgroundPauses
    }
  })
}

function clearActiveBurstWindow(windowId: number): void {
  const windowPrefix = `${windowId}::`
  for (const scope of Array.from(activeStartsByScope.keys())) {
    if (scope.startsWith(windowPrefix)) {
      activeStartsByScope.delete(scope)
    }
  }
}

function clearVisiblePRRefreshWindow(windowId: number): void {
  const hadVisibleRefreshes = visibleByWindow.delete(windowId)
  clearActiveBurstWindow(windowId)
  if (hadVisibleRefreshes) {
    // Why: visible follow-ups are owned by the reporting renderer; if its WebContents is destroyed, no later visibility report arrives.
    removeInvisibleVisibleRefreshes()
  }
}

/**
 * Drop a removed worktree's aliases from every queue entry.
 *
 * Why: aliases are otherwise only pruned when a candidate is re-enqueued as invalid, so churning worktrees grow these maps unbounded (OOM creep).
 */
function pruneWorktreePRRefreshAliases(worktreeId: string): void {
  for (const [key, entry] of queue) {
    let removed = false
    for (const [cacheKey, alias] of entry.aliases) {
      if (alias.worktreeId === worktreeId) {
        entry.aliases.delete(cacheKey)
        removed = true
      }
    }
    if (!removed) {
      continue
    }
    // No aliases left means no worktree still cares about this refresh.
    if (entry.aliases.size === 0) {
      queue.delete(key)
      resetKeyRetryState(key)
      continue
    }
    // Keep the entry alive but replace its representative so it isn't a dangling reference to the removed worktree.
    if (entry.candidate.worktreeId === worktreeId) {
      const replacementAlias = entry.aliases.values().next().value
      if (replacementAlias) {
        entry.candidate = {
          ...entry.candidate,
          cacheKey: replacementAlias.cacheKey,
          branch: replacementAlias.branch,
          worktreeId: replacementAlias.worktreeId,
          // Why: the probe now represents the replacement worktree, so use its head — else the removed worktree's link never clears.
          currentHeadOid: replacementAlias.currentHeadOid ?? null
        }
      }
    }
  }
}

function nextSequence(): number {
  sequence += 1
  return sequence
}

function nextQueueOrder(): number {
  queueOrder += 1
  return queueOrder
}

function broadcast(event: Omit<GitHubPRRefreshEvent, 'sequence'>, sequenceOverride?: number): void {
  const payload = { ...event, sequence: sequenceOverride ?? nextSequence() } as GitHubPRRefreshEvent
  sendToTrustedUIRenderer('gh:prRefreshEvent', payload)
}

function refreshKey(candidate: GitHubPRRefreshCandidate): string {
  const connectionScope = candidate.connectionId ?? 'local'
  const runtimeScope = candidate.connectionId
    ? 'remote'
    : `runtime:${candidate.localGitOptions?.wslDistro ? `wsl:${candidate.localGitOptions.wslDistro}` : 'host'}`
  if (typeof candidate.linkedPRNumber === 'number') {
    return `${connectionScope}::${runtimeScope}::${candidate.repoPath}::pr::${candidate.linkedPRNumber}`
  }
  return `${connectionScope}::${runtimeScope}::${candidate.repoPath}::branch::${candidate.branch}`
}

function isVisibleKey(key: string): boolean {
  const liveWindowIds = new Set(
    webContents
      .getAllWebContents()
      .filter((wc) => !wc.isDestroyed())
      .map((wc) => wc.id)
  )
  for (const windowId of Array.from(visibleByWindow.keys())) {
    if (!liveWindowIds.has(windowId)) {
      visibleByWindow.delete(windowId)
    }
  }
  for (const visible of visibleByWindow.values()) {
    if (visible.keys.has(key)) {
      return true
    }
  }
  return false
}

function isManual(reason: GitHubPRRefreshReason): boolean {
  return reason === 'manual'
}

function bypassesFreshnessDelay(reason: GitHubPRRefreshReason): boolean {
  return reason === 'manual' || reason === 'active' || reason === 'post-push'
}

function isBackground(reason: GitHubPRRefreshReason): boolean {
  return reason !== 'manual'
}

function isBudgetedBackground(reason: GitHubPRRefreshReason): boolean {
  return reason === 'visible' || reason === 'swr'
}

function isBudgetedQueueEntry(entry: QueueEntry): boolean {
  return isBudgetedBackground(entry.reason) && entry.bypassBackgroundBudget !== true
}

function validateCandidate(
  candidate: GitHubPRRefreshCandidate
): GitHubPRRefreshSkippedReason | null {
  if (candidate.repoKind !== 'git') {
    return 'not-git'
  }
  if (candidate.isBare) {
    return 'bare'
  }
  if (candidate.isArchived) {
    return 'archived'
  }
  if (candidate.connectionId && candidate.connectionState === 'disconnected') {
    return 'disconnected'
  }
  if (!candidate.branch && typeof candidate.linkedPRNumber !== 'number') {
    return 'fresh'
  }
  return null
}

function shouldSkipFresh(
  candidate: GitHubPRRefreshCandidate,
  reason: GitHubPRRefreshReason
): boolean {
  if (bypassesFreshnessDelay(reason) || candidate.cachedFetchedAt == null) {
    return false
  }
  return Date.now() - candidate.cachedFetchedAt < refreshIntervalForCandidate(candidate)
}

function shouldBroadcastQueued(reason: GitHubPRRefreshReason, dueAt: number): boolean {
  if (isBudgetedBackground(reason)) {
    return false
  }
  const delay = dueAt - Date.now()
  if (delay <= 0) {
    return false
  }
  return delay <= 5_000
}

function freshRetryAt(candidate: GitHubPRRefreshCandidate): number | null {
  return candidate.cachedFetchedAt == null
    ? null
    : candidate.cachedFetchedAt + refreshIntervalForCandidate(candidate)
}

function aliasFromCandidate(candidate: GitHubPRRefreshCandidate): GitHubPRRefreshAlias {
  return {
    cacheKey: candidate.cacheKey,
    repoId: candidate.repoId,
    repoPath: candidate.repoPath,
    branch: candidate.branch,
    worktreeId: candidate.worktreeId,
    connectionId: candidate.connectionId ?? null,
    currentHeadOid: candidate.currentHeadOid ?? null,
    linkedPRNumber: candidate.linkedPRNumber ?? null,
    fallbackPRNumber:
      candidate.linkedPRNumber == null ? (candidate.fallbackPRNumber ?? null) : null,
    fallbackPRSource: candidate.linkedPRNumber == null ? (candidate.fallbackPRSource ?? null) : null
  }
}

function visibleCandidateAfterOutcome(
  candidate: GitHubPRRefreshCandidate,
  outcome: PRRefreshOutcome
): GitHubPRRefreshCandidate {
  if (outcome.kind === 'upstream-error') {
    return candidate
  }
  return {
    ...candidate,
    cachedFetchedAt: outcome.fetchedAt,
    cachedHasPR: outcome.kind === 'found',
    cachedPRState: outcome.kind === 'found' ? outcome.pr.state : null,
    cachedChecksStatus: outcome.kind === 'found' ? outcome.pr.checksStatus : null,
    cachedMergeable: outcome.kind === 'found' ? outcome.pr.mergeable : null,
    cachedMergeStateStatus: outcome.kind === 'found' ? (outcome.pr.mergeStateStatus ?? null) : null
  }
}

function setVisibleFollowUp(entry: QueueEntry): void {
  const existing = queue.get(entry.key)
  if (!existing) {
    queue.set(entry.key, entry)
    return
  }

  for (const alias of entry.aliases.values()) {
    existing.aliases.set(alias.cacheKey, alias)
  }

  // Why: a user activation can arrive while a background refresh awaits gh; the follow-up must not overwrite that pending active/manual work.
  if (
    bypassesFreshnessDelay(existing.reason) ||
    existing.priority > entry.priority ||
    existing.dueAt <= entry.dueAt
  ) {
    return
  }

  queue.set(entry.key, {
    ...entry,
    aliases: existing.aliases
  })
}

function removeQueuedAliasForInvalidCandidate(key: string, alias: GitHubPRRefreshAlias): void {
  const existing = queue.get(key)
  if (!existing) {
    return
  }

  existing.aliases.delete(alias.cacheKey)
  const replacementAlias = existing.aliases.values().next().value
  if (!replacementAlias) {
    queue.delete(key)
    resetKeyRetryState(key)
    return
  }

  if (existing.candidate.cacheKey === alias.cacheKey) {
    existing.candidate = {
      ...existing.candidate,
      cacheKey: replacementAlias.cacheKey,
      branch: replacementAlias.branch,
      worktreeId: replacementAlias.worktreeId,
      // Why: the probe now represents the replacement worktree, so use its head — else the survivor's link never clears.
      currentHeadOid: replacementAlias.currentHeadOid ?? null,
      isArchived: false,
      isBare: false
    }
  }
}

/**
 * Advances the visible-key error backoff and returns the earliest retry time.
 * Why: only visible keys auto-retry, so callers must gate on `isVisibleKey` first.
 */
function nextVisibleErrorRetryAt(key: string): number {
  const failures = (errorBackoff.get(key)?.failures ?? 0) + 1
  const retryAt =
    Date.now() + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 4))
  errorBackoff.set(key, { failures, retryAt })
  return retryAt
}

/**
 * Stamps the auto-retry time onto an error outcome before broadcast.
 * Why: sets only `nextAutoRetryAt`, never `retryDisabledUntil` — that disables *manual* Retry and is reserved for a real rate-limit gate.
 */
function withErrorSchedule(outcome: PRRefreshOutcome, retryAt: number): PRRefreshOutcome {
  if (outcome.kind !== 'upstream-error') {
    return outcome
  }
  // Why: honor a real Retry-After cooldown the client stamped (`retryDisabledUntil`) so we don't auto-retry into an active secondary rate limit.
  const cooldownUntil = outcome.retryDisabledUntil
  return {
    ...outcome,
    nextAutoRetryAt: cooldownUntil !== undefined ? Math.max(retryAt, cooldownUntil) : retryAt
  }
}

function scheduleVisibleFollowUp(
  key: string,
  candidate: GitHubPRRefreshCandidate,
  outcome: PRRefreshOutcome,
  priority: number,
  aliases: GitHubPRRefreshAlias[],
  windowId?: number,
  options?: { pendingMergeabilityDelayMs?: number; plannedRetryAt?: number }
): void {
  if (!isVisibleKey(key)) {
    // Why: manual/active refreshes can remove the queued visible retry after its owner window is gone, orphaning the backoff.
    resetKeyRetryState(key)
    return
  }
  if (outcome.kind === 'upstream-error') {
    // Why: reuse the retry time already computed for the broadcast so the same failure isn't counted twice against the backoff.
    const retryAt = options?.plannedRetryAt ?? nextVisibleErrorRetryAt(key)
    setVisibleFollowUp({
      key,
      candidate,
      aliases: new Map(aliases.map((alias) => [alias.cacheKey, alias])),
      reason: 'visible',
      priority,
      dueAt: retryAt,
      queuedAt: nextQueueOrder(),
      windowId
    })
    // Why: this is a delayed retry, not active work; a spinner would make visible worktrees look stuck until backoff expires.
    scheduleDrain(retryAt - Date.now())
    return
  }
  resetKeyRetryState(key)
  const followUpCandidate = visibleCandidateAfterOutcome(candidate, outcome)
  const regularDueAt = freshRetryAt(followUpCandidate) ?? Date.now()
  const pendingMergeabilityDueAt =
    options?.pendingMergeabilityDelayMs !== undefined && isMergeabilityPendingOutcome(outcome)
      ? outcome.fetchedAt + options.pendingMergeabilityDelayMs
      : null
  const dueAt =
    pendingMergeabilityDueAt === null
      ? regularDueAt
      : Math.min(regularDueAt, pendingMergeabilityDueAt)
  // Why: a coalesced linked-PR refresh may represent several branches; preserve every alias so all cache entries keep getting updates.
  setVisibleFollowUp({
    key,
    candidate: followUpCandidate,
    aliases: new Map(aliases.map((alias) => [alias.cacheKey, alias])),
    reason: 'visible',
    priority,
    dueAt,
    queuedAt: nextQueueOrder(),
    // Why: this manual one-shot fixes GitHub's transient UNKNOWN state; visible spacing would delay it past the prompt retry window.
    bypassBackgroundBudget: pendingMergeabilityDueAt !== null,
    windowId
  })
  scheduleDrain(Math.max(0, dueAt - Date.now()))
}

function refreshIntervalForCandidate(candidate: GitHubPRRefreshCandidate): number {
  if (candidate.cachedPRState === 'closed' || candidate.cachedPRState === 'merged') {
    return 30 * 60_000
  }
  if (candidate.cachedHasPR === false) {
    return 15 * 60_000
  }
  if (
    candidate.cachedHasPR === true &&
    candidate.cachedPRState === 'open' &&
    candidate.cachedMergeable === 'UNKNOWN' &&
    !hasResolvedMergeStateStatus(candidate.cachedMergeStateStatus)
  ) {
    // Why: GitHub returns transient UNKNOWN mergeability while computing the test merge; visible merge buttons need a prompt follow-up.
    return MERGEABILITY_PENDING_REFRESH_MS
  }
  if (candidate.cachedChecksStatus === 'success') {
    return 10 * 60_000
  }
  if (candidate.cachedChecksStatus === 'failure') {
    return 3 * 60_000
  }
  if (candidate.cachedChecksStatus === 'pending') {
    return 90_000
  }
  return MIN_BACKGROUND_REFRESH_AGE_MS
}

function hasResolvedMergeStateStatus(status: string | null | undefined): boolean {
  return status === 'CLEAN' || status === 'BEHIND' || status === 'BLOCKED'
}

function isMergeabilityPendingOutcome(outcome: PRRefreshOutcome): boolean {
  return (
    outcome.kind === 'found' &&
    outcome.pr.state === 'open' &&
    outcome.pr.mergeable === 'UNKNOWN' &&
    !hasResolvedMergeStateStatus(outcome.pr.mergeStateStatus)
  )
}

function backgroundRefreshBuckets(): ('core' | 'graphql')[] {
  // Why: branch refreshes prefer REST but can fall back to `gh pr list`, so guard both buckets until the client exposes a per-lookup cost plan.
  return ['core', 'graphql']
}

function noteBackgroundStart(): void {
  const now = Date.now()
  lastBackgroundStartAt = now
  backgroundStarts.push(now)
  while (backgroundStarts.length > 0 && now - backgroundStarts[0] > BACKGROUND_BUDGET_WINDOW_MS) {
    backgroundStarts.shift()
  }
}

function nextBudgetDelay(): number {
  const now = Date.now()
  while (backgroundStarts.length > 0 && now - backgroundStarts[0] > BACKGROUND_BUDGET_WINDOW_MS) {
    backgroundStarts.shift()
  }
  const spacingDelay =
    lastBackgroundStartAt > 0
      ? Math.max(0, MIN_BACKGROUND_SPACING_MS - (now - lastBackgroundStartAt))
      : 0
  const windowDelay =
    backgroundStarts.length < BACKGROUND_BUDGET_MAX
      ? 0
      : Math.max(1_000, BACKGROUND_BUDGET_WINDOW_MS - (now - backgroundStarts[0]))
  return Math.max(spacingDelay, windowDelay)
}

function activeBurstScope(entry: QueueEntry): string {
  const runtimeScope = entry.candidate.connectionId
    ? `ssh:${entry.candidate.connectionId}`
    : `local:${entry.candidate.localGitOptions?.wslDistro ?? 'host'}`
  return `${entry.windowId ?? 'global'}::${runtimeScope}`
}

function pruneActiveStarts(scope: string, now: number): number[] {
  const activeStarts = activeStartsByScope.get(scope) ?? []
  while (activeStarts.length > 0 && now - activeStarts[0] >= ACTIVE_BURST_WINDOW_MS) {
    activeStarts.shift()
  }
  if (activeStarts.length === 0) {
    activeStartsByScope.delete(scope)
  } else {
    activeStartsByScope.set(scope, activeStarts)
  }
  return activeStarts
}

function nextActiveBurstDelay(entry: QueueEntry): number {
  const now = Date.now()
  const activeStarts = pruneActiveStarts(activeBurstScope(entry), now)
  if (activeStarts.length < ACTIVE_BURST_MAX) {
    return 0
  }
  return Math.max(1, ACTIVE_BURST_WINDOW_MS - (now - activeStarts[0]))
}

function noteActiveStart(entry: QueueEntry): void {
  const now = Date.now()
  const scope = activeBurstScope(entry)
  const activeStarts = pruneActiveStarts(scope, now)
  activeStarts.push(now)
  activeStartsByScope.set(scope, activeStarts)
}

function activeOrder(a: QueueEntry, b: QueueEntry): number {
  if (a.reason !== 'active' || b.reason !== 'active') {
    return 0
  }
  if (activeBurstScope(a) !== activeBurstScope(b)) {
    return 0
  }
  // Why: refresh the worktree the user lands on before stale transient selections in the same window/runtime scope.
  return b.queuedAt - a.queuedAt
}

function entryDelay(entry: QueueEntry): number {
  const activeBurstDelay = entry.reason === 'active' ? nextActiveBurstDelay(entry) : 0
  if (activeBurstDelay > 0) {
    return activeBurstDelay
  }
  return isBudgetedQueueEntry(entry) ? nextBudgetDelay() : 0
}

function isActiveBurstDelayed(entry: QueueEntry): boolean {
  return entry.reason === 'active' && nextActiveBurstDelay(entry) > 0
}

function nextQueuedWakeDelay(excludedKey: string): number | null {
  const now = Date.now()
  let nextDelay = Number.POSITIVE_INFINITY
  for (const entry of queue.values()) {
    if (entry.key === excludedKey) {
      continue
    }
    const delay = entry.dueAt > now ? entry.dueAt - now : entryDelay(entry)
    nextDelay = Math.min(nextDelay, delay)
  }
  return Number.isFinite(nextDelay) ? Math.max(0, nextDelay) : null
}

function scheduleDrain(delay = 0): void {
  if (drainTimer) {
    clearTimeout(drainTimer)
  }
  drainTimer = setTimeout(() => {
    drainTimer = null
    void drainQueue()
  }, delay)
}

function queuedEntriesByPriority(): QueueEntry[] {
  const now = Date.now()
  return Array.from(queue.values()).sort((a, b) => {
    const aReady = a.dueAt <= now
    const bReady = b.dueAt <= now
    if (aReady && bReady) {
      return b.priority - a.priority || activeOrder(a, b) || a.dueAt - b.dueAt
    }
    if (aReady !== bReady) {
      return aReady ? -1 : 1
    }
    return a.dueAt - b.dueAt || b.priority - a.priority
  })
}

export { shouldAcceptMergedFallbackPR, hostedReviewOptionArgs, MIN_BACKGROUND_REFRESH_AGE_MS, MERGEABILITY_PENDING_REFRESH_MS, MANUAL_MERGEABILITY_PENDING_REFRESH_MS, BACKGROUND_BUDGET_WINDOW_MS, MIN_BACKGROUND_SPACING_MS, BACKGROUND_BUDGET_MAX, POST_PUSH_DELAY_MS, BACKOFF_BASE_MS, BACKOFF_MAX_MS, DIAGNOSTIC_BREADCRUMB_MIN_INTERVAL_MS, ACTIVE_BURST_WINDOW_MS, ACTIVE_BURST_MAX, sequence, queueOrder, draining, queue, backgroundStarts, activeStartsByScope, errorBackoff, manualRetryGates, lastBackgroundStartAt, noteManualRetryGate, resetKeyRetryState, visibleByWindow, outcomeObserver, diagnosticsCounters, setPRRefreshOutcomeObserver, removeInvisibleVisibleRefreshes, recordPRRefreshQueueDiagnostic, clearActiveBurstWindow, clearVisiblePRRefreshWindow, pruneWorktreePRRefreshAliases, nextSequence, nextQueueOrder, broadcast, refreshKey, isVisibleKey, isManual, bypassesFreshnessDelay, isBackground, isBudgetedBackground, isBudgetedQueueEntry, validateCandidate, shouldSkipFresh, shouldBroadcastQueued, freshRetryAt, aliasFromCandidate, visibleCandidateAfterOutcome, setVisibleFollowUp, removeQueuedAliasForInvalidCandidate, nextVisibleErrorRetryAt, withErrorSchedule, scheduleVisibleFollowUp, refreshIntervalForCandidate, hasResolvedMergeStateStatus, isMergeabilityPendingOutcome, backgroundRefreshBuckets, noteBackgroundStart, nextBudgetDelay, activeBurstScope, pruneActiveStarts, nextActiveBurstDelay, noteActiveStart, activeOrder, entryDelay, isActiveBurstDelayed, nextQueuedWakeDelay, scheduleDrain, queuedEntriesByPriority }
export { type QueueEntry, type PRRefreshOutcomeObserver, type PRBranchLookupCandidate, type drainTimer }

