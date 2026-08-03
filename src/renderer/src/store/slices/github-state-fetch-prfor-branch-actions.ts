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
export function createGitHubSliceFetchPrforBranchActions5(set: SliceSet, get: SliceGet) {
  return {
  fetchPRForBranch: async (repoPath, branch, options): Promise<PRInfo | null> => {
    const repo = get().repos?.find((candidate) =>
      options?.repoId ? candidate.id === options.repoId : candidate.path === repoPath
    )
    const repoId = options?.repoId ?? repo?.id
    const requestSettings = settingsForGitHubRepoOwner(get().settings, repo)
    const cacheKey = prCacheKey(
      repoPath,
      repoId,
      branch,
      requestSettings,
      repo?.connectionId,
      repo?.executionHostId,
      repo !== undefined
    )
    const cached = get().prCache[cacheKey]
    const hostedReviewCacheKey = getHostedReviewCacheKey(
      repoPath,
      branch,
      requestSettings,
      repoId,
      repo?.connectionId,
      repo?.executionHostId,
      repo !== undefined
    )
    // Why: a prior linkedPR-less caller may have cached null for this branch; refetch so the cached miss can now resolve via the linkedPR path.
    const linkedPRNumber = options?.linkedPRNumber ?? null
    const explicitFallbackPRNumber = options?.fallbackPRNumber ?? null
    const hostedReviewFallbackPRNumber = githubHostedReviewFallbackPRNumber(
      get(),
      repoPath,
      repoId,
      branch,
      repo?.connectionId,
      repo?.executionHostId,
      repo !== undefined
    )
    const fallbackPRNumber =
      linkedPRNumber == null ? (explicitFallbackPRNumber ?? hostedReviewFallbackPRNumber) : null
    const fallbackPRSource: GitHubPRFallbackSource | null =
      linkedPRNumber != null || fallbackPRNumber == null
        ? null
        : (options?.fallbackPRSource ??
          (explicitFallbackPRNumber != null ? 'explicit' : 'hosted-review'))
    const lookupHintKey = prLookupHintKey(linkedPRNumber, fallbackPRNumber)
    const linkedRefetch =
      cached?.data === null && (linkedPRNumber !== null || fallbackPRNumber !== null)
    if (!options?.force && !linkedRefetch && isFresh(cached)) {
      // Why: even a fresh cache hit carries the head-scoped divergence signal; if a prior clear was declined for a mid-request head move and we're back on that head, clear the durable link.
      if (
        options?.worktreeId &&
        linkedPRNumber != null &&
        cached?.data?.headDivergedFromMergedPRAtOid != null
      ) {
        const currentHeadOid = findWorktreeById(get(), options.worktreeId)?.head ?? null
        if (
          shouldClearDivergedLinkedMergedPR({
            pr: cached.data,
            linkedPRNumber,
            requestHeadOid: currentHeadOid
          })
        ) {
          void get().updateWorktreeMeta(
            options.worktreeId,
            { linkedPR: null },
            {
              shouldApply: (worktree) =>
                shouldApplyDivergedLinkedPRClear({
                  worktree,
                  linkedPRNumber,
                  branch,
                  requestHeadOid: currentHeadOid
                })
            }
          )
        }
      }
      return cached.data
    }

    const inflightRequest = inflightPRRequests.get(cacheKey)
    if (
      inflightRequest &&
      (!options?.force || inflightRequest.force) &&
      inflightRequest.lookupHintKey === lookupHintKey &&
      !linkedRefetch
    ) {
      return inflightRequest.promise
    }

    const generation = (prRequestGenerations.get(cacheKey) ?? 0) + 1
    const requestStartedAt = Date.now()
    const requestStartedHostedReviewEntry = get().hostedReviewCache[hostedReviewCacheKey]
    const requestStartedPRRefreshState = get().prRefreshStates[cacheKey]
    const requestStartedPRRefreshToken = buildGitHubPRRefreshStateClearToken(
      requestStartedPRRefreshState,
      get().prRefreshSequences,
      cacheKey
    )
    prRequestGenerations.set(cacheKey, generation)

    const request = (async () => {
      try {
        const runtimeRepo = getRuntimeRepoTarget(get(), repoPath, requestSettings)
        const candidateWorktree = options?.worktreeId
          ? findWorktreeById(get(), options.worktreeId)
          : null
        const requestHeadOid = candidateWorktree?.head ?? null
        const outcome = runtimeRepo
          ? await callRuntimeRpc<PRRefreshOutcome | PRInfo | null>(
              runtimeRepo.target,
              'github.prForBranch',
              {
                repo: runtimeRepo.repo.id,
                branch,
                linkedPRNumber,
                currentHeadOid: requestHeadOid,
                ...(fallbackPRNumber !== null
                  ? { fallbackPRNumber, acceptMergedFallbackPR: fallbackPRSource !== null }
                  : {})
              },
              { timeoutMs: 30_000 }
            ).then((result) => normalizeRuntimePRForBranchOutcome(result))
          : await (async () => {
              const candidate: GitHubPRRefreshCandidate = {
                repoId: repoId ?? '',
                repoPath,
                repoKind: repo?.kind ?? 'git',
                branch,
                cacheKey,
                worktreeId: options?.worktreeId,
                currentHeadOid: requestHeadOid,
                linkedPRNumber,
                fallbackPRNumber,
                fallbackPRSource,
                connectionId: repo?.connectionId ?? null,
                executionHostId: repo?.executionHostId ?? null,
                cachedFetchedAt: cached?.fetchedAt ?? null,
                cachedHasPR: cached?.data ? true : cached ? false : null,
                cachedPRState: cached?.data?.state ?? null,
                cachedChecksStatus: cached?.data?.checksStatus ?? null,
                cachedMergeable: cached?.data?.mergeable ?? null,
                cachedMergeStateStatus: cached?.data?.mergeStateStatus ?? null
              }
              return window.api.gh.refreshPRNow
                ? await window.api.gh.refreshPRNow({ candidate })
                : await window.api.gh
                    .prForBranch({
                      repoPath,
                      repoId,
                      branch,
                      linkedPRNumber,
                      fallbackPRNumber,
                      acceptMergedFallbackPR:
                        fallbackPRNumber !== null && fallbackPRSource !== null,
                      currentHeadOid: requestHeadOid
                    })
                    .then((pr) =>
                      pr
                        ? ({ kind: 'found', pr, fetchedAt: Date.now() } as const)
                        : ({ kind: 'no-pr', fetchedAt: Date.now() } as const)
                    )
            })()
        const pr: PRInfo | null =
          outcome.kind === 'found' ? outcome.pr : outcome.kind === 'no-pr' ? null : null
        if (outcome.kind === 'upstream-error') {
          // Why: the runtime RPC path skips the coordinator broadcast that fills prRefreshStates on native, so record the classified error here for Checks parity with native (design criterion 2).
          if (runtimeRepo && prRequestGenerations.get(cacheKey) === generation) {
            set((s) => {
              const nextStates = { ...s.prRefreshStates }
              delete nextStates[cacheKey]
              nextStates[cacheKey] = {
                status: 'error',
                reason: 'swr',
                updatedAt: Date.now(),
                message: outcome.message,
                errorType: outcome.errorType,
                nextAutoRetryAt: outcome.nextAutoRetryAt,
                retryDisabledUntil: outcome.retryDisabledUntil
              }
              return { prRefreshStates: nextStates }
            })
          }
          return cached?.data ?? null
        }
        if (prRequestGenerations.get(cacheKey) === generation) {
          let skippedStaleLinkedPRLookup = false
          let didUpdatePRCache = false
          set((s) => {
            // Why: unlinking a PR mid exact-linked-PR-lookup must stop the older result from restoring the manual link UI.
            if (isStaleExactLinkedPRLookup(s, options?.worktreeId, linkedPRNumber)) {
              skippedStaleLinkedPRLookup = true
              return {}
            }
            const updates = setGitHubPRResultCaches(s, {
              prCacheKey: cacheKey,
              repoPath,
              branch,
              settings: requestSettings,
              repoId,
              connectionId: repo?.connectionId,
              executionHostId: repo?.executionHostId,
              hasRepoOwner: repo !== undefined,
              pr,
              fetchedAt: outcome.fetchedAt,
              worktreeId: options?.worktreeId,
              linkedPRNumber,
              fallbackPRNumber,
              fallbackPRSource,
              requestStartedAt,
              requestStartedEntry: requestStartedHostedReviewEntry
            })
            didUpdatePRCache = updates.prCache !== undefined
            return updates
          })
          if (skippedStaleLinkedPRLookup) {
            return null
          }
          if (didUpdatePRCache) {
            debouncedSaveCache(get())
          }
          const linkedPRWorktree =
            options?.worktreeId && linkedPRNumber != null
              ? findUniqueWorktreeById(
                  get(),
                  options.worktreeId,
                  repo ? getRepoExecutionHostId(repo) : LOCAL_EXECUTION_HOST_ID
                )
              : null
          if (
            options?.worktreeId &&
            linkedPRWorktree &&
            linkedPRNumber != null &&
            shouldClearDivergedLinkedMergedPR({ pr, linkedPRNumber, requestHeadOid })
          ) {
            // Why: only clear the durable link that produced this exact probe; drift means the stale result no longer owns the worktree.
            void get().updateWorktreeMeta(
              options.worktreeId,
              { linkedPR: null },
              {
                shouldApply: () =>
                  shouldApplyDivergedLinkedPRClear({
                    worktree:
                      findUniqueWorktreeById(
                        get(),
                        options.worktreeId!,
                        repo ? getRepoExecutionHostId(repo) : LOCAL_EXECUTION_HOST_ID
                      ) ?? undefined,
                    linkedPRNumber,
                    branch,
                    requestHeadOid
                  })
              }
            )
          }
          if (
            options?.worktreeId &&
            linkedPRWorktree &&
            linkedPRNumber != null &&
            shouldClearBranchMismatchedLinkedOpenPR({
              pr,
              linkedPRNumber,
              branch,
              requestHeadOid,
              pushTargetBranch: linkedPRWorktree.pushTarget?.branchName ?? null
            })
          ) {
            void get().updateWorktreeMeta(
              options.worktreeId,
              { linkedPR: null },
              {
                // Why: the branch-scoped PR refetch below updates both caches; the generic metadata refresh would duplicate provider work.
                suppressHostedReviewRefresh: true,
                shouldApply: () =>
                  shouldApplyBranchMismatchedLinkedPRClear({
                    worktree:
                      findUniqueWorktreeById(
                        get(),
                        options.worktreeId!,
                        repo ? getRepoExecutionHostId(repo) : LOCAL_EXECUTION_HOST_ID
                      ) ?? undefined,
                    linkedPRNumber,
                    branch,
                    requestHeadOid
                  })
              }
            )
            // Re-resolve by branch now so Checks recover this refresh instead of serving the stale linked PR.
            void get().fetchPRForBranch(repoPath, branch, {
              force: true,
              repoId,
              worktreeId: options.worktreeId
            })
          }
        }
        if (
          shouldPreserveExistingPRForFallbackMiss({
            currentPR: get().prCache[cacheKey]?.data,
            nextPR: pr,
            state: get(),
            worktreeId: options?.worktreeId,
            linkedPRNumber,
            fallbackPRNumber,
            fallbackPRSource
          })
        ) {
          return get().prCache[cacheKey]?.data ?? null
        }
        return pr ?? null
      } catch (err) {
        console.error('Failed to fetch PR:', err)
        return null
      } finally {
        const activeRequest = inflightPRRequests.get(cacheKey)
        if (activeRequest?.generation === generation) {
          inflightPRRequests.delete(cacheKey)
          if (prRequestGenerations.get(cacheKey) === generation) {
            prRequestGenerations.delete(cacheKey)
          }
        }
        if (requestStartedPRRefreshToken) {
          get().expireGitHubPRRefreshState(cacheKey, requestStartedPRRefreshToken)
        }
      }
    })()

    inflightPRRequests.set(cacheKey, {
      promise: request,
      force: Boolean(options?.force),
      generation,
      lookupHintKey
    })
    return request
  },
  }
}
