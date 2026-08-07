import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionBufferSwitchController } from './pty-connection-buffer-switch-controller'

describe('createPtyConnectionBufferSwitchController', () => {
  it('starts at zero and increments once per observed buffer switch', () => {
    let listener: (() => void) | null = null
    const controller = createPtyConnectionBufferSwitchController({
      subscribe: (next) => {
        listener = next
        return { dispose: vi.fn() }
      }
    })

    expect(controller.getCount()).toBe(0)
    listener?.()
    expect(controller.getCount()).toBe(1)
    listener?.()
    expect(controller.getCount()).toBe(2)
  })

  it('disposes the buffer subscription exactly once', () => {
    const dispose = vi.fn()
    const controller = createPtyConnectionBufferSwitchController({
      subscribe: () => ({ dispose })
    })

    controller.dispose()
    controller.dispose()

    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('supports terminals without a buffer-change subscription', () => {
    const controller = createPtyConnectionBufferSwitchController({
      subscribe: () => undefined
    })

    expect(controller.getCount()).toBe(0)
    expect(() => controller.dispose()).not.toThrow()
  })
})
