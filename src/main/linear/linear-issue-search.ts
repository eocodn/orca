import type {
  LinearIssue,
  LinearIssueUpdate,
  LinearComment,
  LinearCollectionResult,
  LinearWorkspaceError,
  LinearWorkspaceSelection
} from '../../shared/types'
import type { LinearClient } from '@linear/sdk'
import { loadLinearSdk } from './linear-sdk'
import {
  LINEAR_ISSUE_API_PAGE_SIZE_MAX,
  clampLinearIssueListLimit
} from '../../shared/linear-issue-read-limits'
import {
  isEmptyLinearIssueAttributeFilter,
  type LinearIssueAttributeFilter
} from '../../shared/linear-issue-attribute-filter'
import {
  acquire,
  release,
  getClients,
  isAuthError,
  clearToken,
  type LinearClientForWorkspace
} from './client'
import { buildLinearListIssueFilter } from './issue-list-filter'
import { mapLinearIssue } from './mappers'
import {
  AGENT_ISSUE_WRITE_FIELDS,
  ALL_ISSUES_QUERY,
  ATTACHMENT_BY_UUID_QUERY,
  COMMENT_BY_UUID_QUERY,
  ISSUE_BY_UUID_QUERY,
  ISSUE_COMMENTS_QUERY,
  SEARCH_ISSUES_QUERY,
  VIEWER_ASSIGNED_ISSUES_QUERY,
  VIEWER_CREATED_ISSUES_QUERY
} from './linear-issue-queries'
import { type LinearIssueConnectionResponse, type LinearRawVariables, type LinearIssueWriteRecord, type LinearCommentWriteRecord, type LinearAttachmentWriteRecord, type LinearIssueByUuidResponse, type LinearCommentByUuidResponse, type LinearAttachmentByUuidResponse } from './linear-issue-primitives'
import { mapIssueForWorkspace, sortAndLimitIssues, mapRawIssueForWorkspace, shouldThrowAuthError, runLinearLookup, mapRawCommentWriteRecord, mapRawAttachmentWriteRecord, mapRawIssueWriteRecord } from './linear-issue-reads'
async function getIssue(
  id: string,
  workspaceId?: LinearWorkspaceSelection | null
): Promise<LinearIssue | null> {
  const entries = getClients(workspaceId)
  if (entries.length === 0) {
    return null
  }

  for (const entry of entries) {
    await acquire()
    try {
      const issue = await entry.client.issue(id)
      return await mapIssueForWorkspace(entry, issue, {
        includeChildren: true,
        includeProject: true
      })
    } catch (error) {
      if (isAuthError(error)) {
        clearToken(entry.workspace.id)
        if (shouldThrowAuthError(workspaceId)) {
          throw error
        }
      } else {
        console.warn('[linear] getIssue failed:', error)
      }
    } finally {
      release()
    }
  }
  return null
}

async function getIssueByUuidForAgent(
  id: string,
  workspaceId?: string | null
): Promise<LinearIssueWriteRecord | null> {
  const entry = getClients(workspaceId)[0]
  if (!entry) {
    return null
  }

  return runLinearLookup(entry, async () => {
    const result = await entry.client.client.rawRequest<
      LinearIssueByUuidResponse,
      LinearRawVariables
    >(ISSUE_BY_UUID_QUERY, { id })
    const issue = result.data?.issue ?? null
    return issue ? mapRawIssueWriteRecord(issue) : null
  })
}

async function getCommentByUuidForAgent(
  id: string,
  workspaceId?: string | null
): Promise<LinearCommentWriteRecord | null> {
  const entry = getClients(workspaceId)[0]
  if (!entry) {
    return null
  }

  return runLinearLookup(entry, async () => {
    const result = await entry.client.client.rawRequest<
      LinearCommentByUuidResponse,
      LinearRawVariables
    >(COMMENT_BY_UUID_QUERY, { id })
    const comment = result.data?.comment
    return comment ? mapRawCommentWriteRecord(comment) : null
  })
}

async function getAttachmentByUuidForAgent(
  id: string,
  workspaceId?: string | null
): Promise<LinearAttachmentWriteRecord | null> {
  const entry = getClients(workspaceId)[0]
  if (!entry) {
    return null
  }

  return runLinearLookup(entry, async () => {
    const result = await entry.client.client.rawRequest<
      LinearAttachmentByUuidResponse,
      LinearRawVariables
    >(ATTACHMENT_BY_UUID_QUERY, { id })
    const attachment = result.data?.attachment
    return attachment ? mapRawAttachmentWriteRecord(attachment) : null
  })
}

async function getIssueCommentThreadRoot(
  issueId: string,
  commentId: string,
  workspaceId?: string | null
): Promise<{ id: string; parentId: string | null } | null> {
  const comment = await getCommentByUuidForAgent(commentId, workspaceId)
  if (!comment || comment.issue.id !== issueId) {
    return null
  }
  return { id: comment.threadRootId ?? comment.id, parentId: comment.parentId }
}

async function searchIssues(
  query: string,
  limit = 20,
  workspaceId?: LinearWorkspaceSelection | null
): Promise<LinearIssue[]> {
  const entries = getClients(workspaceId)
  if (entries.length === 0) {
    return []
  }

  const results = await Promise.all(
    entries.map(async (entry) => {
      await acquire()
      try {
        const result = await entry.client.client.rawRequest<
          LinearIssueConnectionResponse,
          LinearRawVariables
        >(SEARCH_ISSUES_QUERY, { term: query, first: limit })
        const nodes = result.data?.searchIssues?.nodes ?? []
        return nodes.map((issue) => mapRawIssueForWorkspace(entry, issue))
      } catch (error) {
        if (isAuthError(error)) {
          clearToken(entry.workspace.id)
          if (shouldThrowAuthError(workspaceId)) {
            throw error
          }
        } else {
          console.warn('[linear] searchIssues failed:', error)
        }
        return []
      } finally {
        release()
      }
    })
  )
  // Why: searchIssues returns Linear's relevance ranking. Re-sorting by
  // updatedAt would discard relevance order for single-workspace results,
  // diverging from Linear's web UI and pre-PR behavior.
  if (entries.length === 1) {
    return results.flat().slice(0, limit)
  }
  return sortAndLimitIssues(results.flat(), limit)
}

export { getIssue, getIssueByUuidForAgent, getCommentByUuidForAgent, getAttachmentByUuidForAgent, getIssueCommentThreadRoot, searchIssues }

