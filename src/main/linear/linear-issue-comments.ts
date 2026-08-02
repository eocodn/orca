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
import { type LinearRawVariables, type LinearIssueCommentsResponse } from './linear-issue-primitives'
async function getIssueComments(
  issueId: string,
  workspaceId?: string | null
): Promise<LinearComment[]> {
  const entry = getClients(workspaceId)[0]
  if (!entry) {
    return []
  }

  await acquire()
  try {
    const result = await entry.client.client.rawRequest<
      LinearIssueCommentsResponse,
      LinearRawVariables
    >(ISSUE_COMMENTS_QUERY, { id: issueId })
    const nodes = result.data?.issue?.comments?.nodes ?? []
    return nodes.map((node) => ({
      id: node.id,
      body: node.body ?? '',
      // Why: rawRequest returns createdAt as an ISO string already; do not
      // re-serialize (the SDK model path used .toISOString() on a parsed Date).
      createdAt: node.createdAt ?? '',
      user: node.user
        ? {
            displayName: node.user.displayName ?? '',
            avatarUrl: node.user.avatarUrl ?? undefined
          }
        : undefined
    }))
  } catch (error) {
    if (isAuthError(error)) {
      clearToken(entry.workspace.id)
      throw error
    }
    console.warn('[linear] getIssueComments failed:', error)
    return []
  } finally {
    release()
  }
}

export { getIssueComments }

