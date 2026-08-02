/* import type { StateCreator } from 'zustand'
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
export function createTabsSliceUnifiedTabsByWorktreeActions(set: SliceSet, get: SliceGet) {
  return {
  unifiedTabsByWorktree: {},
  renamingTabId: null,
  groupsByWorktree: {},
  activeGroupIdByWorktree: {},
  layoutByWorktree: {},
  createUnifiedTab: (worktreeId, contentType, init) => {
    const id = init?.id ?? createBrowserUuid()
    let created!: Tab
    set((state) => {
      const { group, groupsByWorktree, activeGroupIdByWorktree } = ensureGroup(
        state.groupsByWorktree,
        state.activeGroupIdByWorktree,
        worktreeId,
        init?.targetGroupId ?? state.activeGroupIdByWorktree[worktreeId]
      )
      const existingTabs = state.unifiedTabsByWorktree[worktreeId] ?? []

      let nextTabs = existingTabs
      let nextOrder = dedupeTabOrder(group.tabOrder)
      if (init?.isPreview) {
        const existingPreview = existingTabs.find(
          (tab) =>
            tab.groupId === group.id &&
            tab.isPreview &&
            canReplacePreviewContentType(contentType, tab.contentType)
        )
        if (existingPreview) {
          nextTabs = existingTabs.filter((tab) => tab.id !== existingPreview.id)
          nextOrder = nextOrder.filter((tabId) => tabId !== existingPreview.id)
        }
      }

      created = {
        id,
        entityId: init?.entityId ?? id,
        groupId: group.id,
        worktreeId,
        contentType,
        label:
          init?.label ?? (contentType === 'terminal' ? `Terminal ${existingTabs.length + 1}` : id),
        ...(init?.generatedLabel !== undefined ? { generatedLabel: init.generatedLabel } : {}),
        ...(init?.quickCommandLabel !== undefined
          ? { quickCommandLabel: init.quickCommandLabel }
          : {}),
        customLabel: init?.customLabel ?? null,
        color: init?.color ?? null,
        sortOrder: nextOrder.length,
        createdAt: Date.now(),
        isPreview: init?.isPreview,
        isPinned: init?.isPinned
      }

      nextOrder = dedupeTabOrder([...nextOrder, created.id])
      const shouldActivate = init?.activate ?? true
      const nextActiveTabId = shouldActivate ? created.id : (group.activeTabId ?? created.id)
      const sanitizedRecent = sanitizeRecentTabIds(group.recentTabIds, nextOrder)
      // Why: automation-created browser tabs must paint without stealing the visible group selection from the user's current tab.
      const nextRecent = shouldActivate
        ? pushRecentTabId(sanitizedRecent, created.id)
        : sanitizedRecent
      return {
        unifiedTabsByWorktree: {
          ...state.unifiedTabsByWorktree,
          [worktreeId]: [...nextTabs, created]
        },
        groupsByWorktree: {
          ...groupsByWorktree,
          [worktreeId]: updateGroup(groupsByWorktree[worktreeId] ?? [], {
            ...group,
            activeTabId: nextActiveTabId,
            tabOrder: nextOrder,
            recentTabIds: nextRecent
          })
        },
        activeGroupIdByWorktree,
        layoutByWorktree: {
          ...state.layoutByWorktree,
          [worktreeId]: state.layoutByWorktree[worktreeId] ?? { type: 'leaf', groupId: group.id }
        }
      }
    })
    if (init?.recordInteraction !== false) {
      get().recordFeatureInteraction?.('terminal-tabs')
    }
    return created
  },
  createUnifiedTabInSplit: (worktreeId, contentType, target, init) => {
    const id = init?.id ?? createBrowserUuid()
    const newGroupId = createBrowserUuid()
    let created: Tab | null = null
    let moved = false
    set((state) => {
      const sourceGroup = findGroupForTab(state.groupsByWorktree, worktreeId, target.sourceGroupId)
      if (!sourceGroup) {
        return {}
      }
      const existingTabs = state.unifiedTabsByWorktree[worktreeId] ?? []
      const currentGroups = state.groupsByWorktree[worktreeId] ?? []
      const shouldActivate = init?.activate ?? true
      const currentLayout =
        state.layoutByWorktree[worktreeId] ??
        ({ type: 'leaf', groupId: target.sourceGroupId } as const)
      const createdTab: Tab = {
        id,
        entityId: init?.entityId ?? id,
        groupId: newGroupId,
        worktreeId,
        contentType,
        label:
          init?.label ?? (contentType === 'terminal' ? `Terminal ${existingTabs.length + 1}` : id),
        ...(init?.generatedLabel !== undefined ? { generatedLabel: init.generatedLabel } : {}),
        ...(init?.quickCommandLabel !== undefined
          ? { quickCommandLabel: init.quickCommandLabel }
          : {}),
        customLabel: init?.customLabel ?? null,
        color: init?.color ?? null,
        sortOrder: 0,
        createdAt: Date.now(),
        isPreview: init?.isPreview,
        isPinned: init?.isPinned
      }
      const newGroup: TabGroup = {
        id: newGroupId,
        worktreeId,
        activeTabId: id,
        tabOrder: [id],
        recentTabIds: shouldActivate ? [id] : []
      }
      created = createdTab
      const replacement = buildSplitNode(
        target.sourceGroupId,
        newGroupId,
        target.splitDirection === 'left' || target.splitDirection === 'right'
          ? 'horizontal'
          : 'vertical',
        target.splitDirection === 'left' || target.splitDirection === 'up' ? 'first' : 'second'
      )
      const nextUnifiedTabsByWorktree = {
        ...state.unifiedTabsByWorktree,
        [worktreeId]: [...existingTabs, createdTab]
      }
      const nextGroupsByWorktree = {
        ...state.groupsByWorktree,
        [worktreeId]: [...currentGroups, newGroup]
      }
      const nextLayoutByWorktree = {
        ...state.layoutByWorktree,
        [worktreeId]: replaceLeaf(currentLayout, target.sourceGroupId, replacement)
      }
      const nextActiveGroupIdByWorktree = shouldActivate
        ? {
            ...state.activeGroupIdByWorktree,
            [worktreeId]: newGroupId
          }
        : state.activeGroupIdByWorktree
      moved = true
      return {
        unifiedTabsByWorktree: nextUnifiedTabsByWorktree,
        groupsByWorktree: nextGroupsByWorktree,
        layoutByWorktree: nextLayoutByWorktree,
        activeGroupIdByWorktree: nextActiveGroupIdByWorktree,
        ...(shouldActivate && state.activeWorktreeId === worktreeId
          ? buildActiveSurfacePatch(
              {
                ...state,
                unifiedTabsByWorktree: nextUnifiedTabsByWorktree,
                groupsByWorktree: nextGroupsByWorktree,
                layoutByWorktree: nextLayoutByWorktree,
                activeGroupIdByWorktree: nextActiveGroupIdByWorktree
              },
              worktreeId,
              newGroupId
            )
          : {})
      }
    })
    if (created && init?.recordInteraction !== false) {
      get().recordFeatureInteraction?.('terminal-tabs')
    }
    if (moved && init?.recordInteraction !== false) {
      get().recordFeatureInteraction?.('tab-splits')
    }
    return created
  },
  getTab: (tabId) => findTabAndWorktree(get().unifiedTabsByWorktree, tabId)?.tab ?? null,
  getActiveTab: (worktreeId) => {
    const state = get()
    const groupId = state.activeGroupIdByWorktree[worktreeId]
    const group = (state.groupsByWorktree[worktreeId] ?? []).find(
      (candidate) => candidate.id === groupId
    )
    if (!group?.activeTabId) {
      return null
    }
    return (
      (state.unifiedTabsByWorktree[worktreeId] ?? []).find((tab) => tab.id === group.activeTabId) ??
      null
    )
  },
  findTabForEntityInGroup: (worktreeId, groupId, entityId, contentType) =>
    findTabByEntityInGroup(get().unifiedTabsByWorktree, worktreeId, groupId, entityId, contentType),
  activateTab: (tabId, opts) => {
    set((state) => {
      const found = findTabAndWorktree(state.unifiedTabsByWorktree, tabId)
      if (!found) {
        return {}
      }
      const { tab, worktreeId } = found
      // Why: activating a terminal tab dismisses its tab-level bell — the user has moved their eyes here.
      // Why (activeWorktree guard below): only when the tab is in the active worktree, else the unseen signal is lost (mirrors focusGroup).
      const terminalEntityId = tab.contentType === 'terminal' ? tab.entityId : null
      const nextUnreadTerminalTabs =
        state.activeWorktreeId === worktreeId &&
        terminalEntityId &&
        state.unreadTerminalTabs[terminalEntityId]
          ? (() => {
              const copy = { ...state.unreadTerminalTabs }
              delete copy[terminalEntityId]
              return copy
            })()
          : state.unreadTerminalTabs
      return {
        unifiedTabsByWorktree: opts?.preservePreview
          ? state.unifiedTabsByWorktree
          : {
              ...state.unifiedTabsByWorktree,
              [worktreeId]: (state.unifiedTabsByWorktree[worktreeId] ?? []).map((item) =>
                item.id === tabId ? { ...item, isPreview: false } : item
              )
            },
        groupsByWorktree: {
          ...state.groupsByWorktree,
          [worktreeId]: (state.groupsByWorktree[worktreeId] ?? []).map((group) =>
            group.id === tab.groupId
              ? {
                  ...group,
                  activeTabId: tabId,
                  // Why: track every activation in the group's MRU so closeUnifiedTab returns to the previous tab; sanitize to prune removed ids.
                  recentTabIds: pushRecentTabId(
                    sanitizeRecentTabIds(group.recentTabIds, group.tabOrder),
                    tabId
                  )
                }
              : group
          )
        },
        activeGroupIdByWorktree: {
          ...state.activeGroupIdByWorktree,
          [worktreeId]: tab.groupId
        },
        // Why: skip writing unreadTerminalTabs when the reference is unchanged, avoiding a no-op alloc that re-runs full-state selectors.
        ...(nextUnreadTerminalTabs !== state.unreadTerminalTabs
          ? { unreadTerminalTabs: nextUnreadTerminalTabs }
          : {})
      }
    })
  },
  }
}