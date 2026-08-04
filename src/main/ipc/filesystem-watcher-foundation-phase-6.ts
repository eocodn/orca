import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import {
  failedLocalUnsubscribes,
  inFlightLocalInstalls,
  localWatcherLifecycleGeneration,
  pendingLocalCapacityRetries,
  pendingLocalUnsubscribes,
  pendingTeardowns,
  senderCleanupRegistered,
  setLocalWatcherLifecycleGeneration,
  setLocalWatchersClosed,
  suspendedLocalWatcherListeners,
  unwatchableRoots,
  watchedRoots
} from './filesystem-watcher-foundation'
import { trackLocalUnsubscribe } from './filesystem-watcher-local'
import {
  REMOTE_WATCH_DORMANT_RETRY_MAX_MS,
  REMOTE_WATCH_DORMANT_RETRY_MS,
  desiredRemoteWatchers,
  dormantRemoteWatchers,
  inFlightRemoteInstalls,
  loggedUnavailableRemoteWatchers,
  pendingRemoteInstallPromises,
  pendingRemoteWatcherRetries,
  pendingRemoteWatcherRetryListeners,
  remoteWatcherLifecycleGeneration,
  remoteWatcherResyncStates,
  remoteWatchers,
  remoteWatchersClosed,
  setRemoteWatcherLifecycleGeneration,
  setRemoteWatchersClosed,
  suspendedRemoteWatcherListeners
} from './filesystem-watcher-removal'
import {
  type RemoteWatcherInstallResult,
  installRemoteWatcher
} from './filesystem-watcher-retry'
import { disposeWatcherProcess } from './parcel-watcher-process'
import { isWatcherRemovalInProgressError } from './watcher-removal-gate'

// ── Debounce helpers ─────────────────────────────────────────────────

import {
  clearDormantRemoteWatcher,
  remoteWatcherKey,
  requestRemoteWatcherResync,
  scheduleRemoteWatcherRetry
} from './filesystem-watcher-ipc'
export {
  clearDormantRemoteWatcher,flushRemoteWatcherResync,forgetDesiredRemoteWatcher,registerFilesystemWatcherHandlers,rememberDesiredRemoteWatcher,remoteWatcherKey,requestRemoteWatcherResync,
  scheduleRemoteWatcherRetry
} from './filesystem-watcher-ipc'

export function scheduleDormantRemoteWatcherRearm(
  connectionId: string,
  worktreePath: string,
  delayMs = REMOTE_WATCH_DORMANT_RETRY_MS
): void {
  const key = remoteWatcherKey(connectionId, worktreePath)
  if (remoteWatchersClosed || !desiredRemoteWatchers.has(key) || dormantRemoteWatchers.has(key)) {
    return
  }
  const timer = setTimeout(() => {
    dormantRemoteWatchers.delete(key)
    void rearmDormantRemoteWatcher(key, connectionId, worktreePath, delayMs)
  }, delayMs)
  // Why: a half-hour timer shouldn't be what keeps the process alive at quit.
  timer.unref?.()
  dormantRemoteWatchers.set(key, { delayMs, timer })
}

export async function rearmDormantRemoteWatcher(
  key: string,
  connectionId: string,
  worktreePath: string,
  delayMs: number
): Promise<void> {
  const desired = desiredRemoteWatchers.get(key)
  if (remoteWatchersClosed || !desired) {
    return
  }
  for (const [senderId, sender] of Array.from(desired.listeners)) {
    if (sender.isDestroyed()) {
      desired.listeners.delete(senderId)
    }
  }
  if (desired.listeners.size === 0) {
    desiredRemoteWatchers.delete(key)
    return
  }
  // Why: a live watch or an in-flight fast retry already owns this key; installing again would
  // clobber the entry the running watch reads its listeners from.
  if (remoteWatchers.has(key) || pendingRemoteWatcherRetries.has(key)) {
    return
  }
  // Why: no provider means the connection itself is down, and its registration re-arms for free —
  // polling would only add wire traffic to a link that is already being rebuilt.
  if (!getSshFilesystemProvider(connectionId)) {
    return
  }

  const listeners = Array.from(desired.listeners.values())
  let results: RemoteWatcherInstallResult[]
  try {
    results = await Promise.all(
      listeners.map((listener) => installRemoteWatcher(listener, connectionId, worktreePath))
    )
  } catch (error) {
    if (isWatcherRemovalInProgressError(error)) {
      // Why: removal owns the key now and either forgets the intent or restores the watch itself.
      return
    }
    scheduleDormantRemoteWatcherRearm(connectionId, worktreePath, nextDormantDelayMs(delayMs))
    return
  }
  requestRemoteWatcherResync(
    key,
    worktreePath,
    listeners.filter((_, index) => results[index] === 'installed')
  )
  // Why: 'cancelled' means shutdown or the last listener left, so only 'unavailable' stays dormant.
  if (results.some((result) => result === 'unavailable')) {
    scheduleDormantRemoteWatcherRearm(connectionId, worktreePath, nextDormantDelayMs(delayMs))
  }
}

export function nextDormantDelayMs(delayMs: number): number {
  return Math.min(delayMs * 2, REMOTE_WATCH_DORMANT_RETRY_MAX_MS)
}

/**
 * Rebuild remote watches for a connection whose filesystem provider was just (re)registered.
 *
 * Why: the relay's watch registrations die with the transport they were made on, and the previous
 * provider's unwatch handle is scoped to that dead transport. Reinstalling is the only way the
 * subscription comes back, and consumers get an overflow so they resync whatever changed while the
 * watch was down.
 */
export function reinstallRemoteWatchersForConnection(connectionId: string): void {
  if (remoteWatchersClosed) {
    return
  }
  for (const [key, desired] of Array.from(desiredRemoteWatchers)) {
    if (desired.connectionId !== connectionId) {
      continue
    }
    for (const [senderId, sender] of Array.from(desired.listeners)) {
      if (sender.isDestroyed()) {
        desired.listeners.delete(senderId)
      }
    }
    if (desired.listeners.size === 0) {
      desiredRemoteWatchers.delete(key)
      continue
    }

    // Why: drop the entry the dead transport left behind first — installRemoteWatcher treats an
    // existing entry as already-installed and would hand back a watcher that can never fire again.
    const stale = remoteWatchers.get(key)
    if (stale) {
      remoteWatchers.delete(key)
      try {
        stale.unwatch()
      } catch {
        // Why: the handle belongs to the replaced transport; failing to close it is expected.
      }
    }
    const retryTimer = pendingRemoteWatcherRetries.get(key)
    if (retryTimer) {
      clearTimeout(retryTimer)
      pendingRemoteWatcherRetries.delete(key)
      pendingRemoteWatcherRetryListeners.delete(key)
    }
    // Why: a pending watch belongs to the replaced transport; joiners must retry on the new provider.
    const inFlight = inFlightRemoteInstalls.get(key)
    if (inFlight) {
      inFlight.listeners.clear()
      inFlight.cancelled = true
      inFlight.abortController.abort()
    }
    // Why: this reinstall supersedes the pending backoff; leaving it armed double-installs the key.
    clearDormantRemoteWatcher(key)
    loggedUnavailableRemoteWatchers.delete(key)

    const listeners = Array.from(desired.listeners.values())
    void Promise.all(
      listeners.map((listener) =>
        installRemoteWatcher(listener, desired.connectionId, desired.worktreePath)
      )
    )
      .then((results) => {
        // Why: events between the transport dropping and this reinstall are gone for good.
        requestRemoteWatcherResync(
          key,
          desired.worktreePath,
          listeners.filter((_, index) => results[index] === 'installed')
        )
        if (results.some((result) => result === 'unavailable')) {
          for (const listener of listeners) {
            scheduleRemoteWatcherRetry(
              listener,
              desired.connectionId,
              desired.worktreePath,
              Date.now(),
              true
            )
          }
        }
      })
      .catch((error: unknown) => {
        if (isWatcherRemovalInProgressError(error)) {
          return
        }
        for (const listener of listeners) {
          scheduleRemoteWatcherRetry(
            listener,
            desired.connectionId,
            desired.worktreePath,
            Date.now(),
            true
          )
        }
      })
  }
}

/** Tear down all watchers on app shutdown. */
export async function closeAllWatchers(): Promise<void> {
  // Why: drop the intent with the rest of the state, but keep the provider-registration
  // subscription — a new fs:watchWorktree reopens the subsystem and still needs the re-arm hook.
  desiredRemoteWatchers.clear()
  senderCleanupRegistered.clear()
  unwatchableRoots.clear()
  suspendedLocalWatcherListeners.clear()
  suspendedRemoteWatcherListeners.clear()
  for (const retry of pendingLocalCapacityRetries.values()) {
    retry.cancelWait()
  }
  pendingLocalCapacityRetries.clear()

  // Cancel any pending grace-period teardowns — we're tearing down everything.
  for (const timer of pendingTeardowns.values()) {
    clearTimeout(timer)
  }
  pendingTeardowns.clear()

  for (const timer of pendingRemoteWatcherRetries.values()) {
    clearTimeout(timer)
  }
  pendingRemoteWatcherRetries.clear()
  pendingRemoteWatcherRetryListeners.clear()
  for (const state of remoteWatcherResyncStates.values()) {
    if (state.timer) {
      clearTimeout(state.timer)
    }
  }
  remoteWatcherResyncStates.clear()
  for (const dormant of dormantRemoteWatchers.values()) {
    clearTimeout(dormant.timer)
  }
  dormantRemoteWatchers.clear()
  loggedUnavailableRemoteWatchers.clear()
  // Why: latch both subsystems shut so late installs can't register; generation bumps reject older-lifecycle waiters.
  setRemoteWatchersClosed(true)
  setRemoteWatcherLifecycleGeneration(remoteWatcherLifecycleGeneration + 1)
  setLocalWatchersClosed(true)
  setLocalWatcherLifecycleGeneration(localWatcherLifecycleGeneration + 1)
  pendingRemoteInstallPromises.clear()
  // Why: cancel in-flight provider.watch() calls so their resolved unwatch handles aren't installed post-shutdown.
  for (const token of inFlightRemoteInstalls.values()) {
    token.listeners.clear()
    token.cancelled = true
    token.abortController.abort()
  }
  for (const token of inFlightLocalInstalls.values()) {
    token.listeners.clear()
    token.cancelled = true
    token.abortController.abort()
  }

  for (const [rootKey, root] of watchedRoots) {
    if (root.batch.timer) {
      clearTimeout(root.batch.timer)
    }
    await trackLocalUnsubscribe(rootKey, root).catch(() => undefined)
  }
  watchedRoots.clear()
  await Promise.allSettled(Array.from(pendingLocalUnsubscribes))
  failedLocalUnsubscribes.clear()
  // Why: kill the forked watcher process instead of watcher.node's crash-prone async teardown; process death frees native handles.
  disposeWatcherProcess()

  // Why: remote watchers are separate from local @parcel/watcher subs; unwatch here or the relay keeps polling FS after shutdown.
  for (const [key, state] of remoteWatchers) {
    try {
      state.unwatch()
    } catch (err) {
      console.error(`[filesystem-watcher] remote unwatch error for ${key}:`, err)
    }
  }
  remoteWatchers.clear()
}
