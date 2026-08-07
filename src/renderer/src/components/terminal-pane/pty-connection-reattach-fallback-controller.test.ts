import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionReattachFallbackController } from './pty-connection-reattach-fallback-controller'

const createController = (
  overrides: Partial<Parameters<typeof createPtyConnectionReattachFallbackController>[0]> = {}
) => {
  const clearBindings = vi.fn()
  const startFreshColdRestore = vi.fn()
  const reportError = vi.fn()
  const warnRejected = vi.fn()
  const controller = createPtyConnectionReattachFallbackController({
    sessionId: 'pty-1',
    isDisposed: () => false,
    rejectRejectedWhenDisposed: false,
    getTransportStreamGeneration: () => 4,
    isCurrentAuthority: () => true,
    rejectObsoleteAuthority: () => false,
    isRejectedSessionExpired: (error) => error instanceof Error && error.message === 'expired',
    clearBindings,
    clearBindingsOnRejectedError: false,
    startFreshColdRestore,
    reportError,
    warnRejected,
    reportRejectedError: true,
    warnRejectedError: true,
    ...overrides
  })
  return { controller, clearBindings, startFreshColdRestore, reportError, warnRejected }
}

describe('createPtyConnectionReattachFallbackController', () => {
  it('reports transport errors only while the captured authority is current', () => {
    const current = createController()
    current.controller.onTransportError('visible')
    expect(current.reportError).toHaveBeenCalledWith('visible')

    const stale = createController({ isCurrentAuthority: () => false })
    stale.controller.onTransportError('hidden')
    expect(stale.reportError).not.toHaveBeenCalled()
  })

  it('clears stale bindings and force-restores after an accepted expiration', () => {
    const state = createController()

    state.controller.onExpired()

    expect(state.clearBindings).toHaveBeenCalledOnce()
    expect(state.startFreshColdRestore).toHaveBeenCalledOnce()
  })

  it('ignores expired fallback after disposal or authority replacement', () => {
    const disposed = createController({ isDisposed: () => true })
    disposed.controller.onExpired()
    expect(disposed.startFreshColdRestore).not.toHaveBeenCalled()

    const obsolete = createController({ rejectObsoleteAuthority: () => true })
    obsolete.controller.onExpired()
    expect(obsolete.startFreshColdRestore).not.toHaveBeenCalled()
  })

  it('rejects stale generations before warning, reporting, or fallback', () => {
    const state = createController()

    state.controller.onRejected(new Error('boom'), 3)

    expect(state.warnRejected).not.toHaveBeenCalled()
    expect(state.reportError).not.toHaveBeenCalled()
    expect(state.startFreshColdRestore).not.toHaveBeenCalled()
  })

  it('cleans bindings for expired rejection and preserves optional reporting policy', () => {
    const expired = createController({ reportRejectedError: false, warnRejectedError: false })
    expired.controller.onRejected(new Error('expired'), 4)
    expect(expired.clearBindings).toHaveBeenCalledOnce()
    expect(expired.reportError).not.toHaveBeenCalled()
    expect(expired.warnRejected).not.toHaveBeenCalled()
    expect(expired.startFreshColdRestore).toHaveBeenCalledOnce()

    const ordinary = createController()
    ordinary.controller.onRejected(new Error('boom'), 4)
    expect(ordinary.clearBindings).not.toHaveBeenCalled()
    expect(ordinary.warnRejected).toHaveBeenCalledWith('boom')
    expect(ordinary.reportError).toHaveBeenCalledWith('boom')
    expect(ordinary.startFreshColdRestore).toHaveBeenCalledOnce()
  })
})
