import { describe, expect, it, vi } from 'vitest'
import {
  getRemoteTerminalStreamsForE2e,
  releaseRemoteTerminalHeldAcksForE2e,
  sendRemoteTerminalInputForE2e
} from './remote-runtime-terminal-flow-control'
import { RemoteRuntimeTerminalMultiplexer } from './remote-runtime-terminal-stream'

describe('remote terminal flow-control E2E helpers', () => {
  it('exports callable helpers for inspecting and controlling a multiplexer', () => {
    const multiplexer = new RemoteRuntimeTerminalMultiplexer('test-environment', undefined, vi.fn())

    expect(Array.from(getRemoteTerminalStreamsForE2e(multiplexer))).toEqual([])
    expect(releaseRemoteTerminalHeldAcksForE2e(multiplexer)).toBe(0)
    expect(sendRemoteTerminalInputForE2e(multiplexer, 'missing-terminal', 'input')).toBe(0)
  })
})
