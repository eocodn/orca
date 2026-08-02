import type { AppState } from '../store/types'
import type {
  RuntimeMobileSessionTabGroup
} from '../../../shared/runtime-types'
import type { Tab, TabGroup, TabGroupLayoutNode } from '../../../shared/types'
import {
  getActiveTabNavOrder,
  getGroupVisibleTabOrder,
  type VisibleTabRef
} from '../components/tab-bar/group-tab-order'
import { parseRemoteRuntimePtyId } from './runtime-terminal-stream'
import { isWebTerminalSurfaceTabId } from '../../../shared/terminal-surface-id'
import {
  isEditorSurfaceTab,
  type FallbackEditorTabTarget,
  type OpenFileByWorktreeAndId,
  type OpenFileIndexes
} from './runtime-graph-sync'

let cachedOpenFileIndexesSource: AppState['openFiles'] | null = null
let cachedOpenFileIndexes: OpenFileIndexes | null = null
export function getEditorUnifiedTabsForWorktree(
  state: Pick<AppState, 'unifiedTabsByWorktree'>,
  worktreeId: string
): Tab[] {
  return (state.unifiedTabsByWorktree[worktreeId] ?? []).filter(isEditorSurfaceTab)
}

function applyUnifiedEditorTabIdsToLegacyOrder(
  order: readonly VisibleTabRef[],
  state: Pick<AppState, 'unifiedTabsByWorktree'>,
  worktreeId: string
): VisibleTabRef[] {
  const unifiedEditorTabs = getEditorUnifiedTabsForWorktree(state, worktreeId)
  if (unifiedEditorTabs.length === 0) {
    return [...order]
  }
  const firstUnifiedTabByFileId = new Map<string, string>()
  for (const tab of unifiedEditorTabs) {
    if (!firstUnifiedTabByFileId.has(tab.entityId)) {
      firstUnifiedTabByFileId.set(tab.entityId, tab.id)
    }
  }
  return order.map((item) => {
    if (item.type !== 'editor' || item.tabId) {
      return item
    }
    const tabId = firstUnifiedTabByFileId.get(item.id)
    return tabId ? { ...item, tabId } : item
  })
}

export function appendFallbackEditorTabsToGroups(
  tabGroups: RuntimeMobileSessionTabGroup[] | undefined,
  sourceGroups: readonly TabGroup[],
  activeGroupId: string | null,
  fallbackTabs: readonly FallbackEditorTabTarget[],
  activeTabId: string | null
): RuntimeMobileSessionTabGroup[] | undefined {
  if (fallbackTabs.length === 0) {
    return tabGroups
  }
  const result = [...(tabGroups ?? [])]
  const sourceGroupsById = new Map(sourceGroups.map((group) => [group.id, group]))
  const groupIndexById = new Map(result.map((group, index) => [group.id, index]))
  const firstTargetGroupId =
    result[0]?.id ??
    (activeGroupId && sourceGroupsById.has(activeGroupId) ? activeGroupId : null) ??
    sourceGroups[0]?.id ??
    null
  const fallbackTabIdSet = new Set(fallbackTabs.map((tab) => tab.tabId))

  for (const fallback of fallbackTabs) {
    const targetGroupId =
      fallback.groupId ??
      (activeGroupId && (groupIndexById.has(activeGroupId) || sourceGroupsById.has(activeGroupId))
        ? activeGroupId
        : firstTargetGroupId)
    if (!targetGroupId) {
      continue
    }
    let targetIndex = groupIndexById.get(targetGroupId)
    if (targetIndex === undefined) {
      const sourceGroup = sourceGroupsById.get(targetGroupId)
      const group: RuntimeMobileSessionTabGroup = {
        id: targetGroupId,
        activeTabId: sourceGroup?.activeTabId ?? null,
        tabOrder: [],
        recentTabIds: sourceGroup?.recentTabIds ?? []
      }
      targetIndex = result.length
      groupIndexById.set(targetGroupId, targetIndex)
      result.push(group)
    }
    const group = result[targetIndex]!
    if (!group.tabOrder.includes(fallback.tabId)) {
      result[targetIndex] = {
        ...group,
        tabOrder: [...group.tabOrder, fallback.tabId]
      }
    }
  }

  if (result.length === 0) {
    return tabGroups
  }

  const activeFallbackTabId = activeTabId && fallbackTabIdSet.has(activeTabId) ? activeTabId : null

  return result.map((group) => {
    const tabOrder = [...group.tabOrder]
    const tabOrderSet = new Set(tabOrder)
    const activeFallbackTabIdForGroup =
      activeFallbackTabId && tabOrderSet.has(activeFallbackTabId) ? activeFallbackTabId : null
    const activeTabIdForGroup =
      activeFallbackTabIdForGroup ??
      (group.activeTabId && tabOrderSet.has(group.activeTabId) ? group.activeTabId : null)
    const recentTabIds = (group.recentTabIds ?? []).filter((tabId) => tabOrderSet.has(tabId))
    if (
      activeFallbackTabId &&
      tabOrderSet.has(activeFallbackTabId) &&
      !recentTabIds.includes(activeFallbackTabId)
    ) {
      recentTabIds.push(activeFallbackTabId)
    }
    return {
      ...group,
      activeTabId: activeTabIdForGroup,
      tabOrder,
      recentTabIds
    }
  })
}

export function isRemoteRuntimePtyId(ptyId: string | null | undefined): boolean {
  return typeof ptyId === 'string' && parseRemoteRuntimePtyId(ptyId) !== null
}

export function isWebOnlyMirroredTerminalTab(
  state: Pick<AppState, 'terminalLayoutsByTabId'>,
  tab: Pick<NonNullable<AppState['tabsByWorktree'][string]>[number], 'id' | 'ptyId'>
): boolean {
  if (!isWebTerminalSurfaceTabId(tab.id)) {
    return false
  }
  const layoutPtyIds = Object.values(state.terminalLayoutsByTabId[tab.id]?.ptyIdsByLeafId ?? {})
  const ptyIds = [tab.ptyId, ...layoutPtyIds].filter(
    (ptyId): ptyId is string => typeof ptyId === 'string' && ptyId.length > 0
  )
  // Why: only-remote/no-PTY tabs are web mirrors, not host state; legacy local-PTY tabs still publish for desktop/web parity.
  return ptyIds.every(isRemoteRuntimePtyId)
}

export function getOpenFileIndexes(openFiles: AppState['openFiles']): OpenFileIndexes {
  if (cachedOpenFileIndexesSource === openFiles && cachedOpenFileIndexes) {
    return cachedOpenFileIndexes
  }

  const byWorktreeAndId: OpenFileByWorktreeAndId = new Map()
  const idsByWorktree = new Map<string, string[]>()
  for (const file of openFiles) {
    let filesById = byWorktreeAndId.get(file.worktreeId)
    if (!filesById) {
      filesById = new Map()
      byWorktreeAndId.set(file.worktreeId, filesById)
    }
    let ids = idsByWorktree.get(file.worktreeId)
    if (!ids) {
      ids = []
      idsByWorktree.set(file.worktreeId, ids)
    }
    if (!filesById.has(file.id)) {
      filesById.set(file.id, file)
      ids.push(file.id)
    }
  }

  cachedOpenFileIndexesSource = openFiles
  cachedOpenFileIndexes = { byWorktreeAndId, idsByWorktree }
  return cachedOpenFileIndexes
}

export function collectTabGroupLayoutIds(layout: TabGroupLayoutNode | undefined): string[] {
  const result: string[] = []
  const visit = (node: TabGroupLayoutNode | undefined): void => {
    if (!node) {
      return
    }
    if (node.type === 'leaf') {
      result.push(node.groupId)
      return
    }
    visit(node.first)
    visit(node.second)
  }
  visit(layout)
  return result
}

export function pruneTabGroupLayout(
  layout: TabGroupLayoutNode | undefined,
  validGroupIds: ReadonlySet<string>
): TabGroupLayoutNode | null {
  if (!layout) {
    return null
  }
  if (layout.type === 'leaf') {
    return validGroupIds.has(layout.groupId) ? layout : null
  }
  const first = pruneTabGroupLayout(layout.first, validGroupIds)
  const second = pruneTabGroupLayout(layout.second, validGroupIds)
  if (first && second) {
    return { ...layout, first, second }
  }
  return first ?? second
}

export function getOrderedTabGroups(
  groups: readonly TabGroup[],
  layout: TabGroupLayoutNode | undefined
): TabGroup[] {
  const byId = new Map(groups.map((group) => [group.id, group]))
  const seen = new Set<string>()
  const ordered: TabGroup[] = []
  for (const groupId of collectTabGroupLayoutIds(layout)) {
    const group = byId.get(groupId)
    if (!group || seen.has(group.id)) {
      continue
    }
    seen.add(group.id)
    ordered.push(group)
  }
  for (const group of groups) {
    if (!seen.has(group.id)) {
      ordered.push(group)
    }
  }
  return ordered
}

export function buildMobileSessionGroupProjection(
  state: AppState,
  worktreeId: string,
  ids: {
    terminalIds: string[]
    editorIds: string[]
    browserIds: string[]
  }
): {
  order: VisibleTabRef[]
  tabGroups?: RuntimeMobileSessionTabGroup[]
  tabGroupLayout?: TabGroupLayoutNode | null
} {
  const groups = state.groupsByWorktree[worktreeId] ?? []
  if (groups.length === 0) {
    return {
      order: applyUnifiedEditorTabIdsToLegacyOrder(
        getActiveTabNavOrder(state, worktreeId, {
          editorIds: ids.editorIds
        }),
        state,
        worktreeId
      )
    }
  }

  const terminalIds = new Set(ids.terminalIds)
  const editorIds = new Set(ids.editorIds)
  const browserIds = new Set(ids.browserIds)
  const tabs = state.unifiedTabsByWorktree[worktreeId] ?? []
  const order: VisibleTabRef[] = []
  const tabGroups: RuntimeMobileSessionTabGroup[] = []

  const layoutByWorktree = state.layoutByWorktree ?? {}
  for (const group of getOrderedTabGroups(groups, layoutByWorktree[worktreeId])) {
    const groupTabs = tabs.filter((tab) => tab.groupId === group.id)
    const visibleOrder = getGroupVisibleTabOrder(
      group,
      groupTabs,
      terminalIds,
      editorIds,
      browserIds
    )
    if (visibleOrder.length === 0) {
      continue
    }
    const tabOrder = visibleOrder.map((item) => item.tabId ?? item.id)
    const tabOrderSet = new Set(tabOrder)
    // Why: persisted split groups can have very large tab orders; append iteratively to avoid V8's argument-list limit.
    for (const item of visibleOrder) {
      order.push(item)
    }
    tabGroups.push({
      id: group.id,
      activeTabId:
        group.activeTabId && tabOrderSet.has(group.activeTabId) ? group.activeTabId : null,
      tabOrder,
      recentTabIds: group.recentTabIds?.filter((tabId) => tabOrderSet.has(tabId)) ?? []
    })
  }

  const validGroupIds = new Set(tabGroups.map((group) => group.id))
  return {
    order,
    tabGroups,
    tabGroupLayout: pruneTabGroupLayout(layoutByWorktree[worktreeId], validGroupIds)
  }
}
