import { describe, expect, it } from 'vitest'
import {
  readGitRequest,
  readHostProtocolEnvelope,
  readHostProtocolStatus
} from './host-protocol-status'

describe('mobile Host protocol descriptor', () => {
  it('accepts the Rust Host descriptor advertised by status.get', () => {
    expect(
      readHostProtocolStatus({
        version: 1,
        capabilities: ['workspace.read', 'workspace.write', 'terminal', 'git']
      })
    ).toEqual({
      version: 1,
      capabilities: ['workspace.read', 'workspace.write', 'terminal', 'git']
    })
  })

  it('rejects unknown capabilities instead of treating them as supported', () => {
    expect(readHostProtocolStatus({ version: 1, capabilities: ['future.capability'] })).toBeNull()
  })

  it('accepts and rejects the Rust-compatible envelope wire shape strictly', () => {
    expect(
      readHostProtocolEnvelope({
        request_id: 'request-1',
        capability: 'workspace.write',
        protocol_version: 1
      })
    ).toEqual({
      request_id: 'request-1',
      capability: 'workspace.write',
      protocol_version: 1
    })
    expect(
      readHostProtocolEnvelope({
        request_id: 'request-1',
        capability: 'unknown',
        protocol_version: 1
      })
    ).toBeNull()
  })

  it('accepts the Rust Git request wire shape for shared mobile and web transport', () => {
    expect(
      readGitRequest({
        envelope: {
          request_id: 'request-7',
          capability: 'git',
          protocol_version: 1
        },
        operation: {
          type: 'worktree_list',
          repository_path: 'C:\\workspaces\\repo'
        }
      })
    ).toEqual({
      envelope: {
        request_id: 'request-7',
        capability: 'git',
        protocol_version: 1
      },
      operation: {
        type: 'worktree_list',
        repository_path: 'C:\\workspaces\\repo'
      }
    })
  })

  it('rejects non-Git capabilities and unknown operations without fallback parsing', () => {
    expect(
      readGitRequest({
        envelope: { request_id: 'request-7', capability: 'terminal', protocol_version: 1 },
        operation: { type: 'worktree_list', repository_path: '/repo' }
      })
    ).toBeNull()
    expect(
      readGitRequest({
        envelope: { request_id: 'request-7', capability: 'git', protocol_version: 1 },
        operation: { type: 'status', path: '/repo' }
      })
    ).toBeNull()
  })
})
