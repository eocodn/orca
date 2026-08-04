import { RuntimeBrowserCommands, RuntimeGithubProjectCommands, RuntimeJiraCommands, RuntimeLinearQueryCommands } from './orca-runtime-symbols'
import { OrcaRuntimeRefetchLinearIssueAfterDuplicatePart85 } from './orca-runtime-refetch-linear-issue-after-duplicate-part-85'

export class OrcaRuntimeNotifyLinearLinkedIssueUpdatedPart86 extends OrcaRuntimeRefetchLinearIssueAfterDuplicatePart85 {
  protected async notifyLinearLinkedIssueUpdated(
    workspaceId: string,
    identifier: string | readonly string[]
  ): Promise<void> {
    const identifiers = typeof identifier === 'string' ? [identifier] : identifier
    const normalized = new Map(
      identifiers.map((value) => [value.toLocaleUpperCase(), value] as const)
    )
    for (const worktree of await this.listResolvedWorktrees()) {
      const linkedIdentifier = normalized.get(
        (worktree.linkedLinearIssue ?? '').toLocaleUpperCase()
      )
      if (!linkedIdentifier) {
        continue
      }
      const linkedWorkspaceId = worktree.linkedLinearIssueWorkspaceId ?? workspaceId
      if (linkedWorkspaceId !== workspaceId) {
        continue
      }
      this.emitClientEvent({
        type: 'linearLinkedIssueUpdated',
        worktreeId: worktree.id,
        identifier: linkedIdentifier,
        workspaceId
      })
    }
  }

  protected readonly linearQueryCommands = new RuntimeLinearQueryCommands()

  linearIssueComments: RuntimeLinearQueryCommands['linearIssueComments'] =
    this.linearQueryCommands.linearIssueComments.bind(this.linearQueryCommands)
  linearListTeams: RuntimeLinearQueryCommands['linearListTeams'] =
    this.linearQueryCommands.linearListTeams.bind(this.linearQueryCommands)
  linearListProjects: RuntimeLinearQueryCommands['linearListProjects'] =
    this.linearQueryCommands.linearListProjects.bind(this.linearQueryCommands)
  linearCreateProject: RuntimeLinearQueryCommands['linearCreateProject'] =
    this.linearQueryCommands.linearCreateProject.bind(this.linearQueryCommands)
  linearGetProject: RuntimeLinearQueryCommands['linearGetProject'] =
    this.linearQueryCommands.linearGetProject.bind(this.linearQueryCommands)
  linearListProjectIssues: RuntimeLinearQueryCommands['linearListProjectIssues'] =
    this.linearQueryCommands.linearListProjectIssues.bind(this.linearQueryCommands)
  linearListCustomViews: RuntimeLinearQueryCommands['linearListCustomViews'] =
    this.linearQueryCommands.linearListCustomViews.bind(this.linearQueryCommands)
  linearGetCustomView: RuntimeLinearQueryCommands['linearGetCustomView'] =
    this.linearQueryCommands.linearGetCustomView.bind(this.linearQueryCommands)
  linearListCustomViewIssues: RuntimeLinearQueryCommands['linearListCustomViewIssues'] =
    this.linearQueryCommands.linearListCustomViewIssues.bind(this.linearQueryCommands)
  linearListCustomViewProjects: RuntimeLinearQueryCommands['linearListCustomViewProjects'] =
    this.linearQueryCommands.linearListCustomViewProjects.bind(this.linearQueryCommands)
  linearTeamStates: RuntimeLinearQueryCommands['linearTeamStates'] =
    this.linearQueryCommands.linearTeamStates.bind(this.linearQueryCommands)
  linearTeamLabels: RuntimeLinearQueryCommands['linearTeamLabels'] =
    this.linearQueryCommands.linearTeamLabels.bind(this.linearQueryCommands)
  linearTeamMembers: RuntimeLinearQueryCommands['linearTeamMembers'] =
    this.linearQueryCommands.linearTeamMembers.bind(this.linearQueryCommands)
  linearListIssues: RuntimeLinearQueryCommands['linearListIssues'] =
    this.linearQueryCommands.linearListIssues.bind(this.linearQueryCommands)
  linearCreateIssue: RuntimeLinearQueryCommands['linearCreateIssue'] =
    this.linearQueryCommands.linearCreateIssue.bind(this.linearQueryCommands)
  linearGetIssue: RuntimeLinearQueryCommands['linearGetIssue'] =
    this.linearQueryCommands.linearGetIssue.bind(this.linearQueryCommands)
  linearUpdateIssue: RuntimeLinearQueryCommands['linearUpdateIssue'] =
    this.linearQueryCommands.linearUpdateIssue.bind(this.linearQueryCommands)
  linearAddIssueComment: RuntimeLinearQueryCommands['linearAddIssueComment'] =
    this.linearQueryCommands.linearAddIssueComment.bind(this.linearQueryCommands)

  protected readonly githubProjectCommands = new RuntimeGithubProjectCommands()

  listGitHubProjects: RuntimeGithubProjectCommands['listGitHubProjects'] =
    this.githubProjectCommands.listGitHubProjects.bind(this.githubProjectCommands)
  listGitHubLabelsBySlug: RuntimeGithubProjectCommands['listGitHubLabelsBySlug'] =
    this.githubProjectCommands.listGitHubLabelsBySlug.bind(this.githubProjectCommands)
  listGitHubAssignableUsersBySlug: RuntimeGithubProjectCommands['listGitHubAssignableUsersBySlug'] =
    this.githubProjectCommands.listGitHubAssignableUsersBySlug.bind(this.githubProjectCommands)
  listGitHubIssueTypesBySlug: RuntimeGithubProjectCommands['listGitHubIssueTypesBySlug'] =
    this.githubProjectCommands.listGitHubIssueTypesBySlug.bind(this.githubProjectCommands)
  resolveGitHubProjectRef: RuntimeGithubProjectCommands['resolveGitHubProjectRef'] =
    this.githubProjectCommands.resolveGitHubProjectRef.bind(this.githubProjectCommands)
  listGitHubProjectViews: RuntimeGithubProjectCommands['listGitHubProjectViews'] =
    this.githubProjectCommands.listGitHubProjectViews.bind(this.githubProjectCommands)
  getGitHubProjectViewTable: RuntimeGithubProjectCommands['getGitHubProjectViewTable'] =
    this.githubProjectCommands.getGitHubProjectViewTable.bind(this.githubProjectCommands)
  getGitHubProjectWorkItemDetailsBySlug: RuntimeGithubProjectCommands['getGitHubProjectWorkItemDetailsBySlug'] =
    this.githubProjectCommands.getGitHubProjectWorkItemDetailsBySlug.bind(
      this.githubProjectCommands
    )
  updateGitHubProjectItemField: RuntimeGithubProjectCommands['updateGitHubProjectItemField'] =
    this.githubProjectCommands.updateGitHubProjectItemField.bind(this.githubProjectCommands)
  clearGitHubProjectItemField: RuntimeGithubProjectCommands['clearGitHubProjectItemField'] =
    this.githubProjectCommands.clearGitHubProjectItemField.bind(this.githubProjectCommands)
  updateGitHubIssueBySlug: RuntimeGithubProjectCommands['updateGitHubIssueBySlug'] =
    this.githubProjectCommands.updateGitHubIssueBySlug.bind(this.githubProjectCommands)
  updateGitHubPullRequestBySlug: RuntimeGithubProjectCommands['updateGitHubPullRequestBySlug'] =
    this.githubProjectCommands.updateGitHubPullRequestBySlug.bind(this.githubProjectCommands)
  updateGitHubIssueTypeBySlug: RuntimeGithubProjectCommands['updateGitHubIssueTypeBySlug'] =
    this.githubProjectCommands.updateGitHubIssueTypeBySlug.bind(this.githubProjectCommands)
  addGitHubIssueCommentBySlug: RuntimeGithubProjectCommands['addGitHubIssueCommentBySlug'] =
    this.githubProjectCommands.addGitHubIssueCommentBySlug.bind(this.githubProjectCommands)
  updateGitHubIssueCommentBySlug: RuntimeGithubProjectCommands['updateGitHubIssueCommentBySlug'] =
    this.githubProjectCommands.updateGitHubIssueCommentBySlug.bind(this.githubProjectCommands)
  deleteGitHubIssueCommentBySlug: RuntimeGithubProjectCommands['deleteGitHubIssueCommentBySlug'] =
    this.githubProjectCommands.deleteGitHubIssueCommentBySlug.bind(this.githubProjectCommands)

  protected readonly jiraCommands = new RuntimeJiraCommands()

  jiraConnect: RuntimeJiraCommands['jiraConnect'] = this.jiraCommands.jiraConnect.bind(
    this.jiraCommands
  )
  jiraDisconnect: RuntimeJiraCommands['jiraDisconnect'] = this.jiraCommands.jiraDisconnect.bind(
    this.jiraCommands
  )
  jiraSelectSite: RuntimeJiraCommands['jiraSelectSite'] = this.jiraCommands.jiraSelectSite.bind(
    this.jiraCommands
  )
  jiraStatus: RuntimeJiraCommands['jiraStatus'] = this.jiraCommands.jiraStatus.bind(
    this.jiraCommands
  )
  jiraReadStatus: RuntimeJiraCommands['jiraReadStatus'] = this.jiraCommands.jiraReadStatus.bind(
    this.jiraCommands
  )
  jiraTestConnection: RuntimeJiraCommands['jiraTestConnection'] =
    this.jiraCommands.jiraTestConnection.bind(this.jiraCommands)
  jiraSearchIssues: RuntimeJiraCommands['jiraSearchIssues'] =
    this.jiraCommands.jiraSearchIssues.bind(this.jiraCommands)
  jiraListIssues: RuntimeJiraCommands['jiraListIssues'] = this.jiraCommands.jiraListIssues.bind(
    this.jiraCommands
  )
  jiraCreateIssue: RuntimeJiraCommands['jiraCreateIssue'] = this.jiraCommands.jiraCreateIssue.bind(
    this.jiraCommands
  )
  jiraGetIssue: RuntimeJiraCommands['jiraGetIssue'] = this.jiraCommands.jiraGetIssue.bind(
    this.jiraCommands
  )
  jiraLookupIssueSummary: RuntimeJiraCommands['jiraLookupIssueSummary'] =
    this.jiraCommands.jiraLookupIssueSummary.bind(this.jiraCommands)
  jiraUpdateIssue: RuntimeJiraCommands['jiraUpdateIssue'] = this.jiraCommands.jiraUpdateIssue.bind(
    this.jiraCommands
  )
  jiraAddIssueComment: RuntimeJiraCommands['jiraAddIssueComment'] =
    this.jiraCommands.jiraAddIssueComment.bind(this.jiraCommands)
  jiraIssueComments: RuntimeJiraCommands['jiraIssueComments'] =
    this.jiraCommands.jiraIssueComments.bind(this.jiraCommands)
  jiraListProjects: RuntimeJiraCommands['jiraListProjects'] =
    this.jiraCommands.jiraListProjects.bind(this.jiraCommands)
  jiraListIssueTypes: RuntimeJiraCommands['jiraListIssueTypes'] =
    this.jiraCommands.jiraListIssueTypes.bind(this.jiraCommands)
  jiraListCreateFields: RuntimeJiraCommands['jiraListCreateFields'] =
    this.jiraCommands.jiraListCreateFields.bind(this.jiraCommands)
  jiraListPriorities: RuntimeJiraCommands['jiraListPriorities'] =
    this.jiraCommands.jiraListPriorities.bind(this.jiraCommands)
  jiraListAssignableUsers: RuntimeJiraCommands['jiraListAssignableUsers'] =
    this.jiraCommands.jiraListAssignableUsers.bind(this.jiraCommands)
  jiraListTransitions: RuntimeJiraCommands['jiraListTransitions'] =
    this.jiraCommands.jiraListTransitions.bind(this.jiraCommands)
  jiraGetProjectStatusOrder: RuntimeJiraCommands['jiraGetProjectStatusOrder'] =
    this.jiraCommands.jiraGetProjectStatusOrder.bind(this.jiraCommands)

  // ── Browser automation ──

  protected readonly browserCommands = new RuntimeBrowserCommands({
    getAgentBrowserBridge: () => this.agentBrowserBridge,
    resolveWorktreeSelector: (selector) => this.resolveWorktreeSelector(selector),
    getAuthoritativeWindow: () => this.getAuthoritativeWindow(),
    getAvailableAuthoritativeWindow: () => this.getAvailableAuthoritativeWindow(),
    getOffscreenBrowserBackend: () => this.offscreenBrowserBackend,
    // Why: bind directly, not a wrapper arrow — a hand-listed wrapper dropped targetGroupId, so a right-split browser landed in the left.
    markHeadlessBrowserSessionTabActive: this.markHeadlessBrowserSessionTabActive.bind(this)
  })

  browserSnapshot: RuntimeBrowserCommands['browserSnapshot'] =
    this.browserCommands.browserSnapshot.bind(this.browserCommands)

  browserClick: RuntimeBrowserCommands['browserClick'] = this.browserCommands.browserClick.bind(
    this.browserCommands
  )

  browserGoto: RuntimeBrowserCommands['browserGoto'] = this.browserCommands.browserGoto.bind(
    this.browserCommands
  )

  browserFill: RuntimeBrowserCommands['browserFill'] = this.browserCommands.browserFill.bind(
    this.browserCommands
  )

  browserType: RuntimeBrowserCommands['browserType'] = this.browserCommands.browserType.bind(
    this.browserCommands
  )

  browserSelect: RuntimeBrowserCommands['browserSelect'] = this.browserCommands.browserSelect.bind(
    this.browserCommands
  )

  browserScroll: RuntimeBrowserCommands['browserScroll'] = this.browserCommands.browserScroll.bind(
    this.browserCommands
  )

  browserBack: RuntimeBrowserCommands['browserBack'] = this.browserCommands.browserBack.bind(
    this.browserCommands
  )

  browserReload: RuntimeBrowserCommands['browserReload'] = this.browserCommands.browserReload.bind(
    this.browserCommands
  )

  browserScreenshot: RuntimeBrowserCommands['browserScreenshot'] =
    this.browserCommands.browserScreenshot.bind(this.browserCommands)
}
