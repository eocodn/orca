import { useEffect } from 'react'
import type React from 'react'
import type { WorkspaceStatus, WorkspaceStatusDefinition } from '../../../../shared/types'
import type { WorktreePointerDrag, WorktreeRowDragState } from './worktree-list-types'
import type { WorktreeDragGroup } from './worktree-manual-order'
import type { WorktreeSidebarDragSession } from './worktree-sidebar-drag-autoscroll'
import type { WorktreeSidebarStatusDropTarget } from './worktree-sidebar-drop-preview'
import { registerWorktreeListPointerListeners } from './worktree-list-pointer-listeners'
import { useWorktreeListPointerPreview } from './use-worktree-list-pointer-preview'
import { useWorktreeListPointerCommitHandlers } from './use-worktree-list-pointer-commit'

type StatusTarget = WorktreeSidebarStatusDropTarget & { lineageParentId: string | null }

export type WorktreeListPointerDragContext = {
  scrollRef: React.MutableRefObject<HTMLDivElement | null>
  worktreePointerDragRef: React.MutableRefObject<WorktreePointerDrag | null>
  pointerAutoscrollFrameRef: React.MutableRefObject<number | null>
  pointerAutoscrollLastFrameRef: React.MutableRefObject<number | null>
  worktreeDragSessionRef: React.MutableRefObject<WorktreeSidebarDragSession | null>
  groupKeyByRowKey: ReadonlyMap<string, string>
  selectedWorktreeIds: ReadonlySet<string>
  selectedWorktrees: readonly { id: string }[]
  workspaceBoardOpen: boolean
  canPreviewWorkspaceBoardOnDrag: boolean
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
  worktreeDragGroups: readonly WorktreeDragGroup[]
  worktreeDragUnitGroups: readonly WorktreeDragGroup[]
  worktreeDragStateSetter: React.Dispatch<React.SetStateAction<WorktreeRowDragState>>
  setDragOverStatus: (status: WorkspaceStatus | null) => void
  setPinDragOver: (active: boolean) => void
  clearWorktreeDrag: () => void
  refreshWorktreeDragSession: () => boolean
  computeWorktreeDrop: (pointerY: number) => WorktreeRowDragState | null
  computeWorktreeStatusDrop: (args: { pointerY: number; status: WorkspaceStatus; draggedIds: readonly string[] }) => WorktreeRowDragState | null
  getReorderDraggedIds: (ids: readonly string[]) => readonly string[]
  getReorderUnitDraggedIds: (groupKey: string, ids: readonly string[]) => readonly string[]
  getEligibleLineageDropTarget: (target: StatusTarget, ids: readonly string[]) => StatusTarget
  commitLineageParentDrop: (ids: readonly string[], parentId: string) => boolean
  clearReorderedParents: (args: { draggedIds: readonly string[]; sourceGroupKey: string }) => void
  markScrollMovement: () => void
  onWorkspaceBoardDragPreviewStart: () => void
  onWorkspaceBoardDragPreviewCommit: () => void
  onWorkspaceBoardDragPreviewCancel: () => void
  shouldShowWorkspaceBoardDropIndicator: (ids: readonly string[], status: WorkspaceStatus) => boolean
  onDropWorktreesOnWorkspaceBoard: (args: { worktreeIds: readonly string[]; status: WorkspaceStatus; dropIndex: number; groups: readonly WorktreeDragGroup[] }) => void
  onPinWorktrees: (ids: readonly string[]) => void
  onMoveWorktreesToStatus: (ids: readonly string[], status: WorkspaceStatus) => void
  onMoveWorktreesToStatusAtIndex: (args: { worktreeIds: readonly string[]; status: WorkspaceStatus; dropIndex: number; groups: readonly WorktreeDragGroup[] }) => void
  onReorderWorktrees: (args: { groups: readonly WorktreeDragGroup[]; sourceGroupKey: string; draggedIds: readonly string[]; dropIndex: number }) => void
}

export function useWorktreeListPointerDragController(context: WorktreeListPointerDragContext) {
  const preview = useWorktreeListPointerPreview(context)
  const handlers = useWorktreeListPointerCommitHandlers(context, preview.begin, preview.schedule)

  useEffect(
    () => registerWorktreeListPointerListeners(handlers.onPointerMove, handlers.onPointerUp, handlers.onPointerCancel),
    [handlers]
  )

  return {
    onRowPointerDown: preview.onRowPointerDown,
    onRowClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
    }
  }
}