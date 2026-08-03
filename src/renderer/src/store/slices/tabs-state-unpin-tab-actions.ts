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
export function createTabsSliceUnpinTabActions3(set: SliceSet, get: SliceGet) {
  return {
  unpinTab: (tabId) => {
    const exists = get().getTab(tabId) !== null
    set((state) => {
      const found = findTabAndWorktree(state.unifiedTabsByWorktree, tabId)
      if (!found) {
        return {}
      }
      const { tab, worktreeId } = found
      const tabs = (state.unifiedTabsByWorktree[worktreeId] ?? []).map((candidate) =>
        candidate.id === tabId ? { ...candidate, isPinned: false } : candidate
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
        ...patchTerminalTabPinned(state.tabsByWorktree, worktreeId, tabId, false),
        groupsByWorktree: {
          ...state.groupsByWorktree,
          [worktreeId]: updateGroup(groups, { ...group, tabOrder })
        }
      }
    })
    mirrorTabPinnedToHost(get(), tabId, false)
    if (exists) {
      get().recordFeatureInteraction?.('terminal-tabs')
    }
  },
  closeOtherTabs: (tabId) => {
    const state = get()
    const found = findTabAndWorktree(state.unifiedTabsByWorktree, tabId)
    if (!found) {
      return []
    }
    const { tab, worktreeId } = found
    const group = findGroupForTab(state.groupsByWorktree, worktreeId, tab.groupId)
    if (!group) {
      return []
    }
    const closedIds = (state.unifiedTabsByWorktree[worktreeId] ?? [])
      .filter((item) => item.groupId === group.id && item.id !== tabId && !item.isPinned)
      .map((item) => item.id)
    for (const id of closedIds) {
      get().closeUnifiedTab(id)
    }
    return closedIds
  },
  closeTabsToRight: (tabId) => {
    const state = get()
    const found = findTabAndWorktree(state.unifiedTabsByWorktree, tabId)
    if (!found) {
      return []
    }
    const { tab, worktreeId } = found
    const group = findGroupForTab(state.groupsByWorktree, worktreeId, tab.groupId)
    if (!group) {
      return []
    }
    const index = group.tabOrder.indexOf(tabId)
    if (index === -1) {
      return []
    }
    const closableIds = group.tabOrder
      .slice(index + 1)
      .filter(
        (id) =>
          !(state.unifiedTabsByWorktree[worktreeId] ?? []).find((candidate) => candidate.id === id)
            ?.isPinned
      )
    for (const id of closableIds) {
      get().closeUnifiedTab(id)
    }
    return closableIds
  },
  closeTabsToLeft: (tabId) => {
    const state = get()
    const found = findTabAndWorktree(state.unifiedTabsByWorktree, tabId)
    if (!found) {
      return []
    }
    const { tab, worktreeId } = found
    const group = findGroupForTab(state.groupsByWorktree, worktreeId, tab.groupId)
    if (!group) {
      return []
    }
    const index = group.tabOrder.indexOf(tabId)
    if (index === -1) {
      return []
    }
    const closableIds = group.tabOrder
      .slice(0, index)
      .filter(
        (id) =>
          !(state.unifiedTabsByWorktree[worktreeId] ?? []).find((candidate) => candidate.id === id)
            ?.isPinned
      )
    for (const id of closableIds) {
      get().closeUnifiedTab(id)
    }
    return closableIds
  },
  ensureWorktreeRootGroup: (worktreeId) => {
    const existingGroups = get().groupsByWorktree[worktreeId] ?? []
    if (existingGroups.length > 0) {
      return get().activeGroupIdByWorktree[worktreeId] ?? existingGroups[0].id
    }

    const groupId = createBrowserUuid()
    set((state) => ({
      // Why: a zero-tab worktree still needs a canonical root group so new tabs and splits land in a deterministic place.
      groupsByWorktree: {
        ...state.groupsByWorktree,
        [worktreeId]: [{ id: groupId, worktreeId, activeTabId: null, tabOrder: [] }]
      },
      layoutByWorktree: {
        ...state.layoutByWorktree,
        [worktreeId]: { type: 'leaf', groupId }
      },
      activeGroupIdByWorktree: {
        ...state.activeGroupIdByWorktree,
        [worktreeId]: groupId
      }
    }))
    return groupId
  },
  focusGroup: (worktreeId, groupId) =>
    set((state) => {
      const groupAlreadyFocused = state.activeGroupIdByWorktree[worktreeId] === groupId
      const nextActiveGroupIdByWorktree = groupAlreadyFocused
        ? state.activeGroupIdByWorktree
        : {
            ...state.activeGroupIdByWorktree,
            [worktreeId]: groupId
          }
      // Why: focusing a group surfaces its active terminal tab, so dismiss the tab-level bell.
      // Why (activeWorktree guard below): only when the group is in the active worktree, else the unseen tab's bell is swallowed.
      if (state.activeWorktreeId !== worktreeId) {
        if (groupAlreadyFocused) {
          return state
        }
        return {
          activeGroupIdByWorktree: nextActiveGroupIdByWorktree
        }
      }
      const groups = state.groupsByWorktree[worktreeId] ?? []
      const unifiedTabs = state.unifiedTabsByWorktree[worktreeId] ?? []
      const visibleTerminalEntityIds = new Set(
        groups
          .map((group) =>
            group.activeTabId ? unifiedTabs.find((tab) => tab.id === group.activeTabId) : null
          )
          .filter((tab): tab is (typeof unifiedTabs)[number] => tab?.contentType === 'terminal')
          .map((tab) => tab.entityId)
      )
      const nextUnreadTerminalTabs =
        visibleTerminalEntityIds.size > 0
          ? (() => {
              let changed = false
              const copy = { ...state.unreadTerminalTabs }
              for (const terminalEntityId of visibleTerminalEntityIds) {
                if (!copy[terminalEntityId]) {
                  continue
                }
                delete copy[terminalEntityId]
                changed = true
              }
              return changed ? copy : state.unreadTerminalTabs
            })()
          : state.unreadTerminalTabs
      const activeSurfacePatch = buildActiveSurfacePatch(
        {
          ...state,
          activeGroupIdByWorktree: nextActiveGroupIdByWorktree
        },
        worktreeId,
        groupId
      )
      if (
        groupAlreadyFocused &&
        nextUnreadTerminalTabs === state.unreadTerminalTabs &&
        activeSurfacePatchMatchesState(state, worktreeId, activeSurfacePatch)
      ) {
        return state
      }
      return {
        ...(groupAlreadyFocused ? {} : { activeGroupIdByWorktree: nextActiveGroupIdByWorktree }),
        // Why: only write unreadTerminalTabs when it changed — preserving the reference keeps selectors/subscribers from firing spuriously.
        ...(nextUnreadTerminalTabs !== state.unreadTerminalTabs
          ? { unreadTerminalTabs: nextUnreadTerminalTabs }
          : {}),
        ...activeSurfacePatch
      }
    }),
  closeEmptyGroup: (worktreeId, groupId) => {
    const state = get()
    const group = (state.groupsByWorktree[worktreeId] ?? []).find(
      (candidate) => candidate.id === groupId
    )
    if (!group || group.tabOrder.length > 0) {
      return false
    }
    set((current) => {
      const remainingGroups = (current.groupsByWorktree[worktreeId] ?? []).filter(
        (candidate) => candidate.id !== groupId
      )
      const collapsedState = collapseGroupLayout(
        current.layoutByWorktree,
        current.activeGroupIdByWorktree,
        worktreeId,
        groupId,
        remainingGroups[0]?.id ?? null
      )
      // Why: drop the dead group's recent-quick-command entry so the map can't grow unbounded as groups open/close.
      const { [groupId]: _droppedRecent, ...remainingRecent } = current.recentQuickCommandIdByGroup
      return {
        groupsByWorktree: { ...current.groupsByWorktree, [worktreeId]: remainingGroups },
        layoutByWorktree: collapsedState.layoutByWorktree,
        activeGroupIdByWorktree: collapsedState.activeGroupIdByWorktree,
        recentQuickCommandIdByGroup: remainingRecent,
        ...(current.activeWorktreeId === worktreeId
          ? buildActiveSurfacePatch(
              {
                ...current,
                groupsByWorktree: {
                  ...current.groupsByWorktree,
                  [worktreeId]: remainingGroups
                },
                layoutByWorktree: collapsedState.layoutByWorktree,
                activeGroupIdByWorktree: collapsedState.activeGroupIdByWorktree
              },
              worktreeId,
              collapsedState.activeGroupIdByWorktree[worktreeId] ?? null
            )
          : {})
      }
    })
    return true
  },
  createEmptySplitGroup: (worktreeId, sourceGroupId, direction) => {
    const newGroupId = createBrowserUuid()
    const newGroup: TabGroup = {
      id: newGroupId,
      worktreeId,
      activeTabId: null,
      tabOrder: []
    }
    set((state) => {
      const existing = state.groupsByWorktree[worktreeId] ?? []
      const currentLayout =
        state.layoutByWorktree[worktreeId] ?? ({ type: 'leaf', groupId: sourceGroupId } as const)
      const replacement = buildSplitNode(
        sourceGroupId,
        newGroupId,
        direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical',
        direction === 'left' || direction === 'up' ? 'first' : 'second'
      )
      return {
        groupsByWorktree: { ...state.groupsByWorktree, [worktreeId]: [...existing, newGroup] },
        layoutByWorktree: {
          ...state.layoutByWorktree,
          [worktreeId]: replaceLeaf(currentLayout, sourceGroupId, replacement)
        },
        activeGroupIdByWorktree: { ...state.activeGroupIdByWorktree, [worktreeId]: newGroupId }
      }
    })
    get().recordFeatureInteraction?.('terminal-panes')
    return newGroupId
  },
  }
}
