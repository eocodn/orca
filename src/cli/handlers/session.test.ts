import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_HANDLERS } from './session'

describe('session CLI handlers', () => {
  const call = vi.fn()
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const context = {
    flags: new Map<string, string | boolean>(),
    client: { call } as never,
    cwd: '/tmp',
    json: true
  }

  beforeEach(() => {
    call.mockReset()
    log.mockClear()
  })

  it('uses the session snapshot RPC and preserves the JSON envelope', async () => {
    call.mockResolvedValue({
      id: 'request-1',
      ok: true,
      result: {
        snapshot: { hostGeneration: 'host-1', revision: 'revision-1', snapshots: [] }
      },
      _meta: { runtimeId: 'host-1' }
    })

    await SESSION_HANDLERS['session snapshot'](context)

    expect(call).toHaveBeenCalledWith('session.snapshot')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"revision-1"'))
  })

  it('uses the session flush RPC and preserves the JSON envelope', async () => {
    call.mockResolvedValue({
      id: 'request-2',
      ok: true,
      result: {
        flush: {
          hostGeneration: 'host-1',
          revision: 'revision-2',
          snapshots: [],
          flushed: true
        }
      },
      _meta: { runtimeId: 'host-1' }
    })

    await SESSION_HANDLERS['session flush'](context)

    expect(call).toHaveBeenCalledWith('session.flush')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"flushed": true'))
  })
})
