import { describe, expect, it, vi } from 'vitest'
import type { ColdRestoreAgentResumeStartup } from './pty-connection-e2e-support'
import { POST_REPLAY_MODE_RESET } from './layout-serialization'
import { createPtyConnectionReattachPayloadController } from './pty-connection-reattach-payload-controller'
import { buildMainModelSnapshotReplayWrites } from './terminal-snapshot-replay-paint'
import type { PtyBufferSnapshot, PtyConnectResult } from './pty-transport-types'

function createHarness() {
  const terminal = {
    cols: 80,
    rows: 24,
    resize: vi.fn((cols: number, rows: number) => {
      terminal.cols = cols
      terminal.rows = rows
    })
  }
  const writes: string[] = []
  const startup = { hasSleepingRecord: true } as ColdRestoreAgentResumeStartup
  const runStructuralResize = vi.fn((operation: () => void) => operation())
  const waitForReplayWritesParsed = vi.fn(async () => {})
  const rememberPayloadAgentSignal = vi.fn()
  const scanReplayKeyboardModes = vi.fn()
  const resetKeyboardModes = vi.fn()
  const sendFocusedReattachFocusIn = vi.fn()
  const ackColdRestore = vi.fn()
  const setReconciliationBaseline = vi.fn()
  const recordRendererOrderedSeq = vi.fn()
  const buildColdRestoreStartup = vi.fn(() => startup)
  const applyColdRestoreStartup = vi.fn(() => true)
  const showSessionRestoredBanner = vi.fn()
  const clearSleepingRecordAfterColdRestoreSpawn = vi.fn()
  const prepareFreshShellViewport = vi.fn()
  const schedulePendingStartupCommandDelivery = vi.fn()

  const controller = createPtyConnectionReattachPayloadController({
    terminal,
    isCurrent: () => true,
    runStructuralResize,
    proposeDestinationRows: () => 50,
    writeReplayData: (data) => writes.push(data),
    waitForReplayWritesParsed,
    rememberPayloadAgentSignal,
    scanReplayKeyboardModes,
    resetKeyboardModes,
    buildReplayResetSequence: (data) => `reset:${data}`,
    sendFocusedReattachFocusIn,
    isRemoteRuntimePtyId: (ptyId) => ptyId.startsWith('remote:'),
    ackColdRestore,
    setReconciliationBaseline,
    recordRendererOrderedSeq,
    buildColdRestoreStartup,
    applyColdRestoreStartup,
    showSessionRestoredBanner,
    clearSleepingRecordAfterColdRestoreSpawn,
    prepareFreshShellViewport,
    schedulePendingStartupCommandDelivery
  })

  return {
    controller,
    terminal,
    writes,
    startup,
    runStructuralResize,
    waitForReplayWritesParsed,
    rememberPayloadAgentSignal,
    scanReplayKeyboardModes,
    resetKeyboardModes,
    sendFocusedReattachFocusIn,
    ackColdRestore,
    setReconciliationBaseline,
    recordRendererOrderedSeq,
    buildColdRestoreStartup,
    applyColdRestoreStartup,
    showSessionRestoredBanner,
    clearSleepingRecordAfterColdRestoreSpawn,
    prepareFreshShellViewport,
    schedulePendingStartupCommandDelivery
  }
}

describe('createPtyConnectionReattachPayloadController', () => {
  it('gives daemon snapshots strict precedence over replay, model, and cold restore payloads', async () => {
    const state = createHarness()
    const modelSnapshot = { data: 'model', cols: 70, rows: 20 } satisfies PtyBufferSnapshot
    const connectResult = {
      id: 'pty-1',
      snapshot: 'snapshot',
      snapshotCols: 100,
      snapshotRows: 40,
      replay: 'relay',
      coldRestore: { scrollback: 'cold', cwd: '/repo' },
      pendingEscapeTailAnsi: '\x1b['
    } satisfies PtyConnectResult

    await expect(
      state.controller.apply({
        ptyId: 'pty-1',
        attemptGeneration: 7,
        connectResult,
        modelSnapshot,
        coldRestoreStartup: null
      })
    ).resolves.toBeUndefined()

    expect(state.runStructuralResize).toHaveBeenCalledOnce()
    expect(state.terminal.resize).toHaveBeenCalledWith(100, 40)
    expect(state.writes).toEqual(['\x1b[2J\x1b[3J\x1b[H', 'snapshot', 'reset:snapshot', '\x1b['])
    expect(state.rememberPayloadAgentSignal).toHaveBeenCalledWith('snapshot', {
      fullScreenReplay: true
    })
    expect(state.scanReplayKeyboardModes).toHaveBeenCalledWith('snapshot')
    expect(state.setReconciliationBaseline).not.toHaveBeenCalled()
    expect(state.buildColdRestoreStartup).not.toHaveBeenCalled()
    expect(state.sendFocusedReattachFocusIn).toHaveBeenCalledWith('pty-1', 7)
    expect(state.ackColdRestore).toHaveBeenCalledWith('pty-1')
    expect(state.waitForReplayWritesParsed).toHaveBeenCalledOnce()
  })

  it('paints a selected park model snapshot before the relay replay and seeds its sequence baseline', async () => {
    const state = createHarness()
    const modelSnapshot = {
      data: 'alternate',
      scrollbackAnsi: 'history',
      alternateScreen: true,
      pendingEscapeTailAnsi: '\x1b]0;',
      cols: 120,
      rows: 36,
      seq: 44
    } satisfies PtyBufferSnapshot
    const connectResult = {
      id: 'pty-2',
      replay: 'relay',
      coldRestore: { scrollback: 'cold', cwd: '/repo' }
    } satisfies PtyConnectResult

    await expect(
      state.controller.apply({
        ptyId: 'pty-2',
        attemptGeneration: 8,
        connectResult,
        modelSnapshot,
        coldRestoreStartup: null
      })
    ).resolves.toBeUndefined()

    const modelData = 'historyalternate'
    expect(state.writes).toEqual([
      ...buildMainModelSnapshotReplayWrites(modelSnapshot),
      `reset:${modelData}`,
      '\x1b]0;'
    ])
    expect(state.rememberPayloadAgentSignal).toHaveBeenCalledWith(modelData, {
      fullScreenReplay: true
    })
    expect(state.scanReplayKeyboardModes).toHaveBeenCalledWith(modelData)
    expect(state.setReconciliationBaseline).toHaveBeenCalledWith('pty-2', modelSnapshot)
    expect(state.recordRendererOrderedSeq).toHaveBeenCalledWith(modelSnapshot)
    expect(state.ackColdRestore).toHaveBeenCalledWith('pty-2')
  })

  it('falls back to raw relay replay when no park model snapshot was selected', async () => {
    const state = createHarness()
    const connectResult = {
      id: 'pty-3',
      replay: 'relay',
      coldRestore: { scrollback: 'cold', cwd: '/repo' }
    } satisfies PtyConnectResult

    await expect(
      state.controller.apply({
        ptyId: 'pty-3',
        attemptGeneration: 9,
        connectResult,
        modelSnapshot: null,
        coldRestoreStartup: null
      })
    ).resolves.toBeUndefined()

    expect(state.writes).toEqual(['\x1b[2J\x1b[3J\x1b[H', 'relay', 'reset:relay'])
    expect(state.setReconciliationBaseline).not.toHaveBeenCalled()
    expect(state.recordRendererOrderedSeq).not.toHaveBeenCalled()
    expect(state.buildColdRestoreStartup).not.toHaveBeenCalled()
    expect(state.ackColdRestore).toHaveBeenCalledWith('pty-3')
  })

  it('restores cold scrollback at its source grid, prepares resume, blanks the destination, and acks', async () => {
    const state = createHarness()
    const connectResult = {
      id: 'pty-4',
      coldRestore: { scrollback: 'cold history', cwd: '/repo', cols: 90, rows: 30 },
      agentResumeUnavailable: true
    } satisfies PtyConnectResult

    await expect(
      state.controller.apply({
        ptyId: 'pty-4',
        attemptGeneration: 10,
        connectResult,
        modelSnapshot: null,
        coldRestoreStartup: null
      })
    ).resolves.toBeUndefined()

    expect(state.writes).toEqual(['\x1b[2J\x1b[H', 'cold history', POST_REPLAY_MODE_RESET])
    expect(state.terminal.resize).toHaveBeenCalledWith(90, 30)
    expect(state.buildColdRestoreStartup).toHaveBeenCalledOnce()
    expect(state.applyColdRestoreStartup).toHaveBeenCalledWith(state.startup)
    expect(state.showSessionRestoredBanner).toHaveBeenCalledWith('resume-unavailable')
    expect(state.clearSleepingRecordAfterColdRestoreSpawn).toHaveBeenCalledWith(state.startup)
    expect(state.resetKeyboardModes).toHaveBeenCalledOnce()
    expect(state.prepareFreshShellViewport).toHaveBeenCalledWith(50)
    expect(state.ackColdRestore).toHaveBeenCalledWith('pty-4')
    expect(state.schedulePendingStartupCommandDelivery).toHaveBeenCalledOnce()
    expect(state.waitForReplayWritesParsed).toHaveBeenCalledTimes(2)
  })
})
