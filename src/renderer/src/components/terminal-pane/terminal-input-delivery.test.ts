import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetTerminalInputQuarantineForTests,
  armTerminalInputQuarantine
} from './terminal-input-quarantine'
import { createTerminalInputDelivery } from './terminal-input-delivery'

const TAB = 'tab-1'

beforeEach(() => {
  _resetTerminalInputQuarantineForTests()
})

describe('terminal input delivery', () => {
  it('preserves ordinary input when the endpoint is healthy', () => {
    const sendInput = vi.fn(() => true)
    const delivery = createTerminalInputDelivery({ tabId: TAB, sendInput })

    expect(delivery.sendInput('ls\r')).toBe(true)
    expect(sendInput).toHaveBeenCalledWith('ls\r')
  })

  it('drops quarantined PTY input but keeps immediate device replies', () => {
    const sendInput = vi.fn(() => true)
    const sendInputImmediate = vi.fn(() => true)
    const delivery = createTerminalInputDelivery({
      tabId: TAB,
      sendInput,
      sendInputImmediate
    })
    armTerminalInputQuarantine(TAB, 0)

    expect(delivery.sendInput('cho hi; rm -rf x')).toBe(true)
    expect(delivery.sendInputImmediate('\x1b[3;1R')).toBe(true)
    expect(sendInput).not.toHaveBeenCalled()
    expect(sendInputImmediate).toHaveBeenCalledWith('\x1b[3;1R')
  })

  it('passes the next command after the quarantined terminator', () => {
    const sendInput = vi.fn(() => true)
    const delivery = createTerminalInputDelivery({ tabId: TAB, sendInput })
    armTerminalInputQuarantine(TAB, 0)

    delivery.sendInput('partial\r')
    expect(delivery.sendInput('ls\r')).toBe(true)
    expect(sendInput).toHaveBeenCalledWith('ls\r')
  })

  it('drops acknowledged PTY input during quarantine', async () => {
    const sendInputAccepted = vi.fn(async () => true)
    const delivery = createTerminalInputDelivery({
      tabId: TAB,
      sendInput: vi.fn(() => true),
      sendInputAccepted
    })
    armTerminalInputQuarantine(TAB, 0)

    await expect(delivery.sendInputAccepted?.('partial command')).resolves.toBe(true)
    expect(sendInputAccepted).not.toHaveBeenCalled()
  })
})
