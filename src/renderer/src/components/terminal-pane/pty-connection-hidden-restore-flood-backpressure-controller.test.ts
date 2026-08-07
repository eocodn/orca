import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HIDDEN_OUTPUT_RESTORE_FLOOD_SUPPRESS_MS } from './pty-connection-runtime-state'
import { createPtyConnectionHiddenRestoreFloodBackpressureController } from './pty-connection-hidden-restore-flood-backpressure-controller'

describe('createPtyConnectionHiddenRestoreFloodBackpressureController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-07T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('extends suppression and repaints once after the last backpressure signal', () => {
    let currentPtyId: string | null = 'pty-1'
    const requestRepaint = vi.fn()
    const controller = createPtyConnectionHiddenRestoreFloodBackpressureController({
      getCurrentPtyId: () => currentPtyId,
      isDisposed: () => false,
      requestRepaint
    })

    controller.noteBackpressure(currentPtyId)
    expect(controller.isSuppressed()).toBe(true)
    vi.advanceTimersByTime(HIDDEN_OUTPUT_RESTORE_FLOOD_SUPPRESS_MS - 1)
    controller.noteBackpressure(currentPtyId)
    vi.advanceTimersByTime(HIDDEN_OUTPUT_RESTORE_FLOOD_SUPPRESS_MS - 1)
    expect(requestRepaint).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)

    expect(controller.isSuppressed()).toBe(false)
    expect(requestRepaint).toHaveBeenCalledTimes(1)
  })

  it('suppresses the deferred repaint after the PTY authority changes', () => {
    let currentPtyId: string | null = 'pty-1'
    const requestRepaint = vi.fn()
    const controller = createPtyConnectionHiddenRestoreFloodBackpressureController({
      getCurrentPtyId: () => currentPtyId,
      isDisposed: () => false,
      requestRepaint
    })
    controller.noteBackpressure(currentPtyId)

    currentPtyId = 'pty-2'
    vi.advanceTimersByTime(HIDDEN_OUTPUT_RESTORE_FLOOD_SUPPRESS_MS)

    expect(requestRepaint).not.toHaveBeenCalled()
  })

  it('reset clears suppression and cancels the deferred repaint', () => {
    const requestRepaint = vi.fn()
    const controller = createPtyConnectionHiddenRestoreFloodBackpressureController({
      getCurrentPtyId: () => 'pty-1',
      isDisposed: () => false,
      requestRepaint
    })
    controller.noteBackpressure('pty-1')

    controller.reset()
    vi.advanceTimersByTime(HIDDEN_OUTPUT_RESTORE_FLOOD_SUPPRESS_MS)

    expect(controller.isSuppressed()).toBe(false)
    expect(requestRepaint).not.toHaveBeenCalled()
  })

  it('dispose cancels repaint even while the suppression window is active', () => {
    const requestRepaint = vi.fn()
    const controller = createPtyConnectionHiddenRestoreFloodBackpressureController({
      getCurrentPtyId: () => 'pty-1',
      isDisposed: () => true,
      requestRepaint
    })
    controller.noteBackpressure('pty-1')

    controller.dispose()
    vi.advanceTimersByTime(HIDDEN_OUTPUT_RESTORE_FLOOD_SUPPRESS_MS)

    expect(controller.isSuppressed()).toBe(false)
    expect(requestRepaint).not.toHaveBeenCalled()
  })
})
