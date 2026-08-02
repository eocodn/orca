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
export function createLinearSliceListLinearProjectIssuesActions5(set: SliceSet, get: SliceGet) {
  return {
  listLinearProjectIssues: async (projectId, workspaceId, limit = 20, options) => {
    const scope = getLinearReadScope(get().settings, options?.sourceContext)
    const { contextKey } = scope
    const effectiveLimit = clampLinearIssueListLimit(limit)
    const cacheKey = scopedLinearCacheKey(
      scope,
      linearCollectionCacheKey(workspaceId, 'project-issues', projectId, effectiveLimit)
    )
    const cached = get().linearProjectIssueCache[cacheKey]
    if (!options?.force && isFresh(cached)) {
      return cached.data ?? emptyLinearCollection<LinearIssue>()
    }

    const inflight = inflightProjectIssueRequests.get(cacheKey)
    if (
      inflight &&
      inflight.contextKey === contextKey &&
      inflight.mutationGeneration === linearMutationGeneration &&
      (!options?.force || inflight.force)
    ) {
      return inflight.promise
    }

    let entry: InflightLinearCollectionRequest<LinearIssue>
    const requestCacheGeneration = linearCacheGeneration
    const requestMutationGeneration = linearMutationGeneration
    const promise = linearListProjectIssues(
      scope.settings,
      projectId,
      effectiveLimit,
      workspaceId,
      {
        force: options?.force
      }
    )
      .then((result) => {
        if (
          inflightProjectIssueRequests.get(cacheKey) === entry &&
          canWriteLinearReadResult(
            contextKey,
            requestCacheGeneration,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set((s) => ({
            linearProjectIssueCache: evictStaleEntries({
              ...s.linearProjectIssueCache,
              [cacheKey]: { data: result, fetchedAt: Date.now() }
            })
          }))
        }
        return result
      })
      .catch((error) => {
        console.warn('[linear] listLinearProjectIssues failed:', error)
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
          get().linearProjectIssueCache[cacheKey]?.data ??
          largestCachedCollectionBelowLimit(
            get().linearProjectIssueCache,
            workspaceId,
            'project-issues',
            projectId,
            effectiveLimit
          ) ??
          emptyLinearCollection<LinearIssue>()
        return collectionWithWorkspaceError(fallback, workspaceId, error)
      })
      .finally(() => {
        if (inflightProjectIssueRequests.get(cacheKey) === entry) {
          inflightProjectIssueRequests.delete(cacheKey)
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
    inflightProjectIssueRequests.set(cacheKey, entry)
    return promise
  },
  getCachedLinearCustomViews: (model, limit = 20, workspaceId, options) => {
    const scope = getLinearReadScope(get().settings, options?.sourceContext)
    const resolvedWorkspaceId = workspaceId ?? getSelectedWorkspaceId(get().linearStatus)
    const cacheKey = linearCollectionCacheKey(resolvedWorkspaceId, 'custom-views', model, limit)
    return get().linearCustomViewCache[scopedLinearCacheKey(scope, cacheKey)]?.data ?? null
  },
  listLinearCustomViews: async (model, limit = 20, workspaceId, options) => {
    const scope = getLinearReadScope(get().settings, options?.sourceContext)
    const { contextKey } = scope
    const resolvedWorkspaceId = workspaceId ?? getSelectedWorkspaceId(get().linearStatus)
    const cacheKey = scopedLinearCacheKey(
      scope,
      linearCollectionCacheKey(resolvedWorkspaceId, 'custom-views', model, limit)
    )
    const cached = get().linearCustomViewCache[cacheKey]
    if (!options?.force && isFresh(cached)) {
      return cached.data ?? emptyLinearCollection<LinearCustomViewSummary>()
    }

    const inflight = inflightCustomViewRequests.get(cacheKey)
    if (
      inflight &&
      inflight.contextKey === contextKey &&
      inflight.mutationGeneration === linearMutationGeneration &&
      (!options?.force || inflight.force)
    ) {
      return inflight.promise
    }

    let entry: InflightLinearCollectionRequest<LinearCustomViewSummary>
    const requestCacheGeneration = linearCacheGeneration
    const requestMutationGeneration = linearMutationGeneration
    const promise = linearListCustomViews(scope.settings, model, limit, resolvedWorkspaceId, {
      force: options?.force
    })
      .then((result) => {
        if (
          inflightCustomViewRequests.get(cacheKey) === entry &&
          canWriteLinearReadResult(
            contextKey,
            requestCacheGeneration,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set((s) => ({
            linearCustomViewCache: evictStaleEntries({
              ...s.linearCustomViewCache,
              [cacheKey]: { data: result, fetchedAt: Date.now() }
            })
          }))
        }
        return result
      })
      .catch((error) => {
        console.warn('[linear] listLinearCustomViews failed:', error)
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
          get().linearCustomViewCache[cacheKey]?.data ??
          emptyLinearCollection<LinearCustomViewSummary>()
        return collectionWithWorkspaceError(fallback, resolvedWorkspaceId ?? 'default', error)
      })
      .finally(() => {
        if (inflightCustomViewRequests.get(cacheKey) === entry) {
          inflightCustomViewRequests.delete(cacheKey)
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
    inflightCustomViewRequests.set(cacheKey, entry)
    return promise
  },
  }
}