import type { AppState } from '../store'
import type { TabContentType } from '../../../shared/types'

type TerminalStoreSnapshot = AppState

const EDITOR_TAB_CONTENT_TYPES = new Set<TabContentType>([
  'editor',
  'diff',
  'conflict-review',
  'check-details'
])

function findUnifiedTabByVisibleId(
  state: TerminalStoreSnapshot,
  worktreeId: string,
  visibleId: string
) {
  return (
    (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
      (tab) => tab.id === visibleId || tab.entityId === visibleId
    ) ?? null
  )
}

function findActiveUnifiedTab(state: TerminalStoreSnapshot, worktreeId: string) {
  const activeGroupId = state.activeGroupIdByWorktree[worktreeId]
  const group =
    (state.groupsByWorktree[worktreeId] ?? []).find(
      (candidate) => candidate.id === activeGroupId
    ) ?? null
  if (!group?.activeTabId) {
    return null
  }
  return (
    (state.unifiedTabsByWorktree[worktreeId] ?? []).find((tab) => tab.id === group.activeTabId) ??
    null
  )
}

export function isPinnedVisibleTab(
  state: AppState,
  worktreeId: string,
  visibleId: string
): boolean {
  return findUnifiedTabByVisibleId(state, worktreeId, visibleId)?.isPinned === true
}

export function isPinnedActiveEditorTab(
  state: AppState,
  worktreeId: string,
  fileId: string
): boolean {
  const activeTab = findActiveUnifiedTab(state, worktreeId)
  if (activeTab) {
    return (
      activeTab.entityId === fileId &&
      EDITOR_TAB_CONTENT_TYPES.has(activeTab.contentType) &&
      activeTab.isPinned === true
    )
  }
  return (state.unifiedTabsByWorktree[worktreeId] ?? []).some(
    (tab) =>
      tab.entityId === fileId &&
      EDITOR_TAB_CONTENT_TYPES.has(tab.contentType) &&
      tab.isPinned === true
  )
}

export function isPinnedEditorFileTab(
  state: AppState,
  worktreeId: string,
  fileId: string
): boolean {
  return (state.unifiedTabsByWorktree[worktreeId] ?? []).some(
    (tab) =>
      tab.entityId === fileId &&
      EDITOR_TAB_CONTENT_TYPES.has(tab.contentType) &&
      tab.isPinned === true
  )
}
