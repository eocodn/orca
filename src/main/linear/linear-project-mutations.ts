import type {
  LinearCollectionResult,
  LinearConcreteWorkspaceId,
  LinearCustomViewModel,
  LinearCustomViewSummary,
  LinearIssue,
  LinearProjectDetail,
  LinearProjectMemberSummary,
  LinearProjectSummary,
  LinearWorkspaceError,
  LinearWorkspaceSelection
} from '../../shared/types'
import {
  LINEAR_ISSUE_API_PAGE_SIZE_MAX,
  clampLinearIssueListLimit
} from '../../shared/linear-issue-read-limits'
import {
  acquire,
  clearToken,
  getClients,
  isAuthError,
  release,
  type LinearClientForWorkspace
} from './client'
import {
  CREATE_PROJECT_MUTATION,
  CUSTOM_VIEWS_QUERY,
  CUSTOM_VIEW_ISSUES_QUERY,
  CUSTOM_VIEW_PROJECTS_QUERY,
  CUSTOM_VIEW_QUERY,
  PROJECTS_QUERY,
  PROJECT_ISSUES_QUERY,
  PROJECT_QUERY,
  PROJECT_TEAMS_QUERY,
  SEARCH_PROJECTS_QUERY
} from './linear-project-queries'
import { type LinearRawVariables, type ProjectMutationResponse, type LinearProjectCreateInput, mapProjectDetailForWorkspace } from './linear-project-primitives'
async function createProject(
  input: LinearProjectCreateInput,
  workspaceId?: string | null
): Promise<{ ok: true; project: LinearProjectDetail } | { ok: false; error: string }> {
  const entry = getClients(workspaceId)[0]
  if (!entry) {
    return { ok: false, error: 'Not connected to Linear' }
  }

  await acquire()
  try {
    const result = await entry.client.client.rawRequest<
      ProjectMutationResponse,
      LinearRawVariables
    >(CREATE_PROJECT_MUTATION, { input })
    const payload = result.data?.projectCreate
    const project = payload?.project
    if (!payload?.success || !project) {
      return { ok: false, error: 'Linear project create failed' }
    }
    return { ok: true, project: mapProjectDetailForWorkspace(entry, project) }
  } catch (error) {
    if (isAuthError(error)) {
      clearToken(entry.workspace.id)
      throw error
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  } finally {
    release()
  }
}

export { createProject }

