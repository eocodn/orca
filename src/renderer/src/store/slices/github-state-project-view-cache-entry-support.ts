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
import { countGitHubWorkItemsForRepo, isGitHubUnavailableWorkItemsError, projectViewCacheKey, projectViewRequestKey, projectViewSourceScope, settingsForProjectViewCacheKey, inflightProjectViewRequests, optimisticFieldValueFromMutation, applyRowPatch, rollbackRowIfPresent, parseSlugAndNumber, PR_REFRESH_ACTIVE_STALE_MS, PR_REFRESH_PAUSED_GRACE_MS, bypassesGitHubPRRefreshFreshness, CACHE_TTL, CHECKS_CACHE_TTL, EMPTY_CHECKS_CACHE_TTL, WORK_ITEMS_CACHE_TTL, ERROR_TOAST_DURATION, inflightPRRequests, inflightIssueRequests, inflightChecksRequests, inflightCommentsRequests, inflightWorkItemsRequests, prRequestGenerations, prRefreshStartedHostedReviewEntries, PR_REFRESH_STARTED_HOSTED_REVIEW_ENTRY_MAX, _getGitHubPRRequestGenerationCountForTest, _getGitHubPRRefreshStartedEntryCountForTest, _clearGitHubPRRefreshStartedEntriesForTest, WORK_ITEM_FETCH_CONCURRENCY, workItemFetchWaiters, releaseWorkItemSlot, workItemsCacheKey, workItemsInflightRequestKey, issueCacheKey, runtimeScopedRepoCacheKey, sourceScopedRepoCacheKey, prCacheKey, repoCacheKeyPrefixes, matchesRepoCacheKey, clearInflightWorkItemsForRepo, evictRepoCacheEntries, normalizedRepoIdentity, normalizedHeadSha, prChecksCacheSuffix, prCommentsCacheSuffix, commentTimestamp, mergePRCommentIntoList, hasUsableCommentPayload, MAX_CACHE_ENTRIES, isFresh, getPRChecksCacheTtl, findWorktreeById, buildWorktreeLookupIndex, findUniqueWorktreeById, isStaleExactLinkedPRLookup, shouldClearDivergedLinkedMergedPR, shouldApplyDivergedLinkedPRClear, shouldClearBranchMismatchedLinkedOpenPR, shouldApplyBranchMismatchedLinkedPRClear, buildPRRefreshCandidate, githubHostedReviewFallbackPRNumber, shouldClearHostedReviewForNoGitHubPR, isGitHubLinkedReviewHintKey, prLookupHintKey, linkedReviewHintKeyForNoGitHubPR, hasNewerHostedReviewCacheEntry, syncHostedReviewCacheFromGitHubPRResult, shouldWritePRCacheForHostedReviewSync, canPreserveReviewForFallbackMiss, shouldPreserveExistingPRForFallbackMiss, applyPRCacheResult, prRefreshStartedEntryKey, deletePRRefreshStartedEntry, setPRRefreshStartedHostedReviewEntry, setGitHubPRResultCaches, applyGitHubPRResultToCaches, evictStaleEntries, withBoundedCacheEntry, capRecordByInsertionOrder, capPrRefreshSequences, MAX_PR_REFRESH_STATE_ENTRIES, SETTLED_PR_REFRESH_STATUSES, ACTIVE_PR_REFRESH_STATUSES, isPRRefreshStateExpired, buildGitHubPRRefreshStateClearToken, getGitHubPRRefreshStateExpiryAt, isExpiredActivePRRefreshState, getEffectiveGitHubPRRefreshState, pruneExpiredPRRefreshStates, capPrRefreshStates, shouldRefreshIssueDecorations, debouncedSaveCache, normalizeRuntimePRForBranchOutcome } from './github-state'
import type { WorkItemsCacheSources, WorkItemsCacheError, CacheEntry, FetchOptions, RepoScopedFetchOptions, PRRefreshState, PRRefreshStateClearToken, InflightChecks, InflightWorkItems, GitHubPRFallbackSource, WorktreeLookupEntry, WorktreeLookupIndex, GitHubSlice } from './github-state'
export type ProjectViewCacheEntry<T> = {
  data: T | null
  fetchedAt: number
  error?: GitHubProjectViewError
}
export type ProjectRowContentUpdate = {
  title?: string
  body?: string
  addLabels?: string[]
  removeLabels?: string[]
  addAssignees?: string[]
  removeAssignees?: string[]
}
export type GitHubPatchWorkItemOptions = {
  sourceContext?: TaskSourceContext | null
}

/** Optimistic, IPC-free patch shape for `projectViewCache` rows; uses full `labels`/`assignees` arrays (not add/remove deltas) to match the dialog's local state and avoid set-merge at the call site. */
export type ProjectRowContentPatch = {
  title?: string
  body?: string
  /** Lowercase renderer state vocab, translated to GitHub's UPPERCASE `row.content.state` on apply; merged/draft pass through though the dialog only flips open↔closed today. */
  state?: 'open' | 'closed' | 'merged' | 'draft'
  labels?: string[]
  assignees?: string[]
}

// Why: queryOverride is part of the cache key; `undefined` = the view's stored filter, `''` = a distinct "no filter" override that gets its own entry.
export function queryOverrideKeyPart(queryOverride: string | undefined): string {
  if (queryOverride === undefined) {
    return ''
  }
  return `:q=${queryOverride}`
}
export function getRuntimeRepoTarget(
  state: AppState,
  repoPath: string,
  settings: AppState['settings'] = state.settings
): { target: { kind: 'environment'; environmentId: string }; repo: Repo } | null {
  const target = getActiveRuntimeTarget(settings)
  if (target.kind !== 'environment') {
    return null
  }
  const repo = state.repos.find((candidate) => candidate.path === repoPath)
  return repo ? { target, repo } : null
}
export function getPRRefreshOwnerRuntimeEnvironmentId(
  candidate: Pick<GitHubPRRefreshCandidate, 'cacheKey' | 'executionHostId'>
): string | null {
  const parsed = parseExecutionHostId(candidate.executionHostId)
  if (parsed?.kind === 'runtime') {
    return parsed.environmentId
  }
  const cacheScope = candidate.cacheKey.split('::', 1)[0]
  const cacheScopeHost = parseExecutionHostId(cacheScope)
  return cacheScopeHost?.kind === 'runtime' ? cacheScopeHost.environmentId : null
}
export function getPRRefreshRuntimeRepoTarget(
  state: AppState,
  candidate: GitHubPRRefreshCandidate
): { target: { kind: 'environment'; environmentId: string }; repo: Repo } | null {
  const ownerRuntimeEnvironmentId = getPRRefreshOwnerRuntimeEnvironmentId(candidate)
  if (!ownerRuntimeEnvironmentId) {
    return null
  }
  // Why: PR refreshes must follow the repo owner host, not the Active Server dropdown (a runtime-owned worktree can show while Local is focused).
  return getRuntimeRepoTarget(
    state,
    candidate.repoPath,
    state.settings
      ? { ...state.settings, activeRuntimeEnvironmentId: ownerRuntimeEnvironmentId }
      : ({ activeRuntimeEnvironmentId: ownerRuntimeEnvironmentId } as AppState['settings'])
  )
}
export function shouldEnqueueLocalPRRefresh(candidate: GitHubPRRefreshCandidate): boolean {
  // Why: the local coordinator owns local git + SSH-bridge refreshes; runtime-owned and disconnected-SSH repos must not hit the IPC crash path.
  if (getPRRefreshOwnerRuntimeEnvironmentId(candidate) !== null) {
    return false
  }
  return !candidate.connectionId || candidate.connectionState === 'connected'
}
export function enqueueLocalGitHubPRRefresh(
  args: {
    candidate: GitHubPRRefreshCandidate
    reason: GitHubPRRefreshReason
    priority: number
  },
  onNotQueued?: () => void | Promise<unknown>
): void {
  const enqueue = window.api.gh.enqueuePRRefresh
  if (!enqueue) {
    return
  }
  // Why: renderer refresh triggers are best-effort — main may reject stale paths, and this must not become an unhandled-rejection crash.
  void enqueue(args)
    .then((queued) =>
      queued === false || queued?.kind === 'fallback' ? onNotQueued?.() : undefined
    )
    .catch((err) => {
      console.warn('Failed to enqueue PR refresh:', err)
    })
}
export type GitHubWorkItemRequestContext = {
  repoId: string
  repoPath: string
  target: GitHubWorkItemRequestTarget
}
export type GitHubWorkItemRequestTarget =
  | { kind: 'environment'; environmentId: string; runtimeRepoId: string }
  | { kind: 'local' }
export type GitHubWorkItemsListArgs = {
  limit: number
  query?: string
  page?: number
  noCache?: true
}
export function settingsForGitHubRepoOwner(
  settings: AppState['settings'],
  repo: Pick<Repo, 'connectionId' | 'executionHostId'> | undefined
): AppState['settings'] {
  if (!repo) {
    return settings
  }
  const parsed = parseExecutionHostId(getRepoExecutionHostId(repo))
  if (parsed?.kind === 'runtime') {
    return settings
      ? { ...settings, activeRuntimeEnvironmentId: parsed.environmentId }
      : ({ activeRuntimeEnvironmentId: parsed.environmentId } as AppState['settings'])
  }
  // Why: local and SSH-owned GitHub lookups run on the desktop client; host focus must not redirect them to the selected runtime.
  return settings
    ? { ...settings, activeRuntimeEnvironmentId: null }
    : ({ activeRuntimeEnvironmentId: null } as AppState['settings'])
}
export function settingsForGitHubFocusedRepoOwner(
  settings: AppState['settings'],
  repo: Pick<Repo, 'connectionId' | 'executionHostId'> | undefined
): AppState['settings'] {
  if (!repo?.executionHostId && !repo?.connectionId) {
    return settings
  }
  return settingsForGitHubRepoOwner(settings, repo)
}
export function getRefreshAliasExecutionHostId(alias: GitHubPRRefreshAlias): string {
  const explicitHostId = normalizeExecutionHostId(alias.executionHostId)
  if (explicitHostId) {
    return explicitHostId
  }
  const scope = alias.cacheKey.split('::', 1)[0]
  return normalizeExecutionHostId(scope) ?? LOCAL_EXECUTION_HOST_ID
}
export function findRepoForGitHubOwner(
  state: Partial<Pick<AppState, 'repos'>>,
  repoId: string | undefined,
  repoPath: string
): Repo | undefined {
  return (state.repos ?? []).find((candidate) =>
    repoId ? candidate.id === repoId || candidate.path === repoPath : candidate.path === repoPath
  )
}
export function getGitHubFocusedRepoOwnerHostId(
  settings: AppState['settings'],
  repo: Pick<Repo, 'connectionId' | 'executionHostId'> | undefined
): string {
  if (repo?.executionHostId || repo?.connectionId) {
    return getRepoExecutionHostId(repo)
  }
  return getSettingsFocusedExecutionHostId(settings)
}
export function getWorkItemsCacheKeyForOwner(
  state: Partial<Pick<AppState, 'repos' | 'settings'>>,
  repoId: string,
  limit: number,
  query: string,
  repoPath?: string
): string {
  const repo = findRepoForGitHubOwner(state, repoId, repoPath ?? '')
  return workItemsCacheKey(
    repoId,
    limit,
    query,
    repo ? getGitHubFocusedRepoOwnerHostId(state.settings ?? null, repo) : undefined
  )
}
export function getGitHubWorkItemSourceHostId(
  state: AppState,
  repo: Pick<Repo, 'connectionId' | 'executionHostId'> | undefined,
  sourceContext?: TaskSourceContext | null
): ExecutionHostId | undefined {
  if (sourceContext?.provider === 'github') {
    return sourceContext.hostId
  }
  return repo
    ? (normalizeExecutionHostId(getGitHubFocusedRepoOwnerHostId(state.settings, repo)) ?? undefined)
    : undefined
}
export function getGitHubWorkItemSourceCacheScope(
  state: AppState,
  repo: Pick<Repo, 'connectionId' | 'executionHostId'> | undefined,
  sourceContext?: TaskSourceContext | null
): string | undefined {
  if (sourceContext?.provider === 'github') {
    return getTaskSourceCacheScope(sourceContext)
  }
  return getGitHubWorkItemSourceHostId(state, repo, sourceContext)
}
export function getGitHubWorkItemSourceSettings(
  settings: AppState['settings'],
  repo: Pick<Repo, 'connectionId' | 'executionHostId'> | undefined,
  sourceContext?: TaskSourceContext | null
): AppState['settings'] {
  if (sourceContext?.provider === 'github') {
    return {
      ...settings,
      ...getTaskSourceRuntimeSettings(sourceContext)
    } as AppState['settings']
  }
  return settingsForGitHubFocusedRepoOwner(settings, repo)
}
export function getGitHubRepoSourceSettings(
  settings: AppState['settings'],
  repo: Pick<Repo, 'connectionId' | 'executionHostId'> | undefined,
  sourceContext?: TaskSourceContext | null
): AppState['settings'] {
  if (sourceContext?.provider === 'github') {
    return {
      ...settings,
      ...getTaskSourceRuntimeSettings(sourceContext)
    } as AppState['settings']
  }
  return settingsForGitHubRepoOwner(settings, repo)
}
export function getGitHubWorkItemRequestContext(
  state: AppState,
  settings: AppState['settings'],
  repoId: string,
  repoPath: string,
  sourceContext?: TaskSourceContext | null
): GitHubWorkItemRequestContext {
  if (sourceContext?.provider === 'github') {
    const parsedHost = parseExecutionHostId(sourceContext.hostId)
    if (parsedHost?.kind === 'runtime') {
      return {
        repoId,
        repoPath,
        target: {
          kind: 'environment',
          environmentId: parsedHost.environmentId,
          runtimeRepoId: sourceContext.repoId ?? repoId
        }
      }
    }
  }
  const runtimeRepo = getRuntimeRepoTarget(state, repoPath, settings)
  return {
    repoId,
    repoPath,
    target: runtimeRepo
      ? {
          kind: 'environment',
          environmentId: runtimeRepo.target.environmentId,
          runtimeRepoId: runtimeRepo.repo.id
        }
      : { kind: 'local' }
  }
}
export function listGitHubWorkItemsForRepo(
  context: GitHubWorkItemRequestContext,
  args: GitHubWorkItemsListArgs
): Promise<ListWorkItemsResult<Omit<GitHubWorkItem, 'repoId'>>> {
  if (context.target.kind === 'environment') {
    return callRuntimeRpc<ListWorkItemsResult<Omit<GitHubWorkItem, 'repoId'>>>(
      { kind: 'environment', environmentId: context.target.environmentId },
      'github.listWorkItems',
      {
        repo: context.target.runtimeRepoId,
        ...args
      },
      { timeoutMs: 30_000 }
    )
  }
  return window.api.gh.listWorkItems({
    repoPath: context.repoPath,
    repoId: context.repoId,
    ...args
  })
}
