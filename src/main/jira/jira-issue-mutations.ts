import type {
  JiraComment,
  JiraCreateField,
  JiraIssueType,
  JiraPriority,
  JiraProject,
  JiraProjectStatusOrder,
  JiraSiteSelection,
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
  type AdfToMarkdownOptions,
  type JiraAdfMediaAttrs
} from './adf-markdown'
import {
  extractAttachmentContentIdsFromHtml,
  selectPreferredAttachmentIds
} from './attachment-discovery'
import { type JiraRecord, type JiraPagedResponse } from './jira-issue-primitives'
import { shouldSurfaceSiteFailure, asRecord, asString, asIdentifier, asFiniteNumber, shouldFetchNextPage, fetchPagedRecords, mapUser, mapProject, mapIssueType, mapCreateField, getCreateFieldRecords, mapPriority, mapStatus } from './jira-issue-deadlines'
import { type MediaRequest, prepareMediaResolver, flushMediaResolutionWarn } from './jira-issue-mappers'
function mapComment(raw: JiraRecord, adfOptions?: AdfToMarkdownOptions): JiraComment {
  return {
    id: asString(raw.id),
    body: adfToMarkdownText(raw.body, adfOptions),
    createdAt: asString(raw.created, new Date().toISOString()),
    updatedAt: asString(raw.updated) || undefined,
    user: mapUser(raw.author)
  }
}

/**
 * Pooled comment media collect: attachment metadata JSON stays under the semaphore.
 * Residual: Server/DC comment bodies are wiki markup, not ADF — this only fixes
 * the lookup path; wiki `!filename!` is not rendered as media.
 */
async function collectCommentMediaRequest(
  client: JiraClientForSite,
  key: string,
  comments: JiraRecord[]
): Promise<MediaRequest | undefined> {
  const htmlIds: string[] = []
  const seen = new Set<string>()
  const mediaAttrs: JiraAdfMediaAttrs[] = []
  for (const comment of comments) {
    for (const id of extractAttachmentContentIdsFromHtml(asString(comment.renderedBody))) {
      if (!seen.has(id)) {
        seen.add(id)
        htmlIds.push(id)
      }
    }
    mediaAttrs.push(...collectAdfMediaAttrs(comment.body))
  }

  const needingCount = mediaAttrs.filter(
    (attrs) => !(attrs.url && /^https?:\/\//i.test(attrs.url))
  ).length
  // Why: selectPreferredAttachmentIds yields nothing without attachment-needing media, so
  // HTML ids alone can never produce a download — skip the extra metadata request entirely.
  if (needingCount === 0) {
    return undefined
  }

  // Why: comment media usually references issue-level attachments; pull them once
  // for the whole thread. Use apiBasePath so Server/DC does not 404 on /rest/api/3.
  let attachmentField: unknown
  try {
    const issue = await jiraRequest<JiraRecord>(
      client,
      `${apiBasePath(client.site)}/issue/${encodeURIComponent(key)}?fields=attachment`
    )
    attachmentField = asRecord(issue.fields).attachment
  } catch (error) {
    console.warn('[jira] comment attachment lookup failed:', error)
    return undefined
  }

  const selection = selectPreferredAttachmentIds({
    renderedHtmlIds: htmlIds,
    attachmentField,
    mediaAttrs
  })
  if (selection.needCount === 0 && selection.preferredIds.length === 0) {
    return undefined
  }
  return {
    attachmentField,
    preferredIds: selection.preferredIds,
    needCount: selection.needCount,
    fallbackRan: selection.fallbackRan,
    issueKey: key
  }
}

async function getIssueComments(
  key: string,
  siteId?: string | null
): Promise<JiraComment[]> {
  const entry = getClients(siteId)[0]
  if (!entry) {
    return []
  }

  let comments: JiraRecord[] = []
  let mediaRequest: MediaRequest | undefined
  let held = false
  try {
    await acquire()
    held = true
    comments = await fetchPagedRecords(entry, 'comments', (startAt, maxResults) => {
      const params = new URLSearchParams({
        maxResults: String(maxResults),
        orderBy: 'created',
        startAt: String(startAt),
        expand: 'renderedBody'
      })
      return `${apiBasePath(entry.site)}/issue/${encodeURIComponent(key)}/comment?${params.toString()}`
    })
    mediaRequest = await collectCommentMediaRequest(entry, key, comments)
  } catch (error) {
    if (isAuthError(error)) {
      clearToken(entry.site.id)
      throw error
    }
    console.warn('[jira] getIssueComments failed:', error)
    return []
  } finally {
    if (held) {
      held = false
      release()
    }
  }

  try {
    const prepared = mediaRequest ? await prepareMediaResolver(entry, mediaRequest) : undefined
    const mapped = comments.map((comment) => mapComment(comment, prepared?.options))
    if (prepared) {
      flushMediaResolutionWarn(entry, prepared)
    }
    return mapped
  } catch (error) {
    console.warn('[jira] getIssueComments media load failed:', error)
    return comments.map((comment) => mapComment(comment))
  }
}

async function listProjects(siteId?: JiraSiteSelection | null): Promise<JiraProject[]> {
  const entries = getClients(siteId)
  if (entries.length === 0) {
    return []
  }
  const results = await Promise.all(
    entries.map(async (entry) => {
      await acquire()
      try {
        // Server/DC has no /project/search resource; /project returns the
        // full list as a plain (unpaged) array.
        const projects =
          entry.site.authType === 'server'
            ? await jiraRequest<JiraRecord[]>(entry, `${apiBasePath(entry.site)}/project`)
            : await fetchPagedRecords(entry, 'values', (startAt, maxResults) => {
                const params = new URLSearchParams({
                  maxResults: String(maxResults),
                  startAt: String(startAt)
                })
                return `/rest/api/3/project/search?${params.toString()}`
              })
        return projects.map((project) => mapProject(project, entry.site))
      } catch (error) {
        if (isAuthError(error)) {
          clearToken(entry.site.id)
          if (shouldSurfaceSiteFailure(siteId, entries.length)) {
            throw error
          }
        } else {
          console.warn('[jira] listProjects failed:', error)
        }
        return []
      } finally {
        release()
      }
    })
  )
  return results.flat().sort((a, b) => a.name.localeCompare(b.name))
}

async function listIssueTypes(
  projectIdOrKey: string,
  siteId?: string | null
): Promise<JiraIssueType[]> {
  const entry = getClients(siteId)[0]
  if (!entry) {
    return []
  }
  await acquire()
  try {
    const issueTypes = await fetchPagedRecords(entry, 'issueTypes', (startAt, maxResults) => {
      const params = new URLSearchParams({
        maxResults: String(maxResults),
        startAt: String(startAt)
      })
      // Per-project createmeta paths exist on Server/DC from Jira 8.4 onward.
      return `${apiBasePath(entry.site)}/issue/createmeta/${encodeURIComponent(
        projectIdOrKey
      )}/issuetypes?${params.toString()}`
    })
    return issueTypes.map(mapIssueType)
  } catch (error) {
    if (isAuthError(error)) {
      clearToken(entry.site.id)
      throw error
    }
    console.warn('[jira] listIssueTypes failed:', error)
    return []
  } finally {
    release()
  }
}

async function listCreateFields(
  projectIdOrKey: string,
  issueTypeId: string,
  siteId?: string | null
): Promise<JiraCreateField[]> {
  const entry = getClients(siteId)[0]
  if (!entry) {
    return []
  }
  await acquire()
  try {
    const fields: JiraCreateField[] = []
    let startAt = 0
    const maxResults = 100
    for (let guard = 0; guard < 100; guard += 1) {
      const params = new URLSearchParams({
        maxResults: String(maxResults),
        startAt: String(startAt)
      })
      const response = await jiraRequest<JiraPagedResponse<JiraRecord>>(
        entry,
        `${apiBasePath(entry.site)}/issue/createmeta/${encodeURIComponent(
          projectIdOrKey
        )}/issuetypes/${encodeURIComponent(issueTypeId)}?${params.toString()}`
      )
      const records = getCreateFieldRecords(response)
      fields.push(
        ...records
          .map((record) => mapCreateField(record))
          .filter((field): field is JiraCreateField => field !== null)
      )
      if (!shouldFetchNextPage(response, startAt, records, maxResults)) {
        break
      }
      startAt += asFiniteNumber(response.maxResults) ?? maxResults
    }
    return fields
  } catch (error) {
    if (isAuthError(error)) {
      clearToken(entry.site.id)
      throw error
    }
    console.warn('[jira] listCreateFields failed:', error)
    return []
  } finally {
    release()
  }
}

async function listPriorities(siteId?: string | null): Promise<JiraPriority[]> {
  const entry = getClients(siteId)[0]
  if (!entry) {
    return []
  }
  await acquire()
  try {
    const response = await jiraRequest<JiraRecord[]>(entry, `${apiBasePath(entry.site)}/priority`)
    return response.map(mapPriority).filter((priority): priority is JiraPriority => !!priority)
  } catch (error) {
    if (isAuthError(error)) {
      clearToken(entry.site.id)
      throw error
    }
    console.warn('[jira] listPriorities failed:', error)
    return []
  } finally {
    release()
  }
}

async function listAssignableUsers(
  key: string,
  query?: string,
  siteId?: string | null
): Promise<JiraUser[]> {
  const entry = getClients(siteId)[0]
  if (!entry) {
    return []
  }
  const isServer = entry.site.authType === 'server'
  const params = new URLSearchParams({ issueKey: key, maxResults: '50' })
  if (query?.trim()) {
    // Server/DC filters assignable users by `username`; `query` is Cloud-only.
    params.set(isServer ? 'username' : 'query', query.trim())
  }
  await acquire()
  try {
    const response = await jiraRequest<JiraRecord[]>(
      entry,
      `${apiBasePath(entry.site)}/user/assignable/search?${params.toString()}`
    )
    return response.map(mapUser).filter((user): user is JiraUser => !!user)
  } catch (error) {
    if (isAuthError(error)) {
      clearToken(entry.site.id)
      throw error
    }
    console.warn('[jira] listAssignableUsers failed:', error)
    return []
  } finally {
    release()
  }
}

async function listTransitions(
  key: string,
  siteId?: string | null
): Promise<JiraTransition[]> {
  const entry = getClients(siteId)[0]
  if (!entry) {
    return []
  }
  await acquire()
  try {
    const response = await jiraRequest<{ transitions?: JiraRecord[] }>(
      entry,
      `${apiBasePath(entry.site)}/issue/${encodeURIComponent(key)}/transitions`
    )
    return (response.transitions ?? []).map((transition) => ({
      id: asString(transition.id),
      name: asString(transition.name),
      to: mapStatus(transition.to)
    }))
  } catch (error) {
    if (isAuthError(error)) {
      clearToken(entry.site.id)
      throw error
    }
    console.warn('[jira] listTransitions failed:', error)
    return []
  } finally {
    release()
  }
}

async function getProjectStatusOrder(
  projectKey: string,
  siteId?: string | null
): Promise<JiraProjectStatusOrder> {
  // Why: an omitted site can resolve to the persisted "all" selection; board
  // metadata is only truthful when exactly one Jira connection owns the project.
  const entries = getClients(siteId)
  const entry = entries.length === 1 ? entries[0] : undefined
  if (!entry) {
    return { statusIdsByColumn: [] }
  }
  await acquire()
  try {
    // Why: without an explicit board picker there is no truthful way to choose
    // among multiple project boards, so ambiguous projects keep alphabetical order.
    const params = new URLSearchParams({ projectKeyOrId: projectKey, maxResults: '2' })
    const boardsResponse = await jiraRequest<JiraPagedResponse<JiraRecord>>(
      entry,
      `/rest/agile/1.0/board?${params.toString()}`
    )
    const boards = boardsResponse.values ?? []
    const boardCount = asFiniteNumber(boardsResponse.total)
    const singleBoardIsProven =
      boards.length === 1 &&
      boardsResponse.isLast !== false &&
      (boardCount === 1 || (boardCount === null && boardsResponse.isLast === true))
    const boardId = singleBoardIsProven ? asIdentifier(asRecord(boards[0]).id) : ''
    if (!boardId) {
      return { statusIdsByColumn: [] }
    }

    const configResponse = await jiraRequest<unknown>(
      entry,
      `/rest/agile/1.0/board/${encodeURIComponent(boardId)}/configuration`
    )
    const columns = asRecord(asRecord(configResponse).columnConfig).columns
    if (!Array.isArray(columns)) {
      return { statusIdsByColumn: [] }
    }

    // Why: issues already carry status names and IDs, so returning board IDs
    // avoids a second metadata request and keeps duplicate names unambiguous.
    const seenStatusIds = new Set<string>()
    const statusIdsByColumn: string[][] = []
    for (const column of columns) {
      const statuses = asRecord(column).statuses
      if (!Array.isArray(statuses)) {
        continue
      }
      const columnStatusIds: string[] = []
      for (const status of statuses) {
        const statusId = asIdentifier(asRecord(status).id)
        if (statusId && !seenStatusIds.has(statusId)) {
          seenStatusIds.add(statusId)
          columnStatusIds.push(statusId)
        }
      }
      if (columnStatusIds.length > 0) {
        statusIdsByColumn.push(columnStatusIds)
      }
    }
    return { statusIdsByColumn }
  } catch (error) {
    if (isAuthError(error)) {
      clearToken(entry.site.id)
      throw error
    }
    console.warn('[jira] getProjectStatusOrder failed:', error)
    return { statusIdsByColumn: [] }
  } finally {
    release()
  }
}

export { mapComment, collectCommentMediaRequest, getIssueComments, listProjects, listIssueTypes, listCreateFields, listPriorities, listAssignableUsers, listTransitions, getProjectStatusOrder }
