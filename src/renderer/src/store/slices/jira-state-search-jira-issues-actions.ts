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
export function createJiraSlicesearchJiraIssuesActions2(set: SliceSet, get: SliceGet) {
  return {
  searchJiraIssues: async (jql, limit = 30, options) => {
    const scope = getJiraReadScope(get().settings, options?.sourceContext)
    const { contextKey } = scope
    const siteId =
      options && 'siteId' in options ? options.siteId : getSelectedSiteId(get().jiraStatus)
    const cacheKey = scopedJiraCacheKey(scope, `${siteId ?? 'default'}::${jql}::${limit}`)
    const cached = get().jiraSearchCache[cacheKey]
    if (isFresh(cached)) {
      return cached.data ?? []
    }
    const inflight = inflightSearchRequests.get(cacheKey)
    // Why: an abortable search must not be shared — one caller's cleanup would cancel the other's.
    if (
      !options?.signal &&
      inflight &&
      inflight.contextKey === contextKey &&
      inflight.mutationGeneration === jiraMutationGeneration
    ) {
      return inflight.promise
    }
    let entry: InflightJiraReadRequest<JiraIssue[]>
    const abortable = options?.signal !== undefined
    const requestMutationGeneration = jiraMutationGeneration
    const promise = jiraSearchIssues(scope.settings, jql, limit, siteId, options?.signal)
      .then((issues) => {
        if (options?.signal?.aborted) {
          // Late success after cancel must not warm the cache for a superseded query.
          throw createJiraAbortError('search')
        }
        if (
          (abortable || inflightSearchRequests.get(cacheKey) === entry) &&
          canWriteJiraReadResult(
            contextKey,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set((s) => ({
            jiraSearchCache: evictStaleEntries({
              ...s.jiraSearchCache,
              [cacheKey]: { data: issues, fetchedAt: Date.now() }
            })
          }))
        }
        return issues
      })
      .catch((error) => {
        if (options?.signal?.aborted) {
          // Superseded by a newer query: not a connection problem, so leave status untouched.
          throw error
        }
        console.warn('[jira] searchJiraIssues failed:', error)
        if (
          isIntegrationCredentialDecryptionError(error) &&
          canWriteJiraReadResult(
            contextKey,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          if (!shouldRefreshStatusAfterRead(siteId, get().jiraStatus, { abortable })) {
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
        // Credential/auth failures are surfaced through connection state, so they
        // keep the empty-list contract. Other failures (forbidden, bad JQL,
        // network, 5xx) reject so the Tasks panel can show a real error instead
        // of a misleading "No issues found".
        if (isIntegrationCredentialDecryptionError(error) || looksLikeAuthError(error)) {
          return []
        }
        throw error
      })
      .finally(() => {
        if (inflightSearchRequests.get(cacheKey) === entry) {
          inflightSearchRequests.delete(cacheKey)
        }
        if (
          !options?.signal?.aborted &&
          shouldRefreshStatusAfterRead(siteId, get().jiraStatus, { abortable }) &&
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
    if (!abortable) {
      inflightSearchRequests.set(cacheKey, entry)
    }
    return promise
  },
  listJiraIssues: async (filter = 'assigned', limit = 30, options) => {
    const scope = getJiraReadScope(get().settings, options?.sourceContext)
    const { contextKey } = scope
    const siteId = getSelectedSiteId(get().jiraStatus)
    const cacheKey = scopedJiraCacheKey(scope, `${siteId ?? 'default'}::list::${filter}::${limit}`)
    const cached = get().jiraSearchCache[cacheKey]
    if (isFresh(cached)) {
      return cached.data ?? []
    }
    const inflight = inflightListRequests.get(cacheKey)
    if (
      inflight &&
      inflight.contextKey === contextKey &&
      inflight.mutationGeneration === jiraMutationGeneration
    ) {
      return inflight.promise
    }
    let entry: InflightJiraReadRequest<JiraIssue[]>
    const requestMutationGeneration = jiraMutationGeneration
    const promise = jiraListIssues(scope.settings, filter, limit, siteId)
      .then((issues) => {
        if (
          inflightListRequests.get(cacheKey) === entry &&
          canWriteJiraReadResult(
            contextKey,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set((s) => ({
            jiraSearchCache: evictStaleEntries({
              ...s.jiraSearchCache,
              [cacheKey]: { data: issues, fetchedAt: Date.now() }
            })
          }))
        }
        return issues
      })
      .catch((error) => {
        console.warn('[jira] listJiraIssues failed:', error)
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
        // Credential/auth failures are surfaced through connection state, so they
        // keep the empty-list contract. Other failures (forbidden, bad JQL,
        // network, 5xx) reject so the Tasks panel can show a real error instead
        // of a misleading "No issues found".
        if (isIntegrationCredentialDecryptionError(error) || looksLikeAuthError(error)) {
          return []
        }
        throw error
      })
      .finally(() => {
        if (inflightListRequests.get(cacheKey) === entry) {
          inflightListRequests.delete(cacheKey)
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
    inflightListRequests.set(cacheKey, entry)
    return promise
  },
  patchJiraIssue: (issueKey, patch, options) => {
    const sourceScope =
      options?.sourceContext?.provider === 'jira'
        ? getTaskSourceCacheScope(options.sourceContext)
        : null
    const canPatchCacheKey = (key: string): boolean =>
      sourceScope === null || key.startsWith(`${sourceScope}::`)
    set((s) => {
      let changed = false
      const nextIssueCache = { ...s.jiraIssueCache }
      for (const [key, entry] of Object.entries(nextIssueCache)) {
        if (!canPatchCacheKey(key) || entry?.data?.key !== issueKey) {
          continue
        }
        nextIssueCache[key] = { ...entry, data: { ...entry.data, ...patch }, fetchedAt: 0 }
        changed = true
      }
      const nextSearchCache = { ...s.jiraSearchCache }
      for (const key of Object.keys(nextSearchCache)) {
        const entry = nextSearchCache[key]
        if (!canPatchCacheKey(key) || !entry?.data) {
          continue
        }
        const index = entry.data.findIndex((issue) => issue.key === issueKey)
        if (index === -1) {
          continue
        }
        const updatedItems = [...entry.data]
        updatedItems[index] = { ...updatedItems[index], ...patch }
        nextSearchCache[key] = { ...entry, data: updatedItems }
        changed = true
      }
      return changed ? { jiraIssueCache: nextIssueCache, jiraSearchCache: nextSearchCache } : {}
    })
  }
  }
}
