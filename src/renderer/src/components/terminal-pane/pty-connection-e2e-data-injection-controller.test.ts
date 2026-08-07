import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionE2eDataInjectionController } from './pty-connection-e2e-data-injection-controller'

describe('createPtyConnectionE2eDataInjectionController', () => {
  it('keeps the first registration active until dispose', () => {
    const unregister = vi.fn()
    const register = vi.fn(() => unregister)
    const controller = createPtyConnectionE2eDataInjectionController({
      paneKey: 'pane-1',
      register
    })
    const inject = vi.fn()

    controller.register(inject)

    expect(register).toHaveBeenCalledWith('pane-1', inject)
    expect(unregister).not.toHaveBeenCalled()
    controller.dispose()
    expect(unregister).toHaveBeenCalledTimes(1)
  })

  it('unregisters the prior injection before replacing it', () => {
    const order: string[] = []
    const controller = createPtyConnectionE2eDataInjectionController({
      paneKey: 'pane-1',
      register: (_paneKey, inject) => {
        order.push(inject.name)
        return () => order.push(`unregister-${inject.name}`)
      }
    })
    function first(): void {}
    function second(): void {}

    controller.register(first)
    controller.register(second)

    expect(order).toEqual(['first', 'unregister-first', 'second'])
  })

  it('disposes the active registration idempotently', () => {
    const unregister = vi.fn()
    const controller = createPtyConnectionE2eDataInjectionController({
      paneKey: 'pane-1',
      register: () => unregister
    })
    controller.register(() => {})

    controller.dispose()
    controller.dispose()

    expect(unregister).toHaveBeenCalledTimes(1)
  })
})
