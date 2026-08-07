import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionForegroundLatencyController } from './pty-connection-foreground-latency-controller'

function createHarness() {
  let now = 100
  let lastInputAt = 0
  let paneMarkedActive = true
  let activePaneId: number | null = 1
  const consumeInactiveBudget = vi.fn(() => true)
  const controller = createPtyConnectionForegroundLatencyController({
    paneId: 1,
    now: () => now,
    getLastTerminalInputAt: () => lastInputAt,
    isPaneMarkedActive: () => paneMarkedActive,
    getActivePaneId: () => activePaneId,
    consumeInactiveBudget
  })
  return {
    controller,
    consumeInactiveBudget,
    setNow(value: number) {
      now = value
    },
    setLastInputAt(value: number) {
      lastInputAt = value
    },
    setPaneMarkedActive(value: boolean) {
      paneMarkedActive = value
    },
    setActivePaneId(value: number | null) {
      activePaneId = value
    }
  }
}

describe('createPtyConnectionForegroundLatencyController', () => {
  it('does not give inactive split-pane CSI output the shared immediate budget', () => {
    const state = createHarness()
    state.setActivePaneId(2)

    expect(state.controller.isLatencySensitive('\x1b[2J')).toBe(false)
    expect(state.consumeInactiveBudget).not.toHaveBeenCalled()
  })

  it('delegates inactive plain output to the shared immediate budget', () => {
    const state = createHarness()
    state.setPaneMarkedActive(false)

    expect(state.controller.isLatencySensitive('plain')).toBe(true)
    expect(state.consumeInactiveBudget).toHaveBeenCalledWith(5)
  })

  it('treats a marked-active pane as active when no manager pane is selected', () => {
    const state = createHarness()
    state.setActivePaneId(null)

    expect(state.controller.isActiveSplitPane()).toBe(true)
  })

  it('enforces and resets the active pane local immediate budget', () => {
    const state = createHarness()
    const chunk = 'x'.repeat(2048)

    for (let index = 0; index < 64; index++) {
      expect(state.controller.isLatencySensitive(chunk)).toBe(true)
    }
    expect(state.controller.isLatencySensitive(chunk)).toBe(false)

    state.setNow(601)
    expect(state.controller.isLatencySensitive(chunk)).toBe(true)
  })

  it('keeps recent medium CSI output latency-sensitive', () => {
    const state = createHarness()
    state.setLastInputAt(50)
    const data = `\x1b[${'x'.repeat(4096)}`

    expect(state.controller.isLatencySensitive(data)).toBe(true)
  })

  it('does not accelerate stale medium CSI output', () => {
    const state = createHarness()
    state.setNow(500)
    state.setLastInputAt(0)
    const data = `\x1b[${'x'.repeat(4096)}`

    expect(state.controller.isLatencySensitive(data)).toBe(false)
  })
})
