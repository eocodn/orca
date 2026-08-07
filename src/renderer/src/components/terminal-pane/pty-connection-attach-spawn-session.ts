import type { DirectSshRetryLease } from './pty-connection-direct-ssh-retry-controller'
import { runPtyConnectionAttachSpawnRoute } from './pty-connection-attach-spawn-route'
import { createPtyConnectionPendingSpawnController } from './pty-connection-pending-spawn-controller'

type PendingSpawnTransport = {
  getPtyId: () => string | null
}

type PtyConnectionAttachSpawnSessionArgs = {
  paneId: number
  tabId: string
  attachPtyId: string | null
  legacyAttachOnlyPtyId: string | null
  attachUsesEagerBuffer: boolean
  hasSshConnection: boolean
  pendingSpawnKey: string
  transport: PendingSpawnTransport
  directSshRetryAttempt: DirectSshRetryLease | undefined
  setAllowInitialIdleCacheSeed: (value: boolean) => void
  recordDiagnostic: (message: string) => void
  attachRetainedLegacyPty: (ptyId: string) => boolean
  removeDeferredSshSessionId: () => void
  attachDetachedPty: (ptyId: string, eager: boolean) => boolean
  clearTabPtyId: (tabId: string, ptyId: string) => void
  startFreshSpawn: () => void
  startFreshOrColdRestore: () => void
  armDirectSshPaneRetryTimeout: (
    promise: Promise<unknown>,
    attempt: DirectSshRetryLease | undefined
  ) => void
  isDisposed: () => boolean
  canAdoptCapturedDirectSshRetryPty: (ptyId: string) => boolean
  adoptPendingSpawn: (ptyId: string) => boolean
  reportError: (message: string) => void
}

export function runPtyConnectionAttachSpawnSession({
  paneId,
  tabId,
  attachPtyId,
  legacyAttachOnlyPtyId,
  attachUsesEagerBuffer,
  hasSshConnection,
  pendingSpawnKey,
  transport,
  directSshRetryAttempt,
  setAllowInitialIdleCacheSeed,
  recordDiagnostic,
  attachRetainedLegacyPty,
  removeDeferredSshSessionId,
  attachDetachedPty,
  clearTabPtyId,
  startFreshSpawn,
  startFreshOrColdRestore,
  armDirectSshPaneRetryTimeout,
  isDisposed,
  canAdoptCapturedDirectSshRetryPty,
  adoptPendingSpawn,
  reportError
}: PtyConnectionAttachSpawnSessionArgs): 'attach' | 'pending' | 'fresh' {
  const pendingSpawnController = createPtyConnectionPendingSpawnController({
    pendingSpawnKey,
    tabId,
    paneId,
    transport,
    directSshRetryAttempt,
    armDirectSshPaneRetryTimeout,
    isDisposed,
    canAdoptCapturedDirectSshRetryPty,
    adoptPendingSpawn,
    onMissingSpawn: startFreshOrColdRestore,
    reportError,
    recordDiagnostic
  })

  return runPtyConnectionAttachSpawnRoute({
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
    joinPendingSpawn: pendingSpawnController.join,
    startFreshOrColdRestore
  })
}
