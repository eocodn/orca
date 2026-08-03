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
import { registerSenderCleanup } from './filesystem-watcher-local'
import {
  forgetDesiredRemoteWatcher,
  remoteWatcherKey,
  scheduleRemoteWatcherRetry
} from './filesystem-watcher-ipc'

// ── Debounce helpers ─────────────────────────────────────────────────

import { closeLocalWatcherForWorktreePath,
  restoreLocalWatcherAfterFailedRemoval,
  forgetLocalWatcherRemovalSnapshot,
  type RemoteWatcherState,
  type RemoteWatcherInstallToken,
  remoteWatchers,
  suspendedRemoteWatcherListeners,
  desiredRemoteWatchers,
  dormantRemoteWatchers,
  loggedUnavailableRemoteWatchers,
  pendingRemoteWatcherRetries,
  pendingRemoteWatcherRetryListeners,
  type RemoteWatcherResyncState,
  remoteWatcherResyncStates,
  inFlightRemoteInstalls,
  pendingRemoteInstallPromises,
  remoteWatchersClosed,
  remoteWatcherLifecycleGeneration,
  unsubscribeFromProviderRegistrations,
  REMOTE_WATCH_RETRY_MS,
  REMOTE_WATCH_RETRY_TIMEOUT_MS,
  REMOTE_WATCH_RESYNC_COALESCE_MS,
  REMOTE_WATCH_DORMANT_RETRY_MS,
  REMOTE_WATCH_DORMANT_RETRY_MAX_MS,
  closeRemoteWatcherForWorktreePath,
  restoreRemoteWatcherAfterFailedRemoval,
  forgetRemoteWatcherRemovalSnapshot } from './filesystem-watcher-removal'
export { closeLocalWatcherForWorktreePath,
  restoreLocalWatcherAfterFailedRemoval,
  forgetLocalWatcherRemovalSnapshot,
  type RemoteWatcherState,
  type RemoteWatcherInstallToken,
  remoteWatchers,
  suspendedRemoteWatcherListeners,
  desiredRemoteWatchers,
  dormantRemoteWatchers,
  loggedUnavailableRemoteWatchers,
  pendingRemoteWatcherRetries,
  pendingRemoteWatcherRetryListeners,
  type RemoteWatcherResyncState,
  remoteWatcherResyncStates,
  inFlightRemoteInstalls,
  pendingRemoteInstallPromises,
  remoteWatchersClosed,
  remoteWatcherLifecycleGeneration,
  unsubscribeFromProviderRegistrations,
  REMOTE_WATCH_RETRY_MS,
  REMOTE_WATCH_RETRY_TIMEOUT_MS,
  REMOTE_WATCH_RESYNC_COALESCE_MS,
  REMOTE_WATCH_DORMANT_RETRY_MS,
  REMOTE_WATCH_DORMANT_RETRY_MAX_MS,
  closeRemoteWatcherForWorktreePath,
  restoreRemoteWatcherAfterFailedRemoval,
  forgetRemoteWatcherRemovalSnapshot } from './filesystem-watcher-removal'

export function addInFlightRemoteInstallListener(
  token: RemoteWatcherInstallToken,
  sender: WebContents
): void {
  if (sender.isDestroyed() || token.abortController.signal.aborted) {
    return
  }
  token.listeners.set(sender.id, sender)
  token.cancelled = false
  registerSenderCleanup(sender)
}

export function cancelInFlightRemoteInstallIfUnowned(token: RemoteWatcherInstallToken): void {
  token.cancelled = token.listeners.size === 0
  if (!token.cancelled || token.abortScheduled || token.abortController.signal.aborted) {
    return
  }
  token.abortScheduled = true
  // Why: a replacement sender can synchronously revive the shared install during a renderer handoff; otherwise stop the relay crawl next microtask.
  queueMicrotask(() => {
    token.abortScheduled = false
    if (token.cancelled && token.listeners.size === 0) {
      token.abortController.abort()
    }
  })
}

export function cleanupInFlightRemoteInstallsForSender(senderId: number): void {
  for (const token of inFlightRemoteInstalls.values()) {
    token.listeners.delete(senderId)
    cancelInFlightRemoteInstallIfUnowned(token)
  }
  for (const [key, retry] of pendingRemoteWatcherRetryListeners) {
    retry.listeners.delete(senderId)
    if (retry.listeners.size === 0) {
      const timer = pendingRemoteWatcherRetries.get(key)
      if (timer) {
        clearTimeout(timer)
        pendingRemoteWatcherRetries.delete(key)
      }
      pendingRemoteWatcherRetryListeners.delete(key)
    }
  }
}

export function addRemoteWatchListener(key: string, sender: WebContents): void {
  const state = remoteWatchers.get(key)
  if (!state) {
    return
  }
  state.listeners.set(sender.id, sender)
  registerSenderCleanup(sender)
}

export function releaseRemoteWatchListener(key: string, senderId: number): void {
  const state = remoteWatchers.get(key)
  if (!state) {
    return
  }
  state.listeners.delete(senderId)
  if (state.listeners.size > 0) {
    return
  }
  state.unwatch()
  remoteWatchers.delete(key)
}

export function cleanupRemoteWatchersForSender(senderId: number): void {
  for (const key of Array.from(desiredRemoteWatchers.keys())) {
    forgetDesiredRemoteWatcher(key, senderId)
  }
  for (const [key, suspended] of suspendedRemoteWatcherListeners) {
    suspended.listeners.delete(senderId)
    if (suspended.listeners.size === 0) {
      suspendedRemoteWatcherListeners.delete(key)
    }
  }
  cleanupInFlightRemoteInstallsForSender(senderId)
  for (const key of Array.from(remoteWatchers.keys())) {
    releaseRemoteWatchListener(key, senderId)
  }
}

export type RemoteWatcherInstallResult = 'installed' | 'unavailable' | 'cancelled'

export async function installRemoteWatcher(
  sender: WebContents,
  connectionId: string,
  worktreePath: string,
  generation = remoteWatcherLifecycleGeneration
): Promise<RemoteWatcherInstallResult> {
  // Why: refuse installs racing in after teardown (or a waiter from an earlier lifecycle) so provider.watch() isn't called post-shutdown.
  if (remoteWatchersClosed || generation !== remoteWatcherLifecycleGeneration) {
    return 'cancelled'
  }
  const finishInstall = beginWatcherInstall(worktreePath, connectionId)
  try {
    return await installRemoteWatcherWhileRemovalAllowed(
      sender,
      connectionId,
      worktreePath,
      generation
    )
  } finally {
    finishInstall()
  }
}

export async function installRemoteWatcherWhileRemovalAllowed(
  sender: WebContents,
  connectionId: string,
  worktreePath: string,
  generation: number
): Promise<RemoteWatcherInstallResult> {
  const provider = getSshFilesystemProvider(connectionId)
  if (!provider || sender.isDestroyed()) {
    return 'unavailable'
  }

  const key = remoteWatcherKey(connectionId, worktreePath)
  const existing = remoteWatchers.get(key)
  if (existing) {
    addRemoteWatchListener(key, sender)
    return 'installed'
  }
  // Why: concurrent same-key watches must share the first provider.watch(); separate watchers would clobber per-key state and drop the unwatch handle.
  const pendingInstall = pendingRemoteInstallPromises.get(key)
  if (pendingInstall) {
    const inFlight = inFlightRemoteInstalls.get(key)
    const canJoinInstall = inFlight && !inFlight.abortController.signal.aborted
    if (canJoinInstall) {
      // Why: a new watcher joining before provider.watch() resolves should revive the install instead of inheriting the stale cancellation.
      addInFlightRemoteInstallListener(inFlight, sender)
    }
    const result = await pendingInstall
    if (
      result === 'installed' &&
      remoteWatchers.has(key) &&
      !sender.isDestroyed() &&
      (!inFlight || inFlight.listeners.has(sender.id))
    ) {
      addRemoteWatchListener(key, sender)
    }
    if (
      result === 'cancelled' &&
      !canJoinInstall &&
      !sender.isDestroyed() &&
      generation === remoteWatcherLifecycleGeneration
    ) {
      // Why: AbortSignal can't be revived; a listener arriving after cancellation waits out that generation, then owns a fresh install.
      if (pendingRemoteInstallPromises.get(key) === pendingInstall) {
        pendingRemoteInstallPromises.delete(key)
      }
      return installRemoteWatcher(sender, connectionId, worktreePath, generation)
    }
    return result
  }
  const cancelToken: RemoteWatcherInstallToken = {
    cancelled: false,
    listeners: new Map(),
    abortController: new AbortController(),
    abortScheduled: false
  }
  inFlightRemoteInstalls.set(key, cancelToken)
  addInFlightRemoteInstallListener(cancelToken, sender)
  const installPromise = doInstallRemoteWatcher(
    provider,
    key,
    connectionId,
    worktreePath,
    cancelToken
  )
  pendingRemoteInstallPromises.set(key, installPromise)
  try {
    return await installPromise
  } finally {
    if (pendingRemoteInstallPromises.get(key) === installPromise) {
      pendingRemoteInstallPromises.delete(key)
    }
  }
}

export async function doInstallRemoteWatcher(
  provider: NonNullable<ReturnType<typeof getSshFilesystemProvider>>,
  key: string,
  connectionId: string,
  worktreePath: string,
  cancelToken: RemoteWatcherInstallToken
): Promise<RemoteWatcherInstallResult> {
  let unwatch: () => void
  try {
    unwatch = await provider.watch(
      worktreePath,
      (events) => {
        const state = remoteWatchers.get(key)
        if (!state) {
          return
        }
        for (const listener of state.listeners.values()) {
          if (listener.isDestroyed()) {
            continue
          }
          listener.send('fs:changed', {
            worktreePath,
            events
          } satisfies FsChangedPayload)
        }
      },
      {
        signal: cancelToken.abortController.signal,
        onTerminalError: (error) =>
          handleRemoteWatcherTerminalError(key, connectionId, worktreePath, cancelToken, error)
      }
    )
  } catch (err) {
    if (cancelToken.cancelled || cancelToken.abortController.signal.aborted) {
      return 'cancelled'
    }
    console.warn(`[filesystem-watcher] SSH watcher unavailable for ${key}:`, err)
    return 'unavailable'
  } finally {
    if (inFlightRemoteInstalls.get(key) === cancelToken) {
      inFlightRemoteInstalls.delete(key)
    }
  }
  const liveListeners = new Map(
    Array.from(cancelToken.listeners.entries()).filter(([, listener]) => !listener.isDestroyed())
  )
  if (cancelToken.cancelled || liveListeners.size === 0) {
    try {
      unwatch()
    } catch (err) {
      console.error(`[filesystem-watcher] remote unwatch (post-cancel) error for ${key}:`, err)
    }
    return 'cancelled'
  }
  if (cancelToken.terminalError) {
    return 'unavailable'
  }
  remoteWatchers.set(key, { unwatch, listeners: liveListeners, installToken: cancelToken })
  for (const listener of liveListeners.values()) {
    registerSenderCleanup(listener)
  }
  loggedUnavailableRemoteWatchers.delete(key)
  return 'installed'
}

export function handleRemoteWatcherTerminalError(
  key: string,
  connectionId: string,
  worktreePath: string,
  installToken: RemoteWatcherInstallToken,
  error: Error
): void {
  installToken.terminalError = error
  const state = remoteWatchers.get(key)
  if (!state || state.installToken !== installToken) {
    return
  }
  remoteWatchers.delete(key)
  if (remoteWatchersClosed || suspendedRemoteWatcherListeners.has(key)) {
    return
  }
  console.warn(`[filesystem-watcher] SSH watcher terminated for ${key}:`, error)
  const startedAt = Date.now()
  for (const listener of state.listeners.values()) {
    scheduleRemoteWatcherRetry(listener, connectionId, worktreePath, startedAt, true)
  }
}

export function isCurrentDesiredRemoteWatcher(key: string, listener: WebContents): boolean {
  return desiredRemoteWatchers.get(key)?.listeners.get(listener.id) === listener
}

export function clearRemoteWatcherResync(key: string): void {
  const state = remoteWatcherResyncStates.get(key)
  if (state?.timer) {
    clearTimeout(state.timer)
  }
  remoteWatcherResyncStates.delete(key)
}
