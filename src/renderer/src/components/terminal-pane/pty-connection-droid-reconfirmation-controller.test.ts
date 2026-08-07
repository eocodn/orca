import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPtyConnectionDroidReconfirmationController } from './pty-connection-droid-reconfirmation-controller'

afterEach(() => {
  vi.useRealTimers()
})

describe('createPtyConnectionDroidReconfirmationController', () => {
  it('runs once after the idle window', () => {
    vi.useFakeTimers()
    const reconfirm = vi.fn()
    const controller = createPtyConnectionDroidReconfirmationController({ reconfirm })

    controller.request()
    vi.advanceTimersByTime(349)
    expect(reconfirm).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(reconfirm).toHaveBeenCalledTimes(1)
    vi.runAllTimers()
    expect(reconfirm).toHaveBeenCalledTimes(1)
  })

  it('extends the idle window from the latest request', () => {
    vi.useFakeTimers()
    const reconfirm = vi.fn()
    const controller = createPtyConnectionDroidReconfirmationController({ reconfirm })

    controller.request()
    vi.advanceTimersByTime(200)
    controller.request()
    vi.advanceTimersByTime(349)
    expect(reconfirm).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(reconfirm).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending reconfirmation on dispose', () => {
    vi.useFakeTimers()
    const reconfirm = vi.fn()
    const controller = createPtyConnectionDroidReconfirmationController({ reconfirm })

    controller.request()
    controller.dispose()
    controller.dispose()
    vi.runAllTimers()

    expect(reconfirm).not.toHaveBeenCalled()
  })
})
