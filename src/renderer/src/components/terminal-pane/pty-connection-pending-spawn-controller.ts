import { isWebTerminalSurfaceTabId } from '@/runtime/web-terminal-surface-id'
import type { DirectSshRetryLease } from './pty-connection-direct-ssh-retry-controller'
import { pendingSpawnByPaneKey } from './pty-connection-runtime-state'

type PendingSpawnTransport = {
  getPtyId: () => string | null
}

type PtyConnectionPendingSpawnControllerArgs = {
  pendingSpawnKey: string
  tabId: string
  paneId: number
  transport: PendingSpawnTransport
  directSshRetryAttempt: DirectSshRetryLease | undefined
  armDirectSshPaneRetryTimeout: (
    promise: Promise<unknown>,
    attempt: DirectSshRetryLease | undefined
  ) => void
  isDisposed: () => boolean
  canAdoptCapturedDirectSshRetryPty: (ptyId: string) => boolean
  adoptPendingSpawn: (ptyId: string) => boolean
  onMissingSpawn: () => void
  reportError: (message: string) => void
  recordDiagnostic: (message: string) => void
}

export function createPtyConnectionPendingSpawnController({
  pendingSpawnKey,
  tabId,
  paneId,
  transport,
  directSshRetryAttempt,
  armDirectSshPaneRetryTimeout,
  isDisposed,
  canAdoptCapturedDirectSshRetryPty,
  adoptPendingSpawn,
  onMissingSpawn,
  reportError,
  recordDiagnostic
}: PtyConnectionPendingSpawnControllerArgs) {
  const join = (): boolean => {
    const pendingSpawn = pendingSpawnByPaneKey.get(pendingSpawnKey)
    if (!pendingSpawn) {
      return false
    }
    recordDiagnostic(`pane=${paneId} -> PENDING SPAWN`)
    armDirectSshPaneRetryTimeout(pendingSpawn, directSshRetryAttempt)
    void pendingSpawn
      .then((spawnedPtyId) => {
        if (isDisposed() || transport.getPtyId()) {
          return
        }
        if (!spawnedPtyId) {
          // Why: StrictMode can remount after an earlier spawn completed empty; this pane must start its own PTY.
          if (!isWebTerminalSurfaceTabId(tabId)) {
            console.warn(
              `Pending PTY spawn for tab ${tabId} resolved without a PTY id, retrying fresh spawn`
            )
          }
          onMissingSpawn()
          return
        }
        if (!canAdoptCapturedDirectSshRetryPty(spawnedPtyId)) {
          return
        }
        // Why: no later spawn event will bind this remounted pane's DOM to the earlier mount's PTY.
        adoptPendingSpawn(spawnedPtyId)
      })
      .catch((error) => {
        reportError(error instanceof Error ? error.message : String(error))
      })
    return true
  }

  return { join }
}
