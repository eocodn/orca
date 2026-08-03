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
import { registerSenderCleanup, subscribe } from './filesystem-watcher-local'

// ── Debounce helpers ─────────────────────────────────────────────────

export const DEBOUNCE_TRAILING_MS = 150
export const DEBOUNCE_MAX_WAIT_MS = 500

// ── Per-root watcher state ───────────────────────────────────────────
// WatchedRoot/WatcherSubscription live in filesystem-watcher-wsl.ts so native and WSL watchers share one shape.

// ── Module state ─────────────────────────────────────────────────────

export const watchedRoots = new Map<string, WatchedRoot>()

// Why: cache roots that failed watcher creation (e.g. WSL UNC paths) so we don't retry every worktree switch and spam the console with errors.
export const UNWATCHABLE_ROOT_CACHE_MAX = 256
export const unwatchableRoots = new Set<string>()

export function rememberUnwatchableRoot(rootKey: string): void {
  // Why: deleted worktrees churn through unique paths; cap the set so retry suppression stays useful without retaining every failed path.
  unwatchableRoots.delete(rootKey)
  unwatchableRoots.add(rootKey)
  while (unwatchableRoots.size > UNWATCHABLE_ROOT_CACHE_MAX) {
    const oldest = unwatchableRoots.keys().next().value
    if (oldest === undefined) {
      break
    }
    unwatchableRoots.delete(oldest)
  }
}

// Why: key cleanup by sender WebContents (not per root) to avoid MaxListeners warnings when a workspace has many worktrees open.
export const senderCleanupRegistered = new Set<number>()

// Why: recreating @parcel/watcher on Windows is expensive (ReadDirectoryChangesW + AV, 500ms+); a 30s grace lets rapid switches reuse the watcher.
export const WATCHER_TEARDOWN_GRACE_MS = 30_000
export const pendingTeardowns = new Map<string, ReturnType<typeof setTimeout>>()
// Why: @parcel/watcher unsubscribe does native async work that sender-destroy can start before shutdown, so will-quit must still await it.
export const pendingLocalUnsubscribes = new Set<Promise<void>>()
export const pendingLocalUnsubscribesByRoot = new Map<string, Set<Promise<void>>>()
export const suspendedLocalWatcherListeners = new Map<
  string,
  { worktreePath: string; listeners: Map<number, WebContents> }
>()
// Why: an install cancelled by shutdown can't be revived by a waiter that resumes after a later call reopens the subsystem.
export let localWatchersClosed = false
export let localWatcherLifecycleGeneration = 0
export function setLocalWatchersClosed(value: boolean): void {
  localWatchersClosed = value
}
export function setLocalWatcherLifecycleGeneration(value: number): void {
  localWatcherLifecycleGeneration = value
}
export const failedLocalUnsubscribes = new Map<string, unknown>()
// Why: a drain that timed out no longer gates the delete — Git removal already proceeded past it. Its
// late failure must not fail-close a *later* close of the same root, which would leave that path
// undeletable until the watcher process physically exits.
export const abandonedLocalUnsubscribes = new WeakSet<Promise<void>>()
export type LocalWatcherInstallToken = {
  cancelled: boolean
  listeners: Map<number, WebContents>
  abortController: AbortController
}
export type LocalWatcherInstallResult = 'installed' | 'unavailable' | 'capacity' | 'cancelled'
export type LocalWatcherCapacityRetry = {
  listeners: Map<number, WebContents>
  cancelWait: () => void
}
// Why: watcher creation is async; concurrent watch requests for the same root must share one install or later resolves orphan listeners.
export const inFlightLocalInstalls = new Map<string, LocalWatcherInstallToken>()
export const pendingLocalInstallPromises = new Map<string, Promise<LocalWatcherInstallResult>>()
export const pendingLocalCapacityRetries = new Map<string, LocalWatcherCapacityRetry>()

export function addInFlightLocalInstallListener(
  token: LocalWatcherInstallToken,
  sender: WebContents
): void {
  if (sender.isDestroyed() || token.abortController.signal.aborted) {
    return
  }
  token.listeners.set(sender.id, sender)
  token.cancelled = false
  registerSenderCleanup(sender)
}

export function cleanupInFlightLocalInstallsForSender(senderId: number): void {
  for (const token of inFlightLocalInstalls.values()) {
    token.listeners.delete(senderId)
    if (token.listeners.size === 0) {
      token.cancelled = true
      // Why: abort so a pending native/forked subscription stops early (matches closeLocalWatcherForWorktreePath / closeAllWatchers).
      token.abortController.abort()
    }
  }
  for (const [rootKey, retry] of pendingLocalCapacityRetries) {
    retry.listeners.delete(senderId)
    if (retry.listeners.size === 0) {
      retry.cancelWait()
      pendingLocalCapacityRetries.delete(rootKey)
    }
  }
}

export function takeLocalCapacityRetryListeners(rootKey: string): WebContents[] {
  const retry = pendingLocalCapacityRetries.get(rootKey)
  if (!retry) {
    return []
  }
  retry.cancelWait()
  pendingLocalCapacityRetries.delete(rootKey)
  return [...retry.listeners.values()].filter((listener) => !listener.isDestroyed())
}

export function clearLocalCapacityRetry(rootKey: string): void {
  const retry = pendingLocalCapacityRetries.get(rootKey)
  retry?.cancelWait()
  pendingLocalCapacityRetries.delete(rootKey)
}

export function scheduleLocalCapacityRetry(
  rootKey: string,
  worktreePath: string,
  listeners: Map<number, WebContents>
): void {
  const existing = pendingLocalCapacityRetries.get(rootKey)
  if (existing) {
    for (const listener of listeners.values()) {
      if (!listener.isDestroyed()) {
        existing.listeners.set(listener.id, listener)
      }
    }
    return
  }

  let retry!: LocalWatcherCapacityRetry
  const cancelWait = onWatcherChildCapacityAvailable(async () => {
    if (pendingLocalCapacityRetries.get(rootKey) !== retry) {
      return
    }
    pendingLocalCapacityRetries.delete(rootKey)
    await Promise.all(
      [...retry.listeners.values()].map(async (listener) => {
        if (listener.isDestroyed()) {
          return
        }
        await subscribe(worktreePath, listener).catch((error: unknown) => {
          if (!isWatcherRemovalInProgressError(error)) {
            console.error(`[filesystem-watcher] capacity retry failed for ${rootKey}:`, error)
          }
        })
      })
    )
  })
  retry = { listeners: new Map(), cancelWait }
  pendingLocalCapacityRetries.set(rootKey, retry)
  for (const listener of listeners.values()) {
    if (!listener.isDestroyed()) {
      retry.listeners.set(listener.id, listener)
      registerSenderCleanup(listener)
    }
  }
  if (retry.listeners.size === 0) {
    clearLocalCapacityRetry(rootKey)
  }
}

// ── Path normalization ───────────────────────────────────────────────

export function normalizeRootPath(rootPath: string): string {
  let resolved = isWindowsAbsolutePathLike(rootPath)
    ? path.win32.resolve(rootPath)
    : path.resolve(rootPath)
  // Why: Windows watcher events may use lowercase drive letters vs stored uppercase; normalize so renderer casing stays consistent (§4.4).
  if (/^[a-zA-Z]:/.test(resolved)) {
    resolved = resolved.charAt(0).toUpperCase() + resolved.slice(1)
  }
  return resolved
}

export function localWatcherRoot(rootPath: string): { key: string; path: string } {
  const normalizedPath = normalizeRootPath(rootPath)
  return {
    // Why: Windows drive/UNC paths are case-insensitive; cleanup must match the owner even when Git returns a different spelling.
    key: normalizeRuntimePathForComparison(normalizedPath),
    path: normalizedPath
  }
}

export function normalizeEventPath(eventPath: string): string {
  let resolved = path.resolve(eventPath)
  if (/^[a-zA-Z]:/.test(resolved)) {
    resolved = resolved.charAt(0).toUpperCase() + resolved.slice(1)
  }
  return resolved
}

// ── Event coalescing ─────────────────────────────────────────────────
// Why: keep the last event per path in a flush window; delete→create emits both (delete cleans the subtree, create refreshes the parent), create→delete is dropped (§4.4).

export function coalesceEvents(
  raw: WatcherEvent[]
): { type: 'create' | 'update' | 'delete'; path: string }[] {
  const lastByPath = new Map<string, { type: 'create' | 'update' | 'delete'; index: number }>()
  const deleteBeforeCreate = new Set<string>()

  for (let i = 0; i < raw.length; i++) {
    const evt = raw[i]
    const p = normalizeEventPath(evt.path)
    const prev = lastByPath.get(p)

    if (prev) {
      // delete followed by create → emit both
      if (prev.type === 'delete' && evt.type === 'create') {
        deleteBeforeCreate.add(p)
      }
      // create followed by delete → net no-op, remove both
      if (prev.type === 'create' && evt.type === 'delete') {
        lastByPath.delete(p)
        deleteBeforeCreate.delete(p)
        continue
      }
    }

    lastByPath.set(p, { type: evt.type, index: i })

    // Why: drop the stale delete when a later event supersedes delete→create, else output has a spurious delete for a file that still exists (§4.4).
    if (evt.type !== 'create' && deleteBeforeCreate.has(p)) {
      deleteBeforeCreate.delete(p)
    }
  }

  const result: { type: 'create' | 'update' | 'delete'; path: string }[] = []

  // Emit delete events first for paths that have delete→create
  for (const p of deleteBeforeCreate) {
    result.push({ type: 'delete', path: p })
  }

  // Emit the last event for each path
  for (const [p, entry] of lastByPath) {
    result.push({ type: entry.type, path: p })
  }

  return result
}

// ── Stat helper for isDirectory ──────────────────────────────────────

export async function tryStatIsDirectory(filePath: string): Promise<boolean | undefined> {
  try {
    const s = await stat(filePath)
    return s.isDirectory()
  } catch {
    // Why: stat failure (EPERM, vanished file) → undefined; renderer treats it as a file event, the safe default (§4.4).
    return undefined
  }
}

// ── Flush and emit ───────────────────────────────────────────────────

export function emitOverflowPayload(root: WatchedRoot): void {
  const { rootPath } = root
  const payload: FsChangedPayload = {
    worktreePath: rootPath,
    events: [{ kind: 'overflow', absolutePath: rootPath }]
  }
  for (const [, wc] of root.listeners) {
    if (!wc.isDestroyed()) {
      wc.send('fs:changed', payload)
    }
  }
}
