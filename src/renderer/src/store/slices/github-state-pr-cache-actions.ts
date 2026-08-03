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
export function createGitHubSlicePrCacheActions(set: SliceSet, get: SliceGet) {
  return {
  prCache: {},
  issueCache: {},
  checksCache: {},
  commentsCache: {},
  prRefreshSequences: {},
  prRefreshStates: {},
  prVisibleRefreshGeneration: 0,
  workItemsCache: {},
  workItemsInvalidationNonce: 0,
  projectViewCache: {},
  getEffectiveGitHubPRRefreshState: (cacheKey, now) =>
    getEffectiveGitHubPRRefreshState(get().prRefreshStates, cacheKey, now),
  expireGitHubPRRefreshState: (cacheKey, token, now = Date.now()) => {
    const currentState = get()
    const currentRefreshState = currentState.prRefreshStates[cacheKey]
    if (
      !currentRefreshState ||
      !ACTIVE_PR_REFRESH_STATUSES.has(currentRefreshState.status) ||
      !isExpiredActivePRRefreshState(currentRefreshState, now) ||
      (currentState.prRefreshSequences[cacheKey] ?? 0) !== token.sequence ||
      currentRefreshState.status !== token.status ||
      currentRefreshState.updatedAt !== token.updatedAt
    ) {
      return
    }
    set((s) => {
      const state = s.prRefreshStates[cacheKey]
      if (
        !state ||
        !ACTIVE_PR_REFRESH_STATUSES.has(state.status) ||
        !isExpiredActivePRRefreshState(state, now) ||
        (s.prRefreshSequences[cacheKey] ?? 0) !== token.sequence ||
        state.status !== token.status ||
        state.updatedAt !== token.updatedAt
      ) {
        return s
      }
      const nextStates = { ...s.prRefreshStates }
      delete nextStates[cacheKey]
      return { prRefreshStates: nextStates }
    })
  },
  fetchProjectViewTable: async (args, options) => {
    const target = getActiveRuntimeTarget(get().settings)
    const sourceScope = projectViewSourceScope(get().settings)
    const requestKey = projectViewRequestKey(args, sourceScope)

    // Fast path: a caller-supplied `viewId` gives the resolved cache key up front, so serve a fresh entry directly.
    const maybeKnownKey = args.viewId
      ? projectViewCacheKey(
          args.ownerType,
          args.owner,
          args.projectNumber,
          args.viewId,
          args.queryOverride,
          sourceScope,
          args.host
        )
      : null
    if (!options?.force && maybeKnownKey) {
      const cached = get().projectViewCache[maybeKnownKey]
      if (cached?.data && Date.now() - cached.fetchedAt < WORK_ITEMS_CACHE_TTL) {
        return { ok: true, data: cached.data }
      }
    }

    const existing = inflightProjectViewRequests.get(requestKey)
    if (existing) {
      // Why: a forcing caller must not dedupe to a non-forcing in-flight request; wait for it to settle, then issue a fresh forced call (mirrors fetchWorkItems).
      if (options?.force && !existing.force) {
        await existing.promise.catch(() => {})
      } else {
        return existing.promise
      }
    }

    const request = (async (): Promise<GetProjectViewTableResult> => {
      await acquireWorkItemSlot()
      try {
        const envelope =
          target.kind === 'environment'
            ? await callRuntimeRpc<GetProjectViewTableResult>(
                target,
                'github.project.viewTable',
                args,
                { timeoutMs: 60_000 }
              )
            : await window.api.gh.getProjectViewTable(args)
        if (envelope.ok) {
          const table = envelope.data
          const key = projectViewCacheKey(
            table.project.ownerType,
            table.project.owner,
            table.project.number,
            table.selectedView.id,
            args.queryOverride,
            sourceScope,
            table.project.host
          )
          set((s) => ({
            projectViewCache: withBoundedCacheEntry(s.projectViewCache, key, {
              data: table,
              fetchedAt: Date.now()
            })
          }))
        } else if (maybeKnownKey) {
          // Why: only stamp the error when we have a resolved key; without one there's nowhere to write it and the renderer classifies from the envelope.
          set((s) => ({
            projectViewCache: withBoundedCacheEntry(s.projectViewCache, maybeKnownKey, {
              data: s.projectViewCache[maybeKnownKey]?.data ?? null,
              fetchedAt: Date.now(),
              error: envelope.error
            })
          }))
        }
        return envelope
      } catch (err) {
        // Why: the IPC boundary must not throw across the promise — wrap unexpected errors in the classified envelope for a single renderer shape.
        console.error('Failed to fetch GitHub project view:', err)
        return {
          ok: false,
          error: {
            type: 'unknown',
            message: err instanceof Error ? err.message : 'Failed to fetch project view'
          }
        }
      } finally {
        releaseWorkItemSlot()
        inflightProjectViewRequests.delete(requestKey)
      }
    })()

    inflightProjectViewRequests.set(requestKey, {
      promise: request,
      force: Boolean(options?.force)
    })
    return request
  },
  updateProjectFieldValue: async (cacheKey, rowId, fieldId, value) => {
    const state = get()
    const entry = state.projectViewCache[cacheKey]
    const table = entry?.data
    if (!table) {
      return {
        ok: false,
        error: {
          type: 'unknown',
          message: translate('auto.store.slices.github.a967f23983', 'Project view not loaded')
        }
      }
    }
    const rowIndex = table.rows.findIndex((r) => r.id === rowId)
    if (rowIndex === -1) {
      return {
        ok: false,
        error: {
          type: 'unknown',
          message: translate('auto.store.slices.github.f963485d37', 'Row not found')
        }
      }
    }
    const previousRow = table.rows[rowIndex]
    // Optimistic patch: build a field value matching the mutation shape.
    const nextField = optimisticFieldValueFromMutation(table, fieldId, value)
    const optimisticFieldValues = { ...previousRow.fieldValuesByFieldId }
    if (nextField) {
      optimisticFieldValues[fieldId] = nextField
    }
    const optimisticRow: GitHubProjectRow = {
      ...previousRow,
      fieldValuesByFieldId: optimisticFieldValues
    }
    applyRowPatch(set, cacheKey, rowId, optimisticRow)

    const target = getActiveRuntimeTarget(settingsForProjectViewCacheKey(get().settings, cacheKey))
    const result =
      target.kind === 'environment'
        ? await callRuntimeRpc<GitHubProjectMutationResult>(
            target,
            'github.project.updateItemField',
            {
              projectId: table.project.id,
              host: table.project.host,
              itemId: rowId,
              fieldId,
              value
            },
            { timeoutMs: 30_000 }
          )
        : await window.api.gh.updateProjectItemField({
            projectId: table.project.id,
            host: table.project.host,
            itemId: rowId,
            fieldId,
            value
          })
    if (!result.ok) {
      rollbackRowIfPresent(set, get, cacheKey, rowId, previousRow)
    }
    return result
  },
  clearProjectFieldValue: async (cacheKey, rowId, fieldId) => {
    const state = get()
    const entry = state.projectViewCache[cacheKey]
    const table = entry?.data
    if (!table) {
      return {
        ok: false,
        error: {
          type: 'unknown',
          message: translate('auto.store.slices.github.a967f23983', 'Project view not loaded')
        }
      }
    }
    const rowIndex = table.rows.findIndex((r) => r.id === rowId)
    if (rowIndex === -1) {
      return {
        ok: false,
        error: {
          type: 'unknown',
          message: translate('auto.store.slices.github.f963485d37', 'Row not found')
        }
      }
    }
    const previousRow = table.rows[rowIndex]
    const optimisticFieldValues = { ...previousRow.fieldValuesByFieldId }
    delete optimisticFieldValues[fieldId]
    const optimisticRow: GitHubProjectRow = {
      ...previousRow,
      fieldValuesByFieldId: optimisticFieldValues
    }
    applyRowPatch(set, cacheKey, rowId, optimisticRow)

    const target = getActiveRuntimeTarget(settingsForProjectViewCacheKey(get().settings, cacheKey))
    const result =
      target.kind === 'environment'
        ? await callRuntimeRpc<GitHubProjectMutationResult>(
            target,
            'github.project.clearItemField',
            {
              projectId: table.project.id,
              host: table.project.host,
              itemId: rowId,
              fieldId
            },
            { timeoutMs: 30_000 }
          )
        : await window.api.gh.clearProjectItemField({
            projectId: table.project.id,
            host: table.project.host,
            itemId: rowId,
            fieldId
          })
    if (!result.ok) {
      rollbackRowIfPresent(set, get, cacheKey, rowId, previousRow)
    }
    return result
  },
  }
}
