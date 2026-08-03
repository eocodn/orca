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

  it('keeps later credits alive across independent terminal write contexts', () => {
    const firstTerminal = {}
    const secondTerminal = {}
    const failingCredit = vi.fn(() => {
      throw new Error('synthetic repeated credit failure')
    })

    for (let i = 0; i < 5; i++) {
      registerTerminalOutputAckCredits(firstTerminal, [failingCredit])?.()
    }
    registerTerminalOutputAckCredits(firstTerminal, [failingCredit])?.()

    const laterFirstTerminalCredit = vi.fn()
    const laterSecondTerminalCredit = vi.fn()
    registerTerminalOutputAckCredits(firstTerminal, [laterFirstTerminalCredit])?.()
    registerTerminalOutputAckCredits(secondTerminal, [laterSecondTerminalCredit])?.()

    expect(failingCredit).toHaveBeenCalledTimes(5)
    expect(laterFirstTerminalCredit).toHaveBeenCalledOnce()
    expect(laterSecondTerminalCredit).toHaveBeenCalledOnce()
  })
})
