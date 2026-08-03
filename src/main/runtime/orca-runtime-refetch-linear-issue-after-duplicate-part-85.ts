import { type LinearAttachResult, type LinearCommentAddResult, type LinearCreateResult, type LinearErrorCode, getLinearStatus, getLinearAttachmentByUuidForAgent, getLinearCommentByUuidForAgent, getLinearIssueByUuidForAgent, LinearAgentAccessError, linearError, sanitizeLinearErrorMessage, listLinearTeamsOrThrow, type LinearAgentWriteTarget, type LinearCreateFieldIntent } from './orca-runtime-symbols'
import { OrcaRuntimeFilterLinearProjectsForTeamPart84 } from './orca-runtime-filter-linear-projects-for-team-part-84'

export class OrcaRuntimeRefetchLinearIssueAfterDuplicatePart85 extends OrcaRuntimeFilterLinearProjectsForTeamPart84 {
  protected async refetchLinearIssueAfterDuplicate(
    writeId: string,
    teamId: string,
    parentId: string | null,
    workspaceId: string,
    intent: LinearCreateFieldIntent,
    unconfirmed: (cause?: string) => LinearAgentAccessError
  ): Promise<NonNullable<Awaited<ReturnType<typeof getLinearIssueByUuidForAgent>>>> {
    try {
      // Why: a duplicate-id response can mean the original write landed; only the exact target relationship proves this pinned retry.
      const issue = await this.getMatchingLinearCreatedIssue(
        writeId,
        teamId,
        parentId,
        workspaceId,
        true,
        intent
      )
      if (issue) {
        return issue
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

  protected async readLinearWriteLookup<T>(lookup: () => Promise<T>): Promise<T> {
    try {
      return await lookup()
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
  }
  protected parseLinearAttachmentUrl(value: string): URL {
    try {
      const url = new URL(value)
      if (url.protocol === 'http:' || url.protocol === 'https:') {

        return url
      }
    } catch {
      // Fall through to the stable agent-facing error below.
    }
    throw linearError('linear_invalid_url', 'Attachment URL must be an absolute http(s) URL.')
  }
  protected defaultLinearAttachmentTitle(url: URL): string {
    const tail = url.pathname.split('/').findLast(Boolean)
    return tail ? `${url.host}/${tail}` : url.host
  }
  protected linearWorkspaceErrorCode(type: string): LinearErrorCode {
    if (type === 'auth') {
      return 'linear_auth_expired'
    }
    if (type === 'network') {
      return 'linear_network_error'
    }
    if (type === 'rate_limited') {
      return 'linear_rate_limited'
    }
    return 'linear_write_failed'
  }
  protected linearTeamSummary(team: {
    id: string
    name: string
    key: string
    url?: string
    workspaceId?: string
    workspaceName?: string
  }): {
    id: string
    name: string
    key: string
    url?: string
    workspace?: { id: string; name: string }
  } {
    return {
      id: team.id,
      name: team.name,
      key: team.key,
      ...(team.url ? { url: team.url } : {}),
      ...(team.workspaceId
        ? { workspace: { id: team.workspaceId, name: team.workspaceName ?? team.workspaceId } }
        : {})
    }
  }
  protected async resolveLinearTeamInput(
    teamInput: string,
    workspaceId?: string | 'all'
  ): Promise<{
    id: string
    key: string
    name: string
    workspaceId: string
    workspaceName?: string
  }> {
    this.validateLinearCreateWorkspaceScope(workspaceId === 'all' ? undefined : workspaceId)
    let teams: Awaited<ReturnType<typeof listLinearTeamsOrThrow>>
    try {
      teams = await listLinearTeamsOrThrow(workspaceId ?? 'all')
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
    const normalized = teamInput.toLocaleLowerCase()
    const idMatches = teams.filter((team) => team.id.toLocaleLowerCase() === normalized)
    const matches =
      idMatches.length > 0
        ? idMatches
        : teams.filter((team) => team.key.toLocaleLowerCase() === normalized)
    if (matches.length === 1 && matches[0].workspaceId) {
      return {
        id: matches[0].id,
        key: matches[0].key,
        name: matches[0].name,
        workspaceId: matches[0].workspaceId,
        workspaceName: matches[0].workspaceName
      }
    }
    if (matches.length > 1) {
      throw linearError(
        'linear_workspace_ambiguous',
        `Team ${teamInput} exists in multiple workspaces.`,
        {
          candidates: matches.map((team) => ({
            workspaceId: team.workspaceId,
            workspaceName: team.workspaceName,
            teamId: team.id,
            teamKey: team.key
          }))
        }
      )
    }
    throw linearError('linear_team_required', `No connected Linear team matched ${teamInput}.`)
  }
  protected async resolveLinearCreateTeam(
    teamInput: string | undefined,
    workspaceId: string | undefined,
    parent: LinearAgentWriteTarget | null
  ): Promise<{ id: string; key: string; name: string; workspaceId: string }> {
    if (!teamInput && parent?.issue.team?.id && parent.issue.team.key && parent.issue.team.name) {
      return {
        id: parent.issue.team.id,
        key: parent.issue.team.key,
        name: parent.issue.team.name,
        workspaceId: parent.workspaceId
      }
    }
    if (!teamInput) {
      throw linearError('linear_team_required', 'Pass --team or create under a parent issue.', {
        nextSteps: ['Run `orca linear create --team <key> ...` or use --parent-current.']
      })
    }

    const scope = parent?.workspaceId ?? workspaceId
    this.validateLinearCreateWorkspaceScope(scope)
    let teams: Awaited<ReturnType<typeof listLinearTeamsOrThrow>>
    try {
      teams = await listLinearTeamsOrThrow(scope ?? 'all')
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
    if (teams.length === 0 && (getLinearStatus().workspaces?.length ?? 0) === 0) {
      throw linearError('linear_not_connected', 'Linear is not connected.', {
        nextSteps: ['Connect Linear from Orca settings, then retry the issue create.']
      })
    }
    const matches = teams.filter(
      (team) =>
        team.id.toLocaleLowerCase() === teamInput.toLocaleLowerCase() ||
        team.key.toLocaleLowerCase() === teamInput.toLocaleLowerCase()
    )
    if (matches.length === 1 && matches[0].workspaceId) {
      return {
        id: matches[0].id,
        key: matches[0].key,
        name: matches[0].name,
        workspaceId: matches[0].workspaceId
      }
    }
    if (matches.length > 1) {
      throw linearError(
        'linear_workspace_ambiguous',
        `Team ${teamInput} exists in multiple workspaces.`,
        {
          candidates: matches.map((team) => ({
            workspaceId: team.workspaceId,
            workspaceName: team.workspaceName,
            teamKey: team.key
          }))
        }
      )
    }
    if (parent) {
      let globalTeams: Awaited<ReturnType<typeof listLinearTeamsOrThrow>>
      try {
        globalTeams = await listLinearTeamsOrThrow('all')
      } catch (error) {
        throw this.mapLinearReadFailure(error)
      }
      const globalMatch = globalTeams.find(
        (team) =>
          team.id.toLocaleLowerCase() === teamInput.toLocaleLowerCase() ||
          team.key.toLocaleLowerCase() === teamInput.toLocaleLowerCase()
      )
      if (globalMatch) {
        throw linearError(
          'linear_invalid_workspace',
          `Team ${teamInput} is not in the parent issue workspace.`
        )
      }
    }
    throw linearError('linear_team_required', `No connected Linear team matched ${teamInput}.`)
  }
  protected validateLinearCreateWorkspaceScope(workspaceId: string | undefined): void {
    if (!workspaceId) {
      return
    }
    const workspaces = getLinearStatus().workspaces ?? []
    if (workspaces.length > 0 && !workspaces.some((workspace) => workspace.id === workspaceId)) {
      throw linearError(
        'linear_invalid_workspace',
        `No connected Linear workspace matched ${workspaceId}.`
      )
    }
  }
  protected linearWriteIssueRef(issue: { id: string; identifier: string; url: string }): {
    id: string
    identifier: string
    url: string
  } {
    return { id: issue.id, identifier: issue.identifier, url: issue.url }
  }
  protected linearCommentResult(
    comment: NonNullable<Awaited<ReturnType<typeof getLinearCommentByUuidForAgent>>>,
    target: LinearAgentWriteTarget,
    bodyChars: number,
    writeId: string,
    deduplicated: boolean
  ): LinearCommentAddResult {
    return {
      comment: { id: comment.id, url: comment.url, parentId: comment.parentId },
      issue: this.linearWriteIssueRef(target.issue),
      meta: { workspaceId: target.workspaceId, bodyChars, writeId, deduplicated }
    }
  }
  protected linearAttachResult(
    attachment: NonNullable<Awaited<ReturnType<typeof getLinearAttachmentByUuidForAgent>>>,
    target: LinearAgentWriteTarget,
    writeId: string,
    deduplicated: boolean
  ): LinearAttachResult {
    return {
      attachment: { id: attachment.id, title: attachment.title, url: attachment.url },
      issue: this.linearWriteIssueRef(target.issue),
      meta: { workspaceId: target.workspaceId, writeId, deduplicated }
    }
  }
  protected linearCreateResult(
    issue: NonNullable<Awaited<ReturnType<typeof getLinearIssueByUuidForAgent>>>,
    workspaceId: string,
    writeId: string,
    deduplicated: boolean
  ): LinearCreateResult {
    return {
      issue,
      meta: { workspaceId, writeId, deduplicated }
    }
  }
  protected linearCreateFieldRetryTokens(fields: LinearCreateFieldIntent | undefined): string[] {
    if (!fields) {
      return []
    }
    return [
      ...(fields.stateId ? [`--state=${this.commandToken(fields.stateId, 'STATE_ID')}`] : []),
      ...(fields.assigneeId
        ? [`--assignee=${this.commandToken(fields.assigneeId, 'ASSIGNEE_ID')}`]
        : []),
      ...(fields.priority !== undefined
        ? [`--priority=${this.linearPriorityRetryToken(fields.priority)}`]
        : []),
      ...(fields.estimate !== undefined && fields.estimate !== null
        ? [`--estimate=${fields.estimate}`]
        : []),
      ...(fields.dueDate ? [`--due-date=${fields.dueDate}`] : []),
      ...(fields.projectId
        ? [`--project=${this.commandToken(fields.projectId, 'PROJECT_ID')}`]
        : []),
      ...(fields.labelIds ?? []).map(
        (labelId) => `--label=${this.commandToken(labelId, 'LABEL_ID')}`
      )
    ]
  }
  protected linearPriorityRetryToken(priority: number): string {
    if (priority === 1) {
      return 'urgent'
    }
    if (priority === 2) {
      return 'high'
    }
    if (priority === 3) {
      return 'medium'
    }
    if (priority === 4) {
      return 'low'
    }
    return 'none'
  }
  protected linearCreateStyleUnconfirmed(
    verb: 'comment' | 'attach' | 'create',
    writeId: string,
    target: LinearAgentWriteTarget | null,
    extra: {
      parentId?: string | null
      team?: { id: string; key: string; name: string; workspaceId: string }
      parent?: LinearAgentWriteTarget | null
      title?: string
      url?: string
      bodyRequired?: boolean
      createFields?: LinearCreateFieldIntent
      cause?: string
    } = {}
  ): LinearAgentAccessError {
    const workspaceId = target?.workspaceId ?? extra.team?.workspaceId ?? ''
    // Why: the retry preserves id and target so duplicate recovery can prove intent without matching mutable content.
    const pinned =
      verb === 'create'
        ? [
            'orca linear create',
            `--workspace=${this.commandToken(workspaceId, 'WORKSPACE_ID')}`,
            `--write-id=${this.commandToken(writeId, 'WRITE_ID')}`,
            '--title TITLE_HERE',
            ...(extra.bodyRequired ? ['--body-file -'] : []),
            ...(extra.parent
              ? [`--parent=${this.commandToken(extra.parent.issue.identifier, 'PARENT_ISSUE')}`]
              : []),
            ...(extra.team
              ? [`--team=${this.commandToken(extra.team.key, 'TEAM_KEY')}`]
              : []
            ).concat(this.linearCreateFieldRetryTokens(extra.createFields))
          ].join(' ')
        : [
            `orca linear ${verb === 'attach' ? 'attach' : 'comment add'}`,
            this.commandToken(target?.issue.identifier ?? '', 'ISSUE_ID'),
            `--workspace=${this.commandToken(workspaceId, 'WORKSPACE_ID')}`,
            `--write-id=${this.commandToken(writeId, 'WRITE_ID')}`,
            ...(verb === 'comment' ? ['--body-file -'] : []),
            ...(verb === 'comment' && extra.parentId
              ? [`--reply-to=${this.commandToken(extra.parentId, 'COMMENT_ID')}`]
              : []),
            ...(verb === 'attach' ? ['--url URL_HERE', '--title TITLE_HERE'] : [])
          ].join(' ')
    const retryPrefix = extra.bodyRequired || verb === 'comment' ? 'Pipe the same body and r' : 'R'
    const payloadNote =
      verb === 'attach'
        ? ' Replace TITLE_HERE/URL_HERE with the exact original payload values before running.'
        : verb === 'create'
          ? ' Replace TITLE_HERE with the exact original title before running.'
          : ''
    return linearError(
      'linear_write_unconfirmed',
      'Linear may have applied the write, but Orca could not confirm it.',
      {
        writeId,
        workspaceId,
        issueIdentifier: target?.issue.identifier,
        parentId: extra.parentId,
        team: extra.team ? { id: extra.team.id, key: extra.team.key } : undefined,
        parentIdentifier: extra.parent?.issue.identifier,
        createFields: extra.createFields,
        nextSteps: [
          `${retryPrefix}etry once with the pinned command: \`${pinned}\`.${payloadNote}`
        ],
        ...(extra.cause ? { cause: sanitizeLinearErrorMessage(extra.cause) } : {})
      }
    )
  }
  protected commandToken(value: string, placeholder: string): string {
    return /^[A-Za-z0-9._:@%+=,/-]+$/.test(value) ? value : placeholder
  }
}
