import type {
  LinearCollectionResult,
  LinearConcreteWorkspaceId,
  LinearIssue,
  LinearProjectSummary
} from '../../shared/types'
import { clampLinearIssueListLimit } from '../../shared/linear-issue-read-limits'
import {
  acquire,
  clearToken,
  getClients,
  isAuthError,
  release
} from './client'
import {
  PROJECT_TEAMS_QUERY,
  PROJECT_ISSUES_QUERY
} from './linear-project-queries'
import { type LinearRawVariables, type ProjectIssueConnectionResponse, type ProjectTeamsResponse, coalesce, normalizeConcreteWorkspaceId, readIssueConnectionPages, readConcreteCollection } from './linear-project-primitives'
async function listProjectIssues(
  projectId: string,
  limit = 20,
  workspaceId: LinearConcreteWorkspaceId,
  force = false
): Promise<LinearCollectionResult<LinearIssue>> {
  const id = projectId.trim()
  if (!id) {
    throw new Error('Project ID is required')
  }
  const first = clampLinearIssueListLimit(limit)
  const concreteWorkspaceId = normalizeConcreteWorkspaceId(workspaceId)
  return readConcreteCollection(
    `listProjectIssues:${concreteWorkspaceId}:${id}:${first}`,
    concreteWorkspaceId,
    async (entry) => {
      return readIssueConnectionPages(entry, first, async (page) => {
        const result = await entry.client.client.rawRequest<
          ProjectIssueConnectionResponse,
          LinearRawVariables
        >(PROJECT_ISSUES_QUERY, { id, ...page, orderBy: 'updatedAt' })
        const project = result.data?.project
        if (!project) {
          throw new Error('Project was not found')
        }
        return project.issues
      })
    },
    force
  )
}

async function listProjectTeams(
  projectId: string,
  workspaceId: LinearConcreteWorkspaceId,
  force = false
): Promise<NonNullable<LinearProjectSummary['teams']>> {
  const id = projectId.trim()
  if (!id) {
    throw new Error('Project ID is required')
  }
  const concreteWorkspaceId = normalizeConcreteWorkspaceId(workspaceId)
  const key = `listProjectTeams:${concreteWorkspaceId}:${id}`
  return coalesce(
    key,
    async () => {
      const entry = getClients(concreteWorkspaceId)[0]
      if (!entry) {
        return []
      }
      const teams: NonNullable<LinearProjectSummary['teams']> = []
      let after: string | undefined
      await acquire()
      try {
        while (true) {
          const result = await entry.client.client.rawRequest<
            ProjectTeamsResponse,
            LinearRawVariables
          >(PROJECT_TEAMS_QUERY, {
            id,
            first: 50,
            ...(after ? { after } : {})
          })
          const project = result.data?.project
          if (!project) {
            throw new Error('Project was not found')
          }
          const connection = project.teams
          const nodes = connection?.nodes ?? []
          teams.push(
            ...nodes.map((team) => ({
              id: team.id,
              name: team.name ?? '',
              key: team.key ?? undefined
            }))
          )
          const nextCursor = connection?.pageInfo?.endCursor ?? undefined
          if (
            !connection?.pageInfo?.hasNextPage ||
            !nextCursor ||
            nextCursor === after ||
            nodes.length === 0
          ) {
            break
          }
          after = nextCursor
        }
        return teams
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

export { listProjectIssues, listProjectTeams }
