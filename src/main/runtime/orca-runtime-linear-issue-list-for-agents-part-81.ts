import { resolve, type LinearCurrentIssueContextHints, type LinearIssueListFilter, type LinearIssueListResult, type LinearMcpIssueListRequest, type LinearMcpIssueListResult, type LinearIssueRelationWriteRequest, type LinearIssueRelationWriteResult, type LinearSaveIssueRequest, type LinearSaveIssueResult, type LinearStatusSetResult, LINEAR_WRITE_BODY_CAP, clampLinearIssueListLimit, isPathInsideOrEqual, listLinearIssues, updateLinearIssueForAgent, LinearWriteFailure, LinearAgentAccessError, getLinearCurrentIssueFromWorktree, resolveLegacyLinearLinkWorkspace, linearError, sanitizeLinearErrorMessage, listMcpIssues, writeIssueRelation, type ResolvedWorktree } from './orca-runtime-symbols'
import { OrcaRuntimeStartPtyTuiIdleFallbackPollPart80 } from './orca-runtime-start-pty-tui-idle-fallback-poll-part-80'

export class OrcaRuntimeLinearIssueListForAgentsPart81 extends OrcaRuntimeStartPtyTuiIdleFallbackPollPart80 {
  async linearIssueListForAgents(params: {
    filter?: LinearIssueListFilter
    teamInput?: string
    limit?: number
    workspaceId?: string | 'all'
  }): Promise<LinearIssueListResult> {
    const filter = params.filter ?? 'assigned'
    const limit = clampLinearIssueListLimit(params.limit)
    const team = params.teamInput
      ? await this.resolveLinearTeamInput(params.teamInput, params.workspaceId)
      : null
    const workspaceId = team?.workspaceId ?? params.workspaceId
    try {
      const result = await listLinearIssues(filter, limit, workspaceId, {
        teamId: team?.id
      })
      return {
        issues: result.items.map((issue) => ({
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          url: issue.url,
          state: issue.state,
          team: issue.team,
          project: issue.project ?? null,
          assignee: issue.assignee ?? null,
          priority: issue.priority,
          estimate: issue.estimate,
          dueDate: issue.dueDate,
          updatedAt: issue.updatedAt,
          workspace: {
            id: issue.workspaceId ?? workspaceId ?? '',
            name: issue.workspaceName ?? issue.workspaceId ?? workspaceId ?? ''
          }
        })),
        meta: {
          filter,
          workspaceId,
          ...(team ? { team: this.linearTeamSummary(team) } : {}),
          limit,
          returned: result.items.length,
          hasMore: result.hasMore === true,
          partial: (result.errors?.length ?? 0) > 0,
          workspaceErrors: (result.errors ?? []).map((error) => ({
            workspace: { id: error.workspaceId, name: error.workspaceName ?? error.workspaceId },
            code: this.linearWorkspaceErrorCode(error.type),
            message: sanitizeLinearErrorMessage(error.message)
          }))
        }
      }
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
  }
  async linearMcpIssueList(params: LinearMcpIssueListRequest): Promise<LinearMcpIssueListResult> {
    try {
      return await listMcpIssues(params)
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
  }
  async linearResolveCurrentIssue(
    context?: LinearCurrentIssueContextHints
  ): Promise<ReturnType<typeof getLinearCurrentIssueFromWorktree>> {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }

    let worktree: ResolvedWorktree | null = null
    if (context?.terminalHandle) {
      try {
        const terminal = await this.showTerminal(context.terminalHandle)
        if (context.worktreeId && context.worktreeId !== terminal.worktreeId) {
          throw new LinearAgentAccessError(
            'linear_permission_denied',
            'The provided Linear worktree context does not match the caller terminal.'
          )
        }
        worktree = await this.resolveWorktreeSelector(`id:${terminal.worktreeId}`)
      } catch (error) {
        if (error instanceof LinearAgentAccessError) {
          throw error
        }
        if (context.remote === true || context.worktreeId) {
          throw new LinearAgentAccessError(
            'linear_issue_required',
            'Could not verify the current Linear-linked worktree.'
          )
        }
      }
    }

    if (!worktree && context?.remote !== true && context?.cwd) {
      worktree = await this.resolveWorktreeForContainedPath(context.cwd)
      if (!worktree) {
        throw new LinearAgentAccessError(
          'linear_issue_required',
          'Run --current from inside an Orca-managed worktree or pass an issue id.'
        )
      }
    }

    if (!worktree) {
      throw new LinearAgentAccessError(
        'linear_issue_required',
        'Run --current from inside an Orca-managed worktree or pass an issue id.'
      )
    }

    const link = getLinearCurrentIssueFromWorktree(worktree)
    if (!link.workspaceId) {
      const backfill = resolveLegacyLinearLinkWorkspace(
        worktree.linkedLinearIssue ?? '',
        worktree.linkedLinearIssueOrganizationUrlKey
      )
      if (backfill?.workspaceId) {
        this.store.setWorktreeMeta(worktree.id, {
          linkedLinearIssueWorkspaceId: backfill.workspaceId,
          linkedLinearIssueOrganizationUrlKey: backfill.organizationUrlKey ?? null
        })
        return {
          ...link,
          workspaceId: backfill.workspaceId,
          organizationUrlKey: backfill.organizationUrlKey ?? link.organizationUrlKey,
          backfill
        }
      }
    }
    return link
  }
  protected async resolveWorktreeForContainedPath(cwd: string): Promise<ResolvedWorktree | null> {
    const currentPath = resolve(cwd)
    let best: ResolvedWorktree | null = null
    for (const candidate of await this.listResolvedWorktrees()) {
      if (!isPathInsideOrEqual(candidate.path, currentPath)) {
        continue
      }
      if (!best || candidate.path.length > best.path.length) {
        best = candidate
      }
    }
    return best
  }
  async linearIssueSetState(params: {
    input?: string
    current?: boolean
    workspaceId?: string
    to: string
    context?: LinearCurrentIssueContextHints
  }): Promise<LinearStatusSetResult> {
    const target = await this.resolveLinearAgentWriteTarget(params)
    const teamId = target.issue.team?.id
    if (!teamId) {
      throw linearError('linear_invalid_state', 'The Linear issue does not have a team.')
    }
    const states = await this.getLinearTeamStatesForWrite(teamId, target.workspaceId)
    const state = this.resolveLinearAgentState(params.to, states)
    if (!state) {
      throw linearError(
        'linear_invalid_state',
        `No workflow state exactly matched "${params.to}".`,
        {
          states: states.map(({ id, name, type }) => ({ id, name, type })),
          nextSteps: [`Retry with one of the exact state names for ${target.issue.identifier}.`]
        }
      )
    }

    const previousState =
      target.issue.state?.id && target.issue.state.name
        ? { id: target.issue.state.id, name: target.issue.state.name }
        : null
    const alreadyInState = target.issue.state?.id === state.id
    if (!alreadyInState) {
      await this.runLinearAgentWrite(
        async (signal) => {
          const updated = await updateLinearIssueForAgent(
            target.issue.id,
            { stateId: state.id },
            target.workspaceId,
            {
              signal
            }
          )
          if (updated.state?.id !== state.id) {
            throw new LinearWriteFailure(
              'unconfirmed',
              'Linear state update could not be confirmed.'
            )
          }
          return updated
        },
        (cause) =>
          linearError(
            'linear_write_unconfirmed',
            'Linear may have applied the state change, but Orca could not confirm it.',
            {
              nextSteps: [
                `Run \`orca linear issue ${target.issue.identifier} --workspace ${target.workspaceId} --json\` and check the current state before retrying.`
              ],
              ...(cause ? { cause } : {})
            }
          )
      )
    }
    await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
    return {
      issue: this.linearWriteIssueRef(target.issue),
      state: { id: state.id, name: state.name, type: state.type },
      previousState,
      meta: { workspaceId: target.workspaceId, alreadyInState }
    }
  }
  async linearIssueRelationWrite(
    params: LinearIssueRelationWriteRequest
  ): Promise<LinearIssueRelationWriteResult> {
    const target = await this.resolveLinearAgentWriteTarget(params)
    const related = await this.resolveLinearAgentWriteTarget({
      input: params.relatedInput,
      workspaceId: target.workspaceId,
      context: params.context
    })
    if (target.issue.id === related.issue.id) {
      throw linearError('linear_write_failed', 'An issue cannot be related to itself.')
    }
    try {
      const result = await this.runLinearAgentWrite(
        (signal) =>
          writeIssueRelation({
            issue: { ...this.linearWriteIssueRef(target.issue), title: target.issue.title },
            relatedIssue: {
              ...this.linearWriteIssueRef(related.issue),
              title: related.issue.title
            },
            relationship: params.relationship,
            operation: params.operation,
            workspaceId: target.workspaceId,
            signal
          }),
        (cause) =>
          linearError(
            'linear_write_unconfirmed',
            'Linear may have applied the relation change, but Orca could not confirm it.',
            {
              nextSteps: [
                `Run \`orca linear issue ${target.issue.identifier} --relations --workspace ${target.workspaceId} --json\` before retrying.`
              ],
              ...(cause ? { cause } : {})
            }
          )
      )
      await this.notifyLinearLinkedIssueUpdated(target.workspaceId, [
        target.issue.identifier,
        related.issue.identifier
      ])
      return result
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
  }
  async linearSaveIssue(params: LinearSaveIssueRequest): Promise<LinearSaveIssueResult> {
    if ((params.description?.length ?? 0) > LINEAR_WRITE_BODY_CAP) {
      throw linearError('linear_body_too_large', 'Linear issue body is too large.')
    }
    if (!params.input && !params.current) {
      if (!params.title || !params.team) {
        throw linearError(
          'linear_write_failed',
          'Creating with save-issue requires both team and title.'
        )
      }
      const created = await this.linearIssueCreate({
        title: params.title,
        body: params.description,
        teamInput: params.team,
        state: params.state,
        assignee: params.assignee ?? undefined,
        priority: params.priority,
        estimate: params.estimate ?? undefined,
        dueDate: params.dueDate ?? undefined,
        labels: params.labels,
        projectInput: params.project ?? undefined,
        parentInput: params.parentId ?? undefined,
        workspaceId: params.workspaceId,
        writeId: params.writeId,
        context: params.context
      })
      return { ...created, meta: { ...created.meta, created: true } }
    }
    if (params.team !== undefined) {
      throw linearError('linear_write_failed', 'Team can only be set when creating an issue.')
    }
    const target = await this.resolveLinearAgentWriteTarget(params)
    const current = await this.readLinearAgentIssueWriteRecord(target.issue.id, target.workspaceId)
    const fields = await this.buildLinearSaveUpdate(params, current, target.workspaceId)
    if (Object.keys(fields).length === 0) {
      throw linearError('linear_write_failed', 'No issue fields were provided to save.')
    }
    const alreadySet = this.linearSavedIssueMatchesIntent(current, fields)
    const updated = alreadySet
      ? current
      : await this.runLinearAgentWrite(
          async (signal) => {
            const saved = await updateLinearIssueForAgent(
              target.issue.id,
              fields,
              target.workspaceId,
              { signal }
            )
            if (!this.linearSavedIssueMatchesIntent(saved, fields)) {
              throw new LinearWriteFailure(
                'unconfirmed',
                'Linear issue save could not be confirmed.'
              )
            }
            return saved
          },
          (cause) =>
            linearError(
              'linear_write_unconfirmed',
              'Linear may have applied the issue save, but Orca could not confirm it.',
              {
                nextSteps: [
                  `Run \`orca linear issue ${target.issue.identifier} --workspace ${target.workspaceId} --json\` before retrying.`
                ],
                ...(cause ? { cause } : {})
              }
            )
        )
    await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
    return {
      issue: updated,
      meta: {
        workspaceId: target.workspaceId,
        created: false
      }
    }
  }
}
