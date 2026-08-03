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
export function createTabsSliceMoveUnifiedTabToGroupActions4(set: SliceSet, get: SliceGet) {
  return {
  moveUnifiedTabToGroup: (tabId, targetGroupId, opts) => {
    let moved = false
    set((state) => {
      const foundTab = findTabAndWorktree(state.unifiedTabsByWorktree, tabId)
      const foundTarget = findGroupAndWorktree(state.groupsByWorktree, targetGroupId)
      if (!foundTab || !foundTarget || foundTab.worktreeId !== foundTarget.worktreeId) {
        return {}
      }
      const { tab, worktreeId } = foundTab
      if (tab.groupId === targetGroupId) {
        return {}
      }
      const sourceGroup = findGroupForTab(state.groupsByWorktree, worktreeId, tab.groupId)
      const targetGroup = foundTarget.group
      if (!sourceGroup) {
        return {}
      }
      moved = true

      const dedupedSourceGroupOrder = dedupeTabOrder(sourceGroup.tabOrder)
      const sourceOrder = dedupeTabOrder(dedupedSourceGroupOrder.filter((id) => id !== tabId))
      // Why: defensive dedupe so target order can't grow a duplicate id (stale state); see dropUnifiedTab for the same guard.
      const targetOrder = dedupeTabOrder(targetGroup.tabOrder.filter((id) => id !== tabId))
      const targetIndex = Math.max(
        0,
        Math.min(opts?.index ?? targetOrder.length, targetOrder.length)
      )
      targetOrder.splice(targetIndex, 0, tabId)
      const nextActiveGroupIdByWorktree = {
        ...state.activeGroupIdByWorktree,
        [worktreeId]: opts?.activate ? targetGroupId : state.activeGroupIdByWorktree[worktreeId]
      }
      const sourceRecentTabIds = sanitizeRecentTabIds(
        (sourceGroup.recentTabIds ?? []).filter((id) => id !== tabId),
        sourceOrder
      )
      const nextGroups = (state.groupsByWorktree[worktreeId] ?? []).map((group) => {
        if (group.id === sourceGroup.id) {
          return {
            ...group,
            activeTabId:
              group.activeTabId === tabId
                ? // Why: keep MRU-aware selection so the user lands on their previously-focused tab, not a visual neighbor.
                  pickNextActiveTab(dedupedSourceGroupOrder, sourceGroup.recentTabIds, tabId)
                : group.activeTabId,
            tabOrder: sourceOrder,
            recentTabIds: sourceRecentTabIds
          }
        }
        if (group.id === targetGroupId) {
          const sanitizedTargetRecent = sanitizeRecentTabIds(group.recentTabIds, targetOrder)
          return {
            ...group,
            activeTabId: opts?.activate ? tabId : group.activeTabId,
            tabOrder: targetOrder,
            recentTabIds: opts?.activate
              ? pushRecentTabId(sanitizedTargetRecent, tabId)
              : sanitizedTargetRecent
          }
        }
        return group
      })
      let nextLayoutByWorktree = state.layoutByWorktree
      let nextActiveGroupIdByWorktreeResolved = nextActiveGroupIdByWorktree
      let filteredGroups = nextGroups
      if (sourceOrder.length === 0) {
        filteredGroups = nextGroups.filter((group) => group.id !== sourceGroup.id)
        const collapsedState = collapseGroupLayout(
          nextLayoutByWorktree,
          nextActiveGroupIdByWorktreeResolved,
          worktreeId,
          sourceGroup.id,
          targetGroupId
        )
        nextLayoutByWorktree = collapsedState.layoutByWorktree
        nextActiveGroupIdByWorktreeResolved = collapsedState.activeGroupIdByWorktree
      }
      const nextGroupsByWorktree = {
        ...state.groupsByWorktree,
        [worktreeId]: filteredGroups
      }
      const nextUnifiedTabsByWorktree = {
        ...state.unifiedTabsByWorktree,
        [worktreeId]: (state.unifiedTabsByWorktree[worktreeId] ?? []).map((candidate) =>
          candidate.id === tabId ? { ...candidate, groupId: targetGroupId } : candidate
        )
      }
      return {
        unifiedTabsByWorktree: nextUnifiedTabsByWorktree,
        groupsByWorktree: nextGroupsByWorktree,
        layoutByWorktree: nextLayoutByWorktree,
        activeGroupIdByWorktree: nextActiveGroupIdByWorktreeResolved,
        ...(state.activeWorktreeId === worktreeId
          ? buildActiveSurfacePatch(
              {
                ...state,
                unifiedTabsByWorktree: nextUnifiedTabsByWorktree,
                groupsByWorktree: nextGroupsByWorktree,
                layoutByWorktree: nextLayoutByWorktree,
                activeGroupIdByWorktree: nextActiveGroupIdByWorktreeResolved
              },
              worktreeId,
              nextActiveGroupIdByWorktreeResolved[worktreeId] ?? null
            )
          : {})
      }
    })
    if (moved && opts?.recordInteraction !== false) {
      get().recordFeatureInteraction?.('tab-splits')
    }
    return moved
  },
  dropUnifiedTab: (tabId, target) => {
    let moved = false
    set((state) => {
      const foundTab = findTabAndWorktree(state.unifiedTabsByWorktree, tabId)
      const foundTarget = findGroupAndWorktree(state.groupsByWorktree, target.groupId)
      if (!foundTab || !foundTarget || foundTab.worktreeId !== foundTarget.worktreeId) {
        return {}
      }

      const { tab, worktreeId } = foundTab
      const sourceGroup = findGroupForTab(state.groupsByWorktree, worktreeId, tab.groupId)
      const targetGroup = foundTarget.group
      if (!sourceGroup) {
        return {}
      }

      const isSplitDrop = Boolean(target.splitDirection)
      if (!isSplitDrop && tab.groupId === target.groupId) {
        return {}
      }
      const layout = state.layoutByWorktree[worktreeId]
      if (
        isSplitDrop &&
        isPaneColumnSplitDropNoOp({
          sourceGroupId: sourceGroup.id,
          targetGroupId: target.groupId,
          splitDirection: target.splitDirection!,
          sourceTabCount: sourceGroup.tabOrder.length,
          layout
        })
      ) {
        // Why: dropping a group's last tab on its own/sibling matching edge only makes a transient column that immediately collapses.
        return {}
      }

      moved = true

      let nextGroups = state.groupsByWorktree[worktreeId] ?? []
      let nextLayoutByWorktree = state.layoutByWorktree
      let nextActiveGroupIdByWorktree = state.activeGroupIdByWorktree
      let resolvedTargetGroupId = target.groupId

      if (target.splitDirection) {
        const newGroupId = createBrowserUuid()
        const newGroup: TabGroup = {
          id: newGroupId,
          worktreeId,
          activeTabId: null, // Placeholder; properly set in the nextGroups.map() below
          tabOrder: []
        }
        const currentLayout =
          nextLayoutByWorktree[worktreeId] ?? ({ type: 'leaf', groupId: target.groupId } as const)
        const replacement = buildSplitNode(
          target.groupId,
          newGroupId,
          target.splitDirection === 'left' || target.splitDirection === 'right'
            ? 'horizontal'
            : 'vertical',
          target.splitDirection === 'left' || target.splitDirection === 'up' ? 'first' : 'second'
        )

        resolvedTargetGroupId = newGroupId
        nextGroups = [...nextGroups, newGroup]
        nextLayoutByWorktree = {
          ...nextLayoutByWorktree,
          [worktreeId]: replaceLeaf(currentLayout, target.groupId, replacement)
        }
        nextActiveGroupIdByWorktree = {
          ...nextActiveGroupIdByWorktree,
          [worktreeId]: newGroupId
        }
      }

      const dedupedSourceGroupOrder = dedupeTabOrder(sourceGroup.tabOrder)
      const sourceOrder = dedupeTabOrder(dedupedSourceGroupOrder.filter((id) => id !== tabId))
      const destinationGroup =
        nextGroups.find((group) => group.id === resolvedTargetGroupId) ?? targetGroup
      // Why: target order may already hold this tab id (racey write / same-group split); dedupe first or React hits a duplicate key.
      const targetOrder = dedupeTabOrder(destinationGroup.tabOrder.filter((id) => id !== tabId))
      const targetIndex = Math.max(
        0,
        Math.min(target.index ?? targetOrder.length, targetOrder.length)
      )
      targetOrder.splice(targetIndex, 0, tabId)

      const sourceRecentTabIds = sanitizeRecentTabIds(
        (sourceGroup.recentTabIds ?? []).filter((id) => id !== tabId),
        sourceOrder
      )
      nextGroups = nextGroups.map((group) => {
        if (group.id === sourceGroup.id) {
          return {
            ...group,
            activeTabId:
              group.activeTabId === tabId
                ? // Why: same MRU-aware fallback as moveUnifiedTabToGroup — the drag keeps the user on their previously-active tab.
                  pickNextActiveTab(dedupedSourceGroupOrder, sourceGroup.recentTabIds, tabId)
                : group.activeTabId,
            tabOrder: sourceOrder,
            recentTabIds: sourceRecentTabIds
          }
        }
        if (group.id === resolvedTargetGroupId) {
          return {
            ...group,
            activeTabId: tabId,
            tabOrder: targetOrder,
            recentTabIds: pushRecentTabId(
              sanitizeRecentTabIds(group.recentTabIds, targetOrder),
              tabId
            )
          }
        }
        return group
      })

      if (sourceOrder.length === 0) {
        nextGroups = nextGroups.filter((group) => group.id !== sourceGroup.id)
        const collapsedState = collapseGroupLayout(
          nextLayoutByWorktree,
          nextActiveGroupIdByWorktree,
          worktreeId,
          sourceGroup.id,
          resolvedTargetGroupId
        )
        nextLayoutByWorktree = collapsedState.layoutByWorktree
        nextActiveGroupIdByWorktree = collapsedState.activeGroupIdByWorktree
      } else {
        nextActiveGroupIdByWorktree = {
          ...nextActiveGroupIdByWorktree,
          [worktreeId]: resolvedTargetGroupId
        }
      }

      const nextUnifiedTabsByWorktree = {
        ...state.unifiedTabsByWorktree,
        [worktreeId]: (state.unifiedTabsByWorktree[worktreeId] ?? []).map((candidate) =>
          candidate.id === tabId ? { ...candidate, groupId: resolvedTargetGroupId } : candidate
        )
      }
      const nextGroupsByWorktree = {
        ...state.groupsByWorktree,
        [worktreeId]: nextGroups
      }

      return {
        unifiedTabsByWorktree: nextUnifiedTabsByWorktree,
        groupsByWorktree: nextGroupsByWorktree,
        layoutByWorktree: nextLayoutByWorktree,
        activeGroupIdByWorktree: nextActiveGroupIdByWorktree,
        ...(state.activeWorktreeId === worktreeId
          ? buildActiveSurfacePatch(
              {
                ...state,
                unifiedTabsByWorktree: nextUnifiedTabsByWorktree,
                groupsByWorktree: nextGroupsByWorktree,
                layoutByWorktree: nextLayoutByWorktree,
                activeGroupIdByWorktree: nextActiveGroupIdByWorktree
              },
              worktreeId,
              resolvedTargetGroupId
            )
          : {})
      }
    })
    if (moved) {
      get().recordFeatureInteraction?.('terminal-tabs')
      get().recordFeatureInteraction?.('tab-splits')
    }
    return moved
  },
  }
}
