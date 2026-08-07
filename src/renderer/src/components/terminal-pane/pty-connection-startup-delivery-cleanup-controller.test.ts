import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionStartupDeliveryCleanupController } from './pty-connection-startup-delivery-cleanup-controller'

describe('createPtyConnectionStartupDeliveryCleanupController', () => {
  it('disposes safely before startup delivery is bound', () => {
    const controller = createPtyConnectionStartupDeliveryCleanupController()

    controller.dispose()
  })

  it('disposes both startup delivery owners', () => {
    const disposeDraft = vi.fn()
    const disposeCommandDelivery = vi.fn()
    const controller = createPtyConnectionStartupDeliveryCleanupController()
    controller.bind({ disposeDraft, disposeCommandDelivery })

    controller.dispose()

    expect(disposeDraft).toHaveBeenCalledTimes(1)
    expect(disposeCommandDelivery).toHaveBeenCalledTimes(1)
  })

  it('disposes the bound startup cleanup idempotently', () => {
    const disposeDraft = vi.fn()
    const disposeCommandDelivery = vi.fn()
    const controller = createPtyConnectionStartupDeliveryCleanupController()
    controller.bind({ disposeDraft, disposeCommandDelivery })

    controller.dispose()
    controller.dispose()

    expect(disposeDraft).toHaveBeenCalledTimes(1)
    expect(disposeCommandDelivery).toHaveBeenCalledTimes(1)
  })
})
