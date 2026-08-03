import { webContents } from 'electron'
import type {
  GitHubPRRefreshAlias,
  GitHubPRRefreshCandidate,
  GitHubPRRefreshEvent,
  GitHubPRRefreshReason,
  GitHubPRRefreshSkippedReason,
  PRRefreshOutcome
} from '../../shared/types'
import type { GitHubPRBranchLookupOptions } from './client'
import { recordCoalescedCrashBreadcrumb } from '../crash-reporting/crash-breadcrumb-store'
import { sendToTrustedUIRenderer } from '../ipc/ui'
export type QueueEntry = {
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

export type PRRefreshOutcomeObserver = (
  candidate: GitHubPRRefreshCandidate,
  outcome: PRRefreshOutcome
) => void

export type PRBranchLookupCandidate = Pick<
  GitHubPRRefreshCandidate,
  'localGitOptions' | 'linkedPRNumber' | 'fallbackPRNumber' | 'fallbackPRSource' | 'currentHeadOid'
>

export function shouldAcceptMergedFallbackPR(candidate: PRBranchLookupCandidate): boolean {
  return (
    candidate.linkedPRNumber == null &&
    candidate.fallbackPRNumber != null &&
    candidate.fallbackPRSource != null
  )
}

export function hostedReviewOptionArgs(
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

export const MIN_BACKGROUND_REFRESH_AGE_MS = 60_000
export const MERGEABILITY_PENDING_REFRESH_MS = 10_000
export const MANUAL_MERGEABILITY_PENDING_REFRESH_MS = 2_500
export const BACKGROUND_BUDGET_WINDOW_MS = 5 * 60_000
export const MIN_BACKGROUND_SPACING_MS = 10_000
export const BACKGROUND_BUDGET_MAX = 20
export const POST_PUSH_DELAY_MS = 2_500
export const BACKOFF_BASE_MS = 60_000
export const BACKOFF_MAX_MS = 15 * 60_000
export const DIAGNOSTIC_BREADCRUMB_MIN_INTERVAL_MS = 30_000
export const ACTIVE_BURST_WINDOW_MS = 30_000
export const ACTIVE_BURST_MAX = 3

export let sequence = 0
export let queueOrder = 0
export let draining = false
export let drainTimer: ReturnType<typeof setTimeout> | null = null
export const queue = new Map<string, QueueEntry>()
export const backgroundStarts: number[] = []
export const activeStartsByScope = new Map<string, number[]>()
export const errorBackoff = new Map<string, { failures: number; retryAt: number }>()
// Per-key manual-retry cooldown (secondary rate-limit Retry-After); refreshPRNow refuses manual retry until this time so a stale renderer can't bypass it.
export const manualRetryGates = new Map<string, number>()
export let lastBackgroundStartAt = 0

/**
 * Track (or clear) the manual-retry cooldown for a key from a broadcast outcome.
 * Only a rate-limit outcome carrying `retryDisabledUntil` sets a gate; any other settled outcome clears it.
 */
export function noteManualRetryGate(key: string, outcome: PRRefreshOutcome): void {
  if (outcome.kind === 'upstream-error' && outcome.retryDisabledUntil !== undefined) {
    manualRetryGates.set(key, outcome.retryDisabledUntil)
  } else {
    manualRetryGates.delete(key)
  }
}

/** Reset all per-key retry state (backoff + manual cooldown) when a key resets. */
export function resetKeyRetryState(key: string): void {
  errorBackoff.delete(key)
  manualRetryGates.delete(key)
}
export const visibleByWindow = new Map<number, { generation: number; keys: Set<string> }>()
export let outcomeObserver: PRRefreshOutcomeObserver | null = null
export const diagnosticsCounters = {
  enqueued: 0,
  coalesced: 0,
  skipped: 0,
  backgroundPauses: 0
}

export function setPRRefreshOutcomeObserver(observer: PRRefreshOutcomeObserver | null): void {
  outcomeObserver = observer
}

export function beginDrain(): boolean {
  if (draining) {
    return false
  }
  draining = true
  return true
}

export function endDrain(): void {
  draining = false
}

export function setDrainTimer(timer: ReturnType<typeof setTimeout> | null): void {
  drainTimer = timer
}

export function setLastBackgroundStartAt(timestamp: number): void {
  lastBackgroundStartAt = timestamp
}

export function removeInvisibleVisibleRefreshes(): void {
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

export function recordPRRefreshQueueDiagnostic(
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

export function clearActiveBurstWindow(windowId: number): void {
  const windowPrefix = `${windowId}::`
  for (const scope of Array.from(activeStartsByScope.keys())) {
    if (scope.startsWith(windowPrefix)) {
      activeStartsByScope.delete(scope)
    }
  }
}

export function clearVisiblePRRefreshWindow(windowId: number): void {
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
export function pruneWorktreePRRefreshAliases(worktreeId: string): void {
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

export function nextSequence(): number {
  sequence += 1
  return sequence
}

export function nextQueueOrder(): number {
  queueOrder += 1
  return queueOrder
}

export function broadcast(event: Omit<GitHubPRRefreshEvent, 'sequence'>, sequenceOverride?: number): void {
  const payload = { ...event, sequence: sequenceOverride ?? nextSequence() } as GitHubPRRefreshEvent
  sendToTrustedUIRenderer('gh:prRefreshEvent', payload)
}

export function refreshKey(candidate: GitHubPRRefreshCandidate): string {
  const connectionScope = candidate.connectionId ?? 'local'
  const runtimeScope = candidate.connectionId
    ? 'remote'
    : `runtime:${candidate.localGitOptions?.wslDistro ? `wsl:${candidate.localGitOptions.wslDistro}` : 'host'}`
  if (typeof candidate.linkedPRNumber === 'number') {
    return `${connectionScope}::${runtimeScope}::${candidate.repoPath}::pr::${candidate.linkedPRNumber}`
  }
  return `${connectionScope}::${runtimeScope}::${candidate.repoPath}::branch::${candidate.branch}`
}

export function isVisibleKey(key: string): boolean {
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

export function isManual(reason: GitHubPRRefreshReason): boolean {
  return reason === 'manual'
}

export function bypassesFreshnessDelay(reason: GitHubPRRefreshReason): boolean {
  return reason === 'manual' || reason === 'active' || reason === 'post-push'
}

export function isBackground(reason: GitHubPRRefreshReason): boolean {
  return reason !== 'manual'
}

export function isBudgetedBackground(reason: GitHubPRRefreshReason): boolean {
  return reason === 'visible' || reason === 'swr'
}

export function isBudgetedQueueEntry(entry: QueueEntry): boolean {
  return isBudgetedBackground(entry.reason) && entry.bypassBackgroundBudget !== true
}

export function validateCandidate(
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

export function shouldSkipFresh(
  candidate: GitHubPRRefreshCandidate,
  reason: GitHubPRRefreshReason
): boolean {
  if (bypassesFreshnessDelay(reason) || candidate.cachedFetchedAt == null) {
    return false
  }
  return Date.now() - candidate.cachedFetchedAt < refreshIntervalForCandidate(candidate)
}

export function shouldBroadcastQueued(reason: GitHubPRRefreshReason, dueAt: number): boolean {
  if (isBudgetedBackground(reason)) {
    return false
  }
  const delay = dueAt - Date.now()
  if (delay <= 0) {
    return false
  }
  return delay <= 5_000
}

export function hasResolvedMergeStateStatus(status: string | null | undefined): boolean {
  return status === 'CLEAN' || status === 'BEHIND' || status === 'BLOCKED'
}

export function refreshIntervalForCandidate(candidate: GitHubPRRefreshCandidate): number {
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

export function freshRetryAt(candidate: GitHubPRRefreshCandidate): number | null {
  return candidate.cachedFetchedAt == null
    ? null
    : candidate.cachedFetchedAt + refreshIntervalForCandidate(candidate)
}

export function aliasFromCandidate(candidate: GitHubPRRefreshCandidate): GitHubPRRefreshAlias {
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

export function visibleCandidateAfterOutcome(
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
