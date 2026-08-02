import {
  getProjectViewTable,
  getWorkItemDetailsBySlug,
  listAccessibleProjects,
  listProjectViews,
  resolveProjectRef,
  listAssignableUsersBySlug,
  listIssueTypesBySlug,
  listLabelsBySlug
} from '../github/project-view'
import type {
  GetProjectViewTableArgs,
  ListAccessibleProjectsArgs,
  ListAssignableUsersBySlugArgs,
  ListIssueTypesBySlugArgs,
  ListLabelsBySlugArgs,
  ListProjectViewsArgs,
  ProjectWorkItemDetailsBySlugArgs,
  ResolveProjectRefArgs
} from '../../shared/github-project-types'

export class RuntimeGithubProjectQueryCommands {
  listGitHubProjects(args?: ListAccessibleProjectsArgs) {
    return listAccessibleProjects(args)
  }

  listGitHubLabelsBySlug(args: ListLabelsBySlugArgs) {
    return listLabelsBySlug(args)
  }

  listGitHubAssignableUsersBySlug(args: ListAssignableUsersBySlugArgs) {
    return listAssignableUsersBySlug(args)
  }

  listGitHubIssueTypesBySlug(args: ListIssueTypesBySlugArgs) {
    return listIssueTypesBySlug(args)
  }

  resolveGitHubProjectRef(args: ResolveProjectRefArgs) {
    return resolveProjectRef(args)
  }

  listGitHubProjectViews(args: ListProjectViewsArgs) {
    return listProjectViews(args)
  }

  getGitHubProjectViewTable(args: GetProjectViewTableArgs) {
    return getProjectViewTable(args)
  }

  getGitHubProjectWorkItemDetailsBySlug(args: ProjectWorkItemDetailsBySlugArgs) {
    return getWorkItemDetailsBySlug(args)
  }
}
