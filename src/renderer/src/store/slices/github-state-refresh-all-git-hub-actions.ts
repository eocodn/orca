import { getClientRuntime } from '@/runtime/client-runtime'
 import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import type { AppState } from '../types'
import { githubRepoIdentityKey } from '../../../../shared/github-repository-identity-key'
import { githubProjectIdentityKey } from '../../../../shared/github-project-identity'
import type {
  ClassifiedError,
  GitHubOwnerRepo,
  GitHubPRRefreshAlias,
  IssueSourcePreference,
  PRInfo,
  GitHubPRRefreshCandidate,
  GitHubPRRefreshEvent,
  GitHubPRRefreshReason,
  GitHubPRRefreshSkippedReason,
  PRRefreshErrorType,
  PRRefreshOutcome,
  GitHubCommentResult,
  IssueInfo,
  PRCheckDetail,
  PRCheckRunDetails,
  PRComment,
  Repo,
  Worktree,
  GitHubWorkItem,
  ListWorkItemsResult,
  GlobalSettings
} from '../../../../shared/types'
import type {
  GetProjectViewTableArgs,
  GetProjectViewTableResult,
  GitHubProjectFieldMutationValue,
  GitHubProjectMutationResult,
  GitHubProjectRow,
  GitHubProjectTable,
  GitHubProjectViewError
} from '../../../../shared/github-project-types'
import {
  isGitHubWorkItemsSshRemoteRequiredError,
  sortWorkItemsByNumber,
  PER_REPO_FETCH_LIMIT
} from '../../../../shared/work-items'
import { deriveCheckStatusFromChecks, syncPRChecksStatus } from './github-checks'
import {
  callRuntimeRpc,
  getActiveRuntimeTarget,
  RuntimeRpcCallError
} from '../../runtime/runtime-rpc-client'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import { settingsForProjectRowOwner } from './github-project-row-owner'
import { rightSidebarShowsPullRequestData } from '@/lib/right-sidebar-visibility'
import { hostedReviewInfoFromGitHubPRInfo } from '../../../../shared/hosted-review-github'
import { getHostedReviewCacheKey, linkedReviewHintKey } from './hosted-review-cache-identity'
import { getGitHubPRCacheKey, getGitHubRepoCacheKey } from './github-cache-key'
import { isGitHubWorkItemsQueryTooLarge } from './github-work-items-query-bounds'
import { classifyGitHubUnavailable } from '../../../../shared/github-api-availability'
import { isMacAppDataPath } from '@/lib/passive-macos-app-data-access'
import { translate } from '@/i18n/i18n'
import {
  LOCAL_EXECUTION_HOST_ID,
  getRepoExecutionHostId,
  getSettingsFocusedExecutionHostId,
  normalizeExecutionHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import {
  getTaskSourceCacheScope,
  getTaskSourceRuntimeSettings,
  type TaskSourceContext
} from '../../../../shared/task-source-context'

// ─── ProjectV2 cache types ────────────────────────────────────────────
// Why: separate from CacheEntry<T> — project-view has a single GraphQL source (no issue/PR fallback) and a distinct error union.
import { queryOverrideKeyPart, getRuntimeRepoTarget, getPRRefreshOwnerRuntimeEnvironmentId, getPRRefreshRuntimeRepoTarget, shouldEnqueueLocalPRRefresh, enqueueLocalGitHubPRRefresh, settingsForGitHubRepoOwner, settingsForGitHubFocusedRepoOwner, getRefreshAliasExecutionHostId, findRepoForGitHubOwner, getGitHubFocusedRepoOwnerHostId, getWorkItemsCacheKeyForOwner, getGitHubWorkItemSourceHostId, getGitHubWorkItemSourceCacheScope, getGitHubWorkItemSourceSettings, getGitHubRepoSourceSettings, getGitHubWorkItemRequestContext, listGitHubWorkItemsForRepo, countGitHubWorkItemsForRepo, isGitHubUnavailableWorkItemsError, projectViewCacheKey, projectViewRequestKey, projectViewSourceScope, settingsForProjectViewCacheKey, inflightProjectViewRequests, optimisticFieldValueFromMutation, applyRowPatch, rollbackRowIfPresent, parseSlugAndNumber, PR_REFRESH_ACTIVE_STALE_MS, PR_REFRESH_PAUSED_GRACE_MS, bypassesGitHubPRRefreshFreshness, CACHE_TTL, CHECKS_CACHE_TTL, EMPTY_CHECKS_CACHE_TTL, WORK_ITEMS_CACHE_TTL, ERROR_TOAST_DURATION, inflightPRRequests, inflightIssueRequests, inflightChecksRequests, inflightCommentsRequests, inflightWorkItemsRequests, prRequestGenerations, prRefreshStartedHostedReviewEntries, PR_REFRESH_STARTED_HOSTED_REVIEW_ENTRY_MAX, _getGitHubPRRequestGenerationCountForTest, _getGitHubPRRefreshStartedEntryCountForTest, _clearGitHubPRRefreshStartedEntriesForTest, WORK_ITEM_FETCH_CONCURRENCY, workItemFetchWaiters, releaseWorkItemSlot, workItemsCacheKey, workItemsInflightRequestKey, issueCacheKey, runtimeScopedRepoCacheKey, sourceScopedRepoCacheKey, prCacheKey, repoCacheKeyPrefixes, matchesRepoCacheKey, clearInflightWorkItemsForRepo, evictRepoCacheEntries, normalizedRepoIdentity, normalizedHeadSha, prChecksCacheSuffix, prCommentsCacheSuffix, commentTimestamp, mergePRCommentIntoList, hasUsableCommentPayload, MAX_CACHE_ENTRIES, isFresh, getPRChecksCacheTtl, findWorktreeById, buildWorktreeLookupIndex, findUniqueWorktreeById, isStaleExactLinkedPRLookup, shouldClearDivergedLinkedMergedPR, shouldApplyDivergedLinkedPRClear, shouldClearBranchMismatchedLinkedOpenPR, shouldApplyBranchMismatchedLinkedPRClear, buildPRRefreshCandidate, githubHostedReviewFallbackPRNumber, shouldClearHostedReviewForNoGitHubPR, isGitHubLinkedReviewHintKey, prLookupHintKey, linkedReviewHintKeyForNoGitHubPR, hasNewerHostedReviewCacheEntry, syncHostedReviewCacheFromGitHubPRResult, shouldWritePRCacheForHostedReviewSync, canPreserveReviewForFallbackMiss, shouldPreserveExistingPRForFallbackMiss, applyPRCacheResult, prRefreshStartedEntryKey, deletePRRefreshStartedEntry, setPRRefreshStartedHostedReviewEntry, setGitHubPRResultCaches, applyGitHubPRResultToCaches, evictStaleEntries, withBoundedCacheEntry, capRecordByInsertionOrder, capPrRefreshSequences, MAX_PR_REFRESH_STATE_ENTRIES, SETTLED_PR_REFRESH_STATUSES, ACTIVE_PR_REFRESH_STATUSES, isPRRefreshStateExpired, buildGitHubPRRefreshStateClearToken, getGitHubPRRefreshStateExpiryAt, isExpiredActivePRRefreshState, getEffectiveGitHubPRRefreshState, pruneExpiredPRRefreshStates, capPrRefreshStates, shouldRefreshIssueDecorations, debouncedSaveCache, normalizeRuntimePRForBranchOutcome } from './github-state'
import type { ProjectViewCacheEntry, ProjectRowContentUpdate, GitHubPatchWorkItemOptions, ProjectRowContentPatch, GitHubWorkItemRequestContext, GitHubWorkItemRequestTarget, GitHubWorkItemsListArgs, WorkItemsCacheSources, WorkItemsCacheError, CacheEntry, FetchOptions, RepoScopedFetchOptions, PRRefreshState, PRRefreshStateClearToken, InflightChecks, InflightWorkItems, GitHubPRFallbackSource, WorktreeLookupEntry, WorktreeLookupIndex, GitHubSlice } from './github-state'
type SliceSet = Parameters<StateCreator<AppState>>[0]
type SliceGet = Parameters<StateCreator<AppState>>[1]
export function createGitHubSliceRefreshAllGitHubActions10(set: SliceSet, get: SliceGet) {
  return {
  refreshAllGitHub: () => {
    // Clear comments cache; evict stale entries to bound long-session growth across repos/branches.
    set((s) => ({
      commentsCache: {},
      prCache: evictStaleEntries(s.prCache),
      issueCache: evictStaleEntries(s.issueCache),
      checksCache: evictStaleEntries(s.checksCache),
      workItemsCache: evictStaleEntries(s.workItemsCache),
      projectViewCache: evictStaleEntries(s.projectViewCache),
      prRefreshStates: pruneExpiredPRRefreshStates(s.prRefreshStates)
    }))

    // Why: don't prune prRequestGenerations here — deleting a live generation makes its response look stale.

    // Only re-fetch PR/issue entries that are already stale — skip fresh ones
    const state = get()
    const now = Date.now()
    const stalePRCandidates: { candidate: GitHubPRRefreshCandidate; score: number }[] = []
    const cardProps = state.worktreeCardProperties ?? []
    const rawCardProps = cardProps as readonly string[]
    const shouldRefreshIssues = shouldRefreshIssueDecorations(state)
    const isPRStatusGrouping = state.groupBy === 'pr-status'
    const rightSidebarShowsPR = rightSidebarShowsPullRequestData(state)
    const shouldRefreshPRs =
      isPRStatusGrouping ||
      rightSidebarShowsPR ||
      (state.settings?.experimentalNewWorktreeCardStyle === true
        ? cardProps.includes('status')
        : cardProps.includes('pr') || rawCardProps.includes('ci'))

    for (const worktrees of Object.values(state.worktreesByRepo)) {
      for (const wt of worktrees) {
        const repo = state.repos.find((r) => r.id === wt.repoId)
        if (!repo) {
          continue
        }

        const branch = wt.branch.replace(/^refs\/heads\//, '')
        if (shouldRefreshPRs && !wt.isBare && branch) {
          const ownerSettings = settingsForGitHubRepoOwner(state.settings, repo)
          const prKey = prCacheKey(
            repo.path,
            repo.id,
            branch,
            ownerSettings,
            repo.connectionId,
            repo.executionHostId
          )
          const prEntry = state.prCache[prKey]
          if (!prEntry || now - prEntry.fetchedAt >= CACHE_TTL) {
            const candidate = buildPRRefreshCandidate(state, wt)
            if (candidate) {
              stalePRCandidates.push({
                candidate,
                score:
                  (state.activeWorktreeId === wt.id ? Number.MAX_SAFE_INTEGER : 0) +
                  wt.lastActivityAt
              })
            }
          }
        }
        if (shouldRefreshIssues && wt.linkedIssue) {
          const ownerSettings = settingsForGitHubRepoOwner(state.settings, repo)
          const issueKey = issueCacheKey(
            repo.path,
            repo.id,
            wt.linkedIssue,
            ownerSettings,
            repo.connectionId,
            repo.executionHostId,
            true
          )
          const issueEntry = state.issueCache[issueKey]
          if (!issueEntry || now - issueEntry.fetchedAt >= CACHE_TTL) {
            void get().fetchIssue(repo.path, wt.linkedIssue, { repoId: repo.id })
          }
        }
      }
    }
    const candidatesToRefresh = stalePRCandidates
      .sort((a, b) => b.score - a.score)
      .slice(0, isPRStatusGrouping ? stalePRCandidates.length : 5)
    for (const { candidate } of candidatesToRefresh) {
      const candidateSettings = settingsForGitHubRepoOwner(
        state.settings,
        candidate as Pick<Repo, 'connectionId' | 'executionHostId'>
      )
      if (getRuntimeRepoTarget(state, candidate.repoPath, candidateSettings)) {
        void get().fetchPRForBranch(candidate.repoPath, candidate.branch, {
          repoId: candidate.repoId,
          worktreeId: candidate.worktreeId,
          linkedPRNumber: candidate.linkedPRNumber ?? null,
          fallbackPRNumber: candidate.fallbackPRNumber ?? null,
          fallbackPRSource: candidate.fallbackPRSource ?? null
        })
      } else if (shouldEnqueueLocalPRRefresh(candidate)) {
        enqueueLocalGitHubPRRefresh({ candidate, reason: 'swr', priority: 10 })
      }
    }
  },
  refreshGitHubForWorktree: (worktreeId) => {
    const state = get()
    let worktree: Worktree | undefined
    for (const worktrees of Object.values(state.worktreesByRepo)) {
      worktree = worktrees.find((w) => w.id === worktreeId)
      if (worktree) {
        break
      }
    }
    if (!worktree) {
      return
    }

    const repo = state.repos.find((r) => r.id === worktree.repoId)
    if (!repo) {
      return
    }

    // Invalidate this worktree's cache entries
    const branch = worktree.branch.replace(/^refs\/heads\//, '')
    const ownerSettings = settingsForGitHubRepoOwner(state.settings, repo)
    const prKey = prCacheKey(
      repo.path,
      repo.id,
      branch,
      ownerSettings,
      repo.connectionId,
      repo.executionHostId
    )
    const issueKey = worktree.linkedIssue
      ? issueCacheKey(
          repo.path,
          repo.id,
          worktree.linkedIssue,
          ownerSettings,
          repo.connectionId,
          repo.executionHostId,
          true
        )
      : ''

    set((s) => {
      const updates: Partial<AppState> = {}
      if (s.prCache[prKey]) {
        updates.prCache = { ...s.prCache, [prKey]: { ...s.prCache[prKey], fetchedAt: 0 } }
      }
      if (issueKey && s.issueCache[issueKey]) {
        updates.issueCache = {
          ...s.issueCache,
          [issueKey]: { ...s.issueCache[issueKey], fetchedAt: 0 }
        }
      }
      return updates
    })

    // Re-fetch (skip when branch is empty — detached HEAD during rebase)
    if (!worktree.isBare && branch) {
      const candidate = buildPRRefreshCandidate(get(), worktree)
      if (candidate) {
        if (getPRRefreshRuntimeRepoTarget(get(), candidate)) {
          void get().fetchPRForBranch(candidate.repoPath, candidate.branch, {
            force: true,
            repoId: candidate.repoId,
            worktreeId: candidate.worktreeId,
            linkedPRNumber: candidate.linkedPRNumber ?? null,
            fallbackPRNumber: candidate.fallbackPRNumber ?? null,
            fallbackPRSource: candidate.fallbackPRSource ?? null
          })
        } else if (shouldEnqueueLocalPRRefresh(candidate)) {
          enqueueLocalGitHubPRRefresh({ candidate, reason: 'post-push', priority: 100 })
        }
      }
    }
    if (shouldRefreshIssueDecorations(state) && worktree.linkedIssue) {
      void get().fetchIssue(repo.path, worktree.linkedIssue, { repoId: repo.id })
    }
  },
  patchWorkItem: (itemId, patch, repoId, options) => {
    set((s) => {
      const nextCache = { ...s.workItemsCache }
      let changed = false
      const sourceScope =
        options?.sourceContext?.provider === 'github'
          ? getTaskSourceCacheScope(options.sourceContext)
          : null
      for (const key of Object.keys(nextCache)) {
        // Why: don't patch another host/account's visually identical issue/PR cache entry.
        if (sourceScope && key !== sourceScope && !key.startsWith(`${sourceScope}::`)) {
          continue
        }
        const entry = nextCache[key]
        if (!entry?.data) {
          continue
        }
        // Why: issue/PR ids are only unique within a repo; cross-repo views can share `pr:42`.
        const idx = entry.data.findIndex(
          (item) => item.id === itemId && (!repoId || item.repoId === repoId)
        )
        if (idx === -1) {
          continue
        }
        const updatedItems = [...entry.data]
        updatedItems[idx] = { ...updatedItems[idx], ...patch }
        nextCache[key] = { ...entry, data: updatedItems }
        changed = true
      }
      return changed ? { workItemsCache: nextCache } : {}
    })
  },
  setIssueSourcePreference: async (repoId, repoPath, preference) => {
    // Why: optimistically patch the local Repo so the segmented control updates this frame; resync via fetchRepos on IPC failure.
    set((s) => ({
      repos: s.repos.map((r) =>
        r.id === repoId
          ? {
              ...r,
              issueSourcePreference: preference === 'auto' ? undefined : preference
            }
          : r
      )
    }))
    try {
      // Why: use the generic `repos:update` channel so a single write → single `repos:changed` broadcast re-fetches other windows.
      // Why: map 'auto' to undefined so persistence drops the key entirely (see main/persistence.ts#updateRepo).
      const updates = { issueSourcePreference: preference === 'auto' ? undefined : preference }
      // Why: route to the repo's owner host (like updateRepo) so the write lands where the repo lives, not the focused runtime.
      const target = getActiveRuntimeTarget(getSettingsForRepoRuntimeOwner(get(), repoId))
      await (target.kind === 'local'
        ? getClientRuntime().workspace.repos.update({ repoId, updates })
        : callRuntimeRpc(target, 'repo.update', { repo: repoId, updates }, { timeoutMs: 15_000 }))
    } catch (err) {
      console.error('Failed to persist issue-source preference:', err)
      // Why: without this toast the pill silently snaps back (optimistic patch + resync) and the user wouldn't know the write failed.
      toast.error(
        translate('auto.store.slices.github.d49ef4b944', 'Failed to save issue-source preference'),
        {
          duration: ERROR_TOAST_DURATION
        }
      )
      // Why: the optimistic patch may now disagree with disk; resync rather than leave a lie on screen.
      void get().fetchRepos()
    }
    // Why: clear inflight dedupe BEFORE bumping the nonce so the re-triggered fetch can't collapse onto a pre-flip in-flight entry.
    clearInflightWorkItemsForRepo(repoId, repoPath)
    // Why: evict AFTER the await so an overlapping fetch can't repopulate with pre-flip data; also drops legacy path-scoped keys.
    set((s) => {
      const prefix = `${repoId}::`
      const legacyPrefix = `${repoPath}::`
      const next: Record<string, CacheEntry<GitHubWorkItem[]>> = {}
      for (const [key, entry] of Object.entries(s.workItemsCache)) {
        if (!key.startsWith(prefix) && !key.startsWith(legacyPrefix)) {
          next[key] = entry
        }
      }
      // Why: the Tasks fetch effect keys on the nonce, not the cache, so bump it to re-run and re-populate the evicted entries.
      return { workItemsCache: next, workItemsInvalidationNonce: s.workItemsInvalidationNonce + 1 }
    })
  },
  evictGitHubRepoCaches: (repoId, repoPath) => {
    clearInflightWorkItemsForRepo(repoId, repoPath)
    set((s) => {
      const prefixes = repoCacheKeyPrefixes(repoId, repoPath)
      const workItems = evictRepoCacheEntries(s.workItemsCache, prefixes)
      const prs = evictRepoCacheEntries(s.prCache, prefixes)
      const issues = evictRepoCacheEntries(s.issueCache, prefixes)
      const checks = evictRepoCacheEntries(s.checksCache, prefixes)
      const comments = evictRepoCacheEntries(s.commentsCache, prefixes)
      const updates: Partial<AppState> = {}

      if (workItems.evicted) {
        updates.workItemsCache = workItems.cache
        updates.workItemsInvalidationNonce = s.workItemsInvalidationNonce + 1
      }
      if (prs.evicted) {
        updates.prCache = prs.cache
      }
      if (issues.evicted) {
        updates.issueCache = issues.cache
      }
      if (checks.evicted) {
        updates.checksCache = checks.cache
      }
      if (comments.evicted) {
        updates.commentsCache = comments.cache
      }

      return updates
    })
  },

  // Why: activation is the strongest freshness signal; route through the coordinator to keep coalescing/rate-limit guards.
  }
}
