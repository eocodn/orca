import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionHiddenRestoreRequestController } from './pty-connection-hidden-restore-request-controller'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createHarness() {
  let disposed = false
  let certifiedDead = false
  let restorePtyId: string | null = null
  let currentPtyId: string | null = 'pty-1'
  let restoreNeeded = true
  let queuedChunks = false
  let pendingLive = false
  let taskInFlight = false
  let activeSplitPane = true
  let foreground = true
  let restoreGeneration = 1
  let deferredRetry = false
  const claimCertifiedDeadRecovery = vi.fn(() => true)
  const requestCertifiedDeadRecovery = vi.fn()
  const resetIfPtyChanged = vi.fn()
  const canUseSnapshot = vi.fn((ptyId: string | null) => ptyId !== null)
  const bindRestorePty = vi.fn((ptyId: string) => {
    restorePtyId = ptyId
  })
  const armForegroundDeadline = vi.fn()
  let scheduled: (() => void) | null = null
  const scheduleInactive = vi.fn((callback: () => void) => {
    scheduled = callback
    return true
  })
  const cancelScheduled = vi.fn()
  const clearDeferredRetry = vi.fn()
  const task = deferred()
  const runRestoreTask = vi.fn(() => task.promise)
  let settled: (() => void) | null = null
  const trackTask = vi.fn((promise: Promise<void>, onSettled: () => void) => {
    settled = onSettled
    return promise
  })
  const markRestoreNeeded = vi.fn(() => {
    restoreNeeded = true
  })

  const controller = createPtyConnectionHiddenRestoreRequestController({
    isDisposed: () => disposed,
    isWritePipelineCertifiedDead: () => certifiedDead,
    claimCertifiedDeadRecovery,
    requestCertifiedDeadRecovery,
    resetIfPtyChanged,
    getRestorePtyId: () => restorePtyId,
    getCurrentPtyId: () => currentPtyId,
    isRestoreNeeded: () => restoreNeeded,
    hasQueuedChunks: () => queuedChunks,
    canUseSnapshot,
    bindRestorePty,
    isTaskInFlight: () => taskInFlight,
    armForegroundDeadline,
    isActiveSplitPane: () => activeSplitPane,
    getRestoreGeneration: () => restoreGeneration,
    scheduleInactive,
    cancelScheduled,
    isForeground: () => foreground,
    clearDeferredRetry,
    runRestoreTask,
    trackTask,
    hasPendingLive: () => pendingLive,
    markRestoreNeeded,
    isDeferredRetry: () => deferredRetry
  })

  return {
    controller,
    claimCertifiedDeadRecovery,
    requestCertifiedDeadRecovery,
    resetIfPtyChanged,
    canUseSnapshot,
    bindRestorePty,
    armForegroundDeadline,
    scheduleInactive,
    cancelScheduled,
    clearDeferredRetry,
    runRestoreTask,
    trackTask,
    markRestoreNeeded,
    runScheduled() {
      scheduled?.()
    },
    runSettled() {
      settled?.()
    },
    setDisposed(value: boolean) {
      disposed = value
    },
    setCertifiedDead(value: boolean) {
      certifiedDead = value
    },
    setRestorePtyId(value: string | null) {
      restorePtyId = value
    },
    setCurrentPtyId(value: string | null) {
      currentPtyId = value
    },
    setRestoreNeeded(value: boolean) {
      restoreNeeded = value
    },
    setQueuedChunks(value: boolean) {
      queuedChunks = value
    },
    setPendingLive(value: boolean) {
      pendingLive = value
    },
    setTaskInFlight(value: boolean) {
      taskInFlight = value
    },
    setActiveSplitPane(value: boolean) {
      activeSplitPane = value
    },
    setForeground(value: boolean) {
      foreground = value
    },
    setRestoreGeneration(value: number) {
      restoreGeneration = value
    },
    setDeferredRetry(value: boolean) {
      deferredRetry = value
    }
  }
}

describe('createPtyConnectionHiddenRestoreRequestController', () => {
  it('routes certified-dead admission to recovery without starting a restore', () => {
    const state = createHarness()
    state.setCertifiedDead(true)

    expect(state.controller.request()).toBe(false)
    expect(state.claimCertifiedDeadRecovery).toHaveBeenCalledTimes(1)
    expect(state.requestCertifiedDeadRecovery).toHaveBeenCalledTimes(1)
    expect(state.runRestoreTask).not.toHaveBeenCalled()
  })

  it('returns false when no restore work is pending', () => {
    const state = createHarness()
    state.setRestoreNeeded(false)

    expect(state.controller.request()).toBe(false)
    expect(state.resetIfPtyChanged).toHaveBeenCalledTimes(1)
    expect(state.runRestoreTask).not.toHaveBeenCalled()
  })

  it('returns false when the selected PTY cannot provide a snapshot', () => {
    const state = createHarness()
    state.canUseSnapshot.mockReturnValue(false)

    expect(state.controller.request()).toBe(false)
    expect(state.bindRestorePty).not.toHaveBeenCalled()
  })

  it('coalesces onto an in-flight restore and arms its foreground deadline', () => {
    const state = createHarness()
    state.setTaskInFlight(true)

    expect(state.controller.request()).toBe(true)
    expect(state.bindRestorePty).toHaveBeenCalledWith('pty-1')
    expect(state.armForegroundDeadline).toHaveBeenCalledTimes(1)
    expect(state.runRestoreTask).not.toHaveBeenCalled()
  })

  it('suppresses an inactive scheduled request when its generation becomes stale', () => {
    const state = createHarness()
    state.setActiveSplitPane(false)

    expect(state.controller.request()).toBe(true)
    state.setRestoreGeneration(2)
    state.runScheduled()

    expect(state.scheduleInactive).toHaveBeenCalledTimes(1)
    expect(state.runRestoreTask).not.toHaveBeenCalled()
  })

  it('starts a valid inactive scheduled request through the bypass path', () => {
    const state = createHarness()
    state.setActiveSplitPane(false)

    expect(state.controller.request()).toBe(true)
    state.runScheduled()

    expect(state.runRestoreTask).toHaveBeenCalledTimes(1)
    expect(state.clearDeferredRetry).toHaveBeenCalledTimes(1)
    expect(state.trackTask).toHaveBeenCalledTimes(1)
  })

  it('starts an active restore immediately and cancels stale inactive scheduling', () => {
    const state = createHarness()

    expect(state.controller.request()).toBe(true)

    expect(state.cancelScheduled).toHaveBeenCalledTimes(1)
    expect(state.clearDeferredRetry).toHaveBeenCalledTimes(1)
    expect(state.runRestoreTask).toHaveBeenCalledTimes(1)
    expect(state.trackTask).toHaveBeenCalledTimes(1)
  })

  it('re-arms pending live work and follows up after task settlement', () => {
    const state = createHarness()
    state.controller.request()
    state.setPendingLive(true)

    state.runSettled()

    expect(state.markRestoreNeeded).toHaveBeenCalledTimes(1)
    expect(state.armForegroundDeadline).toHaveBeenCalledTimes(1)
    expect(state.runRestoreTask).toHaveBeenCalledTimes(2)
  })

  it('does not respawn restore work after disposal or while retry is deferred', () => {
    const disposedState = createHarness()
    disposedState.controller.request()
    disposedState.setPendingLive(true)
    disposedState.setDisposed(true)
    disposedState.runSettled()
    expect(disposedState.runRestoreTask).toHaveBeenCalledTimes(1)
    expect(disposedState.markRestoreNeeded).not.toHaveBeenCalled()

    const deferredState = createHarness()
    deferredState.controller.request()
    deferredState.setRestoreNeeded(true)
    deferredState.setDeferredRetry(true)
    deferredState.runSettled()
    expect(deferredState.runRestoreTask).toHaveBeenCalledTimes(1)
  })
})
