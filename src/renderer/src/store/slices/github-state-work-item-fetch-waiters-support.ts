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
import { queryOverrideKeyPart, getRuntimeRepoTarget, getPRRefreshOwnerRuntimeEnvironmentId, getPRRefreshRuntimeRepoTarget, shouldEnqueueLocalPRRefresh, enqueueLocalGitHubPRRefresh, settingsForGitHubRepoOwner, settingsForGitHubFocusedRepoOwner, getRefreshAliasExecutionHostId, findRepoForGitHubOwner, getGitHubFocusedRepoOwnerHostId, getWorkItemsCacheKeyForOwner, getGitHubWorkItemSourceHostId, getGitHubWorkItemSourceCacheScope, getGitHubWorkItemSourceSettings, getGitHubRepoSourceSettings, getGitHubWorkItemRequestContext, listGitHubWorkItemsForRepo, countGitHubWorkItemsForRepo, isGitHubUnavailableWorkItemsError, projectViewCacheKey, projectViewRequestKey, projectViewSourceScope, settingsForProjectViewCacheKey, inflightProjectViewRequests, optimisticFieldValueFromMutation, applyRowPatch, rollbackRowIfPresent, parseSlugAndNumber, PR_REFRESH_ACTIVE_STALE_MS, PR_REFRESH_PAUSED_GRACE_MS, bypassesGitHubPRRefreshFreshness, CACHE_TTL, CHECKS_CACHE_TTL, EMPTY_CHECKS_CACHE_TTL, WORK_ITEMS_CACHE_TTL, ERROR_TOAST_DURATION, inflightPRRequests, inflightIssueRequests, inflightChecksRequests, inflightCommentsRequests, inflightWorkItemsRequests, prRequestGenerations, prRefreshStartedHostedReviewEntries, PR_REFRESH_STARTED_HOSTED_REVIEW_ENTRY_MAX, _getGitHubPRRequestGenerationCountForTest, _getGitHubPRRefreshStartedEntryCountForTest, _clearGitHubPRRefreshStartedEntriesForTest, WORK_ITEM_FETCH_CONCURRENCY, isStaleExactLinkedPRLookup, shouldClearDivergedLinkedMergedPR, shouldApplyDivergedLinkedPRClear, shouldClearBranchMismatchedLinkedOpenPR, shouldApplyBranchMismatchedLinkedPRClear, buildPRRefreshCandidate, githubHostedReviewFallbackPRNumber, shouldClearHostedReviewForNoGitHubPR, isGitHubLinkedReviewHintKey, prLookupHintKey, linkedReviewHintKeyForNoGitHubPR, hasNewerHostedReviewCacheEntry, syncHostedReviewCacheFromGitHubPRResult, shouldWritePRCacheForHostedReviewSync, canPreserveReviewForFallbackMiss, shouldPreserveExistingPRForFallbackMiss, applyPRCacheResult, prRefreshStartedEntryKey, deletePRRefreshStartedEntry, setPRRefreshStartedHostedReviewEntry, setGitHubPRResultCaches, applyGitHubPRResultToCaches, evictStaleEntries, withBoundedCacheEntry, capRecordByInsertionOrder, capPrRefreshSequences, MAX_PR_REFRESH_STATE_ENTRIES, SETTLED_PR_REFRESH_STATUSES, ACTIVE_PR_REFRESH_STATUSES, isPRRefreshStateExpired, buildGitHubPRRefreshStateClearToken, getGitHubPRRefreshStateExpiryAt, isExpiredActivePRRefreshState, getEffectiveGitHubPRRefreshState, pruneExpiredPRRefreshStates, capPrRefreshStates, shouldRefreshIssueDecorations, debouncedSaveCache, normalizeRuntimePRForBranchOutcome } from './github-state'
import type { ProjectViewCacheEntry, ProjectRowContentUpdate, GitHubPatchWorkItemOptions, ProjectRowContentPatch, GitHubWorkItemRequestContext, GitHubWorkItemRequestTarget, GitHubWorkItemsListArgs, WorkItemsCacheSources, WorkItemsCacheError, CacheEntry, FetchOptions, RepoScopedFetchOptions, PRRefreshState, PRRefreshStateClearToken, InflightChecks, InflightWorkItems, GitHubSlice } from './github-state'
export const workItemFetchWaiters: (() => void)[] = []
let workItemFetchInFlight = 0

export async function acquireWorkItemSlot(): Promise<void> {
  if (workItemFetchInFlight < WORK_ITEM_FETCH_CONCURRENCY) {
    workItemFetchInFlight += 1
    return
  }
  await new Promise<void>((resolve) => workItemFetchWaiters.push(resolve))
  // Why: the resolver already claimed the slot on our behalf, so don't re-increment here.
}
export function releaseWorkItemSlot(): void {
  const next = workItemFetchWaiters.shift()
  if (next) {
    // Hand the slot off directly (net count unchanged) so a third caller can't race into the cap between decrement and resolve.
    next()
    return
  }
  workItemFetchInFlight -= 1
}
export function workItemsCacheKey(
  repoId: string,
  limit: number,
  query: string,
  executionHostId?: string | null
): string {
  const scope = executionHostId?.trim() ?? ''
  const hostId = normalizeExecutionHostId(scope)
  const owner = `${repoId}::${limit}::${query}`
  if (hostId) {
    return hostId !== LOCAL_EXECUTION_HOST_ID ? `${hostId}::${owner}` : owner
  }
  return scope ? `${scope}::${owner}` : owner
}
export function workItemsInflightRequestKey(
  cacheKey: string,
  target: GitHubWorkItemRequestTarget
): string {
  const targetPart =
    target.kind === 'environment' ? `env:${target.environmentId}:${target.runtimeRepoId}` : 'local'
  return `${cacheKey}::${targetPart}`
}
export function issueCacheKey(
  repoPath: string,
  repoId: string | undefined,
  issueNumber: number | string,
  settings?: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null,
  connectionId?: string | null,
  executionHostId?: string | null,
  hasRepoOwner = false
): string {
  return getGitHubRepoCacheKey(
    repoPath,
    repoId,
    String(issueNumber),
    settings,
    connectionId,
    executionHostId,
    hasRepoOwner
  )
}
export function runtimeScopedRepoCacheKey(
  repoPath: string,
  repoId: string | undefined,
  suffix: string,
  settings?: AppState['settings'],
  connectionId?: string | null,
  executionHostId?: string | null,
  hasRepoOwner = false
): string {
  return getGitHubRepoCacheKey(
    repoPath,
    repoId,
    suffix,
    settings,
    connectionId,
    executionHostId,
    hasRepoOwner
  )
}
export function sourceScopedRepoCacheKey(
  repoPath: string,
  repoId: string | undefined,
  suffix: string,
  settings?: AppState['settings'],
  connectionId?: string | null,
  executionHostId?: string | null,
  sourceContext?: TaskSourceContext | null,
  hasRepoOwner = false
): string {
  if (sourceContext?.provider === 'github') {
    return `${getTaskSourceCacheScope(sourceContext)}::${repoId ?? repoPath}::${suffix}`
  }
  return runtimeScopedRepoCacheKey(
    repoPath,
    repoId,
    suffix,
    settings,
    connectionId,
    executionHostId,
    hasRepoOwner
  )
}
export function prCacheKey(
  repoPath: string,
  repoId: string | undefined,
  branch: string,
  settings?: AppState['settings'],
  connectionId?: string | null,
  executionHostId?: string | null,
  hasRepoOwner = false
): string {
  return getGitHubPRCacheKey(
    repoPath,
    repoId,
    branch,
    settings,
    connectionId,
    executionHostId,
    hasRepoOwner
  )
}
export function repoCacheKeyPrefixes(repoId: string, repoPath?: string): string[] {
  const prefixes = [`${repoId}::`]
  if (repoPath && repoPath !== repoId) {
    prefixes.push(`${repoPath}::`)
  }
  return prefixes
}
export function matchesRepoCacheKey(key: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => key.startsWith(prefix))
}
export function clearInflightWorkItemsForRepo(repoId: string, repoPath?: string): void {
  const prefixes = repoCacheKeyPrefixes(repoId, repoPath)
  for (const key of Array.from(inflightWorkItemsRequests.keys())) {
    if (matchesRepoCacheKey(key, prefixes)) {
      inflightWorkItemsRequests.delete(key)
    }
  }
}
export function evictRepoCacheEntries<T>(
  cache: Record<string, CacheEntry<T>>,
  prefixes: readonly string[]
): { cache: Record<string, CacheEntry<T>>; evicted: boolean } {
  let next: Record<string, CacheEntry<T>> | null = null
  for (const key of Object.keys(cache)) {
    if (!matchesRepoCacheKey(key, prefixes)) {
      continue
    }
    if (!next) {
      next = { ...cache }
    }
    delete next[key]
  }
  return next ? { cache: next, evicted: true } : { cache, evicted: false }
}
export function normalizedRepoIdentity(repo: GitHubOwnerRepo): string {
  return githubRepoIdentityKey(repo)
}
export function normalizedHeadSha(headSha?: string): string | null {
  const trimmed = headSha?.trim()
  return trimmed ? trimmed.toLowerCase() : null
}
export function prChecksCacheSuffix(
  prNumber: number,
  prRepo?: GitHubOwnerRepo | null,
  headSha?: string
): string {
  const headSuffix = normalizedHeadSha(headSha)
  const base = prRepo
    ? `pr-checks::${normalizedRepoIdentity(prRepo)}::${prNumber}`
    : `pr-checks::${prNumber}`
  return headSuffix ? `${base}::head::${headSuffix}` : base
}
export function prCommentsCacheSuffix(prNumber: number, prRepo?: GitHubOwnerRepo | null): string {
  if (!prRepo) {
    return `pr-comments::${prNumber}`
  }
  return `pr-comments::${normalizedRepoIdentity(prRepo)}::${prNumber}`
}
export function commentTimestamp(comment: PRComment): number {
  const timestamp = new Date(comment.createdAt).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}
export function mergePRCommentIntoList(
  comments: readonly PRComment[] | null | undefined,
  incoming: PRComment
): PRComment[] {
  const byId = new Map<number, PRComment>()
  for (const comment of comments ?? []) {
    byId.set(comment.id, comment)
  }
  const previous = byId.get(incoming.id)
  byId.set(incoming.id, {
    ...previous,
    ...incoming,
    threadId: incoming.threadId ?? previous?.threadId,
    path: incoming.path ?? previous?.path,
    line: incoming.line ?? previous?.line,
    startLine: incoming.startLine ?? previous?.startLine,
    isResolved: incoming.isResolved ?? previous?.isResolved,
    isOutdated: incoming.isOutdated ?? previous?.isOutdated
  })
  return Array.from(byId.values()).sort((a, b) => commentTimestamp(a) - commentTimestamp(b))
}
export function hasUsableCommentPayload(result: GitHubCommentResult): result is {
  ok: true
  comment: PRComment
} {
  return (
    result.ok &&
    typeof result.comment?.id === 'number' &&
    Number.isSafeInteger(result.comment.id) &&
    result.comment.id > 0 &&
    typeof result.comment.body === 'string' &&
    typeof result.comment.createdAt === 'string'
  )
}

// Why: bound cache growth across many repos/branches over a long session; 500 is above realistic use.
export const MAX_CACHE_ENTRIES = 500
export type GitHubPRFallbackSource = NonNullable<GitHubPRRefreshAlias['fallbackPRSource']>
export function isFresh<T>(entry: CacheEntry<T> | undefined, ttl = CACHE_TTL): entry is CacheEntry<T> {
  return entry !== undefined && Date.now() - entry.fetchedAt < ttl
}
export function getPRChecksCacheTtl(entry: CacheEntry<PRCheckDetail[]> | undefined): number {
  return entry?.data?.length === 0 ? EMPTY_CHECKS_CACHE_TTL : CHECKS_CACHE_TTL
}
export function findWorktreeById(state: AppState, worktreeId: string): Worktree | null {
  for (const worktrees of Object.values(state.worktreesByRepo)) {
    const worktree = worktrees.find((w) => w.id === worktreeId)
    if (worktree) {
      return worktree
    }
  }
  return null
}
export type WorktreeLookupEntry = {
  first: Worktree
  unique: Worktree | null
}
export type WorktreeLookupIndex = {
  byId: Map<string, WorktreeLookupEntry>
  repoHostIdsByRepoId: Map<string, Set<string>>
}
export function buildWorktreeLookupIndex(state: AppState): WorktreeLookupIndex {
  const byId = new Map<string, WorktreeLookupEntry>()
  for (const worktrees of Object.values(state.worktreesByRepo)) {
    for (const worktree of worktrees) {
      const worktreeId = worktree.id
      const existing = byId.get(worktreeId)
      if (existing) {
        existing.unique = null
      } else {
        byId.set(worktreeId, { first: worktree, unique: worktree })
      }
    }
  }

  const repoHostIdsByRepoId = new Map<string, Set<string>>()
  for (const repo of state.repos ?? []) {
    let hostIds = repoHostIdsByRepoId.get(repo.id)
    if (!hostIds) {
      hostIds = new Set<string>()
      repoHostIdsByRepoId.set(repo.id, hostIds)
    }
    hostIds.add(getRepoExecutionHostId(repo))
  }
  return { byId, repoHostIdsByRepoId }
}
export function findUniqueWorktreeById(
  state: AppState,
  worktreeId: string,
  executionHostId?: string,
  lookupIndex = buildWorktreeLookupIndex(state)
): Worktree | null {
  const match = lookupIndex.byId.get(worktreeId)?.unique ?? null
  // Why: metadata persistence is keyed only by worktree id; an id owned by two hosts is non-unique so destructive clears fail closed.
  if (!match || executionHostId === undefined) {
    return match
  }
  const expectedHostId = normalizeExecutionHostId(executionHostId) ?? LOCAL_EXECUTION_HOST_ID
  const explicitWorktreeHostId = normalizeExecutionHostId(match.hostId)
  if (explicitWorktreeHostId) {
    return explicitWorktreeHostId === expectedHostId ? match : null
  }
  const repoHostIds = lookupIndex.repoHostIdsByRepoId.get(match.repoId)
  // Pre-host persisted rows are safe only when their repo has one unambiguous owner.
  if (!repoHostIds || repoHostIds.size !== 1 || !repoHostIds.has(expectedHostId)) {
    return null
  }
  return match
}
