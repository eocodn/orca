import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPtyConnectionAlternateScreenRepaintController } from './pty-connection-alternate-screen-repaint-controller'

afterEach(() => {
  vi.useRealTimers()
})

describe('createPtyConnectionAlternateScreenRepaintController', () => {
  it('repaints immediately and coalesces requests inside the cooldown', () => {
    vi.useFakeTimers()
    const repaint = vi.fn()
    const controller = createPtyConnectionAlternateScreenRepaintController({ repaint })

    controller.request('pty-1')
    controller.request('pty-2')
    vi.advanceTimersByTime(99)
    controller.request('pty-3')

    expect(repaint).toHaveBeenCalledTimes(1)
    expect(repaint).toHaveBeenCalledWith('pty-1')
  })

  it('allows another repaint when the cooldown expires', () => {
    vi.useFakeTimers()
    const repaint = vi.fn()
    const controller = createPtyConnectionAlternateScreenRepaintController({ repaint })

    controller.request('pty-1')
    vi.advanceTimersByTime(100)
    controller.request('pty-2')

    expect(repaint).toHaveBeenNthCalledWith(1, 'pty-1')
    expect(repaint).toHaveBeenNthCalledWith(2, 'pty-2')
  })

  it('cancels the cooldown on dispose', () => {
    vi.useFakeTimers()
    const repaint = vi.fn()
    const controller = createPtyConnectionAlternateScreenRepaintController({ repaint })

    controller.request('pty-1')
    controller.dispose()
    controller.dispose()
    vi.runAllTimers()

    expect(repaint).toHaveBeenCalledTimes(1)
  })
})
