import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HIDDEN_OUTPUT_RESTORE_FOREGROUND_TIMEOUT_MS } from './pty-connection-runtime-state'
import { createPtyConnectionHiddenRestoreForegroundDeadlineController } from './pty-connection-hidden-restore-foreground-deadline-controller'

describe('createPtyConnectionHiddenRestoreForegroundDeadlineController', () => {
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
      pending: true,
      restorePtyId: 'pty-1' as string | null,
      currentPtyId: 'pty-1' as string | null,
      generation: 3
    }
    const onDeadline = vi.fn()
    const controller = createPtyConnectionHiddenRestoreForegroundDeadlineController({
      isDisposed: () => state.disposed,
      isForeground: () => state.foreground,
      hasPending: () => state.pending,
      getRestorePtyId: () => state.restorePtyId,
      getCurrentPtyId: () => state.currentPtyId,
      getRestoreGeneration: () => state.generation,
      onDeadline
    })
    return { state, onDeadline, controller }
  }

  it('arms once and fires for the captured PTY generation', () => {
    const { controller, onDeadline } = createHarness()

    controller.arm()
    controller.arm()
    vi.advanceTimersByTime(HIDDEN_OUTPUT_RESTORE_FOREGROUND_TIMEOUT_MS)

    expect(onDeadline).toHaveBeenCalledTimes(1)
    expect(onDeadline).toHaveBeenCalledWith('pty-1')
  })

  it('clear cancels an armed deadline', () => {
    const { controller, onDeadline } = createHarness()
    controller.arm()

    controller.clear()
    vi.advanceTimersByTime(HIDDEN_OUTPUT_RESTORE_FOREGROUND_TIMEOUT_MS)

    expect(onDeadline).not.toHaveBeenCalled()
  })

  it('does not arm without foreground pending data or matching PTY authority', () => {
    const { state, controller, onDeadline } = createHarness()
    state.pending = false
    controller.arm()
    state.pending = true
    state.foreground = false
    controller.arm()
    state.foreground = true
    state.currentPtyId = 'pty-2'
    controller.arm()

    vi.advanceTimersByTime(HIDDEN_OUTPUT_RESTORE_FOREGROUND_TIMEOUT_MS)

    expect(onDeadline).not.toHaveBeenCalled()
  })

  it('suppresses a stale deadline after generation or restore authority changes', () => {
    const { state, controller, onDeadline } = createHarness()
    controller.arm()

    state.generation += 1
    vi.advanceTimersByTime(HIDDEN_OUTPUT_RESTORE_FOREGROUND_TIMEOUT_MS)
    expect(onDeadline).not.toHaveBeenCalled()

    state.generation = 3
    controller.arm()
    state.restorePtyId = 'pty-2'
    vi.advanceTimersByTime(HIDDEN_OUTPUT_RESTORE_FOREGROUND_TIMEOUT_MS)

    expect(onDeadline).not.toHaveBeenCalled()
  })

  it('suppresses a deadline when the pane becomes hidden', () => {
    const { state, controller, onDeadline } = createHarness()
    controller.arm()
    state.foreground = false

    vi.advanceTimersByTime(HIDDEN_OUTPUT_RESTORE_FOREGROUND_TIMEOUT_MS)

    expect(onDeadline).not.toHaveBeenCalled()
  })
})
