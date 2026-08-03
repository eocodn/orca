import { randomUUID, type LinearCurrentIssueContextHints, type LinearAttachResult, type LinearCommentAddResult, type LinearCreateResult, type LinearIssueTaskUpdateRequest, type LinearIssueTaskUpdateResult, LINEAR_WRITE_BODY_CAP, addLinearIssueCommentForAgent, createLinearIssueAttachment, createLinearIssueForAgent, getLinearIssueByUuidForAgent, updateLinearIssueForAgent, LinearWriteFailure, readLinearIssueContext, linearError, getLinearTeamLabelsOrThrow, getLinearTeamStatesOrThrow, type LinearAgentWriteTarget } from './orca-runtime-symbols'
import { OrcaRuntimeLinearIssueListForAgentsPart81 } from './orca-runtime-linear-issue-list-for-agents-part-81'

export class OrcaRuntimeLinearIssueUpdateTaskPart82 extends OrcaRuntimeLinearIssueListForAgentsPart81 {
  async linearIssueUpdateTask(
    params: LinearIssueTaskUpdateRequest
  ): Promise<LinearIssueTaskUpdateResult> {
    const target = await this.resolveLinearAgentWriteTarget(params)
    const current = await this.readLinearAgentIssueWriteRecord(target.issue.id, target.workspaceId)
    const update = await this.buildLinearTaskUpdate(params, current, target.workspaceId)
    if (!update) {
      throw linearError('linear_write_failed', 'No Linear task field update was requested.')
    }
    const alreadySet = this.linearTaskFieldAlreadySet(params.operation, current, update)
    if (!alreadySet) {
      await this.runLinearAgentWrite(
        async (signal) => {
          const updated = await updateLinearIssueForAgent(
            target.issue.id,
            update.fields,
            target.workspaceId,
            { signal }
          )
          if (!this.linearTaskFieldAlreadySet(params.operation, updated, update)) {
            throw new LinearWriteFailure(
              'unconfirmed',
              'Linear task field update could not be confirmed.'
            )
          }
          return updated
        },
        (cause) =>
          linearError(
            'linear_write_unconfirmed',
            'Linear may have applied the task update, but Orca could not confirm it.',
            {
              nextSteps: [
                `Run \`orca linear issue ${target.issue.identifier} --workspace ${target.workspaceId} --json\` and check the updated field before retrying.`
              ],
              ...(cause ? { cause } : {})
            }
          )
      )
    }
    await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
    const finalRecord = alreadySet
      ? current
      : await this.readLinearAgentIssueWriteRecord(target.issue.id, target.workspaceId)
    return this.linearTaskUpdateResult(
      params.operation,
      target.issue,
      target.workspaceId,
      current,
      finalRecord,
      alreadySet
    )
  }
  async linearIssueAddComment(params: {
    input?: string
    current?: boolean
    workspaceId?: string
    body: string
    replyTo?: string
    writeId?: string
    context?: LinearCurrentIssueContextHints
  }): Promise<LinearCommentAddResult> {
    if (params.body.length > LINEAR_WRITE_BODY_CAP) {
      throw linearError('linear_body_too_large', 'Linear comment body is too large.')
    }
    const target = await this.resolveLinearAgentWriteTarget(params)
    const parentId = params.replyTo
      ? await this.resolveLinearCommentParentId(target.issue.id, params.replyTo, target.workspaceId)
      : null
    const writeId = params.writeId ?? randomUUID()
    const existing =
      params.writeId !== undefined
        ? await this.getMatchingLinearCommentWrite(
            writeId,
            target.issue.id,
            parentId,
            target.workspaceId,
            true
          )
        : null
    if (existing) {
      await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
      return this.linearCommentResult(existing, target, params.body.length, writeId, true)
    }

    try {
      const comment = await this.runLinearAgentWrite(
        (signal) =>
          addLinearIssueCommentForAgent(target.issue.id, params.body, target.workspaceId, {
            id: writeId,
            parentId,
            signal
          }),
        (cause) =>
          this.linearCreateStyleUnconfirmed('comment', writeId, target, {
            parentId,
            bodyRequired: true,
            cause
          })
      )
      await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
      return this.linearCommentResult(comment, target, params.body.length, writeId, false)
    } catch (error) {
      if (error instanceof LinearWriteFailure && error.kind === 'duplicate_id') {
        const comment = await this.refetchLinearCommentAfterDuplicate(
          writeId,
          target.issue.id,
          parentId,
          target.workspaceId,
          () =>
            this.linearCreateStyleUnconfirmed('comment', writeId, target, {
              parentId,
              bodyRequired: true
            })
        )
        await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
        return this.linearCommentResult(comment, target, params.body.length, writeId, true)
      }
      throw error
    }
  }
  async linearIssueAttachLink(params: {
    input?: string
    current?: boolean
    workspaceId?: string
    url: string
    title?: string
    writeId?: string
    context?: LinearCurrentIssueContextHints
  }): Promise<LinearAttachResult> {
    const url = this.parseLinearAttachmentUrl(params.url)
    const target = await this.resolveLinearAgentWriteTarget(params)
    const writeId = params.writeId ?? randomUUID()
    const title = params.title?.trim() || this.defaultLinearAttachmentTitle(url)
    const existing =
      params.writeId !== undefined
        ? await this.getMatchingLinearAttachmentWrite(
            writeId,
            target.issue.id,
            target.workspaceId,
            true
          )
        : null
    if (existing) {
      await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
      return this.linearAttachResult(existing, target, writeId, true)
    }
    try {
      const attachment = await this.runLinearAgentWrite(
        (signal) =>
          createLinearIssueAttachment(
            target.issue.id,
            { id: writeId, title, url: url.toString() },
            target.workspaceId,
            { signal }
          ),
        (cause) =>
          this.linearCreateStyleUnconfirmed('attach', writeId, target, {
            title,
            url: url.toString(),
            cause
          })
      )
      await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
      return this.linearAttachResult(attachment, target, writeId, false)
    } catch (error) {
      if (error instanceof LinearWriteFailure && error.kind === 'duplicate_id') {
        const attachment = await this.refetchLinearAttachmentAfterDuplicate(
          writeId,
          target.issue.id,
          target.workspaceId,
          () =>
            this.linearCreateStyleUnconfirmed('attach', writeId, target, {
              title,
              url: url.toString()
            })
        )
        await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
        return this.linearAttachResult(attachment, target, writeId, true)
      }
      throw error
    }
  }
  async linearIssueCreate(params: {
    title: string
    body?: string
    teamInput?: string
    teamKey?: string
    state?: string
    assignee?: string
    priority?: number
    estimate?: number
    dueDate?: string
    labels?: string[]
    projectInput?: string
    parentInput?: string
    parentCurrent?: boolean
    workspaceId?: string
    writeId?: string
    context?: LinearCurrentIssueContextHints
  }): Promise<LinearCreateResult> {
    if ((params.body?.length ?? 0) > LINEAR_WRITE_BODY_CAP) {
      throw linearError('linear_body_too_large', 'Linear issue body is too large.')
    }
    const parent =
      params.parentInput || params.parentCurrent
        ? await this.resolveLinearAgentWriteTarget({
            input: params.parentInput,
            current: params.parentCurrent,
            workspaceId: params.workspaceId,
            context: params.context
          })
        : null
    if (parent && params.workspaceId && params.workspaceId !== parent.workspaceId) {
      throw linearError(
        'linear_invalid_workspace',
        'The parent issue belongs to a different workspace.'
      )
    }
    const team = await this.resolveLinearCreateTeam(
      params.teamInput ?? params.teamKey,
      params.workspaceId,
      parent
    )
    const createFields = await this.resolveLinearCreateFields(params, team)
    const parentId = parent?.issue.id ?? null
    const writeId = params.writeId ?? randomUUID()
    const existing =
      params.writeId !== undefined
        ? await this.getMatchingLinearCreatedIssue(
            writeId,
            team.id,
            parentId,
            team.workspaceId,

            true,
            createFields
          )
        : null
    if (existing) {
      if (parent) {
        await this.notifyLinearLinkedIssueUpdated(parent.workspaceId, parent.issue.identifier)
      }
      return this.linearCreateResult(existing, team.workspaceId, writeId, true)
    }

    try {
      const issue = await this.runLinearAgentWrite(
        async (signal) => {
          const created = await createLinearIssueForAgent(
            team.id,
            params.title,
            params.body,
            team.workspaceId,
            {
              id: writeId,
              parentId,
              ...createFields,
              signal
            }
          )
          if (!this.linearCreatedIssueMatchesIntent(created, createFields)) {
            throw new LinearWriteFailure(
              'unconfirmed',
              'Linear issue create could not be confirmed with the requested task fields.'
            )
          }
          return created
        },
        (cause) =>
          this.linearCreateStyleUnconfirmed('create', writeId, null, {
            team,
            parent,
            title: params.title,
            bodyRequired: params.body !== undefined,
            createFields,
            cause
          })
      )
      if (parent) {
        await this.notifyLinearLinkedIssueUpdated(parent.workspaceId, parent.issue.identifier)
      }
      return this.linearCreateResult(issue, team.workspaceId, writeId, false)
    } catch (error) {
      if (error instanceof LinearWriteFailure && error.kind === 'duplicate_id') {
        const issue = await this.refetchLinearIssueAfterDuplicate(
          writeId,
          team.id,
          parentId,
          team.workspaceId,
          createFields,
          () =>
            this.linearCreateStyleUnconfirmed('create', writeId, null, {
              team,
              parent,
              title: params.title,
              bodyRequired: params.body !== undefined,
              createFields
            })
        )
        if (parent) {
          await this.notifyLinearLinkedIssueUpdated(parent.workspaceId, parent.issue.identifier)
        }
        return this.linearCreateResult(issue, team.workspaceId, writeId, true)
      }
      throw error
    }
  }
  protected async resolveLinearAgentWriteTarget(params: {
    input?: string
    current?: boolean
    workspaceId?: string
    context?: LinearCurrentIssueContextHints
  }): Promise<LinearAgentWriteTarget> {
    const result = await readLinearIssueContext(
      {
        input: params.input,
        current: params.current,
        workspaceId: params.workspaceId,
        include: {
          comments: false,
          children: false,
          attachments: false,
          relations: false,
          activity: false
        },
        depth: 0,
        context: params.context
      },
      (context) => this.linearResolveCurrentIssue(context)
    )
    return { issue: result.issue, workspaceId: result.meta.resolved.workspaceId }
  }
  protected async getLinearTeamStatesForWrite(
    teamId: string,
    workspaceId: string
  ): Promise<Awaited<ReturnType<typeof getLinearTeamStatesOrThrow>>> {
    try {
      return await getLinearTeamStatesOrThrow(teamId, workspaceId)
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
  }
  protected resolveLinearAgentState(
    input: string,
    states: Awaited<ReturnType<typeof getLinearTeamStatesOrThrow>>
  ): Awaited<ReturnType<typeof getLinearTeamStatesOrThrow>>[number] | null {
    const normalized = input.toLocaleLowerCase()
    const exact = states.find(
      (state) =>
        state.id.toLocaleLowerCase() === normalized || state.name.toLocaleLowerCase() === normalized
    )
    // Why: Linear MCP accepts lifecycle types; keep explicit IDs/names authoritative when they collide.
    return exact ?? states.find((state) => state.type.toLocaleLowerCase() === normalized) ?? null
  }
  protected async getLinearTeamLabelsForWrite(
    teamId: string,
    workspaceId: string
  ): Promise<Awaited<ReturnType<typeof getLinearTeamLabelsOrThrow>>> {
    try {
      return await getLinearTeamLabelsOrThrow(teamId, workspaceId)
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
  }
  protected async readLinearAgentIssueWriteRecord(
    issueId: string,
    workspaceId: string
  ): Promise<NonNullable<Awaited<ReturnType<typeof getLinearIssueByUuidForAgent>>>> {
    const issue = await this.readLinearWriteLookup(() =>
      getLinearIssueByUuidForAgent(issueId, workspaceId)
    )
    if (!issue) {
      throw linearError('linear_issue_not_found', 'Linear issue was not found.')
    }
    return issue
  }
}
