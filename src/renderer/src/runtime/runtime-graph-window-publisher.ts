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
import {
  appendFallbackEditorTabsToGroups,
  buildMobileSessionGroupProjection,
  getEditorUnifiedTabsForWorktree,
  getOpenFileIndexes,
  isWebOnlyMirroredTerminalTab,
  pruneTabGroupLayout
} from './runtime-graph-mobile-tab-projection'
import { isMobilePublishableOpenFile } from './runtime-graph-mobile-surface-builders'
import {
  buildMobileBrowserTab,
  buildMobileFileTab,
  buildMobileMarkdownTab,
  buildMobileTerminalSurfaceTabs,
  stableHashString
} from './runtime-graph-mobile-surface-builders'

import {
  registeredTabs,
  tabRegisteredAt,
  NO_TRANSPORT_GRACE_MS,
  EMPTY_LAYOUT_BY_WORKTREE,
  RUNTIME_GRAPH_SYNC_COALESCE_MS,
  syncScheduled,
  syncInFlight,
  syncPendingAfterFlight,
  syncEnabled,
  syncTimer,
  getStoreState,
  mobileSessionSnapshotCacheByWorktree,
  jsonContentEquals,
  mobileSessionPublicationEpoch,
  setRuntimeGraphStoreStateGetter,
  hasRegisteredRuntimeTerminalTab,
  registerRuntimeTerminalTab,
  focusRuntimeTerminalSurface,
  setRuntimeGraphSyncEnabled,
  clearScheduledRuntimeGraphSync,
  scheduleRuntimeGraphSync,
  runRuntimeGraphSync,
  buildMobileSessionTabSnapshots,
  isEditorSurfaceTab,
  getEditorDraftVersionByFileId,
  type RegisteredTerminalTab,
  type OpenFileByWorktreeAndId,
  type OpenFileIndexes,
  type FallbackEditorTabTarget
} from './runtime-graph-sync'
import { getClientRuntime } from './client-runtime'

export async function syncRuntimeGraph(): Promise<void> {
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
    const result = await getClientRuntime().runtime.syncWindowGraph(graph)
    const currentState = getStoreState()
    currentState?.setRuntimeAgentOrchestrationByPaneKey?.(result?.agentOrchestrationByPaneKey ?? {})
  } catch (error) {
    console.error('[runtime] Failed to sync renderer graph:', error)
  }
}
