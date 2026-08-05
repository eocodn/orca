import { describe, expect, it } from 'vitest'
import {
  readFileRequest,
  readGitRequest,
  readHostProtocolEnvelope,
  readHostProtocolStatus,
  readTerminalRequest
} from './host-protocol-status'
import { readPtyRequest } from './host-pty-protocol-status'
import { readPtyResponse } from './host-pty-response-status'

describe('mobile Host protocol descriptor', () => {
  it('accepts the Rust Host descriptor advertised by status.get', () => {
    expect(
      readHostProtocolStatus({
        version: 1,
        capabilities: ['workspace.read', 'workspace.write', 'terminal', 'pty', 'git', 'file']
      })
    ).toEqual({
      version: 1,
      capabilities: ['workspace.read', 'workspace.write', 'terminal', 'pty', 'git', 'file']
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
    expect(
      readHostProtocolEnvelope({
        request_id: 'request-1',
        capability: 'terminal',
        protocol_version: 1,
        unexpected: true
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

  it('accepts strict file read and write requests and rejects invalid bytes', () => {
    expect(
      readFileRequest({
        envelope: { request_id: 'request-file', capability: 'file', protocol_version: 1 },
        operation: { type: 'write', path: 'C:\\workspaces\\file.txt', bytes: [0, 255] }
      })
    ).toEqual({
      envelope: { request_id: 'request-file', capability: 'file', protocol_version: 1 },
      operation: { type: 'write', path: 'C:\\workspaces\\file.txt', bytes: [0, 255] }
    })
    expect(
      readFileRequest({
        envelope: { request_id: 'request-file', capability: 'file', protocol_version: 1 },
        operation: { type: 'write', path: '/tmp/file', bytes: [256] }
      })
    ).toBeNull()
  })

  it('accepts strict terminal lifecycle requests and rejects invalid state', () => {
    expect(
      readTerminalRequest({
        envelope: {
          request_id: 'request-terminal',
          capability: 'terminal',
          protocol_version: 1
        },
        terminal_id: 'terminal-1',
        expected_generation: 1,
        operation: { type: 'output', sequence: 1, data: 'ready' }
      })
    ).toEqual({
      envelope: {
        request_id: 'request-terminal',
        capability: 'terminal',
        protocol_version: 1
      },
      terminal_id: 'terminal-1',
      expected_generation: 1,
      operation: { type: 'output', sequence: 1, data: 'ready' }
    })
    expect(
      readTerminalRequest({
        envelope: {
          request_id: 'request-terminal',
          capability: 'terminal',
          protocol_version: 1
        },
        terminal_id: 'terminal-1',
        expected_generation: -1,
        operation: { type: 'start' }
      })
    ).toBeNull()
    expect(
      readTerminalRequest({
        envelope: {
          request_id: 'request-terminal',
          capability: 'terminal',
          protocol_version: 1
        },
        terminal_id: 'terminal-1',
        expected_generation: 1,
        operation: { type: 'start', unexpected: true }
      })
    ).toBeNull()
    expect(
      readTerminalRequest({
        envelope: {
          request_id: 'request-terminal',
          capability: 'terminal',
          protocol_version: 1
        },
        terminal_id: 'terminal-1',
        expected_generation: 1,
        operation: { type: 'fail', reason: '  ' }
      })
    ).toBeNull()
  })

  it('accepts the shared PTY lifecycle and canonicalizes optional start fields', () => {
    const request = readPtyRequest({
      envelope: { request_id: 'pty-start', capability: 'pty', protocol_version: 1 },
      workspace_id: 'workspace-1',
      worker_id: 'worker-1',
      session_id: 'session-1',
      operation: {
        type: 'start',
        program: 'wsl.exe',
        cols: 80,
        rows: 24,
        execution_target: { kind: 'wsl2', distro: 'Ubuntu-24.04' }
      }
    })

    expect(request).toEqual({
      envelope: { request_id: 'pty-start', capability: 'pty', protocol_version: 1 },
      workspace_id: 'workspace-1',
      worker_id: 'worker-1',
      session_id: 'session-1',
      session_generation: null,
      operation: {
        type: 'start',
        program: 'wsl.exe',
        args: [],
        current_dir: null,
        execution_target: { kind: 'wsl2', distro: 'Ubuntu-24.04' },
        cols: 80,
        rows: 24
      }
    })
    expect(
      readPtyRequest({
        ...request,
        operation: { type: 'wait', timeout_ms: 0 },
        session_generation: 1
      })
    ).toBeNull()
    expect(
      readPtyRequest({
        ...request,
        operation: {
          type: 'start',
          program: 'wsl.exe',
          cols: 80,
          rows: 24,
          execution_target: { kind: 'future' }
        }
      })
    ).toBeNull()
    expect(
      readPtyRequest({
        ...request,
        session_generation: 1
      })
    ).toBeNull()
  })

  it('accepts authoritative PTY responses and rejects unknown status fields', () => {
    const response = {
      envelope: { request_id: 'pty-poll', capability: 'pty', protocol_version: 1 },
      workspace_id: 'workspace-1',
      worker_id: 'worker-1',
      session_id: 'session-1',
      session_generation: 1,
      generation: 2,
      operation: 'poll',
      status: 'running',
      exit_code: null,
      output_sequence: 0,
      tail: '',
      failure_reason: null
    }
    expect(readPtyResponse(response)).toEqual(response)
    expect(readPtyResponse({ ...response, status: 'unknown' })).toBeNull()
  })
})
