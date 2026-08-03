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
import { queryOverrideKeyPart, getRuntimeRepoTarget, getPRRefreshOwnerRuntimeEnvironmentId, getPRRefreshRuntimeRepoTarget, shouldEnqueueLocalPRRefresh, enqueueLocalGitHubPRRefresh, settingsForGitHubRepoOwner, settingsForGitHubFocusedRepoOwner, getRefreshAliasExecutionHostId, findRepoForGitHubOwner, getGitHubFocusedRepoOwnerHostId, getWorkItemsCacheKeyForOwner, getGitHubWorkItemSourceHostId, getGitHubWorkItemSourceCacheScope, getGitHubWorkItemSourceSettings, getGitHubRepoSourceSettings, getGitHubWorkItemRequestContext, listGitHubWorkItemsForRepo, workItemFetchWaiters, releaseWorkItemSlot, workItemsCacheKey, workItemsInflightRequestKey, issueCacheKey, runtimeScopedRepoCacheKey, sourceScopedRepoCacheKey, prCacheKey, repoCacheKeyPrefixes, matchesRepoCacheKey, clearInflightWorkItemsForRepo, evictRepoCacheEntries, normalizedRepoIdentity, normalizedHeadSha, prChecksCacheSuffix, prCommentsCacheSuffix, commentTimestamp, mergePRCommentIntoList, hasUsableCommentPayload, MAX_CACHE_ENTRIES, isFresh, getPRChecksCacheTtl, findWorktreeById, buildWorktreeLookupIndex, findUniqueWorktreeById, isStaleExactLinkedPRLookup, shouldClearDivergedLinkedMergedPR, shouldApplyDivergedLinkedPRClear, shouldClearBranchMismatchedLinkedOpenPR, shouldApplyBranchMismatchedLinkedPRClear, buildPRRefreshCandidate, githubHostedReviewFallbackPRNumber, shouldClearHostedReviewForNoGitHubPR, isGitHubLinkedReviewHintKey, prLookupHintKey, linkedReviewHintKeyForNoGitHubPR, hasNewerHostedReviewCacheEntry, syncHostedReviewCacheFromGitHubPRResult, shouldWritePRCacheForHostedReviewSync, canPreserveReviewForFallbackMiss, shouldPreserveExistingPRForFallbackMiss, applyPRCacheResult, prRefreshStartedEntryKey, deletePRRefreshStartedEntry, setPRRefreshStartedHostedReviewEntry, setGitHubPRResultCaches, applyGitHubPRResultToCaches, evictStaleEntries, withBoundedCacheEntry, capRecordByInsertionOrder, capPrRefreshSequences, MAX_PR_REFRESH_STATE_ENTRIES, SETTLED_PR_REFRESH_STATUSES, ACTIVE_PR_REFRESH_STATUSES, isPRRefreshStateExpired, buildGitHubPRRefreshStateClearToken, getGitHubPRRefreshStateExpiryAt, isExpiredActivePRRefreshState, getEffectiveGitHubPRRefreshState, pruneExpiredPRRefreshStates, capPrRefreshStates, shouldRefreshIssueDecorations, debouncedSaveCache, normalizeRuntimePRForBranchOutcome } from './github-state'
import type { ProjectViewCacheEntry, ProjectRowContentUpdate, GitHubPatchWorkItemOptions, ProjectRowContentPatch, GitHubWorkItemRequestContext, GitHubWorkItemRequestTarget, GitHubWorkItemsListArgs, GitHubPRFallbackSource, WorktreeLookupEntry, WorktreeLookupIndex, GitHubSlice } from './github-state'
export function countGitHubWorkItemsForRepo(
  context: GitHubWorkItemRequestContext,
  args: { query?: string }
): Promise<number> {
  if (context.target.kind === 'environment') {
    return callRuntimeRpc<number>(
      { kind: 'environment', environmentId: context.target.environmentId },
      'github.countWorkItems',
      {
        repo: context.target.runtimeRepoId,
        ...args
      },
      { timeoutMs: 30_000 }
    )
  }
  return window.api.gh.countWorkItems({
    repoPath: context.repoPath,
    repoId: context.repoId,
    ...args
  })
}
export function isGitHubUnavailableWorkItemsError(error: unknown): boolean {
  // Why: only `runtime_error` came from the GitHub method; other RPC transport failures ("timed out"/"unavailable") must not be blamed on GitHub.
  if (error instanceof RuntimeRpcCallError && error.code !== 'runtime_error') {
    return false
  }
  const message = error instanceof Error ? error.message : String(error)
  return classifyGitHubUnavailable(message) !== null
}
export function projectViewCacheKey(
  ownerType: GetProjectViewTableArgs['ownerType'],
  owner: string,
  projectNumber: number,
  resolvedViewId: string,
  queryOverride?: string,
  sourceScope = 'local',
  host?: string
): string {
  const projectKey = githubProjectIdentityKey({ ownerType, owner, number: projectNumber, host })
  return `github-project:${sourceScope}:${projectKey}:${resolvedViewId}${queryOverrideKeyPart(queryOverride)}`
}
export function projectViewRequestKey(args: GetProjectViewTableArgs, sourceScope: string): string {
  // Why: without `viewId` the resolved cache key isn't known until the IPC returns, so dedup on the input-arg signature instead.
  const selector = args.viewId
    ? `id:${args.viewId}`
    : args.viewNumber !== undefined
      ? `num:${args.viewNumber}`
      : args.viewName
        ? `name:${args.viewName}`
        : 'default'
  const projectKey = githubProjectIdentityKey({
    ownerType: args.ownerType,
    owner: args.owner,
    number: args.projectNumber,
    host: args.host
  })
  return `${sourceScope}:${projectKey}:${selector}${queryOverrideKeyPart(args.queryOverride)}`
}
export function projectViewSourceScope(settings: AppState['settings']): string {
  const target = getActiveRuntimeTarget(settings)
  return target.kind === 'environment' ? `runtime:${target.environmentId}` : 'local'
}
export function settingsForProjectViewCacheKey(
  settings: AppState['settings'],
  cacheKey: string
): Pick<NonNullable<AppState['settings']>, 'activeRuntimeEnvironmentId'> {
  const runtimeMatch = /^github-project:runtime:([^:]+):/.exec(cacheKey)
  if (runtimeMatch) {
    return { ...settings, activeRuntimeEnvironmentId: runtimeMatch[1] }
  }
  return { ...settings, activeRuntimeEnvironmentId: null }
}

// Why: reuses the work-item concurrency gate since project-view and work-item fetches share the same gh subprocess budget; separate gates would blow the cap.
export const inflightProjectViewRequests = new Map<
  string,
  { promise: Promise<GetProjectViewTableResult>; force: boolean }
>()

// Why: optimistic field value so the patched row re-renders immediately; best-effort, overwritten by the authoritative payload on next refresh.
export function optimisticFieldValueFromMutation(
  table: GitHubProjectTable,
  fieldId: string,
  value: GitHubProjectFieldMutationValue
): GitHubProjectTable['rows'][number]['fieldValuesByFieldId'][string] | null {
  const field = table.selectedView.fields.find((f) => f.id === fieldId)
  switch (value.kind) {
    case 'single-select': {
      if (field?.kind === 'single-select') {
        const option = field.options.find((o) => o.id === value.optionId)
        if (option) {
          return {
            kind: 'single-select',
            fieldId,
            optionId: option.id,
            name: option.name,
            color: option.color
          }
        }
      }
      return {
        kind: 'single-select',
        fieldId,
        optionId: value.optionId,
        name: '',
        color: ''
      }
    }
    case 'iteration': {
      if (field?.kind === 'iteration') {
        const iteration = field.iterations.find((i) => i.id === value.iterationId)
        if (iteration) {
          return {
            kind: 'iteration',
            fieldId,
            iterationId: iteration.id,
            title: iteration.title,
            startDate: iteration.startDate,
            duration: iteration.duration
          }
        }
      }
      return {
        kind: 'iteration',
        fieldId,
        iterationId: value.iterationId,
        title: '',
        startDate: '',
        duration: 0
      }
    }
    case 'text':
      return { kind: 'text', fieldId, text: value.text }
    case 'number':
      return { kind: 'number', fieldId, number: value.number }
    case 'date':
      return { kind: 'date', fieldId, date: value.date }
  }
  return null
}
export function applyRowPatch(
  set: (fn: (s: AppState) => Partial<AppState>) => void,
  cacheKey: string,
  rowId: string,
  nextRow: GitHubProjectRow
): void {
  set((s) => {
    const entry = s.projectViewCache[cacheKey]
    if (!entry?.data) {
      return {}
    }
    const rowIndex = entry.data.rows.findIndex((r) => r.id === rowId)
    if (rowIndex === -1) {
      return {}
    }
    const rows = [...entry.data.rows]
    rows[rowIndex] = nextRow
    return {
      projectViewCache: {
        ...s.projectViewCache,
        [cacheKey]: {
          ...entry,
          data: { ...entry.data, rows }
        }
      }
    }
  })
}
export function rollbackRowIfPresent(
  set: (fn: (s: AppState) => Partial<AppState>) => void,
  get: () => AppState,
  cacheKey: string,
  rowId: string,
  previousRow: GitHubProjectRow
): void {
  // Why: skip rollback when the entry moved (rapid project switch) or the row is gone, else stale data would surface in the newly selected project.
  const entry = get().projectViewCache[cacheKey]
  if (!entry?.data) {
    return
  }
  const stillPresent = entry.data.rows.some((r) => r.id === rowId)
  if (!stillPresent) {
    return
  }
  applyRowPatch(set, cacheKey, rowId, previousRow)
}
export function parseSlugAndNumber(
  row: GitHubProjectRow
): { owner: string; repo: string; number: number } | null {
  if (!row.content.repository || row.content.number == null) {
    return null
  }
  const parts = row.content.repository.split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null
  }
  return { owner: parts[0], repo: parts[1], number: row.content.number }
}
export type WorkItemsCacheSources = {
  issues: GitHubOwnerRepo | null;
  prs: GitHubOwnerRepo | null;
  /** Raw origin remote (if any); required-nullable so the selector can distinguish it from the effective PR source. */
  originCandidate: GitHubOwnerRepo | null;
  /** Raw upstream remote (if any); required-nullable (like `issues`/`prs`) so consumers branch on null-vs-value, not a three-state. */
  upstreamCandidate: GitHubOwnerRepo | null;
}

// Why: stamp the slug on the error so banner copy stays correct even when the error outlives the entry's `sources` field.
export type WorkItemsCacheError = ClassifiedError & { source: GitHubOwnerRepo }
export type CacheEntry<T> = {
  data: T | null
  fetchedAt: number
  headSha?: string
  /** Resolved issue/PR owner/repo slugs; set only on `fetchWorkItems` entries (single-item PR/issue caches don't carry sources). */
  sources?: WorkItemsCacheSources
  /** Per-side classified error; on partial success `data` keeps the good side and the failing side is recorded here so banner + list render together. */
  error?: WorkItemsCacheError
  /** True when the resolver fell back to origin because the preferred `'upstream'` remote is gone; typed `?: true` (never `false`) to encode "present iff fell-back". */
  issueSourceFellBack?: true
}
export type FetchOptions = {
  force?: boolean;
  noCache?: boolean;
  sourceContext?: TaskSourceContext | null;
}
export type RepoScopedFetchOptions = FetchOptions & {
  repoId?: string
}
export type PRRefreshState = {
  status: 'queued' | 'in-flight' | 'paused' | 'skipped' | 'error';
  reason: GitHubPRRefreshReason;
  updatedAt: number;
  pausedUntil?: number;
  message?: string;
  // Why: classified errors drive stable copy without exposing raw upstream messages.
  errorType?: PRRefreshErrorType;
  skippedReason?: GitHubPRRefreshSkippedReason;
  nextAutoRetryAt?: number;
  retryDisabledUntil?: number;
}
export type PRRefreshStateClearToken = {
  sequence: number;
  status: PRRefreshState['status'];
  updatedAt: number;
}
export const PR_REFRESH_ACTIVE_STALE_MS = 120_000
export const PR_REFRESH_PAUSED_GRACE_MS = 5_000
export function bypassesGitHubPRRefreshFreshness(reason: GitHubPRRefreshReason): boolean {
  return reason === 'manual' || reason === 'active' || reason === 'post-push'
}
export const CACHE_TTL = 300_000 // 5 minutes (stale data shown instantly, then refreshed)
export const CHECKS_CACHE_TTL = 60_000 // 1 minute — checks change more frequently
export const EMPTY_CHECKS_CACHE_TTL = 10_000
// Why: the work-item list is a browse surface, not a source of truth, so 60s staleness is fine (SWR keeps it current).
export const WORK_ITEMS_CACHE_TTL = 60_000
// Why: long-lived (matches repos.ts) so the user has time to read + act on persist failures before the toast vanishes.
export const ERROR_TOAST_DURATION = 60_000
export const inflightPRRequests = new Map<
  string,
  { promise: Promise<PRInfo | null>; force: boolean; generation: number; lookupHintKey: string }
>()
export const inflightIssueRequests = new Map<string, Promise<IssueInfo | null>>()
export type InflightChecks = {
  promise: Promise<PRCheckDetail[]>;
  force: boolean;
  noCache: boolean;
}
export const inflightChecksRequests = new Map<string, InflightChecks>()
export const inflightCommentsRequests = new Map<string, Promise<PRComment[]>>()
export type InflightWorkItems = {
  promise: Promise<GitHubWorkItem[]>;
  force: boolean;
  noCache: boolean;
}
export const inflightWorkItemsRequests = new Map<string, InflightWorkItems>()
export const prRequestGenerations = new Map<string, number>()
export const prRefreshStartedHostedReviewEntries = new Map<
  string,
  AppState['hostedReviewCache'][string] | undefined
>()
export const PR_REFRESH_STARTED_HOSTED_REVIEW_ENTRY_MAX = 128

/** @internal - exposed for leak-regression tests only */
export function _getGitHubPRRequestGenerationCountForTest(): number {
  return prRequestGenerations.size
}

/** @internal - exposed for leak-regression tests only */
export function _getGitHubPRRefreshStartedEntryCountForTest(): number {
  return prRefreshStartedHostedReviewEntries.size
}

/** @internal - exposed for leak-regression tests only */
export function _clearGitHubPRRefreshStartedEntriesForTest(): void {
  prRefreshStartedHostedReviewEntries.clear()
}

// Why: cap fan-out at the renderer boundary (main-side gate is behind IPC, can't stop a stampede in time); 8 balances responsiveness vs gh rate limits.
export const WORK_ITEM_FETCH_CONCURRENCY = 8
let workItemFetchInFlight = 0
