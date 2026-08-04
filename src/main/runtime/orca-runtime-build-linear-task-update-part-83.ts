import type { getLinearIssueByUuidForAgent} from './orca-runtime-symbols';
import { type LinearIssueUpdate, type LinearProjectSummary, type LinearIssueTaskUpdateRequest, type LinearSaveIssueRequest, LINEAR_SEARCH_MAX_LIMIT, isLinearUuid, linearError, getLinearProject, listLinearProjectsByExactName, listLinearProjectTeams, listLinearProjects, getLinearTeamMembersOrThrow, type LinearCreateFieldIntent, sameStringSet, labelsForIds } from './orca-runtime-symbols'
import { OrcaRuntimeLinearIssueUpdateTaskPart82 } from './orca-runtime-linear-issue-update-task-part-82'

export class OrcaRuntimeBuildLinearTaskUpdatePart83 extends OrcaRuntimeLinearIssueUpdateTaskPart82 {
  protected async buildLinearTaskUpdate(
    params: LinearIssueTaskUpdateRequest,
    current: NonNullable<Awaited<ReturnType<typeof getLinearIssueByUuidForAgent>>>,
    workspaceId: string
  ): Promise<{
    fields: {
      assigneeId?: string | null
      priority?: number
      estimate?: number | null
      dueDate?: string | null
      labelIds?: string[]
    }
    labels?: { id: string; name: string }[]
  } | null> {
    if (params.operation === 'assignee') {
      const assigneeId = params.assigneeMe
        ? (await this.getLinearViewerForWrite(workspaceId)).id
        : params.assigneeId
      if (assigneeId === undefined) {
        throw linearError('linear_invalid_assignee', 'Pass --me, --to-id, or clear assignee.')
      }
      return { fields: { assigneeId } }
    }
    if (params.operation === 'priority') {
      if (params.priority === undefined) {
        throw linearError('linear_write_failed', 'Missing priority value.')
      }
      return { fields: { priority: params.priority } }
    }
    if (params.operation === 'estimate') {
      if (params.estimate === undefined) {
        throw linearError('linear_write_failed', 'Missing estimate value.')
      }
      return { fields: { estimate: params.estimate } }
    }
    if (params.operation === 'dueDate') {
      if (params.dueDate === undefined) {
        throw linearError('linear_write_failed', 'Missing due date value.')
      }
      return { fields: { dueDate: params.dueDate } }
    }
    if (params.operation === 'labels') {
      const mode = params.labelMode
      const inputs = params.labels ?? []
      if (!mode || inputs.length === 0) {
        throw linearError('linear_invalid_label', 'Pass at least one --label.')
      }
      const labels = await this.resolveLinearLabelsForIssue(current, inputs, workspaceId)
      const requestedIds = labels.map((label) => label.id)
      const existingIds = current.labelIds ?? current.labels?.map((label) => label.id) ?? []
      const nextIds =
        mode === 'set'
          ? requestedIds
          : mode === 'add'
            ? Array.from(new Set([...existingIds, ...requestedIds]))
            : existingIds.filter((id) => !requestedIds.includes(id))
      return {
        fields: { labelIds: nextIds },
        labels: labelsForIds(nextIds, [...(current.labels ?? []), ...labels])
      }
    }
    return null
  }
  protected async buildLinearSaveUpdate(
    params: LinearSaveIssueRequest,
    current: NonNullable<Awaited<ReturnType<typeof getLinearIssueByUuidForAgent>>>,
    workspaceId: string
  ): Promise<LinearIssueUpdate> {
    const fields: LinearIssueUpdate = {}
    if (params.title !== undefined) {
      fields.title = params.title
    }
    if (params.description !== undefined) {
      fields.description = params.description
    }
    if (params.priority !== undefined) {
      fields.priority = params.priority
    }
    if (params.estimate !== undefined) {
      fields.estimate = params.estimate
    }
    if (params.dueDate !== undefined) {
      fields.dueDate = params.dueDate
    }
    if (params.state !== undefined) {
      const states = await this.getLinearTeamStatesForWrite(current.team.id, workspaceId)
      const state = this.resolveLinearAgentState(params.state, states)
      if (!state) {
        throw linearError(
          'linear_invalid_state',
          `No workflow state exactly matched "${params.state}".`
        )
      }
      fields.stateId = state.id
    }
    if (params.assignee !== undefined) {
      fields.assigneeId =
        params.assignee === null
          ? null
          : await this.resolveLinearAssignee(params.assignee, current.team.id, workspaceId)
    }
    if (params.labels !== undefined) {
      if (params.labels.length === 0) {
        fields.labelIds = []
      } else {
        const labels = await this.resolveLinearLabelsForIssue(current, params.labels, workspaceId)
        fields.labelIds = labels.map((label) => label.id)
      }
    }
    if (params.project !== undefined) {
      fields.projectId =
        params.project === null
          ? null
          : (
              await this.resolveLinearCreateProject(params.project, {
                id: current.team.id,
                workspaceId
              })
            ).id
    }
    if (params.parentId !== undefined) {
      fields.parentId =
        params.parentId === null
          ? null
          : (
              await this.resolveLinearAgentWriteTarget({
                input: params.parentId,
                workspaceId,
                context: params.context
              })
            ).issue.id
      if (fields.parentId === current.id) {
        throw linearError('linear_invalid_parent', 'An issue cannot be its own parent.')
      }
    }
    return fields
  }
  protected async resolveLinearAssignee(
    input: string,
    teamId: string,
    workspaceId: string
  ): Promise<string> {
    if (input.toLocaleLowerCase() === 'me') {
      return (await this.getLinearViewerForWrite(workspaceId)).id
    }
    // Why: caller-supplied IDs were accepted directly before save-issue; avoid a paginated member scan on that existing fast path.
    if (isLinearUuid(input)) {
      return input
    }
    let members: Awaited<ReturnType<typeof getLinearTeamMembersOrThrow>>
    try {
      members = await getLinearTeamMembersOrThrow(teamId, workspaceId)
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
    const normalized = input.toLocaleLowerCase()
    const matches = members.filter(
      (member) =>
        member.id.toLocaleLowerCase() === normalized ||
        member.displayName.toLocaleLowerCase() === normalized ||
        member.name?.toLocaleLowerCase() === normalized ||
        member.email?.toLocaleLowerCase() === normalized
    )
    if (matches.length === 1) {
      return matches[0].id
    }
    throw linearError(
      'linear_invalid_assignee',
      matches.length === 0
        ? `No team member exactly matched "${input}".`
        : `Multiple team members exactly matched "${input}".`
    )
  }
  protected linearSavedIssueMatchesIntent(
    issue: NonNullable<Awaited<ReturnType<typeof getLinearIssueByUuidForAgent>>>,
    fields: LinearIssueUpdate
  ): boolean {
    if (fields.title !== undefined && issue.title !== fields.title) {
      return false
    }
    if (fields.description !== undefined && (issue.description ?? '') !== fields.description) {
      return false
    }
    if (fields.parentId !== undefined && (issue.parent?.id ?? null) !== fields.parentId) {
      return false
    }
    if (fields.stateId !== undefined && issue.state?.id !== fields.stateId) {
      return false
    }
    if (fields.assigneeId !== undefined && (issue.assignee?.id ?? null) !== fields.assigneeId) {
      return false
    }
    if (fields.priority !== undefined && issue.priority !== fields.priority) {
      return false
    }
    if (fields.estimate !== undefined && (issue.estimate ?? null) !== fields.estimate) {
      return false
    }
    if (fields.dueDate !== undefined && (issue.dueDate ?? null) !== fields.dueDate) {
      return false
    }
    if (fields.projectId !== undefined && (issue.project?.id ?? null) !== fields.projectId) {
      return false
    }
    const issueLabelIds = issue.labelIds ?? issue.labels?.map((label) => label.id) ?? []
    return fields.labelIds === undefined || sameStringSet(issueLabelIds, fields.labelIds)
  }
  protected async resolveLinearCreateFields(
    params: {
      state?: string
      assignee?: string
      priority?: number
      estimate?: number
      dueDate?: string
      labels?: string[]
      projectInput?: string
    },
    team: { id: string; workspaceId: string }
  ): Promise<LinearCreateFieldIntent> {
    const fields: LinearCreateFieldIntent = {}
    if (params.state) {
      const states = await this.getLinearTeamStatesForWrite(team.id, team.workspaceId)
      const state = this.resolveLinearAgentState(params.state, states)
      if (!state) {
        throw linearError(
          'linear_invalid_state',
          `No workflow state exactly matched "${params.state}".`,
          { states: states.map(({ id, name, type }) => ({ id, name, type })) }
        )
      }
      fields.stateId = state.id
    }
    if (params.assignee) {
      fields.assigneeId = await this.resolveLinearAssignee(
        params.assignee,
        team.id,
        team.workspaceId
      )
    }
    if (params.priority !== undefined) {
      fields.priority = params.priority
    }
    if (params.estimate !== undefined) {
      fields.estimate = params.estimate
    }
    if (params.dueDate !== undefined) {
      fields.dueDate = params.dueDate
    }
    if (params.labels && params.labels.length > 0) {
      const labels = await this.resolveLinearLabelsForTeam(team.id, params.labels, team.workspaceId)
      fields.labelIds = labels.map((label) => label.id)
    }
    if (params.projectInput) {
      const project = await this.resolveLinearCreateProject(params.projectInput, team)
      fields.projectId = project.id
    }
    return fields
  }
  protected async resolveLinearCreateProject(
    input: string,
    team: { id: string; workspaceId: string }
  ): Promise<LinearProjectSummary> {
    const trimmed = input.trim()
    if (!trimmed) {
      throw linearError('linear_invalid_project', 'Pass a non-empty Linear project id or name.')
    }
    const byId = isLinearUuid(trimmed)
      ? await this.readLinearProjectByIdForCreate(trimmed, team.workspaceId)
      : null
    if (byId) {
      await this.assertLinearProjectIncludesTeam(byId, team.id, team.workspaceId, trimmed)
      return byId
    }
    const searchCandidates = await this.readLinearProjectsForCreate(trimmed, team.workspaceId)
    const normalized = trimmed.toLowerCase()
    const idMatch = searchCandidates.find((project) => project.id.toLowerCase() === normalized)
    if (idMatch) {
      await this.assertLinearProjectIncludesTeam(idMatch, team.id, team.workspaceId, trimmed)
      return idMatch
    }
    const slugMatch = searchCandidates.find(
      (project) => project.slugId?.toLowerCase() === normalized
    )
    if (slugMatch) {
      await this.assertLinearProjectIncludesTeam(slugMatch, team.id, team.workspaceId, trimmed)
      return slugMatch
    }
    const nameMatches = await this.readLinearProjectsByExactNameForCreate(trimmed, team.workspaceId)
    const compatibleNameMatches = await this.filterLinearProjectsForTeam(
      nameMatches,
      team.id,
      team.workspaceId
    )
    if (compatibleNameMatches.length === 1) {
      return compatibleNameMatches[0]
    }
    if (compatibleNameMatches.length > 1) {
      throw linearError(
        'linear_invalid_project',
        `Multiple Linear projects exactly matched "${trimmed}".`,
        {
          projects: compatibleNameMatches.map((project) => ({
            id: project.id,
            name: project.name,
            teams: project.teams
          })),
          nextSteps: ['Run `orca linear project list --query <name> --json` and retry by id.']
        }
      )
    }
    if (nameMatches.length > 0) {
      await this.assertLinearProjectIncludesTeam(nameMatches[0], team.id, team.workspaceId, trimmed)
    }
    throw linearError('linear_invalid_project', `No Linear project exactly matched "${trimmed}".`, {
      projects: searchCandidates.map((project) => ({
        id: project.id,
        name: project.name,
        teams: project.teams
      })),
      nextSteps: ['Run `orca linear project list --query <name> --json` and retry by id.']
    })
  }
  protected async readLinearProjectByIdForCreate(
    id: string,
    workspaceId: string
  ): Promise<LinearProjectSummary | null> {
    try {
      return await getLinearProject(id, workspaceId, true)
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
  }
  protected async readLinearProjectsForCreate(
    query: string,
    workspaceId: string
  ): Promise<LinearProjectSummary[]> {
    try {
      return (await listLinearProjects(query, LINEAR_SEARCH_MAX_LIMIT, workspaceId, true)).items
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
  }
  protected async readLinearProjectsByExactNameForCreate(
    name: string,
    workspaceId: string
  ): Promise<LinearProjectSummary[]> {
    try {
      return await listLinearProjectsByExactName(name, workspaceId, true)
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
  }
  protected async assertLinearProjectIncludesTeam(
    project: LinearProjectSummary,
    teamId: string,
    workspaceId: string,
    input: string
  ): Promise<void> {
    if (this.linearProjectIncludesTeam(project, teamId)) {
      return
    }
    let teams: NonNullable<LinearProjectSummary['teams']> = []
    try {
      // Why: summary reads cap project teams, so large cross-team projects need a paged membership check before rejecting a valid create.
      teams = await listLinearProjectTeams(project.id, workspaceId, true)
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
    if (teams.some((team) => team.id === teamId)) {
      return
    }
    throw linearError(
      'linear_invalid_project',
      `Linear project "${input}" is not available to the target team.`,
      {
        project: { id: project.id, name: project.name, teams },
        nextSteps: ['Choose a project that includes the create target team, then retry by id.']
      }
    )
  }
}
