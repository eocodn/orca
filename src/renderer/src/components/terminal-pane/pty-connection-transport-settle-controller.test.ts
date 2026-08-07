import { describe, expect, it } from 'vitest'
import { createPtyConnectionTransportSettleController } from './pty-connection-transport-settle-controller'

function createHarness() {
  let now = 100_000
  const controller = createPtyConnectionTransportSettleController({ now: () => now })
  return {
    controller,
    setNow(value: number) {
      now = value
    }
  }
}

describe('createPtyConnectionTransportSettleController', () => {
  it('is idle without an in-flight connect timestamp', () => {
    const state = createHarness()
    expect(state.controller.isSettling()).toBe(false)
  })

  it('keeps a connect settling through 59,999ms and expires at 60,000ms', () => {
    const state = createHarness()
    state.controller.setInFlightSince(100_000)

    state.setNow(159_999)
    expect(state.controller.isSettling()).toBe(true)

    state.setNow(160_000)
    expect(state.controller.isSettling()).toBe(false)
  })

  it('returns to idle when the connect timestamp is cleared', () => {
    const state = createHarness()
    state.controller.setInFlightSince(100_000)
    state.controller.setInFlightSince(null)

    expect(state.controller.isSettling()).toBe(false)
  })
})
