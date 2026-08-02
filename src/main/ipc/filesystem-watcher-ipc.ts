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

// ── Debounce helpers ─────────────────────────────────────────────────

import { addInFlightRemoteInstallListener,
  cancelInFlightRemoteInstallIfUnowned,
  cleanupInFlightRemoteInstallsForSender,
  addRemoteWatchListener,
  releaseRemoteWatchListener,
  cleanupRemoteWatchersForSender,
  type RemoteWatcherInstallResult,
  installRemoteWatcher,
  installRemoteWatcherWhileRemovalAllowed,
  doInstallRemoteWatcher,
  handleRemoteWatcherTerminalError,
  isCurrentDesiredRemoteWatcher,
  clearRemoteWatcherResync } from './filesystem-watcher-retry'
export { addInFlightRemoteInstallListener,
  cancelInFlightRemoteInstallIfUnowned,
  cleanupInFlightRemoteInstallsForSender,
  addRemoteWatchListener,
  releaseRemoteWatchListener,
  cleanupRemoteWatchersForSender,
  type RemoteWatcherInstallResult,
  installRemoteWatcher,
  installRemoteWatcherWhileRemovalAllowed,
  doInstallRemoteWatcher,
  handleRemoteWatcherTerminalError,
  isCurrentDesiredRemoteWatcher,
  clearRemoteWatcherResync } from './filesystem-watcher-retry'

export function flushRemoteWatcherResync(key: string): void {
  const state = remoteWatcherResyncStates.get(key)
  if (!state) {
    return
  }
  state.timer = undefined
  if (
    remoteWatchersClosed ||
    suspendedRemoteWatcherListeners.has(key) ||
    !remoteWatchers.has(key)
  ) {
    if (!desiredRemoteWatchers.has(key)) {
      remoteWatcherResyncStates.delete(key)
    }
    return
  }
  let sent = false
  for (const listener of state.listeners.values()) {
    if (listener.isDestroyed() || !isCurrentDesiredRemoteWatcher(key, listener)) {
      continue
    }
    try {
      listener.send('fs:changed', {
        worktreePath: state.worktreePath,
        events: [{ kind: 'overflow', absolutePath: state.worktreePath }]
      } satisfies FsChangedPayload)
      sent = true
    } catch (error) {
      console.warn(`[filesystem-watcher] failed to send SSH watcher resync for ${key}:`, error)
    }
  }
  state.listeners.clear()
  if (sent) {
    state.lastSentAt = Date.now()
  } else {
    remoteWatcherResyncStates.delete(key)
  }
}

export function requestRemoteWatcherResync(
  key: string,
  worktreePath: string,
  listeners: Iterable<WebContents>
): void {
  const state = remoteWatcherResyncStates.get(key) ?? {
    lastSentAt: Number.NEGATIVE_INFINITY,
    listeners: new Map<number, WebContents>(),
    worktreePath
  }
  state.worktreePath = worktreePath
  for (const listener of listeners) {
    if (!listener.isDestroyed() && isCurrentDesiredRemoteWatcher(key, listener)) {
      state.listeners.set(listener.id, listener)
    }
  }
  if (state.listeners.size === 0) {
    return
  }
  remoteWatcherResyncStates.set(key, state)
  const delayMs = Math.max(0, state.lastSentAt + REMOTE_WATCH_RESYNC_COALESCE_MS - Date.now())
  if (delayMs === 0) {
    flushRemoteWatcherResync(key)
    return
  }
  if (!state.timer) {
    state.timer = setTimeout(() => flushRemoteWatcherResync(key), delayMs)
    state.timer.unref?.()
  }
}

export function scheduleRemoteWatcherRetry(
  sender: WebContents,
  connectionId: string,
  worktreePath: string,
  startedAt = Date.now(),
  // Why: a retry that replaces a watch which was already live owes the renderer an overflow once it
  // lands — the events lost while it was down are otherwise never signalled.
  resyncOnInstall = false
): void {
  const key = remoteWatcherKey(connectionId, worktreePath)
  const existingRetry = pendingRemoteWatcherRetryListeners.get(key)
  if (existingRetry) {
    if (!sender.isDestroyed()) {
      existingRetry.listeners.set(sender.id, sender)
    }
    existingRetry.resyncOnInstall ||= resyncOnInstall
    return
  }

  const retry = {
    listeners: new Map(sender.isDestroyed() ? [] : [[sender.id, sender]]),
    startedAt,
    resyncOnInstall
  }
  pendingRemoteWatcherRetryListeners.set(key, retry)

  if (Date.now() - startedAt >= REMOTE_WATCH_RETRY_TIMEOUT_MS || sender.isDestroyed()) {
    pendingRemoteWatcherRetries.delete(key)
    pendingRemoteWatcherRetryListeners.delete(key)
    loggedUnavailableRemoteWatchers.delete(key)
    clearRemoteWatcherResync(key)
    // Why: handler already resolved so the renderer thinks the watch is live; emit overflow to force a manual refresh instead of waiting forever.
    for (const listener of retry.listeners.values()) {
      if (listener.isDestroyed() || !isCurrentDesiredRemoteWatcher(key, listener)) {
        continue
      }
      console.warn(
        `[filesystem-watcher] giving up SSH watch retry for ${worktreePath} on connection ${connectionId} after ${REMOTE_WATCH_RETRY_TIMEOUT_MS}ms`
      )
      listener.send('fs:changed', {
        worktreePath,
        events: [{ kind: 'overflow', absolutePath: worktreePath }]
      } satisfies FsChangedPayload)
    }
    // Why: overflow only refreshes once — without this the watch stays dead until the app restarts.
    scheduleDormantRemoteWatcherRearm(connectionId, worktreePath)
    return
  }

  const retryTimer = setTimeout(() => {
    pendingRemoteWatcherRetries.delete(key)
    pendingRemoteWatcherRetryListeners.delete(key)
    const listeners = Array.from(retry.listeners.values()).filter(
      (listener) => !listener.isDestroyed() && isCurrentDesiredRemoteWatcher(key, listener)
    )
    void Promise.all(
      listeners.map((listener) => installRemoteWatcher(listener, connectionId, worktreePath))
    )
      .then((results) => {
        if (retry.resyncOnInstall) {
          requestRemoteWatcherResync(
            key,
            worktreePath,
            listeners.filter((_, index) => results[index] === 'installed')
          )
        }
        // Why: don't re-arm on 'cancelled' (renderer stopped watching) — it would fire a stale overflow when the 60s window expires.
        if (results.some((result) => result === 'unavailable')) {
          for (const listener of listeners) {
            scheduleRemoteWatcherRetry(
              listener,
              connectionId,
              worktreePath,
              retry.startedAt,
              retry.resyncOnInstall
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
            connectionId,
            worktreePath,
            retry.startedAt,
            retry.resyncOnInstall
          )
        }
      })
  }, REMOTE_WATCH_RETRY_MS)
  pendingRemoteWatcherRetries.set(key, retryTimer)
}

// ── Public API ───────────────────────────────────────────────────────

export function registerFilesystemWatcherHandlers(): void {
  // Why: re-registration replaces the handler set, so drop the previous subscription instead of
  // stacking a second re-arm on every provider registration.
  unsubscribeFromProviderRegistrations?.()
  unsubscribeFromProviderRegistrations = onSshFilesystemProviderRegistered(
    reinstallRemoteWatchersForConnection
  )

  ipcMain.handle(
    'fs:watchWorktree',
    async (event, args: { worktreePath: string; connectionId?: string }): Promise<void> => {
      if (args.connectionId) {
        // Why: a real new watch reopens the subsystem after closeAllWatchers latched it shut (also resets tests between cases).
        remoteWatchersClosed = false
        const key = remoteWatcherKey(args.connectionId, args.worktreePath)
        // Why: record intent before the install so a provider registering mid-flight (or long after
        // this attempt gives up) can still re-arm this listener.
        rememberDesiredRemoteWatcher(args.connectionId, args.worktreePath, event.sender)
        const result = await installRemoteWatcher(
          event.sender,
          args.connectionId,
          args.worktreePath
        )
        if (result === 'unavailable') {
          if (!loggedUnavailableRemoteWatchers.has(key)) {
            loggedUnavailableRemoteWatchers.add(key)
            console.warn(
              `[filesystem-watcher] SSH filesystem provider unavailable; retrying watch for ${args.worktreePath} on connection ${args.connectionId}`
            )
          }
          scheduleRemoteWatcherRetry(event.sender, args.connectionId, args.worktreePath)
          return
        }
        return
      }
      // Why: reopen the local subsystem for tests and post-shutdown reattachment; stale callers keep the prior generation.
      localWatchersClosed = false
      await subscribe(args.worktreePath, event.sender)
    }
  )

  ipcMain.handle(
    'fs:unwatchWorktree',
    (_event, args: { worktreePath: string; connectionId?: string }): void => {
      if (args.connectionId) {
        const key = remoteWatcherKey(args.connectionId, args.worktreePath)
        // Why: the caller stopped watching on purpose — drop the intent or a later provider
        // registration would resurrect a watch nobody asked for.
        forgetDesiredRemoteWatcher(key, _event.sender.id)
        const suspended = suspendedRemoteWatcherListeners.get(key)
        suspended?.listeners.delete(_event.sender.id)
        if (suspended?.listeners.size === 0) {
          suspendedRemoteWatcherListeners.delete(key)
        }
        const retry = pendingRemoteWatcherRetryListeners.get(key)
        retry?.listeners.delete(_event.sender.id)
        const retryTimer = pendingRemoteWatcherRetries.get(key)
        if (retryTimer && retry?.listeners.size === 0) {
          clearTimeout(retryTimer)
          pendingRemoteWatcherRetries.delete(key)
          pendingRemoteWatcherRetryListeners.delete(key)
        }
        // Why: a retry-tick provider.watch() may still be in flight; mark cancelled so its resolved unwatch handle is discarded.
        const inFlight = inFlightRemoteInstalls.get(key)
        if (inFlight) {
          inFlight.listeners.delete(_event.sender.id)
          cancelInFlightRemoteInstallIfUnowned(inFlight)
        }
        loggedUnavailableRemoteWatchers.delete(key)
        releaseRemoteWatchListener(key, _event?.sender?.id ?? 0)
        return
      }
      const senderId = _event.sender.id
      unsubscribe(args.worktreePath, senderId)
    }
  )
}

export function remoteWatcherKey(connectionId: string, worktreePath: string): string {
  return JSON.stringify([connectionId, normalizeRuntimePathForComparison(worktreePath)])
}

export function rememberDesiredRemoteWatcher(
  connectionId: string,
  worktreePath: string,
  sender: WebContents
): void {
  if (sender.isDestroyed()) {
    return
  }
  const key = remoteWatcherKey(connectionId, worktreePath)
  const desired = desiredRemoteWatchers.get(key) ?? {
    connectionId,
    worktreePath,
    listeners: new Map<number, WebContents>()
  }
  desired.listeners.set(sender.id, sender)
  desiredRemoteWatchers.set(key, desired)
  registerSenderCleanup(sender)
}

export function forgetDesiredRemoteWatcher(key: string, senderId: number): void {
  const desired = desiredRemoteWatchers.get(key)
  if (!desired) {
    return
  }
  desired.listeners.delete(senderId)
  if (desired.listeners.size === 0) {
    desiredRemoteWatchers.delete(key)
    clearRemoteWatcherResync(key)
    clearDormantRemoteWatcher(key)
  }
}

export function clearDormantRemoteWatcher(key: string): void {
  const dormant = dormantRemoteWatchers.get(key)
  if (!dormant) {
    return
  }
  clearTimeout(dormant.timer)
  dormantRemoteWatchers.delete(key)
}

