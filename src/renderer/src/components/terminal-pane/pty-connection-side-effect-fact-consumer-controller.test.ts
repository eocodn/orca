import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionSideEffectFactConsumerController } from './pty-connection-side-effect-fact-consumer-controller'

describe('createPtyConnectionSideEffectFactConsumerController', () => {
  it('clears safely before any consumer is registered', () => {
    const controller = createPtyConnectionSideEffectFactConsumerController()

    controller.clear()
  })

  it('keeps the first consumer active until cleared', () => {
    const unsubscribe = vi.fn()
    const subscribe = vi.fn(() => unsubscribe)
    const controller = createPtyConnectionSideEffectFactConsumerController()

    controller.replace(subscribe)

    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(unsubscribe).not.toHaveBeenCalled()
    controller.clear()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes the previous consumer before registering its replacement', () => {
    const order: string[] = []
    const controller = createPtyConnectionSideEffectFactConsumerController()

    controller.replace(() => () => order.push('unsubscribe-first'))
    controller.replace(() => {
      order.push('subscribe-second')
      return () => order.push('unsubscribe-second')
    })

    expect(order).toEqual(['unsubscribe-first', 'subscribe-second'])
    controller.clear()
    expect(order).toEqual(['unsubscribe-first', 'subscribe-second', 'unsubscribe-second'])
  })

  it('clears the active consumer idempotently', () => {
    const unsubscribe = vi.fn()
    const controller = createPtyConnectionSideEffectFactConsumerController()
    controller.replace(() => unsubscribe)

    controller.clear()
    controller.clear()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
