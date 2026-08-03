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
import { searchIssues } from './linear-issue-search'
type LinearIssueListOptions = {
  teamId?: string
  attributeFilter?: LinearIssueAttributeFilter | null
}

type LinearIssueNode = {
  id: string
  identifier: string
  title: string
  branchName?: string | null
  description?: string | null
  url: string
  dueDate?: string | null
  estimate?: number | null
  priority: number
  updatedAt: string
  labelIds?: string[] | null
  state?: {
    name?: string | null
    type?: string | null
    color?: string | null
  } | null
  team?: {
    id?: string | null
    name?: string | null
    key?: string | null
  } | null
  assignee?: {
    id: string
    displayName: string
    avatarUrl?: string | null
  } | null
  labels?: {
    nodes?: { id: string; name: string }[]
  } | null
}

type LinearIssueConnectionResponse = {
  searchIssues?: { nodes?: LinearIssueNode[] }
  issues?: LinearIssueConnection
  viewer?: {
    assignedIssues?: LinearIssueConnection
    createdIssues?: LinearIssueConnection
  }
}

type LinearIssueConnection = {
  nodes?: LinearIssueNode[]
  pageInfo?: {
    hasNextPage?: boolean
    endCursor?: string | null
  }
}

type LinearRawVariables = Record<string, unknown>
type LinearIssuePageRequest = {
  first: number
  after?: string
}
type LinearIssueConnectionLoader = (
  page: LinearIssuePageRequest
) => Promise<LinearIssueConnection | null | undefined>

type LinearWriteFailureKind = 'duplicate_id' | 'failed' | 'network' | 'unconfirmed'

class LinearWriteFailure extends Error {
  readonly kind: LinearWriteFailureKind
  readonly cause: unknown

  constructor(kind: LinearWriteFailureKind, message: string, cause?: unknown) {
    super(message)
    this.name = 'LinearWriteFailure'
    this.kind = kind
    this.cause = cause
  }
}

type LinearIssueWriteRecord = {
  id: string
  identifier: string
  title: string
  description?: string | null
  url: string
  team: { id: string; key: string; name: string }
  state: { id: string; name: string } | null
  parent: { id: string; identifier: string } | null
  project?: { id: string; name: string } | null
  assignee?: { id: string; displayName: string } | null
  priority?: number | null
  estimate?: number | null
  dueDate?: string | null
  labelIds?: string[] | null
  labels?: { id: string; name: string }[]
}

type LinearCommentWriteRecord = {
  id: string
  url: string | null
  body: string
  issue: { id: string; identifier: string; url: string }
  parentId: string | null
  threadRootId: string | null
}

type LinearAttachmentWriteRecord = {
  id: string
  title: string
  url: string
  issue: { id: string; identifier: string; url: string }
}

type LinearIssueByUuidResponse = {
  issue?:
    | (Omit<LinearIssueWriteRecord, 'labels'> & {
        labels?: { nodes?: { id: string; name: string }[] } | null
      })
    | null
}

type LinearCommentByUuidResponse = {
  comment?: {
    id: string
    url?: string | null
    body?: string | null
    parent?: { id?: string | null } | null
    issue?: { id?: string | null; identifier?: string | null; url?: string | null } | null
  } | null
}

type LinearAttachmentByUuidResponse = {
  attachment?: {
    id: string
    title?: string | null
    url?: string | null
    issue?: { id?: string | null; identifier?: string | null; url?: string | null } | null
  } | null
}

type LinearIssueCommentsResponse = {
  issue?: {
    comments?: {
      nodes?:
        | {
            id: string
            body?: string | null
            createdAt?: string | null
            user?: { displayName?: string | null; avatarUrl?: string | null } | null
          }[]
        | null
    } | null
  } | null
}

export { LinearWriteFailure }
export { type LinearIssueListOptions, type LinearIssueNode, type LinearIssueConnectionResponse, type LinearIssueConnection, type LinearRawVariables, type LinearIssuePageRequest, type LinearIssueConnectionLoader, type LinearWriteFailureKind, type LinearIssueWriteRecord, type LinearCommentWriteRecord, type LinearAttachmentWriteRecord, type LinearIssueByUuidResponse, type LinearCommentByUuidResponse, type LinearAttachmentByUuidResponse, type LinearIssueCommentsResponse }

