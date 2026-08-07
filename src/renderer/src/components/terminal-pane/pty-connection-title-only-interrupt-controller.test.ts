import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPtyConnectionTitleOnlyInterruptController } from './pty-connection-title-only-interrupt-controller'

function createHarness() {
  let hasAgentStatus = false
  let title: string | undefined = 'working:a'
  const clearWorkingTitle = vi.fn()
  const controller = createPtyConnectionTitleOnlyInterruptController({
    hasAgentStatus: () => hasAgentStatus,
    readTitle: () => title,
    isWorkingTitle: (candidate) => candidate.startsWith('working:'),
    clearWorkingTitle
  })

  return {
    controller,
    clearWorkingTitle,
    setHasAgentStatus(value: boolean) {
      hasAgentStatus = value
    },
    setTitle(value: string | undefined) {
      title = value
    }
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createPtyConnectionTitleOnlyInterruptController', () => {
  it('does not arm for an explicit status row or a non-working title', () => {
    vi.useFakeTimers()
    const status = createHarness()
    status.setHasAgentStatus(true)
    status.controller.observe()

    const idle = createHarness()
    idle.setTitle('idle')
    idle.controller.observe()
    vi.runAllTimers()

    expect(status.clearWorkingTitle).not.toHaveBeenCalled()
    expect(idle.clearWorkingTitle).not.toHaveBeenCalled()
  })

  it('clears an unchanged working title after the settle window', () => {
    vi.useFakeTimers()
    const state = createHarness()

    state.controller.observe()
    vi.runAllTimers()

    expect(state.clearWorkingTitle).toHaveBeenCalledTimes(1)
  })

  it('replaces the pending baseline when a later working title is observed', () => {
    vi.useFakeTimers()
    const state = createHarness()

    state.controller.observe()
    state.setTitle('working:b')
    state.controller.observe()
    vi.runAllTimers()

    expect(state.clearWorkingTitle).toHaveBeenCalledTimes(1)
  })

  it('keeps a changed title or newly explicit status intact', () => {
    vi.useFakeTimers()
    const changed = createHarness()
    changed.controller.observe()
    changed.setTitle('working:b')

    const explicit = createHarness()
    explicit.controller.observe()
    explicit.setHasAgentStatus(true)
    vi.runAllTimers()

    expect(changed.clearWorkingTitle).not.toHaveBeenCalled()
    expect(explicit.clearWorkingTitle).not.toHaveBeenCalled()
  })

  it('cancels pending settlement on clear and dispose', () => {
    vi.useFakeTimers()
    const cleared = createHarness()
    cleared.controller.observe()
    cleared.controller.clear()

    const disposed = createHarness()
    disposed.controller.observe()
    disposed.controller.dispose()
    disposed.controller.dispose()
    vi.runAllTimers()

    expect(cleared.clearWorkingTitle).not.toHaveBeenCalled()
    expect(disposed.clearWorkingTitle).not.toHaveBeenCalled()
  })
})
