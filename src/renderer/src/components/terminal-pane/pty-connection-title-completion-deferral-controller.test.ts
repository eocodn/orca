import { describe, expect, it, vi } from 'vitest'
import type { AgentType } from '../../../../shared/agent-status-types'
import { createPtyConnectionTitleCompletionDeferralController } from './pty-connection-title-completion-deferral-controller'

function createHarness() {
  const applyCompletion = vi.fn()
  const relaxPendingCompletion = vi.fn()
  const resolveCompatibleAgentType = vi.fn(
    (candidate: AgentType | undefined, pending: AgentType | undefined) =>
      candidate === pending ? candidate : null
  )
  const controller = createPtyConnectionTitleCompletionDeferralController({
    resolveCompatibleAgentType,
    applyCompletion,
    relaxPendingCompletion
  })
  return { controller, applyCompletion, relaxPendingCompletion, resolveCompatibleAgentType }
}

describe('createPtyConnectionTitleCompletionDeferralController', () => {
  it('relaxes waiting preservation immediately and applies it on matching done', () => {
    const state = createHarness()

    state.controller.preserve('Claude done', { state: 'waiting', agentType: 'claude' })
    expect(state.relaxPendingCompletion).toHaveBeenCalledTimes(1)

    state.controller.handleLifecycle({ state: 'done', agentType: 'claude' })
    expect(state.applyCompletion).toHaveBeenCalledExactlyOnceWith('Claude done', 'claude')

    state.controller.handleLifecycle({ state: 'done', agentType: 'claude' })
    expect(state.applyCompletion).toHaveBeenCalledTimes(1)
  })

  it('discards pending completion when the hook returns to working', () => {
    const state = createHarness()

    state.controller.preserve('done title', { state: 'working', agentType: 'claude' })
    state.controller.handleLifecycle({ state: 'working', agentType: 'claude' })
    state.controller.handleLifecycle({ state: 'done', agentType: 'claude' })

    expect(state.applyCompletion).not.toHaveBeenCalled()
  })

  it('discards pending completion when a different known agent owns the lifecycle', () => {
    const state = createHarness()

    state.controller.preserve('done title', { state: 'working', agentType: 'claude' })
    state.controller.handleLifecycle({ state: 'done', agentType: 'codex' })

    expect(state.applyCompletion).not.toHaveBeenCalled()
  })

  it('treats unknown identity as compatible and falls back to the pending agent type', () => {
    const state = createHarness()

    state.controller.preserve('done title', { state: 'working', agentType: 'claude' })
    state.controller.handleLifecycle({ state: 'done', agentType: 'unknown' })

    expect(state.applyCompletion).toHaveBeenCalledExactlyOnceWith('done title', 'unknown')
  })

  it('retains pending completion through blocked lifecycle while relaxing modes', () => {
    const state = createHarness()

    state.controller.preserve('done title', { state: 'working', agentType: 'claude' })
    state.controller.handleLifecycle({ state: 'blocked', agentType: 'claude' })
    expect(state.relaxPendingCompletion).toHaveBeenCalledTimes(1)

    state.controller.handleLifecycle({ state: 'done', agentType: 'claude' })
    expect(state.applyCompletion).toHaveBeenCalledTimes(1)
  })

  it('cancels pending completion on clear and dispose', () => {
    const cleared = createHarness()
    cleared.controller.preserve('one', { state: 'working', agentType: 'claude' })
    cleared.controller.clear()
    cleared.controller.handleLifecycle({ state: 'done', agentType: 'claude' })

    const disposed = createHarness()
    disposed.controller.preserve('two', { state: 'working', agentType: 'claude' })
    disposed.controller.dispose()
    disposed.controller.dispose()
    disposed.controller.handleLifecycle({ state: 'done', agentType: 'claude' })

    expect(cleared.applyCompletion).not.toHaveBeenCalled()
    expect(disposed.applyCompletion).not.toHaveBeenCalled()
  })
})
