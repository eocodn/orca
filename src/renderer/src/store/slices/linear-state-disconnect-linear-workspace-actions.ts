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
export function createLinearSliceDisconnectLinearWorkspaceActions2(set: SliceSet, get: SliceGet) {
  return {
  disconnectLinearWorkspace: async (workspaceId) => {
    const requestGeneration = beginLinearMutation()
    const contextKey = getProviderRuntimeContextKey(get().settings)
    await linearDisconnectWorkspace(get().settings, workspaceId)
    if (
      !isCurrentLinearMutation(requestGeneration) ||
      !isCurrentLinearRuntimeContext(contextKey, get().settings)
    ) {
      return
    }
    const status = await linearStatus(get().settings)
    if (
      !isCurrentLinearMutation(requestGeneration) ||
      !isCurrentLinearRuntimeContext(contextKey, get().settings)
    ) {
      return
    }
    invalidateLinearCaches()
    set({
      linearStatus: status,
      linearIssueCache: {},
      linearSearchCache: {},
      linearListCache: {},
      linearTeamCache: {},
      linearProjectCache: {},
      linearProjectDetailCache: {},
      linearProjectIssueCache: {},
      linearCustomViewCache: {},
      linearCustomViewDetailCache: {},
      linearCustomViewIssueCache: {},
      linearCustomViewProjectCache: {},
      linearStatusChecked: true,
      linearStatusContextKey: contextKey
    })
  },
  fetchLinearIssue: async (
    id: string,
    workspaceId?: string | null,
    options?: LinearFetchOptions
  ) => {
    const scope = getLinearReadScope(get().settings, options?.sourceContext)
    const { contextKey } = scope
    const issueCacheKey = scopedLinearCacheKey(scope, `${workspaceId ?? 'selected'}::${id}`)
    const cached = get().linearIssueCache[issueCacheKey] ?? get().linearIssueCache[id]
    if (isFresh(cached)) {
      return cached.data
    }

    const inflight = inflightIssueRequests.get(issueCacheKey)
    if (
      inflight &&
      inflight.contextKey === contextKey &&
      inflight.mutationGeneration === linearMutationGeneration
    ) {
      return inflight.promise
    }

    let entry: InflightLinearIssueRequest
    const requestCacheGeneration = linearCacheGeneration
    const requestMutationGeneration = linearMutationGeneration
    const promise = linearGetIssue(scope.settings, id, workspaceId)
      .then((issue) => {
        const data = issue as LinearIssue | null
        if (
          inflightIssueRequests.get(issueCacheKey) === entry &&
          canWriteLinearReadResult(
            contextKey,
            requestCacheGeneration,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set((s) => ({
            linearIssueCache: evictStaleEntries({
              ...s.linearIssueCache,
              [issueCacheKey]: { data, fetchedAt: Date.now() }
            })
          }))
        }
        return data
      })
      .catch((error) => {
        console.warn('[linear] fetchLinearIssue failed:', error)
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
        return null
      })
      .finally(() => {
        if (inflightIssueRequests.get(issueCacheKey) === entry) {
          inflightIssueRequests.delete(issueCacheKey)
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
      generation: requestCacheGeneration,
      contextKey,
      mutationGeneration: requestMutationGeneration
    }
    inflightIssueRequests.set(issueCacheKey, entry)
    return promise
  },
  refreshLinearIssue: async (
    id: string,
    workspaceId?: string | null,
    options?: LinearFetchOptions
  ) => {
    const scope = getLinearReadScope(get().settings, options?.sourceContext)
    const issueCacheKey = scopedLinearCacheKey(scope, `${workspaceId ?? 'selected'}::${id}`)
    inflightIssueRequests.delete(issueCacheKey)
    clearLinearIssueCollectionRequestMaps()
    set((s) => {
      const nextIssueCache = { ...s.linearIssueCache }
      for (const [key, entry] of Object.entries(nextIssueCache)) {
        if (
          key === issueCacheKey ||
          key === id ||
          entry?.data?.id === id ||
          entry?.data?.identifier === id
        ) {
          delete nextIssueCache[key]
        }
      }
      return {
        linearIssueCache: nextIssueCache,
        linearSearchCache: {},
        linearListCache: {},
        linearProjectIssueCache: {},
        linearCustomViewIssueCache: {}
      }
    })
    return get().fetchLinearIssue(id, workspaceId, options)
  },
  getCachedLinearIssues: (args, options) => {
    const scope = getLinearReadScope(get().settings, options?.sourceContext)
    const workspaceId = getSelectedWorkspaceId(get().linearStatus)
    if (args.kind === 'search') {
      const cacheKey = scopedLinearCacheKey(
        scope,
        linearSearchCacheKey(workspaceId, args.query, args.limit ?? 20)
      )
      return get().linearSearchCache[cacheKey]?.data ?? null
    }
    const limit = clampLinearIssueListLimit(args.limit)
    const attributeFilter = normalizeListAttributeFilter(args.attributeFilter)
    const cacheKey = scopedLinearCacheKey(
      scope,
      linearListCacheKey(workspaceId, args.filter ?? 'assigned', limit, attributeFilter)
    )
    return get().linearListCache[cacheKey]?.data ?? null
  },
  prefetchLinearIssues: (args, options) => {
    const scope = getLinearReadScope(get().settings, options?.sourceContext)
    const { contextKey } = scope
    const workspaceId = getSelectedWorkspaceId(get().linearStatus)
    if (args.kind === 'search') {
      const limit = args.limit ?? 20
      const cacheKey = scopedLinearCacheKey(
        scope,
        linearSearchCacheKey(workspaceId, args.query, limit)
      )
      const inflight = inflightSearchRequests.get(cacheKey)
      if (
        isFresh(get().linearSearchCache[cacheKey]) ||
        (inflight &&
          inflight.contextKey === contextKey &&
          inflight.mutationGeneration === linearMutationGeneration)
      ) {
        return
      }
      void get()
        .searchLinearIssues(args.query, limit, options)
        .catch(() => {})
      return
    }
    const limit = clampLinearIssueListLimit(args.limit)
    const attributeFilter = normalizeListAttributeFilter(args.attributeFilter)
    const listArgs: LinearIssueListReadArgs = {
      kind: 'list',
      filter: args.filter,
      limit,
      attributeFilter
    }
    const cacheKey = scopedLinearCacheKey(
      scope,
      linearListCacheKey(workspaceId, args.filter ?? 'assigned', limit, attributeFilter)
    )
    const inflight = inflightListRequests.get(cacheKey)
    if (
      isFresh(get().linearListCache[cacheKey]) ||
      (inflight &&
        inflight.contextKey === contextKey &&
        inflight.mutationGeneration === linearMutationGeneration)
    ) {
      return
    }
    void get()
      .listLinearIssues(listArgs, options)
      .catch(() => {})
  },
  }
}