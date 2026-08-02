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
import { queryOverrideKeyPart, getRuntimeRepoTarget, getPRRefreshOwnerRuntimeEnvironmentId, getPRRefreshRuntimeRepoTarget, shouldEnqueueLocalPRRefresh, enqueueLocalGitHubPRRefresh, settingsForGitHubRepoOwner, settingsForGitHubFocusedRepoOwner, getRefreshAliasExecutionHostId, findRepoForGitHubOwner, getGitHubFocusedRepoOwnerHostId, getWorkItemsCacheKeyForOwner, getGitHubWorkItemSourceHostId, getGitHubWorkItemSourceCacheScope, getGitHubWorkItemSourceSettings, getGitHubRepoSourceSettings, getGitHubWorkItemRequestContext, listGitHubWorkItemsForRepo, countGitHubWorkItemsForRepo, isGitHubUnavailableWorkItemsError, projectViewCacheKey, projectViewRequestKey, projectViewSourceScope, settingsForProjectViewCacheKey, inflightProjectViewRequests, optimisticFieldValueFromMutation, applyRowPatch, rollbackRowIfPresent, parseSlugAndNumber, PR_REFRESH_ACTIVE_STALE_MS, PR_REFRESH_PAUSED_GRACE_MS, bypassesGitHubPRRefreshFreshness, CACHE_TTL, CHECKS_CACHE_TTL, EMPTY_CHECKS_CACHE_TTL, WORK_ITEMS_CACHE_TTL, ERROR_TOAST_DURATION, inflightPRRequests, inflightIssueRequests, inflightChecksRequests, inflightCommentsRequests, inflightWorkItemsRequests, prRequestGenerations, prRefreshStartedHostedReviewEntries, PR_REFRESH_STARTED_HOSTED_REVIEW_ENTRY_MAX, _getGitHubPRRequestGenerationCountForTest, _getGitHubPRRefreshStartedEntryCountForTest, _clearGitHubPRRefreshStartedEntriesForTest, WORK_ITEM_FETCH_CONCURRENCY, workItemFetchWaiters, releaseWorkItemSlot, workItemsCacheKey, workItemsInflightRequestKey, issueCacheKey, runtimeScopedRepoCacheKey, sourceScopedRepoCacheKey, prCacheKey, repoCacheKeyPrefixes, matchesRepoCacheKey, clearInflightWorkItemsForRepo, evictRepoCacheEntries, normalizedRepoIdentity, normalizedHeadSha, prChecksCacheSuffix, prCommentsCacheSuffix, commentTimestamp, mergePRCommentIntoList, hasUsableCommentPayload, MAX_CACHE_ENTRIES, isFresh, getPRChecksCacheTtl, findWorktreeById, buildWorktreeLookupIndex, findUniqueWorktreeById, isStaleExactLinkedPRLookup, shouldClearDivergedLinkedMergedPR, shouldApplyDivergedLinkedPRClear, shouldClearBranchMismatchedLinkedOpenPR, shouldApplyBranchMismatchedLinkedPRClear, buildPRRefreshCandidate, githubHostedReviewFallbackPRNumber, shouldClearHostedReviewForNoGitHubPR, isGitHubLinkedReviewHintKey, prLookupHintKey, linkedReviewHintKeyForNoGitHubPR, hasNewerHostedReviewCacheEntry, syncHostedReviewCacheFromGitHubPRResult, shouldWritePRCacheForHostedReviewSync, canPreserveReviewForFallbackMiss, shouldPreserveExistingPRForFallbackMiss, applyPRCacheResult, prRefreshStartedEntryKey, deletePRRefreshStartedEntry, setPRRefreshStartedHostedReviewEntry, setGitHubPRResultCaches, applyGitHubPRResultToCaches, evictStaleEntries, withBoundedCacheEntry, capRecordByInsertionOrder, capPrRefreshSequences, MAX_PR_REFRESH_STATE_ENTRIES, SETTLED_PR_REFRESH_STATUSES, ACTIVE_PR_REFRESH_STATUSES, isPRRefreshStateExpired, buildGitHubPRRefreshStateClearToken, getGitHubPRRefreshStateExpiryAt, isExpiredActivePRRefreshState, getEffectiveGitHubPRRefreshState, pruneExpiredPRRefreshStates, capPrRefreshStates, shouldRefreshIssueDecorations, debouncedSaveCache } from './github-state'
import type { ProjectViewCacheEntry, ProjectRowContentUpdate, GitHubPatchWorkItemOptions, ProjectRowContentPatch, GitHubWorkItemRequestContext, GitHubWorkItemRequestTarget, GitHubWorkItemsListArgs, WorkItemsCacheSources, WorkItemsCacheError, CacheEntry, FetchOptions, RepoScopedFetchOptions, PRRefreshState, PRRefreshStateClearToken, InflightChecks, InflightWorkItems, GitHubPRFallbackSource, WorktreeLookupEntry, WorktreeLookupIndex } from './github-state'
export type GitHubSlice = {
  prCache: Record<string, CacheEntry<PRInfo>>
  issueCache: Record<string, CacheEntry<IssueInfo>>
  checksCache: Record<string, CacheEntry<PRCheckDetail[]>>
  commentsCache: Record<string, CacheEntry<PRComment[]>>
  prRefreshSequences: Record<string, number>
  prRefreshStates: Record<string, PRRefreshState>
  prVisibleRefreshGeneration: number
  // Why: keyed by repoId + limit + query so same-path repos on different SSH targets don't share results.
  workItemsCache: Record<string, CacheEntry<GitHubWorkItem[]>>
  fetchPRForBranch: (
    repoPath: string,
    branch: string,
    options?: RepoScopedFetchOptions & {
      worktreeId?: string
      linkedPRNumber?: number | null
      fallbackPRNumber?: number | null
      fallbackPRSource?: GitHubPRFallbackSource | null
    }
  ) => Promise<PRInfo | null>
  fetchIssue: (
    repoPath: string,
    number: number,
    options?: RepoScopedFetchOptions
  ) => Promise<IssueInfo | null>
  fetchPRChecks: (
    repoPath: string,
    prNumber: number,
    branch?: string,
    headSha?: string,
    prRepo?: GitHubOwnerRepo | null,
    options?: RepoScopedFetchOptions
  ) => Promise<PRCheckDetail[]>
  fetchPRCheckDetails: (
    repoPath: string,
    args: {
      checkRunId?: number
      workflowRunId?: number
      checkName?: string
      url?: string | null
      prRepo?: GitHubOwnerRepo | null
    },
    options?: RepoScopedFetchOptions
  ) => Promise<PRCheckRunDetails | null>
  fetchPRComments: (
    repoPath: string,
    prNumber: number,
    options?: RepoScopedFetchOptions & { prRepo?: GitHubOwnerRepo | null }
  ) => Promise<PRComment[]>
  addPRConversationComment: (
    repoPath: string,
    prNumber: number,
    body: string,
    options?: RepoScopedFetchOptions & { prRepo?: GitHubOwnerRepo | null }
  ) => Promise<GitHubCommentResult>
  addPRReviewCommentReply: (
    repoPath: string,
    prNumber: number,
    commentId: number,
    body: string,
    options?: RepoScopedFetchOptions & {
      prRepo?: GitHubOwnerRepo | null
      threadId?: string
      path?: string
      line?: number
    }
  ) => Promise<GitHubCommentResult>
  resolveReviewThread: (
    repoPath: string,
    prNumber: number,
    threadId: string,
    resolve: boolean,
    options?: RepoScopedFetchOptions & { prRepo?: GitHubOwnerRepo | null }
  ) => Promise<boolean>
  initGitHubCache: () => Promise<void>
  refreshAllGitHub: () => void
  refreshGitHubForWorktree: (worktreeId: string) => void
  refreshGitHubForWorktreeIfStale: (worktreeId: string) => void
  enqueueGitHubPRRefresh: (
    worktreeId: string,
    reason: GitHubPRRefreshReason,
    priority?: number
  ) => void
  reportVisibleGitHubPRRefreshCandidates: (worktreeIds: string[], generation: number) => void
  bumpGitHubPRVisibleRefreshGeneration: () => void
  applyGitHubPRRefreshEvent: (event: GitHubPRRefreshEvent) => void
  getEffectiveGitHubPRRefreshState: (cacheKey: string, now?: number) => PRRefreshState | undefined
  expireGitHubPRRefreshState: (
    cacheKey: string,
    token: PRRefreshStateClearToken,
    now?: number
  ) => void
  /** SWR: returns cached work items immediately (null if none) and fires a background refresh when stale. */
  getCachedWorkItems: (
    repoId: string,
    limit: number,
    query: string,
    repoPath?: string,
    sourceContext?: TaskSourceContext | null
  ) => GitHubWorkItem[] | null
  /** Returns a thin view (sources + error, never items) so it stays a cheap selector without dragging the whole work-item array through the equality check. */
  getWorkItemsSourcesAndError: (
    repoId: string,
    limit: number,
    query: string,
    repoPath?: string
  ) => { sources: WorkItemsCacheSources | null; error: WorkItemsCacheError | null }
  /**
   * Falls back to any `${repoPath}::` cache entry with resolved sources when the primary entry isn't populated yet — sources are repo-level (query-independent), so any sibling is safe to reuse.
   * Returns a single stable reference so the dialog can subscribe to just this selector; entries are replaced (not mutated) on write, preserving reference equality between unchanged entries.
   */
  getWorkItemsAnySourcesForRepo: (
    repoId: string,
    limit: number,
    repoPath?: string
  ) => WorkItemsCacheSources | null
  fetchWorkItems: (
    repoId: string,
    repoPath: string,
    limit: number,
    query: string,
    options?: FetchOptions
  ) => Promise<GitHubWorkItem[]>
  /**
   * Fan out one work-item query across repos; partial failures don't reject — a repo with no cached fallback increments `failedCount`, but one served stale cache on rejection isn't counted.
   * `githubUnavailable`: every selected GitHub source refresh failed because GitHub was unreachable (5xx/network/rate-limit), even if stale cache remains — lets the caller attribute the stale/empty list.
   */
  fetchWorkItemsAcrossRepos: (
    repos: {
      repoId: string
      path: string
      executionHostId?: string | null
      sourceContext?: TaskSourceContext | null
    }[],
    perRepoLimit: number,
    displayLimit: number,
    query: string,
    options?: FetchOptions
  ) => Promise<{ items: GitHubWorkItem[]; failedCount: number; githubUnavailable: boolean }>
  /** Fetch one numbered provider page. Pagination pages remain renderer-local. */
  fetchWorkItemsNextPage: (
    repos: {
      repoId: string
      path: string
      executionHostId?: string | null
      sourceContext?: TaskSourceContext | null
    }[],
    perRepoLimit: number,
    displayLimit: number,
    query: string,
    page: number
  ) => Promise<{ items: GitHubWorkItem[]; failedCount: number }>
  /** Count items and derive pages from the largest per-repo result set. */
  countWorkItemsAcrossRepos: (
    repos: {
      repoId: string
      path: string
      executionHostId?: string | null
      sourceContext?: TaskSourceContext | null
    }[],
    query: string,
    perRepoLimit: number
  ) => Promise<{ totalCount: number; totalPages: number }>
  /** Fire-and-forget prefetch to warm the cache before the page mounts (hover/focus of the "new workspace" buttons). */
  prefetchWorkItems: (
    repoId: string,
    repoPath: string,
    limit?: number,
    query?: string,
    options?: { sourceContext?: TaskSourceContext | null }
  ) => void
  patchWorkItem: (
    itemId: string,
    patch: Partial<GitHubWorkItem>,
    repoId?: string | null,
    options?: GitHubPatchWorkItemOptions
  ) => void
  /** Monotonic counter bumped on issue-source preference flips; subscribers include it in their deps to force a re-fetch, since cache eviction alone won't trip effects keyed on selectedRepos/search/nonce. */
  workItemsInvalidationNonce: number
  /** Persist the preference, update the local Repo record, and invalidate all `${repoId}::*` cache keys — not just the primary — so alternate-query lines don't serve stale results after the source flips. */
  setIssueSourcePreference: (
    repoId: string,
    repoPath: string,
    preference: IssueSourcePreference
  ) => Promise<void>
  evictGitHubRepoCaches: (repoId: string, repoPath?: string) => void
  // ── ProjectV2 view cache ─────────────────────────────────────────────
  projectViewCache: Record<string, ProjectViewCacheEntry<GitHubProjectTable>>
  fetchProjectViewTable: (
    args: GetProjectViewTableArgs,
    options?: FetchOptions
  ) => Promise<GetProjectViewTableResult>
  updateProjectFieldValue: (
    cacheKey: string,
    rowId: string,
    fieldId: string,
    value: GitHubProjectFieldMutationValue
  ) => Promise<GitHubProjectMutationResult>
  clearProjectFieldValue: (
    cacheKey: string,
    rowId: string,
    fieldId: string
  ) => Promise<GitHubProjectMutationResult>
  patchProjectIssueOrPr: (
    cacheKey: string,
    rowId: string,
    updates: ProjectRowContentUpdate
  ) => Promise<GitHubProjectMutationResult>
  patchProjectRowIssueType: (
    cacheKey: string,
    rowId: string,
    issueType: { id: string; name: string; color: string | null; description: string | null } | null
  ) => Promise<GitHubProjectMutationResult>
  /** Optimistic, IPC-free patcher for a single `projectViewCache` row's `content`; `patchWorkItem` only walks `workItemsCache` and would leave the Project view stale until the next refresh. */
  patchProjectRowContent: (cacheKey: string, rowId: string, patch: ProjectRowContentPatch) => void
}

/** Normalizes `github.prForBranch` into a {@link PRRefreshOutcome}: preserves a runtime `upstream-error` instead of collapsing to a false "no PR"; a legacy host returning `PRInfo | null` maps to `found`/`no-pr`. */
export function normalizeRuntimePRForBranchOutcome(
  result: PRRefreshOutcome | PRInfo | null
): PRRefreshOutcome {
  if (result && typeof result === 'object' && 'kind' in result) {
    return result
  }
  return result
    ? { kind: 'found', pr: result, fetchedAt: Date.now() }
    : { kind: 'no-pr', fetchedAt: Date.now() }
}
