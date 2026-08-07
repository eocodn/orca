import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionHiddenRestoreAbandonController } from './pty-connection-hidden-restore-abandon-controller'

function createHarness() {
  let currentPtyId: string | null = 'pty-1'
  let restorePtyId: string | null = 'pty-1'
  const replayBaseline = { data: 'snapshot', cols: 80, rows: 24, seq: 10 }
  const pendingChunks = [
    { data: 'a', seq: 11, rawLength: 1 },
    { data: 'b', seq: 12, rawLength: 1 }
  ]
  const resetIfPtyChanged = vi.fn()
  const takeReplayBaseline = vi.fn(() => replayBaseline)
  const takePendingForAbandonReplay = vi.fn(() => ({
    chunks: pendingChunks,
    data: 'ab',
    overflow: false
  }))
  const invalidateRestore = vi.fn(() => 8)
  const handoffScrollGeneration = vi.fn()
  const abandonTask = vi.fn()
  const resetFreshness = vi.fn()
  const resetRendererQueries = vi.fn()
  const resetRenderRisk = vi.fn()
  const cancelScheduled = vi.fn()
  const resetDeferredRetry = vi.fn()
  const clearForegroundDeadline = vi.fn()
  const writeUnavailableWarning = vi.fn()
  const setReconciliationBaseline = vi.fn()
  const advanceExpectedSeq = vi.fn()
  const writePendingData = vi.fn()

  const controller = createPtyConnectionHiddenRestoreAbandonController({
    getCurrentPtyId: () => currentPtyId,
    getRestorePtyId: () => restorePtyId,
    resetIfPtyChanged,
    takeReplayBaseline,
    takePendingForAbandonReplay,
    invalidateRestore,
    handoffScrollGeneration,
    abandonTask,
    resetFreshness,
    resetRendererQueries,
    resetRenderRisk,
    cancelScheduled,
    resetDeferredRetry,
    clearForegroundDeadline,
    writeUnavailableWarning,
    setReconciliationBaseline,
    advanceExpectedSeq,
    writePendingData
  })

  return {
    controller,
    replayBaseline,
    pendingChunks,
    resetIfPtyChanged,
    takeReplayBaseline,
    takePendingForAbandonReplay,
    invalidateRestore,
    handoffScrollGeneration,
    abandonTask,
    resetFreshness,
    resetRendererQueries,
    resetRenderRisk,
    cancelScheduled,
    resetDeferredRetry,
    clearForegroundDeadline,
    writeUnavailableWarning,
    setReconciliationBaseline,
    advanceExpectedSeq,
    writePendingData,
    setCurrentPtyId(value: string | null) {
      currentPtyId = value
    },
    setRestorePtyId(value: string | null) {
      restorePtyId = value
    }
  }
}

describe('createPtyConnectionHiddenRestoreAbandonController', () => {
  it('delegates stale PTY cleanup without mutating the current restore transaction', () => {
    const state = createHarness()
    state.setCurrentPtyId('pty-2')

    state.controller.abandon('pty-1')

    expect(state.resetIfPtyChanged).toHaveBeenCalledTimes(1)
    expect(state.takeReplayBaseline).not.toHaveBeenCalled()
    expect(state.invalidateRestore).not.toHaveBeenCalled()
  })

  it('hands off generation, resets restore state, reconciles replay, and drains pending data', () => {
    const state = createHarness()

    state.controller.abandon('pty-1')

    expect(state.takePendingForAbandonReplay).toHaveBeenCalledWith(10)
    expect(state.invalidateRestore).toHaveBeenCalledTimes(1)
    expect(state.handoffScrollGeneration).toHaveBeenCalledWith('pty-1', 8)
    expect(state.abandonTask).toHaveBeenCalledTimes(1)
    expect(state.resetFreshness).toHaveBeenCalledTimes(1)
    expect(state.resetRendererQueries).toHaveBeenCalledTimes(1)
    expect(state.resetRenderRisk).toHaveBeenCalledTimes(1)
    expect(state.cancelScheduled).toHaveBeenCalledTimes(1)
    expect(state.resetDeferredRetry).toHaveBeenCalledTimes(1)
    expect(state.clearForegroundDeadline).toHaveBeenCalledTimes(1)
    expect(state.writeUnavailableWarning).toHaveBeenCalledTimes(1)
    expect(state.setReconciliationBaseline).toHaveBeenCalledWith('pty-1', state.replayBaseline)
    expect(state.advanceExpectedSeq.mock.calls).toEqual([[11], [12]])
    expect(state.writePendingData).toHaveBeenCalledWith('ab')
  })

  it('suppresses only the warning for quiet flood abandonment', () => {
    const state = createHarness()

    state.controller.abandon('pty-1', { quiet: true })

    expect(state.writeUnavailableWarning).not.toHaveBeenCalled()
    expect(state.abandonTask).toHaveBeenCalledTimes(1)
    expect(state.writePendingData).toHaveBeenCalledWith('ab')
  })

  it('resets bookkeeping but does not replay content after pending overflow', () => {
    const state = createHarness()
    state.takePendingForAbandonReplay.mockReturnValueOnce({
      chunks: [],
      data: '',
      overflow: true
    })

    state.controller.abandon('pty-1')

    expect(state.handoffScrollGeneration).toHaveBeenCalledWith('pty-1', 8)
    expect(state.writeUnavailableWarning).toHaveBeenCalledTimes(1)
    expect(state.setReconciliationBaseline).not.toHaveBeenCalled()
    expect(state.advanceExpectedSeq).not.toHaveBeenCalled()
    expect(state.writePendingData).not.toHaveBeenCalled()
  })

  it('drains pending data without reconciliation when no replay sequence exists', () => {
    const state = createHarness()
    state.takeReplayBaseline.mockReturnValueOnce({ data: 'snapshot', cols: 80, rows: 24 })

    state.controller.abandon('pty-1')

    expect(state.takePendingForAbandonReplay).toHaveBeenCalledWith(null)
    expect(state.setReconciliationBaseline).not.toHaveBeenCalled()
    expect(state.advanceExpectedSeq).not.toHaveBeenCalled()
    expect(state.writePendingData).toHaveBeenCalledWith('ab')
  })
})
