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
import { findSiblingGroupId, removeLeaf, collapseGroupLayout, toVisibleTabType, deriveActiveSurfaceForWorktree, buildActiveSurfacePatch, activeSurfacePatchMatchesState } from './tabs-state'
export type TabSplitDirection = 'left' | 'right' | 'up' | 'down'
export function replaceWorkspaceRecordKeys<T>(
  current: Record<string, T>,
  hydrated: Record<string, T>,
  workspaceKeys: ReadonlySet<string>
): Record<string, T> {
  return {
    ...Object.fromEntries(Object.entries(current).filter(([key]) => !workspaceKeys.has(key))),
    ...Object.fromEntries(Object.entries(hydrated).filter(([key]) => workspaceKeys.has(key)))
  }
}
export type TabsSlice = {
  unifiedTabsByWorktree: Record<string, Tab[]>
  // Why: id of the tab whose inline title editor should open; shortcut (tab.rename) sets it, the tab clears it on consume.
  renamingTabId: string | null
  groupsByWorktree: Record<string, TabGroup[]>
  activeGroupIdByWorktree: Record<string, string>
  layoutByWorktree: Record<string, TabGroupLayoutNode>
  createUnifiedTab: (
    worktreeId: string,
    contentType: TabContentType,
    init?: Partial<
      Pick<
        Tab,
        | 'id'
        | 'entityId'
        | 'label'
        | 'generatedLabel'
        | 'quickCommandLabel'
        | 'customLabel'
        | 'color'
        | 'isPreview'
        | 'isPinned'
      > & {
        targetGroupId: string
        activate: boolean
        recordInteraction: boolean
      }
    >
  ) => Tab
  createUnifiedTabInSplit: (
    worktreeId: string,
    contentType: TabContentType,
    target: {
      sourceGroupId: string
      splitDirection: TabSplitDirection
    },
    init?: Partial<
      Pick<
        Tab,
        | 'id'
        | 'entityId'
        | 'label'
        | 'generatedLabel'
        | 'quickCommandLabel'
        | 'customLabel'
        | 'color'
        | 'isPreview'
        | 'isPinned'
      > & {
        activate: boolean
        recordInteraction: boolean
      }
    >
  ) => Tab | null
  getTab: (tabId: string) => Tab | null
  getActiveTab: (worktreeId: string) => Tab | null
  findTabForEntityInGroup: (
    worktreeId: string,
    groupId: string,
    entityId: string,
    contentType?: TabContentType
  ) => Tab | null
  activateTab: (tabId: string, opts?: { preservePreview?: boolean }) => void
  closeUnifiedTab: (
    tabId: string,
    opts?: { recordInteraction?: boolean; terminalRetirementHandled?: boolean }
  ) => { closedTabId: string; wasLastTab: boolean; worktreeId: string } | null
  reorderUnifiedTabs: (
    groupId: string,
    tabIds: string[],
    opts?: { recordInteraction?: boolean }
  ) => void
  setTabLabel: (tabId: string, label: string) => void
  /** Set a tab's view mode (terminal vs native chat). Patches only that tab. */
  setTabViewMode: (tabId: string, mode: 'terminal' | 'chat') => void
  /** Flip a tab between terminal and native-chat renderings; the live TerminalPane stays mounted. */
  toggleTabViewMode: (tabId: string) => void
  setTabCustomLabel: (
    tabId: string,
    label: string | null,
    opts?: { recordInteraction?: boolean }
  ) => void
  setUnifiedTabColor: (tabId: string, color: string | null) => void
  setRenamingTabId: (tabId: string | null) => void
  pinTab: (tabId: string) => void
  unpinTab: (tabId: string) => void
  closeOtherTabs: (tabId: string) => string[]
  closeTabsToRight: (tabId: string) => string[]
  closeTabsToLeft: (tabId: string) => string[]
  ensureWorktreeRootGroup: (worktreeId: string) => string
  focusGroup: (worktreeId: string, groupId: string) => void
  closeEmptyGroup: (worktreeId: string, groupId: string) => boolean
  createEmptySplitGroup: (
    worktreeId: string,
    sourceGroupId: string,
    direction: TabSplitDirection
  ) => string | null
  moveUnifiedTabToGroup: (
    tabId: string,
    targetGroupId: string,
    opts?: { index?: number; activate?: boolean; recordInteraction?: boolean }
  ) => boolean
  dropUnifiedTab: (
    tabId: string,
    target: {
      groupId: string
      index?: number
      splitDirection?: TabSplitDirection
    }
  ) => boolean
  copyUnifiedTabToGroup: (
    tabId: string,
    targetGroupId: string,
    init?: Partial<
      Pick<
        Tab,
        | 'id'
        | 'entityId'
        | 'label'
        | 'generatedLabel'
        | 'quickCommandLabel'
        | 'customLabel'
        | 'color'
        | 'isPinned'
      >
    >
  ) => Tab | null
  mergeGroupIntoSibling: (worktreeId: string, groupId: string) => string | null
  setTabGroupSplitRatio: (worktreeId: string, nodePath: string, ratio: number) => void
  reconcileWorktreeTabModel: (worktreeId: string) => {
    renderableTabCount: number
    activeRenderableTabId: string | null
  }
  hydrateTabsSession: (
    session: WorkspaceSessionState,
    options?: WorkspaceSessionHydrationOptions
  ) => void
}

// Why: keep the TerminalTab pin in sync with the unified pin so reconcile's existing.isPinned fallback stays authoritative locally.
export function patchTerminalTabPinned(
  tabsByWorktree: Record<string, TerminalTab[]>,
  worktreeId: string,
  tabId: string,
  isPinned: boolean
): Partial<Pick<AppState, 'tabsByWorktree'>> {
  const tabs = tabsByWorktree[worktreeId]
  if (!tabs?.some((tab) => tab.id === tabId)) {
    return {}
  }
  return {
    tabsByWorktree: {
      ...tabsByWorktree,
      [worktreeId]: tabs.map((tab) => (tab.id === tabId ? { ...tab, isPinned } : tab))
    }
  }
}

// Why: pin is host-authoritative for remote-server tabs, so mirror it (like setTabColor) or it's lost on reconnect/other clients.
// Dynamic import keeps this store slice off the runtime layer.
export function mirrorTabPinnedToHost(state: AppState, tabId: string, isPinned: boolean): void {
  const found = findTabAndWorktree(state.unifiedTabsByWorktree, tabId)
  // Why: only terminal tab pins are persisted host-side today (browser/editor in #5729); skip the RPC for other types.
  if (
    !found ||
    found.tab.contentType !== 'terminal' ||
    !getRuntimeEnvironmentIdForWorktree(state, found.worktreeId)
  ) {
    return
  }
  const worktreeId = found.worktreeId
  void import('@/runtime/web-runtime-session').then(({ setWebRuntimeTabProps }) =>
    setWebRuntimeTabProps({ worktreeId, tabId, isPinned })
  )
}

// Why: viewMode is host-tracked like color/pin, so mirror local sets or they're lost on reconnect and to paired clients.
// Only the action path mirrors (never reconcile applying a host value), so the echoed snapshot can't re-trigger an outbound RPC.
export function mirrorTabViewModeToHost(
  state: AppState,
  tabId: string,
  viewMode: 'terminal' | 'chat'
): void {
  const found = findTabAndWorktree(state.unifiedTabsByWorktree, tabId)
  // Why: only terminal tab viewMode is persisted host-side; skip the RPC for other types instead of a no-op round trip.
  if (
    !found ||
    found.tab.contentType !== 'terminal' ||
    !getRuntimeEnvironmentIdForWorktree(state, found.worktreeId)
  ) {
    return
  }
  const worktreeId = found.worktreeId
  void import('@/runtime/web-runtime-session').then(({ setWebRuntimeTabProps }) =>
    setWebRuntimeTabProps({ worktreeId, tabId, viewMode })
  )
}
export function buildSplitNode(
  existingGroupId: string,
  newGroupId: string,
  direction: 'horizontal' | 'vertical',
  position: 'first' | 'second'
): TabGroupLayoutNode {
  const existingLeaf: TabGroupLayoutNode = { type: 'leaf', groupId: existingGroupId }
  const newLeaf: TabGroupLayoutNode = { type: 'leaf', groupId: newGroupId }
  return {
    type: 'split',
    direction,
    first: position === 'first' ? newLeaf : existingLeaf,
    second: position === 'second' ? newLeaf : existingLeaf,
    ratio: 0.5
  }
}
export function replaceLeaf(
  root: TabGroupLayoutNode,
  targetGroupId: string,
  replacement: TabGroupLayoutNode
): TabGroupLayoutNode {
  if (root.type === 'leaf') {
    return root.groupId === targetGroupId ? replacement : root
  }
  return {
    ...root,
    first: replaceLeaf(root.first, targetGroupId, replacement),
    second: replaceLeaf(root.second, targetGroupId, replacement)
  }
}
export function updateSplitRatio(
  root: TabGroupLayoutNode,
  path: string[],
  ratio: number
): TabGroupLayoutNode {
  if (path.length === 0) {
    return root.type === 'split' ? { ...root, ratio } : root
  }
  if (root.type !== 'split') {
    return root
  }
  const [segment, ...rest] = path
  if (segment === 'first') {
    return { ...root, first: updateSplitRatio(root.first, rest, ratio) }
  }
  if (segment === 'second') {
    return { ...root, second: updateSplitRatio(root.second, rest, ratio) }
  }
  return root
}
export function findFirstLeaf(root: TabGroupLayoutNode): string {
  return root.type === 'leaf' ? root.groupId : findFirstLeaf(root.first)
}
export function partitionPinnedTabOrder(tabOrder: string[], tabs: Tab[], movingTabId: string): string[] {
  const tabById = new Map(tabs.map((tab) => [tab.id, tab]))
  const withoutMoving = dedupeTabOrder(tabOrder).filter((id) => id !== movingTabId)
  const pinnedIds = withoutMoving.filter((id) => tabById.get(id)?.isPinned)
  const unpinnedIds = withoutMoving.filter((id) => !tabById.get(id)?.isPinned)
  return [...pinnedIds, movingTabId, ...unpinnedIds]
}
export function applyTabOrderSortValues(tabs: Tab[], tabOrder: string[]): Tab[] {
  const orderMap = new Map(tabOrder.map((id, index) => [id, index]))
  return tabs.map((tab) => {
    const sortOrder = orderMap.get(tab.id)
    return sortOrder === undefined ? tab : { ...tab, sortOrder }
  })
}
export function isReplaceablePreviewContentType(contentType: Tab['contentType']): boolean {
  return (
    contentType === 'editor' ||
    contentType === 'diff' ||
    contentType === 'conflict-review' ||
    contentType === 'check-details'
  )
}
export function canReplacePreviewContentType(
  incomingContentType: Tab['contentType'],
  existingContentType: Tab['contentType']
): boolean {
  if (isReplaceablePreviewContentType(incomingContentType)) {
    return isReplaceablePreviewContentType(existingContentType)
  }
  return existingContentType === incomingContentType
}
