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
export function createGitHubSliceApplyGitHubPrrefreshEventActions9(set: SliceSet, get: SliceGet) {
  return {
  applyGitHubPRRefreshEvent: (event) => {
    // Why: local-repo sidebar refresh routes through the main PR coordinator, so run the same guarded diverged-merged-PR clear.
    const divergedLinkedPRClears: {
      worktreeId: string
      linkedPRNumber: number
      branch: string
      requestHeadOid: string | null
      executionHostId: string
    }[] = []
    const branchMismatchedLinkedPRClears: {
      worktreeId: string
      linkedPRNumber: number
      branch: string
      requestHeadOid: string | null
      executionHostId: string
    }[] = []
    let didUpdatePRCache = false
    set((s) => {
      let linkedWorktreeLookupIndex: WorktreeLookupIndex | undefined
      const nextSequences = { ...s.prRefreshSequences }
      const prunedStates = pruneExpiredPRRefreshStates(s.prRefreshStates)
      const nextStates = { ...prunedStates }
      let nextPRCache = s.prCache
      let nextHostedReviewCache = s.hostedReviewCache ?? {}
      let changed = prunedStates !== s.prRefreshStates

      for (const alias of event.aliases) {
        const aliasExecutionHostId = getRefreshAliasExecutionHostId(alias)
        const previousSequence = nextSequences[alias.cacheKey] ?? 0
        if (
          event.outcome ? event.sequence < previousSequence : event.sequence <= previousSequence
        ) {
          if (event.outcome || event.status !== 'in-flight') {
            deletePRRefreshStartedEntry(event.sequence, alias.cacheKey)
          }
          continue
        }
        // Why: delete-then-set re-orders this key last so capPrRefreshSequences evicts idle, not active, keys.
        delete nextSequences[alias.cacheKey]
        nextSequences[alias.cacheKey] = event.sequence
        changed = true

        if (event.outcome) {
          const startedEntryKey = prRefreshStartedEntryKey(event.sequence, alias.cacheKey)
          const requestStartedEntry = prRefreshStartedHostedReviewEntries.get(startedEntryKey)
          prRefreshStartedHostedReviewEntries.delete(startedEntryKey)
          if (previousSequence !== event.sequence) {
            deletePRRefreshStartedEntry(previousSequence, alias.cacheKey)
          }
          delete nextStates[alias.cacheKey]
          if (event.outcome.kind === 'upstream-error') {
            nextStates[alias.cacheKey] = {
              status: 'error',
              reason: event.reason,
              updatedAt: Date.now(),
              message: event.outcome.message,
              errorType: event.outcome.errorType,
              nextAutoRetryAt: event.outcome.nextAutoRetryAt,
              retryDisabledUntil: event.outcome.retryDisabledUntil
            }
            continue
          }
          const data =
            event.outcome.kind === 'found'
              ? (() => {
                  const pr = event.outcome.pr
                  const checksCacheKeys = [
                    ...(alias.repoId
                      ? [
                          ...(pr.headSha
                            ? [
                                runtimeScopedRepoCacheKey(
                                  alias.repoPath,
                                  alias.repoId,
                                  prChecksCacheSuffix(pr.number, pr.prRepo, pr.headSha),
                                  s.settings,
                                  alias.connectionId,
                                  aliasExecutionHostId,
                                  true
                                )
                              ]
                            : []),
                          runtimeScopedRepoCacheKey(
                            alias.repoPath,
                            alias.repoId,
                            prChecksCacheSuffix(pr.number, pr.prRepo),
                            s.settings,
                            alias.connectionId,
                            aliasExecutionHostId,
                            true
                          )
                        ]
                      : []),
                    ...(pr.headSha
                      ? [
                          runtimeScopedRepoCacheKey(
                            alias.repoPath,
                            undefined,
                            prChecksCacheSuffix(pr.number, pr.prRepo, pr.headSha),
                            s.settings,
                            alias.connectionId,
                            aliasExecutionHostId,
                            true
                          )
                        ]
                      : []),
                    runtimeScopedRepoCacheKey(
                      alias.repoPath,
                      undefined,
                      prChecksCacheSuffix(pr.number, pr.prRepo),
                      s.settings,
                      alias.connectionId,
                      aliasExecutionHostId,
                      true
                    ),
                    `${alias.repoPath}::pr-checks::${pr.number}`
                  ]
                  const checksEntry = checksCacheKeys
                    .map((key) => s.checksCache[key])
                    .find((entry) => entry?.data)
                  if (
                    checksEntry?.data &&
                    checksEntry.headSha &&
                    pr.headSha &&
                    checksEntry.headSha === pr.headSha &&
                    event.outcome.fetchedAt - checksEntry.fetchedAt <
                      getPRChecksCacheTtl(checksEntry)
                  ) {
                    return { ...pr, checksStatus: deriveCheckStatusFromChecks(checksEntry.data) }
                  }
                  return pr
                })()
              : null
          const linkedPRNumber = alias.linkedPRNumber ?? null
          // Why: one outcome fans out to many aliases; build one lazy index instead of rescanning worktrees per alias.
          const worktreeLookupIndex =
            alias.worktreeId && linkedPRNumber != null
              ? (linkedWorktreeLookupIndex ??= buildWorktreeLookupIndex(s))
              : undefined
          // Why: a queued refresh finishing after the user unlinks an exact PR must not restore the manual-link UI.
          if (
            isStaleExactLinkedPRLookup(s, alias.worktreeId, linkedPRNumber, worktreeLookupIndex)
          ) {
            continue
          }
          if (event.outcome.kind === 'found' && alias.worktreeId) {
            const requestHeadOid = alias.currentHeadOid ?? null
            const worktree =
              linkedPRNumber != null
                ? findUniqueWorktreeById(
                    s,
                    alias.worktreeId,
                    aliasExecutionHostId,
                    worktreeLookupIndex
                  )
                : null
            // Why: only the sequence-gate winner owns metadata side effects; late outcomes must not unlink a newer PR.
            if (
              worktree &&
              linkedPRNumber != null &&
              shouldClearDivergedLinkedMergedPR({
                pr: event.outcome.pr,
                linkedPRNumber,
                requestHeadOid
              })
            ) {
              divergedLinkedPRClears.push({
                worktreeId: alias.worktreeId,
                linkedPRNumber,
                branch: alias.branch,
                requestHeadOid,
                executionHostId: aliasExecutionHostId
              })
            } else if (
              worktree &&
              linkedPRNumber != null &&
              shouldClearBranchMismatchedLinkedOpenPR({
                pr: event.outcome.pr,
                linkedPRNumber,
                branch: alias.branch,
                requestHeadOid,
                pushTargetBranch: worktree.pushTarget?.branchName ?? null
              })
            ) {
              branchMismatchedLinkedPRClears.push({
                worktreeId: alias.worktreeId,
                linkedPRNumber,
                branch: alias.branch,
                requestHeadOid,
                executionHostId: aliasExecutionHostId
              })
            }
          }
          const nextCaches = applyGitHubPRResultToCaches({
            prCache: nextPRCache,
            hostedReviewCache: nextHostedReviewCache,
            prCacheKey: alias.cacheKey,
            repoPath: alias.repoPath,
            branch: alias.branch,
            settings: s.settings,
            repoId: alias.repoId,
            connectionId: alias.connectionId,
            executionHostId: aliasExecutionHostId,
            hasRepoOwner: true,
            pr: data,
            fetchedAt: event.outcome.fetchedAt,
            state: s,
            worktreeId: alias.worktreeId,
            linkedPRNumber: alias.linkedPRNumber,
            fallbackPRNumber: alias.fallbackPRNumber,
            fallbackPRSource: alias.fallbackPRSource,
            requestStartedAt: event.requestStartedAt,
            requestStartedEntry
          })
          didUpdatePRCache = didUpdatePRCache || nextCaches.prCache !== nextPRCache
          nextPRCache = nextCaches.prCache
          nextHostedReviewCache = nextCaches.hostedReviewCache
          continue
        }

        if (event.status) {
          if (previousSequence !== event.sequence) {
            deletePRRefreshStartedEntry(previousSequence, alias.cacheKey)
          }
          if (event.status === 'in-flight' && event.requestStartedAt !== undefined) {
            const hostedReviewCacheKey = getHostedReviewCacheKey(
              alias.repoPath,
              alias.branch,
              s.settings,
              alias.repoId,
              alias.connectionId,
              aliasExecutionHostId,
              true
            )
            setPRRefreshStartedHostedReviewEntry(
              prRefreshStartedEntryKey(event.sequence, alias.cacheKey),
              s.hostedReviewCache[hostedReviewCacheKey]
            )
          } else {
            // Why: pause/skip can follow an in-flight broadcast with no outcome; drop the stale request-start snapshot.
            deletePRRefreshStartedEntry(event.sequence, alias.cacheKey)
          }
          // Why: delete-then-set re-orders this key last so capRecordByInsertionOrder evicts idle, not active, keys.
          delete nextStates[alias.cacheKey]
          const isPaused = event.status === 'paused'
          nextStates[alias.cacheKey] = {
            status: event.status,
            reason: event.reason,
            updatedAt: Date.now(),
            pausedUntil: event.pausedUntil,
            skippedReason: event.skippedReason,
            // Why: paused = rate-limit gate; map pausedUntil into the schedule to show auto-retry and disable manual Retry.
            nextAutoRetryAt: isPaused ? event.pausedUntil : undefined,
            retryDisabledUntil: isPaused ? event.pausedUntil : undefined
          }
        }
      }

      return changed
        ? {
            prRefreshSequences: capPrRefreshSequences(nextSequences),
            // Why: bound prRefreshStates with status-aware eviction so visible in-progress pills survive.
            prRefreshStates: capPrRefreshStates(nextStates),
            prCache: nextPRCache,
            hostedReviewCache: nextHostedReviewCache
          }
        : {}
    })
    if (didUpdatePRCache && event.outcome && event.outcome.kind !== 'upstream-error') {
      debouncedSaveCache(get())
    }
    for (const clear of divergedLinkedPRClears) {
      void get().updateWorktreeMeta(
        clear.worktreeId,
        { linkedPR: null },
        {
          shouldApply: () =>
            shouldApplyDivergedLinkedPRClear({
              worktree:
                findUniqueWorktreeById(get(), clear.worktreeId, clear.executionHostId) ?? undefined,
              linkedPRNumber: clear.linkedPRNumber,
              branch: clear.branch,
              requestHeadOid: clear.requestHeadOid
            })
        }
      )
    }
    for (const clear of branchMismatchedLinkedPRClears) {
      void get().updateWorktreeMeta(
        clear.worktreeId,
        { linkedPR: null },
        {
          shouldApply: () =>
            shouldApplyBranchMismatchedLinkedPRClear({
              worktree:
                findUniqueWorktreeById(get(), clear.worktreeId, clear.executionHostId) ?? undefined,
              linkedPRNumber: clear.linkedPRNumber,
              branch: clear.branch,
              requestHeadOid: clear.requestHeadOid
            })
        }
      )
    }
  },
  }
}