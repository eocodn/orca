import type {
  LinearIssueUpdate
} from '../../shared/types'
import type { LinearClient } from '@linear/sdk'
import { acquire, clearToken, getClients, isAuthError, release } from './client'
import {
  ATTACHMENT_BY_UUID_QUERY,
  COMMENT_BY_UUID_QUERY,
  ISSUE_BY_UUID_QUERY
} from './linear-issue-queries'
import { type LinearRawVariables, LinearWriteFailure, type LinearIssueWriteRecord, type LinearCommentWriteRecord, type LinearAttachmentWriteRecord, type LinearIssueByUuidResponse, type LinearCommentByUuidResponse, type LinearAttachmentByUuidResponse } from './linear-issue-primitives'
import { runLinearWrite, confirmLinearWrite, mapRawCommentWriteRecord, mapRawAttachmentWriteRecord, mapRawIssueWriteRecord } from './linear-issue-reads'
async function getCreatedIssueRecord(
  issueId: string,
  client: LinearClient
): Promise<LinearIssueWriteRecord> {
  const result = await client.client.rawRequest<LinearIssueByUuidResponse, LinearRawVariables>(
    ISSUE_BY_UUID_QUERY,
    { id: issueId }
  )
  const record = result.data?.issue ?? null
  if (!record) {
    throw new LinearWriteFailure('unconfirmed', 'Issue was created but could not be retrieved')
  }
  return mapRawIssueWriteRecord(record)
}

async function updateIssue(
  id: string,
  updates: LinearIssueUpdate,
  workspaceId?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const entry = getClients(workspaceId)[0]
  if (!entry) {
    return { ok: false, error: 'Not connected to Linear' }
  }

  await acquire()
  try {
    // Why: labelIds is a full-replace field — a TOCTOU race exists if another
    // user changes labels between fetch and write. The caller passes the
    // complete set built from recently-fetched data. Acceptable for v1;
    // a future version could re-fetch right before writing or use webhooks.
    const resolvedLabelIds = updates.labelIds

    const payload: Record<string, unknown> = {}
    if (updates.stateId !== undefined) {
      payload.stateId = updates.stateId
    }
    if (updates.title !== undefined) {
      payload.title = updates.title
    }
    if (updates.description !== undefined) {
      payload.description = updates.description
    }
    if (updates.assigneeId !== undefined) {
      payload.assigneeId = updates.assigneeId
    }
    if (updates.estimate !== undefined) {
      payload.estimate = updates.estimate
    }
    if (updates.priority !== undefined) {
      payload.priority = updates.priority
    }
    if (updates.dueDate !== undefined) {
      payload.dueDate = updates.dueDate
    }
    if (resolvedLabelIds !== undefined) {
      payload.labelIds = resolvedLabelIds
    }
    if (updates.projectId !== undefined) {
      payload.projectId = updates.projectId
    }
    if (updates.parentId !== undefined) {
      payload.parentId = updates.parentId
    }

    const result = await entry.client.updateIssue(id, payload)
    if (!result.success) {
      return { ok: false, error: 'Linear update failed' }
    }
    return { ok: true }
  } catch (error) {
    if (isAuthError(error)) {
      clearToken(entry.workspace.id)
      throw error
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  } finally {
    release()
  }
}

async function updateIssueForAgent(
  id: string,
  updates: LinearIssueUpdate,
  workspaceId: string,
  options: { signal?: AbortSignal } = {}
): Promise<LinearIssueWriteRecord> {
  const entry = getClients(workspaceId)[0]
  if (!entry) {
    throw new LinearWriteFailure('failed', 'Not connected to Linear')
  }

  return runLinearWrite(entry, options.signal, async (client) => {
    const payload: Record<string, unknown> = {}
    if (updates.stateId !== undefined) {
      payload.stateId = updates.stateId
    }
    if (updates.title !== undefined) {
      payload.title = updates.title
    }
    if (updates.description !== undefined) {
      payload.description = updates.description
    }
    if (updates.assigneeId !== undefined) {
      payload.assigneeId = updates.assigneeId
    }
    if (updates.priority !== undefined) {
      payload.priority = updates.priority
    }
    if (updates.estimate !== undefined) {
      payload.estimate = updates.estimate
    }
    if (updates.dueDate !== undefined) {
      payload.dueDate = updates.dueDate
    }
    if (updates.labelIds !== undefined) {
      payload.labelIds = updates.labelIds
    }
    if (updates.projectId !== undefined) {
      payload.projectId = updates.projectId
    }
    if (updates.parentId !== undefined) {
      payload.parentId = updates.parentId
    }
    const result = await client.updateIssue(id, payload)
    if (!result.success) {
      throw new LinearWriteFailure('failed', 'Linear update failed')
    }
    return confirmLinearWrite('Issue was updated but could not be retrieved', () =>
      getCreatedIssueRecord(id, client)
    )
  })
}

async function addIssueComment(
  issueId: string,
  body: string,
  workspaceId?: string | null,
  options?: { id?: string; parentId?: string | null }
): Promise<
  | { ok: true; id: string; url?: string | null; parentId?: string | null }
  | { ok: false; error: string }
> {
  const entry = getClients(workspaceId)[0]
  if (!entry) {
    return { ok: false, error: 'Not connected to Linear' }
  }

  await acquire()
  try {
    const result = await entry.client.createComment({
      ...(options?.id ? { id: options.id } : {}),
      issueId,
      body,
      ...(options?.parentId ? { parentId: options.parentId } : {})
    })
    if (!result.success) {
      return { ok: false, error: 'Failed to create comment' }
    }
    const comment = await result.comment
    return {
      ok: true,
      id: comment?.id ?? '',
      url: comment?.url ?? null,
      parentId: options?.parentId ?? null
    }
  } catch (error) {
    if (isAuthError(error)) {
      clearToken(entry.workspace.id)
      throw error
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  } finally {
    release()
  }
}

async function addIssueCommentForAgent(
  issueId: string,
  body: string,
  workspaceId: string,
  options: { id: string; parentId?: string | null; signal?: AbortSignal }
): Promise<LinearCommentWriteRecord> {
  const entry = getClients(workspaceId)[0]
  if (!entry) {
    throw new LinearWriteFailure('failed', 'Not connected to Linear')
  }

  return runLinearWrite(entry, options.signal, async (client) => {
    const result = await client.createComment({
      id: options.id,
      issueId,
      body,
      ...(options.parentId ? { parentId: options.parentId } : {})
    })
    if (!result.success) {
      throw new LinearWriteFailure('failed', 'Failed to create comment')
    }
    const comment = await confirmLinearWrite(
      'Comment was created but could not be retrieved',
      async () => result.comment
    )
    if (!comment?.id) {
      throw new LinearWriteFailure('unconfirmed', 'Comment was created but could not be retrieved')
    }
    const record = await confirmLinearWrite('Comment was created but could not be retrieved', () =>
      readCommentWriteRecord(client, comment.id)
    )
    if (!record) {
      throw new LinearWriteFailure('unconfirmed', 'Comment was created but could not be retrieved')
    }
    return record
  })
}

async function createIssueAttachment(
  issueId: string,
  input: { id: string; title: string; url: string },
  workspaceId: string,
  options: { signal?: AbortSignal } = {}
): Promise<LinearAttachmentWriteRecord> {
  const entry = getClients(workspaceId)[0]
  if (!entry) {
    throw new LinearWriteFailure('failed', 'Not connected to Linear')
  }

  return runLinearWrite(entry, options.signal, async (client) => {
    const result = await client.createAttachment({
      id: input.id,
      issueId,
      title: input.title,
      url: input.url
    })
    if (!result.success) {
      throw new LinearWriteFailure('failed', 'Failed to create attachment')
    }
    const attachment = await confirmLinearWrite(
      'Attachment was created but could not be retrieved',
      async () => result.attachment
    )
    if (!attachment?.id) {
      throw new LinearWriteFailure(
        'unconfirmed',
        'Attachment was created but could not be retrieved'
      )
    }
    const record = await confirmLinearWrite(
      'Attachment was created but could not be retrieved',
      () => readAttachmentWriteRecord(client, attachment.id)
    )
    if (!record) {
      throw new LinearWriteFailure(
        'unconfirmed',
        'Attachment was created but could not be retrieved'
      )
    }
    return record
  })
}

async function readCommentWriteRecord(
  client: LinearClient,
  id: string
): Promise<LinearCommentWriteRecord | null> {
  const result = await client.client.rawRequest<LinearCommentByUuidResponse, LinearRawVariables>(
    COMMENT_BY_UUID_QUERY,
    { id }
  )
  const comment = result.data?.comment
  return comment ? mapRawCommentWriteRecord(comment) : null
}

async function readAttachmentWriteRecord(
  client: LinearClient,
  id: string
): Promise<LinearAttachmentWriteRecord | null> {
  const result = await client.client.rawRequest<LinearAttachmentByUuidResponse, LinearRawVariables>(
    ATTACHMENT_BY_UUID_QUERY,
    { id }
  )
  const attachment = result.data?.attachment
  return attachment ? mapRawAttachmentWriteRecord(attachment) : null
}

export { getCreatedIssueRecord, updateIssue, updateIssueForAgent, addIssueComment, addIssueCommentForAgent, createIssueAttachment, readCommentWriteRecord, readAttachmentWriteRecord }
