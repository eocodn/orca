import { ipcMain, type WebContents } from 'electron'
import * as path from 'node:path'
import { stat } from 'node:fs/promises'
import type { Event as WatcherEvent } from '@parcel/watcher'
import type { FsChangeEvent, FsChangedPayload } from '../../shared/types'
import {
  isWindowsAbsolutePathLike,
  normalizeRuntimePathForComparison
} from '../../shared/cross-platform-path'
import { isWslPath } from '../wsl'
import { createWslWatcher } from './filesystem-watcher-wsl'
import type { WatchedRoot } from './filesystem-watcher-wsl'
import {
  getSshFilesystemProvider,
  onSshFilesystemProviderRegistered
} from '../providers/ssh-filesystem-dispatch'
import { MAX_BATCHED_WATCHER_EVENTS, queueWatcherEvents } from './filesystem-watcher-event-batch'
import { disposeWatcherProcess, subscribeViaWatcherProcess } from './parcel-watcher-process'
import { isWatcherProcessFailure } from './parcel-watcher-process-failure'
import {
  onWatcherChildCapacityAvailable,
  WatcherChildCapacityError
} from './parcel-watcher-child-registry'
import { beginWatcherInstall, isWatcherRemovalInProgressError } from './watcher-removal-gate'
import {
  createWatcherRemovalDeadline,
  drainBeforeWatcherRemoval,
  WATCHER_REMOVAL_FINAL_DRAIN_RESERVE_MS,
  type WatcherRemovalDeadline
} from './watcher-removal-drain'
// Why: suppress high-churn dirs at the watcher level (separate from the File Explorer display filter, which only hides rows).
import { WATCHER_IGNORE_DIRS, buildParcelWatcherIgnoreOptions } from './filesystem-watcher-ignore'
import {
  abandonedLocalUnsubscribes,
  failedLocalUnsubscribes,
  watchedRoots,
  suspendedLocalWatcherListeners,
  pendingLocalCapacityRetries,
  inFlightLocalInstalls,
  pendingLocalInstallPromises,
  pendingTeardowns,
  localWatcherRoot,
  clearLocalCapacityRetry,
  pendingLocalUnsubscribes
} from './filesystem-watcher-foundation'
import {
  trackLocalUnsubscribe,
  subscribe
} from './filesystem-watcher-local'
import {
  remoteWatcherKey,
  clearDormantRemoteWatcher,
  clearRemoteWatcherResync,
  scheduleRemoteWatcherRetry
} from './filesystem-watcher-ipc'
import {
  type RemoteWatcherInstallResult,
  installRemoteWatcher
} from './filesystem-watcher-retry'

// ── Debounce helpers ─────────────────────────────────────────────────

import { subscribeWhileRemovalAllowed,
  doInstallLocalWatcher,
  unsubscribe } from './filesystem-watcher-remote'
export { subscribeWhileRemovalAllowed,
  doInstallLocalWatcher,
  unsubscribe } from './filesystem-watcher-remote'

export async function closeLocalWatcherForWorktreePath(
  worktreePath: string,
  deadline: WatcherRemovalDeadline = createWatcherRemovalDeadline()
): Promise<void> {
  const { key: rootKey } = localWatcherRoot(worktreePath)
  const suspended = suspendedLocalWatcherListeners.get(rootKey) ?? {
    worktreePath,
    listeners: new Map<number, WebContents>()
  }
  for (const source of [
    pendingLocalCapacityRetries.get(rootKey)?.listeners,
    inFlightLocalInstalls.get(rootKey)?.listeners,
    watchedRoots.get(rootKey)?.listeners
  ]) {
    for (const [senderId, sender] of source ?? []) {
      if (!sender.isDestroyed()) {
        suspended.listeners.set(senderId, sender)
      }
    }
  }
  if (suspended.listeners.size > 0) {
    suspendedLocalWatcherListeners.set(rootKey, suspended)
  }
  clearLocalCapacityRetry(rootKey)
  const pendingTeardown = pendingTeardowns.get(rootKey)
  if (pendingTeardown) {
    clearTimeout(pendingTeardown)
    pendingTeardowns.delete(rootKey)
  }

  const inFlight = inFlightLocalInstalls.get(rootKey)
  if (inFlight) {
    // Why: Windows locks watched directories; deletion must cancel an in-flight subscription before Git removes the tree.
    inFlight.listeners.clear()
    inFlight.cancelled = true
    inFlight.abortController.abort()
  }
  // Why: abort alone is not enough if the native subscribe never settles; bound so delete cannot hang the app.
  const pendingInstall = pendingLocalInstallPromises.get(rootKey)
  const installDrain = await drainBeforeWatcherRemoval(
    pendingInstall,
    deadline,
    `local watcher install for ${rootKey}`,
    { reserveMs: WATCHER_REMOVAL_FINAL_DRAIN_RESERVE_MS }
  )
  if (installDrain === 'timeout') {
    // Why: an abandoned install never runs its own cleanup, so leaving these entries would make every
    // later watch of this root queue behind the same wedged promise. Identity-checked so a late settle
    // can't evict a newer install.
    if (pendingLocalInstallPromises.get(rootKey) === pendingInstall) {
      pendingLocalInstallPromises.delete(rootKey)
    }
    if (inFlight && inFlightLocalInstalls.get(rootKey) === inFlight) {
      inFlightLocalInstalls.delete(rootKey)
    }
  }
  const pendingUnsubscribes = pendingLocalUnsubscribesByRoot.get(rootKey)
  if (pendingUnsubscribes) {
    const draining = Array.from(pendingUnsubscribes)
    const unsubscribeDrain = await drainBeforeWatcherRemoval(
      // Why the per-promise catch: an already-abandoned unsubscribe belongs to a delete that finished
      // without it; re-raising its rejection here would fail a later close on stale news.
      Promise.all(
        draining.map((unsubscribe) =>
          abandonedLocalUnsubscribes.has(unsubscribe)
            ? unsubscribe.catch(() => undefined)
            : unsubscribe
        )
      ),
      deadline,
      `local watcher unsubscribe for ${rootKey}`,
      { reserveMs: WATCHER_REMOVAL_FINAL_DRAIN_RESERVE_MS }
    )
    if (unsubscribeDrain === 'timeout') {
      abandonLocalUnsubscribes(draining)
    }
  }
  if (failedLocalUnsubscribes.has(rootKey)) {
    throw failedLocalUnsubscribes.get(rootKey)
  }

  const root = watchedRoots.get(rootKey)
  if (!root) {
    return
  }
  if (root.batch.timer) {
    clearTimeout(root.batch.timer)
  }
  watchedRoots.delete(rootKey)
  // Why: the in-process Parcel fallback has no unsubscribe timeout of its own, so an unbounded await
  // here would hang delete forever and hold the removal gate. The promise stays tracked in
  // pendingLocalUnsubscribesByRoot, so a later close still observes its failure.
  const finalUnsubscribe = trackLocalUnsubscribe(rootKey, root)
  const finalDrain = await drainBeforeWatcherRemoval(
    finalUnsubscribe,
    deadline,
    `local watcher unsubscribe for ${rootKey}`
  )
  if (finalDrain === 'timeout') {
    abandonLocalUnsubscribes([finalUnsubscribe])
  }
}

export async function restoreLocalWatcherAfterFailedRemoval(worktreePath: string): Promise<void> {
  const { key: rootKey } = localWatcherRoot(worktreePath)
  const suspended = suspendedLocalWatcherListeners.get(rootKey)
  if (!suspended) {
    return
  }
  suspendedLocalWatcherListeners.delete(rootKey)
  const failures: unknown[] = []
  const failedListeners = new Map<number, WebContents>()
  for (const sender of suspended.listeners.values()) {
    if (sender.isDestroyed()) {
      continue
    }
    try {
      await subscribe(suspended.worktreePath, sender)
      sender.send('fs:changed', {
        worktreePath: suspended.worktreePath,
        events: [{ kind: 'overflow', absolutePath: suspended.worktreePath }]
      } satisfies FsChangedPayload)
    } catch (error) {
      failures.push(error)
      failedListeners.set(sender.id, sender)
    }
  }
  if (failures.length > 0) {
    suspendedLocalWatcherListeners.set(rootKey, {
      worktreePath: suspended.worktreePath,
      listeners: failedListeners
    })
    throw failures[0]
  }
}

export function forgetLocalWatcherRemovalSnapshot(worktreePath: string): void {
  suspendedLocalWatcherListeners.delete(localWatcherRoot(worktreePath).key)
}

// Remote watcher state
export type RemoteWatcherState = {
  unwatch: () => void
  listeners: Map<number, WebContents>
  installToken: RemoteWatcherInstallToken
}

export type RemoteWatcherInstallToken = {
  cancelled: boolean
  listeners: Map<number, WebContents>
  abortController: AbortController
  abortScheduled: boolean
  terminalError?: Error
}

// Key: `${connectionId}:${worktreePath}`, Value: shared remote watch state.
export const remoteWatchers = new Map<string, RemoteWatcherState>()
export const suspendedRemoteWatcherListeners = new Map<
  string,
  { connectionId: string; worktreePath: string; listeners: Map<number, WebContents> }
>()
// Why: the renderer subscribes once per target and never re-issues, so the intent to watch has to
// outlive any single connection — an install that failed or died with a dropped transport is
// re-armed from here when a provider appears. Without it a reconnect (or a connect slower than the
// retry window) leaves the watch dead until the app restarts.
export const desiredRemoteWatchers = new Map<
  string,
  { connectionId: string; worktreePath: string; listeners: Map<number, WebContents> }
>()
// Why: provider registration only fires on reconnect, so a watch that dies while the SSH link stays
// healthy (remote OOM, inotify/fd exhaustion, relay watcher killed) has no re-arm trigger at all
// once the fast window gives up. Backoff keeps the recovery attempt without the 1s storm.
export const dormantRemoteWatchers = new Map<
  string,
  { delayMs: number; timer: ReturnType<typeof setTimeout> }
>()
export const loggedUnavailableRemoteWatchers = new Set<string>()
export const pendingRemoteWatcherRetries = new Map<string, ReturnType<typeof setTimeout>>()
export const pendingRemoteWatcherRetryListeners = new Map<
  string,
  { listeners: Map<number, WebContents>; startedAt: number; resyncOnInstall: boolean }
>()
export type RemoteWatcherResyncState = {
  lastSentAt: number
  listeners: Map<number, WebContents>
  timer?: ReturnType<typeof setTimeout>
  worktreePath: string
}
export const remoteWatcherResyncStates = new Map<string, RemoteWatcherResyncState>()
// Why: last-listener cleanup aborts relay setup; late success is unwatched rather than installed after the renderer stopped watching.
export const inFlightRemoteInstalls = new Map<string, RemoteWatcherInstallToken>()
// Why: dedupe concurrent installRemoteWatcher calls per key so overlapping watches share one watcher instead of clobbering per-key state.
export const pendingRemoteInstallPromises = new Map<string, Promise<RemoteWatcherInstallResult>>()
// Why: block installs beginning after closeAllWatchers (joiner recursion / retry tick bypass the abort loop); a new fs:watchWorktree clears it.
export let remoteWatchersClosed = false
export function setRemoteWatchersClosed(value: boolean): void {
  remoteWatchersClosed = value
}
// Why: closeAllWatchers bumps this so a joiner that awaited across shutdown+reopen is refused (the latch alone can't tell it from a fresh call).
export let remoteWatcherLifecycleGeneration = 0
export function setRemoteWatcherLifecycleGeneration(value: number): void {
  remoteWatcherLifecycleGeneration = value
}
export let unsubscribeFromProviderRegistrations: (() => void) | null = null
export function setUnsubscribeFromProviderRegistrations(value: (() => void) | null): void {
  unsubscribeFromProviderRegistrations = value
}
export const REMOTE_WATCH_RETRY_MS = 1_000
export const REMOTE_WATCH_RETRY_TIMEOUT_MS = 60_000
// Why: preserve the first and latest resync while bounding full-tree SSH refreshes during flaps.
export const REMOTE_WATCH_RESYNC_COALESCE_MS = 5_000
// Why: doubling from a minute to a half-hour ceiling costs a permanently broken remote ~7 fs.watch
// calls in the first hour and 2/hour after, which a flapping link can absorb.
export const REMOTE_WATCH_DORMANT_RETRY_MS = 60_000
export const REMOTE_WATCH_DORMANT_RETRY_MAX_MS = 30 * 60_000

export async function closeRemoteWatcherForWorktreePath(
  connectionId: string,
  worktreePath: string
): Promise<void> {
  const key = remoteWatcherKey(connectionId, worktreePath)
  const suspended = suspendedRemoteWatcherListeners.get(key) ?? {
    connectionId,
    worktreePath,
    listeners: new Map<number, WebContents>()
  }
  for (const source of [
    pendingRemoteWatcherRetryListeners.get(key)?.listeners,
    inFlightRemoteInstalls.get(key)?.listeners,
    remoteWatchers.get(key)?.listeners
  ]) {
    for (const [senderId, sender] of source ?? []) {
      if (!sender.isDestroyed()) {
        suspended.listeners.set(senderId, sender)
      }
    }
  }
  if (suspended.listeners.size > 0) {
    suspendedRemoteWatcherListeners.set(key, suspended)
  }
  clearRemoteWatcherResync(key)
  const retryTimer = pendingRemoteWatcherRetries.get(key)
  if (retryTimer) {
    clearTimeout(retryTimer)
    pendingRemoteWatcherRetries.delete(key)
    pendingRemoteWatcherRetryListeners.delete(key)
  }
  // Why: removal is deliberate — a backoff firing mid-removal would re-watch the path being deleted.
  clearDormantRemoteWatcher(key)
  const inFlight = inFlightRemoteInstalls.get(key)
  if (inFlight) {
    inFlight.listeners.clear()
    inFlight.cancelled = true
  }
  const state = remoteWatchers.get(key)
  const provider = getSshFilesystemProvider(connectionId)
  await (provider?.closeWatch
    ? provider.closeWatch(worktreePath)
    : Promise.resolve(state?.unwatch()))
  remoteWatchers.delete(key)
  loggedUnavailableRemoteWatchers.delete(key)
}

export async function restoreRemoteWatcherAfterFailedRemoval(
  connectionId: string,
  worktreePath: string
): Promise<void> {
  const key = remoteWatcherKey(connectionId, worktreePath)
  const suspended = suspendedRemoteWatcherListeners.get(key)
  if (!suspended) {
    return
  }
  suspendedRemoteWatcherListeners.delete(key)
  for (const sender of suspended.listeners.values()) {
    if (sender.isDestroyed()) {
      continue
    }
    const result = await installRemoteWatcher(sender, connectionId, worktreePath)
    if (result === 'unavailable') {
      scheduleRemoteWatcherRetry(sender, connectionId, worktreePath)
    }
    sender.send('fs:changed', {
      worktreePath,
      events: [{ kind: 'overflow', absolutePath: worktreePath }]
    } satisfies FsChangedPayload)
  }
}

export function forgetRemoteWatcherRemovalSnapshot(
  connectionId: string,
  worktreePath: string
): void {
  const key = remoteWatcherKey(connectionId, worktreePath)
  suspendedRemoteWatcherListeners.delete(key)
  clearRemoteWatcherResync(key)
  const retryTimer = pendingRemoteWatcherRetries.get(key)
  if (retryTimer) {
    clearTimeout(retryTimer)
    pendingRemoteWatcherRetries.delete(key)
  }
  pendingRemoteWatcherRetryListeners.delete(key)
  // Why: the worktree is gone — keeping the intent lets a reconnect landing before the renderer's
  // unwatch re-watch a deleted path (60s of retries against the host, then a bogus overflow).
  desiredRemoteWatchers.delete(key)
  clearDormantRemoteWatcher(key)
}
