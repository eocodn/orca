import { describe, expect, it } from 'vitest'
import { createPtyConnectionRemoteOutputPauseController } from './pty-connection-remote-output-pause-controller'

describe('createPtyConnectionRemoteOutputPauseController', () => {
  it('starts without a paused PTY', () => {
    const controller = createPtyConnectionRemoteOutputPauseController()

    expect(controller.isPaused('remote:env-1@@pty-1')).toBe(false)
  })

  it('marks a PTY paused once and reports whether state changed', () => {
    const controller = createPtyConnectionRemoteOutputPauseController()

    expect(controller.markPaused('remote:env-1@@pty-1')).toBe(true)
    expect(controller.markPaused('remote:env-1@@pty-1')).toBe(false)
    expect(controller.isPaused('remote:env-1@@pty-1')).toBe(true)
  })

  it('clears only an exact paused PTY', () => {
    const controller = createPtyConnectionRemoteOutputPauseController()
    controller.markPaused('remote:env-1@@pty-1')

    expect(controller.clearIfMatches('remote:env-1@@pty-2')).toBe(false)
    expect(controller.isPaused('remote:env-1@@pty-1')).toBe(true)
    expect(controller.clearIfMatches('remote:env-1@@pty-1')).toBe(true)
    expect(controller.isPaused('remote:env-1@@pty-1')).toBe(false)
  })

  it('clears stale pause identity after the transport rebinds', () => {
    const controller = createPtyConnectionRemoteOutputPauseController()
    controller.markPaused('remote:env-1@@pty-1')

    expect(controller.clearIfRebound('remote:env-1@@pty-1')).toBe(false)
    expect(controller.clearIfRebound('remote:env-1@@pty-2')).toBe(true)
    expect(controller.isPaused('remote:env-1@@pty-1')).toBe(false)
  })

  it('clears any paused PTY idempotently', () => {
    const controller = createPtyConnectionRemoteOutputPauseController()
    controller.markPaused('remote:env-1@@pty-1')

    expect(controller.clear()).toBe(true)
    expect(controller.clear()).toBe(false)
  })
})
