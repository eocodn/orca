import { describe, expect, it, vi } from 'vitest'
import {
  createGitWorktreeRequest,
  readGitWorktreeResponse,
  requestGitWorktrees
} from './host-git-transport'

const worktree = {
  path: 'C:\\workspaces\\repo',
  head: 'abc',
  branch: 'refs/heads/main',
  is_bare: false,
  locked: false,
  lock_reason: null,
  prunable: false,
  prunable_reason: null,
  is_main: true
}

describe('mobile Host Git transport', () => {
  it('creates the versioned request consumed by Tauri and Rust Host', () => {
    expect(createGitWorktreeRequest('request-7', 'C:\\workspaces\\repo')).toEqual({
      envelope: { request_id: 'request-7', capability: 'git', protocol_version: 1 },
      operation: { type: 'worktree_list', repository_path: 'C:\\workspaces\\repo' }
    })
  })

  it('rejects malformed worktree responses without fallback parsing', () => {
    expect(readGitWorktreeResponse({ request_id: 'request-7', capability: 'git' })).toBeNull()
    expect(
      readGitWorktreeResponse({
        request_id: 'request-7',
        capability: 'git',
        operation: 'worktree-list',
        worktrees: [{ ...worktree, is_main: 'yes' }]
      })
    ).toBeNull()
  })

  it('sends the same Host request through the authenticated RPC and validates its response id', async () => {
    const client = {
      sendRequest: vi.fn().mockResolvedValue({
        id: 'rpc-1',
        ok: true,
        result: {
          request_id: 'request-7',
          capability: 'git',
          operation: 'worktree-list',
          worktrees: [worktree]
        }
      })
    }
    const request = createGitWorktreeRequest('request-7', '/repo')

    await expect(requestGitWorktrees(client, request)).resolves.toMatchObject({
      request_id: 'request-7',
      worktrees: [worktree]
    })
    expect(client.sendRequest).toHaveBeenCalledWith('host.request', request)
  })
})
