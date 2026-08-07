import { describe, expect, it, vi } from 'vitest'
import {
  POST_REPLAY_LIVE_AGENT_SNAPSHOT_RESET,
  POST_REPLAY_LIVE_SNAPSHOT_RESET
} from './layout-serialization'
import { createPtyConnectionHiddenRestoreScrollTicketController } from './pty-connection-hidden-restore-scroll-ticket-controller'
import { createPtyConnectionHiddenRestoreSnapshotReplayController } from './pty-connection-hidden-restore-snapshot-replay-controller'

function createHarness() {
  let ptyId: string | null = 'pty-1'
  let generation = 7
  let disposed = false
  let fitOverride = false
  let useLiveAgentReset = false
  let resizeAuthoritative = true
  let signalLocalPty = true
  const terminal = {
    cols: 80,
    rows: 24,
    resize: vi.fn((cols: number, rows: number) => {
      terminal.cols = cols
      terminal.rows = rows
    })
  }
  const scrollTickets = createPtyConnectionHiddenRestoreScrollTicketController()
  const cancelCurrentScrollRestore = vi.fn(() => {
    scrollTickets.invalidateCurrent()
  })
  const beginReplayBaseline = vi.fn()
  const discardOutput = vi.fn()
  const runStructuralResize = vi.fn((operation: () => void) => operation())
  const writeReplayData = vi.fn()
  const markRendererQueriesClean = vi.fn()
  const recordRendererOrderedSeq = vi.fn()
  const resetRenderRisk = vi.fn()
  const recordOutput = vi.fn()
  const waitForReplayWritesParsed = vi.fn(async () => undefined)
  const resizePty = vi.fn()
  const signalSigwinch = vi.fn()
  const scheduleIdleCursorReset = vi.fn()
  const pendingFits: object[] = []
  const setPendingFit = vi.fn((fit: object) => pendingFits.push(fit))
  const clearPendingFitIf = vi.fn((fit: object) => {
    const index = pendingFits.indexOf(fit)
    if (index >= 0) {
      pendingFits.splice(index, 1)
    }
  })
  const startFit = vi.fn((_ptyId: string, shouldContinue: () => boolean, onFitted: () => void) => {
    if (shouldContinue()) {
      onFitted()
    }
    return { completion: Promise.resolve(true) }
  })
  const runStructuralReplay = vi.fn(
    async (
      operation: () => void | Promise<void>,
      options: { shouldRestore: () => boolean; afterRestore: () => void | Promise<void> }
    ) => {
      await operation()
      if (options.shouldRestore()) {
        await options.afterRestore()
      }
    }
  )

  const controller = createPtyConnectionHiddenRestoreSnapshotReplayController({
    terminal,
    isDisposed: () => disposed,
    getPtyId: () => ptyId,
    getRestoreGeneration: () => generation,
    scrollTickets,
    cancelCurrentScrollRestore,
    runStructuralReplay,
    beginReplayBaseline,
    discardOutput,
    runStructuralResize,
    writeReplayData,
    shouldUseLiveAgentReset: () => useLiveAgentReset,
    markRendererQueriesClean,
    recordRendererOrderedSeq,
    resetRenderRisk,
    recordOutput,
    waitForReplayWritesParsed,
    hasFitOverride: () => fitOverride,
    startFit,
    setPendingFit,
    clearPendingFitIf,
    isRendererPtyResizeAuthoritative: () => resizeAuthoritative,
    resizePty,
    shouldSignalSigwinch: () => signalLocalPty,
    signalSigwinch,
    scheduleIdleCursorReset
  })

  return {
    controller,
    terminal,
    scrollTickets,
    cancelCurrentScrollRestore,
    beginReplayBaseline,
    discardOutput,
    runStructuralResize,
    writeReplayData,
    markRendererQueriesClean,
    recordRendererOrderedSeq,
    resetRenderRisk,
    recordOutput,
    waitForReplayWritesParsed,
    resizePty,
    signalSigwinch,
    scheduleIdleCursorReset,
    setPendingFit,
    clearPendingFitIf,
    startFit,
    runStructuralReplay,
    setPtyId(value: string | null) {
      ptyId = value
    },
    setGeneration(value: number) {
      generation = value
    },
    setDisposed(value: boolean) {
      disposed = value
    },
    setFitOverride(value: boolean) {
      fitOverride = value
    },
    setUseLiveAgentReset(value: boolean) {
      useLiveAgentReset = value
    },
    setResizeAuthoritative(value: boolean) {
      resizeAuthoritative = value
    },
    setSignalLocalPty(value: boolean) {
      signalLocalPty = value
    }
  }
}

describe('createPtyConnectionHiddenRestoreSnapshotReplayController', () => {
  it('paints a normal snapshot in order and finishes renderer state after parsing', async () => {
    const state = createHarness()
    const snapshot = {
      data: 'snapshot-data',
      cols: 80,
      rows: 24,
      seq: 42,
      pendingEscapeTailAnsi: '\x1b['
    }

    await state.controller.apply(snapshot)

    expect(state.beginReplayBaseline).toHaveBeenCalledWith(snapshot)
    expect(state.discardOutput).toHaveBeenCalledTimes(1)
    expect(state.writeReplayData.mock.calls.map(([data]) => data)).toEqual([
      '\x1b[2J\x1b[3J\x1b[H',
      'snapshot-data',
      POST_REPLAY_LIVE_SNAPSHOT_RESET,
      '\x1b['
    ])
    expect(state.markRendererQueriesClean).toHaveBeenCalledTimes(1)
    expect(state.recordRendererOrderedSeq).toHaveBeenCalledWith(snapshot)
    expect(state.resetRenderRisk).toHaveBeenCalledTimes(1)
    expect(state.recordOutput).toHaveBeenCalledTimes(1)
    expect(state.waitForReplayWritesParsed).toHaveBeenCalledTimes(1)
    expect(state.scrollTickets.hasCurrent()).toBe(false)
  })

  it('uses the live-agent reset when current agent state owns terminal modes', async () => {
    const state = createHarness()
    state.setUseLiveAgentReset(true)

    await state.controller.apply({ data: 'frame', cols: 80, rows: 24 })

    expect(state.writeReplayData).toHaveBeenCalledWith(POST_REPLAY_LIVE_AGENT_SNAPSHOT_RESET)
  })

  it('cancels a prior ticket and suppresses a stale replacement before painting', async () => {
    const state = createHarness()
    state.scrollTickets.begin('pty-old', 1)
    state.runStructuralReplay.mockImplementationOnce(async (operation) => {
      state.setPtyId('pty-2')
      await operation()
    })

    await state.controller.apply({ data: 'stale', cols: 80, rows: 24 })

    expect(state.cancelCurrentScrollRestore).toHaveBeenCalledTimes(1)
    expect(state.writeReplayData).not.toHaveBeenCalled()
    expect(state.startFit).not.toHaveBeenCalled()
    expect(state.scrollTickets.hasCurrent()).toBe(false)
  })

  it('holds snapshot dimensions through replay then fits and resizes the authoritative local PTY', async () => {
    const state = createHarness()
    state.startFit.mockImplementationOnce((_ptyId, shouldContinue, onFitted) => {
      if (shouldContinue()) {
        state.terminal.resize(120, 40)
        onFitted()
      }
      return { completion: Promise.resolve(true) }
    })

    await state.controller.apply({ data: 'frame', cols: 100, rows: 30, seq: 50 })

    expect(state.runStructuralResize).toHaveBeenCalledTimes(1)
    expect(state.terminal.resize).toHaveBeenCalledWith(100, 30)
    expect(state.startFit).toHaveBeenCalledWith('pty-1', expect.any(Function), expect.any(Function))
    expect(state.resizePty).toHaveBeenCalledWith(120, 40)
    expect(state.signalSigwinch).toHaveBeenCalledWith('pty-1')
    expect(state.setPendingFit).toHaveBeenCalledTimes(1)
    expect(state.clearPendingFitIf).toHaveBeenCalledTimes(1)
    expect(state.scheduleIdleCursorReset).toHaveBeenCalledTimes(1)
  })

  it('suppresses post-replay fit when authority turns stale while parsing', async () => {
    const state = createHarness()
    state.waitForReplayWritesParsed.mockImplementationOnce(async () => {
      state.setGeneration(8)
    })

    await state.controller.apply({ data: 'frame', cols: 80, rows: 24 })

    expect(state.writeReplayData).toHaveBeenCalled()
    expect(state.startFit).not.toHaveBeenCalled()
    expect(state.scheduleIdleCursorReset).not.toHaveBeenCalled()
  })

  it('skips fit when the PTY has a fit override', async () => {
    const state = createHarness()
    state.setFitOverride(true)

    await state.controller.apply({ data: 'frame', cols: 80, rows: 24 })

    expect(state.startFit).not.toHaveBeenCalled()
    expect(state.resizePty).not.toHaveBeenCalled()
  })
})
