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
export function createLinearSliceLinearStatusActions(set: SliceSet, get: SliceGet) {
  return {
  linearStatus: { connected: false, viewer: null },
  linearStatusChecked: false,
  linearStatusContextKey: null,
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
  linearListInvalidationToken: linearListInvalidationToken,
  checkLinearConnection: async (force = false) => {
    const contextKey = getProviderRuntimeContextKey(get().settings)
    if (inflightStatusRequest && !force && inflightStatusRequest.contextKey === contextKey) {
      return inflightStatusRequest.promise
    }
    if (get().linearStatusContextKey !== contextKey) {
      set({ linearStatusChecked: false })
    }

    const mutationGeneration = linearMutationGeneration
    const statusReadGeneration = (linearStatusReadGeneration += 1)
    const request = linearStatus(get().settings)
      .then((status) => {
        if (
          mutationGeneration !== linearMutationGeneration ||
          statusReadGeneration !== linearStatusReadGeneration ||
          !isCurrentLinearRuntimeContext(contextKey, get().settings)
        ) {
          return
        }
        const typedStatus = status as LinearConnectionStatus
        const prev = get().linearStatus
        const prevScopeSignature = linearStatusScopeSignature(prev)
        const nextScopeSignature = linearStatusScopeSignature(typedStatus)
        if (prevScopeSignature !== nextScopeSignature) {
          invalidateLinearCaches()
          set({
            linearStatus: typedStatus,
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
        } else if (!get().linearStatusChecked) {
          set({ linearStatusChecked: true, linearStatusContextKey: contextKey })
        } else if (get().linearStatusContextKey !== contextKey) {
          set({ linearStatusContextKey: contextKey })
        }
      })
      .catch(() => {
        if (
          mutationGeneration !== linearMutationGeneration ||
          statusReadGeneration !== linearStatusReadGeneration ||
          !isCurrentLinearRuntimeContext(contextKey, get().settings)
        ) {
          return
        }
        if (get().linearStatus.connected) {
          invalidateLinearCaches()
          set({
            linearStatus: { connected: false, viewer: null },
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
        } else if (!get().linearStatusChecked) {
          set({ linearStatusChecked: true, linearStatusContextKey: contextKey })
        } else if (get().linearStatusContextKey !== contextKey) {
          set({ linearStatusContextKey: contextKey })
        }
      })
      .finally(() => {
        if (
          statusReadGeneration === linearStatusReadGeneration &&
          inflightStatusRequest?.promise === request
        ) {
          inflightStatusRequest = null
        }
      })
    inflightStatusRequest = { contextKey, promise: request }

    return request
  },
  testLinearConnection: async (workspaceId) => {
    const requestGeneration = beginLinearMutation()
    const contextKey = getProviderRuntimeContextKey(get().settings)
    try {
      const result = (await linearTestConnection(get().settings, workspaceId)) as
        | { ok: true; viewer: LinearViewer }
        | { ok: false; error: string }
      if (
        !isCurrentLinearMutation(requestGeneration) ||
        !isCurrentLinearRuntimeContext(contextKey, get().settings)
      ) {
        return result
      }
      const status = await linearStatus(get().settings)
      if (
        isCurrentLinearMutation(requestGeneration) &&
        isCurrentLinearRuntimeContext(contextKey, get().settings)
      ) {
        const prev = get().linearStatus
        if (linearStatusScopeSignature(prev) !== linearStatusScopeSignature(status)) {
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
        } else {
          set({
            linearStatus: status,
            linearStatusChecked: true,
            linearStatusContextKey: contextKey
          })
        }
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Test failed'
      return { ok: false as const, error: message }
    }
  },
  connectLinear: async (apiKey: string) => {
    const requestGeneration = beginLinearMutation()
    const contextKey = getProviderRuntimeContextKey(get().settings)
    try {
      const result = await linearConnect(get().settings, apiKey)
      if (
        result.ok &&
        isCurrentLinearMutation(requestGeneration) &&
        isCurrentLinearRuntimeContext(contextKey, get().settings)
      ) {
        invalidateLinearCaches()
        set({
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
          linearCustomViewProjectCache: {}
        })
        const status = await linearStatus(get().settings)
        if (
          !isCurrentLinearMutation(requestGeneration) ||
          !isCurrentLinearRuntimeContext(contextKey, get().settings)
        ) {
          return {
            ok: false as const,
            error: translate(
              'auto.store.slices.linear.37d36984d0',
              'Linear connection was superseded by a newer request.'
            )
          }
        }
        set({
          linearStatus: status,
          linearStatusChecked: true,
          linearStatusContextKey: contextKey
        })
      } else if (result.ok) {
        return {
          ok: false as const,
          error: translate(
            'auto.store.slices.linear.37d36984d0',
            'Linear connection was superseded by a newer request.'
          )
        }
      }
      return result as { ok: true; viewer: LinearViewer } | { ok: false; error: string }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      return { ok: false as const, error: message }
    }
  },
  selectLinearWorkspace: async (workspaceId) => {
    const requestGeneration = beginLinearMutation()
    const contextKey = getProviderRuntimeContextKey(get().settings)
    const status = await linearSelectWorkspace(get().settings, workspaceId)
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
  disconnectLinear: async () => {
    const requestGeneration = beginLinearMutation()
    const contextKey = getProviderRuntimeContextKey(get().settings)
    await linearDisconnect(get().settings)
    if (
      !isCurrentLinearMutation(requestGeneration) ||
      !isCurrentLinearRuntimeContext(contextKey, get().settings)
    ) {
      return
    }
    invalidateLinearCaches()
    set({
      linearStatus: { connected: false, viewer: null },
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
  }
}