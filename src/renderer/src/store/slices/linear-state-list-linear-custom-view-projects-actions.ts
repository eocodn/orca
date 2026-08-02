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
export function createLinearSliceListLinearCustomViewProjectsActions7(set: SliceSet, get: SliceGet) {
  return {
  listLinearCustomViewProjects: async (viewId, workspaceId, limit = 20, options) => {
    const scope = getLinearReadScope(get().settings, options?.sourceContext)
    const { contextKey } = scope
    const cacheKey = scopedLinearCacheKey(
      scope,
      linearCollectionCacheKey(workspaceId, 'custom-view-projects', viewId, limit)
    )
    const cached = get().linearCustomViewProjectCache[cacheKey]
    if (!options?.force && isFresh(cached)) {
      return cached.data ?? emptyLinearCollection<LinearProjectSummary>()
    }

    const inflight = inflightCustomViewProjectRequests.get(cacheKey)
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
    const promise = linearListCustomViewProjects(scope.settings, viewId, limit, workspaceId, {
      force: options?.force
    })
      .then((result) => {
        if (
          inflightCustomViewProjectRequests.get(cacheKey) === entry &&
          canWriteLinearReadResult(
            contextKey,
            requestCacheGeneration,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set((s) => ({
            linearCustomViewProjectCache: evictStaleEntries({
              ...s.linearCustomViewProjectCache,
              [cacheKey]: { data: result, fetchedAt: Date.now() }
            })
          }))
        }
        return result
      })
      .catch((error) => {
        console.warn('[linear] listLinearCustomViewProjects failed:', error)
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
          get().linearCustomViewProjectCache[cacheKey]?.data ??
          emptyLinearCollection<LinearProjectSummary>()
        return collectionWithWorkspaceError(fallback, workspaceId, error)
      })
      .finally(() => {
        if (inflightCustomViewProjectRequests.get(cacheKey) === entry) {
          inflightCustomViewProjectRequests.delete(cacheKey)
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
    inflightCustomViewProjectRequests.set(cacheKey, entry)
    return promise
  },
  invalidateLinearIssueLists: (options) => {
    const scope = getLinearReadScope(get().settings, options?.sourceContext)
    const tokenScope = scope.cachePrefix ?? 'local'
    const nextVersion =
      linearListInvalidationToken.scope === tokenScope
        ? (linearListInvalidationToken.version + 1) % LINEAR_LIST_INVALIDATION_VERSION_CAP || 1
        : 1
    linearListInvalidationToken = { scope: tokenScope, version: nextVersion }

    // Why: drop only attribute-filtered plain list entries in this source scope
    // so the next TaskPage read is forced current without wiping search/unrelated
    // collections.
    set((s) => {
      const nextListCache = { ...s.linearListCache }
      let changed = false
      for (const key of Object.keys(nextListCache)) {
        const parts = key.split('::')
        // Cache keys end with the attribute signature; unfiltered entries end empty.
        const attributeSignature = parts.at(-1) ?? ''
        if (!attributeSignature) {
          continue
        }
        if (scope.cachePrefix) {
          if (!key.startsWith(`${scope.cachePrefix}::`)) {
            continue
          }
        } else if (parts[1] !== 'list') {
          // Why: unscoped invalidation must not touch other runtimes' scoped list keys.
          continue
        }
        delete nextListCache[key]
        inflightListRequests.delete(key)
        changed = true
      }
      if (!changed) {
        return { linearListInvalidationToken: linearListInvalidationToken }
      }
      return {
        linearListCache: nextListCache,
        linearListInvalidationToken: linearListInvalidationToken
      }
    })
  },
  patchLinearIssue: (issueId, patch, options) => {
    const sourceScope =
      options?.sourceContext?.provider === 'linear'
        ? getTaskSourceCacheScope(options.sourceContext)
        : null
    const canPatchCacheKey = (key: string): boolean =>
      sourceScope === null || key.startsWith(`${sourceScope}::`)
    set((s) => {
      let changed = false

      const nextIssueCache = { ...s.linearIssueCache }
      for (const [key, issueEntry] of Object.entries(nextIssueCache)) {
        if (!canPatchCacheKey(key) || issueEntry?.data?.id !== issueId) {
          continue
        }
        // Why: set fetchedAt to 0 so the next fetchLinearIssue call
        // actually hits IPC instead of returning the stale optimistic data.
        nextIssueCache[key] = {
          ...issueEntry,
          data: { ...issueEntry.data, ...patch },
          fetchedAt: 0
        }
        changed = true
      }

      const nextSearchCache = { ...s.linearSearchCache }
      for (const key of Object.keys(nextSearchCache)) {
        const entry = nextSearchCache[key]
        if (!canPatchCacheKey(key) || !entry?.data) {
          continue
        }
        const idx = entry.data.findIndex((item) => item.id === issueId)
        if (idx === -1) {
          continue
        }
        const updatedItems = [...entry.data]
        updatedItems[idx] = { ...updatedItems[idx], ...patch }
        nextSearchCache[key] = { ...entry, data: updatedItems }
        changed = true
      }

      const nextListCache = patchLinearIssueCollectionCache(
        s.linearListCache,
        issueId,
        patch,
        canPatchCacheKey
      )
      if (nextListCache.changed) {
        changed = true
      }

      const nextProjectIssueCache = patchLinearIssueCollectionCache(
        s.linearProjectIssueCache,
        issueId,
        patch,
        canPatchCacheKey
      )
      if (nextProjectIssueCache.changed) {
        changed = true
      }

      const nextCustomViewIssueCache = patchLinearIssueCollectionCache(
        s.linearCustomViewIssueCache,
        issueId,
        patch,
        canPatchCacheKey
      )
      if (nextCustomViewIssueCache.changed) {
        changed = true
      }

      return changed
        ? {
            linearIssueCache: nextIssueCache,
            linearSearchCache: nextSearchCache,
            linearListCache: nextListCache.changed ? nextListCache.cache : s.linearListCache,
            linearProjectIssueCache: nextProjectIssueCache.changed
              ? nextProjectIssueCache.cache
              : s.linearProjectIssueCache,
            linearCustomViewIssueCache: nextCustomViewIssueCache.changed
              ? nextCustomViewIssueCache.cache
              : s.linearCustomViewIssueCache
          }
        : {}
    })
  }
  }
}