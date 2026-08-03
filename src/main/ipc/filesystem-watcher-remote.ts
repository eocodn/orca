import { type WebContents } from 'electron'
import * as path from 'node:path'
import { stat } from 'node:fs/promises'
import { isWslPath } from '../wsl'
import { createWslWatcher } from './filesystem-watcher-wsl'
import type { WatchedRoot } from './filesystem-watcher-wsl'
import { isWatcherProcessFailure } from './parcel-watcher-process-failure'
import {
  WatcherChildCapacityError
} from './parcel-watcher-child-registry'
import { WATCHER_IGNORE_DIRS } from './filesystem-watcher-ignore'
import {
  suspendedLocalWatcherListeners,
  WATCHER_TEARDOWN_GRACE_MS
} from './filesystem-watcher-foundation'

// ── Debounce helpers ─────────────────────────────────────────────────

import { flushBatch,
  scheduleBatchFlush,
  createWatcher,
  cleanupLocalWatchersForSender,
  trackLocalUnsubscribe,
  abandonLocalUnsubscribes,
  retainLocalWatcherPhysicalFailure,
  registerSenderCleanup,
  addLocalWatchListener,
  subscribe,
  localWatchersClosed,
  localWatcherLifecycleGeneration,
  localWatcherRoot,
  unwatchableRoots,
  rememberUnwatchableRoot,
  watchedRoots,
  pendingTeardowns,
  takeLocalCapacityRetryListeners,
  pendingLocalInstallPromises,
  inFlightLocalInstalls,
  addInFlightLocalInstallListener,
  scheduleLocalCapacityRetry,
  clearLocalCapacityRetry,
  pendingLocalCapacityRetries,
  type LocalWatcherInstallToken,
  type LocalWatcherInstallResult } from './filesystem-watcher-local'
export { flushBatch,
  scheduleBatchFlush,
  createWatcher,
  cleanupLocalWatchersForSender,
  trackLocalUnsubscribe,
  abandonLocalUnsubscribes,
  retainLocalWatcherPhysicalFailure,
  registerSenderCleanup,
  addLocalWatchListener,
  subscribe,
  localWatchersClosed,
  localWatcherLifecycleGeneration,
  localWatcherRoot,
  unwatchableRoots,
  rememberUnwatchableRoot,
  watchedRoots,
  pendingTeardowns,
  takeLocalCapacityRetryListeners,
  pendingLocalInstallPromises,
  inFlightLocalInstalls,
  addInFlightLocalInstallListener,
  scheduleLocalCapacityRetry,
  clearLocalCapacityRetry,
  pendingLocalCapacityRetries,
  type LocalWatcherInstallToken,
  type LocalWatcherInstallResult } from './filesystem-watcher-local'

export async function subscribeWhileRemovalAllowed(
  worktreePath: string,
  sender: WebContents,
  generation: number
): Promise<void> {
  if (localWatchersClosed || generation !== localWatcherLifecycleGeneration) {
    return
  }
  const { key: rootKey, path: rootPath } = localWatcherRoot(worktreePath)
  if (sender.isDestroyed()) {
    return
  }

  // Don't retry roots that already failed — avoids repeated error spam.
  if (unwatchableRoots.has(rootKey)) {
    rememberUnwatchableRoot(rootKey)
    return
  }

  let root = watchedRoots.get(rootKey)

  // Cancel any pending grace-period teardown — a new listener arrived.
  const pendingTeardown = pendingTeardowns.get(rootKey)
  if (pendingTeardown) {
    clearTimeout(pendingTeardown)
    pendingTeardowns.delete(rootKey)
  }
  const capacityRetryListeners = takeLocalCapacityRetryListeners(rootKey)

  if (root) {
    for (const listener of capacityRetryListeners) {
      addLocalWatchListener(rootKey, listener)
    }
    addLocalWatchListener(rootKey, sender)
    return
  }

  const pendingInstall = pendingLocalInstallPromises.get(rootKey)
  if (pendingInstall) {
    const inFlight = inFlightLocalInstalls.get(rootKey)
    const canJoinInstall = inFlight && !inFlight.abortController.signal.aborted
    if (canJoinInstall) {
      // Why: an unwatch may cancel an install while another renderer awaits the same root; a new live listener keeps it alive.
      addInFlightLocalInstallListener(inFlight, sender)
      for (const listener of capacityRetryListeners) {
        addInFlightLocalInstallListener(inFlight, listener)
      }
    }
    const result = await pendingInstall
    if (
      result === 'cancelled' &&
      !canJoinInstall &&
      !localWatchersClosed &&
      generation === localWatcherLifecycleGeneration
    ) {
      // Why: AbortSignal can't be revived; listeners arriving after cancellation wait out that generation, then own a fresh install.
      if (pendingLocalInstallPromises.get(rootKey) === pendingInstall) {
        pendingLocalInstallPromises.delete(rootKey)
      }
      const retryListeners = new Map(
        capacityRetryListeners.map((listener) => [listener.id, listener])
      )
      retryListeners.set(sender.id, sender)
      for (const listener of retryListeners.values()) {
        if (!listener.isDestroyed()) {
          await subscribeWhileRemovalAllowed(worktreePath, listener, generation)
        }
      }
      return
    }
    if (!inFlight) {
      if (result === 'installed') {
        for (const listener of capacityRetryListeners) {
          addLocalWatchListener(rootKey, listener)
        }
      } else if (result === 'capacity') {
        const retryListeners = new Map(
          capacityRetryListeners.map((listener) => [listener.id, listener])
        )
        retryListeners.set(sender.id, sender)
        scheduleLocalCapacityRetry(rootKey, worktreePath, retryListeners)
      }
    }
    if (
      result === 'installed' &&
      watchedRoots.has(rootKey) &&
      !sender.isDestroyed() &&
      (!inFlight || inFlight.listeners.has(sender.id))
    ) {
      addLocalWatchListener(rootKey, sender)
    }
    return
  }

  const cancelToken: LocalWatcherInstallToken = {
    cancelled: false,
    listeners: new Map(),
    abortController: new AbortController()
  }
  inFlightLocalInstalls.set(rootKey, cancelToken)
  for (const listener of capacityRetryListeners) {
    addInFlightLocalInstallListener(cancelToken, listener)
  }
  addInFlightLocalInstallListener(cancelToken, sender)
  const installPromise = doInstallLocalWatcher(rootKey, rootPath, worktreePath, cancelToken)
  pendingLocalInstallPromises.set(rootKey, installPromise)
  try {
    await installPromise
  } finally {
    if (pendingLocalInstallPromises.get(rootKey) === installPromise) {
      pendingLocalInstallPromises.delete(rootKey)
    }
  }
}

export async function doInstallLocalWatcher(
  rootKey: string,
  rootPath: string,
  worktreePath: string,
  cancelToken: LocalWatcherInstallToken
): Promise<LocalWatcherInstallResult> {
  let root: WatchedRoot
  try {
    const s = await stat(rootPath)
    if (!s.isDirectory()) {
      console.warn(`[filesystem-watcher] not a directory: ${rootKey}`)
      rememberUnwatchableRoot(rootKey)
      return 'unavailable'
    }
  } catch {
    console.warn(`[filesystem-watcher] cannot stat root: ${rootKey}`)
    rememberUnwatchableRoot(rootKey)
    return 'unavailable'
  }

  try {
    // Why: WSL paths use one snapshot subprocess inside the distro so `wsl --shutdown` can kill it; native Windows uses @parcel/watcher.
    root = isWslPath(worktreePath)
      ? await createWslWatcher(
          rootKey,
          worktreePath,
          {
            ignoreDirs: WATCHER_IGNORE_DIRS,
            scheduleBatchFlush,
            watchedRoots
          },
          cancelToken.abortController.signal
        )
      : await createWatcher(rootKey, rootPath, cancelToken.abortController.signal)
  } catch (error) {
    // Why: setup can fail after its child misses the exit deadline; retain that owner even when the renderer-facing error is swallowed.
    retainLocalWatcherPhysicalFailure(rootKey, error)
    if (cancelToken.cancelled) {
      if (isWatcherProcessFailure(error) && error.code === 'process_unavailable') {
        throw error
      }
      return 'cancelled'
    }
    // Why: capacity is transient — allow retry once another child exits instead of caching this root as permanently failed.
    if (error instanceof WatcherChildCapacityError) {
      scheduleLocalCapacityRetry(rootKey, worktreePath, cancelToken.listeners)
      return 'capacity'
    }
    rememberUnwatchableRoot(rootKey)
    return 'unavailable'
  } finally {
    if (inFlightLocalInstalls.get(rootKey) === cancelToken) {
      inFlightLocalInstalls.delete(rootKey)
    }
  }

  const liveListeners = new Map(
    Array.from(cancelToken.listeners.entries()).filter(([, listener]) => !listener.isDestroyed())
  )
  if (cancelToken.cancelled || liveListeners.size === 0) {
    if (root.batch.timer) {
      clearTimeout(root.batch.timer)
    }
    void trackLocalUnsubscribe(rootKey, root)
    return 'cancelled'
  }

  root.listeners = liveListeners
  watchedRoots.set(rootKey, root)
  for (const listener of liveListeners.values()) {
    registerSenderCleanup(listener)
  }
  return 'installed'
}

export function unsubscribe(worktreePath: string, senderId: number): void {
  const { key: rootKey } = localWatcherRoot(worktreePath)
  const suspended = suspendedLocalWatcherListeners.get(rootKey)
  suspended?.listeners.delete(senderId)
  if (suspended?.listeners.size === 0) {
    suspendedLocalWatcherListeners.delete(rootKey)
  }
  const capacityRetry = pendingLocalCapacityRetries.get(rootKey)
  if (capacityRetry) {
    capacityRetry.listeners.delete(senderId)
    if (capacityRetry.listeners.size === 0) {
      clearLocalCapacityRetry(rootKey)
    }
  }
  const inFlight = inFlightLocalInstalls.get(rootKey)
  if (inFlight) {
    inFlight.listeners.delete(senderId)
    inFlight.cancelled = inFlight.listeners.size === 0
    // Why: last normal disconnect must abort the pending native/forked install (same early-cancel as closeLocalWatcherForWorktreePath).
    if (inFlight.cancelled) {
      inFlight.abortController.abort()
    }
  }

  const root = watchedRoots.get(rootKey)
  if (!root) {
    return
  }

  root.listeners.delete(senderId)

  // Defer teardown when the last subscriber leaves so rapid worktree switches reuse the native watcher.
  if (root.listeners.size === 0) {
    if (root.batch.timer) {
      clearTimeout(root.batch.timer)
    }

    // Why: duplicate unwatch calls for a root would leak overwritten grace timers; keep just one.
    if (pendingTeardowns.has(rootKey)) {
      return
    }

    const teardownTimer = setTimeout(() => {
      pendingTeardowns.delete(rootKey)
      // Re-check: a new listener may have arrived during the grace period.
      const currentRoot = watchedRoots.get(rootKey)
      if (!currentRoot || currentRoot.listeners.size > 0) {
        return
      }
      void trackLocalUnsubscribe(rootKey, currentRoot)
      watchedRoots.delete(rootKey)
    }, WATCHER_TEARDOWN_GRACE_MS)

    pendingTeardowns.set(rootKey, teardownTimer)
  }
}
