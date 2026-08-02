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
import { hostedReviewOptionArgs, draining, queue, noteManualRetryGate, resetKeyRetryState, outcomeObserver, diagnosticsCounters, recordPRRefreshQueueDiagnostic, nextSequence, broadcast, isVisibleKey, isBackground, isBudgetedQueueEntry, validateCandidate, nextVisibleErrorRetryAt, withErrorSchedule, scheduleVisibleFollowUp, backgroundRefreshBuckets, noteBackgroundStart, nextBudgetDelay, noteActiveStart, entryDelay, isActiveBurstDelayed, nextQueuedWakeDelay, scheduleDrain, queuedEntriesByPriority } from './pr-refresh-queue-state'
async function drainQueue(): Promise<void> {
  if (draining) {
    return
  }
  draining = true
  try {
    while (queue.size > 0) {
      let next = queuedEntriesByPriority()[0]
      const waitMs = next.dueAt - Date.now()
      if (waitMs > 0) {
        scheduleDrain(waitMs)
        return
      }

      let delay = entryDelay(next)
      if (delay > 0) {
        const runnable = queuedEntriesByPriority().find(
          (entry) => entry.dueAt <= Date.now() && entryDelay(entry) === 0
        )
        if (runnable && runnable.key !== next.key) {
          next = runnable
          delay = 0
        } else {
          if (isActiveBurstDelayed(next) && !next.activeDelayNotified) {
            next.activeDelayNotified = true
            broadcast({
              aliases: Array.from(next.aliases.values()),
              reason: next.reason,
              status: 'queued'
            })
          }
          if (isBudgetedQueueEntry(next) && nextBudgetDelay() > 0) {
            diagnosticsCounters.backgroundPauses += 1
            recordPRRefreshQueueDiagnostic('background-pause', next.reason)
          }
          scheduleDrain(Math.min(delay, nextQueuedWakeDelay(next.key) ?? delay))
          return
        }
      }

      queue.delete(next.key)
      const aliases = Array.from(next.aliases.values())
      const skippedReason = validateCandidate(next.candidate)
      if (skippedReason) {
        diagnosticsCounters.skipped += 1
        recordPRRefreshQueueDiagnostic('skipped', next.reason, skippedReason)
        broadcast({ aliases, reason: next.reason, status: 'skipped', skippedReason })
        continue
      }
      if (next.reason === 'visible' && !isVisibleKey(next.key)) {
        resetKeyRetryState(next.key)
        broadcast({ aliases, reason: next.reason, status: 'skipped', skippedReason: 'fresh' })
        continue
      }
      const requestSequence = nextSequence()
      const requestStartedAt = Date.now()
      broadcast(
        { aliases, reason: next.reason, status: 'in-flight', requestStartedAt },
        requestSequence
      )

      if (isBackground(next.reason)) {
        const executionOptions = ghRepoExecOptions(
          githubRepoContext(
            next.candidate.repoPath,
            next.candidate.connectionId,
            next.candidate.localGitOptions
          )
        )
        const repository = await getOriginGitHubApiRepository(
          next.candidate.repoPath,
          next.candidate.connectionId,
          executionOptions
        )
        // Why: only native github.com uses the singleton snapshot; scoped breakers protect GHES and WSL.
        if (spendsSharedGitHubComQuota(repository, executionOptions)) {
          // Why: the probe only warms the cache, so failures must fail open (#7553).
          await getRateLimit()
        }
        const buckets = backgroundRefreshBuckets()
        const blockedGuard = buckets
          .map((bucket) => repositoryRateLimitGuard(repository, bucket, executionOptions))
          .find((guard) => guard.blocked)
        if (blockedGuard?.blocked) {
          const retryAt = blockedGuard.resetAt * 1000
          queue.set(next.key, { ...next, dueAt: retryAt })
          broadcast({
            aliases,
            reason: next.reason,
            status: 'paused',
            pausedUntil: retryAt,
            skippedReason: 'rate-limit'
          })
          scheduleDrain(Math.max(1_000, retryAt - Date.now()))
          continue
        }
        if (isBudgetedQueueEntry(next)) {
          noteBackgroundStart()
        }
        if (next.reason === 'active') {
          // Why: tab/worktree churn can enqueue many distinct active refreshes that each probe local Git.
          noteActiveStart(next)
        }
        for (const bucket of buckets) {
          noteRepositoryRateLimitSpend(repository, bucket, 1, executionOptions)
        }
      }

      const outcome = await getPRForBranchOutcome(
        next.candidate.repoPath,
        next.candidate.branch,
        next.candidate.linkedPRNumber ?? null,
        next.candidate.connectionId ?? null,
        next.candidate.linkedPRNumber == null ? (next.candidate.fallbackPRNumber ?? null) : null,
        ...hostedReviewOptionArgs(next.candidate)
      )
      // Why: compute the retry schedule before broadcasting so the outcome and its follow-up share one timing; only visible keys auto-retry.
      let plannedRetryAt: number | undefined
      let broadcastOutcome = outcome
      if (outcome.kind === 'upstream-error' && isVisibleKey(next.key)) {
        plannedRetryAt = nextVisibleErrorRetryAt(next.key)
        broadcastOutcome = withErrorSchedule(outcome, plannedRetryAt)
      }
      outcomeObserver?.(next.candidate, outcome)
      noteManualRetryGate(next.key, broadcastOutcome)
      broadcast(
        { aliases, reason: next.reason, outcome: broadcastOutcome, requestStartedAt },
        requestSequence
      )
      scheduleVisibleFollowUp(
        next.key,
        next.candidate,
        outcome,
        next.priority,
        aliases,
        next.windowId,
        {
          plannedRetryAt
        }
      )
    }
  } finally {
    draining = false
  }
}

export { drainQueue }

