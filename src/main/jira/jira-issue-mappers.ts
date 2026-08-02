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
import { ISSUE_LIST_FIELDS, type JiraRecord, type JiraSearchResponse } from './jira-issue-primitives'
import { asRecord, asString, asStringArray, mapUser, mapProject, mapIssueType, mapPriority, mapStatus, issueUrl } from './jira-issue-deadlines'
function mapJiraIssue(
  site: JiraSite,
  raw: JiraRecord,
  adfOptions?: AdfToMarkdownOptions
): JiraIssue {
  const fields = asRecord(raw.fields)
  const key = asString(raw.key)
  return {
    id: asString(raw.id, key),
    key,
    siteId: site.id,
    siteName: site.displayName,
    title: asString(fields.summary, key || 'Untitled issue'),
    description: adfToMarkdownText(fields.description, adfOptions),
    url: issueUrl(site, key),
    project: mapProject(fields.project, site),
    issueType: mapIssueType(fields.issuetype),
    status: mapStatus(fields.status),
    labels: asStringArray(fields.labels),
    assignee: mapUser(fields.assignee),
    reporter: mapUser(fields.reporter),
    priority: mapPriority(fields.priority),
    createdAt: asString(fields.created, new Date().toISOString()),
    updatedAt: asString(fields.updated, new Date().toISOString())
  }
}

type MediaRequest = {
  attachmentField: unknown
  preferredIds: string[]
  needCount: number
  fallbackRan: boolean
  issueKey: string
}

/** Pooled: HTML/ADF selection only — no binary downloads. */
function collectIssueMediaRequest(raw: JiraRecord): MediaRequest | undefined {
  const fields = asRecord(raw.fields)
  const renderedFields = asRecord(raw.renderedFields)
  const htmlIds = extractAttachmentContentIdsFromHtml(
    asString(renderedFields.description) || undefined
  )
  const mediaAttrs = collectAdfMediaAttrs(fields.description)
  const selection = selectPreferredAttachmentIds({
    renderedHtmlIds: htmlIds,
    attachmentField: fields.attachment,
    mediaAttrs
  })
  if (selection.needCount === 0 && selection.preferredIds.length === 0) {
    return undefined
  }
  return {
    attachmentField: fields.attachment,
    preferredIds: selection.preferredIds,
    needCount: selection.needCount,
    fallbackRan: selection.fallbackRan,
    issueKey: asString(raw.key)
  }
}

type PreparedMedia = {
  options: AdfToMarkdownOptions
  stats: MediaResolutionStats
  request: MediaRequest
}

/** Unpooled: binary downloads + resolver (outside the Jira API semaphore). */
async function prepareMediaResolver(
  client: JiraClientForSite,
  request: MediaRequest
): Promise<PreparedMedia | undefined> {
  if (request.preferredIds.length === 0) {
    warnIfMediaResolutionIncomplete({
      siteId: client.site.id,
      issueKey: request.issueKey,
      needCount: request.needCount,
      preferredIdCount: 0,
      resolvedCount: 0,
      fallbackRan: request.fallbackRan
    })
    return undefined
  }
  const images = await loadIssueImageAttachments(
    client,
    request.attachmentField,
    request.preferredIds
  )
  if (images.length === 0) {
    warnIfMediaResolutionIncomplete({
      siteId: client.site.id,
      issueKey: request.issueKey,
      needCount: request.needCount,
      preferredIdCount: request.preferredIds.length,
      resolvedCount: 0,
      fallbackRan: request.fallbackRan
    })
    return undefined
  }
  const stats: MediaResolutionStats = { attachmentResolvedCount: 0 }
  const resolveMedia = createMediaMarkdownResolver(images, request.preferredIds, stats)
  return {
    options: { resolveMedia },
    stats,
    request
  }
}

function flushMediaResolutionWarn(client: JiraClientForSite, prepared: PreparedMedia): void {
  warnIfMediaResolutionIncomplete({
    siteId: client.site.id,
    issueKey: prepared.request.issueKey,
    needCount: prepared.request.needCount,
    preferredIdCount: prepared.request.preferredIds.length,
    resolvedCount: prepared.stats.attachmentResolvedCount,
    fallbackRan: prepared.request.fallbackRan
  })
}

function sortAndLimitIssues(issues: JiraIssue[], limit: number): JiraIssue[] {
  return issues
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit)
}

function filterToJql(filter: JiraIssueFilter): string {
  if (filter === 'assigned') {
    return 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC'
  }
  if (filter === 'reported') {
    return 'reporter = currentUser() AND resolution = Unresolved ORDER BY updated DESC'
  }
  if (filter === 'done') {
    return 'assignee = currentUser() AND resolution IS NOT EMPTY ORDER BY updated DESC'
  }
  return 'resolution = Unresolved ORDER BY updated DESC'
}

async function searchIssuesForClient(
  entry: JiraClientForSite,
  jql: string,
  limit: number,
  signal?: AbortSignal
): Promise<JiraIssue[]> {
  // Server/DC only has the classic /search resource; /search/jql is Cloud-only.
  const searchPath =
    entry.site.authType === 'server'
      ? `${apiBasePath(entry.site)}/search`
      : '/rest/api/3/search/jql'
  const result = await jiraRequest<JiraSearchResponse>(entry, searchPath, {
    method: 'POST',
    body: JSON.stringify({
      jql,
      maxResults: limit,
      fields: ISSUE_LIST_FIELDS
    }),
    signal
  })
  return (result.issues ?? []).map((issue) => mapJiraIssue(entry.site, issue))
}

export { mapJiraIssue, collectIssueMediaRequest, prepareMediaResolver, flushMediaResolutionWarn, sortAndLimitIssues, filterToJql, searchIssuesForClient }
export { type MediaRequest, type PreparedMedia }

