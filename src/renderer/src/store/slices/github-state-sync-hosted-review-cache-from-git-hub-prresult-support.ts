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
import { queryOverrideKeyPart, getRuntimeRepoTarget, getPRRefreshOwnerRuntimeEnvironmentId, getPRRefreshRuntimeRepoTarget, shouldEnqueueLocalPRRefresh, enqueueLocalGitHubPRRefresh, settingsForGitHubRepoOwner, settingsForGitHubFocusedRepoOwner, getRefreshAliasExecutionHostId, findRepoForGitHubOwner, getGitHubFocusedRepoOwnerHostId, getWorkItemsCacheKeyForOwner, getGitHubWorkItemSourceHostId, getGitHubWorkItemSourceCacheScope, getGitHubWorkItemSourceSettings, getGitHubRepoSourceSettings, getGitHubWorkItemRequestContext, listGitHubWorkItemsForRepo, countGitHubWorkItemsForRepo, isGitHubUnavailableWorkItemsError, projectViewCacheKey, projectViewRequestKey, projectViewSourceScope, settingsForProjectViewCacheKey, inflightProjectViewRequests, optimisticFieldValueFromMutation, applyRowPatch, rollbackRowIfPresent, parseSlugAndNumber, PR_REFRESH_ACTIVE_STALE_MS, PR_REFRESH_PAUSED_GRACE_MS, bypassesGitHubPRRefreshFreshness, CACHE_TTL, CHECKS_CACHE_TTL, EMPTY_CHECKS_CACHE_TTL, WORK_ITEMS_CACHE_TTL, ERROR_TOAST_DURATION, inflightPRRequests, inflightIssueRequests, inflightChecksRequests, inflightCommentsRequests, inflightWorkItemsRequests, prRequestGenerations, prRefreshStartedHostedReviewEntries, PR_REFRESH_STARTED_HOSTED_REVIEW_ENTRY_MAX, _getGitHubPRRequestGenerationCountForTest, _getGitHubPRRefreshStartedEntryCountForTest, _clearGitHubPRRefreshStartedEntriesForTest, WORK_ITEM_FETCH_CONCURRENCY, workItemFetchWaiters, releaseWorkItemSlot, workItemsCacheKey, workItemsInflightRequestKey, issueCacheKey, runtimeScopedRepoCacheKey, sourceScopedRepoCacheKey, prCacheKey, repoCacheKeyPrefixes, matchesRepoCacheKey, clearInflightWorkItemsForRepo, evictRepoCacheEntries, normalizedRepoIdentity, normalizedHeadSha, prChecksCacheSuffix, prCommentsCacheSuffix, commentTimestamp, mergePRCommentIntoList, hasUsableCommentPayload, MAX_CACHE_ENTRIES, isFresh, getPRChecksCacheTtl, findWorktreeById, buildWorktreeLookupIndex, findUniqueWorktreeById, isStaleExactLinkedPRLookup, shouldClearDivergedLinkedMergedPR, shouldApplyDivergedLinkedPRClear, shouldClearBranchMismatchedLinkedOpenPR, shouldApplyBranchMismatchedLinkedPRClear, buildPRRefreshCandidate, githubHostedReviewFallbackPRNumber, shouldClearHostedReviewForNoGitHubPR, isGitHubLinkedReviewHintKey, prLookupHintKey, linkedReviewHintKeyForNoGitHubPR, hasNewerHostedReviewCacheEntry, applyGitHubPRResultToCaches, evictStaleEntries, withBoundedCacheEntry, capRecordByInsertionOrder, capPrRefreshSequences, MAX_PR_REFRESH_STATE_ENTRIES, SETTLED_PR_REFRESH_STATUSES, ACTIVE_PR_REFRESH_STATUSES, isPRRefreshStateExpired, buildGitHubPRRefreshStateClearToken, getGitHubPRRefreshStateExpiryAt, isExpiredActivePRRefreshState, getEffectiveGitHubPRRefreshState, pruneExpiredPRRefreshStates, capPrRefreshStates, shouldRefreshIssueDecorations, debouncedSaveCache, normalizeRuntimePRForBranchOutcome } from './github-state'
import type { ProjectViewCacheEntry, ProjectRowContentUpdate, GitHubPatchWorkItemOptions, ProjectRowContentPatch, GitHubWorkItemRequestContext, GitHubWorkItemRequestTarget, GitHubWorkItemsListArgs, WorkItemsCacheSources, WorkItemsCacheError, CacheEntry, FetchOptions, RepoScopedFetchOptions, PRRefreshState, PRRefreshStateClearToken, InflightChecks, InflightWorkItems, GitHubPRFallbackSource, WorktreeLookupEntry, WorktreeLookupIndex, GitHubSlice } from './github-state'
export function syncHostedReviewCacheFromGitHubPRResult(args: {
  cache: AppState['hostedReviewCache']
  repoPath: string
  branch: string
  settings: AppState['settings']
  repoId?: string
  connectionId?: string | null
  executionHostId?: string | null
  hasRepoOwner?: boolean
  pr: PRInfo | null
  fetchedAt: number
  linkedPRNumber?: number | null
  fallbackPRNumber?: number | null
  fallbackPRSource?: GitHubPRFallbackSource | null
  preserveExistingPRForFallbackMiss?: boolean
  requestStartedAt?: number
  requestStartedEntry?: AppState['hostedReviewCache'][string]
}): { cache: AppState['hostedReviewCache']; accepted: boolean } {
  const hostedReviewCacheKey = getHostedReviewCacheKey(
    args.repoPath,
    args.branch,
    args.settings,
    args.repoId,
    args.connectionId,
    args.executionHostId,
    args.hasRepoOwner === true
  )
  if (
    args.requestStartedAt !== undefined &&
    hasNewerHostedReviewCacheEntry(
      args.cache,
      hostedReviewCacheKey,
      args.requestStartedAt,
      args.requestStartedEntry
    )
  ) {
    return { cache: args.cache, accepted: false }
  }
  const hostedReviewEntry = args.cache[hostedReviewCacheKey]
  if (
    args.requestStartedAt === undefined &&
    hostedReviewEntry !== undefined &&
    hostedReviewEntry.fetchedAt >= args.fetchedAt
  ) {
    return { cache: args.cache, accepted: false }
  }
  if (args.pr && hostedReviewEntry?.data && hostedReviewEntry.data.provider !== 'github') {
    return { cache: args.cache, accepted: false }
  }
  // Why: a hosted-review row survives an authoritative miss only when the paired PR cache preserves a terminal, head-current PR.
  if (
    !args.pr &&
    args.linkedPRNumber == null &&
    args.fallbackPRNumber != null &&
    args.fallbackPRSource !== 'hosted-review' &&
    hostedReviewEntry?.data?.provider === 'github' &&
    hostedReviewEntry.data.number === args.fallbackPRNumber &&
    args.preserveExistingPRForFallbackMiss === true &&
    canPreserveReviewForFallbackMiss(hostedReviewEntry.data.state)
  ) {
    return { cache: args.cache, accepted: false }
  }
  if (!args.pr && !shouldClearHostedReviewForNoGitHubPR(hostedReviewEntry)) {
    return { cache: args.cache, accepted: hostedReviewEntry?.data == null }
  }
  // Why: hosted-review fallbacks may be stale exact links; inherit branch provenance only when already proven.
  const branchLookupGitHubPRNumber =
    args.pr &&
    args.linkedPRNumber == null &&
    (args.fallbackPRSource !== 'hosted-review' ||
      args.pr.number !== args.fallbackPRNumber ||
      hostedReviewEntry?.branchLookupGitHubPRNumber === args.pr.number)
      ? args.pr.number
      : undefined
  return {
    cache: {
      ...args.cache,
      [hostedReviewCacheKey]: {
        data: args.pr ? hostedReviewInfoFromGitHubPRInfo(args.pr) : null,
        fetchedAt: args.fetchedAt,
        linkedReviewHintKey: args.pr
          ? linkedReviewHintKey({ linkedGitHubPR: args.pr.number })
          : linkedReviewHintKeyForNoGitHubPR(hostedReviewEntry),
        ...(branchLookupGitHubPRNumber !== undefined ? { branchLookupGitHubPRNumber } : {})
      }
    },
    accepted: true
  }
}
export function shouldWritePRCacheForHostedReviewSync(args: {
  hostedReviewSyncAccepted: boolean
  hostedReviewEntry: AppState['hostedReviewCache'][string] | undefined
  pr: PRInfo | null
  linkedPRNumber?: number | null
  fallbackPRNumber?: number | null
}): boolean {
  // Why: grouping reads prCache while cards read hostedReviewCache; keep them from drifting when a result is rejected for the card.
  if (args.hostedReviewSyncAccepted) {
    return true
  }
  const exactPRNumber = args.linkedPRNumber ?? args.fallbackPRNumber ?? null
  return (
    exactPRNumber !== null &&
    args.pr?.number === exactPRNumber &&
    args.hostedReviewEntry?.data?.provider === 'github' &&
    args.hostedReviewEntry.data.number === exactPRNumber
  )
}
export function canPreserveReviewForFallbackMiss(state: PRInfo['state'] | undefined): boolean {
  return state === 'closed' || state === 'merged'
}
export function shouldPreserveExistingPRForFallbackMiss(args: {
  currentPR: PRInfo | null | undefined
  nextPR: PRInfo | null
  state: AppState
  worktreeId?: string
  linkedPRNumber?: number | null
  fallbackPRNumber?: number | null
  fallbackPRSource?: GitHubPRFallbackSource | null
}): boolean {
  if (
    args.nextPR !== null ||
    args.linkedPRNumber != null ||
    args.currentPR?.state !== 'merged' ||
    typeof args.currentPR.headSha !== 'string' ||
    args.currentPR.headSha.length === 0
  ) {
    return false
  }
  // Why: gate the global worktree scan so batched refresh aliases don't multiply full scans (common paths don't need it).
  const worktree = args.worktreeId ? findWorktreeById(args.state, args.worktreeId) : null
  const worktreeHead = worktree?.head
  // Why: keep a merged PR only when its cached head matches the worktree head — exactly or a confirmed-contained commit.
  const preservesMergedPRForCurrentHead =
    typeof worktreeHead === 'string' &&
    worktreeHead.length > 0 &&
    (args.currentPR.headSha === worktreeHead ||
      args.currentPR.confirmedContainedHeadOid === worktreeHead)

  return preservesMergedPRForCurrentHead
}
export function applyPRCacheResult(
  cache: AppState['prCache'],
  cacheKey: string,
  pr: PRInfo | null,
  fetchedAt: number,
  accepted: boolean,
  preserveExisting: boolean
): AppState['prCache'] {
  if (preserveExisting) {
    return cache
  }
  if (accepted) {
    return withBoundedCacheEntry(cache, cacheKey, { data: pr, fetchedAt })
  }
  if (!cache[cacheKey]) {
    return cache
  }
  const next = { ...cache }
  delete next[cacheKey]
  return next
}
export function prRefreshStartedEntryKey(sequence: number, cacheKey: string): string {
  return `${sequence}::${cacheKey}`
}
export function deletePRRefreshStartedEntry(sequence: number | undefined, cacheKey: string): void {
  if (sequence !== undefined && sequence > 0) {
    prRefreshStartedHostedReviewEntries.delete(prRefreshStartedEntryKey(sequence, cacheKey))
  }
}
export function setPRRefreshStartedHostedReviewEntry(
  key: string,
  entry: AppState['hostedReviewCache'][string] | undefined
): void {
  if (entry === undefined) {
    prRefreshStartedHostedReviewEntries.delete(key)
    return
  }
  prRefreshStartedHostedReviewEntries.delete(key)
  prRefreshStartedHostedReviewEntries.set(key, entry)
  while (prRefreshStartedHostedReviewEntries.size > PR_REFRESH_STARTED_HOSTED_REVIEW_ENTRY_MAX) {
    const oldest = prRefreshStartedHostedReviewEntries.keys().next()
    if (oldest.done) {
      return
    }
    prRefreshStartedHostedReviewEntries.delete(oldest.value)
  }
}
export function setGitHubPRResultCaches(
  state: AppState,
  args: {
    prCacheKey: string
    repoPath: string
    branch: string
    settings: AppState['settings']
    repoId?: string
    connectionId?: string | null
    executionHostId?: string | null
    hasRepoOwner?: boolean
    pr: PRInfo | null
    fetchedAt: number
    worktreeId?: string
    linkedPRNumber?: number | null
    fallbackPRNumber?: number | null
    fallbackPRSource?: GitHubPRFallbackSource | null
    requestStartedAt?: number
    requestStartedEntry?: AppState['hostedReviewCache'][string]
  }
): Partial<AppState> {
  const preserveExistingPRForFallbackMiss = shouldPreserveExistingPRForFallbackMiss({
    currentPR: state.prCache[args.prCacheKey]?.data,
    nextPR: args.pr,
    state,
    worktreeId: args.worktreeId,
    linkedPRNumber: args.linkedPRNumber,
    fallbackPRNumber: args.fallbackPRNumber,
    fallbackPRSource: args.fallbackPRSource
  })
  const hostedReviewSync = syncHostedReviewCacheFromGitHubPRResult({
    cache: state.hostedReviewCache,
    repoPath: args.repoPath,
    branch: args.branch,
    settings: args.settings,
    repoId: args.repoId,
    connectionId: args.connectionId,
    executionHostId: args.executionHostId,
    hasRepoOwner: args.hasRepoOwner,
    pr: args.pr,
    fetchedAt: args.fetchedAt,
    linkedPRNumber: args.linkedPRNumber,
    fallbackPRNumber: args.fallbackPRNumber,
    fallbackPRSource: args.fallbackPRSource,
    preserveExistingPRForFallbackMiss,
    requestStartedAt: args.requestStartedAt,
    requestStartedEntry: args.requestStartedEntry
  })
  const hostedReviewCacheKey = getHostedReviewCacheKey(
    args.repoPath,
    args.branch,
    args.settings,
    args.repoId,
    args.connectionId,
    args.executionHostId,
    args.hasRepoOwner === true
  )
  const nextPRCache = applyPRCacheResult(
    state.prCache,
    args.prCacheKey,
    args.pr,
    args.fetchedAt,
    shouldWritePRCacheForHostedReviewSync({
      hostedReviewSyncAccepted: hostedReviewSync.accepted,
      hostedReviewEntry: state.hostedReviewCache[hostedReviewCacheKey],
      pr: args.pr,
      linkedPRNumber: args.linkedPRNumber,
      fallbackPRNumber: args.fallbackPRNumber
    }),
    preserveExistingPRForFallbackMiss
  )
  return {
    ...(nextPRCache === state.prCache ? {} : { prCache: nextPRCache }),
    ...(hostedReviewSync.cache === state.hostedReviewCache
      ? {}
      : { hostedReviewCache: hostedReviewSync.cache })
  }
}
