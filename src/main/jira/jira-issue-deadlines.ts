import type {
  JiraComment,
  JiraCreateField,
  JiraCreateFieldAllowedValue,
  JiraCreateIssueArgs,
  JiraCreateIssueResult,
  JiraIssue,
  JiraIssueFilter,
  JiraIssueType,
  JiraIssueUpdate,
  JiraMutationResult,
  JiraPriority,
  JiraProject,
  JiraProjectStatusOrder,
  JiraSite,
  JiraSiteSelection,
  JiraStatus,
  JiraTransition,
  JiraUser
} from '../../shared/types'
import {
  acquire,
  apiBasePath,
  clearToken,
  getClients,
  isAuthError,
  jiraRequest,
  release,
  type JiraClientForSite
} from './client'
import {
  adfToMarkdownText,
  collectAdfMediaAttrs,
  textToAdf,
  type AdfToMarkdownOptions,
  type JiraAdfMediaAttrs
} from './adf-markdown'
import {
  extractAttachmentContentIdsFromHtml,
  selectPreferredAttachmentIds,
  warnIfMediaResolutionIncomplete
} from './attachment-discovery'
import {
  createMediaMarkdownResolver,
  loadIssueImageAttachments,
  type MediaResolutionStats
} from './attachment-images'
import { JiraSummaryLookupError } from '../../shared/jira-summary-lookup'
import { type JiraRecord, type JiraPagedResponse, type JiraPageItemKey } from './jira-issue-primitives'
async function withJiraDeadline<T>(
  signal: AbortSignal | undefined,
  timeoutMs: number,
  run: (deadlineSignal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) {
    controller.abort()
  }
  const timer = setTimeout(abort, timeoutMs)
  try {
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

function settleJiraSummaryRead<T>(read: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new Error('Jira summary lookup aborted'))
  }
  return new Promise((resolve, reject) => {
    const handleAbort = (): void => {
      cleanup()
      reject(new Error('Jira summary lookup aborted'))
    }
    const cleanup = (): void => signal.removeEventListener('abort', handleAbort)
    signal.addEventListener('abort', handleAbort, { once: true })
    void read.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      }
    )
  })
}

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) {
    return null
  }
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' && Number.isFinite(status) ? status : null
}

function toIssueSearchFailureError(error: unknown): unknown {
  const status = getErrorStatus(error)
  if (
    status === null ||
    !(error instanceof Error) ||
    error.message.startsWith(`Error ${status}:`)
  ) {
    return error
  }
  return new Error(`Error ${status}: ${error.message}`)
}

function shouldSurfaceSiteFailure(
  selection: JiraSiteSelection | null | undefined,
  entryCount: number
): boolean {
  // getClients can resolve an omitted selection to the persisted 'all' choice;
  // multi-entry reads need the same resilient fan-out policy as explicit 'all'.
  return selection !== 'all' && entryCount <= 1
}

function asRecord(value: unknown): JiraRecord {
  return value && typeof value === 'object' ? (value as JiraRecord) : {}
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asIdentifier(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getPageItems<T>(response: JiraPagedResponse<T>, key: JiraPageItemKey): T[] {
  const keyedItems = response[key]
  if (Array.isArray(keyedItems)) {
    return keyedItems
  }
  return response.values ?? []
}

function shouldFetchNextPage<T>(
  response: JiraPagedResponse<T>,
  startAt: number,
  items: T[],
  requestedMaxResults: number
): boolean {
  if (response.isLast === true || items.length === 0) {
    return false
  }
  const total = asFiniteNumber(response.total)
  const pageSize = asFiniteNumber(response.maxResults)
  if (total !== null) {
    return startAt + items.length < total && (pageSize ?? requestedMaxResults) > 0
  }
  if (response.isLast === false) {
    return (pageSize ?? requestedMaxResults) > 0
  }
  return pageSize !== null && items.length >= pageSize
}

async function fetchPagedRecords(
  entry: JiraClientForSite,
  key: JiraPageItemKey,
  pathForPage: (startAt: number, maxResults: number) => string,
  maxResults = 100
): Promise<JiraRecord[]> {
  const records: JiraRecord[] = []
  let startAt = 0
  for (let guard = 0; guard < 100; guard += 1) {
    const response = await jiraRequest<JiraPagedResponse<JiraRecord>>(
      entry,
      pathForPage(startAt, maxResults)
    )
    const items = getPageItems(response, key)
    records.push(...items)
    if (!shouldFetchNextPage(response, startAt, items, maxResults)) {
      break
    }
    startAt += asFiniteNumber(response.maxResults) ?? maxResults
  }
  return records
}

function avatarUrl(value: unknown): string | undefined {
  const avatars = asRecord(value)
  return (
    asString(avatars['48x48']) ||
    asString(avatars['32x32']) ||
    asString(avatars['24x24']) ||
    undefined
  )
}

function mapUser(value: unknown): JiraUser | undefined {
  const user = asRecord(value)
  // Server/DC users have no accountId; name (login) and key are its stable ids.
  const accountId = asString(user.accountId) || asString(user.name) || asString(user.key)
  if (!accountId) {
    return undefined
  }
  return {
    accountId,
    displayName: asString(user.displayName, 'Unknown'),
    email: typeof user.emailAddress === 'string' ? user.emailAddress : undefined,
    avatarUrl: avatarUrl(user.avatarUrls)
  }
}

function mapProject(value: unknown, site?: JiraSite): JiraProject {
  const project = asRecord(value)
  return {
    id: asString(project.id),
    key: asString(project.key),
    name: asString(project.name, asString(project.key)),
    siteId: site?.id,
    siteName: site?.displayName
  }
}

function mapIssueType(value: unknown): JiraIssueType {
  const issueType = asRecord(value)
  return {
    id: asString(issueType.id),
    name: asString(issueType.name, 'Issue'),
    description: asString(issueType.description) || undefined,
    iconUrl: asString(issueType.iconUrl) || undefined,
    subtask: typeof issueType.subtask === 'boolean' ? issueType.subtask : undefined
  }
}

function mapCreateFieldAllowedValue(value: unknown): JiraCreateFieldAllowedValue {
  const option = asRecord(value)
  return {
    id: asString(option.id) || undefined,
    value: asString(option.value) || undefined,
    name: asString(option.name) || undefined
  }
}

function mapCreateField(value: unknown, fallbackKey = ''): JiraCreateField | null {
  const field = asRecord(value)
  const schema = asRecord(field.schema)
  const key =
    asString(field.key) ||
    asString(field.fieldId) ||
    asString(field.id) ||
    asString(field.fieldKey) ||
    fallbackKey
  if (!key) {
    return null
  }
  const allowedValues = Array.isArray(field.allowedValues)
    ? field.allowedValues.map(mapCreateFieldAllowedValue)
    : undefined
  return {
    key,
    name: asString(field.name, key),
    required: field.required === true,
    schema: {
      type: asString(schema.type) || undefined,
      items: asString(schema.items) || undefined,
      custom: asString(schema.custom) || undefined
    },
    allowedValues
  }
}

function getCreateFieldRecords(response: JiraPagedResponse<JiraRecord>): JiraRecord[] {
  if (Array.isArray(response.values)) {
    return response.values
  }
  if (Array.isArray(response.fields)) {
    return response.fields
  }
  if (response.fields && typeof response.fields === 'object') {
    return Object.entries(response.fields).map(([key, value]) => ({
      key,
      ...asRecord(value)
    }))
  }
  return []
}

function mapPriority(value: unknown): JiraPriority | undefined {
  const priority = asRecord(value)
  const id = asString(priority.id)
  if (!id) {
    return undefined
  }
  return {
    id,
    name: asString(priority.name, 'Priority'),
    iconUrl: asString(priority.iconUrl) || undefined
  }
}

function mapStatus(value: unknown): JiraStatus {
  const status = asRecord(value)
  const category = asRecord(status.statusCategory)
  return {
    id: asString(status.id),
    name: asString(status.name, 'Unknown'),
    categoryKey: asString(category.key, 'undefined'),
    categoryName: asString(category.name, 'No Category'),
    colorName: asString(category.colorName) || undefined
  }
}

function issueUrl(site: JiraSite, key: string): string {
  return `${site.siteUrl}/browse/${encodeURIComponent(key)}`
}

// REST v2 (Server/DC) bodies are plain text; v3 (Cloud) requires ADF documents.
function toBodyText(site: JiraSite, text: string): unknown {
  return site.authType === 'server' ? text : textToAdf(text)
}

export { withJiraDeadline, settleJiraSummaryRead, getErrorStatus, toIssueSearchFailureError, shouldSurfaceSiteFailure, asRecord, asString, asIdentifier, asStringArray, asFiniteNumber, getPageItems, shouldFetchNextPage, fetchPagedRecords, avatarUrl, mapUser, mapProject, mapIssueType, mapCreateFieldAllowedValue, mapCreateField, getCreateFieldRecords, mapPriority, mapStatus, issueUrl, toBodyText }

