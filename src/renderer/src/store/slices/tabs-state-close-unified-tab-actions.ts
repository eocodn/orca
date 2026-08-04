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
import { replaceWorkspaceRecordKeys, patchTerminalTabPinned, mirrorTabPinnedToHost, buildSplitNode, replaceLeaf, updateSplitRatio, findFirstLeaf, partitionPinnedTabOrder, applyTabOrderSortValues, isReplaceablePreviewContentType, canReplacePreviewContentType, findSiblingGroupId, removeLeaf, collapseGroupLayout, toVisibleTabType, deriveActiveSurfaceForWorktree, buildActiveSurfacePatch, activeSurfacePatchMatchesState } from './tabs-state'
import type { TabSplitDirection, TabsSlice } from './tabs-state'
type SliceSet = Parameters<StateCreator<AppState>>[0]
type SliceGet = Parameters<StateCreator<AppState>>[1]
export function createTabsSliceCloseUnifiedTabActions2(set: SliceSet, get: SliceGet) {
  return {
  closeUnifiedTab: (tabId, opts) => {
    const state = get()
    const found = findTabAndWorktree(state.unifiedTabsByWorktree, tabId)
    if (!found) {
      return null
    }
    const { tab, worktreeId } = found
    const group = findGroupForTab(state.groupsByWorktree, worktreeId, tab.groupId)
    if (!group) {
      return null
    }

    if (tab.contentType === 'terminal' && !opts?.terminalRetirementHandled) {
      const dedupedGroupOrder = dedupeTabOrder(group.tabOrder)
      const wasLastTab = dedupeTabOrder(dedupedGroupOrder.filter((id) => id !== tabId)).length === 0
      // Why: unified-only hydrated tabs still own provider sessions without a legacy row, so retire every terminal close by entity id.
      get().closeTab(tab.entityId, { recordInteraction: opts?.recordInteraction })
      return { closedTabId: tabId, wasLastTab, worktreeId }
    }

    const dedupedGroupOrder = dedupeTabOrder(group.tabOrder)
    const remainingOrder = dedupeTabOrder(dedupedGroupOrder.filter((id) => id !== tabId))
    const wasLastTab = remainingOrder.length === 0
    // Why: on closing the active tab, walk the MRU stack to the previously-active tab; pickNextActiveTab falls back to the neighbor.
    const nextActiveTabId =
      group.activeTabId === tabId
        ? wasLastTab
          ? null
          : pickNextActiveTab(dedupedGroupOrder, group.recentTabIds, tabId)
        : group.activeTabId
    const nextRecentTabIds = sanitizeRecentTabIds(
      (group.recentTabIds ?? []).filter((id) => id !== tabId),
      remainingOrder
    )
    const terminalEntityId = tab.contentType === 'terminal' ? tab.entityId : null

    set((current) => {
      const nextTabs = (current.unifiedTabsByWorktree[worktreeId] ?? []).filter(
        (item) => item.id !== tabId
      )
      // Why: close-to-right/others bypass terminals.closeTab, so clear the entityId-keyed unread flag here or a stale dot leaks.
      let nextUnreadTerminalTabs = current.unreadTerminalTabs
      if (terminalEntityId && current.unreadTerminalTabs[terminalEntityId]) {
        nextUnreadTerminalTabs = { ...current.unreadTerminalTabs }
        delete nextUnreadTerminalTabs[terminalEntityId]
      }
      let nextGroups = (current.groupsByWorktree[worktreeId] ?? []).map((candidate) =>
        candidate.id === group.id
          ? {
              ...candidate,
              activeTabId: nextActiveTabId,
              tabOrder: remainingOrder,
              recentTabIds: nextRecentTabIds
            }
          : candidate
      )
      let nextLayoutByWorktree = current.layoutByWorktree
      let nextActiveGroupIdByWorktree = current.activeGroupIdByWorktree
      if (wasLastTab && current.layoutByWorktree[worktreeId] && nextGroups.length > 1) {
        nextGroups = nextGroups.filter((candidate) => candidate.id !== group.id)
        const collapsedState = collapseGroupLayout(
          current.layoutByWorktree,
          current.activeGroupIdByWorktree,
          worktreeId,
          group.id,
          nextGroups[0]?.id ?? null
        )
        nextLayoutByWorktree = collapsedState.layoutByWorktree
        nextActiveGroupIdByWorktree = collapsedState.activeGroupIdByWorktree
      }
      const shouldDeactivateWorktree =
        current.activeWorktreeId === worktreeId &&
        nextTabs.length === 0 &&
        (current.tabsByWorktree[worktreeId] ?? []).length === 0 &&
        (current.browserTabsByWorktree[worktreeId] ?? []).length === 0 &&
        !current.openFiles.some((file) => file.worktreeId === worktreeId)
      return {
        unifiedTabsByWorktree: { ...current.unifiedTabsByWorktree, [worktreeId]: nextTabs },
        groupsByWorktree: {
          ...current.groupsByWorktree,
          [worktreeId]: nextGroups
        },
        layoutByWorktree: nextLayoutByWorktree,
        activeGroupIdByWorktree: nextActiveGroupIdByWorktree,
        // Why: skip writing unreadTerminalTabs when the reference is unchanged, avoiding a no-op alloc that re-runs full-state selectors.
        ...(nextUnreadTerminalTabs !== current.unreadTerminalTabs
          ? { unreadTerminalTabs: nextUnreadTerminalTabs }
          : {}),
        // Why: closing the last tab can leave the worktree selected but render-empty, so write the landing-state fallback directly.
        ...(shouldDeactivateWorktree
          ? {
              activeWorktreeId: null,
              activeWorkspaceKey: null,
              activeWorkspaceExecutionHostId: null,
              activeTabId: null,
              activeBrowserTabId: null,
              activeFileId: null,
              activeTabType: 'terminal' as const,
              activeTabIdByWorktree: {
                ...current.activeTabIdByWorktree,
                [worktreeId]: null
              },
              activeBrowserTabIdByWorktree: {
                ...current.activeBrowserTabIdByWorktree,
                [worktreeId]: null
              },
              activeFileIdByWorktree: {
                ...current.activeFileIdByWorktree,
                [worktreeId]: null
              },
              activeTabTypeByWorktree: {
                ...current.activeTabTypeByWorktree,
                [worktreeId]: 'terminal'
              }
            }
          : {}),
        ...(!shouldDeactivateWorktree && current.activeWorktreeId === worktreeId
          ? buildActiveSurfacePatch(
              {
                ...current,
                unifiedTabsByWorktree: {
                  ...current.unifiedTabsByWorktree,
                  [worktreeId]: nextTabs
                },
                groupsByWorktree: {
                  ...current.groupsByWorktree,
                  [worktreeId]: nextGroups
                },
                layoutByWorktree: nextLayoutByWorktree,
                activeGroupIdByWorktree: nextActiveGroupIdByWorktree
              },
              worktreeId,
              nextActiveGroupIdByWorktree[worktreeId] ?? null
            )
          : {})
      }
    })

    if (opts?.recordInteraction !== false) {
      get().recordFeatureInteraction?.('terminal-tabs')
    }
    return { closedTabId: tabId, wasLastTab, worktreeId }
  },
  reorderUnifiedTabs: (groupId, tabIds, opts) => {
    let reordered = false
    set((state) => {
      for (const [worktreeId, groups] of Object.entries(state.groupsByWorktree)) {
        const group = groups.find((candidate) => candidate.id === groupId)
        if (!group) {
          continue
        }
        // Why: dedupe at the store boundary so each tab keeps one canonical position and later group ops don't branch on duplicate ids.
        const nextTabOrder = dedupeTabOrder(tabIds)
        reordered = true
        const orderMap = new Map(nextTabOrder.map((id, index) => [id, index]))
        return {
          groupsByWorktree: {
            ...state.groupsByWorktree,
            [worktreeId]: updateGroup(groups, { ...group, tabOrder: nextTabOrder })
          },
          unifiedTabsByWorktree: {
            ...state.unifiedTabsByWorktree,
            [worktreeId]: (state.unifiedTabsByWorktree[worktreeId] ?? []).map((tab) => {
              const sortOrder = orderMap.get(tab.id)
              return sortOrder === undefined ? tab : { ...tab, sortOrder }
            })
          }
        }
      }
      return {}
    })
    if (reordered && opts?.recordInteraction !== false) {
      get().recordFeatureInteraction?.('terminal-tabs')
    }
  },
  setTabLabel: (tabId, label) => {
    set((state) => patchTab(state.unifiedTabsByWorktree, tabId, { label }) ?? {})
  },
  setRenamingTabId: (tabId) => {
    set({ renamingTabId: tabId })
  },
  setTabCustomLabel: (tabId, label, opts) => {
    const exists = get().getTab(tabId) !== null
    set((state) => patchTab(state.unifiedTabsByWorktree, tabId, { customLabel: label }) ?? {})
    if (exists && opts?.recordInteraction !== false) {
      get().recordFeatureInteraction?.('terminal-tabs')
    }
  },
  setUnifiedTabColor: (tabId, color) => {
    const exists = get().getTab(tabId) !== null
    set((state) => patchTab(state.unifiedTabsByWorktree, tabId, { color }) ?? {})
    if (exists) {
      get().recordFeatureInteraction?.('terminal-tabs')
    }
  },
  pinTab: (tabId) => {
    const exists = get().getTab(tabId) !== null
    set((state) => {
      const found = findTabAndWorktree(state.unifiedTabsByWorktree, tabId)
      if (!found) {
        return {}
      }
      const { tab, worktreeId } = found
      const tabs = (state.unifiedTabsByWorktree[worktreeId] ?? []).map((candidate) =>
        candidate.id === tabId ? { ...candidate, isPinned: true, isPreview: false } : candidate
      )
      const groups = state.groupsByWorktree[worktreeId] ?? []
      const group = groups.find((candidate) => candidate.id === tab.groupId)
      if (!group) {
        return {
          unifiedTabsByWorktree: { ...state.unifiedTabsByWorktree, [worktreeId]: tabs }
        }
      }
      const tabOrder = partitionPinnedTabOrder(group.tabOrder, tabs, tabId)
      return {
        unifiedTabsByWorktree: {
          ...state.unifiedTabsByWorktree,
          [worktreeId]: applyTabOrderSortValues(tabs, tabOrder)
        },
        // Why: reconcile derives pin from the TerminalTab, so mirror it there too or a host snapshot recomputes isPinned:false and un-pins during the echo window.
        ...patchTerminalTabPinned(state.tabsByWorktree, worktreeId, tabId, true),
        groupsByWorktree: {
          ...state.groupsByWorktree,
          [worktreeId]: updateGroup(groups, { ...group, tabOrder })
        }
      }
    })
    mirrorTabPinnedToHost(get(), tabId, true)
    if (exists) {
      get().recordFeatureInteraction?.('terminal-tabs')
    }
  },
  }
}
