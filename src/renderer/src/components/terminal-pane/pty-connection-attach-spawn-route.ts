type PtyConnectionAttachSpawnRouteArgs = {
  paneId: number
  tabId: string
  attachPtyId: string | null
  legacyAttachOnlyPtyId: string | null
  attachUsesEagerBuffer: boolean
  hasSshConnection: boolean
  setAllowInitialIdleCacheSeed: (value: boolean) => void
  recordDiagnostic: (message: string) => void
  attachRetainedLegacyPty: (ptyId: string) => boolean
  removeDeferredSshSessionId: () => void
  attachDetachedPty: (ptyId: string, eager: boolean) => boolean
  clearTabPtyId: (tabId: string, ptyId: string) => void
  startFreshSpawn: () => void
  joinPendingSpawn: () => boolean
  startFreshOrColdRestore: () => void
}

export function runPtyConnectionAttachSpawnRoute({
  paneId,
  tabId,
  attachPtyId,
  legacyAttachOnlyPtyId,
  attachUsesEagerBuffer,
  hasSshConnection,
  setAllowInitialIdleCacheSeed,
  recordDiagnostic,
  attachRetainedLegacyPty,
  removeDeferredSshSessionId,
  attachDetachedPty,
  clearTabPtyId,
  startFreshSpawn,
  joinPendingSpawn,
  startFreshOrColdRestore
}: PtyConnectionAttachSpawnRouteArgs): 'attach' | 'pending' | 'fresh' {
  setAllowInitialIdleCacheSeed(false)
  if (attachPtyId) {
    recordDiagnostic(`pane=${paneId} -> ATTACH detached=${attachPtyId}`)
    if (legacyAttachOnlyPtyId) {
      if (attachRetainedLegacyPty(legacyAttachOnlyPtyId) && hasSshConnection) {
        removeDeferredSshSessionId()
      }
    } else if (!attachDetachedPty(attachPtyId, attachUsesEagerBuffer)) {
      clearTabPtyId(tabId, attachPtyId)
      startFreshSpawn()
    }
    return 'attach'
  }
  if (joinPendingSpawn()) {
    return 'pending'
  }
  recordDiagnostic(`pane=${paneId} -> FRESH SPAWN`)
  startFreshOrColdRestore()
  return 'fresh'
}
