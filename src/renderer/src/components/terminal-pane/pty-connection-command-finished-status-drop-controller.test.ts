import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionCommandFinishedStatusDropController } from './pty-connection-command-finished-status-drop-controller'

describe('createPtyConnectionCommandFinishedStatusDropController', () => {
  it('defers a status drop until settlement and settles it once', () => {
    const controller = createPtyConnectionCommandFinishedStatusDropController()
    const action = vi.fn()

    controller.handle(action, true)
    expect(action).not.toHaveBeenCalled()

    controller.settle()
    controller.settle()
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('keeps only the latest deferred status drop', () => {
    const controller = createPtyConnectionCommandFinishedStatusDropController()
    const first = vi.fn()
    const second = vi.fn()

    controller.handle(first, true)
    controller.handle(second, true)
    controller.settle()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('discards stale pending work before running an immediate status drop', () => {
    const controller = createPtyConnectionCommandFinishedStatusDropController()
    const stale = vi.fn()
    const current = vi.fn()

    controller.handle(stale, true)
    controller.handle(current, false)
    controller.settle()

    expect(stale).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledTimes(1)
  })

  it('cancels pending work on clear and dispose', () => {
    const cleared = createPtyConnectionCommandFinishedStatusDropController()
    const clearedAction = vi.fn()
    cleared.handle(clearedAction, true)
    cleared.clear()
    cleared.settle()

    const disposed = createPtyConnectionCommandFinishedStatusDropController()
    const disposedAction = vi.fn()
    disposed.handle(disposedAction, true)
    disposed.dispose()
    disposed.dispose()
    disposed.settle()

    expect(clearedAction).not.toHaveBeenCalled()
    expect(disposedAction).not.toHaveBeenCalled()
  })
})
