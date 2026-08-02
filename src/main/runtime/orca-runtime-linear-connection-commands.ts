import type { LinearWorkspaceSelection } from '../../shared/types'
import {
  connect as connectLinear,
  disconnect as disconnectLinear,
  getStatus as getLinearStatus,
  selectWorkspace as selectLinearWorkspace,
  testConnection as testLinearConnection
} from '../linear/client'
import { searchIssues as searchLinearIssues } from '../linear/issues'
import { searchLinearIssuesForAgents } from '../linear/issue-context'

export class RuntimeLinearConnectionCommands {
  linearConnect(apiKey: string): ReturnType<typeof connectLinear> {
    return connectLinear(apiKey)
  }

  linearDisconnect(workspaceId?: string): { ok: true } {
    disconnectLinear(workspaceId)
    return { ok: true }
  }

  linearSelectWorkspace(workspaceId: LinearWorkspaceSelection): ReturnType<typeof getLinearStatus> {
    return selectLinearWorkspace(workspaceId)
  }

  linearStatus(): ReturnType<typeof getLinearStatus> {
    return getLinearStatus()
  }

  linearTestConnection(workspaceId?: string): ReturnType<typeof testLinearConnection> {
    return testLinearConnection(workspaceId)
  }

  linearSearchIssues(
    query: string,
    limit = 20,
    workspaceId?: LinearWorkspaceSelection
  ): ReturnType<typeof searchLinearIssues> {
    return searchLinearIssues(query, Math.min(Math.max(1, limit), 50), workspaceId)
  }

  linearSearchForAgents(args: {
    query: string
    limit?: number
    workspaceId?: string | 'all'
  }): ReturnType<typeof searchLinearIssuesForAgents> {
    return searchLinearIssuesForAgents(args)
  }
}
