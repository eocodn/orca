import type { DirectSshRetryLease } from './pty-connection-direct-ssh-retry-controller'
import { pendingSpawnByPaneKey } from './pty-connection-runtime-state'

type PtyConnectionSpawnTrackerArgs = {
  pendingSpawnKey: string
  spawnPromise: Promise<string | null>
  directSshRetryAttempt: DirectSshRetryLease | undefined
  armDirectSshPaneRetryTimeout: (
    promise: Promise<unknown>,
    attempt: DirectSshRetryLease | undefined
  ) => void
  isDisposed: () => boolean
  getPtyId: () => string | null
  settleDirectSshPaneRetryAttempt: (
    attempt: DirectSshRetryLease | undefined,
    status: 'failed' | 'timed-out'
  ) => void
}

export function trackPtyConnectionSpawn({
  pendingSpawnKey,
  spawnPromise,
  directSshRetryAttempt,
  armDirectSshPaneRetryTimeout,
  isDisposed,
  getPtyId,
  settleDirectSshPaneRetryAttempt
}: PtyConnectionSpawnTrackerArgs): Promise<string | null> {
  let trackedPromise: Promise<string | null>
  trackedPromise = spawnPromise.finally(() => {
    if (pendingSpawnByPaneKey.get(pendingSpawnKey) === trackedPromise) {
      pendingSpawnByPaneKey.delete(pendingSpawnKey)
    }
  })
  armDirectSshPaneRetryTimeout(trackedPromise, directSshRetryAttempt)
  void trackedPromise
    .then((spawnedPtyId) => {
      if (spawnedPtyId) {
        return
      }
      queueMicrotask(() => {
        if (isDisposed() || getPtyId() || pendingSpawnByPaneKey.has(pendingSpawnKey)) {
          return
        }
        settleDirectSshPaneRetryAttempt(directSshRetryAttempt, 'failed')
      })
    })
    .catch(() => {})
  // Why: split panes can spawn concurrently; only the exact pane-key owner may be joined or cleared.
  pendingSpawnByPaneKey.set(pendingSpawnKey, trackedPromise)
  return trackedPromise
}
