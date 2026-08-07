import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetHiddenOutputRestoreSchedulerForTests } from './hidden-output-restore-scheduler'
import { createPtyConnectionHiddenRestoreScheduleController } from './pty-connection-hidden-restore-schedule-controller'

describe('createPtyConnectionHiddenRestoreScheduleController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetHiddenOutputRestoreSchedulerForTests()
  })

  afterEach(() => {
    resetHiddenOutputRestoreSchedulerForTests()
    vi.useRealTimers()
  })

  it('coalesces duplicate inactive restore requests for one pane', () => {
    const controller = createPtyConnectionHiddenRestoreScheduleController({})
    const first = vi.fn()
    const second = vi.fn()

    expect(controller.scheduleInactive(first)).toBe(true)
    expect(controller.scheduleInactive(second)).toBe(false)
    vi.advanceTimersByTime(16)

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it('releases its latch before invoking the scheduled callback', () => {
    const controller = createPtyConnectionHiddenRestoreScheduleController({})
    const followUp = vi.fn()

    controller.scheduleInactive(() => {
      expect(controller.scheduleInactive(followUp)).toBe(true)
    })
    vi.advanceTimersByTime(16)
    vi.advanceTimersByTime(16)

    expect(followUp).toHaveBeenCalledTimes(1)
  })

  it('cancel removes the queued restore and allows a fresh schedule', () => {
    const controller = createPtyConnectionHiddenRestoreScheduleController({})
    const cancelled = vi.fn()
    const replacement = vi.fn()
    controller.scheduleInactive(cancelled)

    controller.cancel()
    expect(controller.scheduleInactive(replacement)).toBe(true)
    vi.advanceTimersByTime(16)

    expect(cancelled).not.toHaveBeenCalled()
    expect(replacement).toHaveBeenCalledTimes(1)
  })
})
