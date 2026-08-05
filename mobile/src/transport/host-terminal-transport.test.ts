import { describe, expect, it, vi } from 'vitest'
import {
  createTerminalCloseRequest,
  createTerminalExitRequest,
  createTerminalFailRequest,
  createTerminalOutputRequest,
  createTerminalSnapshotRequest,
  createTerminalStartRequest,
  readTerminalResponse,
  requestTerminal
} from './host-terminal-transport'

const terminalResponse = {
  request_id: 'request-start',
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
}

describe('mobile Host Terminal transport', () => {
  it('creates strict versioned requests for every terminal operation', () => {
    expect(createTerminalStartRequest('request-start', 'terminal-1', 0)).toEqual({
      envelope: { request_id: 'request-start', capability: 'terminal', protocol_version: 1 },
      terminal_id: 'terminal-1',
      expected_generation: 0,
      operation: { type: 'start' }
    })
    expect(createTerminalSnapshotRequest('request-snapshot', 'terminal-1', 1).operation).toEqual({
      type: 'snapshot'
    })
    expect(createTerminalOutputRequest('request-output', 'terminal-1', 1, 2, 'ready')).toEqual({
      envelope: { request_id: 'request-output', capability: 'terminal', protocol_version: 1 },
      terminal_id: 'terminal-1',
      expected_generation: 1,
      operation: { type: 'output', sequence: 2, data: 'ready' }
    })
    expect(createTerminalExitRequest('request-exit', 'terminal-1', 2, 0).operation).toEqual({
      type: 'exit',
      code: 0
    })
    expect(
      createTerminalFailRequest('request-fail', 'terminal-1', 2, 'spawn failed').operation
    ).toEqual({
      type: 'fail',
      reason: 'spawn failed'
    })
    expect(createTerminalCloseRequest('request-close', 'terminal-1', 3).operation).toEqual({
      type: 'close'
    })
  })

  it('rejects malformed authoritative responses without fallback parsing', () => {
    expect(readTerminalResponse({ ...terminalResponse, capability: 'file' })).toBeNull()
    expect(readTerminalResponse({ ...terminalResponse, protocol_version: 2 })).toBeNull()
    expect(readTerminalResponse({ ...terminalResponse, protocol_version: undefined })).toBeNull()
    expect(readTerminalResponse({ ...terminalResponse, operation: 'unknown' })).toBeNull()
    expect(readTerminalResponse({ ...terminalResponse, terminal_id: '' })).toBeNull()
    expect(readTerminalResponse({ ...terminalResponse, generation: -1 })).toBeNull()
    expect(readTerminalResponse({ ...terminalResponse, status: 'unknown' })).toBeNull()
    expect(readTerminalResponse({ ...terminalResponse, status: 'exited' })).toBeNull()
    expect(readTerminalResponse({ ...terminalResponse, exit_code: 0 })).toBeNull()
    expect(
      readTerminalResponse({ ...terminalResponse, status: 'exited', exit_code: 0 })
    ).toMatchObject({ status: 'exited', exit_code: 0 })
    expect(
      readTerminalResponse({ ...terminalResponse, status: 'closed', exit_code: 7 })
    ).toMatchObject({ status: 'closed', exit_code: 7 })
    expect(
      readTerminalResponse({ ...terminalResponse, status: 'exited', exit_code: 1.5 })
    ).toBeNull()
    expect(
      readTerminalResponse({ ...terminalResponse, status: 'exited', exit_code: 2147483648 })
    ).toBeNull()
    expect(readTerminalResponse({ ...terminalResponse, failure_reason: 3 })).toBeNull()
    expect(readTerminalResponse({ ...terminalResponse, failure_reason: 'spawn failed' })).toBeNull()
    expect(readTerminalResponse({ ...terminalResponse, status: 'failed' })).toBeNull()
    expect(
      readTerminalResponse({
        ...terminalResponse,
        status: 'failed',
        failure_reason: 'spawn failed'
      })
    ).toMatchObject({ status: 'failed', failure_reason: 'spawn failed' })
    expect(readTerminalResponse({ ...terminalResponse, output_sequence: 1.5 })).toBeNull()
    expect(readTerminalResponse({ ...terminalResponse, tail: null })).toBeNull()
    expect(readTerminalResponse({ ...terminalResponse, unexpected: true })).toBeNull()
  })

  it('sends a terminal request and validates request, terminal, and operation correlation', async () => {
    const client = {
      sendRequest: vi.fn().mockResolvedValue({
        id: 'rpc-1',
        ok: true,
        result: terminalResponse
      })
    }
    const request = createTerminalStartRequest('request-start', 'terminal-1', 0)

    await expect(requestTerminal(client, request)).resolves.toEqual(terminalResponse)
    expect(client.sendRequest).toHaveBeenCalledWith('host.request', request)
  })

  it('rejects a response correlated to another request, terminal, or operation', async () => {
    const request = createTerminalStartRequest('request-start', 'terminal-1', 0)
    for (const mismatch of [
      { request_id: 'request-other' },
      { terminal_id: 'terminal-other' },
      { operation: 'snapshot' }
    ]) {
      const client = {
        sendRequest: vi.fn().mockResolvedValue({
          id: 'rpc-1',
          ok: true,
          result: { ...terminalResponse, ...mismatch }
        })
      }
      await expect(requestTerminal(client, request)).rejects.toThrow(
        'Invalid Host Terminal response'
      )
    }
  })
})
