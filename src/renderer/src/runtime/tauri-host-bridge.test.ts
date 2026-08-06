import { describe, expect, it, vi } from 'vitest'
import {
  TAURI_HOST_COMMANDS,
  TauriHostBridgeError,
  createTauriHostBridge,
  type TauriInvoke
} from './tauri-host-bridge'

const status = {
  service: 'ade-host',
  workspace_count: 1,
  ready_workspaces: 1,
  source: 'sqlite-snapshot',
  hostProtocol: { version: 1, capabilities: ['workspace.read', 'file'] }
}

describe('Tauri host invoke bridge', () => {
  it('uses the exact command names and camelCase Tauri argument serialization', async () => {
    const invoke = vi
      .fn<TauriInvoke>()
      .mockResolvedValueOnce(JSON.stringify(status))
      .mockResolvedValueOnce(JSON.stringify(status))
      .mockResolvedValueOnce(
        JSON.stringify({
          request_id: 'git-1',
          capability: 'git',
          operation: 'worktree-list',
          worktrees: []
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          request_id: 'file-1',
          capability: 'file',
          operation: 'read',
          path: 'README.md',
          bytes: [65],
          bytes_written: 0,
          changed: false
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          request_id: 'terminal-1',
          capability: 'terminal',
          protocol_version: 1,
          operation: 'start',
          terminal_id: 'terminal-1',
          generation: 1,
          status: 'running',
          exit_code: null,
          failure_reason: null,
          output_sequence: 0,
          tail: ''
        })
      )
    const bridge = createTauriHostBridge(invoke)

    await bridge.hostStatus('state.db')
    await bridge.registerWorkspace({
      stateDb: 'state.db',
      workspaceId: 'workspace-1',
      path: 'C:\\repo',
      requestId: 'workspace-1'
    })
    await bridge.gitWorktreeList({
      requestId: 'git-1',
      path: 'C:\\repo',
      executionTarget: 'windows-native'
    })
    await bridge.fileRequest({ requestId: 'file-1', operation: 'read', path: 'README.md' })
    await bridge.terminalRequest({
      envelope: { request_id: 'terminal-1', capability: 'terminal', protocol_version: 1 },
      terminal_id: 'terminal-1',
      expected_generation: 0,
      operation: { type: 'start' }
    })

    expect(invoke).toHaveBeenNthCalledWith(1, TAURI_HOST_COMMANDS.hostStatus, {
      stateDb: 'state.db'
    })
    expect(invoke).toHaveBeenNthCalledWith(2, TAURI_HOST_COMMANDS.registerWorkspace, {
      stateDb: 'state.db',
      workspaceId: 'workspace-1',
      path: 'C:\\repo',
      requestId: 'workspace-1'
    })
    expect(invoke).toHaveBeenNthCalledWith(3, TAURI_HOST_COMMANDS.gitWorktreeList, {
      requestId: 'git-1',
      path: 'C:\\repo',
      executionTarget: 'windows-native'
    })
    expect(invoke).toHaveBeenNthCalledWith(4, TAURI_HOST_COMMANDS.fileRequest, {
      requestId: 'file-1',
      operation: 'read',
      path: 'README.md',
      bytes: []
    })
    expect(invoke).toHaveBeenNthCalledWith(5, TAURI_HOST_COMMANDS.terminalRequest, {
      request: {
        envelope: { request_id: 'terminal-1', capability: 'terminal', protocol_version: 1 },
        terminal_id: 'terminal-1',
        expected_generation: 0,
        operation: { type: 'start' }
      }
    })
  })

  it('rejects malformed responses and mismatched correlated responses', async () => {
    const invoke = vi
      .fn<TauriInvoke>()
      .mockResolvedValueOnce('{"service":"ade-host"}')
      .mockResolvedValueOnce(
        JSON.stringify({
          request_id: 'other',
          capability: 'git',
          operation: 'worktree-list',
          worktrees: []
        })
      )
    const bridge = createTauriHostBridge(invoke)

    await expect(bridge.hostStatus('state.db')).rejects.toMatchObject({
      code: 'malformed_response'
    })
    await expect(
      bridge.gitWorktreeList({
        requestId: 'git-1',
        path: 'repo',
        executionTarget: 'windows-native'
      })
    ).rejects.toMatchObject({ code: 'correlation_mismatch', requestId: 'git-1' })
  })

  it('normalizes Tauri rejection values without treating them as success', async () => {
    const invoke = vi.fn<TauriInvoke>().mockRejectedValue('request_id_conflict')
    const bridge = createTauriHostBridge(invoke)

    await expect(bridge.hostStatus('state.db')).rejects.toMatchObject({
      code: 'request_id_conflict',
      command: TAURI_HOST_COMMANDS.hostStatus
    })
    await expect(bridge.hostStatus('state.db')).rejects.toBeInstanceOf(TauriHostBridgeError)
  })

  it('does not expose the duplicate-registry pty_request command', () => {
    const bridge = createTauriHostBridge(vi.fn<TauriInvoke>())
    expect(TAURI_HOST_COMMANDS).not.toHaveProperty('ptyRequest')
    expect(bridge).not.toHaveProperty('ptyRequest')
  })
})
