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
export function createGitHubSlicePatchProjectIssueOrPrActions2(set: SliceSet, get: SliceGet) {
  return {
  patchProjectIssueOrPr: async (cacheKey, rowId, updates) => {
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
    const { owner, repo, number } = parseSlugAndNumber(previousRow) ?? {}
    if (!owner || !repo || !number) {
      return {
        ok: false,
        error: {
          type: 'validation_error',
          message: translate(
            'auto.store.slices.github.87020f6605',
            'Row has no owner/repo/number — cannot patch underlying item'
          )
        }
      }
    }
    // Optimistic content patch.
    const nextContent = { ...previousRow.content }
    if (updates.title !== undefined) {
      nextContent.title = updates.title
    }
    if (updates.body !== undefined) {
      nextContent.body = updates.body
    }
    if (updates.addLabels || updates.removeLabels) {
      const next = new Map(nextContent.labels.map((l) => [l.name, l]))
      for (const name of updates.addLabels ?? []) {
        if (!next.has(name)) {
          next.set(name, { name, color: '808080' })
        }
      }
      for (const name of updates.removeLabels ?? []) {
        next.delete(name)
      }
      nextContent.labels = Array.from(next.values())
    }
    if (updates.addAssignees || updates.removeAssignees) {
      const next = new Map(nextContent.assignees.map((u) => [u.login, u]))
      for (const login of updates.addAssignees ?? []) {
        if (!next.has(login)) {
          next.set(login, { login, name: null, avatarUrl: null })
        }
      }
      for (const login of updates.removeAssignees ?? []) {
        next.delete(login)
      }
      nextContent.assignees = Array.from(next.values())
    }
    const optimisticRow: GitHubProjectRow = { ...previousRow, content: nextContent }
    applyRowPatch(set, cacheKey, rowId, optimisticRow)

    // Why: labels/assignees go through the issue endpoint for both (GitHub PRs are issues for those); title/body split PR→updatePullRequestBySlug vs issue→updateIssueBySlug.
    let envelope: GitHubProjectMutationResult = { ok: true }
    // Why: slug-only Project rows have no registered Orca repo, so fall back to the view source in the cache key, not the focused host.
    const target = getActiveRuntimeTarget(
      settingsForProjectRowOwner(
        get(),
        owner,
        repo,
        table.project.host,
        settingsForProjectViewCacheKey(get().settings, cacheKey)
      )
    )
    if (
      previousRow.itemType === 'PULL_REQUEST' &&
      (updates.title !== undefined || updates.body !== undefined)
    ) {
      const args = {
        owner,
        repo,
        host: table.project.host,
        number,
        updates: {
          ...(updates.title !== undefined ? { title: updates.title } : {}),
          ...(updates.body !== undefined ? { body: updates.body } : {})
        }
      }
      const prRes =
        target.kind === 'environment'
          ? await callRuntimeRpc<GitHubProjectMutationResult>(
              target,
              'github.project.updatePullRequestBySlug',
              args,
              { timeoutMs: 30_000 }
            )
          : await window.api.gh.updatePullRequestBySlug(args)
      if (!prRes.ok) {
        envelope = prRes
      }
    }
    if (
      envelope.ok &&
      (updates.addLabels?.length ||
        updates.removeLabels?.length ||
        updates.addAssignees?.length ||
        updates.removeAssignees?.length ||
        (previousRow.itemType === 'ISSUE' &&
          (updates.title !== undefined || updates.body !== undefined)))
    ) {
      const args = {
        owner,
        repo,
        host: table.project.host,
        number,
        updates: {
          ...(updates.title !== undefined ? { title: updates.title } : {}),
          ...(updates.body !== undefined ? { body: updates.body } : {}),
          ...(updates.addLabels ? { addLabels: updates.addLabels } : {}),
          ...(updates.removeLabels ? { removeLabels: updates.removeLabels } : {}),
          ...(updates.addAssignees ? { addAssignees: updates.addAssignees } : {}),
          ...(updates.removeAssignees ? { removeAssignees: updates.removeAssignees } : {})
        }
      }
      const issueRes =
        target.kind === 'environment'
          ? await callRuntimeRpc<GitHubProjectMutationResult>(
              target,
              'github.project.updateIssueBySlug',
              args,
              { timeoutMs: 30_000 }
            )
          : await window.api.gh.updateIssueBySlug(args)
      if (!issueRes.ok) {
        envelope = issueRes
      }
    }
    if (!envelope.ok) {
      rollbackRowIfPresent(set, get, cacheKey, rowId, previousRow)
    }
    return envelope
  },
  patchProjectRowIssueType: async (cacheKey, rowId, issueType) => {
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
    const row = table.rows.find((r) => r.id === rowId)
    if (!row) {
      return {
        ok: false,
        error: {
          type: 'unknown',
          message: translate('auto.store.slices.github.f963485d37', 'Row not found')
        }
      }
    }
    if (row.itemType !== 'ISSUE') {
      return {
        ok: false,
        error: {
          type: 'validation_error',
          message: translate(
            'auto.store.slices.github.83f9b126ad',
            'Issue Type can only be set on Issues.'
          )
        }
      }
    }
    const { owner, repo, number } = parseSlugAndNumber(row) ?? {}
    if (!owner || !repo || !number) {
      return {
        ok: false,
        error: {
          type: 'validation_error',
          message: translate('auto.store.slices.github.683a21264b', 'Row has no owner/repo/number.')
        }
      }
    }
    const previousRow = row
    const optimistic: GitHubProjectRow = {
      ...previousRow,
      content: { ...previousRow.content, issueType }
    }
    applyRowPatch(set, cacheKey, rowId, optimistic)
    // Why: slug-only Project rows belong to the host that loaded the view, which may differ from the now-focused host.
    const target = getActiveRuntimeTarget(
      settingsForProjectRowOwner(
        get(),
        owner,
        repo,
        table.project.host,
        settingsForProjectViewCacheKey(get().settings, cacheKey)
      )
    )
    const args = {
      owner,
      repo,
      host: table.project.host,
      number,
      issueTypeId: issueType?.id ?? null
    }
    const res =
      target.kind === 'environment'
        ? await callRuntimeRpc<GitHubProjectMutationResult>(
            target,
            'github.project.updateIssueTypeBySlug',
            args,
            { timeoutMs: 30_000 }
          )
        : await window.api.gh.updateIssueTypeBySlug(args)
    if (!res.ok) {
      rollbackRowIfPresent(set, get, cacheKey, rowId, previousRow)
    }
    return res
  },
  patchProjectRowContent: (cacheKey, rowId, patch) => {
    const state = get()
    const entry = state.projectViewCache[cacheKey]
    const table = entry?.data
    if (!table) {
      return
    }
    const previousRow = table.rows.find((r) => r.id === rowId)
    if (!previousRow) {
      return
    }
    const nextContent = { ...previousRow.content }
    if (patch.title !== undefined) {
      nextContent.title = patch.title
    }
    if (patch.body !== undefined) {
      nextContent.body = patch.body
    }
    if (patch.state !== undefined) {
      // Why: ProjectV2 row.state is GitHub's UPPERCASE enum ('OPEN'|'CLOSED'|'MERGED') but the dialog tracks lowercase; upper-case so the patch matches the canonical row shape.
      nextContent.state = patch.state.toUpperCase()
    }
    if (patch.labels !== undefined) {
      const existingByName = new Map(previousRow.content.labels.map((l) => [l.name, l]))
      nextContent.labels = patch.labels.map(
        (name) => existingByName.get(name) ?? { name, color: '808080' }
      )
    }
    if (patch.assignees !== undefined) {
      const existingByLogin = new Map(previousRow.content.assignees.map((u) => [u.login, u]))
      nextContent.assignees = patch.assignees.map(
        (login) => existingByLogin.get(login) ?? { login, name: null, avatarUrl: null }
      )
    }
    const nextRow: GitHubProjectRow = { ...previousRow, content: nextContent }
    applyRowPatch(set, cacheKey, rowId, nextRow)
  },
  getCachedWorkItems: (repoId, limit, query, repoPath, sourceContext) => {
    if (isGitHubWorkItemsQueryTooLarge(query)) {
      return null
    }
    const state = get()
    const key =
      sourceContext?.provider === 'github'
        ? workItemsCacheKey(repoId, limit, query, getTaskSourceCacheScope(sourceContext))
        : getWorkItemsCacheKeyForOwner(state, repoId, limit, query, repoPath)
    return get().workItemsCache[key]?.data ?? null
  },
  getWorkItemsSourcesAndError: (repoId, limit, query, repoPath) => {
    if (isGitHubWorkItemsQueryTooLarge(query)) {
      return { sources: null, error: null }
    }
    const key = getWorkItemsCacheKeyForOwner(get(), repoId, limit, query, repoPath)
    const entry = get().workItemsCache[key]
    return {
      sources: entry?.sources ?? null,
      error: entry?.error ?? null
    }
  },
  }
}