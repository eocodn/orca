import {
  collectLeafIdsInOrder,
  serializePaneTree
} from '@/components/terminal-pane/layout-serialization'
import { warnTerminalLifecycleAnomaly } from '@/components/terminal-pane/terminal-lifecycle-diagnostics'
import { getEagerPtyBufferHandle } from '@/components/terminal-pane/pty-dispatcher'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { resolveLeafIdForManager } from '@/lib/pane-manager/pane-key-resolution'
import { getSystemPrefersDark, resolveEffectiveTerminalAppearance } from '@/lib/terminal-theme'
import { sanitizeTerminalLayoutPaneTitles } from '@/lib/terminal-pane-title-sanitization'
import type { AppState } from '@/store/types'
import type {
  RuntimeMobileSessionSnapshotTab,
  RuntimeMobileSessionTabsSnapshot,
  RuntimeSyncWindowGraph
} from '../../../shared/runtime-types'
import { isTerminalLeafId } from '../../../shared/stable-pane-id'
import type { Tab } from '../../../shared/types'
import { resolveTerminalLayoutRoot } from './remote-terminal-layout-resolution'

export type RegisteredTerminalTab = {
  tabId: string
  worktreeId: string
  getManager: () => PaneManager | null
  getContainer: () => HTMLDivElement | null
  getPtyIdForPane: (paneId: number) => string | null
}

export type OpenFileByWorktreeAndId = Map<string, Map<string, AppState['openFiles'][number]>>
export type OpenFileIndexes = {
  byWorktreeAndId: OpenFileByWorktreeAndId
  idsByWorktree: Map<string, string[]>
}
export type FallbackEditorTabTarget = {
  tabId: string
  groupId: string | null
}
export const registeredTabs = new Map<string, RegisteredTerminalTab>()
// Why: registration time suppresses the "no live transport" warning during the async PTY-connect window; after the grace period it's a real stuck state.
export const tabRegisteredAt = new Map<string, number>()
export const NO_TRANSPORT_GRACE_MS = 10_000
export const EMPTY_LAYOUT_BY_WORKTREE: AppState['layoutByWorktree'] = {}
export const RUNTIME_GRAPH_SYNC_COALESCE_MS = 16
export let syncScheduled = false
export let syncInFlight = false
export let syncPendingAfterFlight = false
export let syncEnabled = false
export let syncTimer: ReturnType<typeof setTimeout> | null = null
export let getStoreState: (() => AppState) | null = null
export let mobileSessionSnapshotVersion = 0
// Why: main gates per-worktree mobile fanout on (publicationEpoch,
// snapshotVersion), so that pair must be a semantic revision: reuse the cached
// snapshot (same version) whenever a worktree's mobile-visible content is
// unchanged, and bump the version only for worktrees that actually changed.
export const mobileSessionSnapshotCacheByWorktree = new Map<
  string,
  { content: unknown; snapshot: RuntimeMobileSessionTabsSnapshot }
>()

// Structural equality under JSON-serialization semantics (undefined-valued
// keys are absent), so version reuse matches a JSON fingerprint exactly
// without allocating a serialized copy of the payload on every graph sync.
// Any value strict-equality can't prove equal (e.g. NaN) reads as changed,
// which only costs a redundant fanout — never a suppressed one.
export function jsonContentEquals(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false
    }
    return a.every((item, index) => jsonContentEquals(item, b[index]))
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false
  }
  const aRecord = a as Record<string, unknown>
  const bRecord = b as Record<string, unknown>
  for (const key of Object.keys(aRecord)) {
    if (!jsonContentEquals(aRecord[key], bRecord[key])) {
      return false
    }
  }
  for (const key of Object.keys(bRecord)) {
    if (bRecord[key] !== undefined && aRecord[key] === undefined) {
      return false
    }
  }
  return true
}
export let cachedEditorDraftsSource: AppState['editorDrafts'] | null = null
export let cachedEditorDraftVersionByFileId: Map<string, string> | null = null
export const mobileSessionPublicationEpoch = `renderer:${createBrowserUuid()}`

export function setRuntimeGraphStoreStateGetter(getter: (() => AppState) | null): void {
  getStoreState = getter
}

/** True while a TerminalPane for this tab is mounted (lifecycle effect ran). */
export function hasRegisteredRuntimeTerminalTab(tabId: string): boolean {
  return registeredTabs.has(tabId)
}

export function registerRuntimeTerminalTab(tab: RegisteredTerminalTab): () => void {
  registeredTabs.set(tab.tabId, tab)
  tabRegisteredAt.set(tab.tabId, Date.now())
  scheduleRuntimeGraphSync()
  return () => {
    // Why: React can mount a replacement surface before the prior effect cleans up; stale cleanup must not erase the successor's registry.
    if (registeredTabs.get(tab.tabId) !== tab) {
      return
    }
    registeredTabs.delete(tab.tabId)
    tabRegisteredAt.delete(tab.tabId)
    scheduleRuntimeGraphSync()
  }
}

export function focusRuntimeTerminalSurface(tabId: string, leafId?: string | null): boolean {
  const registered = registeredTabs.get(tabId)
  const manager = registered?.getManager()
  if (!manager) {
    return false
  }
  if (!leafId) {
    manager.getActivePane()?.terminal.focus()
    return true
  }
  const resolution = resolveLeafIdForManager(tabId, leafId, manager)
  if (resolution.status !== 'resolved') {
    return false
  }
  manager.setActivePane(resolution.numericPaneId, { focus: true })
  scheduleRuntimeGraphSync()
  return true
}

export function setRuntimeGraphSyncEnabled(enabled: boolean): void {
  syncEnabled = enabled
  if (!enabled) {
    syncPendingAfterFlight = false
    clearScheduledRuntimeGraphSync()
    return
  }
  scheduleRuntimeGraphSync()
}

export function clearScheduledRuntimeGraphSync(): void {
  if (syncTimer !== null) {
    clearTimeout(syncTimer)
    syncTimer = null
  }
  syncScheduled = false
}

export function scheduleRuntimeGraphSync(): void {
  if (!syncEnabled || syncScheduled) {
    return
  }
  if (syncInFlight) {
    syncPendingAfterFlight = true
    return
  }
  syncScheduled = true
  // Why: a frame-sized timer collapses separate title/status IPC tasks into one graph publish without tying publication to paint frames.
  syncTimer = setTimeout(() => {
    syncTimer = null
    syncScheduled = false
    void runRuntimeGraphSync()
  }, RUNTIME_GRAPH_SYNC_COALESCE_MS)
}

import { syncRuntimeGraph } from './runtime-graph-window-publisher'
export { resolveRuntimeTerminalTitle } from './runtime-graph-mobile-projections'
export type { RuntimeMobileSessionSyncKey } from './runtime-graph-mobile-projections'
export {
  buildRuntimeMobileAgentStatusProjectionForTests,
  canSkipRuntimeMobileSessionSyncKeyBuild,
  getRuntimeMobileSessionSyncKey,
  resetRuntimeMobileAgentStatusProjectionCacheForTests,
  runtimeMobileSessionSyncKeysEqual
} from './runtime-graph-mobile-projections'

async function runRuntimeGraphSync(): Promise<void> {
  if (syncInFlight) {
    syncPendingAfterFlight = true
    return
  }
  syncInFlight = true
  try {
    await syncRuntimeGraph()
  } finally {
    syncInFlight = false
    if (syncPendingAfterFlight) {
      syncPendingAfterFlight = false
      // Why: coalesce updates that arrived during one in-flight sync into a single trailing graph instead of stacking concurrent IPC calls.
      scheduleRuntimeGraphSync()
    }
  }
}






export { syncRuntimeGraph } from './runtime-graph-window-publisher'
export { buildMobileSessionTabSnapshots } from './runtime-graph-mobile-snapshot-builder'
