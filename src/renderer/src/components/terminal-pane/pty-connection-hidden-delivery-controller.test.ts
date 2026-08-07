import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionHiddenDeliveryController } from './pty-connection-hidden-delivery-controller'

function createHarness() {
  let ptyId: string | null = 'local-1'
  let foreground = false
  let remotePausedPtyId: string | null = null
  let restorePtyId: string | null = null
  const setOutputPaused = vi.fn()
  const acquireHiddenClaim = vi.fn(() => vi.fn())
  const declareVisible = vi.fn()
  const registerModelRestore = vi.fn(() => vi.fn())
  const registerSideEffectFacts = vi.fn()
  const dropSideEffectFacts = vi.fn()
  const markRestoreNeeded = vi.fn()
  const requestRestore = vi.fn()

  const controller = createPtyConnectionHiddenDeliveryController({
    getPtyId: () => ptyId,
    setOutputPaused,
    isDisposed: () => false,
    isForeground: () => foreground,
    isRemotePty: (candidate) => candidate?.startsWith('remote:') === true,
    isGateManagedPty: (candidate) => candidate?.startsWith('local-') === true,
    acquireHiddenClaim,
    declareVisible,
    registerModelRestore,
    remotePause: {
      markPaused(candidate) {
        if (remotePausedPtyId === candidate) {
          return false
        }
        remotePausedPtyId = candidate
        return true
      },
      clearIfMatches(candidate) {
        if (remotePausedPtyId !== candidate) {
          return false
        }
        remotePausedPtyId = null
        return true
      },
      clearIfRebound(candidate) {
        if (remotePausedPtyId === null || remotePausedPtyId === candidate) {
          return false
        }
        remotePausedPtyId = null
        return true
      },
      clear() {
        if (remotePausedPtyId === null) {
          return false
        }
        remotePausedPtyId = null
        return true
      }
    },
    mainSideEffectAuthority: false,
    registerSideEffectFacts,
    dropSideEffectFacts
  })

  const bindRuntime = (): void =>
    controller.bindRuntime({
      canUseSnapshot: (candidate) => candidate !== null,
      onModelRestoreNeeded: vi.fn(),
      markRestoreNeeded,
      requestRestore,
      getRestorePtyId: () => restorePtyId
    })

  return {
    controller,
    bindRuntime,
    setPtyId: (next: string | null) => {
      ptyId = next
    },
    setForeground: (next: boolean) => {
      foreground = next
    },
    setRestorePtyId: (next: string | null) => {
      restorePtyId = next
    },
    setOutputPaused,
    acquireHiddenClaim,
    declareVisible,
    registerModelRestore,
    registerSideEffectFacts,
    dropSideEffectFacts,
    markRestoreNeeded,
    requestRestore
  }
}

describe('createPtyConnectionHiddenDeliveryController', () => {
  it('keeps stable lifecycle methods inert before runtime binding', () => {
    const harness = createHarness()

    harness.controller.sync()
    harness.controller.handleRemoteOutputPauseChanged(true, true)
    harness.controller.release()

    expect(harness.acquireHiddenClaim).not.toHaveBeenCalled()
    expect(harness.setOutputPaused).not.toHaveBeenCalled()
    expect(harness.registerModelRestore).not.toHaveBeenCalled()
  })

  it('claims hidden local delivery and releases it on reveal', () => {
    const harness = createHarness()
    harness.bindRuntime()

    harness.controller.sync()
    const releaseClaim = harness.acquireHiddenClaim.mock.results[0]?.value
    expect(harness.acquireHiddenClaim).toHaveBeenCalledWith('local-1')

    harness.setForeground(true)
    harness.controller.sync()

    expect(releaseClaim).toHaveBeenCalledTimes(1)
    expect(harness.declareVisible).not.toHaveBeenCalled()
  })

  it('clears a stale visible bit on first visible sync and replaces state on PTY rebind', () => {
    const harness = createHarness()
    harness.setForeground(true)
    harness.bindRuntime()

    harness.controller.sync()
    expect(harness.declareVisible).toHaveBeenCalledWith('local-1')
    const unregisterFirstModel = harness.registerModelRestore.mock.results[0]?.value

    harness.setForeground(false)
    harness.controller.sync()
    const releaseFirstClaim = harness.acquireHiddenClaim.mock.results[0]?.value
    harness.setPtyId('local-2')
    harness.controller.sync()

    expect(releaseFirstClaim).toHaveBeenCalledTimes(1)
    expect(unregisterFirstModel).toHaveBeenCalledTimes(1)
    expect(harness.registerModelRestore).toHaveBeenLastCalledWith('local-2', expect.any(Function))
    expect(harness.acquireHiddenClaim).toHaveBeenLastCalledWith('local-2')
  })

  it('uses remote pause events to own side-effect facts and request restore on unpause', () => {
    const harness = createHarness()
    harness.setPtyId('remote:env-1@@pty-1')
    harness.setRestorePtyId('remote:env-1@@pty-1')
    harness.bindRuntime()

    harness.controller.sync()
    expect(harness.setOutputPaused).toHaveBeenCalledWith(true)
    expect(harness.registerModelRestore).not.toHaveBeenCalled()

    harness.controller.handleRemoteOutputPauseChanged(true, true)
    expect(harness.registerSideEffectFacts).toHaveBeenCalledWith('remote:env-1@@pty-1', true)
    expect(harness.markRestoreNeeded).toHaveBeenCalledTimes(1)

    harness.controller.handleRemoteOutputPauseChanged(false, true)
    expect(harness.dropSideEffectFacts).toHaveBeenCalledTimes(1)
    expect(harness.requestRestore).toHaveBeenCalledTimes(1)
  })

  it('releases remote, local-claim, and model-subscription state idempotently', () => {
    const harness = createHarness()
    harness.bindRuntime()
    harness.controller.sync()
    const releaseClaim = harness.acquireHiddenClaim.mock.results[0]?.value
    const unregisterModel = harness.registerModelRestore.mock.results[0]?.value

    harness.controller.release()
    harness.controller.release()

    expect(releaseClaim).toHaveBeenCalledTimes(1)
    expect(unregisterModel).toHaveBeenCalledTimes(1)
    expect(harness.setOutputPaused).toHaveBeenCalledTimes(2)
    expect(harness.setOutputPaused).toHaveBeenLastCalledWith(false)
  })
})
