import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionVisibleForegroundSampleController } from './pty-connection-visible-foreground-sample-controller'

function createHarness() {
  let decision: { expectsAgent: boolean } | null = { expectsAgent: false }
  let admitted = true
  const resolveSample = vi.fn(() => decision)
  const sample = vi.fn(() => admitted)
  const controller = createPtyConnectionVisibleForegroundSampleController({
    resolveSample,
    sample
  })

  return {
    controller,
    resolveSample,
    sample,
    setDecision(value: { expectsAgent: boolean } | null) {
      decision = value
    },
    setAdmitted(value: boolean) {
      admitted = value
    }
  }
}

describe('createPtyConnectionVisibleForegroundSampleController', () => {
  it('blocks duplicate requests while an admitted sample is pending', () => {
    const state = createHarness()

    state.controller.request()
    state.controller.request(true)

    expect(state.resolveSample).toHaveBeenCalledTimes(1)
    expect(state.sample).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('does not latch pending when policy or the tracker rejects admission', () => {
    const policy = createHarness()
    policy.setDecision(null)
    policy.controller.request()
    policy.setDecision({ expectsAgent: true })
    policy.controller.request(true)
    expect(policy.sample).toHaveBeenCalledExactlyOnceWith(true)

    const tracker = createHarness()
    tracker.setAdmitted(false)
    tracker.controller.request()
    tracker.setAdmitted(true)
    tracker.controller.request()
    expect(tracker.sample).toHaveBeenCalledTimes(2)
  })

  it('settles agent and shell outcomes but retries inconclusive outcomes', () => {
    const agent = createHarness()
    agent.controller.request()
    agent.controller.settle('agent')
    agent.controller.request()
    expect(agent.sample).toHaveBeenCalledTimes(1)

    const shell = createHarness()
    shell.controller.request()
    shell.controller.settle('shell')
    shell.controller.request()
    expect(shell.sample).toHaveBeenCalledTimes(1)

    const inconclusive = createHarness()
    inconclusive.controller.request()
    inconclusive.controller.settle('inconclusive')
    inconclusive.controller.request()
    expect(inconclusive.sample).toHaveBeenCalledTimes(2)
  })

  it('clears pending without reopening an already settled sample', () => {
    const state = createHarness()

    state.controller.request()
    state.controller.settle('agent')
    state.controller.clearPending()
    state.controller.request()

    expect(state.sample).toHaveBeenCalledTimes(1)
  })

  it('reset and dispose clear both admission latches', () => {
    const reset = createHarness()
    reset.controller.request()
    reset.controller.settle('shell')
    reset.controller.reset()
    reset.controller.request()
    expect(reset.sample).toHaveBeenCalledTimes(2)

    const disposed = createHarness()
    disposed.controller.request()
    disposed.controller.settle('agent')
    disposed.controller.dispose()
    disposed.controller.request()
    expect(disposed.sample).toHaveBeenCalledTimes(2)
  })
})
