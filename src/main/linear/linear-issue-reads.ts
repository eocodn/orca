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
import { type LinearIssueListOptions, type LinearIssueNode, type LinearIssueConnectionResponse, type LinearRawVariables, type LinearIssueConnectionLoader, LinearWriteFailure, type LinearIssueWriteRecord, type LinearCommentWriteRecord, type LinearAttachmentWriteRecord, type LinearIssueByUuidResponse, type LinearCommentByUuidResponse, type LinearAttachmentByUuidResponse } from './linear-issue-primitives'
import { type LinearListFilter } from './linear-issue-listing'
async function mapIssueForWorkspace(
  entry: LinearClientForWorkspace,
  issue: Parameters<typeof mapLinearIssue>[0],
  options?: Parameters<typeof mapLinearIssue>[1]
): Promise<LinearIssue> {
  const mapped = await mapLinearIssue(issue, options)
  return {
    ...mapped,
    workspaceId: entry.workspace.id,
    workspaceName: entry.workspace.organizationName
  }
}

function sortAndLimitIssues(issues: LinearIssue[], limit: number): LinearIssue[] {
  return issues
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit)
}

function sortLimitAndDescribeIssues(
  issues: LinearIssue[],
  limit: number
): { items: LinearIssue[]; clipped: boolean } {
  const sorted = issues.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
  return {
    items: sorted.slice(0, limit),
    clipped: sorted.length > limit
  }
}

function mapRawIssueForWorkspace(
  entry: LinearClientForWorkspace,
  issue: LinearIssueNode
): LinearIssue {
  const labelNodes = issue.labels?.nodes ?? []
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    branchName: issue.branchName ?? undefined,
    description: issue.description ?? undefined,
    url: issue.url,
    state: {
      name: issue.state?.name ?? '',
      type: issue.state?.type ?? '',
      color: issue.state?.color ?? ''
    },
    team: {
      id: issue.team?.id ?? '',
      name: issue.team?.name ?? '',
      key: issue.team?.key ?? ''
    },
    labels: labelNodes.map((label) => label.name),
    // Why: labelIds drives full-replace updates. Keep Linear's complete id
    // list even when display label nodes are paginated.
    labelIds: issue.labelIds ?? labelNodes.map((label) => label.id),
    assignee: issue.assignee
      ? {
          id: issue.assignee.id,
          displayName: issue.assignee.displayName,
          avatarUrl: issue.assignee.avatarUrl ?? undefined
        }
      : undefined,
    estimate: issue.estimate ?? null,
    priority: issue.priority,
    dueDate: issue.dueDate ?? null,
    updatedAt: issue.updatedAt,
    workspaceId: entry.workspace.id,
    workspaceName: entry.workspace.organizationName
  }
}

async function readIssueConnectionPages(
  entry: LinearClientForWorkspace,
  limit: number,
  loadConnection: LinearIssueConnectionLoader
): Promise<{ items: LinearIssue[]; hasMore: boolean }> {
  const items: LinearIssue[] = []
  let after: string | undefined
  let hasMore = false

  while (items.length < limit) {
    // Why: Linear caps connection pages at 50, so larger Orca reads must walk
    // cursors instead of asking for the whole expanded limit in one request.
    const first = Math.min(LINEAR_ISSUE_API_PAGE_SIZE_MAX, limit - items.length)
    const connection = await loadConnection(after ? { first, after } : { first })
    const nodes = connection?.nodes ?? []
    items.push(...nodes.map((issue) => mapRawIssueForWorkspace(entry, issue)))
    hasMore = Boolean(connection?.pageInfo?.hasNextPage)

    const nextCursor = connection?.pageInfo?.endCursor ?? undefined
    if (!hasMore || !nextCursor || nextCursor === after || nodes.length === 0) {
      break
    }
    after = nextCursor
  }

  return { items, hasMore }
}

function getOldestIssueTime(issues: LinearIssue[]): number {
  const oldestIssue = issues.at(-1)
  return oldestIssue ? new Date(oldestIssue.updatedAt).getTime() : Number.POSITIVE_INFINITY
}

function getListIssueConnectionLoader(
  entry: LinearClientForWorkspace,
  filter: LinearListFilter,
  options?: LinearIssueListOptions
): LinearIssueConnectionLoader {
  const orderBy = 'updatedAt'
  const variables = { orderBy }
  // Why: apply attribute + team filters in GraphQL variables before the first-N
  // cursor walk so pagination hasMore matches the filtered set.
  const filterInput = buildLinearListIssueFilter({
    filter,
    teamId: options?.teamId,
    attributeFilter: options?.attributeFilter
  })

  if (filter === 'assigned') {
    return async (page) => {
      const result = await entry.client.client.rawRequest<
        LinearIssueConnectionResponse,
        LinearRawVariables
      >(VIEWER_ASSIGNED_ISSUES_QUERY, {
        ...variables,
        ...page,
        filter: filterInput
      })
      return result.data?.viewer?.assignedIssues
    }
  }

  if (filter === 'created') {
    return async (page) => {
      const result = await entry.client.client.rawRequest<
        LinearIssueConnectionResponse,
        LinearRawVariables
      >(VIEWER_CREATED_ISSUES_QUERY, {
        ...variables,
        ...page,
        filter: filterInput
      })
      return result.data?.viewer?.createdIssues
    }
  }

  if (filter === 'completed') {
    return async (page) => {
      const result = await entry.client.client.rawRequest<
        LinearIssueConnectionResponse,
        LinearRawVariables
      >(VIEWER_ASSIGNED_ISSUES_QUERY, {
        ...variables,
        ...page,
        filter: filterInput
      })
      return result.data?.viewer?.assignedIssues
    }
  }

  return async (page) => {
    const result = await entry.client.client.rawRequest<
      LinearIssueConnectionResponse,
      LinearRawVariables
    >(ALL_ISSUES_QUERY, { ...variables, ...page, filter: filterInput })
    return result.data?.issues
  }
}

function shouldThrowAuthError(selection: LinearWorkspaceSelection | null | undefined): boolean {
  return selection !== 'all'
}

function linearWriteMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isDuplicateIdError(error: unknown): boolean {
  const message = linearWriteMessage(error).toLowerCase()
  return (
    message.includes('duplicate') ||
    message.includes('already exists') ||
    message.includes('already in use') ||
    message.includes('id has already')
  )
}

function errorCauseCode(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return ''
  }
  const cause = (error as { cause?: unknown }).cause
  if (!cause || typeof cause !== 'object') {
    return ''
  }
  const code = (cause as { code?: unknown }).code
  return typeof code === 'string' ? code.toLowerCase() : ''
}

function classifyLinearWriteFailure(error: unknown): LinearWriteFailure {
  if (error instanceof LinearWriteFailure) {
    return error
  }
  if (isDuplicateIdError(error)) {
    return new LinearWriteFailure('duplicate_id', linearWriteMessage(error), error)
  }
  const message = linearWriteMessage(error)
  const lower = message.toLowerCase()
  const code = errorCauseCode(error)
  if (
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    code === 'enotfound' ||
    code === 'econnrefused'
  ) {
    return new LinearWriteFailure('network', message, error)
  }
  if (
    lower.includes('abort') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('network') ||
    lower.includes('econnreset') ||
    lower.includes('fetch failed') ||
    lower.includes('socket')
  ) {
    return new LinearWriteFailure('unconfirmed', message, error)
  }
  return new LinearWriteFailure('failed', message, error)
}

async function runLinearWrite<T>(
  entry: LinearClientForWorkspace,
  signal: AbortSignal | undefined,
  write: (client: LinearClient) => Promise<T>
): Promise<T> {
  await acquire()
  try {
    const client = signal
      ? new (loadLinearSdk().LinearClient)({ apiKey: entry.apiKey, signal })
      : entry.client
    return await write(client)
  } catch (error) {
    if (error instanceof LinearWriteFailure) {
      throw error
    }
    if (isAuthError(error)) {
      clearToken(entry.workspace.id)
      throw error
    }
    throw classifyLinearWriteFailure(error)
  } finally {
    release()
  }
}

async function runLinearLookup<T>(
  entry: LinearClientForWorkspace,
  lookup: () => Promise<T>
): Promise<T | null> {
  await acquire()
  try {
    return await lookup()
  } catch (error) {
    if (isAuthError(error)) {
      clearToken(entry.workspace.id)
      throw error
    }
    if (isLinearLookupMiss(error)) {
      return null
    }
    throw error
  } finally {
    release()
  }
}

function isLinearLookupMiss(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  // Why: Linear throws for direct entity lookups that miss; write-id probes
  // need the same null shape as GraphQL nullable data, not a failed write.
  return message.includes('Entity not found:') && message.includes('Could not find referenced')
}

async function confirmLinearWrite<T>(message: string, readback: () => Promise<T>): Promise<T> {
  try {
    return await readback()
  } catch (error) {
    throw new LinearWriteFailure('unconfirmed', message, error)
  }
}

function mapRawCommentWriteRecord(
  comment: NonNullable<LinearCommentByUuidResponse['comment']>
): LinearCommentWriteRecord | null {
  const issue = comment.issue
  if (!issue?.id || !issue.identifier || !issue.url) {
    return null
  }
  const parentId = comment.parent?.id ?? null
  return {
    id: comment.id,
    url: comment.url ?? null,
    body: comment.body ?? '',
    issue: {
      id: issue.id,
      identifier: issue.identifier,
      url: issue.url
    },
    parentId,
    threadRootId: parentId ?? comment.id
  }
}

function mapRawAttachmentWriteRecord(
  attachment: NonNullable<LinearAttachmentByUuidResponse['attachment']>
): LinearAttachmentWriteRecord | null {
  const issue = attachment.issue
  if (!issue?.id || !issue.identifier || !issue.url || !attachment.url) {
    return null
  }
  return {
    id: attachment.id,
    title: attachment.title ?? attachment.url,
    url: attachment.url,
    issue: {
      id: issue.id,
      identifier: issue.identifier,
      url: issue.url
    }
  }
}

function mapRawIssueWriteRecord(
  issue: NonNullable<LinearIssueByUuidResponse['issue']>
): LinearIssueWriteRecord {
  return {
    ...issue,
    labels: issue.labels?.nodes ?? []
  }
}

export { mapIssueForWorkspace, sortAndLimitIssues, sortLimitAndDescribeIssues, mapRawIssueForWorkspace, readIssueConnectionPages, getOldestIssueTime, getListIssueConnectionLoader, shouldThrowAuthError, linearWriteMessage, isDuplicateIdError, errorCauseCode, classifyLinearWriteFailure, runLinearWrite, runLinearLookup, isLinearLookupMiss, confirmLinearWrite, mapRawCommentWriteRecord, mapRawAttachmentWriteRecord, mapRawIssueWriteRecord }

