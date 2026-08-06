import { useCallback } from 'react'
import type React from 'react'
import type { WorkspaceStatus } from '../../../../shared/types'
import { hasWorkspaceDragData, readWorkspaceDragDataIds } from './workspace-status'
import type { WorktreeSidebarDragSession } from './worktree-sidebar-drag-autoscroll'
import type { WorktreeDragGroup } from './worktree-manual-order'

export type WorktreeListStatusDropContext = {
  setDragOverStatus: (status: WorkspaceStatus | null) => void
  setPinDragOver: (active: boolean) => void
  dragSessionRef: React.MutableRefObject<WorktreeSidebarDragSession | null>
  computeStatusDrop: (args: {
    pointerY: number
    status: WorkspaceStatus
    draggedIds: readonly string[]
  }) => { dropIndex: number } | null
  getReorderDraggedIds: (ids: readonly string[]) => readonly string[]
  groups: readonly WorktreeDragGroup[]
  clearDrag: () => void
  onMoveWorktreeToStatus: (worktreeId: string, status: WorkspaceStatus) => void
  onPinWorktree: (worktreeId: string) => void
  onMoveWorktreesToStatus: (ids: readonly string[], status: WorkspaceStatus) => void
  onMoveWorktreesToStatusAtIndex: (args: {
    worktreeIds: readonly string[]
    status: WorkspaceStatus
    dropIndex: number
    groups: readonly WorktreeDragGroup[]
  }) => void
}

export function useWorktreeListStatusDrop(context: WorktreeListStatusDropContext) {
  const handleStatusDragOver = useCallback(
    (event: React.DragEvent, status: WorkspaceStatus) => {
      if (!hasWorkspaceDragData(event.dataTransfer)) {
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      context.setDragOverStatus(status)
    },
    [context]
  )
  const handleStatusDragLeave = useCallback(
    (event: React.DragEvent) => {
      const relatedTarget = event.relatedTarget
      if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
        return
      }
      context.setDragOverStatus(null)
    },
    [context]
  )
  const handlePinDragOver = useCallback(
    (event: React.DragEvent) => {
      if (!hasWorkspaceDragData(event.dataTransfer)) {
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      context.setPinDragOver(true)
    },
    [context]
  )
  const handlePinDragLeave = useCallback(
    (event: React.DragEvent) => {
      const relatedTarget = event.relatedTarget
      if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
        return
      }
      context.setPinDragOver(false)
    },
    [context]
  )
  const handleStatusDrop = useCallback(
    (event: React.DragEvent, status: WorkspaceStatus) => {
      const worktreeIds = readWorkspaceDragDataIds(event.dataTransfer)
      if (worktreeIds.length === 0) {
        return
      }
      event.preventDefault()
      const session = context.dragSessionRef.current
      const statusDrop = session
        ? context.computeStatusDrop({
            pointerY: event.clientY,
            status,
            draggedIds: session.reorderDraggedIds
          })
        : null
      context.setDragOverStatus(null)
      if (session && statusDrop) {
        event.stopPropagation()
        context.onMoveWorktreesToStatusAtIndex({
          worktreeIds: session.reorderDraggedIds,
          status,
          dropIndex: statusDrop.dropIndex,
          groups: context.groups
        })
        context.clearDrag()
        return
      }
      context.onMoveWorktreesToStatus(
        session ? session.reorderDraggedIds : context.getReorderDraggedIds(worktreeIds),
        status
      )
    },
    [context]
  )
  const finishStatusDrop = useCallback(() => {
    context.setDragOverStatus(null)
    context.setPinDragOver(false)
  }, [context])
  return {
    handleStatusDragOver,
    handleStatusDragLeave,
    handlePinDragOver,
    handlePinDragLeave,
    handleStatusDrop,
    finishStatusDrop
  }
}
