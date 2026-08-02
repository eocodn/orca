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
export function createLinearSliceGetCachedLinearProjectsActions4(set: SliceSet, get: SliceGet) {
  return {
  getCachedLinearProjects: (query, limit = 20, workspaceId, options) => {
    const scope = getLinearReadScope(get().settings, options?.sourceContext)
    const resolvedWorkspaceId = workspaceId ?? getSelectedWorkspaceId(get().linearStatus)
    const cacheKey = linearCollectionCacheKey(resolvedWorkspaceId, 'projects', query?.trim(), limit)
    return get().linearProjectCache[scopedLinearCacheKey(scope, cacheKey)]?.data ?? null
  },
  listLinearProjects: async (query, limit = 20, workspaceId, options) => {
    const scope = getLinearReadScope(get().settings, options?.sourceContext)
    const { contextKey } = scope
    const resolvedWorkspaceId = workspaceId ?? getSelectedWorkspaceId(get().linearStatus)
    const trimmed = query?.trim() || undefined
    const cacheKey = scopedLinearCacheKey(
      scope,
      linearCollectionCacheKey(resolvedWorkspaceId, 'projects', trimmed, limit)
    )
    const cached = get().linearProjectCache[cacheKey]
    if (!options?.force && isFresh(cached)) {
      return cached.data ?? emptyLinearCollection<LinearProjectSummary>()
    }

    const inflight = inflightProjectRequests.get(cacheKey)
    if (
      inflight &&
      inflight.contextKey === contextKey &&
      inflight.mutationGeneration === linearMutationGeneration &&
      (!options?.force || inflight.force)
    ) {
      return inflight.promise
    }

    let entry: InflightLinearCollectionRequest<LinearProjectSummary>
    const requestCacheGeneration = linearCacheGeneration
    const requestMutationGeneration = linearMutationGeneration
    const promise = linearListProjects(scope.settings, trimmed, limit, resolvedWorkspaceId, {
      force: options?.force
    })
      .then((result) => {
        if (
          inflightProjectRequests.get(cacheKey) === entry &&
          canWriteLinearReadResult(
            contextKey,
            requestCacheGeneration,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set((s) => ({
            linearProjectCache: evictStaleEntries({
              ...s.linearProjectCache,
              [cacheKey]: { data: result, fetchedAt: Date.now() }
            })
          }))
        }
        return result
      })
      .catch((error) => {
        console.warn('[linear] listLinearProjects failed:', error)
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
          void get().checkLinearConnection(true)
        }
        const fallback =
          get().linearProjectCache[cacheKey]?.data ?? emptyLinearCollection<LinearProjectSummary>()
        return collectionWithWorkspaceError(fallback, resolvedWorkspaceId ?? 'default', error)
      })
      .finally(() => {
        if (inflightProjectRequests.get(cacheKey) === entry) {
          inflightProjectRequests.delete(cacheKey)
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
    inflightProjectRequests.set(cacheKey, entry)
    return promise
  },
  fetchLinearProject: async (id, workspaceId, options) => {
    const scope = getLinearReadScope(get().settings, options?.sourceContext)
    const { contextKey } = scope
    const cacheKey = scopedLinearCacheKey(
      scope,
      linearCollectionCacheKey(workspaceId, 'project-detail', id)
    )
    const cached = get().linearProjectDetailCache[cacheKey]
    if (!options?.force && isFresh(cached)) {
      return cached.data
    }

    const inflight = inflightProjectDetailRequests.get(cacheKey)
    if (
      inflight &&
      inflight.contextKey === contextKey &&
      inflight.mutationGeneration === linearMutationGeneration &&
      (!options?.force || inflight.force)
    ) {
      return inflight.promise
    }

    let entry: InflightLinearDetailRequest<LinearProjectDetail | null>
    const requestCacheGeneration = linearCacheGeneration
    const requestMutationGeneration = linearMutationGeneration
    const promise = linearGetProject(scope.settings, id, workspaceId, {
      force: options?.force
    })
      .then((project) => {
        if (
          inflightProjectDetailRequests.get(cacheKey) === entry &&
          canWriteLinearReadResult(
            contextKey,
            requestCacheGeneration,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set((s) => ({
            linearProjectDetailCache: evictStaleEntries({
              ...s.linearProjectDetailCache,
              [cacheKey]: { data: project, fetchedAt: Date.now() }
            })
          }))
        }
        return project
      })
      .catch((error) => {
        console.warn('[linear] fetchLinearProject failed:', error)
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
          void get().checkLinearConnection(true)
        }
        if (options?.force) {
          throw error
        }
        const cachedResult = get().linearProjectDetailCache[cacheKey]
        if (cachedResult) {
          return cachedResult.data
        }
        throw error
      })
      .finally(() => {
        if (inflightProjectDetailRequests.get(cacheKey) === entry) {
          inflightProjectDetailRequests.delete(cacheKey)
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
      contextKey,
      mutationGeneration: requestMutationGeneration
    }
    inflightProjectDetailRequests.set(cacheKey, entry)
    return promise
  },
  }
}