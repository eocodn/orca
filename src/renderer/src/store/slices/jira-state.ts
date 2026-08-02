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

export const CACHE_TTL = 60_000
export const MAX_CACHE_ENTRIES = 500

export function isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return entry !== undefined && Date.now() - entry.fetchedAt < CACHE_TTL
}

export function evictStaleEntries<T>(
  cache: Record<string, CacheEntry<T>>,
  maxEntries = MAX_CACHE_ENTRIES
): Record<string, CacheEntry<T>> {
  const keys = Object.keys(cache)
  if (keys.length <= maxEntries) {
    return cache
  }
  const sorted = keys.sort((a, b) => (cache[a]?.fetchedAt ?? 0) - (cache[b]?.fetchedAt ?? 0))
  const pruned: Record<string, CacheEntry<T>> = {}
  for (const key of sorted.slice(sorted.length - maxEntries)) {
    pruned[key] = cache[key]
  }
  return pruned
}

export function looksLikeAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  // Why: Jira 403 commonly means endpoint/project access is denied while the
  // saved token is still valid; do not flip Settings back to disconnected.
  return /authenticat|unauthorized|401/i.test(msg)
}

export type InflightJiraReadRequest<T> = {
  promise: Promise<T>
  contextKey: string
  mutationGeneration: number
}

export type SharedJiraSummaryRequest = InflightJiraReadRequest<JiraIssue | null> & {
  controller: AbortController
  subscribers: number
}

export function createJiraAbortError(what: string): Error {
  const error = new Error(`Jira ${what} aborted`)
  error.name = 'AbortError'
  return error
}

/**
 * Join one summary read, even when the caller brought its own signal.
 *
 * The shared request is cancelled only once every subscriber has abandoned it, so a superseded
 * keystroke still releases the Jira pool without stealing a lookup another caller is waiting on.
 */
export function subscribeToJiraSummaryRequest(
  entry: SharedJiraSummaryRequest,
  signal: AbortSignal | undefined
): Promise<JiraIssue | null> {
  if (!signal) {
    entry.subscribers += 1
    return entry.promise
  }
  if (signal.aborted) {
    return Promise.reject(createJiraAbortError('issue summary lookup'))
  }
  entry.subscribers += 1
  return new Promise<JiraIssue | null>((resolve, reject) => {
    const abandon = (): void => {
      entry.subscribers -= 1
      if (entry.subscribers <= 0) {
        entry.controller.abort()
      }
      reject(createJiraAbortError('issue summary lookup'))
    }
    signal.addEventListener('abort', abandon, { once: true })
    const settle = (): void => signal.removeEventListener('abort', abandon)
    entry.promise.then(
      (issue) => {
        settle()
        resolve(issue)
      },
      (error: unknown) => {
        settle()
        reject(error)
      }
    )
  })
}

export type JiraReadOptions = {
  sourceContext?: TaskSourceContext | null
  siteId?: JiraSiteSelection | null
}
export type JiraSearchOptions = JiraReadOptions & { signal?: AbortSignal }
export type JiraPatchOptions = { sourceContext?: TaskSourceContext | null }
export type JiraIssueSummaryLookupOptions = { force?: boolean; signal?: AbortSignal }

export type JiraReadScope = {
  settings: AppState['settings'] | TaskSourceContext | null
  contextKey: string
  cachePrefix: string | null
  explicitSource: boolean
}

export const inflightIssueRequests = new Map<string, InflightJiraReadRequest<JiraIssue | null>>()
export const inflightIssueSummaryRequests = new Map<string, SharedJiraSummaryRequest>()
export const inflightSearchRequests = new Map<string, InflightJiraReadRequest<JiraIssue[]>>()
export const inflightListRequests = new Map<string, InflightJiraReadRequest<JiraIssue[]>>()
let jiraStatusReadGeneration = 0
let jiraMutationGeneration = 0

export function getSelectedSiteId(status: JiraConnectionStatus): JiraSiteSelection | null {
  return status.selectedSiteId ?? status.activeSiteId ?? null
}

export function shouldRefreshStatusAfterRead(
  siteId: JiraSiteSelection | null | undefined,
  status: JiraConnectionStatus,
  options?: { abortable?: boolean }
): boolean {
  // Why: a visible credential error may have been cleared by a successful credential read.
  if (status.credentialError !== undefined) {
    return true
  }
  // Why: 'all' list/detail reads can hide per-site decrypt failures. Abortable typeahead
  // (composer search) must not re-check status on every keystroke.
  return siteId === 'all' && options?.abortable !== true
}

export function clearJiraInflight(): void {
  for (const entry of inflightIssueSummaryRequests.values()) {
    entry.controller.abort()
  }
  inflightIssueRequests.clear()
  inflightIssueSummaryRequests.clear()
  inflightSearchRequests.clear()
  inflightListRequests.clear()
}

export function beginJiraMutation(): number {
  jiraMutationGeneration += 1
  return jiraMutationGeneration
}

export function isCurrentJiraMutation(generation: number): boolean {
  return generation === jiraMutationGeneration
}

export function isCurrentJiraRuntimeContext(contextKey: string, settings: AppState['settings']): boolean {
  return getProviderRuntimeContextKey(settings) === contextKey
}

export function canWriteJiraReadResult(
  contextKey: string,
  mutationGeneration: number,
  settings: AppState['settings'],
  explicitSource = false
): boolean {
  return (
    mutationGeneration === jiraMutationGeneration &&
    (explicitSource || isCurrentJiraRuntimeContext(contextKey, settings))
  )
}

export function getJiraReadScope(
  settings: AppState['settings'],
  sourceContext?: TaskSourceContext | null
): JiraReadScope {
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

export function scopedJiraCacheKey(scope: JiraReadScope, key: string): string {
  return scope.cachePrefix ? `${scope.cachePrefix}::${key}` : key
}

export function getJiraConnectionRevisionContextKey(
  settings: AppState['settings'] | TaskSourceContext | null
): string {
  return getProviderRuntimeContextKey(
    settings && 'kind' in settings ? getTaskSourceRuntimeSettings(settings) : settings
  )
}

export function nextJiraConnectionRevisions(
  revisions: Record<string, number>,
  contextKey: string
): Record<string, number> {
  return { ...revisions, [contextKey]: (revisions[contextKey] ?? 0) + 1 }
}

export const EMPTY_JIRA_READ_CACHES = {
  jiraIssueCache: {},
  jiraIssueSummaryCache: {},
  jiraSearchCache: {}
} satisfies Partial<JiraSlice>

/**
 * An auth failure on a read invalidates the connection: bump the revision so lazy readers re-probe.
 * An explicit source context owns its own status, so only the ambient status is reset.
 */
export function markJiraConnectionLost(
  set: (partial: (state: AppState) => Partial<JiraSlice>) => void,
  scope: JiraReadScope
): void {
  const revisionContextKey = getJiraConnectionRevisionContextKey(scope.settings)
  set((state) => ({
    ...(scope.explicitSource ? {} : { jiraStatus: { connected: false, viewer: null } }),
    jiraConnectionRevisions: nextJiraConnectionRevisions(
      state.jiraConnectionRevisions,
      revisionContextKey
    )
  }))
}

/** Status write that also bumps the revision watchers use to re-read a lazily-loaded status. */
export function jiraStatusUpdate(
  state: AppState,
  contextKey: string,
  status: JiraConnectionStatus,
  extra?: Partial<JiraSlice>
): Partial<JiraSlice> {
  return {
    jiraStatus: status,
    jiraStatusChecked: true,
    jiraStatusContextKey: contextKey,
    jiraConnectionRevisions: nextJiraConnectionRevisions(state.jiraConnectionRevisions, contextKey),
    ...extra
  }
}

export type JiraSlice = {
  jiraStatus: JiraConnectionStatus
  jiraStatusChecked: boolean
  jiraStatusContextKey: string | null
  jiraConnectionRevisions: Record<string, number>
  jiraIssueCache: Record<string, CacheEntry<JiraIssue>>
  jiraIssueSummaryCache: Record<string, CacheEntry<JiraIssue | null>>
  jiraSearchCache: Record<string, CacheEntry<JiraIssue[]>>

  checkJiraConnection: () => Promise<void>
  readJiraStatus: (sourceContext: TaskSourceContext) => Promise<JiraConnectionStatus>
  lookupJiraIssueSummary: (
    sourceContext: TaskSourceContext,
    key: string,
    siteId: string,
    options?: JiraIssueSummaryLookupOptions
  ) => Promise<JiraIssue | null>
  connectJira: (args: {
    siteUrl: string
    email: string
    apiToken: string
    authType?: JiraAuthType
  }) => Promise<{ ok: true; viewer: JiraViewer } | { ok: false; error: string }>
  testJiraConnection: (
    siteId?: string | null
  ) => Promise<{ ok: true; viewer: JiraViewer } | { ok: false; error: string }>
  selectJiraSite: (siteId: JiraSiteSelection) => Promise<void>
  disconnectJira: (siteId?: string | null) => Promise<void>
  fetchJiraIssue: (
    key: string,
    siteId?: string | null,
    options?: JiraReadOptions
  ) => Promise<JiraIssue | null>
  searchJiraIssues: (
    jql: string,
    limit?: number,
    options?: JiraSearchOptions
  ) => Promise<JiraIssue[]>
  listJiraIssues: (
    filter?: JiraIssueFilter,
    limit?: number,
    options?: JiraReadOptions
  ) => Promise<JiraIssue[]>
  patchJiraIssue: (issueKey: string, patch: Partial<JiraIssue>, options?: JiraPatchOptions) => void
}
import { createJiraSlicejiraStatusActions } from './jira-state-jira-status-actions'
import { createJiraSlicesearchJiraIssuesActions2 } from './jira-state-search-jira-issues-actions'

export const createJiraSlice: StateCreator<AppState, [], [], JiraSlice> = (set, get) => ({
  ...createJiraSlicejiraStatusActions(set, get),
  ...createJiraSlicesearchJiraIssuesActions2(set, get),
})
