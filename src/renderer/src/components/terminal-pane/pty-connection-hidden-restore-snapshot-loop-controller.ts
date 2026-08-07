import type { PtyBufferSnapshot } from './pty-transport-types'

type HiddenRestoreDrainOutcome = 'drained' | 'overflow' | 'refetch'

type HiddenRestoreSnapshotLoopControllerOptions = {
  maxIterations: number
  isDisposed: () => boolean
  getRestorePtyId: () => string | null
  getCurrentPtyId: () => string | null
  getRestoreGeneration: () => number
  canUseSnapshot: (ptyId: string) => boolean
  clearRestoreState: () => void
  writeUnavailableWarning: () => void
  clearNeeded: () => void
  markNeeded: () => void
  serializeSnapshot: (ptyId: string) => Promise<PtyBufferSnapshot | null>
  resetFreshness: () => void
  scheduleDeferredRetry: () => void
  resetDeferredRetryAttempts: () => void
  applySnapshot: (snapshot: PtyBufferSnapshot) => Promise<void>
  setReconciliationBaseline: (ptyId: string, snapshot: PtyBufferSnapshot) => void
  clearReplayBaseline: () => void
  takeFreshSnapshotNeeded: () => boolean
  drainPendingLive: (snapshotSeq: number | undefined) => HiddenRestoreDrainOutcome
  isForeground: () => boolean
  completeRestore: () => void
  clearForegroundDeadline: () => void
  noteBackpressure: (ptyId: string) => void
  abandonAndDrain: (ptyId: string) => void
  warnIterationCap: (ptyId: string, reason: HiddenRestoreDrainOutcome) => void
}

export function createPtyConnectionHiddenRestoreSnapshotLoopController(
  options: HiddenRestoreSnapshotLoopControllerOptions
) {
  return {
    async run(): Promise<void> {
      let restoreIterations = 0
      while (!options.isDisposed()) {
        const currentPtyId = options.getRestorePtyId()
        if (currentPtyId === null) {
          options.clearRestoreState()
          return
        }
        if (!options.canUseSnapshot(currentPtyId)) {
          if (options.getRestorePtyId() === currentPtyId) {
            options.clearRestoreState()
          }
          options.writeUnavailableWarning()
          return
        }
        if (options.getCurrentPtyId() !== currentPtyId) {
          if (options.getRestorePtyId() === currentPtyId) {
            options.clearRestoreState()
          }
          return
        }

        const restoreGeneration = options.getRestoreGeneration()
        options.clearNeeded()
        let snapshot: PtyBufferSnapshot | null = null
        try {
          snapshot = await options.serializeSnapshot(currentPtyId)
        } catch {
          snapshot = null
        }
        if (options.isDisposed()) {
          return
        }

        const restoreGenerationChanged = options.getRestoreGeneration() !== restoreGeneration
        const restorePtyChanged =
          options.getCurrentPtyId() !== currentPtyId || options.getRestorePtyId() !== currentPtyId
        if (restoreGenerationChanged || restorePtyChanged) {
          if (restorePtyChanged && options.getRestorePtyId() === currentPtyId) {
            options.clearRestoreState()
          }
          return
        }
        if (!snapshot) {
          options.markNeeded()
          options.resetFreshness()
          options.scheduleDeferredRetry()
          return
        }

        options.resetDeferredRetryAttempts()
        restoreIterations += 1
        await options.applySnapshot(snapshot)
        if (
          options.isDisposed() ||
          options.getRestoreGeneration() !== restoreGeneration ||
          options.getRestorePtyId() !== currentPtyId ||
          options.getCurrentPtyId() !== currentPtyId
        ) {
          return
        }

        options.setReconciliationBaseline(currentPtyId, snapshot)
        options.clearReplayBaseline()
        const needsFreshSnapshot = options.takeFreshSnapshotNeeded()
        const drainOutcome = options.drainPendingLive(snapshot.seq)
        if (drainOutcome === 'drained' && !needsFreshSnapshot) {
          options.completeRestore()
          options.clearForegroundDeadline()
          return
        }
        if (!options.isForeground()) {
          options.markNeeded()
          return
        }
        if (drainOutcome === 'overflow') {
          options.noteBackpressure(currentPtyId)
          options.abandonAndDrain(currentPtyId)
          return
        }
        if (restoreIterations >= options.maxIterations) {
          options.warnIterationCap(currentPtyId, drainOutcome)
          options.noteBackpressure(currentPtyId)
          options.abandonAndDrain(currentPtyId)
          return
        }
        options.markNeeded()
      }
    }
  }
}
