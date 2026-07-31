import type { FolderWorkspace } from '../../shared/types'
import type { RuntimeRpcSuccess } from '../runtime-client'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { resolveRepoPathArgument } from '../repo-path-arguments'
import { RuntimeClientError } from '../runtime-client'

type FolderWorkspaceListResult = { folderWorkspaces: FolderWorkspace[] }
type HostQualifiedFolderWorkspace = FolderWorkspace & {
  executionHostId: `runtime:${string}` | 'local'
}

function getCreationOperationId(ctx: HandlerContext): string {
  const value = getRequiredStringFlag(ctx.flags, 'operation-id').trim()
  if (value.length === 0 || value.length > 256) {
    throw new RuntimeClientError(
      'invalid_args',
      'Flag --operation-id must be between 1 and 256 non-whitespace characters.'
    )
  }
  return value
}

function executionHostId(
  response: RuntimeRpcSuccess<unknown>,
  isRemote: boolean
): HostQualifiedFolderWorkspace['executionHostId'] {
  if (!isRemote) {
    return 'local'
  }
  const runtimeId = response._meta.runtimeId
  if (!runtimeId) {
    throw new RuntimeClientError(
      'state_conflict',
      'Remote runtime response has no runtime identity.'
    )
  }
  return `runtime:${runtimeId}`
}

function qualify(
  workspace: FolderWorkspace,
  response: RuntimeRpcSuccess<unknown>,
  isRemote: boolean
): HostQualifiedFolderWorkspace {
  return { ...workspace, executionHostId: executionHostId(response, isRemote) }
}

function assertSameRuntime(
  mutation: RuntimeRpcSuccess<unknown>,
  readBack: RuntimeRpcSuccess<unknown>
): void {
  if (!mutation._meta.runtimeId || mutation._meta.runtimeId !== readBack._meta.runtimeId) {
    throw new RuntimeClientError(
      'state_conflict',
      'The selected runtime changed before authoritative state could be verified.'
    )
  }
}

async function listQualified(ctx: HandlerContext): Promise<{
  response: RuntimeRpcSuccess<FolderWorkspaceListResult>
  workspaces: HostQualifiedFolderWorkspace[]
}> {
  const response = await ctx.client.call<FolderWorkspaceListResult>('folderWorkspace.list')
  return {
    response,
    workspaces: response.result.folderWorkspaces.map((workspace) =>
      qualify(workspace, response, ctx.client.isRemote)
    )
  }
}

function formatList(result: FolderWorkspaceListResult): string {
  if (result.folderWorkspaces.length === 0) {
    return 'No folder workspaces.'
  }
  return result.folderWorkspaces
    .map(
      (workspace) =>
        `${workspace.executionHostId ?? 'unknown'}:${workspace.id}  ${workspace.name}  ${workspace.folderPath}`
    )
    .join('\n')
}

function formatOne(result: { folderWorkspace: HostQualifiedFolderWorkspace }): string {
  const workspace = result.folderWorkspace
  return [
    `id: ${workspace.id}`,
    `executionHostId: ${workspace.executionHostId}`,
    `projectGroupId: ${workspace.projectGroupId}`,
    `name: ${workspace.name}`,
    `folderPath: ${workspace.folderPath}`
  ].join('\n')
}

export const FOLDER_WORKSPACE_HANDLERS: Record<string, CommandHandler> = {
  'folder-workspace list': async (ctx) => {
    const { response, workspaces } = await listQualified(ctx)
    printResult({ ...response, result: { folderWorkspaces: workspaces } }, ctx.json, formatList)
  },
  'folder-workspace add': async (ctx) => {
    const path = resolveRepoPathArgument(
      getRequiredStringFlag(ctx.flags, 'path'),
      ctx.cwd,
      ctx.client.isRemote,
      'Folder workspace add'
    )
    const created = await ctx.client.call<{ folderWorkspace: FolderWorkspace }>(
      'folderWorkspace.create',
      {
        projectGroupId: getRequiredStringFlag(ctx.flags, 'project-group'),
        folderPath: path,
        name: getOptionalStringFlag(ctx.flags, 'name'),
        operationId: getCreationOperationId(ctx)
      }
    )
    const { response, workspaces } = await listQualified(ctx)
    assertSameRuntime(created, response)
    const workspace = workspaces.find(
      (candidate) => candidate.id === created.result.folderWorkspace.id
    )
    if (!workspace) {
      throw new RuntimeClientError(
        'state_conflict',
        'Folder workspace create was not visible in authoritative state.'
      )
    }
    printResult(
      { ...response, result: { folderWorkspace: workspace, authoritative: true as const } },
      ctx.json,
      formatOne
    )
  },
  'folder-workspace inspect': async (ctx) => {
    const id = getRequiredStringFlag(ctx.flags, 'folder-workspace')
    const { response, workspaces } = await listQualified(ctx)
    const workspace = workspaces.find((candidate) => candidate.id === id)
    if (!workspace) {
      throw new RuntimeClientError('not_found', `Folder workspace not found: ${id}`)
    }
    printResult({ ...response, result: { folderWorkspace: workspace } }, ctx.json, formatOne)
  },
  'folder-workspace remove': async (ctx) => {
    const id = getRequiredStringFlag(ctx.flags, 'folder-workspace')
    const removed = await ctx.client.call<{ deleted: boolean }>('folderWorkspace.delete', {
      folderWorkspaceId: id
    })
    const { response, workspaces } = await listQualified(ctx)
    assertSameRuntime(removed, response)
    if (workspaces.some((candidate) => candidate.id === id)) {
      throw new RuntimeClientError(
        'state_conflict',
        'Folder workspace delete remained visible in authoritative state.'
      )
    }
    const result = {
      deleted: removed.result.deleted,
      folderWorkspaceId: id,
      executionHostId: executionHostId(response, ctx.client.isRemote),
      authoritative: true as const
    }
    printResult({ ...response, result }, ctx.json, (value) =>
      value.deleted
        ? `Removed ${value.executionHostId}:${value.folderWorkspaceId}.`
        : `${value.executionHostId}:${value.folderWorkspaceId} was already absent.`
    )
  }
}
