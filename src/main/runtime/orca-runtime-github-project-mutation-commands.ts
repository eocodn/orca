import {
  clearProjectItemFieldValue,
  addIssueCommentBySlug,
  deleteIssueCommentBySlug,
  updateIssueCommentBySlug,
  updateIssueBySlug,
  updateIssueTypeBySlug,
  updateProjectItemFieldValue,
  updatePullRequestBySlug
} from '../github/project-view'
import type {
  AddIssueCommentBySlugArgs,
  ClearProjectItemFieldArgs,
  DeleteIssueCommentBySlugArgs,
  UpdateIssueBySlugArgs,
  UpdateIssueCommentBySlugArgs,
  UpdateIssueTypeBySlugArgs,
  UpdateProjectItemFieldArgs,
  UpdatePullRequestBySlugArgs
} from '../../shared/github-project-types'

export class RuntimeGithubProjectMutationCommands {
  updateGitHubProjectItemField(args: UpdateProjectItemFieldArgs) {
    return updateProjectItemFieldValue(args)
  }

  clearGitHubProjectItemField(args: ClearProjectItemFieldArgs) {
    return clearProjectItemFieldValue(args)
  }

  updateGitHubIssueBySlug(args: UpdateIssueBySlugArgs) {
    return updateIssueBySlug(args)
  }

  updateGitHubPullRequestBySlug(args: UpdatePullRequestBySlugArgs) {
    return updatePullRequestBySlug(args)
  }

  updateGitHubIssueTypeBySlug(args: UpdateIssueTypeBySlugArgs) {
    return updateIssueTypeBySlug(args)
  }

  addGitHubIssueCommentBySlug(args: AddIssueCommentBySlugArgs) {
    return addIssueCommentBySlug(args)
  }

  updateGitHubIssueCommentBySlug(args: UpdateIssueCommentBySlugArgs) {
    return updateIssueCommentBySlug(args)
  }

  deleteGitHubIssueCommentBySlug(args: DeleteIssueCommentBySlugArgs) {
    return deleteIssueCommentBySlug(args)
  }
}
