import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { SESSION_CONTROL_METHODS } from './session-control'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

describe('session control RPC methods', () => {
  it('returns the authoritative session snapshot with host generation and revision', async () => {
    const getSessionSnapshot = vi.fn().mockResolvedValue({
      hostGeneration: 'host-1',
      revision: 'revision-1',
      snapshots: []
    })
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      getSessionSnapshot
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: SESSION_CONTROL_METHODS })

    const response = await dispatcher.dispatch(makeRequest('session.snapshot'))

    expect(response).toMatchObject({
      ok: true,
      result: {
        snapshot: {
          hostGeneration: 'host-1',
          revision: 'revision-1',
          snapshots: []
        }
      }
    })
    expect(getSessionSnapshot).toHaveBeenCalledOnce()
  })

  it('flushes through the runtime and returns the post-flush authoritative snapshot', async () => {
    const flushSession = vi.fn().mockResolvedValue({
      hostGeneration: 'host-1',
      revision: 'revision-2',
      snapshots: [],
      flushed: true
    })
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      flushSession
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: SESSION_CONTROL_METHODS })

    const response = await dispatcher.dispatch(makeRequest('session.flush'))

    expect(response).toMatchObject({
      ok: true,
      result: {
        flush: {
          hostGeneration: 'host-1',
          revision: 'revision-2',
          snapshots: [],
          flushed: true
        }
      }
    })
    expect(flushSession).toHaveBeenCalledOnce()
  })

  it.each([
    ['session.snapshot', 'session_snapshot_unstable', 'getSessionSnapshot'],
    ['session.flush', 'persistence_writes_frozen', 'flushSession']
  ] as const)('preserves %s failure code at the RPC boundary', async (method, code, operation) => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      [operation]: vi.fn().mockRejectedValue(new Error(code))
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: SESSION_CONTROL_METHODS })

    const response = await dispatcher.dispatch(makeRequest(method))

    expect(response).toMatchObject({
      ok: false,
      error: { code, message: code }
    })
  })
})
