import type {
  LinearCollectionResult,
  LinearConcreteWorkspaceId,
  LinearCustomViewModel,
  LinearCustomViewSummary,
  LinearIssue,
  LinearProjectSummary,
  LinearWorkspaceSelection
} from '../../shared/types'
import {
  clampLinearIssueListLimit
} from '../../shared/linear-issue-read-limits'
import {
  acquire,
  clearToken,
  getClients,
  isAuthError,
  release
} from './client'
import {
  CUSTOM_VIEWS_QUERY,
  CUSTOM_VIEW_ISSUES_QUERY,
  CUSTOM_VIEW_PROJECTS_QUERY,
  CUSTOM_VIEW_QUERY
} from './linear-project-queries'
import { type LinearRawVariables, type CustomViewConnectionResponse, clampLimit, coalesce, normalizeConcreteWorkspaceId, mapProjectForWorkspace, mapCustomViewModel, mapCustomViewForWorkspace, readIssueConnectionPages, readCollection, readConcreteCollection } from './linear-project-primitives'
async function listCustomViews(
  model: LinearCustomViewModel,
  limit = 20,
  workspaceId?: LinearWorkspaceSelection | null,
  force = false
): Promise<LinearCollectionResult<LinearCustomViewSummary>> {
  const first = clampLimit(limit)
  const key = `listCustomViews:${workspaceId ?? 'default'}:${model}:${first}`
  const filter = { modelName: { eq: model === 'project' ? 'Project' : 'Issue' } }
  return readCollection(
    key,
    workspaceId,
    async (entry) => {
      const result = await entry.client.client.rawRequest<
        CustomViewConnectionResponse,
        LinearRawVariables
      >(CUSTOM_VIEWS_QUERY, { first, filter, orderBy: 'updatedAt' })
      const connection = result.data?.customViews
      return {
        items: (connection?.nodes ?? [])
          .map((view) => mapCustomViewForWorkspace(entry, view))
          .filter((view): view is LinearCustomViewSummary => !!view && view.model === model),
        hasMore: !!connection?.pageInfo?.hasNextPage
      }
    },
    force
  )
}

async function getCustomView(
  viewId: string,
  model: LinearCustomViewModel,
  workspaceId: LinearConcreteWorkspaceId,
  force = false
): Promise<LinearCustomViewSummary | null> {
  const id = viewId.trim()
  const concreteWorkspaceId = normalizeConcreteWorkspaceId(workspaceId)
  if (!id) {
    throw new Error('Custom view ID is required')
  }
  const key = `getCustomView:${concreteWorkspaceId}:${model}:${id}`
  return coalesce(
    key,
    async () => {
      const entries = getClients(concreteWorkspaceId)
      const entry = entries[0]
      if (!entry) {
        return null
      }
      await acquire()
      try {
        const result = await entry.client.client.rawRequest<
          CustomViewConnectionResponse,
          LinearRawVariables
        >(CUSTOM_VIEW_QUERY, { id })
        const view = result.data?.customView
        const mapped = view ? mapCustomViewForWorkspace(entry, view) : null
        return mapped?.model === model ? mapped : null
      } catch (error) {
        if (isAuthError(error)) {
          clearToken(entry.workspace.id)
        }
        throw error
      } finally {
        release()
      }
    },
    force
  )
}

async function listCustomViewIssues(
  viewId: string,
  limit = 20,
  workspaceId: LinearConcreteWorkspaceId,
  force = false
): Promise<LinearCollectionResult<LinearIssue>> {
  const id = viewId.trim()
  if (!id) {
    throw new Error('Custom view ID is required')
  }
  const first = clampLinearIssueListLimit(limit)
  const concreteWorkspaceId = normalizeConcreteWorkspaceId(workspaceId)
  return readConcreteCollection(
    `listCustomViewIssues:${concreteWorkspaceId}:${id}:${first}`,
    concreteWorkspaceId,
    async (entry) => {
      return readIssueConnectionPages(entry, first, async (page) => {
        const result = await entry.client.client.rawRequest<
          CustomViewConnectionResponse,
          LinearRawVariables
        >(CUSTOM_VIEW_ISSUES_QUERY, { id, ...page, orderBy: 'updatedAt' })
        const view = result.data?.customView
        if (mapCustomViewModel(view?.modelName) !== 'issue') {
          throw new Error('Custom view does not contain issues')
        }
        return view?.issues
      })
    },
    force
  )
}

async function listCustomViewProjects(
  viewId: string,
  limit = 20,
  workspaceId: LinearConcreteWorkspaceId,
  force = false
): Promise<LinearCollectionResult<LinearProjectSummary>> {
  const id = viewId.trim()
  if (!id) {
    throw new Error('Custom view ID is required')
  }
  const first = clampLimit(limit)
  const concreteWorkspaceId = normalizeConcreteWorkspaceId(workspaceId)
  return readConcreteCollection(
    `listCustomViewProjects:${concreteWorkspaceId}:${id}:${first}`,
    concreteWorkspaceId,
    async (entry) => {
      const result = await entry.client.client.rawRequest<
        CustomViewConnectionResponse,
        LinearRawVariables
      >(CUSTOM_VIEW_PROJECTS_QUERY, { id, first, orderBy: 'updatedAt' })
      const view = result.data?.customView
      if (mapCustomViewModel(view?.modelName) !== 'project') {
        throw new Error('Custom view does not contain projects')
      }
      const connection = view?.projects
      return {
        items: (connection?.nodes ?? []).map((project) => mapProjectForWorkspace(entry, project)),
        hasMore: !!connection?.pageInfo?.hasNextPage
      }
    },
    force
  )
}

export { listCustomViews, getCustomView, listCustomViewIssues, listCustomViewProjects }
