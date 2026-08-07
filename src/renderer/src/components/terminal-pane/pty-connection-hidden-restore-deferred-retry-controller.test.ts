import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MAX,
  HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MS
} from './pty-connection-runtime-state'
import { createPtyConnectionHiddenRestoreDeferredRetryController } from './pty-connection-hidden-restore-deferred-retry-controller'

describe('createPtyConnectionHiddenRestoreDeferredRetryController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createHarness() {
    const state = {
      disposed: false,
      foreground: true,
      restoreNeeded: true
    }
    const onRetry = vi.fn()
    const onExhausted = vi.fn()
    const controller = createPtyConnectionHiddenRestoreDeferredRetryController({
      isDisposed: () => state.disposed,
      isForeground: () => state.foreground,
      isRestoreNeeded: () => state.restoreNeeded,
      onRetry,
      onExhausted
    })
    return { state, onRetry, onExhausted, controller }
  }

  it('coalesces duplicate schedules into one delayed retry', () => {
    const { controller, onRetry } = createHarness()

    controller.schedule()
    controller.schedule()
    vi.advanceTimersByTime(HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MS)

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('does not retry after disposal or restore completion', () => {
    const { state, controller, onRetry } = createHarness()
    controller.schedule()
    state.restoreNeeded = false
    vi.advanceTimersByTime(HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MS)
    expect(onRetry).not.toHaveBeenCalled()

    state.restoreNeeded = true
    controller.schedule()
    state.disposed = true
    vi.advanceTimersByTime(HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MS)

    expect(onRetry).not.toHaveBeenCalled()
  })

  it('does not schedule while disposed or hidden', () => {
    const { state, controller, onRetry } = createHarness()
    state.foreground = false
    controller.schedule()
    state.foreground = true
    state.disposed = true
    controller.schedule()

    vi.advanceTimersByTime(HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MS)

    expect(onRetry).not.toHaveBeenCalled()
  })

  it('signals exhaustion after the retry budget is consumed', () => {
    const { controller, onRetry, onExhausted } = createHarness()
    for (let attempt = 0; attempt < HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MAX; attempt += 1) {
      controller.schedule()
      vi.advanceTimersByTime(HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MS)
    }

    controller.schedule()

    expect(onRetry).toHaveBeenCalledTimes(HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MAX)
    expect(onExhausted).toHaveBeenCalledTimes(1)
  })

  it('reset cancels a pending retry and restores the full retry budget', () => {
    const { controller, onRetry, onExhausted } = createHarness()
    for (let attempt = 0; attempt < HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MAX; attempt += 1) {
      controller.schedule()
      vi.advanceTimersByTime(HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MS)
    }

    controller.schedule()
    expect(onExhausted).toHaveBeenCalledTimes(1)
    controller.reset()
    controller.schedule()
    vi.advanceTimersByTime(HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MS)

    expect(onRetry).toHaveBeenCalledTimes(HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MAX + 1)
    expect(onExhausted).toHaveBeenCalledTimes(1)
  })

  it('resetAttempts preserves an already scheduled retry while renewing the budget', () => {
    const { controller, onRetry } = createHarness()
    controller.schedule()

    controller.resetAttempts()
    vi.advanceTimersByTime(HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MS)

    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
