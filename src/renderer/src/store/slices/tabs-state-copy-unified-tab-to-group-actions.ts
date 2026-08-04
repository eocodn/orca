 import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type {
  Tab,
  TabContentType,
  TabGroup,
  TabGroupLayoutNode,
  TerminalTab,
  TuiAgent,
  WorkspaceSessionState,
  WorkspaceVisibleTabType
} from '../../../../shared/types'
import { emitNativeChatToggled } from '@/lib/native-chat-telemetry'
import {
  dedupeTabOrder,
  ensureGroup,
  findGroupAndWorktree,
  findGroupForTab,
  findTabAndWorktree,
  findTabByEntityInGroup,
  patchTab,
  pickNextActiveTab,
  pushRecentTabId,
  sanitizeRecentTabIds,
  updateGroup
} from './tab-group-state'
import { isPaneColumnSplitDropNoOp } from './pane-column-split-drop-no-op'
import { buildHydratedTabState, pruneTabGroupLayoutForGroups } from './tabs-hydration'
import {
  buildOrphanTerminalCleanupPatch,
  getOrphanTerminalIds,
  terminalTabHasReconnectablePty
} from './terminal-orphan-helpers'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import {
  addAdditionalValidWorkspaceKeys,
  type WorkspaceSessionHydrationOptions
} from '@/lib/workspace-session-hydration-keys'
import {
  buildValidWorktreeIdsForSessionHydration,
  collectPersistedWorktreeIdsForSessionHydration
} from './degraded-repo-worktree-validity'
import { replaceWorkspaceRecordKeys, patchTerminalTabPinned, mirrorTabPinnedToHost, mirrorTabViewModeToHost, buildSplitNode, replaceLeaf, updateSplitRatio, findFirstLeaf, partitionPinnedTabOrder, applyTabOrderSortValues, isReplaceablePreviewContentType, canReplacePreviewContentType, findSiblingGroupId, removeLeaf, collapseGroupLayout, toVisibleTabType, deriveActiveSurfaceForWorktree, buildActiveSurfacePatch, activeSurfacePatchMatchesState } from './tabs-state'
import type { TabSplitDirection, TabsSlice } from './tabs-state'
type SliceSet = Parameters<StateCreator<AppState>>[0]
type SliceGet = Parameters<StateCreator<AppState>>[1]
export function createTabsSliceCopyUnifiedTabToGroupActions5(set: SliceSet, get: SliceGet) {
  return {
  copyUnifiedTabToGroup: (tabId, targetGroupId, init) => {
    const foundTab = findTabAndWorktree(get().unifiedTabsByWorktree, tabId)
    const foundTarget = findGroupAndWorktree(get().groupsByWorktree, targetGroupId)
    if (!foundTab || !foundTarget || foundTab.worktreeId !== foundTarget.worktreeId) {
      return null
    }
    const { tab, worktreeId } = foundTab
    return get().createUnifiedTab(worktreeId, tab.contentType, {
      entityId: init?.entityId ?? tab.entityId,
      label: init?.label ?? tab.label,
      generatedLabel: init?.generatedLabel ?? tab.generatedLabel,
      quickCommandLabel: init?.quickCommandLabel ?? tab.quickCommandLabel,
      customLabel: init?.customLabel ?? tab.customLabel,
      color: init?.color ?? tab.color,
      isPinned: init?.isPinned ?? tab.isPinned,
      id: init?.id,
      targetGroupId
    })
  },
  mergeGroupIntoSibling: (worktreeId, groupId) => {
    const state = get()
    const groups = state.groupsByWorktree[worktreeId] ?? []
    const sourceGroup = groups.find((candidate) => candidate.id === groupId)
    const layout = state.layoutByWorktree[worktreeId]
    if (!sourceGroup || !layout || groups.length <= 1) {
      return null
    }
    const targetGroupId = findSiblingGroupId(layout, groupId)
    if (!targetGroupId) {
      return null
    }

    const orderedSourceTabs = (state.unifiedTabsByWorktree[worktreeId] ?? []).filter(
      (tab) => tab.groupId === groupId
    )
    for (const tabId of sourceGroup.tabOrder) {
      const item = orderedSourceTabs.find((tab) => tab.id === tabId)
      if (!item) {
        continue
      }
      get().moveUnifiedTabToGroup(item.id, targetGroupId, { recordInteraction: false })
    }
    get().closeEmptyGroup(worktreeId, groupId)
    get().recordFeatureInteraction?.('terminal-panes')
    return targetGroupId
  },
  setTabGroupSplitRatio: (worktreeId, nodePath, ratio) => {
    set((state) => {
      const currentLayout = state.layoutByWorktree[worktreeId]
      if (!currentLayout) {
        return {}
      }
      return {
        layoutByWorktree: {
          ...state.layoutByWorktree,
          // Why: split ratios belong to the tab-group model (not transient UI), so persist them for restores and multi-step group ops.
          [worktreeId]: updateSplitRatio(
            currentLayout,
            nodePath.length > 0 ? nodePath.split('.') : [],
            ratio
          )
        }
      }
    })
  },
  reconcileWorktreeTabModel: (worktreeId) => {
    const state = get()
    const unifiedTabs = state.unifiedTabsByWorktree[worktreeId] ?? []
    const groups = state.groupsByWorktree[worktreeId] ?? []
    const runtimeTerminalTabs = state.tabsByWorktree[worktreeId] ?? []
    const unifiedTerminalEntityIds = new Set(
      unifiedTabs.filter((tab) => tab.contentType === 'terminal').map((tab) => tab.entityId)
    )
    const legacyRuntimeTerminalTabs = runtimeTerminalTabs.filter((tab) => {
      if (unifiedTerminalEntityIds.has(tab.id)) {
        return false
      }
      // Why: migration filter — keep any tab still owning a live/reconnecting
      // PTY (preserved sessionId or a reconnect-map session) so it re-enters the
      // unified model for wake/reconnect reattach instead of vanishing (#9911).
      return terminalTabHasReconnectablePty(state, tab.id, tab.ptyId)
    })
    const orphanTerminalIds = getOrphanTerminalIds(state, worktreeId)
    const ensuredGroupState =
      legacyRuntimeTerminalTabs.length > 0
        ? ensureGroup(
            state.groupsByWorktree,
            state.activeGroupIdByWorktree,
            worktreeId,
            state.activeGroupIdByWorktree[worktreeId]
          )
        : null
    const reconciliationGroup = ensuredGroupState?.group ?? groups[0] ?? null
    const restoredLegacyTabs =
      reconciliationGroup == null
        ? []
        : legacyRuntimeTerminalTabs
            .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
            .map((tab) => ({
              id: tab.id,
              entityId: tab.id,
              groupId: reconciliationGroup.id,
              worktreeId,
              contentType: 'terminal' as const,
              label: tab.title,
              ...(tab.quickCommandLabel?.trim()
                ? { quickCommandLabel: tab.quickCommandLabel.trim() }
                : {}),
              ...(tab.generatedTitle?.trim() ? { generatedLabel: tab.generatedTitle.trim() } : {}),
              customLabel: tab.customTitle,
              color: tab.color,
              sortOrder: tab.sortOrder,
              createdAt: tab.createdAt
            }))
    const reconciledUnifiedTabs =
      restoredLegacyTabs.length > 0 ? [...unifiedTabs, ...restoredLegacyTabs] : unifiedTabs
    // Why: seed a freshly-ensured group's active tab from the remembered selection, else the worktree always reopens on Terminal 1.
    const rememberedLegacyActiveTabId = state.activeTabIdByWorktree[worktreeId]
    const restoredLegacyTabIds = new Set(restoredLegacyTabs.map((tab) => tab.id))
    const legacyFallbackActiveTabId =
      rememberedLegacyActiveTabId && restoredLegacyTabIds.has(rememberedLegacyActiveTabId)
        ? rememberedLegacyActiveTabId
        : (restoredLegacyTabs[0]?.id ?? null)
    const reconciledGroups =
      restoredLegacyTabs.length > 0 && reconciliationGroup
        ? updateGroup(ensuredGroupState!.groupsByWorktree[worktreeId] ?? [], {
            ...reconciliationGroup,
            // Why: restore runtime-slice legacy tabs into the active/root group so live PTYs stay reachable instead of spawning a duplicate.
            activeTabId: reconciliationGroup.activeTabId ?? legacyFallbackActiveTabId,
            tabOrder: dedupeTabOrder([
              ...reconciliationGroup.tabOrder,
              ...restoredLegacyTabs.map((tab) => tab.id)
            ])
          })
        : groups
    const liveTerminalIds = new Set(
      runtimeTerminalTabs.filter((tab) => !orphanTerminalIds.has(tab.id)).map((tab) => tab.id)
    )
    const liveEditorIds = new Set(
      state.openFiles.filter((file) => file.worktreeId === worktreeId).map((file) => file.id)
    )
    const liveBrowserIds = new Set(
      (state.browserTabsByWorktree[worktreeId] ?? []).map((browserTab) => browserTab.id)
    )

    const isRenderableTab = (tab: Tab): boolean => {
      if (tab.contentType === 'terminal') {
        return liveTerminalIds.has(tab.entityId)
      }
      if (tab.contentType === 'browser') {
        return liveBrowserIds.has(tab.entityId)
      }
      return liveEditorIds.has(tab.entityId)
    }

    const validTabs = reconciledUnifiedTabs.filter(isRenderableTab)
    const validTabIds = new Set(validTabs.map((tab) => tab.id))

    const nextGroupsWithEmpty = reconciledGroups.map((group) => {
      const tabOrder = group.tabOrder.filter((tabId) => validTabIds.has(tabId))
      const activeTabId =
        group.activeTabId && validTabIds.has(group.activeTabId)
          ? group.activeTabId
          : (tabOrder[0] ?? null)
      const tabOrderUnchanged =
        tabOrder.length === group.tabOrder.length &&
        tabOrder.every((tabId, index) => tabId === group.tabOrder[index])
      // Why: keep the MRU stack in sync with dropped tabs so the next close doesn't activate one the renderer no longer owns.
      const recentTabIds = sanitizeRecentTabIds(group.recentTabIds, tabOrder)
      const recentUnchanged =
        recentTabIds.length === (group.recentTabIds ?? []).length &&
        recentTabIds.every((id, index) => id === (group.recentTabIds ?? [])[index])
      return tabOrderUnchanged && activeTabId === group.activeTabId && recentUnchanged
        ? group
        : { ...group, tabOrder, activeTabId, recentTabIds }
    })
    const nextGroups =
      validTabs.length > 0
        ? nextGroupsWithEmpty.filter((group) => group.tabOrder.length > 0)
        : nextGroupsWithEmpty

    const currentActiveGroupId =
      state.activeGroupIdByWorktree[worktreeId] ??
      ensuredGroupState?.activeGroupIdByWorktree[worktreeId]
    const activeGroupStillExists = nextGroups.some((group) => group.id === currentActiveGroupId)
    const nextActiveGroupId = activeGroupStillExists
      ? currentActiveGroupId
      : (nextGroups.find((group) => group.activeTabId !== null)?.id ??
        nextGroups[0]?.id ??
        currentActiveGroupId)

    const groupsChanged =
      nextGroups.length !== groups.length ||
      nextGroups.some((group, index) => group !== groups[index])
    const tabsChanged = validTabs.length !== unifiedTabs.length || restoredLegacyTabs.length > 0
    const activeGroupChanged = nextActiveGroupId !== currentActiveGroupId

    const baseNextLayout =
      restoredLegacyTabs.length > 0 && reconciliationGroup
        ? (state.layoutByWorktree[worktreeId] ?? { type: 'leaf', groupId: reconciliationGroup.id })
        : state.layoutByWorktree[worktreeId]
    const validGroupIds = new Set(nextGroups.map((group) => group.id))
    const prunedNextLayout =
      baseNextLayout && validGroupIds.size > 0
        ? pruneTabGroupLayoutForGroups(baseNextLayout, validGroupIds)
        : baseNextLayout
    const nextLayout =
      prunedNextLayout ?? (nextGroups[0] ? { type: 'leaf', groupId: nextGroups[0].id } : undefined)
    const currentLayout = state.layoutByWorktree[worktreeId]
    const layoutChanged = nextLayout !== currentLayout

    if (
      tabsChanged ||
      groupsChanged ||
      activeGroupChanged ||
      layoutChanged ||
      orphanTerminalIds.size > 0
    ) {
      // Why: drop unreadTerminalTabs entries (keyed by entityId) for terminal tabs reconcile removed, or the stale flag lingers forever.
      const droppedTerminalEntityIds: string[] = []
      for (const tab of unifiedTabs) {
        if (tab.contentType !== 'terminal') {
          continue
        }
        if (!validTabIds.has(tab.id)) {
          droppedTerminalEntityIds.push(tab.entityId)
        }
      }
      set((current) => {
        let nextUnreadTerminalTabs = current.unreadTerminalTabs
        if (droppedTerminalEntityIds.length > 0) {
          let changed = false
          const copy = { ...current.unreadTerminalTabs }
          for (const entityId of droppedTerminalEntityIds) {
            if (copy[entityId]) {
              delete copy[entityId]
              changed = true
            }
          }
          if (changed) {
            nextUnreadTerminalTabs = copy
          }
        }
        return {
          unifiedTabsByWorktree: { ...current.unifiedTabsByWorktree, [worktreeId]: validTabs },
          groupsByWorktree: { ...current.groupsByWorktree, [worktreeId]: nextGroups },
          activeGroupIdByWorktree: {
            ...current.activeGroupIdByWorktree,
            [worktreeId]: nextActiveGroupId
          },
          ...(nextUnreadTerminalTabs !== current.unreadTerminalTabs
            ? { unreadTerminalTabs: nextUnreadTerminalTabs }
            : {}),
          ...(nextLayout && layoutChanged
            ? {
                layoutByWorktree: {
                  ...current.layoutByWorktree,
                  // Why: restored runtime terminal needs a concrete leaf before activation, else the fallback spawns a duplicate "Terminal 2".
                  [worktreeId]: nextLayout!
                }
              }
            : {}),
          ...(orphanTerminalIds.size > 0
            ? buildOrphanTerminalCleanupPatch(current, worktreeId, orphanTerminalIds)
            : {})
        }
      })
    }

    const activeRenderableTabId =
      nextGroups.find((group) => group.id === nextActiveGroupId)?.activeTabId ??
      nextGroups.find((group) => group.activeTabId !== null)?.activeTabId ??
      null

    return {
      renderableTabCount: validTabs.length,
      activeRenderableTabId
    }
  },
  }
}
