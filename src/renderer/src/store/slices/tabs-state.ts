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

import { replaceWorkspaceRecordKeys, patchTerminalTabPinned, mirrorTabPinnedToHost, buildSplitNode, replaceLeaf, updateSplitRatio, findFirstLeaf, partitionPinnedTabOrder, applyTabOrderSortValues, isReplaceablePreviewContentType, canReplacePreviewContentType } from './tabs-state-tab-split-direction-support'
import type { TabSplitDirection, TabsSlice } from './tabs-state-tab-split-direction-support'
import { findSiblingGroupId, removeLeaf, collapseGroupLayout, toVisibleTabType, deriveActiveSurfaceForWorktree, buildActiveSurfacePatch, activeSurfacePatchMatchesState } from './tabs-state-find-sibling-group-id-support'
export { replaceWorkspaceRecordKeys, patchTerminalTabPinned, mirrorTabPinnedToHost, buildSplitNode, replaceLeaf, updateSplitRatio, findFirstLeaf, partitionPinnedTabOrder, applyTabOrderSortValues, isReplaceablePreviewContentType, canReplacePreviewContentType, findSiblingGroupId, removeLeaf, collapseGroupLayout, toVisibleTabType, deriveActiveSurfaceForWorktree, buildActiveSurfacePatch, activeSurfacePatchMatchesState }
export type { TabSplitDirection, TabsSlice }
import { createTabsSliceUnifiedTabsByWorktreeActions } from './tabs-state-unified-tabs-by-worktree-actions'
import { createTabsSliceCloseUnifiedTabActions2 } from './tabs-state-close-unified-tab-actions'
import { createTabsSliceUnpinTabActions3 } from './tabs-state-unpin-tab-actions'
import { createTabsSliceMoveUnifiedTabToGroupActions4 } from './tabs-state-move-unified-tab-to-group-actions'
import { createTabsSliceCopyUnifiedTabToGroupActions5 } from './tabs-state-copy-unified-tab-to-group-actions'
import { createTabsSliceHydrateTabsSessionActions6 } from './tabs-state-hydrate-tabs-session-actions'

export const createTabsSlice: StateCreator<AppState, [], [], TabsSlice> = (set, get) => ({
  ...createTabsSliceUnifiedTabsByWorktreeActions(set, get),
  ...createTabsSliceCloseUnifiedTabActions2(set, get),
  ...createTabsSliceUnpinTabActions3(set, get),
  ...createTabsSliceMoveUnifiedTabToGroupActions4(set, get),
  ...createTabsSliceCopyUnifiedTabToGroupActions5(set, get),
  ...createTabsSliceHydrateTabsSessionActions6(set, get),
})
