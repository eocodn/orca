import { describe, expect, it } from 'vitest'
import { AgentHookServerRuntime } from './agent-hook-server-runtime'

describe('AgentHookServerRuntime generic status state', () => {
  it('starts with an empty status cache and no PTY hook environment', () => {
    const server = new AgentHookServerRuntime()

    expect(server.getStatusSnapshot()).toEqual([])
    expect(server.buildPtyEnv()).toEqual({})

    server.stop()
  })
})
