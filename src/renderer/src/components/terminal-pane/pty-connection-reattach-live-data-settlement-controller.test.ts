import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionReattachLiveDataSettlementController } from './pty-connection-reattach-live-data-settlement-controller'

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function createHarness() {
  let disposed = false
  let visible = true
  let ptyId: string | null = 'pty-1'
  let generation = 7
  const parsed = createDeferred()
  const finishLiveDataDeferral = vi.fn(
    (_deliver: boolean, _acceptedGeneration: number) =>
      ({ deliveredChunks: 1, ptyId: 'pty-1', streamGeneration: 7 }) as const
  )
  const flushTerminalOutput = vi.fn()
  const enforceScrollIntent = vi.fn()
  const controller = createPtyConnectionReattachLiveDataSettlementController({
    finishLiveDataDeferral,
    flushTerminalOutput,
    waitForReplayWritesParsed: () => parsed.promise,
    isDisposed: () => disposed,
    isVisible: () => visible,
    getPtyId: () => ptyId,
    isGenerationCurrent: (expected) => generation === expected,
    enforceScrollIntent
  })

  return {
    controller,
    parsed,
    finishLiveDataDeferral,
    flushTerminalOutput,
    enforceScrollIntent,
    setSettlement(
      settlement: { deliveredChunks: number; ptyId: string | null; streamGeneration: number } | null
    ) {
      finishLiveDataDeferral.mockReturnValue(settlement as never)
    },
    setDisposed(value: boolean) {
      disposed = value
    },
    setVisible(value: boolean) {
      visible = value
    },
    setPtyId(value: string | null) {
      ptyId = value
    },
    setGeneration(value: number) {
      generation = value
    }
  }
}

describe('createPtyConnectionReattachLiveDataSettlementController', () => {
  it('does nothing when finishing produces no delivered live data', () => {
    const state = createHarness()
    state.setSettlement(null)

    state.controller.finish(true, 7)

    expect(state.finishLiveDataDeferral).toHaveBeenCalledWith(true, 7)
    expect(state.flushTerminalOutput).not.toHaveBeenCalled()
    expect(state.enforceScrollIntent).not.toHaveBeenCalled()

    state.setSettlement({ deliveredChunks: 0, ptyId: 'pty-1', streamGeneration: 7 })
    state.controller.finish(true, 7)
    expect(state.flushTerminalOutput).not.toHaveBeenCalled()
  })

  it('flushes delivered live data before waiting for parse and then enforces scroll intent', async () => {
    const state = createHarness()

    state.controller.finish(true, 7)

    expect(state.flushTerminalOutput).toHaveBeenCalledOnce()
    expect(state.enforceScrollIntent).not.toHaveBeenCalled()
    state.parsed.resolve()
    await Promise.resolve()

    expect(state.enforceScrollIntent).toHaveBeenCalledOnce()
  })

  it.each([
    ['disposed', (state: ReturnType<typeof createHarness>) => state.setDisposed(true)],
    ['hidden', (state: ReturnType<typeof createHarness>) => state.setVisible(false)],
    ['PTY replaced', (state: ReturnType<typeof createHarness>) => state.setPtyId('pty-2')],
    ['generation replaced', (state: ReturnType<typeof createHarness>) => state.setGeneration(8)]
  ])(
    'suppresses scroll intent when authority becomes %s while parsing',
    async (_label, invalidate) => {
      const state = createHarness()

      state.controller.finish(true, 7)
      invalidate(state)
      state.parsed.resolve()
      await Promise.resolve()

      expect(state.flushTerminalOutput).toHaveBeenCalledOnce()
      expect(state.enforceScrollIntent).not.toHaveBeenCalled()
    }
  )
})
