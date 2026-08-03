import type {
  GitHubPRRefreshCandidate,
  GitHubPRRefreshReason,
  PRRefreshOutcome
} from '../../shared/types'
import { getPRForBranchOutcome } from './client'
import { getOriginGitHubApiRepository } from './github-api-repository'
import { ghRepoExecOptions, githubRepoContext } from './gh-utils'
import {
  repositoryRateLimitGuard
} from './rate-limit'
import { hostedReviewOptionArgs, MANUAL_MERGEABILITY_PENDING_REFRESH_MS, POST_PUSH_DELAY_MS, queue, errorBackoff, manualRetryGates, noteManualRetryGate, visibleByWindow, outcomeObserver, diagnosticsCounters, removeInvisibleVisibleRefreshes, recordPRRefreshQueueDiagnostic, nextSequence, nextQueueOrder, broadcast, refreshKey, isVisibleKey, isManual, bypassesFreshnessDelay, validateCandidate, shouldSkipFresh, shouldBroadcastQueued, freshRetryAt, aliasFromCandidate, removeQueuedAliasForInvalidCandidate, nextVisibleErrorRetryAt, withErrorSchedule, scheduleVisibleFollowUp, backgroundRefreshBuckets, scheduleDrain } from './pr-refresh-queue-state'
function enqueuePRRefresh(
  candidate: GitHubPRRefreshCandidate,
  reason: GitHubPRRefreshReason,
  priority = 0,
  windowId?: number
): void {
  const alias = aliasFromCandidate(candidate)
  const key = refreshKey(candidate)
  const skippedReason = validateCandidate(candidate)
  if (skippedReason) {
    removeQueuedAliasForInvalidCandidate(key, alias)
    diagnosticsCounters.skipped += 1
    recordPRRefreshQueueDiagnostic('skipped', reason, skippedReason)
    broadcast({
      aliases: [alias],
      reason,
      status: 'skipped',
      skippedReason
    })
    return
  }

  const existing = queue.get(key)
  const freshDueAt = shouldSkipFresh(candidate, reason) ? freshRetryAt(candidate) : null
  const dueAt = freshDueAt ?? Date.now() + (reason === 'post-push' ? POST_PUSH_DELAY_MS : 0)
  if (existing) {
    existing.aliases.set(alias.cacheKey, alias)
    diagnosticsCounters.coalesced += 1
    recordPRRefreshQueueDiagnostic('coalesced', reason)
    const shouldPromoteExisting =
      priority > existing.priority ||
      isManual(reason) ||
      (reason === 'active' && existing.reason === 'active') ||
      (priority >= existing.priority && dueAt < existing.dueAt && bypassesFreshnessDelay(reason))
    if (shouldPromoteExisting) {
      existing.priority = priority
      existing.reason = reason
      existing.dueAt = Math.min(existing.dueAt, dueAt)
      existing.queuedAt = nextQueueOrder()
      existing.activeDelayNotified = false
      existing.candidate = candidate
      existing.windowId = windowId ?? existing.windowId
    } else if (existing.candidate.worktreeId === candidate.worktreeId) {
      // Why: the representative drives the probe head; refresh probe inputs when its worktree moved head/branch, else a merged linked PR lingers after a switch.
      existing.candidate = {
        ...existing.candidate,
        cacheKey: candidate.cacheKey,
        branch: candidate.branch,
        currentHeadOid: candidate.currentHeadOid ?? null
      }
    }
  } else {
    diagnosticsCounters.enqueued += 1
    recordPRRefreshQueueDiagnostic('enqueued', reason)
    queue.set(key, {
      key,
      candidate,
      aliases: new Map([[alias.cacheKey, alias]]),
      reason,
      priority,
      dueAt,
      queuedAt: nextQueueOrder(),
      windowId
    })
  }
  // Why: visible/SWR are background maintenance behind the budget queue; only user/action-driven queueing should surface in UI.
  if (shouldBroadcastQueued(reason, dueAt)) {
    broadcast({ aliases: [alias], reason, status: 'queued' })
  }
  scheduleDrain()
}

function reportVisiblePRRefreshCandidates(
  candidates: GitHubPRRefreshCandidate[],
  generation: number,
  windowId: number
): void {
  const existingVisible = visibleByWindow.get(windowId)
  if (existingVisible && generation < existingVisible.generation) {
    return
  }
  visibleByWindow.set(windowId, { generation, keys: new Set(candidates.map(refreshKey)) })
  removeInvisibleVisibleRefreshes()
  for (const candidate of candidates) {
    enqueuePRRefresh(candidate, 'visible', 40, windowId)
  }
}

function _getVisiblePRRefreshWindowCountForTests(): number {
  return visibleByWindow.size
}

function _getPRRefreshErrorBackoffCountForTests(): number {
  return errorBackoff.size
}

function _getPRRefreshQueueSizeForTests(): number {
  return queue.size
}

function _getPRRefreshAliasCountForTests(key: string): number {
  return queue.get(key)?.aliases.size ?? 0
}

async function refreshPRNow(candidate: GitHubPRRefreshCandidate): Promise<PRRefreshOutcome> {
  const alias = aliasFromCandidate(candidate)
  const key = refreshKey(candidate)
  const existing = queue.get(key)
  const aliasMap = new Map(existing ? existing.aliases : [])
  aliasMap.set(alias.cacheKey, alias)
  const aliases = Array.from(aliasMap.values())
  const skippedReason = validateCandidate(candidate)
  if (skippedReason) {
    removeQueuedAliasForInvalidCandidate(key, alias)
    const outcome: PRRefreshOutcome = {
      kind: 'upstream-error',
      errorType: 'unknown',
      message: `Cannot refresh PR for this worktree: ${skippedReason}`,
      fetchedAt: Date.now()
    }
    broadcast({ aliases: [alias], reason: 'manual', status: 'skipped', skippedReason })
    return outcome
  }

  // Why: enforce the rate-limit gate so a stale renderer can't bypass it; refuse without spending quota until the later of the two cooldowns.
  const manualExecutionOptions = ghRepoExecOptions(
    githubRepoContext(candidate.repoPath, candidate.connectionId, candidate.localGitOptions)
  )
  const manualRepository = await getOriginGitHubApiRepository(
    candidate.repoPath,
    candidate.connectionId,
    manualExecutionOptions
  )
  const manualBlockedGuard = backgroundRefreshBuckets()
    .map((bucket) => repositoryRateLimitGuard(manualRepository, bucket, manualExecutionOptions))
    .find((guard) => guard.blocked)
  const secondaryGateUntil = manualRetryGates.get(key)
  const gateUntil = Math.max(
    manualBlockedGuard?.blocked ? manualBlockedGuard.resetAt * 1000 : 0,
    secondaryGateUntil !== undefined ? secondaryGateUntil : 0
  )
  if (gateUntil > Date.now()) {
    const retryAt = gateUntil
    // Why: paused maps `pausedUntil` into the renderer's auto-retry, so requeue at reset (finding 12) — don't advertise an unscheduled retry.
    queue.set(key, {
      key,
      candidate,
      aliases: aliasMap,
      reason: 'manual',
      priority: 40,
      dueAt: retryAt,
      queuedAt: nextQueueOrder()
    })
    broadcast({
      aliases,
      reason: 'manual',
      status: 'paused',
      pausedUntil: retryAt,
      skippedReason: 'rate-limit'
    })
    scheduleDrain(Math.max(1_000, retryAt - Date.now()))
    return {
      kind: 'upstream-error',
      errorType: 'rate_limited',
      message: 'GitHub is temporarily limiting requests. Try again after the limit resets.',
      fetchedAt: Date.now(),
      nextAutoRetryAt: retryAt,
      retryDisabledUntil: retryAt
    }
  }

  queue.delete(key)
  const requestSequence = nextSequence()
  const requestStartedAt = Date.now()
  broadcast({ aliases, reason: 'manual', status: 'in-flight', requestStartedAt }, requestSequence)
  const outcome = await getPRForBranchOutcome(
    candidate.repoPath,
    candidate.branch,
    candidate.linkedPRNumber ?? null,
    candidate.connectionId ?? null,
    candidate.linkedPRNumber == null ? (candidate.fallbackPRNumber ?? null) : null,
    ...hostedReviewOptionArgs(candidate)
  )
  let plannedRetryAt: number | undefined
  let broadcastOutcome = outcome
  if (outcome.kind === 'upstream-error' && isVisibleKey(key)) {
    plannedRetryAt = nextVisibleErrorRetryAt(key)
    broadcastOutcome = withErrorSchedule(outcome, plannedRetryAt)
  }
  outcomeObserver?.(candidate, outcome)
  noteManualRetryGate(key, broadcastOutcome)
  broadcast(
    { aliases, reason: 'manual', outcome: broadcastOutcome, requestStartedAt },
    requestSequence
  )
  scheduleVisibleFollowUp(key, candidate, outcome, 40, aliases, undefined, {
    plannedRetryAt,
    // Why: GitHub reports UNKNOWN right after `gh pr reopen`; one prompt visible retry replaces the transient label.
    pendingMergeabilityDelayMs: MANUAL_MERGEABILITY_PENDING_REFRESH_MS
  })
  return broadcastOutcome
}

export { enqueuePRRefresh, reportVisiblePRRefreshCandidates, _getVisiblePRRefreshWindowCountForTests, _getPRRefreshErrorBackoffCountForTests, _getPRRefreshQueueSizeForTests, _getPRRefreshAliasCountForTests, refreshPRNow }

