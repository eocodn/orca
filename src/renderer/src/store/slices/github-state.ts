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

import { queryOverrideKeyPart, getRuntimeRepoTarget, getPRRefreshOwnerRuntimeEnvironmentId, getPRRefreshRuntimeRepoTarget, shouldEnqueueLocalPRRefresh, enqueueLocalGitHubPRRefresh, settingsForGitHubRepoOwner, settingsForGitHubFocusedRepoOwner, getRefreshAliasExecutionHostId, findRepoForGitHubOwner, getGitHubFocusedRepoOwnerHostId, getWorkItemsCacheKeyForOwner, getGitHubWorkItemSourceHostId, getGitHubWorkItemSourceCacheScope, getGitHubWorkItemSourceSettings, getGitHubRepoSourceSettings, getGitHubWorkItemRequestContext, listGitHubWorkItemsForRepo } from './github-state-project-view-cache-entry-support'
import type { ProjectViewCacheEntry, ProjectRowContentUpdate, GitHubPatchWorkItemOptions, ProjectRowContentPatch, GitHubWorkItemRequestContext, GitHubWorkItemRequestTarget, GitHubWorkItemsListArgs } from './github-state-project-view-cache-entry-support'
import { countGitHubWorkItemsForRepo, isGitHubUnavailableWorkItemsError, projectViewCacheKey, projectViewRequestKey, projectViewSourceScope, settingsForProjectViewCacheKey, inflightProjectViewRequests, optimisticFieldValueFromMutation, applyRowPatch, rollbackRowIfPresent, parseSlugAndNumber, PR_REFRESH_ACTIVE_STALE_MS, PR_REFRESH_PAUSED_GRACE_MS, bypassesGitHubPRRefreshFreshness, CACHE_TTL, CHECKS_CACHE_TTL, EMPTY_CHECKS_CACHE_TTL, WORK_ITEMS_CACHE_TTL, ERROR_TOAST_DURATION, inflightPRRequests, inflightIssueRequests, inflightChecksRequests, inflightCommentsRequests, inflightWorkItemsRequests, prRequestGenerations, prRefreshStartedHostedReviewEntries, PR_REFRESH_STARTED_HOSTED_REVIEW_ENTRY_MAX, _getGitHubPRRequestGenerationCountForTest, _getGitHubPRRefreshStartedEntryCountForTest, _clearGitHubPRRefreshStartedEntriesForTest, WORK_ITEM_FETCH_CONCURRENCY } from './github-state-count-git-hub-work-items-for-repo-support'
import type { WorkItemsCacheSources, WorkItemsCacheError, CacheEntry, FetchOptions, RepoScopedFetchOptions, PRRefreshState, PRRefreshStateClearToken, InflightChecks, InflightWorkItems } from './github-state-count-git-hub-work-items-for-repo-support'
import { acquireWorkItemSlot, workItemFetchWaiters, releaseWorkItemSlot, workItemsCacheKey, workItemsInflightRequestKey, issueCacheKey, runtimeScopedRepoCacheKey, sourceScopedRepoCacheKey, prCacheKey, repoCacheKeyPrefixes, matchesRepoCacheKey, clearInflightWorkItemsForRepo, evictRepoCacheEntries, normalizedRepoIdentity, normalizedHeadSha, prChecksCacheSuffix, prCommentsCacheSuffix, commentTimestamp, mergePRCommentIntoList, hasUsableCommentPayload, MAX_CACHE_ENTRIES, isFresh, getPRChecksCacheTtl, findWorktreeById, buildWorktreeLookupIndex, findUniqueWorktreeById } from './github-state-work-item-fetch-waiters-support'
import type { GitHubPRFallbackSource, WorktreeLookupEntry, WorktreeLookupIndex } from './github-state-work-item-fetch-waiters-support'
import { isStaleExactLinkedPRLookup, shouldClearDivergedLinkedMergedPR, shouldApplyDivergedLinkedPRClear, shouldClearBranchMismatchedLinkedOpenPR, shouldApplyBranchMismatchedLinkedPRClear, buildPRRefreshCandidate, githubHostedReviewFallbackPRNumber, shouldClearHostedReviewForNoGitHubPR, isGitHubLinkedReviewHintKey, prLookupHintKey, linkedReviewHintKeyForNoGitHubPR, hasNewerHostedReviewCacheEntry } from './github-state-is-stale-exact-linked-prlookup-support'
import { syncHostedReviewCacheFromGitHubPRResult, shouldWritePRCacheForHostedReviewSync, canPreserveReviewForFallbackMiss, shouldPreserveExistingPRForFallbackMiss, applyPRCacheResult, prRefreshStartedEntryKey, deletePRRefreshStartedEntry, setPRRefreshStartedHostedReviewEntry, setGitHubPRResultCaches } from './github-state-sync-hosted-review-cache-from-git-hub-prresult-support'
import { applyGitHubPRResultToCaches, evictStaleEntries, withBoundedCacheEntry, capRecordByInsertionOrder, capPrRefreshSequences, MAX_PR_REFRESH_STATE_ENTRIES, SETTLED_PR_REFRESH_STATUSES, ACTIVE_PR_REFRESH_STATUSES, isPRRefreshStateExpired, buildGitHubPRRefreshStateClearToken, getGitHubPRRefreshStateExpiryAt, isExpiredActivePRRefreshState, getEffectiveGitHubPRRefreshState, pruneExpiredPRRefreshStates, capPrRefreshStates, shouldRefreshIssueDecorations, debouncedSaveCache } from './github-state-apply-git-hub-prresult-to-caches-support'
import { normalizeRuntimePRForBranchOutcome } from './github-state-git-hub-slice-support'
import type { GitHubSlice } from './github-state-git-hub-slice-support'
export { queryOverrideKeyPart, getRuntimeRepoTarget, getPRRefreshOwnerRuntimeEnvironmentId, getPRRefreshRuntimeRepoTarget, shouldEnqueueLocalPRRefresh, enqueueLocalGitHubPRRefresh, settingsForGitHubRepoOwner, settingsForGitHubFocusedRepoOwner, getRefreshAliasExecutionHostId, findRepoForGitHubOwner, getGitHubFocusedRepoOwnerHostId, getWorkItemsCacheKeyForOwner, getGitHubWorkItemSourceHostId, getGitHubWorkItemSourceCacheScope, getGitHubWorkItemSourceSettings, getGitHubRepoSourceSettings, getGitHubWorkItemRequestContext, listGitHubWorkItemsForRepo, countGitHubWorkItemsForRepo, isGitHubUnavailableWorkItemsError, projectViewCacheKey, projectViewRequestKey, projectViewSourceScope, settingsForProjectViewCacheKey, inflightProjectViewRequests, optimisticFieldValueFromMutation, applyRowPatch, rollbackRowIfPresent, parseSlugAndNumber, PR_REFRESH_ACTIVE_STALE_MS, PR_REFRESH_PAUSED_GRACE_MS, bypassesGitHubPRRefreshFreshness, CACHE_TTL, CHECKS_CACHE_TTL, EMPTY_CHECKS_CACHE_TTL, WORK_ITEMS_CACHE_TTL, ERROR_TOAST_DURATION, inflightPRRequests, inflightIssueRequests, inflightChecksRequests, inflightCommentsRequests, inflightWorkItemsRequests, prRequestGenerations, prRefreshStartedHostedReviewEntries, PR_REFRESH_STARTED_HOSTED_REVIEW_ENTRY_MAX, _getGitHubPRRequestGenerationCountForTest, _getGitHubPRRefreshStartedEntryCountForTest, _clearGitHubPRRefreshStartedEntriesForTest, WORK_ITEM_FETCH_CONCURRENCY, workItemFetchWaiters, releaseWorkItemSlot, workItemsCacheKey, workItemsInflightRequestKey, issueCacheKey, runtimeScopedRepoCacheKey, sourceScopedRepoCacheKey, prCacheKey, repoCacheKeyPrefixes, matchesRepoCacheKey, clearInflightWorkItemsForRepo, evictRepoCacheEntries, normalizedRepoIdentity, normalizedHeadSha, prChecksCacheSuffix, prCommentsCacheSuffix, commentTimestamp, mergePRCommentIntoList, hasUsableCommentPayload, MAX_CACHE_ENTRIES, isFresh, getPRChecksCacheTtl, findWorktreeById, buildWorktreeLookupIndex, findUniqueWorktreeById, isStaleExactLinkedPRLookup, shouldClearDivergedLinkedMergedPR, shouldApplyDivergedLinkedPRClear, shouldClearBranchMismatchedLinkedOpenPR, shouldApplyBranchMismatchedLinkedPRClear, buildPRRefreshCandidate, githubHostedReviewFallbackPRNumber, shouldClearHostedReviewForNoGitHubPR, isGitHubLinkedReviewHintKey, prLookupHintKey, linkedReviewHintKeyForNoGitHubPR, hasNewerHostedReviewCacheEntry, syncHostedReviewCacheFromGitHubPRResult, shouldWritePRCacheForHostedReviewSync, canPreserveReviewForFallbackMiss, shouldPreserveExistingPRForFallbackMiss, applyPRCacheResult, prRefreshStartedEntryKey, deletePRRefreshStartedEntry, setPRRefreshStartedHostedReviewEntry, setGitHubPRResultCaches, applyGitHubPRResultToCaches, evictStaleEntries, withBoundedCacheEntry, capRecordByInsertionOrder, capPrRefreshSequences, MAX_PR_REFRESH_STATE_ENTRIES, SETTLED_PR_REFRESH_STATUSES, ACTIVE_PR_REFRESH_STATUSES, isPRRefreshStateExpired, buildGitHubPRRefreshStateClearToken, getGitHubPRRefreshStateExpiryAt, isExpiredActivePRRefreshState, getEffectiveGitHubPRRefreshState, pruneExpiredPRRefreshStates, capPrRefreshStates, shouldRefreshIssueDecorations, debouncedSaveCache, normalizeRuntimePRForBranchOutcome }
export type { ProjectViewCacheEntry, ProjectRowContentUpdate, GitHubPatchWorkItemOptions, ProjectRowContentPatch, GitHubWorkItemRequestContext, GitHubWorkItemRequestTarget, GitHubWorkItemsListArgs, WorkItemsCacheSources, WorkItemsCacheError, CacheEntry, FetchOptions, RepoScopedFetchOptions, PRRefreshState, PRRefreshStateClearToken, InflightChecks, InflightWorkItems, GitHubPRFallbackSource, WorktreeLookupEntry, WorktreeLookupIndex, GitHubSlice }
export { acquireWorkItemSlot }
import { createGitHubSlicePrCacheActions } from './github-state-pr-cache-actions'
import { createGitHubSlicePatchProjectIssueOrPrActions2 } from './github-state-patch-project-issue-or-pr-actions'
import { createGitHubSliceGetWorkItemsAnySourcesForRepoActions3 } from './github-state-get-work-items-any-sources-for-repo-actions'
import { createGitHubSliceInitGitHubCacheActions4 } from './github-state-init-git-hub-cache-actions'
import { createGitHubSliceFetchPrforBranchActions5 } from './github-state-fetch-prfor-branch-actions'
import { createGitHubSliceFetchIssueActions6 } from './github-state-fetch-issue-actions'
import { createGitHubSliceFetchPrcommentsActions7 } from './github-state-fetch-prcomments-actions'
import { createGitHubSliceResolveReviewThreadActions8 } from './github-state-resolve-review-thread-actions'
import { createGitHubSliceApplyGitHubPrrefreshEventActions9 } from './github-state-apply-git-hub-prrefresh-event-actions'
import { createGitHubSliceRefreshAllGitHubActions10 } from './github-state-refresh-all-git-hub-actions'
import { createGitHubSliceRefreshGitHubForWorktreeIfStaleActions11 } from './github-state-refresh-git-hub-for-worktree-if-stale-actions'

export const createGitHubSlice: StateCreator<AppState, [], [], GitHubSlice> = (set, get) => ({
  ...createGitHubSlicePrCacheActions(set, get),
  ...createGitHubSlicePatchProjectIssueOrPrActions2(set, get),
  ...createGitHubSliceGetWorkItemsAnySourcesForRepoActions3(set, get),
  ...createGitHubSliceInitGitHubCacheActions4(set, get),
  ...createGitHubSliceFetchPrforBranchActions5(set, get),
  ...createGitHubSliceFetchIssueActions6(set, get),
  ...createGitHubSliceFetchPrcommentsActions7(set, get),
  ...createGitHubSliceResolveReviewThreadActions8(set, get),
  ...createGitHubSliceApplyGitHubPrrefreshEventActions9(set, get),
  ...createGitHubSliceRefreshAllGitHubActions10(set, get),
  ...createGitHubSliceRefreshGitHubForWorktreeIfStaleActions11(set, get),
})
