import { describe, expect, it, vi } from 'vitest'
import type { AgentType } from '../../../../shared/agent-status-types'
import { createPtyConnectionWindowsDoneStatusController } from './pty-connection-windows-done-status-controller'

type Status = { state: string; agentType?: AgentType }

function createHarness(
  options: {
    enabled?: boolean
    initialStatus?: Status
    historyResumeIdleCodex?: boolean
  } = {}
) {
  let listener: ((status: Status | undefined) => void) | null = null
  const unsubscribe = vi.fn()
  const applyCompletionSuppression = vi.fn()
  const setCodexSuppression = vi.fn()
  const clearSuppression = vi.fn()
  const queueIdleReset = vi.fn()
  const subscribe = vi.fn((next: (status: Status | undefined) => void) => {
    listener = next
    return unsubscribe
  })
  const controller = createPtyConnectionWindowsDoneStatusController({
    enabled: options.enabled ?? true,
    initialStatus: options.initialStatus,
    historyResumeIdleCodex: options.historyResumeIdleCodex ?? false,
    subscribe,
    applyCompletionSuppression,
    setCodexSuppression,
    clearSuppression,
    queueIdleReset
  })

  return {
    controller,
    subscribe,
    unsubscribe,
    applyCompletionSuppression,
    setCodexSuppression,
    clearSuppression,
    queueIdleReset,
    emit(status: Status | undefined) {
      listener?.(status)
    }
  }
}

describe('createPtyConnectionWindowsDoneStatusController', () => {
  it('is a no-op when native Windows handling is disabled', () => {
    const state = createHarness({ enabled: false, historyResumeIdleCodex: true })

    expect(state.subscribe).not.toHaveBeenCalled()
    expect(state.setCodexSuppression).not.toHaveBeenCalled()
    state.controller.dispose()
    expect(state.unsubscribe).not.toHaveBeenCalled()
  })

  it('arms history-resume Codex suppression only without an initial status row', () => {
    const state = createHarness({ historyResumeIdleCodex: true })
    expect(state.setCodexSuppression).toHaveBeenCalledExactlyOnceWith(true)

    const existing = createHarness({
      historyResumeIdleCodex: true,
      initialStatus: { state: 'working', agentType: 'codex' }
    })
    expect(existing.setCodexSuppression).not.toHaveBeenCalled()
  })

  it('applies initial done suppression without queueing a duplicate reset', () => {
    const state = createHarness({ initialStatus: { state: 'done', agentType: 'codex' } })

    expect(state.applyCompletionSuppression).toHaveBeenCalledExactlyOnceWith('codex')
    expect(state.queueIdleReset).not.toHaveBeenCalled()
  })

  it('queues one reset on a transition into done but not for repeated done events', () => {
    const state = createHarness({ initialStatus: { state: 'working', agentType: 'codex' } })

    state.emit({ state: 'done', agentType: 'codex' })
    state.emit({ state: 'done', agentType: 'codex' })

    expect(state.applyCompletionSuppression).toHaveBeenCalledTimes(2)
    expect(state.queueIdleReset).toHaveBeenCalledTimes(1)
  })

  it('clears suppression for active non-done status but preserves it when the row disappears', () => {
    const state = createHarness({ initialStatus: { state: 'done', agentType: 'codex' } })

    state.emit(undefined)
    expect(state.clearSuppression).not.toHaveBeenCalled()

    state.emit({ state: 'working', agentType: 'codex' })
    expect(state.clearSuppression).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes exactly once on dispose', () => {
    const state = createHarness()

    state.controller.dispose()
    state.controller.dispose()

    expect(state.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
