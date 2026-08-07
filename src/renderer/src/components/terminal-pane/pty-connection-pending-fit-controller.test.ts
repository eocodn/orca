import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionPendingFitController } from './pty-connection-pending-fit-controller'

type FitHandle = {
  completion: Promise<boolean>
  cancel: () => void
}

const createHandle = (): FitHandle => ({
  completion: Promise.resolve(true),
  cancel: vi.fn()
})

describe('createPtyConnectionPendingFitController', () => {
  it('clears only the exact completed handle', () => {
    const first = createHandle()
    const second = createHandle()
    const controller = createPtyConnectionPendingFitController<FitHandle>()

    controller.setHidden(first)
    controller.setHidden(second)
    controller.clearHiddenIf(first)
    controller.cancelHidden()

    expect(first.cancel).not.toHaveBeenCalled()
    expect(second.cancel).toHaveBeenCalledTimes(1)
  })

  it('cancels hidden without touching reattach', () => {
    const hidden = createHandle()
    const reattach = createHandle()
    const controller = createPtyConnectionPendingFitController<FitHandle>()
    controller.setHidden(hidden)
    controller.setReattach(reattach)

    controller.cancelHidden()

    expect(hidden.cancel).toHaveBeenCalledTimes(1)
    expect(reattach.cancel).not.toHaveBeenCalled()
  })

  it('cancels both pending fits once', () => {
    const hidden = createHandle()
    const reattach = createHandle()
    const controller = createPtyConnectionPendingFitController<FitHandle>()
    controller.setHidden(hidden)
    controller.setReattach(reattach)

    controller.cancelAll()
    controller.cancelAll()

    expect(hidden.cancel).toHaveBeenCalledTimes(1)
    expect(reattach.cancel).toHaveBeenCalledTimes(1)
  })

  it('clears bookkeeping without cancelling pane-wide cancelled handles', () => {
    const hidden = createHandle()
    const reattach = createHandle()
    const controller = createPtyConnectionPendingFitController<FitHandle>()
    controller.setHidden(hidden)
    controller.setReattach(reattach)

    controller.clearAll()
    controller.cancelAll()

    expect(hidden.cancel).not.toHaveBeenCalled()
    expect(reattach.cancel).not.toHaveBeenCalled()
  })
})
