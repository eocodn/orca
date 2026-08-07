type HiddenRestoreRequestOptions = {
  bypassScheduler?: boolean
}

type HiddenRestoreRequestControllerOptions = {
  isDisposed: () => boolean
  isWritePipelineCertifiedDead: () => boolean
  claimCertifiedDeadRecovery: () => boolean
  requestCertifiedDeadRecovery: () => void
  resetIfPtyChanged: () => void
  getRestorePtyId: () => string | null
  getCurrentPtyId: () => string | null
  isRestoreNeeded: () => boolean
  hasQueuedChunks: () => boolean
  canUseSnapshot: (ptyId: string | null) => boolean
  bindRestorePty: (ptyId: string) => void
  isTaskInFlight: () => boolean
  armForegroundDeadline: () => void
  isActiveSplitPane: () => boolean
  getRestoreGeneration: () => number
  scheduleInactive: (requestRestore: () => void) => boolean
  cancelScheduled: () => void
  isForeground: () => boolean
  clearDeferredRetry: () => void
  runRestoreTask: () => Promise<void>
  trackTask: (task: Promise<void>, onSettled: () => void) => Promise<void>
  hasPendingLive: () => boolean
  markRestoreNeeded: () => void
  isDeferredRetry: () => boolean
}

export function createPtyConnectionHiddenRestoreRequestController(
  options: HiddenRestoreRequestControllerOptions
) {
  function hasWork(): boolean {
    return options.isRestoreNeeded() || options.hasQueuedChunks()
  }

  function request(requestOptions?: HiddenRestoreRequestOptions): boolean {
    if (options.isWritePipelineCertifiedDead()) {
      if (!options.isDisposed() && options.claimCertifiedDeadRecovery()) {
        options.requestCertifiedDeadRecovery()
      }
      return false
    }

    options.resetIfPtyChanged()
    const ptyId = options.getRestorePtyId() ?? options.getCurrentPtyId()
    if (!hasWork() || !ptyId || !options.canUseSnapshot(ptyId)) {
      return false
    }
    options.bindRestorePty(ptyId)

    if (options.isTaskInFlight()) {
      options.armForegroundDeadline()
      return true
    }

    if (!requestOptions?.bypassScheduler) {
      if (!options.isActiveSplitPane()) {
        const scheduledPtyId = ptyId
        const scheduledGeneration = options.getRestoreGeneration()
        options.scheduleInactive(() => {
          if (
            options.isDisposed() ||
            options.getRestoreGeneration() !== scheduledGeneration ||
            options.getRestorePtyId() !== scheduledPtyId ||
            options.getCurrentPtyId() !== scheduledPtyId ||
            !options.canUseSnapshot(scheduledPtyId) ||
            !hasWork() ||
            !options.isForeground()
          ) {
            return
          }
          request({ bypassScheduler: true })
        })
        return true
      }
      options.cancelScheduled()
    }

    options.clearDeferredRetry()
    const task = options.runRestoreTask()
    options.trackTask(task, () => {
      if (options.isDisposed()) {
        return
      }
      if (options.hasPendingLive()) {
        options.markRestoreNeeded()
        options.armForegroundDeadline()
      }
      if (!options.isDeferredRetry() && options.isRestoreNeeded() && options.isForeground()) {
        request()
      }
    })
    return true
  }

  return { request }
}
