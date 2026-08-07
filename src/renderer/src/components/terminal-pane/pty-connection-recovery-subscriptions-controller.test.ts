import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionRecoverySubscriptionsController } from './pty-connection-recovery-subscriptions-controller'

describe('createPtyConnectionRecoverySubscriptionsController', () => {
  it('keeps first backlog and document subscriptions until dispose', () => {
    const backlog = vi.fn()
    const documentVisibility = vi.fn()
    const controller = createPtyConnectionRecoverySubscriptionsController()

    controller.replaceBacklog(backlog)
    controller.replaceDocumentVisibility(documentVisibility)
    expect(backlog).not.toHaveBeenCalled()
    expect(documentVisibility).not.toHaveBeenCalled()

    controller.dispose()
    expect(backlog).toHaveBeenCalledTimes(1)
    expect(documentVisibility).toHaveBeenCalledTimes(1)
  })

  it('replaces each subscription without disturbing the other kind', () => {
    const firstBacklog = vi.fn()
    const secondBacklog = vi.fn()
    const documentVisibility = vi.fn()
    const controller = createPtyConnectionRecoverySubscriptionsController()

    controller.replaceBacklog(firstBacklog)
    controller.replaceDocumentVisibility(documentVisibility)
    controller.replaceBacklog(secondBacklog)

    expect(firstBacklog).toHaveBeenCalledTimes(1)
    expect(secondBacklog).not.toHaveBeenCalled()
    expect(documentVisibility).not.toHaveBeenCalled()
    controller.dispose()
    expect(secondBacklog).toHaveBeenCalledTimes(1)
    expect(documentVisibility).toHaveBeenCalledTimes(1)
  })

  it('disposes both subscriptions idempotently', () => {
    const backlog = vi.fn()
    const documentVisibility = vi.fn()
    const controller = createPtyConnectionRecoverySubscriptionsController()
    controller.replaceBacklog(backlog)
    controller.replaceDocumentVisibility(documentVisibility)

    controller.dispose()
    controller.dispose()

    expect(backlog).toHaveBeenCalledTimes(1)
    expect(documentVisibility).toHaveBeenCalledTimes(1)
  })
})
