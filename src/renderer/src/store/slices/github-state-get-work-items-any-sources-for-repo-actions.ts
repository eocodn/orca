/* import type { StateCreator } from 'zustand'
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
export function createGitHubSliceGetWorkItemsAnySourcesForRepoActions3(set: SliceSet, get: SliceGet) {
  return {
  getWorkItemsAnySourcesForRepo: (repoId, limit, repoPath) => {
    const cache = get().workItemsCache
    const primaryKey = getWorkItemsCacheKeyForOwner(get(), repoId, limit, '', repoPath)
    const primary = cache[primaryKey]?.sources
    if (primary) {
      return primary
    }
    const prefix = primaryKey
    for (const [key, entry] of Object.entries(cache)) {
      if (key.startsWith(prefix) && entry.sources) {
        return entry.sources
      }
    }
    return null
  },
  fetchWorkItems: async (repoId, repoPath, limit, query, options): Promise<GitHubWorkItem[]> => {
    if (isGitHubWorkItemsQueryTooLarge(query)) {
      return []
    }
    const requestState = get()
    const repo = findRepoForGitHubOwner(requestState, repoId, repoPath)
    const requestSettings = getGitHubWorkItemSourceSettings(
      requestState.settings,
      repo,
      options?.sourceContext
    )
    const ownerHostId = getGitHubWorkItemSourceHostId(requestState, repo, options?.sourceContext)
    const cacheScope = getGitHubWorkItemSourceCacheScope(requestState, repo, options?.sourceContext)
    const key = workItemsCacheKey(repoId, limit, query, cacheScope)
    const cached = get().workItemsCache[key]
    if (!options?.force && isFresh(cached, WORK_ITEMS_CACHE_TTL)) {
      return cached.data ?? []
    }

    const requestInvalidationNonce = requestState.workItemsInvalidationNonce
    const requestContext = getGitHubWorkItemRequestContext(
      requestState,
      requestSettings,
      repoId,
      repoPath,
      options?.sourceContext
    )
    const inflightKey = workItemsInflightRequestKey(key, requestContext.target)
    const existing = inflightWorkItemsRequests.get(inflightKey)
    if (existing) {
      // Why: a forcing/noCache caller must not dedupe to a weaker in-flight fetch (noCache is stricter — it must bypass gh api's cache too).
      if ((options?.force && !existing.force) || (options?.noCache && !existing.noCache)) {
        await existing.promise.catch(() => {})
      } else {
        return existing.promise
      }
    }

    const request = (async () => {
      await acquireWorkItemSlot()
      try {
        const envelope = await listGitHubWorkItemsForRepo(requestContext, {
          limit,
          query: query || undefined,
          ...(options?.noCache ? { noCache: true } : {})
        })
        // Why: stamp repoId at the fetch boundary so downstream consumers can rely on it — main doesn't know Orca's Repo.id.
        const items: GitHubWorkItem[] = envelope.items.map((item) => ({ ...item, repoId }))
        // Why: only surface issues-side errors here; PR-side failures predate the issue-source split (#1076) and are out of scope for this banner (design doc §2).
        const issuesError = envelope.errors?.issues
        // Why: errors.issues without sources.issues has no slug for the banner, so it's dropped from the cache; log it so this rare case is visible in devtools.
        if (issuesError && !envelope.sources.issues) {
          console.warn(
            '[workItems] dropping issues-side error with no resolved source:',
            issuesError
          )
        }
        const errorForCache: WorkItemsCacheError | undefined =
          issuesError && envelope.sources.issues
            ? { ...issuesError, source: envelope.sources.issues }
            : undefined
        const currentRepo = findRepoForGitHubOwner(get(), repoId, repoPath)
        const currentHostId = getGitHubWorkItemSourceHostId(
          get(),
          currentRepo,
          options?.sourceContext
        )
        // Why: repo ownership changed, so this response belongs to an older execution-host bucket (host focus changes alone are fine).
        if ((currentHostId ?? null) !== (ownerHostId ?? null)) {
          return items
        }
        // Why: the old promise can still settle after the in-flight clear; don't let pre-flip source data repopulate the cache once the invalidation nonce changed.
        if (get().workItemsInvalidationNonce !== requestInvalidationNonce) {
          return items
        }
        set((s) => ({
          workItemsCache: withBoundedCacheEntry(s.workItemsCache, key, {
            data: items,
            fetchedAt: Date.now(),
            sources: envelope.sources,
            ...(errorForCache ? { error: errorForCache } : {}),
            ...(envelope.issueSourceFellBack ? { issueSourceFellBack: true } : {})
          })
        }))
        return items
      } catch (err) {
        // Why: rethrow but keep the stale cache entry so the UI still renders while the user retries.
        if (!isGitHubWorkItemsSshRemoteRequiredError(err)) {
          console.error('Failed to fetch GitHub work items:', err)
        }
        throw err
      } finally {
        releaseWorkItemSlot()
        inflightWorkItemsRequests.delete(inflightKey)
      }
    })()

    inflightWorkItemsRequests.set(inflightKey, {
      promise: request,
      force: Boolean(options?.force),
      noCache: Boolean(options?.noCache)
    })
    return request
  },
  fetchWorkItemsAcrossRepos: async (repos, perRepoLimit, displayLimit, query, options) => {
    if (isGitHubWorkItemsQueryTooLarge(query)) {
      return { items: [], failedCount: 0, githubUnavailable: false }
    }
    const state = get()
    let failedCount = 0
    let requestFailureCount = 0
    let unavailableFailureCount = 0
    let skippedSourceCount = 0
    const perProjectResults = await Promise.all(
      repos.map(async (r) => {
        try {
          return await state.fetchWorkItems(r.repoId, r.path, perRepoLimit, query, {
            ...options,
            sourceContext: r.sourceContext ?? options?.sourceContext
          })
        } catch (err) {
          // Why: fall back to any cache entry (stale or not) before declaring this repo failed; only count as failed when it has nothing to contribute.
          // Why: use perRepoLimit (not displayLimit) so the cache key matches what fetchWorkItems wrote.
          if (isGitHubWorkItemsSshRemoteRequiredError(err)) {
            skippedSourceCount += 1
            return [] as GitHubWorkItem[]
          }
          requestFailureCount += 1
          if (isGitHubUnavailableWorkItemsError(err)) {
            unavailableFailureCount += 1
          }
          const key =
            r.sourceContext?.provider === 'github'
              ? workItemsCacheKey(
                  r.repoId,
                  perRepoLimit,
                  query,
                  getTaskSourceCacheScope(r.sourceContext)
                )
              : getWorkItemsCacheKeyForOwner(get(), r.repoId, perRepoLimit, query, r.path)
          const cached = get().workItemsCache[key]?.data
          if (cached) {
            console.warn(`[workItems] ${r.repoId} failed, serving cached:`, err)
            return cached
          }
          console.warn(`[workItems] ${r.repoId} failed:`, err)
          failedCount += 1
          return [] as GitHubWorkItem[]
        }
      })
    )
    const merged = sortWorkItemsByNumber(perProjectResults.flat()).slice(0, displayLimit)
    // Why: only claim global unavailability when every eligible source failed for a reachability reason; skipped SSH repos aren't GitHub sources here.
    const githubUnavailable =
      requestFailureCount > 0 &&
      requestFailureCount === repos.length - skippedSourceCount &&
      unavailableFailureCount === requestFailureCount
    return { items: merged, failedCount, githubUnavailable }
  },
  fetchWorkItemsNextPage: async (repos, perRepoLimit, displayLimit, query, page) => {
    if (isGitHubWorkItemsQueryTooLarge(query)) {
      return { items: [], failedCount: 0 }
    }
    let failedCount = 0
    const perProjectResults = await Promise.all(
      repos.map(async (r) => {
        const requestState = get()
        const repo = findRepoForGitHubOwner(requestState, r.repoId, r.path)
        const requestSettings = getGitHubWorkItemSourceSettings(
          requestState.settings,
          repo,
          r.sourceContext
        )
        const requestContext = getGitHubWorkItemRequestContext(
          requestState,
          requestSettings,
          r.repoId,
          r.path,
          r.sourceContext
        )
        await acquireWorkItemSlot()
        try {
          const envelope = await listGitHubWorkItemsForRepo(requestContext, {
            limit: perRepoLimit,
            query: query || undefined,
            page
          })
          // Why: page-N failures aren't in the per-repo banner (keyed on the initial fetch); log them so pagination failures are observable instead of silently truncating (richer surface deferred, design doc §6).
          if (envelope.errors?.issues) {
            console.warn(
              `[workItems] next page ${r.repoId} issues-side partial failure:`,
              envelope.errors.issues
            )
          }
          return envelope.items.map((item): GitHubWorkItem => ({ ...item, repoId: r.repoId }))
        } catch (err) {
          if (isGitHubWorkItemsSshRemoteRequiredError(err)) {
            return [] as GitHubWorkItem[]
          }
          console.warn(`[workItems] next page ${r.repoId} failed:`, err)
          failedCount += 1
          return [] as GitHubWorkItem[]
        } finally {
          releaseWorkItemSlot()
        }
      })
    )
    const merged = sortWorkItemsByNumber(perProjectResults.flat()).slice(0, displayLimit)
    return { items: merged, failedCount }
  },
  countWorkItemsAcrossRepos: async (repos, query, perRepoLimit) => {
    if (isGitHubWorkItemsQueryTooLarge(query)) {
      return { totalCount: 0, totalPages: 0 }
    }
    const normalizedLimit = Math.max(1, Math.floor(perRepoLimit))
    const counts = await Promise.all(
      repos.map(async (r) => {
        // Why: same stampede cap as item-fetch — without a slot a 90-repo selection fires 90 concurrent count IPCs before the main-side rate-limit guard sees the first 403.
        await acquireWorkItemSlot()
        try {
          const requestState = get()
          const repo = findRepoForGitHubOwner(requestState, r.repoId, r.path)
          const requestSettings = getGitHubWorkItemSourceSettings(
            requestState.settings,
            repo,
            r.sourceContext
          )
          const requestContext = getGitHubWorkItemRequestContext(
            requestState,
            requestSettings,
            r.repoId,
            r.path,
            r.sourceContext
          )
          return await countGitHubWorkItemsForRepo(requestContext, { query: query || undefined })
        } catch {
          return 0
        } finally {
          releaseWorkItemSlot()
        }
      })
    )
    return {
      totalCount: counts.reduce((sum, count) => sum + count, 0),
      // Why: repos advance independently by page, so take the max across repos — a sum/page-width undercounts when one repo owns most results.
      totalPages: counts.reduce(
        (maxPages, count) => Math.max(maxPages, Math.ceil(count / normalizedLimit)),
        0
      )
    }
  },
  prefetchWorkItems: (repoId, repoPath, limit = PER_REPO_FETCH_LIMIT, query = '', options) => {
    if (isGitHubWorkItemsQueryTooLarge(query)) {
      return
    }
    const requestState = get()
    const repo = findRepoForGitHubOwner(requestState, repoId, repoPath)
    const key =
      options?.sourceContext?.provider === 'github'
        ? workItemsCacheKey(repoId, limit, query, getTaskSourceCacheScope(options.sourceContext))
        : getWorkItemsCacheKeyForOwner(requestState, repoId, limit, query, repoPath)
    const cached = get().workItemsCache[key]
    const requestSettings = getGitHubWorkItemSourceSettings(
      requestState.settings,
      repo,
      options?.sourceContext
    )
    const requestContext = getGitHubWorkItemRequestContext(
      requestState,
      requestSettings,
      repoId,
      repoPath,
      options?.sourceContext
    )
    const inflightKey = workItemsInflightRequestKey(key, requestContext.target)
    if (isFresh(cached, WORK_ITEMS_CACHE_TTL) || inflightWorkItemsRequests.has(inflightKey)) {
      return
    }
    void get()
      .fetchWorkItems(repoId, repoPath, limit, query, { sourceContext: options?.sourceContext })
      .catch(() => {})
  },
  }
}