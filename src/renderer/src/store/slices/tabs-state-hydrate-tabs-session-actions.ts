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
export function createTabsSliceHydrateTabsSessionActions6(set: SliceSet, get: SliceGet) {
  return {
  hydrateTabsSession: (session, options) => {
    const state = get()
    const persistedWorktreeIds = collectPersistedWorktreeIdsForSessionHydration(session)
    const validWorktreeIds = buildValidWorktreeIdsForSessionHydration(state, persistedWorktreeIds)
    validWorktreeIds.add(FLOATING_TERMINAL_WORKTREE_ID)
    for (const workspace of state.folderWorkspaces) {
      validWorktreeIds.add(folderWorkspaceKey(workspace.id))
    }
    addAdditionalValidWorkspaceKeys(validWorktreeIds, options)
    const hydrated = buildHydratedTabState(session, validWorktreeIds)
    if (!options?.replaceWorkspaceKeys) {
      set(hydrated)
      return
    }
    const replaceWorkspaceKeys = new Set(options.replaceWorkspaceKeys)
    set((current) => ({
      unifiedTabsByWorktree: replaceWorkspaceRecordKeys(
        current.unifiedTabsByWorktree,
        hydrated.unifiedTabsByWorktree,
        replaceWorkspaceKeys
      ),
      groupsByWorktree: replaceWorkspaceRecordKeys(
        current.groupsByWorktree,
        hydrated.groupsByWorktree,
        replaceWorkspaceKeys
      ),
      activeGroupIdByWorktree: replaceWorkspaceRecordKeys(
        current.activeGroupIdByWorktree,
        hydrated.activeGroupIdByWorktree,
        replaceWorkspaceKeys
      ),
      layoutByWorktree: replaceWorkspaceRecordKeys(
        current.layoutByWorktree,
        hydrated.layoutByWorktree,
        replaceWorkspaceKeys
      )
    }))
  }
  }
}
