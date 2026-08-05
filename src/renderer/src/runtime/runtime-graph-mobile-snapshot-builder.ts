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
import { registeredTabs, tabRegisteredAt, NO_TRANSPORT_GRACE_MS, EMPTY_LAYOUT_BY_WORKTREE, RUNTIME_GRAPH_SYNC_COALESCE_MS, syncScheduled, syncInFlight, syncPendingAfterFlight, syncEnabled, syncTimer, getStoreState, mobileSessionSnapshotVersion, mobileSessionSnapshotCacheByWorktree, jsonContentEquals, cachedEditorDraftsSource, cachedEditorDraftVersionByFileId, mobileSessionPublicationEpoch, setRuntimeGraphStoreStateGetter, hasRegisteredRuntimeTerminalTab, registerRuntimeTerminalTab, focusRuntimeTerminalSurface, setRuntimeGraphSyncEnabled, clearScheduledRuntimeGraphSync, scheduleRuntimeGraphSync, runRuntimeGraphSync, syncRuntimeGraph, type RegisteredTerminalTab, type OpenFileByWorktreeAndId, type OpenFileIndexes, type FallbackEditorTabTarget } from './runtime-graph-sync'

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

export function isEditorSurfaceTab(tab: Pick<Tab, 'contentType'>): boolean {
  // Why: mobile can mirror ordinary edit/diff files; conflict-review and check-details tabs need metadata this contract lacks.
  return tab.contentType === 'editor' || tab.contentType === 'diff'
}

export function getEditorDraftVersionByFileId(
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
