import { describe, expect, it, vi } from 'vitest'
import { TAURI_HOST_COMMANDS, createTauriHostBridge, type TauriInvoke } from './tauri-host-bridge'

const startRequest = {
  envelope: { request_id: 'pty-1', capability: 'pty' as const, protocol_version: 1 as const },
  workspace_id: 'workspace-1',
  worker_id: 'tauri-local-worker',
  session_id: 'session-1',
  session_generation: null,
  operation: {
    type: 'start' as const,
    program: 'sh',
    args: [],
    current_dir: null,
    execution_target: { kind: 'wsl2' as const, distro: 'Ubuntu-22.04' },
    cols: 80,
    rows: 24
  }
}

const ptyResponse = {
  envelope: { request_id: 'pty-1', capability: 'pty', protocol_version: 1 },
  workspace_id: 'workspace-1',
  worker_id: 'tauri-local-worker',
  session_id: 'session-1',
  session_generation: 1,
  generation: 1,
  operation: 'start',
  status: 'running',
  exit_code: null,
  output_sequence: 0,
  tail: '',
  failure_reason: null
}

describe('Tauri host PTY bridge', () => {
  it('observes, explicitly claims, and dispatches through exact Tauri commands', async () => {
    const invoke = vi
      .fn<TauriInvoke>()
      .mockResolvedValueOnce(
        JSON.stringify({
          service: 'ade-host-pty',
          state: 'ready',
          worker_id: 'tauri-local-worker',
          worker_incarnation: 7,
          failure_reason: null
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          request_id: 'claim-1',
          workspace_id: 'workspace-1',
          worker_id: 'tauri-local-worker',
          worker_incarnation: 7,
          lease_id: 1,
          changed: true,
          state: 'owned'
        })
      )
      .mockResolvedValueOnce(JSON.stringify(ptyResponse))
    const bridge = createTauriHostBridge(invoke)

    await expect(bridge.ptyHostStatus()).resolves.toMatchObject({ state: 'ready' })
    await expect(
      bridge.claimPtyWorkspace({ requestId: 'claim-1', workspaceId: 'workspace-1' })
    ).resolves.toMatchObject({ lease_id: 1, state: 'owned' })
    await expect(bridge.ptyRequest(startRequest)).resolves.toMatchObject({
      session_generation: 1,
      operation: 'start'
    })

    expect(invoke).toHaveBeenNthCalledWith(1, TAURI_HOST_COMMANDS.ptyHostStatus, {})
    expect(invoke).toHaveBeenNthCalledWith(2, TAURI_HOST_COMMANDS.claimPtyWorkspace, {
      requestId: 'claim-1',
      workspaceId: 'workspace-1'
    })
    expect(invoke).toHaveBeenNthCalledWith(3, TAURI_HOST_COMMANDS.ptyRequest, {
      request: startRequest
    })
  })

  it('rejects invalid requests before invoking Rust', async () => {
    const invoke = vi.fn<TauriInvoke>()
    const bridge = createTauriHostBridge(invoke)

    await expect(
      bridge.ptyRequest({
        ...startRequest,
        operation: { ...startRequest.operation, cols: 0 }
      })
    ).rejects.toMatchObject({ code: 'invalid_request', requestId: 'pty-1' })
    await expect(
      bridge.claimPtyWorkspace({ requestId: 'claim-1', workspaceId: '  ' })
    ).rejects.toMatchObject({ code: 'invalid_request' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects malformed or mismatched worker responses', async () => {
    const invoke = vi
      .fn<TauriInvoke>()
      .mockResolvedValueOnce(JSON.stringify({ ...ptyResponse, worker_id: 'other-worker' }))
      .mockResolvedValueOnce(
        JSON.stringify({
          request_id: 'claim-1',
          workspace_id: 'other-workspace',
          worker_id: 'tauri-local-worker',
          worker_incarnation: 7,
          lease_id: 1,
          changed: true,
          state: 'owned'
        })
      )
    const bridge = createTauriHostBridge(invoke)

    await expect(bridge.ptyRequest(startRequest)).rejects.toMatchObject({
      code: 'correlation_mismatch',
      requestId: 'pty-1'
    })
    await expect(
      bridge.claimPtyWorkspace({ requestId: 'claim-1', workspaceId: 'workspace-1' })
    ).rejects.toMatchObject({ code: 'correlation_mismatch', requestId: 'claim-1' })
  })
})
