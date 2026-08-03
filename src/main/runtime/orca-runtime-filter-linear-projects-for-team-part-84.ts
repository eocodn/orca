import { type LinearProjectSummary, type LinearIssueSummary, type LinearIssueTaskUpdateRequest, type LinearIssueTaskUpdateResult, isLinearAuthError, getLinearAttachmentByUuidForAgent, getLinearCommentByUuidForAgent, getLinearIssueByUuidForAgent, getLinearIssueCommentThreadRoot, LinearWriteFailure, LinearAgentAccessError, classifyLinearError, linearError, linearMessage, sanitizeLinearErrorMessage, listLinearProjectTeams, getLinearViewerForWorkspaceOrThrow, type LinearCreateFieldIntent, sameStringSet } from './orca-runtime-symbols'
import { OrcaRuntimeBuildLinearTaskUpdatePart83 } from './orca-runtime-build-linear-task-update-part-83'

export class OrcaRuntimeFilterLinearProjectsForTeamPart84 extends OrcaRuntimeBuildLinearTaskUpdatePart83 {
  protected async filterLinearProjectsForTeam(
    projects: LinearProjectSummary[],
    teamId: string,
    workspaceId: string
  ): Promise<LinearProjectSummary[]> {
    const compatible: LinearProjectSummary[] = []
    for (const project of projects) {
      if (this.linearProjectIncludesTeam(project, teamId)) {
        compatible.push(project)
        continue
      }
      try {
        const teams = await listLinearProjectTeams(project.id, workspaceId, true)
        if (teams.some((team) => team.id === teamId)) {
          compatible.push({ ...project, teams })
        }
      } catch (error) {
        throw this.mapLinearReadFailure(error)
      }
    }
    return compatible
  }
  protected linearProjectIncludesTeam(project: LinearProjectSummary, teamId: string): boolean {
    return project.teams?.some((team) => team.id === teamId) === true
  }
  protected async getLinearViewerForWrite(
    workspaceId: string
  ): Promise<{ id: string; displayName?: string | null; avatarUrl?: string | null }> {
    try {
      return await getLinearViewerForWorkspaceOrThrow(workspaceId)
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
  }
  protected async resolveLinearLabelsForIssue(
    issue: NonNullable<Awaited<ReturnType<typeof getLinearIssueByUuidForAgent>>>,
    inputs: string[],
    workspaceId: string
  ): Promise<{ id: string; name: string }[]> {
    const labels = await this.getLinearTeamLabelsForWrite(issue.team.id, workspaceId)
    const resolved = inputs.map((input) => {
      const normalized = input.toLocaleLowerCase()
      const idMatch = labels.find((label) => label.id.toLocaleLowerCase() === normalized)
      if (idMatch) {
        return { id: idMatch.id, name: idMatch.name }
      }
      const nameMatches = labels.filter((label) => label.name.toLocaleLowerCase() === normalized)
      if (nameMatches.length === 1) {
        return { id: nameMatches[0].id, name: nameMatches[0].name }
      }
      throw linearError(
        'linear_invalid_label',
        nameMatches.length === 0
          ? `No label exactly matched "${input}".`
          : `Multiple labels exactly matched "${input}".`,
        {
          labels: labels.map((label) => ({ id: label.id, name: label.name })),
          nextSteps: ['Run `orca linear team labels --team <key-or-id> --json` and retry by id.']
        }
      )
    })
    return Array.from(new Map(resolved.map((label) => [label.id, label])).values())
  }
  protected async resolveLinearLabelsForTeam(
    teamId: string,
    inputs: string[],
    workspaceId: string
  ): Promise<{ id: string; name: string }[]> {
    const labels = await this.getLinearTeamLabelsForWrite(teamId, workspaceId)
    const resolved = inputs.map((input) => {
      const normalized = input.toLocaleLowerCase()
      const idMatch = labels.find((label) => label.id.toLocaleLowerCase() === normalized)
      if (idMatch) {
        return { id: idMatch.id, name: idMatch.name }
      }
      const nameMatches = labels.filter((label) => label.name.toLocaleLowerCase() === normalized)
      if (nameMatches.length === 1) {
        return { id: nameMatches[0].id, name: nameMatches[0].name }
      }
      throw linearError(
        'linear_invalid_label',
        nameMatches.length === 0
          ? `No label exactly matched "${input}".`
          : `Multiple labels exactly matched "${input}".`,
        { labels: labels.map((label) => ({ id: label.id, name: label.name })) }
      )
    })
    return Array.from(new Map(resolved.map((label) => [label.id, label])).values())
  }
  protected linearCreatedIssueMatchesIntent(
    issue: NonNullable<Awaited<ReturnType<typeof getLinearIssueByUuidForAgent>>>,
    intent: LinearCreateFieldIntent
  ): boolean {
    if (intent.stateId !== undefined && issue.state?.id !== intent.stateId) {
      return false
    }
    if (intent.assigneeId !== undefined && (issue.assignee?.id ?? null) !== intent.assigneeId) {
      return false
    }
    if (intent.priority !== undefined && issue.priority !== intent.priority) {
      return false
    }
    if (intent.estimate !== undefined && (issue.estimate ?? null) !== intent.estimate) {
      return false
    }
    if (intent.dueDate !== undefined && (issue.dueDate ?? null) !== intent.dueDate) {
      return false
    }
    if (intent.projectId !== undefined && (issue.project?.id ?? null) !== intent.projectId) {
      return false
    }
    const issueLabelIds = issue.labelIds ?? issue.labels?.map((label) => label.id) ?? []
    if (intent.labelIds !== undefined && !sameStringSet(issueLabelIds, intent.labelIds)) {
      return false
    }
    return true
  }
  protected linearTaskFieldAlreadySet(
    operation: LinearIssueTaskUpdateRequest['operation'],
    record: NonNullable<Awaited<ReturnType<typeof getLinearIssueByUuidForAgent>>>,
    update: {
      fields: {
        assigneeId?: string | null
        priority?: number
        estimate?: number | null
        dueDate?: string | null
        labelIds?: string[]
      }
    }
  ): boolean {
    if (operation === 'assignee') {
      return (record.assignee?.id ?? null) === update.fields.assigneeId
    }
    if (operation === 'priority') {
      return record.priority === update.fields.priority
    }
    if (operation === 'estimate') {
      return (record.estimate ?? null) === update.fields.estimate
    }
    if (operation === 'dueDate') {
      return (record.dueDate ?? null) === update.fields.dueDate
    }
    if (operation === 'labels') {
      const recordLabelIds = record.labelIds ?? record.labels?.map((label) => label.id) ?? []
      return sameStringSet(recordLabelIds, update.fields.labelIds ?? [])
    }
    return false
  }
  protected linearTaskUpdateResult(
    operation: LinearIssueTaskUpdateRequest['operation'],
    issue: LinearIssueSummary,
    workspaceId: string,
    previous: NonNullable<Awaited<ReturnType<typeof getLinearIssueByUuidForAgent>>>,
    current: NonNullable<Awaited<ReturnType<typeof getLinearIssueByUuidForAgent>>>,
    alreadySet: boolean
  ): LinearIssueTaskUpdateResult {
    return {
      issue: this.linearWriteIssueRef(issue),
      operation,
      previous: this.linearTaskResultFields(previous),
      current: this.linearTaskResultFields(current),
      meta: { workspaceId, alreadySet }
    }
  }
  protected linearTaskResultFields(
    record: NonNullable<Awaited<ReturnType<typeof getLinearIssueByUuidForAgent>>>
  ): LinearIssueTaskUpdateResult['current'] {
    return {
      assignee: record.assignee ?? null,
      priority: record.priority ?? null,
      estimate: record.estimate ?? null,
      dueDate: record.dueDate ?? null,
      labels: record.labels ?? []
    }
  }
  protected async resolveLinearCommentParentId(
    issueId: string,
    commentId: string,
    workspaceId: string
  ): Promise<string> {
    try {
      const root = await getLinearIssueCommentThreadRoot(issueId, commentId, workspaceId)
      if (!root) {
        throw linearError(
          'linear_invalid_parent',
          'The reply target is not a comment on this issue.',
          {
            nextSteps: ['Run `orca linear issue <id> --comments --json` to list valid comment ids.']
          }
        )
      }
      return root.id
    } catch (error) {
      if (error instanceof LinearAgentAccessError) {
        throw error
      }
      throw this.mapLinearReadFailure(error)
    }
  }

  protected async runLinearAgentWrite<T>(
    write: (signal: AbortSignal) => Promise<T>,
    unconfirmed: (cause?: string) => LinearAgentAccessError
  ): Promise<T> {
    const controller = new AbortController()
    const writePromise = write(controller.signal)
    writePromise.catch(() => undefined)
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      return await Promise.race([
        writePromise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort()
            reject(
              new LinearWriteFailure(
                'unconfirmed',
                'Linear write deadline elapsed before confirmation.'
              )
            )
          }, 25_000)
        })
      ])
    } catch (error) {
      if (error instanceof LinearWriteFailure && error.kind === 'duplicate_id') {
        throw error
      }
      if (error instanceof LinearWriteFailure && error.kind === 'unconfirmed') {
        throw unconfirmed(this.linearWriteFailureCauseMessage(error))
      }
      if (error instanceof LinearWriteFailure && error.kind === 'network') {
        throw linearError('linear_network_error', sanitizeLinearErrorMessage(error.message))
      }
      if (error instanceof LinearWriteFailure) {
        throw linearError('linear_write_failed', sanitizeLinearErrorMessage(error.message))
      }
      throw this.mapLinearReadFailure(error)
    } finally {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }
  protected linearWriteFailureCauseMessage(error: LinearWriteFailure): string {
    if (error.cause instanceof Error) {
      return sanitizeLinearErrorMessage(error.cause.message)
    }
    if (error.cause !== undefined) {
      return sanitizeLinearErrorMessage(String(error.cause))
    }
    return sanitizeLinearErrorMessage(error.message)
  }
  protected mapLinearReadFailure(error: unknown): LinearAgentAccessError {
    if (error instanceof LinearAgentAccessError) {
      return error
    }
    if (isLinearAuthError(error)) {
      return linearError('linear_auth_expired', 'Linear authentication expired.', {
        nextSteps: ['Reconnect Linear from Orca settings.']
      })
    }
    return linearError(classifyLinearError(error), linearMessage(error))
  }
  protected async getMatchingLinearCommentWrite(
    writeId: string,
    issueId: string,
    parentId: string | null,
    workspaceId: string,
    required: boolean
  ): Promise<Awaited<ReturnType<typeof getLinearCommentByUuidForAgent>> | null> {
    const comment = await this.readLinearWriteLookup(() =>
      getLinearCommentByUuidForAgent(writeId, workspaceId)
    )
    if (!comment) {
      return null
    }
    if (comment.issue.id === issueId && comment.parentId === parentId) {
      return comment
    }
    if (required) {
      throw linearError(
        'linear_invalid_write_id',
        'The write id belongs to a different comment target.'
      )
    }
    return null
  }
  protected async getMatchingLinearAttachmentWrite(
    writeId: string,
    issueId: string,
    workspaceId: string,
    required: boolean
  ): Promise<Awaited<ReturnType<typeof getLinearAttachmentByUuidForAgent>> | null> {
    const attachment = await this.readLinearWriteLookup(() =>
      getLinearAttachmentByUuidForAgent(writeId, workspaceId)
    )
    if (!attachment) {
      return null
    }
    if (attachment.issue.id === issueId) {
      return attachment
    }
    if (required) {
      throw linearError(
        'linear_invalid_write_id',
        'The write id belongs to a different attachment target.'
      )
    }
    return null
  }
  protected async getMatchingLinearCreatedIssue(
    writeId: string,
    teamId: string,
    parentId: string | null,
    workspaceId: string,
    required: boolean,
    intent: LinearCreateFieldIntent = {}
  ): Promise<Awaited<ReturnType<typeof getLinearIssueByUuidForAgent>> | null> {
    const issue = await this.readLinearWriteLookup(() =>
      getLinearIssueByUuidForAgent(writeId, workspaceId)
    )
    if (!issue) {
      return null
    }
    if (
      issue.team.id === teamId &&
      (issue.parent?.id ?? null) === parentId &&
      this.linearCreatedIssueMatchesIntent(issue, intent)
    ) {
      return issue
    }
    if (required) {
      throw linearError(
        'linear_invalid_write_id',
        'The write id belongs to a different issue target.'
      )
    }
    return null
  }
  protected async refetchLinearCommentAfterDuplicate(
    writeId: string,
    issueId: string,
    parentId: string | null,
    workspaceId: string,
    unconfirmed: (cause?: string) => LinearAgentAccessError
  ): Promise<NonNullable<Awaited<ReturnType<typeof getLinearCommentByUuidForAgent>>>> {
    try {
      // Why: a duplicate-id response can mean the original write landed; only the exact target relationship proves this pinned retry.
      const comment = await this.getMatchingLinearCommentWrite(
        writeId,
        issueId,
        parentId,
        workspaceId,
        true
      )
      if (comment) {
        return comment
      }
    } catch (error) {
      if (error instanceof LinearAgentAccessError && error.code === 'linear_invalid_write_id') {
        throw error
      }
      throw unconfirmed(
        error instanceof Error
          ? sanitizeLinearErrorMessage(error.message)
          : sanitizeLinearErrorMessage(String(error))
      )
    }
    throw unconfirmed()
  }
  protected async refetchLinearAttachmentAfterDuplicate(
    writeId: string,
    issueId: string,
    workspaceId: string,
    unconfirmed: (cause?: string) => LinearAgentAccessError
  ): Promise<NonNullable<Awaited<ReturnType<typeof getLinearAttachmentByUuidForAgent>>>> {
    try {
      // Why: a duplicate-id response can mean the original write landed; only the exact target relationship proves this pinned retry.
      const attachment = await this.getMatchingLinearAttachmentWrite(
        writeId,
        issueId,
        workspaceId,
        true
      )
      if (attachment) {
        return attachment
      }
    } catch (error) {
      if (error instanceof LinearAgentAccessError && error.code === 'linear_invalid_write_id') {
        throw error
      }
      throw unconfirmed(
        error instanceof Error
          ? sanitizeLinearErrorMessage(error.message)
          : sanitizeLinearErrorMessage(String(error))
      )
    }
    throw unconfirmed()
  }
}
