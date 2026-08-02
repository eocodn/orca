import { RuntimeGithubProjectMutationCommands } from './orca-runtime-github-project-mutation-commands'
import { RuntimeGithubProjectQueryCommands } from './orca-runtime-github-project-query-commands'

export class RuntimeGithubProjectCommands {
  private readonly queryCommands = new RuntimeGithubProjectQueryCommands()
  private readonly mutationCommands = new RuntimeGithubProjectMutationCommands()

  listGitHubProjects = this.queryCommands.listGitHubProjects.bind(this.queryCommands)
  listGitHubLabelsBySlug = this.queryCommands.listGitHubLabelsBySlug.bind(this.queryCommands)
  listGitHubAssignableUsersBySlug = this.queryCommands.listGitHubAssignableUsersBySlug.bind(
    this.queryCommands
  )
  listGitHubIssueTypesBySlug = this.queryCommands.listGitHubIssueTypesBySlug.bind(
    this.queryCommands
  )
  resolveGitHubProjectRef = this.queryCommands.resolveGitHubProjectRef.bind(this.queryCommands)
  listGitHubProjectViews = this.queryCommands.listGitHubProjectViews.bind(this.queryCommands)
  getGitHubProjectViewTable = this.queryCommands.getGitHubProjectViewTable.bind(this.queryCommands)
  getGitHubProjectWorkItemDetailsBySlug =
    this.queryCommands.getGitHubProjectWorkItemDetailsBySlug.bind(this.queryCommands)
  updateGitHubProjectItemField = this.mutationCommands.updateGitHubProjectItemField.bind(
    this.mutationCommands
  )
  clearGitHubProjectItemField = this.mutationCommands.clearGitHubProjectItemField.bind(
    this.mutationCommands
  )
  updateGitHubIssueBySlug = this.mutationCommands.updateGitHubIssueBySlug.bind(
    this.mutationCommands
  )
  updateGitHubPullRequestBySlug = this.mutationCommands.updateGitHubPullRequestBySlug.bind(
    this.mutationCommands
  )
  updateGitHubIssueTypeBySlug = this.mutationCommands.updateGitHubIssueTypeBySlug.bind(
    this.mutationCommands
  )
  addGitHubIssueCommentBySlug = this.mutationCommands.addGitHubIssueCommentBySlug.bind(
    this.mutationCommands
  )
  updateGitHubIssueCommentBySlug = this.mutationCommands.updateGitHubIssueCommentBySlug.bind(
    this.mutationCommands
  )
  deleteGitHubIssueCommentBySlug = this.mutationCommands.deleteGitHubIssueCommentBySlug.bind(
    this.mutationCommands
  )
}
