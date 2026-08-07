import { describe, expect, it } from 'vitest'
import { createPtyConnectionHiddenRestoreFreshnessController } from './pty-connection-hidden-restore-freshness-controller'

describe('createPtyConnectionHiddenRestoreFreshnessController', () => {
  it('starts clear and consumes a marked fresh-snapshot requirement once', () => {
    const controller = createPtyConnectionHiddenRestoreFreshnessController()

    expect(controller.takeNeeded()).toBe(false)
    controller.markNeeded()
    expect(controller.takeNeeded()).toBe(true)
    expect(controller.takeNeeded()).toBe(false)
  })

  it('coalesces repeated marks into one pending requirement', () => {
    const controller = createPtyConnectionHiddenRestoreFreshnessController()

    controller.markNeeded()
    controller.markNeeded()

    expect(controller.takeNeeded()).toBe(true)
    expect(controller.takeNeeded()).toBe(false)
  })

  it('reset clears a pending requirement', () => {
    const controller = createPtyConnectionHiddenRestoreFreshnessController()
    controller.markNeeded()

    controller.reset()

    expect(controller.takeNeeded()).toBe(false)
  })
})
