import type { TerminalStructuralReplayCoordinator } from '@/lib/pane-manager/terminal-structural-replay-coordinator'
import {
  POST_REPLAY_LIVE_AGENT_SNAPSHOT_RESET,
  POST_REPLAY_LIVE_SNAPSHOT_RESET
} from './layout-serialization'
import type { PtyBufferSnapshot } from './pty-transport-types'
import type { createPtyConnectionHiddenRestoreScrollTicketController } from './pty-connection-hidden-restore-scroll-ticket-controller'
import {
  buildMainModelSnapshotReplayWrites,
  hasPositiveTerminalDimensions
} from './terminal-snapshot-replay-paint'

type HiddenRestoreSnapshotReplayTerminal = {
  cols: number
  rows: number
  resize: (cols: number, rows: number) => void
}

type HiddenRestoreSnapshotReplayFit = {
  completion: Promise<unknown>
}

type HiddenRestoreSnapshotReplayControllerOptions<TFit extends HiddenRestoreSnapshotReplayFit> = {
  terminal: HiddenRestoreSnapshotReplayTerminal
  isDisposed: () => boolean
  getPtyId: () => string | null
  getRestoreGeneration: () => number
  scrollTickets: ReturnType<typeof createPtyConnectionHiddenRestoreScrollTicketController>
  cancelCurrentScrollRestore: () => void
  runStructuralReplay: TerminalStructuralReplayCoordinator['run']
  beginReplayBaseline: (snapshot: PtyBufferSnapshot) => void
  discardOutput: () => void
  runStructuralResize: (operation: () => void) => void
  writeReplayData: (data: string) => void
  shouldUseLiveAgentReset: () => boolean
  markRendererQueriesClean: () => void
  recordRendererOrderedSeq: (snapshot: PtyBufferSnapshot) => void
  resetRenderRisk: () => void
  recordOutput: () => void
  waitForReplayWritesParsed: () => Promise<void>
  hasFitOverride: (ptyId: string) => boolean
  startFit: (ptyId: string, shouldContinue: () => boolean, onFitted: () => void) => TFit
  setPendingFit: (fit: TFit) => void
  clearPendingFitIf: (fit: TFit) => void
  isRendererPtyResizeAuthoritative: () => boolean
  resizePty: (cols: number, rows: number) => void
  shouldSignalSigwinch: (ptyId: string) => boolean
  signalSigwinch: (ptyId: string) => void
  scheduleIdleCursorReset: () => void
}

export function createPtyConnectionHiddenRestoreSnapshotReplayController<
  TFit extends HiddenRestoreSnapshotReplayFit
>(options: HiddenRestoreSnapshotReplayControllerOptions<TFit>) {
  return {
    async apply(snapshot: PtyBufferSnapshot): Promise<void> {
      const restorePtyId = options.getPtyId()
      const restoreGeneration = options.getRestoreGeneration()
      if (options.scrollTickets.hasCurrent()) {
        options.cancelCurrentScrollRestore()
      }
      const scrollRestore = options.scrollTickets.begin(restorePtyId, restoreGeneration)
      const colsBeforeReplay = options.terminal.cols
      const rowsBeforeReplay = options.terminal.rows
      const hasSnapshotDimensions = hasPositiveTerminalDimensions(snapshot.cols, snapshot.rows)
      const isCurrentRestore = (): boolean =>
        !options.isDisposed() &&
        options.scrollTickets.isCurrent(
          scrollRestore,
          options.getPtyId(),
          options.getRestoreGeneration()
        )

      try {
        await options.runStructuralReplay(
          async () => {
            if (!isCurrentRestore()) {
              return
            }
            options.scrollTickets.markStarted(scrollRestore)
            options.beginReplayBaseline(snapshot)
            options.discardOutput()
            if (
              hasSnapshotDimensions &&
              (options.terminal.cols !== snapshot.cols || options.terminal.rows !== snapshot.rows)
            ) {
              options.runStructuralResize(() => {
                options.terminal.resize(snapshot.cols, snapshot.rows)
              })
            }
            for (const replayChunk of buildMainModelSnapshotReplayWrites(snapshot)) {
              options.writeReplayData(replayChunk)
            }
            options.writeReplayData(
              options.shouldUseLiveAgentReset()
                ? POST_REPLAY_LIVE_AGENT_SNAPSHOT_RESET
                : POST_REPLAY_LIVE_SNAPSHOT_RESET
            )
            if (snapshot.pendingEscapeTailAnsi) {
              options.writeReplayData(snapshot.pendingEscapeTailAnsi)
            }
            options.markRendererQueriesClean()
            options.recordRendererOrderedSeq(snapshot)
            options.resetRenderRisk()
            options.recordOutput()
            await options.waitForReplayWritesParsed()
          },
          {
            shouldRestore: isCurrentRestore,
            afterRestore: async () => {
              if (!isCurrentRestore()) {
                return
              }
              const currentPtyId = options.getPtyId()
              if (!currentPtyId || options.hasFitOverride(currentPtyId)) {
                return
              }
              const fit = options.startFit(currentPtyId, isCurrentRestore, () => {
                if (!isCurrentRestore() || options.getPtyId() !== currentPtyId) {
                  return
                }
                const replayChangedDimensions = hasSnapshotDimensions
                  ? options.terminal.cols !== snapshot.cols ||
                    options.terminal.rows !== snapshot.rows
                  : options.terminal.cols !== colsBeforeReplay ||
                    options.terminal.rows !== rowsBeforeReplay
                if (replayChangedDimensions && options.isRendererPtyResizeAuthoritative()) {
                  options.resizePty(options.terminal.cols, options.terminal.rows)
                  if (options.shouldSignalSigwinch(currentPtyId)) {
                    options.signalSigwinch(currentPtyId)
                  }
                }
              })
              options.setPendingFit(fit)
              try {
                await fit.completion
              } finally {
                options.clearPendingFitIf(fit)
              }
              if (isCurrentRestore()) {
                options.scheduleIdleCursorReset()
              }
            }
          }
        )
      } finally {
        options.scrollTickets.clearIf(scrollRestore)
      }
    }
  }
}
