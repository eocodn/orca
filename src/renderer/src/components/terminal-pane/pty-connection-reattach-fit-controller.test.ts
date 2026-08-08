import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionReattachFitController } from './pty-connection-reattach-fit-controller'

type FitHandle = {
  completion: Promise<boolean>
}

function createHarness(
  overrides: {
    remote?: boolean
    fitOverride?: boolean
    visible?: boolean
    current?: boolean
    completion?: Promise<boolean>
  } = {}
) {
  const terminal = { cols: 120, rows: 36 }
  let ptyId: string | null = 'pty-1'
  const transportResize = vi.fn()
  const signal = vi.fn()
  const requestSizeReassertion = vi.fn()
  const fitHandle: FitHandle = { completion: overrides.completion ?? Promise.resolve(true) }
  let fitContinuation: (() => void) | null = null
  const startFit = vi.fn((_reason: 'reattach-pty-resize', continuation: () => void) => {
    fitContinuation = continuation
    return fitHandle
  })
  const setPendingFit = vi.fn()
  const clearPendingFitIf = vi.fn()
  const current = vi.fn(() => overrides.current ?? true)

  const controller = createPtyConnectionReattachFitController({
    terminal,
    isCurrent: current,
    getPtyId: () => ptyId,
    hasFitOverride: () => overrides.fitOverride ?? false,
    isRemoteRuntimePtyId: () => overrides.remote ?? false,
    startFit,
    setPendingFit,
    clearPendingFitIf,
    resizePty: transportResize,
    signalPty: signal,
    isVisible: () => overrides.visible ?? true,
    requestSizeReassertion
  })

  return {
    controller,
    terminal,
    fitHandle,
    startFit,
    setPendingFit,
    clearPendingFitIf,
    transportResize,
    signal,
    requestSizeReassertion,
    runFitContinuation: () => fitContinuation?.(),
    setPtyId: (next: string | null) => {
      ptyId = next
    }
  }
}

describe('createPtyConnectionReattachFitController', () => {
  it('tracks a fit, resizes the bound PTY, signals local SIGWINCH, and reasserts after success', async () => {
    const state = createHarness()

    const fitting = state.controller.fit()
    expect(state.setPendingFit).toHaveBeenCalledWith(state.fitHandle)
    state.runFitContinuation()
    await fitting

    expect(state.transportResize).toHaveBeenCalledWith('pty-1', 120, 36)
    expect(state.signal).toHaveBeenCalledWith('pty-1', 'SIGWINCH')
    expect(state.clearPendingFitIf).toHaveBeenCalledWith(state.fitHandle)
    expect(state.requestSizeReassertion).toHaveBeenCalledOnce()
  })

  it('suppresses fit continuation side effects after the transport rebinds', async () => {
    const state = createHarness()

    const fitting = state.controller.fit()
    state.setPtyId('pty-2')
    state.runFitContinuation()
    await fitting

    expect(state.transportResize).not.toHaveBeenCalled()
    expect(state.signal).not.toHaveBeenCalled()
  })

  it('uses local SIGWINCH only when a fit override owns dimensions', async () => {
    const state = createHarness({ fitOverride: true })

    await state.controller.fit()

    expect(state.startFit).not.toHaveBeenCalled()
    expect(state.transportResize).not.toHaveBeenCalled()
    expect(state.signal).toHaveBeenCalledWith('pty-1', 'SIGWINCH')
    expect(state.requestSizeReassertion).not.toHaveBeenCalled()
  })

  it('never sends SIGWINCH for remote runtime PTYs', async () => {
    const state = createHarness({ remote: true })

    const fitting = state.controller.fit()
    state.runFitContinuation()
    await fitting

    expect(state.transportResize).toHaveBeenCalledWith('pty-1', 120, 36)
    expect(state.signal).not.toHaveBeenCalled()
  })

  it('does not request a size reassert when fitting does not complete', async () => {
    const state = createHarness({ completion: Promise.resolve(false) })

    const fitting = state.controller.fit()
    state.runFitContinuation()
    await fitting

    expect(state.clearPendingFitIf).toHaveBeenCalledWith(state.fitHandle)
    expect(state.requestSizeReassertion).not.toHaveBeenCalled()
  })
})
