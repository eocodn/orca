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
import { queryOverrideKeyPart, getRuntimeRepoTarget, getPRRefreshOwnerRuntimeEnvironmentId, getPRRefreshRuntimeRepoTarget, shouldEnqueueLocalPRRefresh, enqueueLocalGitHubPRRefresh, settingsForGitHubRepoOwner, settingsForGitHubFocusedRepoOwner, getRefreshAliasExecutionHostId, findRepoForGitHubOwner, getGitHubFocusedRepoOwnerHostId, getWorkItemsCacheKeyForOwner, getGitHubWorkItemSourceHostId, getGitHubWorkItemSourceCacheScope, getGitHubWorkItemSourceSettings, getGitHubRepoSourceSettings, getGitHubWorkItemRequestContext, listGitHubWorkItemsForRepo, countGitHubWorkItemsForRepo, isGitHubUnavailableWorkItemsError, projectViewCacheKey, projectViewRequestKey, projectViewSourceScope, settingsForProjectViewCacheKey, inflightProjectViewRequests, optimisticFieldValueFromMutation, applyRowPatch, rollbackRowIfPresent, parseSlugAndNumber, PR_REFRESH_ACTIVE_STALE_MS, PR_REFRESH_PAUSED_GRACE_MS, bypassesGitHubPRRefreshFreshness, CACHE_TTL, CHECKS_CACHE_TTL, EMPTY_CHECKS_CACHE_TTL, WORK_ITEMS_CACHE_TTL, ERROR_TOAST_DURATION, inflightPRRequests, inflightIssueRequests, inflightChecksRequests, inflightCommentsRequests, inflightWorkItemsRequests, prRequestGenerations, prRefreshStartedHostedReviewEntries, PR_REFRESH_STARTED_HOSTED_REVIEW_ENTRY_MAX, _getGitHubPRRequestGenerationCountForTest, _getGitHubPRRefreshStartedEntryCountForTest, _clearGitHubPRRefreshStartedEntriesForTest, WORK_ITEM_FETCH_CONCURRENCY, workItemFetchWaiters, releaseWorkItemSlot, workItemsCacheKey, workItemsInflightRequestKey, issueCacheKey, runtimeScopedRepoCacheKey, sourceScopedRepoCacheKey, prCacheKey, repoCacheKeyPrefixes, matchesRepoCacheKey, clearInflightWorkItemsForRepo, evictRepoCacheEntries, normalizedRepoIdentity, normalizedHeadSha, prChecksCacheSuffix, prCommentsCacheSuffix, commentTimestamp, mergePRCommentIntoList, hasUsableCommentPayload, MAX_CACHE_ENTRIES, isFresh, getPRChecksCacheTtl, findWorktreeById, buildWorktreeLookupIndex, findUniqueWorktreeById, isStaleExactLinkedPRLookup, shouldClearDivergedLinkedMergedPR, shouldApplyDivergedLinkedPRClear, shouldClearBranchMismatchedLinkedOpenPR, shouldApplyBranchMismatchedLinkedPRClear, buildPRRefreshCandidate, githubHostedReviewFallbackPRNumber, shouldClearHostedReviewForNoGitHubPR, isGitHubLinkedReviewHintKey, prLookupHintKey, linkedReviewHintKeyForNoGitHubPR, hasNewerHostedReviewCacheEntry, syncHostedReviewCacheFromGitHubPRResult, shouldWritePRCacheForHostedReviewSync, canPreserveReviewForFallbackMiss, shouldPreserveExistingPRForFallbackMiss, applyPRCacheResult, prRefreshStartedEntryKey, deletePRRefreshStartedEntry, setPRRefreshStartedHostedReviewEntry, setGitHubPRResultCaches, normalizeRuntimePRForBranchOutcome } from './github-state'
import type { ProjectViewCacheEntry, ProjectRowContentUpdate, GitHubPatchWorkItemOptions, ProjectRowContentPatch, GitHubWorkItemRequestContext, GitHubWorkItemRequestTarget, GitHubWorkItemsListArgs, WorkItemsCacheSources, WorkItemsCacheError, CacheEntry, FetchOptions, RepoScopedFetchOptions, PRRefreshState, PRRefreshStateClearToken, InflightChecks, InflightWorkItems, GitHubPRFallbackSource, WorktreeLookupEntry, WorktreeLookupIndex, GitHubSlice } from './github-state'
export function applyGitHubPRResultToCaches(args: {
  prCache: AppState['prCache']
  hostedReviewCache: AppState['hostedReviewCache']
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
  state: AppState
  worktreeId?: string
  linkedPRNumber?: number | null
  fallbackPRNumber?: number | null
  fallbackPRSource?: GitHubPRFallbackSource | null
  requestStartedAt?: number
  requestStartedEntry?: AppState['hostedReviewCache'][string]
}): {
  prCache: AppState['prCache']
  hostedReviewCache: AppState['hostedReviewCache']
} {
  const preserveExistingPRForFallbackMiss = shouldPreserveExistingPRForFallbackMiss({
    currentPR: args.prCache[args.prCacheKey]?.data,
    nextPR: args.pr,
    state: args.state,
    worktreeId: args.worktreeId,
    linkedPRNumber: args.linkedPRNumber,
    fallbackPRNumber: args.fallbackPRNumber,
    fallbackPRSource: args.fallbackPRSource
  })
  const hostedReviewSync = syncHostedReviewCacheFromGitHubPRResult({
    cache: args.hostedReviewCache,
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
  return {
    prCache: applyPRCacheResult(
      args.prCache,
      args.prCacheKey,
      args.pr,
      args.fetchedAt,
      shouldWritePRCacheForHostedReviewSync({
        hostedReviewSyncAccepted: hostedReviewSync.accepted,
        hostedReviewEntry: args.hostedReviewCache[hostedReviewCacheKey],
        pr: args.pr,
        linkedPRNumber: args.linkedPRNumber,
        fallbackPRNumber: args.fallbackPRNumber
      }),
      preserveExistingPRForFallbackMiss
    ),
    hostedReviewCache: hostedReviewSync.cache
  }
}

/** Evicts the oldest entries when over max size; returns a pruned copy, or the original reference if nothing was evicted. */
export function evictStaleEntries<T extends { fetchedAt: number }>(
  cache: Record<string, T>,
  maxEntries = MAX_CACHE_ENTRIES
): Record<string, T> {
  const keys = Object.keys(cache)
  if (keys.length <= maxEntries) {
    return cache
  }
  const sorted = keys
    .map((k) => ({ key: k, fetchedAt: cache[k].fetchedAt }))
    .sort((a, b) => b.fetchedAt - a.fetchedAt)
  const keep = new Set(sorted.slice(0, maxEntries).map((e) => e.key))
  const pruned: Record<string, T> = {}
  for (const k of keep) {
    pruned[k] = cache[k]
  }
  return pruned
}
export function withBoundedCacheEntry<T extends { fetchedAt: number }>(
  cache: Record<string, T>,
  key: string,
  entry: T
): Record<string, T> {
  return evictStaleEntries({ ...cache, [key]: entry })
}

// Why: prRefresh* maps have no `fetchedAt` to sort by, so bound them by insertion order (oldest-touched evicted first; an evicted long-idle branch restarts clean).
export function capRecordByInsertionOrder<T>(
  record: Record<string, T>,
  maxEntries = MAX_CACHE_ENTRIES
): Record<string, T> {
  const keys = Object.keys(record)
  if (keys.length <= maxEntries) {
    return record
  }
  const capped: Record<string, T> = {}
  for (const key of keys.slice(keys.length - maxEntries)) {
    capped[key] = record[key]
  }
  return capped
}
export function capPrRefreshSequences(
  sequences: Record<string, number>,
  maxEntries = MAX_CACHE_ENTRIES
): Record<string, number> {
  return capRecordByInsertionOrder(sequences, maxEntries)
}

// Why: backs visible status pills, so evict *settled* (error/skipped) before active entries and never drop an in-progress indicator; evicted entries self-heal on next refresh.
export const MAX_PR_REFRESH_STATE_ENTRIES = 2000
export const SETTLED_PR_REFRESH_STATUSES = new Set<PRRefreshState['status']>(['error', 'skipped'])
export const ACTIVE_PR_REFRESH_STATUSES = new Set<PRRefreshState['status']>([
  'queued',
  'in-flight',
  'paused'
])
export function isPRRefreshStateExpired(state: PRRefreshState, now: number): boolean {
  const expiryAt = getGitHubPRRefreshStateExpiryAt(state)
  return expiryAt !== null && now > expiryAt
}

/** Captures the exact refresh snapshot a later timeout or request is allowed to clear. */
export function buildGitHubPRRefreshStateClearToken(
  state: PRRefreshState | undefined,
  sequences: Record<string, number>,
  cacheKey: string
): PRRefreshStateClearToken | null {
  if (!state) {
    return null
  }
  return {
    sequence: sequences[cacheKey] ?? 0,
    status: state.status,
    updatedAt: state.updatedAt
  }
}

/** Returns the wall-clock expiry for transient refresh states; settled states persist. */
export function getGitHubPRRefreshStateExpiryAt(state: PRRefreshState | undefined): number | null {
  if (!state) {
    return null
  }
  if (state.status === 'queued' || state.status === 'in-flight') {
    return Number.isFinite(state.updatedAt) ? state.updatedAt + PR_REFRESH_ACTIVE_STALE_MS : 0
  }
  if (state.status === 'paused') {
    return Number.isFinite(state.pausedUntil)
      ? (state.pausedUntil ?? 0) + PR_REFRESH_PAUSED_GRACE_MS
      : 0
  }
  return null
}
export function isExpiredActivePRRefreshState(state: PRRefreshState, now: number): boolean {
  return ACTIVE_PR_REFRESH_STATUSES.has(state.status) && isPRRefreshStateExpired(state, now)
}

/** Reads refresh state for UI selectors while hiding stale active entries from view. */
export function getEffectiveGitHubPRRefreshState(
  states: Record<string, PRRefreshState>,
  cacheKey: string,
  now = Date.now()
): PRRefreshState | undefined {
  const state = states[cacheKey]
  if (!state || isExpiredActivePRRefreshState(state, now)) {
    return undefined
  }
  return state
}
export function pruneExpiredPRRefreshStates(
  states: Record<string, PRRefreshState>,
  now = Date.now()
): Record<string, PRRefreshState> {
  let next: Record<string, PRRefreshState> | null = null
  for (const [cacheKey, state] of Object.entries(states)) {
    if (!isExpiredActivePRRefreshState(state, now)) {
      continue
    }
    if (!next) {
      next = { ...states }
    }
    delete next[cacheKey]
  }
  return next ?? states
}
export function capPrRefreshStates(
  states: Record<string, PRRefreshState>,
  maxEntries = MAX_PR_REFRESH_STATE_ENTRIES
): Record<string, PRRefreshState> {
  const keys = Object.keys(states)
  let toEvict = keys.length - maxEntries
  if (toEvict <= 0) {
    return states
  }
  const evicted = new Set<string>()
  // First pass: evict oldest settled (error/skipped) entries.
  for (const key of keys) {
    if (toEvict === 0) {
      break
    }
    if (SETTLED_PR_REFRESH_STATUSES.has(states[key].status)) {
      evicted.add(key)
      toEvict--
    }
  }
  // Last resort: evict oldest remaining keys to enforce the hard bound.
  for (const key of keys) {
    if (toEvict === 0) {
      break
    }
    if (!evicted.has(key)) {
      evicted.add(key)
      toEvict--
    }
  }
  const capped: Record<string, PRRefreshState> = {}
  for (const key of keys) {
    if (!evicted.has(key)) {
      capped[key] = states[key]
    }
  }
  return capped
}
export function shouldRefreshIssueDecorations(state: AppState): boolean {
  return (state.worktreeCardProperties ?? []).includes('issue')
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
export function debouncedSaveCache(state: AppState): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
  }
  saveTimer = setTimeout(() => {
    saveTimer = null
    window.api.cache.setGitHub({
      cache: {
        pr: state.prCache,
        issue: state.issueCache
      }
    })
  }, 1000) // Save at most once per second
}
