import { describe, expect, it } from 'vitest'
import { createPtyConnectionHiddenRestoreScrollTicketController } from './pty-connection-hidden-restore-scroll-ticket-controller'

describe('createPtyConnectionHiddenRestoreScrollTicketController', () => {
  it('validates one current ticket against PTY and generation authority', () => {
    const controller = createPtyConnectionHiddenRestoreScrollTicketController()
    const ticket = controller.begin('pty-1', 3)

    expect(controller.isCurrent(ticket, 'pty-1', 3)).toBe(true)
    expect(controller.isCurrent(ticket, 'pty-2', 3)).toBe(false)
    expect(controller.isCurrent(ticket, 'pty-1', 4)).toBe(false)
  })

  it('marks a current ticket started and reports that when invalidated', () => {
    const controller = createPtyConnectionHiddenRestoreScrollTicketController()
    const ticket = controller.begin('pty-1', 3)

    expect(controller.markStarted(ticket)).toBe(true)
    expect(controller.invalidateCurrent()).toEqual({ started: true })
    expect(controller.isCurrent(ticket, 'pty-1', 3)).toBe(false)
  })

  it('handoffs generation only for the current matching PTY', () => {
    const controller = createPtyConnectionHiddenRestoreScrollTicketController()
    const ticket = controller.begin('pty-1', 3)

    expect(controller.handoffGeneration('pty-2', 4)).toBe(false)
    expect(controller.isCurrent(ticket, 'pty-1', 3)).toBe(true)
    expect(controller.handoffGeneration('pty-1', 4)).toBe(true)
    expect(controller.isCurrent(ticket, 'pty-1', 4)).toBe(true)
  })

  it('a replaced ticket cannot clear or start the current ticket', () => {
    const controller = createPtyConnectionHiddenRestoreScrollTicketController()
    const first = controller.begin('pty-1', 1)
    const second = controller.begin('pty-1', 2)

    expect(controller.markStarted(first)).toBe(false)
    controller.clearIf(first)
    expect(controller.isCurrent(second, 'pty-1', 2)).toBe(true)
  })

  it('clearIf retires only the matching current ticket', () => {
    const controller = createPtyConnectionHiddenRestoreScrollTicketController()
    const ticket = controller.begin(null, 1)

    controller.clearIf(ticket)

    expect(controller.hasCurrent()).toBe(false)
  })
})
