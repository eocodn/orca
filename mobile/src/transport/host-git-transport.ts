import type { RpcClient } from './rpc-client'
import { readGitRequest, type MobileGitRequest } from './host-protocol-status'
import type { RpcResponse } from './types'

export type MobileGitWorktree = {
  path: string
  head: string
  branch: string | null
  is_bare: boolean
  locked: boolean
  lock_reason: string | null
  prunable: boolean
  prunable_reason: string | null
  is_main: boolean
}

export type MobileGitWorktreeResponse = {
  request_id: string
  capability: 'git'
  operation: 'worktree-list'
  worktrees: MobileGitWorktree[]
}

export function createGitWorktreeRequest(
  requestId: string,
  repositoryPath: string
): MobileGitRequest {
  if (requestId.trim().length === 0 || repositoryPath.trim().length === 0) {
    throw new Error('Git request id and repository path are required')
  }
  return {
    envelope: {
      request_id: requestId,
      capability: 'git',
      protocol_version: 1
    },
    operation: {
      type: 'worktree_list',
      repository_path: repositoryPath
    }
  }
}

export function readGitWorktreeResponse(value: unknown): MobileGitWorktreeResponse | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as {
    request_id?: unknown
    capability?: unknown
    operation?: unknown
    worktrees?: unknown
  }
  if (
    typeof candidate.request_id !== 'string' ||
    candidate.request_id.trim().length === 0 ||
    candidate.capability !== 'git' ||
    candidate.operation !== 'worktree-list' ||
    !Array.isArray(candidate.worktrees)
  ) {
    return null
  }
  const worktrees: MobileGitWorktree[] = []
  for (const value of candidate.worktrees) {
    if (!value || typeof value !== 'object') {
      return null
    }
    const worktree = value as Record<string, unknown>
    if (
      typeof worktree.path !== 'string' ||
      worktree.path.trim().length === 0 ||
      typeof worktree.head !== 'string' ||
      !isNullableString(worktree.branch) ||
      typeof worktree.is_bare !== 'boolean' ||
      typeof worktree.locked !== 'boolean' ||
      !isNullableString(worktree.lock_reason) ||
      typeof worktree.prunable !== 'boolean' ||
      !isNullableString(worktree.prunable_reason) ||
      typeof worktree.is_main !== 'boolean'
    ) {
      return null
    }
    worktrees.push(worktree as unknown as MobileGitWorktree)
  }
  return {
    request_id: candidate.request_id,
    capability: 'git',
    operation: 'worktree-list',
    worktrees
  }
}

export async function requestGitWorktrees(
  client: Pick<RpcClient, 'sendRequest'>,
  request: MobileGitRequest
): Promise<MobileGitWorktreeResponse> {
  if (!readGitRequest(request)) {
    throw new Error('Invalid Git Host request')
  }
  const response: RpcResponse = await client.sendRequest('host.request', request)
  if (!response.ok) {
    throw new Error(`Host Git request failed: ${response.error.code}`)
  }
  const result = readGitWorktreeResponse(response.result)
  if (!result || result.request_id !== request.envelope.request_id) {
    throw new Error('Invalid Host Git response')
  }
  return result
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}
