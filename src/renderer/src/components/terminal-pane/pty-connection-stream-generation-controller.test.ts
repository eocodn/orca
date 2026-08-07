import { describe, expect, it } from 'vitest'
import { createPtyConnectionStreamGenerationController } from './pty-connection-stream-generation-controller'

describe('createPtyConnectionStreamGenerationController', () => {
  it('starts at generation zero', () => {
    const controller = createPtyConnectionStreamGenerationController()
    expect(controller.getCurrent()).toBe(0)
    expect(controller.isCurrent(0)).toBe(true)
  })

  it('advances monotonically', () => {
    const controller = createPtyConnectionStreamGenerationController()

    expect(controller.advance()).toBe(1)
    expect(controller.advance()).toBe(2)
    expect(controller.getCurrent()).toBe(2)
  })

  it('invalidates older generations after an advance', () => {
    const controller = createPtyConnectionStreamGenerationController()
    const first = controller.advance()
    const second = controller.advance()

    expect(controller.isCurrent(first)).toBe(false)
    expect(controller.isCurrent(second)).toBe(true)
  })
})
