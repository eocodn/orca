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
import { CACHE_TTL, TEAM_CACHE_TTL, MAX_CACHE_ENTRIES, isFresh, evictStaleEntries, looksLikeAuthError, workspaceErrorType, workspaceErrorMessage, inflightIssueRequests, inflightSearchRequests, inflightListRequests, inflightTeamRequests, inflightProjectRequests, inflightProjectDetailRequests, inflightProjectIssueRequests, inflightCustomViewRequests, inflightCustomViewDetailRequests, inflightCustomViewIssueRequests, inflightCustomViewProjectRequests, getSelectedWorkspaceId, linearSearchCacheKey, linearListCacheKey, LINEAR_LIST_INVALIDATION_VERSION_CAP, linearTeamsCacheKey, linearWorkspaceSignature, linearStatusScopeSignature, clearLinearRequestMaps, invalidateLinearCaches, clearLinearIssueCollectionRequestMaps, shouldRefreshStatusAfterRead, linearCollectionCacheKey, emptyLinearCollection, collectionWithWorkspaceError, largestCachedCollectionBelowLimit, patchLinearIssueCollectionCache } from './linear-state'
import type { InflightLinearIssueRequest, InflightLinearListRequest, InflightLinearPlainListRequest, InflightLinearCollectionRequest, InflightLinearDetailRequest, InflightLinearTeamRequest, LinearIssueListReadArgs } from './linear-state'
export type LinearIssueReadArgs =
  | { kind: 'search'; query: string; limit?: number }
  | LinearIssueListReadArgs
export type LinearFetchOptions = { force?: boolean; sourceContext?: TaskSourceContext | null }
export type LinearPatchOptions = { sourceContext?: TaskSourceContext | null }
export function normalizeListAttributeFilter(
  attributeFilter?: LinearIssueAttributeFilter | null
): LinearIssueAttributeFilter | undefined {
  if (!attributeFilter || isEmptyLinearIssueAttributeFilter(attributeFilter)) {
    return undefined
  }
  return canonicalizeLinearIssueAttributeFilter(attributeFilter)
}
export type LinearReadScope = {
  settings: AppState['settings'] | TaskSourceContext | null
  contextKey: string
  cachePrefix: string | null
  explicitSource: boolean
}
export function beginLinearMutation(): number {
  linearMutationGeneration += 1
  inflightStatusRequest = null
  return linearMutationGeneration
}
export function isCurrentLinearMutation(generation: number): boolean {
  return generation === linearMutationGeneration
}
export function isCurrentLinearRuntimeContext(
  contextKey: string,
  settings: AppState['settings']
): boolean {
  return getProviderRuntimeContextKey(settings) === contextKey
}
export function canWriteLinearReadResult(
  contextKey: string,
  generation: number,
  mutationGeneration: number,
  settings: AppState['settings'],
  explicitSource = false
): boolean {
  return (
    generation === linearCacheGeneration &&
    mutationGeneration === linearMutationGeneration &&
    (explicitSource || isCurrentLinearRuntimeContext(contextKey, settings))
  )
}
export function getLinearReadScope(
  settings: AppState['settings'],
  sourceContext?: TaskSourceContext | null
): LinearReadScope {
  if (!sourceContext) {
    return {
      settings,
      contextKey: getProviderRuntimeContextKey(settings),
      cachePrefix: null,
      explicitSource: false
    }
  }
  const runtimeSettings = getTaskSourceRuntimeSettings(sourceContext)
  return {
    settings: sourceContext,
    contextKey: `${getProviderRuntimeContextKey(runtimeSettings)}::${getTaskSourceCacheScope(sourceContext)}`,
    cachePrefix: getTaskSourceCacheScope(sourceContext),
    explicitSource: true
  }
}
export function scopedLinearCacheKey(scope: LinearReadScope, key: string): string {
  return scope.cachePrefix ? `${scope.cachePrefix}::${key}` : key
}
export type LinearSlice = {
  linearStatus: LinearConnectionStatus
  linearStatusChecked: boolean
  linearStatusContextKey: string | null
  linearIssueCache: Record<string, CacheEntry<LinearIssue>>
  linearSearchCache: Record<string, CacheEntry<LinearIssue[]>>
  linearListCache: Record<string, CacheEntry<LinearCollectionResult<LinearIssue>>>
  linearTeamCache: Record<string, CacheEntry<LinearTeam[]>>
  linearProjectCache: Record<string, CacheEntry<LinearCollectionResult<LinearProjectSummary>>>
  linearProjectDetailCache: Record<string, CacheEntry<LinearProjectDetail | null>>
  linearProjectIssueCache: Record<string, CacheEntry<LinearCollectionResult<LinearIssue>>>
  linearCustomViewCache: Record<string, CacheEntry<LinearCollectionResult<LinearCustomViewSummary>>>
  linearCustomViewDetailCache: Record<string, CacheEntry<LinearCustomViewSummary | null>>
  linearCustomViewIssueCache: Record<string, CacheEntry<LinearCollectionResult<LinearIssue>>>
  linearCustomViewProjectCache: Record<
    string,
    CacheEntry<LinearCollectionResult<LinearProjectSummary>>
  >

  checkLinearConnection: (force?: boolean) => Promise<void>
  connectLinear: (
    apiKey: string
  ) => Promise<{ ok: true; viewer: LinearViewer } | { ok: false; error: string }>
  testLinearConnection: (
    workspaceId?: string | null
  ) => Promise<{ ok: true; viewer: LinearViewer } | { ok: false; error: string }>
  selectLinearWorkspace: (workspaceId: LinearWorkspaceSelection) => Promise<void>
  disconnectLinear: () => Promise<void>
  disconnectLinearWorkspace: (workspaceId: string) => Promise<void>
  fetchLinearIssue: (
    id: string,
    workspaceId?: string | null,
    options?: LinearFetchOptions
  ) => Promise<LinearIssue | null>
  refreshLinearIssue: (
    id: string,
    workspaceId?: string | null,
    options?: LinearFetchOptions
  ) => Promise<LinearIssue | null>
  getCachedLinearIssues: (
    args: LinearIssueReadArgs,
    options?: Pick<LinearFetchOptions, 'sourceContext'>
  ) => LinearIssue[] | LinearCollectionResult<LinearIssue> | null
  prefetchLinearIssues: (args: LinearIssueReadArgs, options?: LinearFetchOptions) => void
  searchLinearIssues: (
    query: string,
    limit?: number,
    options?: LinearFetchOptions
  ) => Promise<LinearIssue[]>
  listLinearIssues: (
    args: LinearIssueListReadArgs,
    options?: LinearFetchOptions
  ) => Promise<LinearCollectionResult<LinearIssue>>
  linearListInvalidationToken: { scope: string; version: number }
  invalidateLinearIssueLists: (options?: Pick<LinearFetchOptions, 'sourceContext'>) => void
  getCachedLinearTeams: (
    workspaceId?: LinearWorkspaceSelection | null,
    options?: Pick<LinearFetchOptions, 'sourceContext'>
  ) => LinearTeam[] | null
  listLinearTeams: (
    workspaceId?: LinearWorkspaceSelection | null,
    options?: LinearFetchOptions
  ) => Promise<LinearTeam[]>
  getCachedLinearProjects: (
    query?: string,
    limit?: number,
    workspaceId?: LinearWorkspaceSelection | null,
    options?: Pick<LinearFetchOptions, 'sourceContext'>
  ) => LinearCollectionResult<LinearProjectSummary> | null
  listLinearProjects: (
    query?: string,
    limit?: number,
    workspaceId?: LinearWorkspaceSelection | null,
    options?: LinearFetchOptions
  ) => Promise<LinearCollectionResult<LinearProjectSummary>>
  fetchLinearProject: (
    id: string,
    workspaceId: string,
    options?: LinearFetchOptions
  ) => Promise<LinearProjectDetail | null>
  listLinearProjectIssues: (
    projectId: string,
    workspaceId: string,
    limit?: number,
    options?: LinearFetchOptions
  ) => Promise<LinearCollectionResult<LinearIssue>>
  getCachedLinearCustomViews: (
    model: LinearCustomViewModel,
    limit?: number,
    workspaceId?: LinearWorkspaceSelection | null,
    options?: Pick<LinearFetchOptions, 'sourceContext'>
  ) => LinearCollectionResult<LinearCustomViewSummary> | null
  listLinearCustomViews: (
    model: LinearCustomViewModel,
    limit?: number,
    workspaceId?: LinearWorkspaceSelection | null,
    options?: LinearFetchOptions
  ) => Promise<LinearCollectionResult<LinearCustomViewSummary>>
  fetchLinearCustomView: (
    viewId: string,
    workspaceId: string,
    model: LinearCustomViewModel,
    options?: LinearFetchOptions
  ) => Promise<LinearCustomViewSummary | null>
  listLinearCustomViewIssues: (
    viewId: string,
    workspaceId: string,
    limit?: number,
    options?: LinearFetchOptions
  ) => Promise<LinearCollectionResult<LinearIssue>>
  listLinearCustomViewProjects: (
    viewId: string,
    workspaceId: string,
    limit?: number,
    options?: LinearFetchOptions
  ) => Promise<LinearCollectionResult<LinearProjectSummary>>
  patchLinearIssue: (
    issueId: string,
    patch: Partial<LinearIssue>,
    options?: LinearPatchOptions
  ) => void
}
