type RemoteOutputPauseState = {
  markPaused: (ptyId: string) => boolean
  clearIfMatches: (ptyId: string) => boolean
  clearIfRebound: (ptyId: string | null) => boolean
  clear: () => boolean
}

type HiddenDeliveryRuntime = {
  canUseSnapshot: (ptyId: string | null) => boolean
  onModelRestoreNeeded: () => void
  markRestoreNeeded: () => void
  requestRestore: () => void
  getRestorePtyId: () => string | null
}

type PtyConnectionHiddenDeliveryControllerArgs = {
  getPtyId: () => string | null
  setOutputPaused: (paused: boolean) => void
  isDisposed: () => boolean
  isForeground: () => boolean
  isRemotePty: (ptyId: string | null) => boolean
  isGateManagedPty: (ptyId: string | null) => boolean
  acquireHiddenClaim: (ptyId: string) => () => void
  declareVisible: (ptyId: string) => void
  registerModelRestore: (ptyId: string, listener: () => void) => () => void
  remotePause: RemoteOutputPauseState
  mainSideEffectAuthority: boolean
  registerSideEffectFacts: (ptyId: string, remoteOutputPaused: boolean) => void
  dropSideEffectFacts: () => void
}

export function createPtyConnectionHiddenDeliveryController({
  getPtyId,
  setOutputPaused,
  isDisposed,
  isForeground,
  isRemotePty,
  isGateManagedPty,
  acquireHiddenClaim,
  declareVisible,
  registerModelRestore,
  remotePause,
  mainSideEffectAuthority,
  registerSideEffectFacts,
  dropSideEffectFacts
}: PtyConnectionHiddenDeliveryControllerArgs) {
  let runtime: HiddenDeliveryRuntime | null = null
  let syncedPtyId: string | null = null
  let releaseHiddenClaim: (() => void) | null = null
  let modelRestorePtyId: string | null = null
  let unregisterModelRestore: (() => void) | null = null

  const syncModelRestore = (ptyId: string | null): void => {
    if (!runtime || modelRestorePtyId === ptyId) {
      return
    }
    unregisterModelRestore?.()
    unregisterModelRestore = null
    modelRestorePtyId = ptyId
    if (!ptyId || isRemotePty(ptyId)) {
      return
    }
    unregisterModelRestore = registerModelRestore(ptyId, runtime.onModelRestoreNeeded)
  }

  return {
    bindRuntime(nextRuntime: HiddenDeliveryRuntime): void {
      runtime = nextRuntime
    },
    handleRemoteOutputPauseChanged(paused: boolean, supported: boolean): void {
      if (!runtime) {
        return
      }
      const ptyId = getPtyId()
      if (!ptyId || !isRemotePty(ptyId)) {
        return
      }
      if (!supported || !paused) {
        if (remotePause.clearIfMatches(ptyId) && !mainSideEffectAuthority) {
          dropSideEffectFacts()
        }
        if (supported && !paused && runtime.getRestorePtyId() === ptyId) {
          runtime.requestRestore()
        }
        return
      }
      if (remotePause.markPaused(ptyId)) {
        registerSideEffectFacts(ptyId, true)
      }
      runtime.markRestoreNeeded()
    },
    sync(): void {
      if (!runtime) {
        return
      }
      const ptyId = getPtyId()
      syncModelRestore(ptyId)
      if (remotePause.clearIfRebound(ptyId) && !mainSideEffectAuthority) {
        dropSideEffectFacts()
      }
      if (isRemotePty(ptyId) && runtime.canUseSnapshot(ptyId)) {
        setOutputPaused(!isDisposed() && !isForeground())
        return
      }
      if (syncedPtyId !== null && syncedPtyId !== ptyId) {
        releaseHiddenClaim?.()
        releaseHiddenClaim = null
        syncedPtyId = null
      }
      if (!ptyId || !isGateManagedPty(ptyId) || !runtime.canUseSnapshot(ptyId)) {
        return
      }
      const shouldHide = !isDisposed() && !isForeground()
      const isFirstSyncForPty = syncedPtyId !== ptyId
      syncedPtyId = ptyId
      if (shouldHide) {
        releaseHiddenClaim ??= acquireHiddenClaim(ptyId)
      } else if (releaseHiddenClaim) {
        releaseHiddenClaim()
        releaseHiddenClaim = null
      } else if (isFirstSyncForPty) {
        declareVisible(ptyId)
      }
    },
    release(): void {
      if (!runtime) {
        return
      }
      setOutputPaused(false)
      if (remotePause.clear() && !mainSideEffectAuthority) {
        dropSideEffectFacts()
      }
      releaseHiddenClaim?.()
      releaseHiddenClaim = null
      syncedPtyId = null
      unregisterModelRestore?.()
      unregisterModelRestore = null
      modelRestorePtyId = null
    }
  }
}
