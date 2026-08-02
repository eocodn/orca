   caches, and optimistic patch propagation as one store boundary so active
   site changes invalidate every related query coherently. */
import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type {
  JiraAuthType,
  JiraConnectionStatus,
  JiraIssue,
  JiraIssueFilter,
  JiraSiteSelection,
  JiraViewer
} from '../../../../shared/types'
import type { CacheEntry } from './github'
import { isIntegrationCredentialDecryptionError } from '../../../../shared/integration-credential-errors'
import {
  jiraConnect,
  jiraDisconnect,
  jiraGetIssue,
  jiraLookupIssueSummary,
  jiraListIssues,
  jiraReadStatus,
  jiraSearchIssues,
  jiraSelectSite,
  jiraStatus,
  jiraTestConnection
} from '@/runtime/runtime-jira-client'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { translate } from '@/i18n/i18n'
import {
  getTaskSourceCacheScope,
  getTaskSourceRuntimeSettings,
  type TaskSourceContext
} from '../../../../shared/task-source-context'
import { CACHE_TTL, MAX_CACHE_ENTRIES, isFresh, evictStaleEntries, looksLikeAuthError, createJiraAbortError, subscribeToJiraSummaryRequest, inflightIssueRequests, inflightIssueSummaryRequests, inflightSearchRequests, inflightListRequests, getSelectedSiteId, shouldRefreshStatusAfterRead, clearJiraInflight, beginJiraMutation, isCurrentJiraMutation, isCurrentJiraRuntimeContext, canWriteJiraReadResult, getJiraReadScope, scopedJiraCacheKey, getJiraConnectionRevisionContextKey, nextJiraConnectionRevisions, EMPTY_JIRA_READ_CACHES, markJiraConnectionLost, jiraStatusUpdate } from './jira-state'
import type { InflightJiraReadRequest, SharedJiraSummaryRequest, JiraReadOptions, JiraSearchOptions, JiraPatchOptions, JiraIssueSummaryLookupOptions, JiraReadScope, JiraSlice } from './jira-state'
type SliceSet = Parameters<StateCreator<AppState>>[0]
type SliceGet = Parameters<StateCreator<AppState>>[1]
export function createJiraSlicejiraStatusActions(set: SliceSet, get: SliceGet) {
  return {
  jiraStatus: { connected: false, viewer: null },
  jiraStatusChecked: false,
  jiraStatusContextKey: null,
  jiraConnectionRevisions: {},
  jiraIssueCache: {},
  jiraIssueSummaryCache: {},
  jiraSearchCache: {},
  checkJiraConnection: async () => {
    const contextKey = getProviderRuntimeContextKey(get().settings)
    const statusReadGeneration = (jiraStatusReadGeneration += 1)
    const mutationGeneration = jiraMutationGeneration
    if (get().jiraStatusContextKey !== contextKey) {
      set({ jiraStatusChecked: false })
    }
    try {
      const status = await jiraStatus(get().settings)
      if (
        mutationGeneration !== jiraMutationGeneration ||
        statusReadGeneration !== jiraStatusReadGeneration ||
        getProviderRuntimeContextKey(get().settings) !== contextKey
      ) {
        return
      }
      const prev = get().jiraStatus
      if (
        prev.connected !== status.connected ||
        prev.credentialError !== status.credentialError ||
        prev.viewer?.email !== status.viewer?.email ||
        getSelectedSiteId(prev) !== getSelectedSiteId(status) ||
        (prev.sites?.length ?? 0) !== (status.sites?.length ?? 0)
      ) {
        set((state) => jiraStatusUpdate(state, contextKey, status))
      } else if (!get().jiraStatusChecked) {
        set({ jiraStatusChecked: true, jiraStatusContextKey: contextKey })
      } else if (get().jiraStatusContextKey !== contextKey) {
        set({ jiraStatusContextKey: contextKey })
      }
    } catch {
      if (
        mutationGeneration !== jiraMutationGeneration ||
        statusReadGeneration !== jiraStatusReadGeneration ||
        getProviderRuntimeContextKey(get().settings) !== contextKey
      ) {
        return
      }
      if (get().jiraStatus.connected) {
        set((state) => jiraStatusUpdate(state, contextKey, { connected: false, viewer: null }))
      } else if (!get().jiraStatusChecked) {
        set({ jiraStatusChecked: true, jiraStatusContextKey: contextKey })
      } else if (get().jiraStatusContextKey !== contextKey) {
        set({ jiraStatusContextKey: contextKey })
      }
    }
  },
  readJiraStatus: async (sourceContext) => jiraReadStatus(sourceContext),
  lookupJiraIssueSummary: async (sourceContext, key, siteId, options) => {
    const scope = getJiraReadScope(get().settings, sourceContext)
    const cacheKey = scopedJiraCacheKey(scope, `${siteId}::${key.toUpperCase()}`)
    const cached = get().jiraIssueSummaryCache[cacheKey]
    if (!options?.force && isFresh(cached)) {
      return cached.data
    }
    if (options?.force && cached) {
      set((state) => {
        const jiraIssueSummaryCache = { ...state.jiraIssueSummaryCache }
        delete jiraIssueSummaryCache[cacheKey]
        return { jiraIssueSummaryCache }
      })
    }
    const inflight = inflightIssueSummaryRequests.get(cacheKey)
    if (!options?.force && inflight?.contextKey === scope.contextKey) {
      return subscribeToJiraSummaryRequest(inflight, options?.signal)
    }
    if (options?.signal?.aborted) {
      throw createJiraAbortError('issue summary lookup')
    }
    let entry: SharedJiraSummaryRequest
    const controller = new AbortController()
    const promise = jiraLookupIssueSummary(scope.settings, key, siteId, controller.signal)
      .then((issue) => {
        if (
          issue &&
          issue.key.toUpperCase() === key.toUpperCase() &&
          issue.siteId === siteId &&
          inflightIssueSummaryRequests.get(cacheKey) === entry
        ) {
          set((state) => ({
            jiraIssueSummaryCache: evictStaleEntries({
              ...state.jiraIssueSummaryCache,
              [cacheKey]: { data: issue, fetchedAt: Date.now() }
            })
          }))
        }
        return issue
      })
      .finally(() => {
        if (inflightIssueSummaryRequests.get(cacheKey) === entry) {
          inflightIssueSummaryRequests.delete(cacheKey)
        }
      })
    entry = {
      promise,
      controller,
      subscribers: 0,
      contextKey: scope.contextKey,
      mutationGeneration: jiraMutationGeneration
    }
    inflightIssueSummaryRequests.set(cacheKey, entry)
    return subscribeToJiraSummaryRequest(entry, options?.signal)
  },
  connectJira: async (args) => {
    const requestGeneration = beginJiraMutation()
    const contextKey = getProviderRuntimeContextKey(get().settings)
    try {
      const result = await jiraConnect(get().settings, args)
      if (
        result.ok &&
        isCurrentJiraMutation(requestGeneration) &&
        isCurrentJiraRuntimeContext(contextKey, get().settings)
      ) {
        set((state) =>
          jiraStatusUpdate(state, contextKey, { connected: true, viewer: result.viewer })
        )
        void get().checkJiraConnection()
      } else if (result.ok) {
        return {
          ok: false as const,
          error: translate(
            'auto.store.slices.jira.856083302c',
            'Jira connection was superseded by a newer request.'
          )
        }
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      return { ok: false as const, error: message }
    }
  },
  testJiraConnection: async (siteId) => {
    const requestGeneration = beginJiraMutation()
    const contextKey = getProviderRuntimeContextKey(get().settings)
    try {
      const result = await jiraTestConnection(get().settings, siteId)
      if (
        !isCurrentJiraMutation(requestGeneration) ||
        !isCurrentJiraRuntimeContext(contextKey, get().settings)
      ) {
        return result
      }
      const status = await jiraStatus(get().settings)
      if (
        isCurrentJiraMutation(requestGeneration) &&
        isCurrentJiraRuntimeContext(contextKey, get().settings)
      ) {
        set((state) => jiraStatusUpdate(state, contextKey, status))
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Test failed'
      return { ok: false as const, error: message }
    }
  },
  selectJiraSite: async (siteId) => {
    const requestGeneration = beginJiraMutation()
    const contextKey = getProviderRuntimeContextKey(get().settings)
    const status = await jiraSelectSite(get().settings, siteId)
    if (
      !isCurrentJiraMutation(requestGeneration) ||
      getProviderRuntimeContextKey(get().settings) !== contextKey
    ) {
      return
    }
    clearJiraInflight()
    set((state) => jiraStatusUpdate(state, contextKey, status, EMPTY_JIRA_READ_CACHES))
  },
  disconnectJira: async (siteId) => {
    const requestGeneration = beginJiraMutation()
    const contextKey = getProviderRuntimeContextKey(get().settings)
    await jiraDisconnect(get().settings, siteId)
    if (
      !isCurrentJiraMutation(requestGeneration) ||
      !isCurrentJiraRuntimeContext(contextKey, get().settings)
    ) {
      return
    }
    clearJiraInflight()
    const status = await jiraStatus(get().settings)
    if (
      !isCurrentJiraMutation(requestGeneration) ||
      !isCurrentJiraRuntimeContext(contextKey, get().settings)
    ) {
      return
    }
    set((state) =>
      jiraStatusUpdate(
        state,
        contextKey,
        status.connected ? status : { connected: false, viewer: null },
        EMPTY_JIRA_READ_CACHES
      )
    )
  },
  fetchJiraIssue: async (key, siteId, options) => {
    const scope = getJiraReadScope(get().settings, options?.sourceContext)
    const { contextKey } = scope
    const issueCacheKey = scopedJiraCacheKey(scope, `${siteId ?? 'selected'}::${key}`)
    const cached = get().jiraIssueCache[issueCacheKey] ?? get().jiraIssueCache[key]
    if (isFresh(cached)) {
      return cached.data
    }
    const inflight = inflightIssueRequests.get(issueCacheKey)
    if (
      inflight &&
      inflight.contextKey === contextKey &&
      inflight.mutationGeneration === jiraMutationGeneration
    ) {
      return inflight.promise
    }
    let entry: InflightJiraReadRequest<JiraIssue | null>
    const requestMutationGeneration = jiraMutationGeneration
    const promise = jiraGetIssue(scope.settings, key, siteId)
      .then((issue) => {
        if (
          inflightIssueRequests.get(issueCacheKey) === entry &&
          canWriteJiraReadResult(
            contextKey,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set((s) => ({
            jiraIssueCache: evictStaleEntries({
              ...s.jiraIssueCache,
              [issueCacheKey]: { data: issue, fetchedAt: Date.now() }
            })
          }))
        }
        return issue
      })
      .catch((error) => {
        console.warn('[jira] fetchJiraIssue failed:', error)
        if (
          isIntegrationCredentialDecryptionError(error) &&
          canWriteJiraReadResult(
            contextKey,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          if (!shouldRefreshStatusAfterRead(siteId, get().jiraStatus)) {
            void get().checkJiraConnection()
          }
        } else if (
          looksLikeAuthError(error) &&
          canWriteJiraReadResult(
            contextKey,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          markJiraConnectionLost(set, scope)
        }
        return null
      })
      .finally(() => {
        if (inflightIssueRequests.get(issueCacheKey) === entry) {
          inflightIssueRequests.delete(issueCacheKey)
        }
        if (
          shouldRefreshStatusAfterRead(siteId, get().jiraStatus) &&
          canWriteJiraReadResult(
            contextKey,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          void get().checkJiraConnection()
        }
      })
    entry = { promise, contextKey, mutationGeneration: requestMutationGeneration }
    inflightIssueRequests.set(issueCacheKey, entry)
    return promise
  },
  }
}
