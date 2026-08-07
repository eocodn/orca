import { describe, expect, it } from 'vitest'
import { createPtyConnectionHiddenRendererQueryStateController } from './pty-connection-hidden-renderer-query-state-controller'

describe('createPtyConnectionHiddenRendererQueryStateController', () => {
  it('starts clean with no pending query carry', () => {
    const controller = createPtyConnectionHiddenRendererQueryStateController()

    expect(controller.getPending()).toBe('')
    expect(controller.isDirty()).toBe(false)
  })

  it('takes pending query carry exactly once', () => {
    const controller = createPtyConnectionHiddenRendererQueryStateController()
    controller.setPending('\x1b[')

    expect(controller.takePending()).toBe('\x1b[')
    expect(controller.takePending()).toBe('')
  })

  it('marks renderer state dirty and clean without changing query carry', () => {
    const controller = createPtyConnectionHiddenRendererQueryStateController()
    controller.setPending('\x1b]10;?')
    controller.markDirty()

    expect(controller.isDirty()).toBe(true)
    controller.markClean()
    expect(controller.isDirty()).toBe(false)
    expect(controller.getPending()).toBe('\x1b]10;?')
  })

  it('resets both pending carry and renderer trust state', () => {
    const controller = createPtyConnectionHiddenRendererQueryStateController()
    controller.setPending('\x1b[')
    controller.markDirty()

    controller.reset()

    expect(controller.getPending()).toBe('')
    expect(controller.isDirty()).toBe(false)
  })
})
