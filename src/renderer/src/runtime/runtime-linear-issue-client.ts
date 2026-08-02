import type {
  GlobalSettings,
  LinearComment,
  LinearCollectionResult,
  LinearConnectionStatus,
  LinearCustomViewModel,
  LinearCustomViewSummary,
  LinearIssue,
  LinearIssueUpdate,
  LinearLabel,
  LinearMember,
  LinearProjectDetail,
  LinearProjectSummary,
  LinearTeam,
  LinearViewer,
  LinearWorkspaceSelection,
  LinearWorkflowState
} from '../../../shared/types'
import {
  callRuntimeRpc,
  getActiveRuntimeTarget,
  runtimeEnvironmentSupportsCapability
} from './runtime-rpc-client'
import {
  getTaskSourceRuntimeSettings,
  type TaskSourceContext
} from '../../../shared/task-source-context'
import { isRuntimeProviderSearchQueryWithinLimit } from './runtime-provider-search-bounds'
import type { LinearIssueAttributeFilter } from '../../../shared/linear-issue-attribute-filter'
import {
  canonicalizeLinearIssueAttributeFilter,
  isEmptyLinearIssueAttributeFilter
} from '../../../shared/linear-issue-attribute-filter'
import { LINEAR_ISSUE_ATTRIBUTE_FILTER_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import {
  getLinearRuntimeTarget,
  LinearIssueAttributeFilterUnsupportedError,
  linearReadForce,
  normalizeLinearIssueCollectionResult,
  type RuntimeLinearSettings,
  type LinearCommentResult,
  type LinearConnectResult,
  type LinearCreateIssueResult,
  type LinearCreateProjectResult,
  type LinearIssueFilter,
  type LinearMutationResult,
  type LinearReadOptions
} from './runtime-linear-client-contracts'

export async function linearStatus(
  settings: RuntimeLinearSettings
): Promise<LinearConnectionStatus> {
  const target = getLinearRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<LinearConnectionStatus>(target, 'linear.status', undefined, {
        timeoutMs: 15_000
      })
    : window.api.linear.status()
}

export async function linearTestConnection(
  settings: RuntimeLinearSettings,
  workspaceId?: string | null
): Promise<LinearConnectResult> {
  const target = getLinearRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<LinearConnectResult>(
        target,
        'linear.testConnection',
        workspaceId ? { workspaceId } : undefined,
        {
          timeoutMs: 30_000
        }
      )
    : window.api.linear.testConnection(workspaceId ? { workspaceId } : undefined)
}

export async function linearConnect(
  settings: RuntimeLinearSettings,
  apiKey: string
): Promise<LinearConnectResult> {
  const target = getLinearRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<LinearConnectResult>(
        target,
        'linear.connect',
        { apiKey },
        { timeoutMs: 30_000 }
      )
    : window.api.linear.connect({ apiKey })
}

export async function linearDisconnect(settings: RuntimeLinearSettings): Promise<void> {
  return linearDisconnectWorkspace(settings)
}

export async function linearDisconnectWorkspace(
  settings: RuntimeLinearSettings,
  workspaceId?: string | null
): Promise<void> {
  const target = getLinearRuntimeTarget(settings)
  if (target.kind === 'environment') {
    await callRuntimeRpc<{ ok: true }>(
      target,
      'linear.disconnect',
      workspaceId ? { workspaceId } : undefined,
      {
        timeoutMs: 15_000
      }
    )
    return
  }
  await window.api.linear.disconnect(workspaceId ? { workspaceId } : undefined)
}

export async function linearSelectWorkspace(
  settings: RuntimeLinearSettings,
  workspaceId: LinearWorkspaceSelection
): Promise<LinearConnectionStatus> {
  const target = getLinearRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<LinearConnectionStatus>(
        target,
        'linear.selectWorkspace',
        { workspaceId },
        { timeoutMs: 15_000 }
      )
    : window.api.linear.selectWorkspace({ workspaceId })
}

export async function linearSearchIssues(
  settings: RuntimeLinearSettings,
  query: string,
  limit?: number,
  workspaceId?: LinearWorkspaceSelection | null
): Promise<LinearIssue[]> {
  if (!isRuntimeProviderSearchQueryWithinLimit(query)) {
    return []
  }
  const target = getLinearRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<LinearIssue[]>(
        target,
        'linear.searchIssues',
        { query, limit, workspaceId: workspaceId ?? undefined },
        { timeoutMs: 30_000 }
      )
    : window.api.linear.searchIssues({ query, limit, workspaceId: workspaceId ?? undefined })
}

export async function linearListIssues(
  settings: RuntimeLinearSettings,
  filter?: LinearIssueFilter,
  limit?: number,
  workspaceId?: LinearWorkspaceSelection | null,
  attributeFilter?: LinearIssueAttributeFilter | null
): Promise<LinearCollectionResult<LinearIssue>> {
  const target = getLinearRuntimeTarget(settings)
  const canonicalAttributeFilter =
    attributeFilter && !isEmptyLinearIssueAttributeFilter(attributeFilter)
      ? canonicalizeLinearIssueAttributeFilter(attributeFilter)
      : undefined
  const payload = {
    filter,
    limit,
    workspaceId: workspaceId ?? undefined,
    ...(canonicalAttributeFilter ? { attributeFilter: canonicalAttributeFilter } : {})
  }
  if (
    target.kind === 'environment' &&
    canonicalAttributeFilter &&
    !(await runtimeEnvironmentSupportsCapability(
      target.environmentId,
      LINEAR_ISSUE_ATTRIBUTE_FILTER_RUNTIME_CAPABILITY,
      30_000
    ))
  ) {
    // Why: older runtimes silently strip unknown RPC params; rejecting here
    // prevents their unfiltered rows from being presented or cached as filtered.
    throw new LinearIssueAttributeFilterUnsupportedError()
  }
  const result =
    target.kind === 'environment'
      ? await callRuntimeRpc<unknown>(target, 'linear.listIssues', payload, {
          timeoutMs: 30_000
        })
      : await window.api.linear.listIssues(payload)
  return normalizeLinearIssueCollectionResult(result)
}

export async function linearCreateIssue(
  settings: RuntimeLinearSettings,
  args: {
    teamId: string
    title: string
    description?: string
    workspaceId?: string
    parentIssueId?: string
    projectId?: string | null
    stateId?: string
    priority?: number
    assigneeId?: string | null
    labelIds?: string[]
  }
): Promise<LinearCreateIssueResult> {
  const target = getLinearRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<LinearCreateIssueResult>(target, 'linear.createIssue', args, {
        timeoutMs: 30_000
      })
    : window.api.linear.createIssue(args)
}

export async function linearCreateSubIssue(
  settings: RuntimeLinearSettings,
  args: {
    parentIssueId: string
    teamId: string
    title: string
    description?: string
    workspaceId?: string
    projectId?: string | null
  }
): Promise<LinearCreateIssueResult> {
  return linearCreateIssue(settings, args)
}

export async function linearGetIssue(
  settings: RuntimeLinearSettings,
  id: string,
  workspaceId?: string | null
): Promise<LinearIssue | null> {
  const target = getLinearRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<LinearIssue | null>(
        target,
        'linear.getIssue',
        { id, workspaceId: workspaceId ?? undefined },
        { timeoutMs: 30_000 }
      )
    : window.api.linear.getIssue({ id, workspaceId: workspaceId ?? undefined })
}

export async function linearUpdateIssue(
  settings: RuntimeLinearSettings,
  id: string,
  updates: LinearIssueUpdate,
  workspaceId?: string | null
): Promise<LinearMutationResult> {
  const target = getLinearRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<LinearMutationResult>(
        target,
        'linear.updateIssue',
        { id, updates, workspaceId: workspaceId ?? undefined },
        { timeoutMs: 30_000 }
      )
    : window.api.linear.updateIssue({ id, updates, workspaceId: workspaceId ?? undefined })
}

export async function linearAddIssueComment(
  settings: RuntimeLinearSettings,
  issueId: string,
  body: string,
  workspaceId?: string | null
): Promise<LinearCommentResult> {
  const target = getLinearRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<LinearCommentResult>(
        target,
        'linear.addIssueComment',
        { issueId, body, workspaceId: workspaceId ?? undefined },
        { timeoutMs: 30_000 }
      )
    : window.api.linear.addIssueComment({ issueId, body, workspaceId: workspaceId ?? undefined })
}

export async function linearIssueComments(
  settings: RuntimeLinearSettings,
  issueId: string,
  workspaceId?: string | null
): Promise<LinearComment[]> {
  const target = getLinearRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<LinearComment[]>(
        target,
        'linear.issueComments',
        { issueId, workspaceId: workspaceId ?? undefined },
        { timeoutMs: 30_000 }
      )
    : window.api.linear.issueComments({ issueId, workspaceId: workspaceId ?? undefined })
}

export async function linearListTeams(
  settings: RuntimeLinearSettings,
  workspaceId?: LinearWorkspaceSelection | null
): Promise<LinearTeam[]> {
  const target = getLinearRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<LinearTeam[]>(
        target,
        'linear.listTeams',
        workspaceId ? { workspaceId } : undefined,
        { timeoutMs: 30_000 }
      )
    : window.api.linear.listTeams(workspaceId ? { workspaceId } : undefined)
}

export async function linearListProjects(
  settings: RuntimeLinearSettings,
  query?: string,
  limit?: number,
  workspaceId?: LinearWorkspaceSelection | null,
  options?: LinearReadOptions
): Promise<LinearCollectionResult<LinearProjectSummary>> {
  if (!isRuntimeProviderSearchQueryWithinLimit(query)) {
    return { items: [] }
  }
  const target = getLinearRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<LinearCollectionResult<LinearProjectSummary>>(
        target,
        'linear.listProjects',
        { query, limit, workspaceId: workspaceId ?? undefined, ...linearReadForce(options) },
        { timeoutMs: 30_000 }
      )
    : typeof window.api.linear.listProjects === 'function'
      ? window.api.linear.listProjects({
          query,
          limit,
          workspaceId: workspaceId ?? undefined,
          ...linearReadForce(options)
        })
      : { items: [] }
}
