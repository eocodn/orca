import { type WebContents } from 'electron'
import * as path from 'node:path'
import { stat } from 'node:fs/promises'
import type { FsChangeEvent, FsChangedPayload } from '../../shared/types'
import type { WatchedRoot } from './filesystem-watcher-wsl'
import { MAX_BATCHED_WATCHER_EVENTS, queueWatcherEvents } from './filesystem-watcher-event-batch'
import { subscribeViaWatcherProcess } from './parcel-watcher-process'
import { isWatcherProcessFailure } from './parcel-watcher-process-failure'
import { beginWatcherInstall } from './watcher-removal-gate'
// Why: suppress high-churn dirs at the watcher level (separate from the File Explorer display filter, which only hides rows).
import { WATCHER_IGNORE_DIRS, buildParcelWatcherIgnoreOptions } from './filesystem-watcher-ignore'
import { cleanupRemoteWatchersForSender } from './filesystem-watcher-retry'
import { subscribeWhileRemovalAllowed } from './filesystem-watcher-remote'

// ── Debounce helpers ─────────────────────────────────────────────────

import { DEBOUNCE_TRAILING_MS,
  DEBOUNCE_MAX_WAIT_MS,
  watchedRoots,
  UNWATCHABLE_ROOT_CACHE_MAX,
  unwatchableRoots,
  rememberUnwatchableRoot,
  senderCleanupRegistered,
  WATCHER_TEARDOWN_GRACE_MS,
  pendingTeardowns,
  pendingLocalUnsubscribes,
  pendingLocalUnsubscribesByRoot,
  suspendedLocalWatcherListeners,
  localWatchersClosed,
  localWatcherLifecycleGeneration,
  failedLocalUnsubscribes,
  abandonedLocalUnsubscribes,
  type LocalWatcherInstallToken,
  type LocalWatcherInstallResult,
  type LocalWatcherCapacityRetry,
  inFlightLocalInstalls,
  pendingLocalInstallPromises,
  pendingLocalCapacityRetries,
  addInFlightLocalInstallListener,
  cleanupInFlightLocalInstallsForSender,
  takeLocalCapacityRetryListeners,
  clearLocalCapacityRetry,
  scheduleLocalCapacityRetry,
  normalizeRootPath,
  localWatcherRoot,
  normalizeEventPath,
  coalesceEvents,
  tryStatIsDirectory,
  emitOverflowPayload } from './filesystem-watcher-foundation'
export { DEBOUNCE_TRAILING_MS,
  DEBOUNCE_MAX_WAIT_MS,
  watchedRoots,
  UNWATCHABLE_ROOT_CACHE_MAX,
  unwatchableRoots,
  rememberUnwatchableRoot,
  senderCleanupRegistered,
  WATCHER_TEARDOWN_GRACE_MS,
  pendingTeardowns,
  pendingLocalUnsubscribes,
  pendingLocalUnsubscribesByRoot,
  suspendedLocalWatcherListeners,
  localWatchersClosed,
  localWatcherLifecycleGeneration,
  failedLocalUnsubscribes,
  abandonedLocalUnsubscribes,
  type LocalWatcherInstallToken,
  type LocalWatcherInstallResult,
  type LocalWatcherCapacityRetry,
  inFlightLocalInstalls,
  pendingLocalInstallPromises,
  pendingLocalCapacityRetries,
  addInFlightLocalInstallListener,
  cleanupInFlightLocalInstallsForSender,
  takeLocalCapacityRetryListeners,
  clearLocalCapacityRetry,
  scheduleLocalCapacityRetry,
  normalizeRootPath,
  localWatcherRoot,
  normalizeEventPath,
  coalesceEvents,
  tryStatIsDirectory,
  emitOverflowPayload } from './filesystem-watcher-foundation'

export async function flushBatch(root: WatchedRoot): Promise<void> {
  const overflowed = root.batch.overflowed
  const rawEvents = root.batch.events.splice(0)
  root.batch.overflowed = false
  root.batch.timer = null
  root.batch.firstEventAt = 0

  if ((rawEvents.length === 0 && !overflowed) || root.listeners.size === 0) {
    return
  }

  if (overflowed || rawEvents.length > MAX_BATCHED_WATCHER_EVENTS) {
    // Why: deletion storms can be too large to coalesce/stat per path; one overflow asks the renderer for the same conservative refresh.
    emitOverflowPayload(root)
    return
  }

  const coalesced = coalesceEvents(rawEvents)

  const events: FsChangeEvent[] = await Promise.all(
    coalesced.map(async (evt) => {
      // Why: a deleted path can't be stat'd; leave isDirectory undefined and let the renderer infer from dirCache.
      const isDirectory = evt.type === 'delete' ? undefined : await tryStatIsDirectory(evt.path)

      return {
        kind: evt.type,
        absolutePath: evt.path,
        isDirectory
      }
    })
  )

  const payload: FsChangedPayload = {
    worktreePath: root.rootPath,
    events
  }

  for (const [, wc] of root.listeners) {
    if (!wc.isDestroyed()) {
      wc.send('fs:changed', payload)
    }
  }
}

export function scheduleBatchFlush(root: WatchedRoot): void {
  const now = Date.now()

  if (root.batch.firstEventAt === 0) {
    root.batch.firstEventAt = now
  }

  // If we've exceeded the max wait, flush immediately
  if (now - root.batch.firstEventAt >= DEBOUNCE_MAX_WAIT_MS) {
    if (root.batch.timer) {
      clearTimeout(root.batch.timer)
    }
    void flushBatch(root)
    return
  }

  // Trailing-edge debounce: reset timer on each new event
  if (root.batch.timer) {
    clearTimeout(root.batch.timer)
  }
  root.batch.timer = setTimeout(() => void flushBatch(root), DEBOUNCE_TRAILING_MS)
}

// ── Watcher creation ─────────────────────────────────────────────────

export async function createWatcher(
  rootKey: string,
  rootPath: string,
  signal?: AbortSignal
): Promise<WatchedRoot> {
  const root: WatchedRoot = {
    subscription: null!,
    listeners: new Map(),
    batch: { events: [], overflowed: false, timer: null, firstEventAt: 0 },
    rootPath
  }

  try {
    // Why: if the error callback cleaned up before subscribe() resolved, its returned subscription is orphaned and leaks a native handle.
    let errorCleanedUp = false

    const watcherOptions = {
      ...buildParcelWatcherIgnoreOptions(WATCHER_IGNORE_DIRS),
      // Why: Parcel probes Watchman first, which prints a shell-level "watchman not recognized" error on Windows; pin the backend to suppress it.
      ...(process.platform === 'win32' ? { backend: 'windows' as const } : {})
    }

    const markWatcherInterrupted = (): void => {
      root.batch.overflowed = true
      scheduleBatchFlush(root)
    }

    // Why: fork the watcher process (issue #7547 — watcher.node teardown races crash the host); onInterruption marks overflow to refresh past the gap.
    root.subscription = await subscribeViaWatcherProcess(
      rootPath,
      (err, events) => {
        if (err) {
          // Why: treat watcher errors as overflow so the renderer conservatively refreshes rather than trusting possibly-invalid caches (§7.2, §7.3).
          console.error(`[filesystem-watcher] error for ${rootKey}:`, err)
          emitOverflowPayload(root)
          // Why: after an error the native subscription may be invalid (deleted root); tear down the dead watcher so it doesn't dangle (§7.3).
          if (root.batch.timer) {
            clearTimeout(root.batch.timer)
          }
          // Why: error callback can fire before subscribe() assigns root.subscription; guard against null so cleanup doesn't crash.
          if (root.subscription) {
            retainLocalWatcherPhysicalFailure(rootKey, err)
            void trackLocalUnsubscribe(rootKey, root)
          }
          errorCleanedUp = true
          watchedRoots.delete(rootKey)
          return
        }

        queueWatcherEvents(root.batch, events)
        scheduleBatchFlush(root)
      },
      watcherOptions,
      {
        delivery: { maxEventsPerBatch: MAX_BATCHED_WATCHER_EVENTS },
        // A child restart or bounded-queue overflow loses path precision; both need the same conservative renderer refresh.
        onInterruption: markWatcherInterrupted,
        onOverflow: markWatcherInterrupted,
        signal
      }
    )

    // Why: error callback already cleaned up watchedRoots before subscribe() resolved; unsubscribe this orphaned subscription so it doesn't leak.
    if (errorCleanedUp) {
      void trackLocalUnsubscribe(rootKey, root)
      throw new Error(`Watcher for ${rootKey} errored during subscribe`)
    }
  } catch (err) {
    // Why: watcher backend can throw synchronously on a deleted root/permission error; log rather than crash the main process (§7.3).
    console.error(`[filesystem-watcher] failed to subscribe ${rootKey}:`, err)
    throw err
  }

  return root
}

// ── Subscribe / Unsubscribe ──────────────────────────────────────────

export function cleanupLocalWatchersForSender(senderId: number): void {
  for (const [rootKey, suspended] of suspendedLocalWatcherListeners) {
    suspended.listeners.delete(senderId)
    if (suspended.listeners.size === 0) {
      suspendedLocalWatcherListeners.delete(rootKey)
    }
  }
  cleanupInFlightLocalInstallsForSender(senderId)
  for (const [key, watchedRoot] of watchedRoots) {
    if (watchedRoot.listeners.has(senderId)) {
      watchedRoot.listeners.delete(senderId)
      if (watchedRoot.listeners.size === 0) {
        // Cancel any pending grace-period teardown for this root.
        const pending = pendingTeardowns.get(key)
        if (pending) {
          clearTimeout(pending)
          pendingTeardowns.delete(key)
        }
        if (watchedRoot.batch.timer) {
          clearTimeout(watchedRoot.batch.timer)
        }
        trackLocalUnsubscribe(key, watchedRoot)
        watchedRoots.delete(key)
      }
    }
  }
}

export function trackLocalUnsubscribe(rootKey: string, root: WatchedRoot): Promise<void> {
  const rootUnsubscribes = pendingLocalUnsubscribesByRoot.get(rootKey) ?? new Set<Promise<void>>()
  pendingLocalUnsubscribesByRoot.set(rootKey, rootUnsubscribes)
  const unsubscribePromise = Promise.resolve()
    .then(() => root.subscription.unsubscribe())
    .finally(() => {
      pendingLocalUnsubscribes.delete(unsubscribePromise)
      rootUnsubscribes.delete(unsubscribePromise)
      if (rootUnsubscribes.size === 0) {
        pendingLocalUnsubscribesByRoot.delete(rootKey)
      }
    })
  pendingLocalUnsubscribes.add(unsubscribePromise)
  rootUnsubscribes.add(unsubscribePromise)
  // Why: swallow here to avoid unhandled rejections, but keep the original promise rejected so later destructive cleanup can fail closed.
  void unsubscribePromise.catch((error: unknown) => {
    if (!abandonedLocalUnsubscribes.has(unsubscribePromise)) {
      retainLocalWatcherPhysicalFailure(rootKey, error)
    }
    console.error(`[filesystem-watcher] unsubscribe error for ${rootKey}:`, error)
  })
  return unsubscribePromise
}

/** Mark unsubscribes whose drain timed out so their late failures stay out of failedLocalUnsubscribes. */
export function abandonLocalUnsubscribes(promises: Iterable<Promise<void>>): void {
  for (const promise of promises) {
    abandonedLocalUnsubscribes.add(promise)
  }
}

export function retainLocalWatcherPhysicalFailure(rootKey: string, error: unknown): void {
  if (!isWatcherProcessFailure(error) || !error.physicalExit) {
    return
  }
  failedLocalUnsubscribes.set(rootKey, error)
  void error.physicalExit.then(() => {
    if (failedLocalUnsubscribes.get(rootKey) === error) {
      failedLocalUnsubscribes.delete(rootKey)
    }
  })
}

export function registerSenderCleanup(sender: WebContents): void {
  if (senderCleanupRegistered.has(sender.id)) {
    return
  }
  senderCleanupRegistered.add(sender.id)
  sender.once('destroyed', () => {
    senderCleanupRegistered.delete(sender.id)
    cleanupLocalWatchersForSender(sender.id)
    cleanupRemoteWatchersForSender(sender.id)
  })
}

export function addLocalWatchListener(rootKey: string, sender: WebContents): void {
  const root = watchedRoots.get(rootKey)
  if (!root || sender.isDestroyed()) {
    return
  }
  root.listeners.set(sender.id, sender)
  registerSenderCleanup(sender)
}

export async function subscribe(
  worktreePath: string,
  sender: WebContents,
  generation = localWatcherLifecycleGeneration
): Promise<void> {
  if (localWatchersClosed || generation !== localWatcherLifecycleGeneration) {
    return
  }
  const finishInstall = beginWatcherInstall(worktreePath)
  try {
    await subscribeWhileRemovalAllowed(worktreePath, sender, generation)
  } finally {
    finishInstall()
  }
}
