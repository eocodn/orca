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
import { ISSUE_DETAIL_FIELDS, ISSUE_SUMMARY_FIELDS, ISSUE_SUMMARY_TIMEOUT_MS, ISSUE_SEARCH_TIMEOUT_MS, type JiraRecord, clampLimit, type JiraIssueSearchFailure } from './jira-issue-primitives'
import { withJiraDeadline, settleJiraSummaryRead, getErrorStatus, toIssueSearchFailureError, shouldSurfaceSiteFailure, mapUser, issueUrl, toBodyText } from './jira-issue-deadlines'
import { mapJiraIssue, type MediaRequest, collectIssueMediaRequest, prepareMediaResolver, flushMediaResolutionWarn, sortAndLimitIssues, filterToJql, searchIssuesForClient } from './jira-issue-mappers'
async function listIssues(
  filter: JiraIssueFilter = 'assigned',
  limit = 30,
  siteId?: JiraSiteSelection | null
): Promise<JiraIssue[]> {
  return searchIssues(filterToJql(filter), limit, siteId)
}

async function searchIssues(
  jql: string,
  limit = 30,
  siteId?: JiraSiteSelection | null,
  signal?: AbortSignal
): Promise<JiraIssue[]> {
  const entries = getClients(siteId)
  if (entries.length === 0 || !jql.trim()) {
    return []
  }
  const safeLimit = clampLimit(limit)
  const failures: (JiraIssueSearchFailure | undefined)[] = Array.from({ length: entries.length })
  const surfaceSiteFailure = shouldSurfaceSiteFailure(siteId, entries.length)
  const results = await withJiraDeadline(signal, ISSUE_SEARCH_TIMEOUT_MS, (requestSignal) =>
    Promise.all(
      entries.map(async (entry, index) => {
        // Why: queueing on an abandoned search would keep occupying the shared Jira pool.
        await acquire(requestSignal)
        try {
          return await searchIssuesForClient(entry, jql.trim(), safeLimit, requestSignal)
        } catch (error) {
          if (requestSignal.aborted) {
            // Abandoned by the caller: not a site failure, so don't clear tokens or mask a real one.
            throw error
          }
          const authFailure = isAuthError(error)
          if (authFailure) {
            clearToken(entry.site.id)
          }
          if (surfaceSiteFailure) {
            throw toIssueSearchFailureError(error)
          }
          console.warn('[jira] searchIssues failed:', error)
          failures[index] = { error: toIssueSearchFailureError(error), auth: authFailure }
          return [] as JiraIssue[]
        } finally {
          release()
        }
      })
    )
  )
  // 'all' fan-out: only surface an error when every connected site failed, so a
  // partial success (or a genuinely empty result) is not reported as an error.
  const recordedFailures = failures.filter(
    (failure): failure is JiraIssueSearchFailure => failure !== undefined
  )
  if (recordedFailures.length === entries.length) {
    throw (recordedFailures.find((failure) => !failure.auth) ?? recordedFailures[0]).error
  }
  return entries.length === 1
    ? results.flat().slice(0, safeLimit)
    : sortAndLimitIssues(results.flat(), safeLimit)
}

async function getIssue(
  key: string,
  siteId?: JiraSiteSelection | null
): Promise<JiraIssue | null> {
  const entries = getClients(siteId)
  for (const entry of entries) {
    let mediaRequest: MediaRequest | undefined
    let issue: JiraRecord | undefined
    let held = false
    try {
      await acquire()
      held = true
      const params = new URLSearchParams({
        fields: ISSUE_DETAIL_FIELDS.join(','),
        expand: 'renderedFields'
      })
      issue = await jiraRequest<JiraRecord>(
        entry,
        `${apiBasePath(entry.site)}/issue/${encodeURIComponent(key)}?${params.toString()}`
      )
      // Why: keep only JSON under the pool; binary downloads fan out after release.
      mediaRequest = collectIssueMediaRequest(issue)
    } catch (error) {
      if (isAuthError(error)) {
        clearToken(entry.site.id)
        if (shouldSurfaceSiteFailure(siteId, entries.length)) {
          throw error
        }
      } else {
        console.warn('[jira] getIssue failed:', error)
      }
      continue
    } finally {
      if (held) {
        held = false
        release()
      }
    }

    try {
      if (!issue) {
        continue
      }
      const prepared = mediaRequest ? await prepareMediaResolver(entry, mediaRequest) : undefined
      const mapped = mapJiraIssue(entry.site, issue, prepared?.options)
      if (prepared) {
        flushMediaResolutionWarn(entry, prepared)
      }
      return mapped
    } catch (error) {
      console.warn('[jira] getIssue media load failed:', error)
      return mapJiraIssue(entry.site, issue)
    }
  }
  return null
}

async function getIssueSummary(
  key: string,
  siteId: string,
  signal?: AbortSignal
): Promise<JiraIssue | null> {
  let entries: JiraClientForSite[]
  try {
    entries = getClients(siteId)
  } catch (error) {
    throw new JiraSummaryLookupError('auth', error)
  }
  const entry = entries.find((candidate) => candidate.site.id === siteId)
  if (!entry) {
    throw new JiraSummaryLookupError('disconnected')
  }

  return withJiraDeadline(signal, ISSUE_SUMMARY_TIMEOUT_MS, async (requestSignal) => {
    await acquire(requestSignal)
    try {
      const params = new URLSearchParams({ fields: ISSUE_SUMMARY_FIELDS.join(',') })
      const issue = await settleJiraSummaryRead(
        jiraRequest<JiraRecord>(
          entry,
          `${apiBasePath(entry.site)}/issue/${encodeURIComponent(key)}?${params.toString()}`,
          { signal: requestSignal }
        ),
        requestSignal
      )
      return mapJiraIssue(entry.site, issue)
    } catch (error) {
      if (isAuthError(error)) {
        throw new JiraSummaryLookupError('auth', error)
      }
      if (getErrorStatus(error) === 404) {
        throw new JiraSummaryLookupError('not-found', error)
      }
      throw new JiraSummaryLookupError('read-failed', error)
    } finally {
      release()
    }
  })
}

async function createIssue(args: JiraCreateIssueArgs): Promise<JiraCreateIssueResult> {
  const entry = getClients(args.siteId)[0]
  if (!entry) {
    return { ok: false, error: 'Not connected to Jira.' }
  }
  const title = args.title.trim()
  if (!title) {
    return { ok: false, error: 'Title is required.' }
  }

  await acquire()
  try {
    const fields: JiraRecord = {
      project: { id: args.projectId },
      issuetype: { id: args.issueTypeId },
      summary: title
    }
    if (args.description?.trim()) {
      fields.description = toBodyText(entry.site, args.description.trim())
    }
    for (const [fieldKey, value] of Object.entries(args.customFields ?? {})) {
      if (!fieldKey || value === undefined || value === null || value === '') {
        continue
      }
      fields[fieldKey] = value
    }
    const created = await jiraRequest<{ id: string; key: string; self: string }>(
      entry,
      `${apiBasePath(entry.site)}/issue`,
      {
        method: 'POST',
        body: JSON.stringify({ fields })
      }
    )
    return { ok: true, id: created.id, key: created.key, url: issueUrl(entry.site, created.key) }
  } catch (error) {
    if (isAuthError(error)) {
      clearToken(entry.site.id)
      throw error
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to create issue.' }
  } finally {
    release()
  }
}

async function updateIssue(
  key: string,
  updates: JiraIssueUpdate,
  siteId?: string | null
): Promise<JiraMutationResult> {
  const entry = getClients(siteId)[0]
  if (!entry) {
    return { ok: false, error: 'Not connected to Jira.' }
  }
  await acquire()
  try {
    const fields: JiraRecord = {}
    if (updates.title !== undefined) {
      fields.summary = updates.title
    }
    if (updates.labels !== undefined) {
      fields.labels = updates.labels
    }
    if (updates.priorityId !== undefined) {
      fields.priority = updates.priorityId ? { id: updates.priorityId } : null
    }
    const issueBase = `${apiBasePath(entry.site)}/issue/${encodeURIComponent(key)}`
    if (Object.keys(fields).length > 0) {
      await jiraRequest(entry, issueBase, {
        method: 'PUT',
        body: JSON.stringify({ fields })
      })
    }
    if (updates.assigneeAccountId !== undefined) {
      // Server/DC identifies assignees by username (`name`), not accountId;
      // mapUser stores the Server username in the accountId slot.
      const assigneeBody =
        entry.site.authType === 'server'
          ? { name: updates.assigneeAccountId }
          : { accountId: updates.assigneeAccountId }
      await jiraRequest(entry, `${issueBase}/assignee`, {
        method: 'PUT',
        body: JSON.stringify(assigneeBody)
      })
    }
    if (updates.transitionId) {
      await jiraRequest(entry, `${issueBase}/transitions`, {
        method: 'POST',
        body: JSON.stringify({ transition: { id: updates.transitionId } })
      })
    }
    return { ok: true }
  } catch (error) {
    if (isAuthError(error)) {
      clearToken(entry.site.id)
      throw error
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to update issue.' }
  } finally {
    release()
  }
}

async function addIssueComment(
  key: string,
  body: string,
  siteId?: string | null
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const entry = getClients(siteId)[0]
  if (!entry) {
    return { ok: false, error: 'Not connected to Jira.' }
  }
  await acquire()
  try {
    const comment = await jiraRequest<{ id: string }>(
      entry,
      `${apiBasePath(entry.site)}/issue/${encodeURIComponent(key)}/comment`,
      {
        method: 'POST',
        body: JSON.stringify({ body: toBodyText(entry.site, body) })
      }
    )
    return { ok: true, id: comment.id }
  } catch (error) {
    if (isAuthError(error)) {
      clearToken(entry.site.id)
      throw error
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to add comment.' }
  } finally {
    release()
  }
}

export { listIssues, searchIssues, getIssue, getIssueSummary, createIssue, updateIssue, addIssueComment }
