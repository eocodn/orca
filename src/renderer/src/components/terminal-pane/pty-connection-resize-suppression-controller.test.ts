import { describe, expect, it } from 'vitest'
import { createPtyConnectionResizeSuppressionController } from './pty-connection-resize-suppression-controller'

describe('createPtyConnectionResizeSuppressionController', () => {
  it('starts with resize forwarding enabled', () => {
    const controller = createPtyConnectionResizeSuppressionController()
    expect(controller.shouldSkip()).toBe(false)
  })

  it('suppresses only while a structural resize is running', () => {
    const controller = createPtyConnectionResizeSuppressionController()

    controller.runStructural(() => {
      expect(controller.shouldSkip()).toBe(true)
    })

    expect(controller.shouldSkip()).toBe(false)
  })

  it('suppresses only while a viewport-claim resize is running', () => {
    const controller = createPtyConnectionResizeSuppressionController()

    controller.runViewportClaim(() => {
      expect(controller.shouldSkip()).toBe(true)
    })

    expect(controller.shouldSkip()).toBe(false)
  })

  it('restores suppression after an operation throws', () => {
    const controller = createPtyConnectionResizeSuppressionController()

    expect(() =>
      controller.runStructural(() => {
        throw new Error('resize failed')
      })
    ).toThrow('resize failed')
    expect(controller.shouldSkip()).toBe(false)
  })

  it('keeps the outer suppression reason active across cross-reason nesting', () => {
    const controller = createPtyConnectionResizeSuppressionController()

    controller.runStructural(() => {
      controller.runViewportClaim(() => {
        expect(controller.shouldSkip()).toBe(true)
      })
      expect(controller.shouldSkip()).toBe(true)
    })

    expect(controller.shouldSkip()).toBe(false)
  })
})
