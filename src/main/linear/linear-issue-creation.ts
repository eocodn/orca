import { acquire, clearToken, getClients, isAuthError, release } from './client'
import { LinearWriteFailure, type LinearIssueWriteRecord } from './linear-issue-primitives'
import { runLinearWrite, confirmLinearWrite } from './linear-issue-reads'
import { getCreatedIssueRecord } from './linear-issue-write-confirmation'
async function createIssue(
  teamId: string,
  title: string,
  description?: string,
  workspaceId?: string | null,
  options?: {
    id?: string
    parentId?: string
    projectId?: string | null
    stateId?: string
    priority?: number
    estimate?: number | null
    dueDate?: string | null
    assigneeId?: string | null
    labelIds?: string[]
  }
): Promise<
  | { ok: true; id: string; identifier: string; title: string; url: string }
  | { ok: false; error: string }
> {
  const entry = getClients(workspaceId)[0]
  if (!entry) {
    return { ok: false, error: 'Not connected to Linear' }
  }

  await acquire()
  try {
    const result = await entry.client.createIssue({
      ...(options?.id ? { id: options.id } : {}),
      teamId,
      title,
      ...(description ? { description } : {}),
      ...(options?.parentId ? { parentId: options.parentId } : {}),
      ...(options?.projectId ? { projectId: options.projectId } : {}),
      ...(options?.stateId ? { stateId: options.stateId } : {}),
      ...(options?.priority !== undefined ? { priority: options.priority } : {}),
      ...(options?.estimate !== undefined ? { estimate: options.estimate } : {}),
      ...(options?.dueDate !== undefined ? { dueDate: options.dueDate } : {}),
      ...(options?.assigneeId ? { assigneeId: options.assigneeId } : {}),
      ...(options?.labelIds ? { labelIds: options.labelIds } : {})
    })
    if (!result.success) {
      return { ok: false, error: 'Linear create failed' }
    }
    const issue = await result.issue
    if (!issue) {
      return { ok: false, error: 'Issue was created but could not be retrieved' }
    }
    return {
      ok: true,
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url
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

async function createIssueForAgent(
  teamId: string,
  title: string,
  description: string | undefined,
  workspaceId: string,
  options: {
    id: string
    parentId?: string | null
    projectId?: string | null
    stateId?: string
    assigneeId?: string | null
    priority?: number
    estimate?: number | null
    dueDate?: string | null
    labelIds?: string[]
    signal?: AbortSignal
  }
): Promise<LinearIssueWriteRecord> {
  const entry = getClients(workspaceId)[0]
  if (!entry) {
    throw new LinearWriteFailure('failed', 'Not connected to Linear')
  }

  return runLinearWrite(entry, options.signal, async (client) => {
    const result = await client.createIssue({
      id: options.id,
      teamId,
      title,
      ...(description ? { description } : {}),
      ...(options.parentId ? { parentId: options.parentId } : {}),
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(options.stateId ? { stateId: options.stateId } : {}),
      ...(options.assigneeId !== undefined ? { assigneeId: options.assigneeId } : {}),
      ...(options.priority !== undefined ? { priority: options.priority } : {}),
      ...(options.estimate !== undefined ? { estimate: options.estimate } : {}),
      ...(options.dueDate !== undefined ? { dueDate: options.dueDate } : {}),
      ...(options.labelIds !== undefined ? { labelIds: options.labelIds } : {})
    })
    if (!result.success) {
      throw new LinearWriteFailure('failed', 'Linear create failed')
    }
    const issue = await confirmLinearWrite(
      'Issue was created but could not be retrieved',
      async () => result.issue
    )
    if (!issue?.id) {
      throw new LinearWriteFailure('unconfirmed', 'Issue was created but could not be retrieved')
    }
    return confirmLinearWrite('Issue was created but could not be retrieved', () =>
      getCreatedIssueRecord(issue.id, client)
    )
  })
}

export { createIssue, createIssueForAgent }
