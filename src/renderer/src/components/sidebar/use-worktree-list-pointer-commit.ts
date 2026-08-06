import { useMemo } from 'react'
import type { WorktreePointerDrag } from './worktree-list-types'
import type { WorktreeListPointerDragContext } from './use-worktree-list-pointer-drag'
import { getFullDropIndexForWorktreeDragUnit } from './worktree-drag-units'
import {
  clearWorkspaceKanbanSidebarDropTargetVisual,
  getWorkspaceKanbanSidebarDropGroups,
  getWorkspaceKanbanSidebarDropTarget,
  isWorkspaceKanbanSidebarDropPointInBoard,
  resolveWorkspaceKanbanSidebarFullLaneDropIndex
} from './workspace-kanban-sidebar-drop'
import { resolveWorkspaceKanbanCardDropCommitTarget } from './workspace-kanban-card-pointer-drag-dom'
import { getPointerDropStatusTarget, shouldPreferSidebarStatusDropTarget } from './worktree-list-drop-target'
import { resolveWorktreeSidebarStatusDropCommitTarget } from './worktree-sidebar-drop-preview'

export function useWorktreeListPointerCommitHandlers(
  context: WorktreeListPointerDragContext,
  begin: (drag: WorktreePointerDrag) => void,
  schedule: (drag: WorktreePointerDrag) => void
) {
  return useMemo(() => ({
    onPointerMove: (event: PointerEvent) => {
      const drag = context.worktreePointerDragRef.current
      if (!drag || event.pointerId !== drag.pointerId) {
        return
      }
      drag.currentX = event.clientX
      drag.currentY = event.clientY
      if (!drag.active) {
        if (Math.hypot(drag.currentX - drag.startX, drag.currentY - drag.startY) < 4) {
          return
        }
        begin(drag)
      }
      event.preventDefault()
      event.stopPropagation()
      schedule(drag)
    },
    onPointerUp: (event: PointerEvent) => {
      const drag = context.worktreePointerDragRef.current
      if (!drag || event.pointerId !== drag.pointerId) {
        return
      }
      drag.currentX = event.clientX
      drag.currentY = event.clientY
      if (!drag.active) {
        context.worktreePointerDragRef.current = null
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (!context.refreshWorktreeDragSession()) {
        context.clearWorktreeDrag()
        return
      }
      const boardTarget = resolveWorkspaceKanbanCardDropCommitTarget({
        currentTarget: getWorkspaceKanbanSidebarDropTarget(event.clientX, event.clientY),
        latestTrackedTarget: drag.latestBoardDropTarget,
        x: event.clientX,
        y: event.clientY
      })
      if (isWorkspaceKanbanSidebarDropPointInBoard(event.clientX, event.clientY)) {
        context.onWorkspaceBoardDragPreviewCommit()
      }
      if (boardTarget.isPinDrop) {
        context.onPinWorktrees(drag.draggedIds)
      } else if (boardTarget.status) {
        context.onDropWorktreesOnWorkspaceBoard({
          worktreeIds: drag.reorderDraggedIds,
          status: boardTarget.status,
          dropIndex: resolveWorkspaceKanbanSidebarFullLaneDropIndex(boardTarget.status, boardTarget.dropIndex),
          groups: getWorkspaceKanbanSidebarDropGroups()
        })
      } else {
        const target = context.getEligibleLineageDropTarget(
          context.scrollRef.current
            ? getPointerDropStatusTarget({ container: context.scrollRef.current, x: event.clientX, y: event.clientY })
            : { status: null, isPinDrop: false, lineageParentId: null },
          drag.draggedIds
        )
        if (target.lineageParentId) {
          context.commitLineageParentDrop(drag.draggedIds, target.lineageParentId)
          context.clearWorktreeDrag()
          return
        }
        const statusDrop = target.status
          ? context.computeWorktreeStatusDrop({ pointerY: event.clientY, status: target.status, draggedIds: drag.reorderDraggedIds })
          : null
        if (shouldPreferSidebarStatusDropTarget({ sourceGroupKey: drag.sourceGroupKey, target, workspaceStatuses: context.workspaceStatuses })) {
          if (target.isPinDrop) {
            context.onPinWorktrees(drag.draggedIds)
          } else if (target.status && statusDrop) {
            context.onMoveWorktreesToStatusAtIndex({ worktreeIds: drag.reorderDraggedIds, status: target.status, dropIndex: statusDrop.dropIndex, groups: context.worktreeDragGroups })
          } else if (target.status) {
            context.onMoveWorktreesToStatus(drag.reorderDraggedIds, target.status)
          }
          context.clearWorktreeDrag()
          return
        }
        const drop = context.computeWorktreeDrop(event.clientY)
        if (drop) {
          context.onReorderWorktrees({
            groups: context.worktreeDragGroups,
            sourceGroupKey: drag.sourceGroupKey,
            draggedIds: drag.reorderDraggedIds,
            dropIndex: getFullDropIndexForWorktreeDragUnit({ groups: context.worktreeDragUnitGroups, sourceGroupKey: drag.sourceGroupKey, dropIndex: drop.dropIndex })
          })
          context.clearReorderedParents({ draggedIds: drag.draggedIds, sourceGroupKey: drag.sourceGroupKey })
        } else {
          const latest = resolveWorktreeSidebarStatusDropCommitTarget({ currentTarget: target, currentPreview: statusDrop, latestTrackedTarget: drag.latestStatusDropTarget, x: event.clientX, y: event.clientY })
          if (latest.target.lineageParentId) {
            context.commitLineageParentDrop(drag.draggedIds, latest.target.lineageParentId)
          } else if (latest.target.isPinDrop) {
            context.onPinWorktrees(drag.draggedIds)
          } else if (latest.target.status && latest.preview) {
            context.onMoveWorktreesToStatusAtIndex({ worktreeIds: drag.reorderDraggedIds, status: latest.target.status, dropIndex: latest.preview.dropIndex, groups: context.worktreeDragGroups })
          } else if (latest.target.status) {
            context.onMoveWorktreesToStatus(drag.reorderDraggedIds, latest.target.status)
          }
        }
      }
      clearWorkspaceKanbanSidebarDropTargetVisual()
      context.clearWorktreeDrag()
    },
    onPointerCancel: (event: PointerEvent) => {
      const drag = context.worktreePointerDragRef.current
      if (drag && event.pointerId === drag.pointerId) {
        context.clearWorktreeDrag()
      }
    }
  }), [begin, context, schedule])
}