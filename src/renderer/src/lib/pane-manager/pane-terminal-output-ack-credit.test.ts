import { describe, expect, it, vi } from 'vitest'
import {
  discardInFlightTerminalOutputAckCredits,
  registerTerminalOutputAckCredits
} from './pane-terminal-output-ack-credit'

describe('pane terminal output ACK credit aggregation', () => {
  it('attempts every credit when an earlier credit throws', () => {
    const terminal = {}
    const firstCredit = vi.fn(() => {
      throw new Error('synthetic credit failure')
    })
    const secondCredit = vi.fn()
    const complete = registerTerminalOutputAckCredits(terminal, [firstCredit, secondCredit])

    expect(() => complete?.()).not.toThrow()
    expect(firstCredit).toHaveBeenCalledOnce()
    expect(secondCredit).toHaveBeenCalledOnce()
    expect(() => complete?.()).not.toThrow()
    expect(firstCredit).toHaveBeenCalledOnce()
    expect(secondCredit).toHaveBeenCalledOnce()
  })

  it('attempts every in-flight aggregate when a discarded aggregate throws', () => {
    const terminal = {}
    const firstCredit = vi.fn(() => {
      throw new Error('synthetic discarded credit failure')
    })
    const secondCredit = vi.fn()
    registerTerminalOutputAckCredits(terminal, [firstCredit])
    registerTerminalOutputAckCredits(terminal, [secondCredit])

    expect(() => discardInFlightTerminalOutputAckCredits(terminal)).not.toThrow()
    expect(firstCredit).toHaveBeenCalledOnce()
    expect(secondCredit).toHaveBeenCalledOnce()
    discardInFlightTerminalOutputAckCredits(terminal)
    expect(firstCredit).toHaveBeenCalledOnce()
    expect(secondCredit).toHaveBeenCalledOnce()
  })
})
