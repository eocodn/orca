import { describe, expect, it } from 'vitest'
import { createPtyConnectionHiddenRestoreIdentityController } from './pty-connection-hidden-restore-identity-controller'

describe('createPtyConnectionHiddenRestoreIdentityController', () => {
  it('marks restore need for one PTY and exposes the current identity', () => {
    const controller = createPtyConnectionHiddenRestoreIdentityController()

    controller.markNeededFor('pty-1')

    expect(controller.isNeeded()).toBe(true)
    expect(controller.getPtyId()).toBe('pty-1')
    expect(controller.getGeneration()).toBe(0)
    expect(controller.matches('pty-1', 0)).toBe(true)
  })

  it('clears only the needed latch while retaining PTY authority', () => {
    const controller = createPtyConnectionHiddenRestoreIdentityController()
    controller.markNeededFor('pty-1')

    controller.clearNeeded()

    expect(controller.isNeeded()).toBe(false)
    expect(controller.getPtyId()).toBe('pty-1')
  })

  it('can re-arm need for an already bound PTY', () => {
    const controller = createPtyConnectionHiddenRestoreIdentityController()
    controller.bindPty('pty-1')

    controller.markNeeded()

    expect(controller.isNeeded()).toBe(true)
    expect(controller.getPtyId()).toBe('pty-1')
  })

  it('complete clears need and PTY without invalidating the generation', () => {
    const controller = createPtyConnectionHiddenRestoreIdentityController()
    controller.markNeededFor('pty-1')

    controller.complete()

    expect(controller.isNeeded()).toBe(false)
    expect(controller.getPtyId()).toBeNull()
    expect(controller.getGeneration()).toBe(0)
  })

  it('invalidate clears identity and advances the generation', () => {
    const controller = createPtyConnectionHiddenRestoreIdentityController()
    controller.markNeededFor('pty-1')

    expect(controller.invalidate()).toBe(1)

    expect(controller.isNeeded()).toBe(false)
    expect(controller.getPtyId()).toBeNull()
    expect(controller.matches('pty-1', 0)).toBe(false)
  })

  it('detects an authority change only while bound to a PTY', () => {
    const controller = createPtyConnectionHiddenRestoreIdentityController()

    expect(controller.hasDifferentPty('pty-2')).toBe(false)
    controller.bindPty('pty-1')
    expect(controller.hasDifferentPty('pty-1')).toBe(false)
    expect(controller.hasDifferentPty('pty-2')).toBe(true)
  })
})
