import type {
  GitHubPRRefreshAlias,
  GitHubPRRefreshCandidate,
  PRRefreshOutcome
} from '../../shared/types'
import { drainQueue } from './pr-refresh-queue-drain'
import { type QueueEntry,
  BACKGROUND_BUDGET_WINDOW_MS,
  MIN_BACKGROUND_SPACING_MS,
  BACKGROUND_BUDGET_MAX,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  ACTIVE_BURST_WINDOW_MS,
  ACTIVE_BURST_MAX,
  drainTimer,
  queue,
  backgroundStarts,
  activeStartsByScope,
  errorBackoff,
  lastBackgroundStartAt,
  resetKeyRetryState,
  nextQueueOrder,
  isVisibleKey,
  bypassesFreshnessDelay,
  isBudgetedQueueEntry,
  freshRetryAt,
  visibleCandidateAfterOutcome,
  hasResolvedMergeStateStatus,
  setDrainTimer,
  setLastBackgroundStartAt } from './pr-refresh-queue-foundation'

export function setVisibleFollowUp(entry: QueueEntry): void {
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

export function removeQueuedAliasForInvalidCandidate(key: string, alias: GitHubPRRefreshAlias): void {
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
export function nextVisibleErrorRetryAt(key: string): number {
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
export function withErrorSchedule(outcome: PRRefreshOutcome, retryAt: number): PRRefreshOutcome {
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

export function scheduleVisibleFollowUp(
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

export function isMergeabilityPendingOutcome(outcome: PRRefreshOutcome): boolean {
  return (
    outcome.kind === 'found' &&
    outcome.pr.state === 'open' &&
    outcome.pr.mergeable === 'UNKNOWN' &&
    !hasResolvedMergeStateStatus(outcome.pr.mergeStateStatus)
  )
}

export function backgroundRefreshBuckets(): ('core' | 'graphql')[] {
  // Why: branch refreshes prefer REST but can fall back to `gh pr list`, so guard both buckets until the client exposes a per-lookup cost plan.
  return ['core', 'graphql']
}

export function noteBackgroundStart(): void {
  const now = Date.now()
  setLastBackgroundStartAt(now)
  backgroundStarts.push(now)
  while (backgroundStarts.length > 0 && now - backgroundStarts[0] > BACKGROUND_BUDGET_WINDOW_MS) {
    backgroundStarts.shift()
  }
}

export function nextBudgetDelay(): number {
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

export function activeBurstScope(entry: QueueEntry): string {
  const runtimeScope = entry.candidate.connectionId
    ? `ssh:${entry.candidate.connectionId}`
    : `local:${entry.candidate.localGitOptions?.wslDistro ?? 'host'}`
  return `${entry.windowId ?? 'global'}::${runtimeScope}`
}

export function pruneActiveStarts(scope: string, now: number): number[] {
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

export function nextActiveBurstDelay(entry: QueueEntry): number {
  const now = Date.now()
  const activeStarts = pruneActiveStarts(activeBurstScope(entry), now)
  if (activeStarts.length < ACTIVE_BURST_MAX) {
    return 0
  }
  return Math.max(1, ACTIVE_BURST_WINDOW_MS - (now - activeStarts[0]))
}

export function noteActiveStart(entry: QueueEntry): void {
  const now = Date.now()
  const scope = activeBurstScope(entry)
  const activeStarts = pruneActiveStarts(scope, now)
  activeStarts.push(now)
  activeStartsByScope.set(scope, activeStarts)
}

export function activeOrder(a: QueueEntry, b: QueueEntry): number {
  if (a.reason !== 'active' || b.reason !== 'active') {
    return 0
  }
  if (activeBurstScope(a) !== activeBurstScope(b)) {
    return 0
  }
  // Why: refresh the worktree the user lands on before stale transient selections in the same window/runtime scope.
  return b.queuedAt - a.queuedAt
}

export function entryDelay(entry: QueueEntry): number {
  const activeBurstDelay = entry.reason === 'active' ? nextActiveBurstDelay(entry) : 0
  if (activeBurstDelay > 0) {
    return activeBurstDelay
  }
  return isBudgetedQueueEntry(entry) ? nextBudgetDelay() : 0
}

export function isActiveBurstDelayed(entry: QueueEntry): boolean {
  return entry.reason === 'active' && nextActiveBurstDelay(entry) > 0
}

export function nextQueuedWakeDelay(excludedKey: string): number | null {
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

export function scheduleDrain(delay = 0): void {
  if (drainTimer) {
    clearTimeout(drainTimer)
  }
  setDrainTimer(setTimeout(() => {
    setDrainTimer(null)
    void drainQueue()
  }, delay))
}

export function queuedEntriesByPriority(): QueueEntry[] {
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
