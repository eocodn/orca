import { describe, expect, it } from 'vitest'
import { createPtyConnectionHiddenRestoreReplayBaselineController } from './pty-connection-hidden-restore-replay-baseline-controller'

describe('createPtyConnectionHiddenRestoreReplayBaselineController', () => {
  it('records replay baseline metadata only when a snapshot sequence exists', () => {
    const controller = createPtyConnectionHiddenRestoreReplayBaselineController()

    controller.begin({ pendingDeliveryStartSeq: 12 })
    expect(controller.take()).toBeNull()

    controller.begin({ seq: 20, pendingDeliveryStartSeq: 12 })
    expect(controller.take()).toEqual({ seq: 20, pendingDeliveryStartSeq: 12 })
  })

  it('take returns the active replay baseline once', () => {
    const controller = createPtyConnectionHiddenRestoreReplayBaselineController()
    controller.begin({ seq: 20 })

    expect(controller.take()).toEqual({ seq: 20 })
    expect(controller.take()).toBeNull()
  })

  it('clear drops an active replay baseline', () => {
    const controller = createPtyConnectionHiddenRestoreReplayBaselineController()
    controller.begin({ seq: 20 })

    controller.clear()

    expect(controller.take()).toBeNull()
  })
})
