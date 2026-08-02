/*    selection, issue caches, and optimistic patch propagation as one store
   boundary so cache invalidation stays coherent. */
import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type {
  LinearViewer,
  LinearConnectionStatus,
  LinearCollectionResult,
  LinearCustomViewModel,
  LinearCustomViewSummary,
  LinearIssue,
  LinearProjectDetail,
  LinearProjectSummary,
  LinearTeam,
  LinearWorkspace,
  LinearWorkspaceError,
  LinearWorkspaceSelection
} from '../../../../shared/types'
import type { CacheEntry } from './github'
import { clampLinearIssueListLimit } from '../../../../shared/linear-issue-read-limits'
import { isIntegrationCredentialDecryptionError } from '../../../../shared/integration-credential-errors'
import { clearLinearMetadataCache } from '../../hooks/useIssueMetadata'
import {
  isLinearIssueAttributeFilterUnsupportedError,
  linearConnect,
  linearDisconnect,
  linearDisconnectWorkspace,
  linearGetCustomView,
  linearGetProject,
  linearGetIssue,
  linearListCustomViewIssues,
  linearListCustomViewProjects,
  linearListCustomViews,
  linearListIssues,
  linearListProjectIssues,
  linearListProjects,
  linearListTeams,
  linearSearchIssues,
  linearSelectWorkspace,
  linearStatus,
  linearTestConnection
} from '@/runtime/runtime-linear-client'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { translate } from '@/i18n/i18n'
import {
  getTaskSourceCacheScope,
  getTaskSourceRuntimeSettings,
  type TaskSourceContext
} from '../../../../shared/task-source-context'
import {
  canonicalizeLinearIssueAttributeFilter,
  isEmptyLinearIssueAttributeFilter,
  linearIssueAttributeFilterSignature,
  type LinearIssueAttributeFilter
} from '../../../../shared/linear-issue-attribute-filter'
import { CACHE_TTL, TEAM_CACHE_TTL, MAX_CACHE_ENTRIES, isFresh, evictStaleEntries, looksLikeAuthError, workspaceErrorType, workspaceErrorMessage, inflightIssueRequests, inflightSearchRequests, inflightListRequests, inflightTeamRequests, inflightProjectRequests, inflightProjectDetailRequests, inflightProjectIssueRequests, inflightCustomViewRequests, inflightCustomViewDetailRequests, inflightCustomViewIssueRequests, inflightCustomViewProjectRequests, getSelectedWorkspaceId, linearSearchCacheKey, linearListCacheKey, LINEAR_LIST_INVALIDATION_VERSION_CAP, linearTeamsCacheKey, linearWorkspaceSignature, linearStatusScopeSignature, clearLinearRequestMaps, invalidateLinearCaches, clearLinearIssueCollectionRequestMaps, shouldRefreshStatusAfterRead, linearCollectionCacheKey, emptyLinearCollection, collectionWithWorkspaceError, largestCachedCollectionBelowLimit, patchLinearIssueCollectionCache, normalizeListAttributeFilter, beginLinearMutation, isCurrentLinearMutation, isCurrentLinearRuntimeContext, canWriteLinearReadResult, getLinearReadScope, scopedLinearCacheKey } from './linear-state'
import type { InflightLinearIssueRequest, InflightLinearListRequest, InflightLinearPlainListRequest, InflightLinearCollectionRequest, InflightLinearDetailRequest, InflightLinearTeamRequest, LinearIssueListReadArgs, LinearIssueReadArgs, LinearFetchOptions, LinearPatchOptions, LinearReadScope, LinearSlice } from './linear-state'
type SliceSet = Parameters<StateCreator<AppState>>[0]
type SliceGet = Parameters<StateCreator<AppState>>[1]
export function createLinearSliceSearchLinearIssuesActions3(set: SliceSet, get: SliceGet) {
  return {
  searchLinearIssues: async (query: string, limit = 20, options) => {
    const scope = getLinearReadScope(get().settings, options?.sourceContext)
    const { contextKey } = scope
    const workspaceId = getSelectedWorkspaceId(get().linearStatus)
    const cacheKey = scopedLinearCacheKey(scope, linearSearchCacheKey(workspaceId, query, limit))
    const cached = get().linearSearchCache[cacheKey]
    if (!options?.force && isFresh(cached)) {
      return cached.data ?? []
    }

    const inflight = inflightSearchRequests.get(cacheKey)
    if (
      inflight &&
      inflight.contextKey === contextKey &&
      inflight.mutationGeneration === linearMutationGeneration &&
      (!options?.force || inflight.force)
    ) {
      return inflight.promise
    }

    let entry: InflightLinearListRequest
    const requestCacheGeneration = linearCacheGeneration
    const requestMutationGeneration = linearMutationGeneration
    const promise = linearSearchIssues(scope.settings, query, limit, workspaceId)
      .then((issues) => {
        const data = issues as LinearIssue[]
        if (
          inflightSearchRequests.get(cacheKey) === entry &&
          canWriteLinearReadResult(
            contextKey,
            requestCacheGeneration,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set((s) => ({
            linearSearchCache: evictStaleEntries({
              ...s.linearSearchCache,
              [cacheKey]: { data, fetchedAt: Date.now() }
            })
          }))
        }
        return data
      })
      .catch((error) => {
        console.warn('[linear] searchLinearIssues failed:', error)
        if (
          (isIntegrationCredentialDecryptionError(error) || looksLikeAuthError(error)) &&
          canWriteLinearReadResult(
            contextKey,
            requestCacheGeneration,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          if (!shouldRefreshStatusAfterRead(workspaceId, get().linearStatus)) {
            void get().checkLinearConnection(true)
          }
          return []
        }
        return get().linearSearchCache[cacheKey]?.data ?? []
      })
      .finally(() => {
        if (inflightSearchRequests.get(cacheKey) === entry) {
          inflightSearchRequests.delete(cacheKey)
        }
        if (
          shouldRefreshStatusAfterRead(workspaceId, get().linearStatus) &&
          canWriteLinearReadResult(
            contextKey,
            requestCacheGeneration,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          void get().checkLinearConnection(true)
        }
      })

    entry = {
      promise,
      force: Boolean(options?.force),
      generation: requestCacheGeneration,
      contextKey,
      mutationGeneration: requestMutationGeneration
    }
    inflightSearchRequests.set(cacheKey, entry)
    return promise
  },
  listLinearIssues: async (args, options) => {
    const scope = getLinearReadScope(get().settings, options?.sourceContext)
    const { contextKey } = scope
    const workspaceId = getSelectedWorkspaceId(get().linearStatus)
    const filter = args.filter ?? 'assigned'
    const effectiveLimit = clampLinearIssueListLimit(args.limit)
    const attributeFilter = normalizeListAttributeFilter(args.attributeFilter)
    const cacheKey = scopedLinearCacheKey(
      scope,
      linearListCacheKey(workspaceId, filter, effectiveLimit, attributeFilter)
    )
    const cached = get().linearListCache[cacheKey]
    if (!options?.force && isFresh(cached)) {
      return cached.data ?? emptyLinearCollection<LinearIssue>()
    }

    const inflight = inflightListRequests.get(cacheKey)
    if (
      inflight &&
      inflight.contextKey === contextKey &&
      inflight.mutationGeneration === linearMutationGeneration &&
      (!options?.force || inflight.force)
    ) {
      return inflight.promise
    }

    let entry: InflightLinearPlainListRequest
    const requestCacheGeneration = linearCacheGeneration
    const requestMutationGeneration = linearMutationGeneration
    const promise: Promise<LinearCollectionResult<LinearIssue>> = linearListIssues(
      scope.settings,
      filter,
      effectiveLimit,
      workspaceId,
      attributeFilter
    )
      .then((result) => {
        const data = result as LinearCollectionResult<LinearIssue>
        if (
          inflightListRequests.get(cacheKey) === entry &&
          canWriteLinearReadResult(
            contextKey,
            requestCacheGeneration,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set((s) => ({
            linearListCache: evictStaleEntries({
              ...s.linearListCache,
              [cacheKey]: { data, fetchedAt: Date.now() }
            })
          }))
        }
        return data
      })
      .catch((error) => {
        console.warn('[linear] listLinearIssues failed:', error)
        // Why: capability mismatch is actionable (update remote runtime). Swallowing
        // it as [] would look like "no issues match filters" and hide the fix.
        if (isLinearIssueAttributeFilterUnsupportedError(error)) {
          throw error
        }
        if (
          (isIntegrationCredentialDecryptionError(error) || looksLikeAuthError(error)) &&
          canWriteLinearReadResult(
            contextKey,
            requestCacheGeneration,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          if (!shouldRefreshStatusAfterRead(workspaceId, get().linearStatus)) {
            void get().checkLinearConnection(true)
          }
          return emptyLinearCollection<LinearIssue>()
        }
        return get().linearListCache[cacheKey]?.data ?? emptyLinearCollection<LinearIssue>()
      })
      .finally(() => {
        if (inflightListRequests.get(cacheKey) === entry) {
          inflightListRequests.delete(cacheKey)
        }
        if (
          shouldRefreshStatusAfterRead(workspaceId, get().linearStatus) &&
          canWriteLinearReadResult(
            contextKey,
            requestCacheGeneration,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          void get().checkLinearConnection(true)
        }
      })

    entry = {
      promise,
      force: Boolean(options?.force),
      generation: requestCacheGeneration,
      contextKey,
      mutationGeneration: requestMutationGeneration
    }
    inflightListRequests.set(cacheKey, entry)
    return promise
  },
  getCachedLinearTeams: (workspaceId, options) => {
    const scope = getLinearReadScope(get().settings, options?.sourceContext)
    const key = linearTeamsCacheKey(workspaceId ?? getSelectedWorkspaceId(get().linearStatus))
    return get().linearTeamCache[scopedLinearCacheKey(scope, key)]?.data ?? null
  },
  listLinearTeams: async (workspaceId, options) => {
    const scope = getLinearReadScope(get().settings, options?.sourceContext)
    const { contextKey } = scope
    const resolvedWorkspaceId = workspaceId ?? getSelectedWorkspaceId(get().linearStatus)
    const cacheKey = scopedLinearCacheKey(scope, linearTeamsCacheKey(resolvedWorkspaceId))
    const cached = get().linearTeamCache[cacheKey]
    if (!options?.force && isFresh(cached, TEAM_CACHE_TTL)) {
      return cached.data ?? []
    }

    const inflight = inflightTeamRequests.get(cacheKey)
    if (
      inflight &&
      inflight.contextKey === contextKey &&
      inflight.mutationGeneration === linearMutationGeneration &&
      (!options?.force || inflight.force)
    ) {
      return inflight.promise
    }

    let entry: InflightLinearTeamRequest
    const requestCacheGeneration = linearCacheGeneration
    const requestMutationGeneration = linearMutationGeneration
    const promise = linearListTeams(scope.settings, resolvedWorkspaceId)
      .then((teams) => {
        const data = teams as LinearTeam[]
        if (
          inflightTeamRequests.get(cacheKey) === entry &&
          canWriteLinearReadResult(
            contextKey,
            requestCacheGeneration,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set((s) => ({
            linearTeamCache: evictStaleEntries({
              ...s.linearTeamCache,
              [cacheKey]: { data, fetchedAt: Date.now() }
            })
          }))
        }
        return data
      })
      .catch((error) => {
        console.warn('[linear] listLinearTeams failed:', error)
        if (
          (isIntegrationCredentialDecryptionError(error) || looksLikeAuthError(error)) &&
          canWriteLinearReadResult(
            contextKey,
            requestCacheGeneration,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          if (!shouldRefreshStatusAfterRead(resolvedWorkspaceId, get().linearStatus)) {
            void get().checkLinearConnection(true)
          }
          return []
        }
        return get().linearTeamCache[cacheKey]?.data ?? []
      })
      .finally(() => {
        if (inflightTeamRequests.get(cacheKey) === entry) {
          inflightTeamRequests.delete(cacheKey)
        }
        if (
          shouldRefreshStatusAfterRead(resolvedWorkspaceId, get().linearStatus) &&
          canWriteLinearReadResult(
            contextKey,
            requestCacheGeneration,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          void get().checkLinearConnection(true)
        }
      })

    entry = {
      promise,
      force: Boolean(options?.force),
      generation: requestCacheGeneration,
      contextKey,
      mutationGeneration: requestMutationGeneration
    }
    inflightTeamRequests.set(cacheKey, entry)
    return promise
  },
  }
}