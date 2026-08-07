import type { HiddenRestorePendingLiveChunk } from './pty-connection-hidden-restore-pending-live-controller'
import type { PtyBufferSnapshot } from './pty-transport-types'

type HiddenRestoreAbandonOptions = {
  quiet?: boolean
}

type HiddenRestoreAbandonControllerOptions = {
  getCurrentPtyId: () => string | null
  getRestorePtyId: () => string | null
  resetIfPtyChanged: () => void
  takeReplayBaseline: () => PtyBufferSnapshot | null
  takePendingForAbandonReplay: (snapshotSeq: number | null) => {
    chunks: HiddenRestorePendingLiveChunk[]
    data: string
    overflow: boolean
  }
  invalidateRestore: () => number
  handoffScrollGeneration: (ptyId: string, generation: number) => void
  abandonTask: () => void
  resetFreshness: () => void
  resetRendererQueries: () => void
  resetRenderRisk: () => void
  cancelScheduled: () => void
  resetDeferredRetry: () => void
  clearForegroundDeadline: () => void
  writeUnavailableWarning: () => void
  setReconciliationBaseline: (ptyId: string, snapshot: PtyBufferSnapshot) => void
  advanceExpectedSeq: (seq: number) => void
  writePendingData: (data: string) => void
}

export function createPtyConnectionHiddenRestoreAbandonController(
  options: HiddenRestoreAbandonControllerOptions
) {
  return {
    abandon(expectedPtyId: string, abandonOptions: HiddenRestoreAbandonOptions = {}): void {
      if (
        options.getCurrentPtyId() !== expectedPtyId ||
        options.getRestorePtyId() !== expectedPtyId
      ) {
        options.resetIfPtyChanged()
        return
      }

      const replayingSnapshot = options.takeReplayBaseline()
      const replayedSeq = typeof replayingSnapshot?.seq === 'number' ? replayingSnapshot.seq : null
      const { chunks, data, overflow } = options.takePendingForAbandonReplay(replayedSeq)
      const nextRestoreGeneration = options.invalidateRestore()
      options.handoffScrollGeneration(expectedPtyId, nextRestoreGeneration)
      options.abandonTask()
      options.resetFreshness()
      options.resetRendererQueries()
      options.resetRenderRisk()
      options.cancelScheduled()
      options.resetDeferredRetry()
      options.clearForegroundDeadline()

      if (!abandonOptions.quiet) {
        options.writeUnavailableWarning()
      }
      if (overflow) {
        return
      }
      if (replayingSnapshot && replayedSeq !== null) {
        options.setReconciliationBaseline(expectedPtyId, replayingSnapshot)
        for (const chunk of chunks) {
          if (typeof chunk.seq === 'number') {
            options.advanceExpectedSeq(chunk.seq)
          }
        }
      }
      if (data) {
        options.writePendingData(data)
      }
    }
  }
}
