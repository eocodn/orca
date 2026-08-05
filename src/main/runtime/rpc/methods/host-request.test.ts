import { describe, expect, it } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { HOST_REQUEST_METHODS } from './host-request'

function makeRuntime(): OrcaRuntimeService {
  return { getRuntimeId: () => 'host-request-test' } as unknown as OrcaRuntimeService
}

function makeRequest(params: unknown, id = 'rpc-1'): RpcRequest {
  return { id, authToken: 'token', method: 'host.request', params }
}

function terminalRequest(
  operation: Record<string, unknown>,
  expectedGeneration = 0,
  requestId = `host-${String(operation.type)}-${expectedGeneration}`
): unknown {
  return {
    envelope: {
      request_id: requestId,
      capability: 'terminal',
      protocol_version: 1
    },
    terminal_id: 'terminal-1',
    expected_generation: expectedGeneration,
    operation
  }
}

describe('host.request terminal RPC method', () => {
  it('reports authoritative lifecycle snapshots', async () => {
    const dispatcher = new RpcDispatcher({ runtime: makeRuntime(), methods: HOST_REQUEST_METHODS })

    await expect(
      dispatcher.dispatch(makeRequest(terminalRequest({ type: 'start' })))
    ).resolves.toMatchObject({
      ok: true,
      result: {
        request_id: 'host-start-0',
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
    })

    await expect(
      dispatcher.dispatch(
        makeRequest(terminalRequest({ type: 'output', sequence: 1, data: 'ready\n' }, 1))
      )
    ).resolves.toMatchObject({
      ok: true,
      result: {
        operation: 'output',
        generation: 2,
        status: 'running',
        output_sequence: 1,
        tail: 'ready\n'
      }
    })

    await expect(
      dispatcher.dispatch(
        makeRequest(terminalRequest({ type: 'output', sequence: 1, data: 'duplicate' }, 2))
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_terminal_output_sequence' }
    })

    await expect(
      dispatcher.dispatch(makeRequest(terminalRequest({ type: 'snapshot' }, 2)))
    ).resolves.toMatchObject({
      ok: true,
      result: {
        operation: 'snapshot',
        generation: 2,
        status: 'running',
        output_sequence: 1,
        tail: 'ready\n'
      }
    })

    await expect(
      dispatcher.dispatch(makeRequest(terminalRequest({ type: 'exit', code: 7 }, 2)))
    ).resolves.toMatchObject({
      ok: true,
      result: { operation: 'exit', generation: 3, status: 'exited', exit_code: 7 }
    })

    await expect(
      dispatcher.dispatch(makeRequest(terminalRequest({ type: 'close' }, 3)))
    ).resolves.toMatchObject({
      ok: true,
      result: { operation: 'close', generation: 4, status: 'closed', exit_code: null }
    })
  })

  it('rejects stale generations and missing terminals without creating state', async () => {
    const dispatcher = new RpcDispatcher({ runtime: makeRuntime(), methods: HOST_REQUEST_METHODS })

    await expect(
      dispatcher.dispatch(makeRequest(terminalRequest({ type: 'snapshot' })))
    ).resolves.toMatchObject({ ok: false, error: { code: 'terminal_not_found' } })

    await expect(
      dispatcher.dispatch(makeRequest(terminalRequest({ type: 'start' }, 1)))
    ).resolves.toMatchObject({ ok: false, error: { code: 'stale_generation' } })

    await expect(
      dispatcher.dispatch(makeRequest(terminalRequest({ type: 'snapshot' })))
    ).resolves.toMatchObject({ ok: false, error: { code: 'terminal_not_found' } })

    await dispatcher.dispatch(makeRequest(terminalRequest({ type: 'start' })))
    await expect(
      dispatcher.dispatch(makeRequest(terminalRequest({ type: 'snapshot' }, 0)))
    ).resolves.toMatchObject({ ok: false, error: { code: 'stale_generation' } })
  })

  it('replays committed request ids and rejects conflicting reuse', async () => {
    const dispatcher = new RpcDispatcher({ runtime: makeRuntime(), methods: HOST_REQUEST_METHODS })
    const start = terminalRequest({ type: 'start' }, 0, 'request-replay')

    const committed = await dispatcher.dispatch(makeRequest(start))
    await expect(dispatcher.dispatch(makeRequest(start))).resolves.toEqual(committed)
    await expect(
      dispatcher.dispatch(makeRequest(terminalRequest({ type: 'snapshot' }, 1, 'request-replay')))
    ).resolves.toMatchObject({ ok: false, error: { code: 'request_id_conflict' } })
  })

  it('preserves failure reason through close and rejects invalid transitions', async () => {
    const dispatcher = new RpcDispatcher({ runtime: makeRuntime(), methods: HOST_REQUEST_METHODS })

    await dispatcher.dispatch(makeRequest(terminalRequest({ type: 'start' })))
    await expect(
      dispatcher.dispatch(makeRequest(terminalRequest({ type: 'fail', reason: 'spawn failed' }, 1)))
    ).resolves.toMatchObject({
      ok: true,
      result: { generation: 2, status: 'failed', failure_reason: 'spawn failed' }
    })
    await expect(
      dispatcher.dispatch(makeRequest(terminalRequest({ type: 'close' }, 2)))
    ).resolves.toMatchObject({
      ok: true,
      result: { generation: 3, status: 'closed', failure_reason: 'spawn failed' }
    })
    await expect(
      dispatcher.dispatch(
        makeRequest(terminalRequest({ type: 'output', sequence: 1, data: 'late' }, 3))
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_transition' } })
  })

  it('rejects invalid terminal request fields before state mutation', async () => {
    const dispatcher = new RpcDispatcher({ runtime: makeRuntime(), methods: HOST_REQUEST_METHODS })
    const invalidRequests = [
      terminalRequest({ type: 'output', sequence: 0, data: 'bad' }),
      terminalRequest({ type: 'exit', code: 2147483648 }),
      terminalRequest({ type: 'fail', reason: '  ' })
    ]

    for (const params of invalidRequests) {
      await expect(dispatcher.dispatch(makeRequest(params))).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid_argument' }
      })
    }
    await expect(
      dispatcher.dispatch(makeRequest(terminalRequest({ type: 'snapshot' })))
    ).resolves.toMatchObject({ ok: false, error: { code: 'terminal_not_found' } })
  })
})
