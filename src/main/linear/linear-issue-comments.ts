import type {
  LinearComment
} from '../../shared/types'
import {
  acquire,
  clearToken,
  getClients,
  isAuthError,
  release
} from './client'
import type { LinearIssueCommentsResponse,LinearRawVariables } from './linear-issue-primitives'
import {
  ISSUE_COMMENTS_QUERY
} from './linear-issue-queries'
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

