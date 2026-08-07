import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionHiddenRestoreTaskController } from './pty-connection-hidden-restore-task-controller'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('createPtyConnectionHiddenRestoreTaskController', () => {
  it('tracks one in-flight restore until it settles', async () => {
    const controller = createPtyConnectionHiddenRestoreTaskController()
    const task = deferred()
    const onSettled = vi.fn()

    const tracked = controller.track(task.promise, onSettled)
    expect(controller.isInFlight()).toBe(true)

    task.resolve()
    await tracked

    expect(controller.isInFlight()).toBe(false)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('abandon clears current identity but still runs a stale finalizer', async () => {
    const controller = createPtyConnectionHiddenRestoreTaskController()
    const task = deferred()
    const onSettled = vi.fn()
    const tracked = controller.track(task.promise, onSettled)

    controller.abandon()
    expect(controller.isInFlight()).toBe(false)
    task.resolve()
    await tracked

    expect(controller.isInFlight()).toBe(false)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('does not let an older task clear a replacement task', async () => {
    const controller = createPtyConnectionHiddenRestoreTaskController()
    const first = deferred()
    const second = deferred()
    const firstTracked = controller.track(first.promise, vi.fn())
    const secondTracked = controller.track(second.promise, vi.fn())

    first.resolve()
    await firstTracked
    expect(controller.isInFlight()).toBe(true)

    second.resolve()
    await secondTracked
    expect(controller.isInFlight()).toBe(false)
  })
})
