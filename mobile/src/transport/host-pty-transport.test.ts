import { describe, expect, it, vi } from 'vitest'
import {
  createPtyPollRequest,
  createPtyResizeRequest,
  createPtyStartRequest,
  createPtyTerminateRequest,
  createPtyWaitRequest,
  createPtyWriteRequest,
  requestPty,
  type HostPtyIdentity,
  type HostPtySessionIdentity
} from './host-pty-transport'
import { validateHostPtyRequest } from '../../../src/shared/host-pty-protocol'

const identity: HostPtyIdentity = {
  requestId: 'request-pty-1',
  workspaceId: 'workspace-1',
  workerId: 'worker-1',
  sessionId: 'session-1'
}

const sessionIdentity: HostPtySessionIdentity = {
  ...identity,
  sessionGeneration: 7
}

const wireIdentity = {
  workspace_id: identity.workspaceId,
  worker_id: identity.workerId,
  session_id: identity.sessionId
}

const startOptions = {
  program: 'cmd.exe',
  args: ['/C', 'echo', 'ready'],
  currentDir: 'C:\\workspace',
  executionTarget: { kind: 'windows-native' as const },
  cols: 80,
  rows: 24
}

const runningResponse = {
  envelope: { request_id: identity.requestId, capability: 'pty', protocol_version: 1 },
  workspace_id: identity.workspaceId,
  worker_id: identity.workerId,
  session_id: identity.sessionId,
  session_generation: sessionIdentity.sessionGeneration,
  generation: 8,
  operation: 'poll',
  status: 'running',
  exit_code: null,
  output_sequence: 2,
  tail: 'ready\r\n',
  failure_reason: null
}

describe('mobile Host PTY transport', () => {
  it('constructs strict shared requests for every PTY operation', () => {
    const requests = [
      createPtyStartRequest(identity, startOptions),
      createPtyWriteRequest(sessionIdentity, 'input\r'),
      createPtyResizeRequest(sessionIdentity, 120, 40),
      createPtyPollRequest(sessionIdentity),
      createPtyWaitRequest(sessionIdentity, 5000),
      createPtyTerminateRequest(sessionIdentity)
    ]

    expect(requests).toEqual([
      {
        envelope: { request_id: identity.requestId, capability: 'pty', protocol_version: 1 },
        workspace_id: identity.workspaceId,
        worker_id: identity.workerId,
        session_id: identity.sessionId,
        session_generation: null,
        operation: {
          type: 'start',
          program: startOptions.program,
          args: startOptions.args,
          current_dir: startOptions.currentDir,
          execution_target: startOptions.executionTarget,
          cols: startOptions.cols,
          rows: startOptions.rows
        }
      },
      {
        ...wireIdentity,
        envelope: { request_id: identity.requestId, capability: 'pty', protocol_version: 1 },
        session_generation: sessionIdentity.sessionGeneration,
        operation: { type: 'write', input: 'input\r' }
      },
      {
        ...wireIdentity,
        envelope: { request_id: identity.requestId, capability: 'pty', protocol_version: 1 },
        session_generation: sessionIdentity.sessionGeneration,
        operation: { type: 'resize', cols: 120, rows: 40 }
      },
      {
        ...wireIdentity,
        envelope: { request_id: identity.requestId, capability: 'pty', protocol_version: 1 },
        session_generation: sessionIdentity.sessionGeneration,
        operation: { type: 'poll' }
      },
      {
        ...wireIdentity,
        envelope: { request_id: identity.requestId, capability: 'pty', protocol_version: 1 },
        session_generation: sessionIdentity.sessionGeneration,
        operation: { type: 'wait', timeout_ms: 5000 }
      },
      {
        ...wireIdentity,
        envelope: { request_id: identity.requestId, capability: 'pty', protocol_version: 1 },
        session_generation: sessionIdentity.sessionGeneration,
        operation: { type: 'terminate' }
      }
    ])
    for (const request of requests) {
      expect(validateHostPtyRequest(request)).toEqual({ ok: true, request })
    }
  })

  it('rejects invalid fields instead of constructing a non-contract request', () => {
    expect(() => createPtyStartRequest(identity, { ...startOptions, cols: 0 })).toThrow(
      'Invalid Host PTY request'
    )
    expect(() => createPtyWaitRequest(sessionIdentity, 30_001)).toThrow('Invalid Host PTY request')
    expect(() =>
      createPtyWriteRequest({ ...sessionIdentity, sessionGeneration: null } as never, 'input')
    ).toThrow('Invalid Host PTY request')
  })

  it('sends through host.request and validates the authoritative response', async () => {
    const client = {
      sendRequest: vi.fn().mockResolvedValue({
        id: 'rpc-1',
        ok: true,
        result: runningResponse
      })
    }
    const request = createPtyPollRequest(sessionIdentity)

    await expect(requestPty(client, request)).resolves.toEqual(runningResponse)
    expect(client.sendRequest).toHaveBeenCalledWith('host.request', request)
  })

  it.each([
    ['request_id', { envelope: { ...runningResponse.envelope, request_id: 'other-request' } }],
    ['workspace_id', { workspace_id: 'other-workspace' }],
    ['worker_id', { worker_id: 'other-worker' }],
    ['session_id', { session_id: 'other-session' }],
    ['operation', { operation: 'write' }]
  ])('rejects a response with mismatched %s correlation', async (_field, change) => {
    const client = {
      sendRequest: vi.fn().mockResolvedValue({
        id: 'rpc-1',
        ok: true,
        result: { ...runningResponse, ...change }
      })
    }

    await expect(requestPty(client, createPtyPollRequest(sessionIdentity))).rejects.toThrow(
      'Invalid Host PTY response'
    )
  })

  it('rejects malformed and failed RPC responses', async () => {
    const malformedClient = {
      sendRequest: vi.fn().mockResolvedValue({
        id: 'rpc-1',
        ok: true,
        result: { ...runningResponse, status: 'running', failure_reason: 'impossible' }
      })
    }
    await expect(
      requestPty(malformedClient, createPtyPollRequest(sessionIdentity))
    ).rejects.toThrow('Invalid Host PTY response')

    const failedClient = {
      sendRequest: vi.fn().mockResolvedValue({
        id: 'rpc-2',
        ok: false,
        error: { code: 'stale_session_generation', message: 'stale session' }
      })
    }
    await expect(requestPty(failedClient, createPtyPollRequest(sessionIdentity))).rejects.toThrow(
      'Host PTY request failed: stale_session_generation'
    )
  })
})
