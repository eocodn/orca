import { POST_REPLAY_MODE_RESET } from './layout-serialization'
import type { ColdRestoreAgentResumeStartup } from './pty-connection-e2e-support'
import {
  buildMainModelSnapshotReplayWrites,
  hasPositiveTerminalDimensions,
  resolvePositiveTerminalDimensions
} from './terminal-snapshot-replay-paint'
import type { PtyBufferSnapshot, PtyConnectResult } from './pty-transport-types'

type ReattachPayloadTerminal = {
  cols: number
  rows: number
  resize: (cols: number, rows: number) => void
}

type ReattachPayloadControllerOptions = {
  terminal: ReattachPayloadTerminal
  isCurrent: () => boolean
  runStructuralResize: (operation: () => void) => void
  proposeDestinationRows: () => number | null
  writeReplayData: (data: string) => void
  waitForReplayWritesParsed: () => Promise<void>
  rememberPayloadAgentSignal: (data: string, options: { fullScreenReplay: boolean }) => void
  scanReplayKeyboardModes: (data: string) => void
  resetKeyboardModes: () => void
  buildReplayResetSequence: (data: string) => string
  sendFocusedReattachFocusIn: (ptyId: string, attemptGeneration: number) => void
  isRemoteRuntimePtyId: (ptyId: string) => boolean
  ackColdRestore: (ptyId: string) => void
  setReconciliationBaseline: (ptyId: string, snapshot: PtyBufferSnapshot) => void
  recordRendererOrderedSeq: (snapshot: PtyBufferSnapshot) => void
  buildColdRestoreStartup: () => ColdRestoreAgentResumeStartup | null
  applyColdRestoreStartup: (startup: ColdRestoreAgentResumeStartup | null) => boolean
  showSessionRestoredBanner: (reason?: 'restored' | 'resume-unavailable') => void
  clearSleepingRecordAfterColdRestoreSpawn: (startup: ColdRestoreAgentResumeStartup | null) => void
  prepareFreshShellViewport: (rows: number) => void
  schedulePendingStartupCommandDelivery: () => void
}

type ReattachPayloadApplyArgs = {
  ptyId: string
  attemptGeneration: number
  connectResult: PtyConnectResult | null
  modelSnapshot: PtyBufferSnapshot | null
  coldRestoreStartup?: ColdRestoreAgentResumeStartup | null
}

export function createPtyConnectionReattachPayloadController(
  options: ReattachPayloadControllerOptions
) {
  const resizeTo = (cols: unknown, rows: unknown): void => {
    const dimensions = resolvePositiveTerminalDimensions(cols, rows)
    if (
      !dimensions ||
      (options.terminal.cols === dimensions.cols && options.terminal.rows === dimensions.rows)
    ) {
      return
    }
    options.runStructuralResize(() => {
      options.terminal.resize(dimensions.cols, dimensions.rows)
    })
  }

  const ackColdRestoreIfLocal = (ptyId: string, connectResult: PtyConnectResult | null): void => {
    if (connectResult?.coldRestore && !options.isRemoteRuntimePtyId(ptyId)) {
      options.ackColdRestore(ptyId)
    }
  }

  const finishPayload = async (): Promise<void> => {
    await options.waitForReplayWritesParsed()
  }

  const applyDaemonSnapshot = (args: ReattachPayloadApplyArgs, snapshot: string): Promise<void> => {
    options.rememberPayloadAgentSignal(snapshot, { fullScreenReplay: true })
    resizeTo(args.connectResult?.snapshotCols, args.connectResult?.snapshotRows)
    options.writeReplayData('\x1b[2J\x1b[3J\x1b[H')
    options.scanReplayKeyboardModes(snapshot)
    options.writeReplayData(snapshot)
    options.writeReplayData(options.buildReplayResetSequence(snapshot))
    if (args.connectResult?.pendingEscapeTailAnsi) {
      options.writeReplayData(args.connectResult.pendingEscapeTailAnsi)
    }
    options.sendFocusedReattachFocusIn(args.ptyId, args.attemptGeneration)
    ackColdRestoreIfLocal(args.ptyId, args.connectResult)
    return finishPayload()
  }

  const applyModelSnapshot = (
    args: ReattachPayloadApplyArgs,
    snapshot: PtyBufferSnapshot
  ): Promise<void> => {
    const modelData = `${snapshot.scrollbackAnsi ?? ''}${snapshot.data}`
    options.rememberPayloadAgentSignal(modelData, { fullScreenReplay: true })
    if (
      hasPositiveTerminalDimensions(snapshot.cols, snapshot.rows) &&
      (options.terminal.cols !== snapshot.cols || options.terminal.rows !== snapshot.rows)
    ) {
      options.runStructuralResize(() => {
        options.terminal.resize(snapshot.cols, snapshot.rows)
      })
    }
    options.scanReplayKeyboardModes(modelData)
    for (const replayChunk of buildMainModelSnapshotReplayWrites(snapshot)) {
      options.writeReplayData(replayChunk)
    }
    options.writeReplayData(options.buildReplayResetSequence(modelData))
    if (snapshot.pendingEscapeTailAnsi) {
      options.writeReplayData(snapshot.pendingEscapeTailAnsi)
    }
    options.setReconciliationBaseline(args.ptyId, snapshot)
    options.recordRendererOrderedSeq(snapshot)
    options.sendFocusedReattachFocusIn(args.ptyId, args.attemptGeneration)
    ackColdRestoreIfLocal(args.ptyId, args.connectResult)
    return finishPayload()
  }

  const applyRelayReplay = (args: ReattachPayloadApplyArgs, replay: string): Promise<void> => {
    options.rememberPayloadAgentSignal(replay, { fullScreenReplay: true })
    options.writeReplayData('\x1b[2J\x1b[3J\x1b[H')
    options.scanReplayKeyboardModes(replay)
    options.writeReplayData(replay)
    options.writeReplayData(options.buildReplayResetSequence(replay))
    options.sendFocusedReattachFocusIn(args.ptyId, args.attemptGeneration)
    ackColdRestoreIfLocal(args.ptyId, args.connectResult)
    return finishPayload()
  }

  const applyColdRestore = async (args: ReattachPayloadApplyArgs): Promise<void> => {
    const coldRestore = args.connectResult?.coldRestore
    if (!coldRestore) {
      return
    }
    let destinationRows = options.terminal.rows
    try {
      const proposedRows = options.proposeDestinationRows()
      if (proposedRows !== null && Number.isFinite(proposedRows) && proposedRows > 0) {
        destinationRows = Math.max(destinationRows, proposedRows)
      }
    } catch {
      // The current xterm grid remains a safe lower bound for blanking.
    }
    options.writeReplayData('\x1b[2J\x1b[H')
    await options.waitForReplayWritesParsed()
    if (!options.isCurrent()) {
      return
    }
    resizeTo(coldRestore.cols, coldRestore.rows)
    options.writeReplayData(coldRestore.scrollback)
    const preparedStartup = args.coldRestoreStartup ?? options.buildColdRestoreStartup()
    const didPrepareResume = options.applyColdRestoreStartup(preparedStartup)
    if (didPrepareResume) {
      if (args.connectResult?.agentResumeUnavailable) {
        options.showSessionRestoredBanner('resume-unavailable')
      } else if (preparedStartup?.hasSleepingRecord) {
        options.showSessionRestoredBanner()
      }
      options.clearSleepingRecordAfterColdRestoreSpawn(preparedStartup)
    }
    options.writeReplayData(POST_REPLAY_MODE_RESET)
    options.resetKeyboardModes()
    options.prepareFreshShellViewport(Math.max(destinationRows, options.terminal.rows))
    ackColdRestoreIfLocal(args.ptyId, args.connectResult)
    if (didPrepareResume && !args.coldRestoreStartup) {
      options.schedulePendingStartupCommandDelivery()
    }
    return finishPayload()
  }

  return {
    requiresStructuralReplay(
      connectResult: PtyConnectResult | null,
      modelSnapshot: PtyBufferSnapshot | null
    ): boolean {
      return Boolean(
        connectResult?.snapshot ||
        connectResult?.replay ||
        connectResult?.coldRestore ||
        modelSnapshot
      )
    },
    apply(args: ReattachPayloadApplyArgs): Promise<void> {
      if (!options.isCurrent()) {
        return Promise.resolve()
      }
      if (args.connectResult?.snapshot) {
        return applyDaemonSnapshot(args, args.connectResult.snapshot)
      }
      if (args.modelSnapshot) {
        return applyModelSnapshot(args, args.modelSnapshot)
      }
      if (args.connectResult?.replay) {
        return applyRelayReplay(args, args.connectResult.replay)
      }
      return args.connectResult?.coldRestore ? applyColdRestore(args) : Promise.resolve()
    }
  }
}
