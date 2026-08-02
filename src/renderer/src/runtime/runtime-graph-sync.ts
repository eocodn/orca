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
import { applyNativeChatLaunchDraftResolved } from './native-chat-launch-draft-runtime-resolution'

type RegisteredTerminalTab = {
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
const tabRegisteredAt = new Map<string, number>()
const NO_TRANSPORT_GRACE_MS = 10_000
const EMPTY_LAYOUT_BY_WORKTREE: AppState['layoutByWorktree'] = {}
const RUNTIME_GRAPH_SYNC_COALESCE_MS = 16
let syncScheduled = false
let syncInFlight = false
let syncPendingAfterFlight = false
let syncEnabled = false
let syncTimer: ReturnType<typeof setTimeout> | null = null
let getStoreState: (() => AppState) | null = null
let mobileSessionSnapshotVersion = 0
// Why: main gates per-worktree mobile fanout on (publicationEpoch,
// snapshotVersion), so that pair must be a semantic revision: reuse the cached
// snapshot (same version) whenever a worktree's mobile-visible content is
// unchanged, and bump the version only for worktrees that actually changed.
const mobileSessionSnapshotCacheByWorktree = new Map<
  string,
  { content: unknown; snapshot: RuntimeMobileSessionTabsSnapshot }
>()

// Structural equality under JSON-serialization semantics (undefined-valued
// keys are absent), so version reuse matches a JSON fingerprint exactly
// without allocating a serialized copy of the payload on every graph sync.
// Any value strict-equality can't prove equal (e.g. NaN) reads as changed,
// which only costs a redundant fanout — never a suppressed one.
function jsonContentEquals(a: unknown, b: unknown): boolean {
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
let cachedEditorDraftsSource: AppState['editorDrafts'] | null = null
let cachedEditorDraftVersionByFileId: Map<string, string> | null = null
const mobileSessionPublicationEpoch = `renderer:${createBrowserUuid()}`

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

function clearScheduledRuntimeGraphSync(): void {
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

import {
  type RuntimeMobileSessionSyncKey,
  buildRuntimeMobileAgentStatusProjectionForTests,
  canSkipRuntimeMobileSessionSyncKeyBuild,
  getRuntimeMobileSessionSyncKey,
  getBrowserTabsByWorktree,
  resetRuntimeMobileAgentStatusProjectionCacheForTests,
  runtimeMobileSessionSyncKeysEqual,
  resolveRuntimeTerminalTitle
} from './runtime-graph-mobile-projections'
export { resolveRuntimeTerminalTitle } from './runtime-graph-mobile-projections'
export type { RuntimeMobileSessionSyncKey } from './runtime-graph-mobile-projections'
export {
  buildRuntimeMobileAgentStatusProjectionForTests,
  canSkipRuntimeMobileSessionSyncKeyBuild,
  getRuntimeMobileSessionSyncKey,
  resetRuntimeMobileAgentStatusProjectionCacheForTests,
  runtimeMobileSessionSyncKeysEqual
} from './runtime-graph-mobile-projections'



async function syncRuntimeGraph(): Promise<void> {
  if (!syncEnabled || !getStoreState) {
    return
  }
  // Why: can't import the store directly (terminal slice imports this module); inject the getter to break the construction cycle.
  const state = getStoreState()
  const systemPrefersDark = getSystemPrefersDark()
  // Why: build lookup maps once per sync instead of re-flattening every worktree's tabs for each registered terminal.
  const terminalTabById = new Map(
    Object.values(state.tabsByWorktree)
      .flat()
      .map((tab) => [tab.id, tab])
  )
  const generatedTitlesEnabled = state.settings?.tabAutoGenerateTitle === true
  const graph: RuntimeSyncWindowGraph = {
    tabs: [],
    leaves: [],
    mobileSessionTabs: buildMobileSessionTabSnapshots(state, systemPrefersDark)
  }

  for (const [tabId, registeredTab] of registeredTabs) {
    const tab = terminalTabById.get(tabId)
    if (!tab) {
      continue
    }
    if (isWebOnlyMirroredTerminalTab(state, tab)) {
      continue
    }

    const manager = registeredTab.getManager()
    const container = registeredTab.getContainer()
    const activePaneId = manager?.getActivePane()?.id ?? null
    const root =
      container?.firstElementChild instanceof HTMLElement ? container.firstElementChild : null

    graph.tabs.push({
      tabId,
      worktreeId: registeredTab.worktreeId,
      title: resolveRuntimeTerminalTitle(tab, generatedTitlesEnabled),
      activeLeafId: activePaneId === null ? null : (manager?.getLeafId(activePaneId) ?? null),
      layout: serializePaneTree(root)
    })

    const savedPtyIdsByLeafId = state.terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId ?? {}
    for (const pane of manager?.getPanes() ?? []) {
      const leafId = pane.leafId
      const ptyId = registeredTab.getPtyIdForPane(pane.id)
      const savedPtyId = savedPtyIdsByLeafId[leafId] ?? null
      const registeredTime = tabRegisteredAt.get(tabId) ?? 0
      if (!ptyId && savedPtyId && Date.now() - registeredTime > NO_TRANSPORT_GRACE_MS) {
        warnTerminalLifecycleAnomaly('mounted terminal leaf has saved PTY but no live transport', {
          tabId,
          worktreeId: registeredTab.worktreeId,
          leafId,
          paneId: pane.id,
          ptyId: savedPtyId
        })
      }
      const paneTitles = state.runtimePaneTitlesByTabId[tabId] ?? {}
      graph.leaves.push({
        tabId,
        worktreeId: registeredTab.worktreeId,
        leafId,
        paneRuntimeId: pane.id,
        ptyId,
        paneTitle: paneTitles[pane.id] ?? null,
        title: resolveRuntimeTerminalTitle(
          tab,
          generatedTitlesEnabled,
          state.runtimePaneTitlesByTabId[tabId]?.[pane.id] ?? tab.title
        )
      })
    }
  }

  // Why: inactive automation tabs never mount a TerminalPane; publish their leaf+ptyId from persisted layout (gated on a live buffer) or the live PTY looks orphaned.
  for (const [worktreeId, tabs] of Object.entries(state.tabsByWorktree)) {
    for (const tab of tabs) {
      if (registeredTabs.has(tab.id) || isWebOnlyMirroredTerminalTab(state, tab)) {
        continue
      }
      const layout = state.terminalLayoutsByTabId[tab.id]
      const savedPtyIdsByLeafId = layout?.ptyIdsByLeafId
      if (!savedPtyIdsByLeafId) {
        continue
      }
      const liveLeaves = Object.entries(savedPtyIdsByLeafId).filter(
        ([leafId, ptyId]) =>
          typeof ptyId === 'string' &&
          ptyId.length > 0 &&
          isTerminalLeafId(leafId) &&
          Boolean(getEagerPtyBufferHandle(ptyId))
      )
      if (liveLeaves.length === 0) {
        continue
      }
      const title = resolveRuntimeTerminalTitle(tab, generatedTitlesEnabled)
      graph.tabs.push({
        tabId: tab.id,
        worktreeId,
        title,
        activeLeafId: layout?.activeLeafId ?? liveLeaves[0][0],
        layout: resolveTerminalLayoutRoot({
          authoritativeRoot: layout?.root,
          leafIds: liveLeaves.map(([leafId]) => leafId),
          onSynthesize: (leafCount) =>
            console.warn(
              `[sync-runtime-graph] synthesized layout for ${leafCount} unmounted leaves with no saved tree`
            )
        })
      })
      liveLeaves.forEach(([leafId, ptyId], index) => {
        graph.leaves.push({
          tabId: tab.id,
          worktreeId,
          leafId,
          paneRuntimeId: index + 1,
          ptyId,
          paneTitle: null,
          title
        })
      })
    }
  }

  try {
    const result = await window.api.runtime.syncWindowGraph(graph)
    const currentState = getStoreState()
    currentState?.setRuntimeAgentOrchestrationByPaneKey?.(result?.agentOrchestrationByPaneKey ?? {})
    for (const resolution of result?.nativeChatLaunchDraftResolutions ?? []) {
      if (currentState) {
        applyNativeChatLaunchDraftResolved(currentState, {
          type: 'nativeChatLaunchDraftResolved',
          ...resolution
        })
      }
    }
  } catch (error) {
    console.error('[runtime] Failed to sync renderer graph:', error)
  }
}

export function buildMobileSessionTabSnapshots(
  state: AppState,
  systemPrefersDark = getSystemPrefersDark()
): RuntimeMobileSessionTabsSnapshot[] {
  // Why: high-frequency title ticks fire mobile sync; cache indexes/hashes by store-slice ref to skip rescanning editor state.
  const openFileIndexes = getOpenFileIndexes(state.openFiles)
  const editorDraftVersionByFileId = getEditorDraftVersionByFileId(state.editorDrafts)
  const worktreeIds = new Set<string>([
    ...Object.keys(state.tabsByWorktree),
    ...Object.keys(state.groupsByWorktree),
    ...Object.keys(state.unifiedTabsByWorktree),
    ...Object.keys(getBrowserTabsByWorktree(state)),
    ...state.openFiles.map((file) => file.worktreeId)
  ])

  const snapshots: RuntimeMobileSessionTabsSnapshot[] = []
  for (const worktreeId of worktreeIds) {
    const activeGroupId = state.activeGroupIdByWorktree[worktreeId] ?? null
    const terminalTabByIdForWorktree = new Map(
      (state.tabsByWorktree[worktreeId] ?? []).map((tab) => [tab.id, tab])
    )
    const browserWorkspaceByIdForWorktree = new Map(
      (getBrowserTabsByWorktree(state)[worktreeId] ?? []).map((workspace) => [
        workspace.id,
        workspace
      ])
    )
    const unifiedTabByIdForWorktree = new Map(
      (state.unifiedTabsByWorktree[worktreeId] ?? []).map((tab) => [tab.id, tab])
    )
    const openFilesForWorktree = openFileIndexes.byWorktreeAndId.get(worktreeId)
    const editorIds = (openFileIndexes.idsByWorktree.get(worktreeId) ?? []).filter((fileId) => {
      const file = openFilesForWorktree?.get(fileId)
      return file ? isMobilePublishableOpenFile(file) : false
    })
    const publishableTerminalIds = [...terminalTabByIdForWorktree.values()]
      .filter((terminal) => !isWebOnlyMirroredTerminalTab(state, terminal))
      .map((terminal) => terminal.id)
    const groupProjection = buildMobileSessionGroupProjection(state, worktreeId, {
      terminalIds: publishableTerminalIds,
      editorIds,
      browserIds: [...browserWorkspaceByIdForWorktree.keys()]
    })
    const tabs: RuntimeMobileSessionSnapshotTab[] = []
    const emittedEditorFileIds = new Set<string>()
    const emittedEditorTabIds = new Set<string>()

    for (const item of groupProjection.order) {
      if (item.type === 'terminal') {
        const terminal = terminalTabByIdForWorktree.get(item.id)
        if (!terminal) {
          continue
        }
        if (isWebOnlyMirroredTerminalTab(state, terminal)) {
          continue
        }
        tabs.push(
          ...buildMobileTerminalSurfaceTabs(
            state,
            terminal,
            worktreeId,
            systemPrefersDark,
            item.tabId
          )
        )
      } else if (item.type === 'editor') {
        const file = openFilesForWorktree?.get(item.id)
        if (!file || !isMobilePublishableOpenFile(file)) {
          continue
        }
        const markdown = buildMobileMarkdownTab(
          state,
          openFileIndexes.byWorktreeAndId,
          editorDraftVersionByFileId,
          file,
          item.tabId ? unifiedTabByIdForWorktree.get(item.tabId) : undefined
        )
        if (markdown) {
          tabs.push(markdown)
        } else {
          tabs.push(
            buildMobileFileTab(
              state,
              file,
              item.tabId ? unifiedTabByIdForWorktree.get(item.tabId) : undefined
            )
          )
        }
        emittedEditorFileIds.add(file.id)
        emittedEditorTabIds.add(item.tabId ?? item.id)
      } else if (item.type === 'browser') {
        const workspace = browserWorkspaceByIdForWorktree.get(item.id)
        if (!workspace) {
          continue
        }
        tabs.push(
          buildMobileBrowserTab(
            state,
            workspace,
            item.tabId ? unifiedTabByIdForWorktree.get(item.tabId) : undefined
          )
        )
      }
    }

    // Why: split-group projection can miss plain editor files during hydration; publish them so mobile/web still mirror.
    const fallbackEditorTabs: FallbackEditorTabTarget[] = []
    if (openFilesForWorktree) {
      const unifiedEditorTabs = getEditorUnifiedTabsForWorktree(state, worktreeId)
      const unifiedEditorFileIds = new Set(unifiedEditorTabs.map((tab) => tab.entityId))
      for (const unifiedTab of unifiedEditorTabs) {
        if (emittedEditorTabIds.has(unifiedTab.id)) {
          continue
        }
        const file = openFilesForWorktree.get(unifiedTab.entityId)
        if (!file || !isMobilePublishableOpenFile(file)) {
          continue
        }
        const markdown = buildMobileMarkdownTab(
          state,
          openFileIndexes.byWorktreeAndId,
          editorDraftVersionByFileId,
          file,
          unifiedTab
        )
        const fallbackTab = markdown ?? buildMobileFileTab(state, file, unifiedTab)
        tabs.push(fallbackTab)
        fallbackEditorTabs.push({
          tabId: fallbackTab.id,
          groupId: unifiedTab.groupId
        })
        emittedEditorTabIds.add(unifiedTab.id)
      }
      for (const file of openFilesForWorktree.values()) {
        if (!isMobilePublishableOpenFile(file)) {
          continue
        }
        if (emittedEditorFileIds.has(file.id)) {
          continue
        }
        if (unifiedEditorFileIds.has(file.id)) {
          emittedEditorFileIds.add(file.id)
          continue
        }
        const markdown = buildMobileMarkdownTab(
          state,
          openFileIndexes.byWorktreeAndId,
          editorDraftVersionByFileId,
          file
        )
        const fallbackTab = markdown ?? buildMobileFileTab(state, file)
        tabs.push(fallbackTab)
        fallbackEditorTabs.push({
          tabId: fallbackTab.id,
          groupId: null
        })
        emittedEditorFileIds.add(file.id)
      }
    }

    const active = tabs.find((tab) => tab.isActive) ?? null
    const tabGroups = appendFallbackEditorTabsToGroups(
      groupProjection.tabGroups,
      state.groupsByWorktree[worktreeId] ?? [],
      activeGroupId,
      fallbackEditorTabs,
      active?.id ?? null
    )
    const tabGroupLayout =
      tabGroups && tabGroups.length > 0
        ? pruneTabGroupLayout(
            (state.layoutByWorktree ?? EMPTY_LAYOUT_BY_WORKTREE)[worktreeId],
            new Set(tabGroups.map((group) => group.id))
          )
        : groupProjection.tabGroupLayout
    const content = {
      activeGroupId,
      activeTabId: active?.id ?? null,
      activeTabType: active?.type ?? null,
      ...(tabGroups && tabGroups.length > 0 ? { tabGroups } : {}),
      ...(tabGroupLayout ? { tabGroupLayout } : {}),
      tabs
    }
    // Why: main suppresses per-worktree fanout on an unchanged (epoch, version)
    // pair, so reuse the cached version for structurally-identical content. The
    // global counter still advances per worktree per build (as before caching)
    // so a changed worktree's fresh version stays ahead of main's +1 bumps.
    const candidateVersion = ++mobileSessionSnapshotVersion
    const cached = mobileSessionSnapshotCacheByWorktree.get(worktreeId)
    if (cached && jsonContentEquals(cached.content, content)) {
      snapshots.push(cached.snapshot)
      continue
    }
    const snapshot: RuntimeMobileSessionTabsSnapshot = {
      worktree: worktreeId,
      publicationEpoch: mobileSessionPublicationEpoch,
      snapshotVersion: candidateVersion,
      ...content
    }
    mobileSessionSnapshotCacheByWorktree.set(worktreeId, { content, snapshot })
    snapshots.push(snapshot)
  }

  for (const worktreeId of mobileSessionSnapshotCacheByWorktree.keys()) {
    if (!worktreeIds.has(worktreeId)) {
      mobileSessionSnapshotCacheByWorktree.delete(worktreeId)
    }
  }

  return snapshots
}

function isEditorSurfaceTab(tab: Pick<Tab, 'contentType'>): boolean {
  // Why: mobile can mirror ordinary edit/diff files; conflict-review and check-details tabs need metadata this contract lacks.
  return tab.contentType === 'editor' || tab.contentType === 'diff'
}

import {
  appendFallbackEditorTabsToGroups,
  buildMobileSessionGroupProjection,
  getEditorUnifiedTabsForWorktree,
  getOpenFileIndexes,
  isWebOnlyMirroredTerminalTab,
  pruneTabGroupLayout
} from './runtime-graph-mobile-tab-projection'
import { isMobilePublishableOpenFile } from './runtime-graph-mobile-surface-builders'



function getEditorDraftVersionByFileId(
  editorDrafts: AppState['editorDrafts']
): Map<string, string> {
  if (cachedEditorDraftsSource === editorDrafts && cachedEditorDraftVersionByFileId) {
    return cachedEditorDraftVersionByFileId
  }

  const versions = new Map<string, string>()
  for (const [fileId, content] of Object.entries(editorDrafts)) {
    versions.set(fileId, stableHashString(content))
  }
  cachedEditorDraftsSource = editorDrafts
  cachedEditorDraftVersionByFileId = versions
  return versions
}

import {
  buildMobileBrowserTab,
  buildMobileFileTab,
  buildMobileMarkdownTab,
  buildMobileTerminalSurfaceTabs,
  stableHashString
} from './runtime-graph-mobile-surface-builders'
