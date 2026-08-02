import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServerMock } = vi.hoisted(() => ({
  createServerMock: vi.fn()
}))

vi.mock('node:http', () => ({
  createServer: createServerMock
}))

import { AgentHookServerRuntime } from './agent-hook-server-runtime'

class FakeHttpServer extends EventEmitter {
  constructor(private readonly shouldFail: boolean) {
    super()
  }

  listen(_port: number, _host: string, callback: () => void): void {
    queueMicrotask(() => {
      if (this.shouldFail) {
        this.emit('error', new Error('listen failed'))
        return
      }
      callback()
    })
  }

  close(): void {}

  address(): { port: number } {
    return { port: 1234 }
  }
}

describe('AgentHookServerRuntime startup lifecycle', () => {
  beforeEach(() => {
    createServerMock.mockReset()
  })

  it('clears the failed server so the instance can restart', async () => {
    createServerMock
      .mockImplementationOnce(() => new FakeHttpServer(true))
      .mockImplementationOnce(() => new FakeHttpServer(false))
    const server = new AgentHookServerRuntime()

    await expect(server.start()).rejects.toThrow('listen failed')
    await server.start()

    expect(createServerMock).toHaveBeenCalledTimes(2)
    server.stop()
  })
})
