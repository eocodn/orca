import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionHiddenRestoreSnapshotLoopController } from './pty-connection-hidden-restore-snapshot-loop-controller'

function snapshot(seq = 10) {
  return { data: `snapshot-${seq}`, cols: 80, rows: 24, seq }
}

function createHarness() {
  let disposed = false
  let restorePtyId: string | null = 'pty-1'
  let currentPtyId: string | null = 'pty-1'
  let generation = 1
  let foreground = true
  const canUseSnapshot = vi.fn(() => true)
  const clearRestoreState = vi.fn(() => {
    restorePtyId = null
  })
  const writeUnavailableWarning = vi.fn()
  const clearNeeded = vi.fn()
  const markNeeded = vi.fn()
  const serializeSnapshot = vi.fn(async () => snapshot())
  const resetFreshness = vi.fn()
  const scheduleDeferredRetry = vi.fn()
  const resetDeferredRetryAttempts = vi.fn()
  const applySnapshot = vi.fn(async () => undefined)
  const setReconciliationBaseline = vi.fn()
  const clearReplayBaseline = vi.fn()
  const takeFreshSnapshotNeeded = vi.fn(() => false)
  const drainPendingLive = vi.fn((): 'drained' | 'overflow' | 'refetch' => 'drained')
  const completeRestore = vi.fn(() => {
    restorePtyId = null
  })
  const clearForegroundDeadline = vi.fn()
  const noteBackpressure = vi.fn()
  const abandonAndDrain = vi.fn()
  const warnIterationCap = vi.fn()

  const controller = createPtyConnectionHiddenRestoreSnapshotLoopController({
    maxIterations: 3,
    isDisposed: () => disposed,
    getRestorePtyId: () => restorePtyId,
    getCurrentPtyId: () => currentPtyId,
    getRestoreGeneration: () => generation,
    canUseSnapshot,
    clearRestoreState,
    writeUnavailableWarning,
    clearNeeded,
    markNeeded,
    serializeSnapshot,
    resetFreshness,
    scheduleDeferredRetry,
    resetDeferredRetryAttempts,
    applySnapshot,
    setReconciliationBaseline,
    clearReplayBaseline,
    takeFreshSnapshotNeeded,
    drainPendingLive,
    isForeground: () => foreground,
    completeRestore,
    clearForegroundDeadline,
    noteBackpressure,
    abandonAndDrain,
    warnIterationCap
  })

  return {
    controller,
    canUseSnapshot,
    clearRestoreState,
    writeUnavailableWarning,
    clearNeeded,
    markNeeded,
    serializeSnapshot,
    resetFreshness,
    scheduleDeferredRetry,
    resetDeferredRetryAttempts,
    applySnapshot,
    setReconciliationBaseline,
    clearReplayBaseline,
    takeFreshSnapshotNeeded,
    drainPendingLive,
    completeRestore,
    clearForegroundDeadline,
    noteBackpressure,
    abandonAndDrain,
    warnIterationCap,
    setDisposed(value: boolean) {
      disposed = value
    },
    setRestorePtyId(value: string | null) {
      restorePtyId = value
    },
    setCurrentPtyId(value: string | null) {
      currentPtyId = value
    },
    setGeneration(value: number) {
      generation = value
    },
    setForeground(value: boolean) {
      foreground = value
    }
  }
}

describe('createPtyConnectionHiddenRestoreSnapshotLoopController', () => {
  it('clears a restore that no longer has a PTY', async () => {
    const state = createHarness()
    state.setRestorePtyId(null)

    await state.controller.run()

    expect(state.clearRestoreState).toHaveBeenCalledTimes(1)
    expect(state.serializeSnapshot).not.toHaveBeenCalled()
  })

  it('clears and warns when the current PTY cannot provide a snapshot', async () => {
    const state = createHarness()
    state.canUseSnapshot.mockReturnValue(false)

    await state.controller.run()

    expect(state.clearRestoreState).toHaveBeenCalledTimes(1)
    expect(state.writeUnavailableWarning).toHaveBeenCalledTimes(1)
  })

  it('drops a fetched snapshot when restore generation changes', async () => {
    const state = createHarness()
    state.serializeSnapshot.mockImplementationOnce(async () => {
      state.setGeneration(2)
      return snapshot()
    })

    await state.controller.run()

    expect(state.applySnapshot).not.toHaveBeenCalled()
    expect(state.completeRestore).not.toHaveBeenCalled()
  })

  it('re-arms restore and schedules a deferred retry when snapshot fetch fails', async () => {
    const state = createHarness()
    state.serializeSnapshot.mockRejectedValueOnce(new Error('snapshot unavailable'))

    await state.controller.run()

    expect(state.markNeeded).toHaveBeenCalledTimes(1)
    expect(state.resetFreshness).toHaveBeenCalledTimes(1)
    expect(state.scheduleDeferredRetry).toHaveBeenCalledTimes(1)
    expect(state.applySnapshot).not.toHaveBeenCalled()
  })

  it('completes after replaying and draining a fresh snapshot', async () => {
    const state = createHarness()
    const frame = snapshot(22)
    state.serializeSnapshot.mockResolvedValueOnce(frame)

    await state.controller.run()

    expect(state.clearNeeded).toHaveBeenCalledTimes(1)
    expect(state.resetDeferredRetryAttempts).toHaveBeenCalledTimes(1)
    expect(state.applySnapshot).toHaveBeenCalledWith(frame)
    expect(state.setReconciliationBaseline).toHaveBeenCalledWith('pty-1', frame)
    expect(state.clearReplayBaseline).toHaveBeenCalledTimes(1)
    expect(state.drainPendingLive).toHaveBeenCalledWith(frame.seq)
    expect(state.completeRestore).toHaveBeenCalledTimes(1)
    expect(state.clearForegroundDeadline).toHaveBeenCalledTimes(1)
  })

  it('fetches a fresh snapshot again when freshness was latched during replay', async () => {
    const state = createHarness()
    state.serializeSnapshot.mockResolvedValueOnce(snapshot(10)).mockResolvedValueOnce(snapshot(20))
    state.takeFreshSnapshotNeeded.mockReturnValueOnce(true).mockReturnValueOnce(false)

    await state.controller.run()

    expect(state.serializeSnapshot).toHaveBeenCalledTimes(2)
    expect(state.applySnapshot).toHaveBeenCalledTimes(2)
    expect(state.completeRestore).toHaveBeenCalledTimes(1)
  })

  it('leaves recovery pending instead of looping while the pane is hidden', async () => {
    const state = createHarness()
    state.setForeground(false)
    state.drainPendingLive.mockReturnValue('refetch')

    await state.controller.run()

    expect(state.markNeeded).toHaveBeenCalledTimes(1)
    expect(state.serializeSnapshot).toHaveBeenCalledTimes(1)
    expect(state.abandonAndDrain).not.toHaveBeenCalled()
  })

  it('abandons foreground recovery immediately when pending live data overflows', async () => {
    const state = createHarness()
    state.drainPendingLive.mockReturnValue('overflow')

    await state.controller.run()

    expect(state.noteBackpressure).toHaveBeenCalledWith('pty-1')
    expect(state.abandonAndDrain).toHaveBeenCalledWith('pty-1')
    expect(state.warnIterationCap).not.toHaveBeenCalled()
  })

  it('caps repeated foreground refetch loops and records the final drain reason', async () => {
    const state = createHarness()
    state.drainPendingLive.mockReturnValue('refetch')

    await state.controller.run()

    expect(state.serializeSnapshot).toHaveBeenCalledTimes(3)
    expect(state.warnIterationCap).toHaveBeenCalledWith('pty-1', 'refetch')
    expect(state.noteBackpressure).toHaveBeenCalledWith('pty-1')
    expect(state.abandonAndDrain).toHaveBeenCalledWith('pty-1')
  })

  it('clears stale restore state when the transport PTY changes before fetch', async () => {
    const state = createHarness()
    state.setCurrentPtyId('pty-2')

    await state.controller.run()

    expect(state.clearRestoreState).toHaveBeenCalledTimes(1)
    expect(state.serializeSnapshot).not.toHaveBeenCalled()
  })
})
