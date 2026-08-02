import type { LinearCustomViewModel, LinearWorkspaceSelection } from '../../shared/types'
import {
  addIssueComment as addLinearIssueComment,
  createIssue as createLinearIssue,
  getIssue as getLinearIssue,
  getIssueComments as getLinearIssueComments,
  listIssues as listLinearIssues,
  updateIssue as updateLinearIssue
} from '../linear/issues'
import {
  createProject as createLinearProject,
  getCustomView as getLinearCustomView,
  getProject as getLinearProject,
  listCustomViewIssues as listLinearCustomViewIssues,
  listCustomViewProjects as listLinearCustomViewProjects,
  listCustomViews as listLinearCustomViews,
  listProjectIssues as listLinearProjectIssues,
  listProjects as listLinearProjects
} from '../linear/projects'
import type { LinearProjectCreateInput } from '../linear/projects'
import {
  getTeamLabels as getLinearTeamLabels,
  getTeamMembers as getLinearTeamMembers,
  getTeamStates as getLinearTeamStates,
  listTeams as listLinearTeams
} from '../linear/teams'
import { clampLinearIssueListLimit } from '../../shared/linear-issue-read-limits'

export class RuntimeLinearQueryCommands {
  linearIssueComments(
    issueId: string,
    workspaceId?: string
  ): ReturnType<typeof getLinearIssueComments> {
    return getLinearIssueComments(issueId, workspaceId)
  }

  linearListTeams(workspaceId?: LinearWorkspaceSelection): ReturnType<typeof listLinearTeams> {
    return listLinearTeams(workspaceId)
  }

  linearListProjects(
    query?: string,
    limit = 20,
    workspaceId?: LinearWorkspaceSelection,
    force?: boolean
  ): ReturnType<typeof listLinearProjects> {
    return listLinearProjects(query, Math.min(Math.max(1, limit), 50), workspaceId, force)
  }

  linearCreateProject(
    input: LinearProjectCreateInput,
    workspaceId?: string
  ): ReturnType<typeof createLinearProject> {
    return createLinearProject(input, workspaceId)
  }

  linearGetProject(
    id: string,
    workspaceId: string,
    force?: boolean
  ): ReturnType<typeof getLinearProject> {
    return getLinearProject(id, workspaceId, force)
  }

  linearListProjectIssues(
    projectId: string,
    limit = 20,
    workspaceId: string,
    force?: boolean
  ): ReturnType<typeof listLinearProjectIssues> {
    return listLinearProjectIssues(projectId, clampLinearIssueListLimit(limit), workspaceId, force)
  }

  linearListCustomViews(
    model: LinearCustomViewModel,
    limit = 20,
    workspaceId?: LinearWorkspaceSelection,
    force?: boolean
  ): ReturnType<typeof listLinearCustomViews> {
    return listLinearCustomViews(model, Math.min(Math.max(1, limit), 50), workspaceId, force)
  }

  linearGetCustomView(
    viewId: string,
    model: LinearCustomViewModel,
    workspaceId: string,
    force?: boolean
  ): ReturnType<typeof getLinearCustomView> {
    return getLinearCustomView(viewId, model, workspaceId, force)
  }

  linearListCustomViewIssues(
    viewId: string,
    limit = 20,
    workspaceId: string,
    force?: boolean
  ): ReturnType<typeof listLinearCustomViewIssues> {
    return listLinearCustomViewIssues(viewId, clampLinearIssueListLimit(limit), workspaceId, force)
  }

  linearListCustomViewProjects(
    viewId: string,
    limit = 20,
    workspaceId: string,
    force?: boolean
  ): ReturnType<typeof listLinearCustomViewProjects> {
    return listLinearCustomViewProjects(
      viewId,
      Math.min(Math.max(1, limit), 50),
      workspaceId,
      force
    )
  }

  linearTeamStates(teamId: string, workspaceId?: string): ReturnType<typeof getLinearTeamStates> {
    return getLinearTeamStates(teamId, workspaceId)
  }

  linearTeamLabels(teamId: string, workspaceId?: string): ReturnType<typeof getLinearTeamLabels> {
    return getLinearTeamLabels(teamId, workspaceId)
  }

  linearTeamMembers(teamId: string, workspaceId?: string): ReturnType<typeof getLinearTeamMembers> {
    return getLinearTeamMembers(teamId, workspaceId)
  }

  linearListIssues(
    filter: Parameters<typeof listLinearIssues>[0],
    limit = 20,
    workspaceId?: LinearWorkspaceSelection,
    options?: Parameters<typeof listLinearIssues>[3]
  ): ReturnType<typeof listLinearIssues> {
    return listLinearIssues(filter, clampLinearIssueListLimit(limit), workspaceId, options)
  }

  linearGetIssue(id: string, workspaceId?: string): ReturnType<typeof getLinearIssue> {
    return getLinearIssue(id, workspaceId)
  }

  linearCreateIssue(
    teamId: string,
    title: string,
    description?: string,
    workspaceId?: string,
    parentIssueId?: string,
    projectId?: string | null,
    options?: Parameters<typeof createLinearIssue>[4]
  ): ReturnType<typeof createLinearIssue> {
    return createLinearIssue(teamId, title, description, workspaceId, {
      parentId: parentIssueId,
      projectId,
      ...options
    })
  }

  linearUpdateIssue(
    id: string,
    updates: Parameters<typeof updateLinearIssue>[1],
    workspaceId?: string
  ): ReturnType<typeof updateLinearIssue> {
    return updateLinearIssue(id, updates, workspaceId)
  }

  linearAddIssueComment(
    issueId: string,
    body: string,
    workspaceId?: string
  ): ReturnType<typeof addLinearIssueComment> {
    return addLinearIssueComment(issueId, body, workspaceId)
  }
}
