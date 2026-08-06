import { useCallback } from 'react'
import type React from 'react'
import type { WorktreePointerDrag } from './worktree-list-types'
import type { WorktreeListPointerDragContext } from './use-worktree-list-pointer-drag'
import {
  createSidebarDragPreview,
  isSidebarPointerDragBlocked,
  setSidebarPointerDragDocumentStyles,
  updateSidebarDragPreviewPosition
} from './worktree-sidebar-pointer-drag-dom'
import {
  clearWorkspaceKanbanSidebarDropTargetVisual,
  hasWorkspaceKanbanSidebarDropBoard,
  isWorkspaceKanbanSidebarDropPointInBoard,
  updateWorkspaceKanbanSidebarDropTargetVisual
} from './workspace-kanban-sidebar-drop'
import {
  getWorktreeSidebarDragAutoscroll,
  getWorktreeSidebarDragRectsForGroup
} from './worktree-sidebar-drag-autoscroll'
import { getWorktreeSidebarDragGrab } from './worktree-sidebar-drag-geometry'
import { getPointerDropStatusTarget, shouldPreferSidebarStatusDropTarget } from './worktree-list-drop-target'
import type { WorktreeSidebarStatusDropTarget, WorktreeSidebarDropPreview } from './worktree-sidebar-drop-preview'

const DRAG_THRESHOLD = 4
const EMPTY_OFFSETS: ReadonlyMap<string, number> = new Map()
type StatusTarget = WorktreeSidebarStatusDropTarget & { lineageParentId: string | null }
type StatusPreview = WorktreeSidebarDropPreview | null

function sameOffsets(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a === b) {
    return true
  }
  if (a.size !== b.size) {
    return false
  }
  for (const [key, value] of a) {
    if (b.get(key) !== value) {
      return false
    }
  }
  return true
}

function updateLatestStatus(drag: WorktreePointerDrag, target: StatusTarget, preview: StatusPreview): void {
  drag.latestStatusDropTarget =
    target.status || target.isPinDrop || target.lineageParentId
      ? { target, preview, x: drag.currentX, y: drag.currentY }
      : null
}

export function useWorktreeListPointerPreview(context: WorktreeListPointerDragContext) {
  const cancelAutoscroll = useCallback(() => {
    if (context.pointerAutoscrollFrameRef.current !== null) {
      window.cancelAnimationFrame(context.pointerAutoscrollFrameRef.current)
      context.pointerAutoscrollFrameRef.current = null
    }
    context.pointerAutoscrollLastFrameRef.current = null
  }, [context.pointerAutoscrollFrameRef, context.pointerAutoscrollLastFrameRef])

  const flush = useCallback(() => {
    const drag = context.worktreePointerDragRef.current
    if (!drag) {
      return
    }
    drag.frameId = null
    if (!drag.active || !drag.preview) {
      return
    }
    updateSidebarDragPreviewPosition({
      preview: drag.preview,
      pointerX: drag.currentX,
      pointerY: drag.currentY,
      offsetX: drag.previewOffsetX,
      offsetY: drag.previewOffsetY
    })
    if (!context.refreshWorktreeDragSession()) {
      context.clearWorktreeDrag()
      return
    }
    if (!drag.workspaceBoardDragPreviewRequested && !context.workspaceBoardOpen && !hasWorkspaceKanbanSidebarDropBoard()) {
      drag.workspaceBoardDragPreviewRequested = true
      context.onWorkspaceBoardDragPreviewStart()
    }
    const boardTarget = updateWorkspaceKanbanSidebarDropTargetVisual({
      x: drag.currentX,
      y: drag.currentY,
      shouldShowDropIndicator: (target) =>
        Boolean(target.status && context.shouldShowWorkspaceBoardDropIndicator(drag.reorderDraggedIds, target.status))
    })
    drag.latestBoardDropTarget = { target: boardTarget, x: drag.currentX, y: drag.currentY }
    if (isWorkspaceKanbanSidebarDropPointInBoard(drag.currentX, drag.currentY)) {
      context.onWorkspaceBoardDragPreviewCommit()
    }
    if (boardTarget.status || boardTarget.isPinDrop) {
      drag.latestStatusDropTarget = null
      context.setDragOverStatus(null)
      context.setPinDragOver(false)
      context.worktreeDragStateSetter((prev) =>
        prev.dropIndex === null && prev.dropIndicatorY === null && prev.pointerY === drag.currentY && prev.previewOffsetsByWorktreeId.size === 0
          ? prev
          : { ...prev, dropIndex: null, dropIndicatorY: null, previewOffsetsByWorktreeId: EMPTY_OFFSETS, pointerY: drag.currentY }
      )
      return
    }
    const target = context.getEligibleLineageDropTarget(
      context.scrollRef.current
        ? getPointerDropStatusTarget({ container: context.scrollRef.current, x: drag.currentX, y: drag.currentY })
        : { status: null, isPinDrop: false, lineageParentId: null },
      drag.draggedIds
    )
    if (target.lineageParentId) {
      updateLatestStatus(drag, target, null)
      clearWorkspaceKanbanSidebarDropTargetVisual()
      context.setDragOverStatus(null)
      context.setPinDragOver(false)
      context.worktreeDragStateSetter((prev) => ({ ...prev, dropIndex: null, dropIndicatorY: null, previewOffsetsByWorktreeId: EMPTY_OFFSETS, pointerY: drag.currentY }))
      return
    }
    const preferred = shouldPreferSidebarStatusDropTarget({ sourceGroupKey: drag.sourceGroupKey, target, workspaceStatuses: context.workspaceStatuses })
    const statusDrop = target.status ? context.computeWorktreeStatusDrop({ pointerY: drag.currentY, status: target.status, draggedIds: drag.reorderDraggedIds }) : null
    if (preferred || !context.computeWorktreeDrop(drag.currentY)) {
      if (statusDrop) {
        updateLatestStatus(drag, target, statusDrop)
        clearWorkspaceKanbanSidebarDropTargetVisual()
        context.setDragOverStatus(null)
        context.setPinDragOver(false)
        context.worktreeDragStateSetter((prev) =>
          prev.dropIndex === statusDrop.dropIndex && prev.dropIndicatorY === statusDrop.dropIndicatorY && prev.pointerY === drag.currentY && sameOffsets(prev.previewOffsetsByWorktreeId, statusDrop.previewOffsetsByWorktreeId)
            ? prev
            : { ...prev, ...statusDrop, pointerY: drag.currentY }
        )
        return
      }
      updateLatestStatus(drag, target, null)
      context.setDragOverStatus(target.status)
      context.setPinDragOver(target.isPinDrop)
      context.worktreeDragStateSetter((prev) => ({ ...prev, dropIndex: null, dropIndicatorY: null, previewOffsetsByWorktreeId: EMPTY_OFFSETS, pointerY: drag.currentY }))
      return
    }
    const drop = context.computeWorktreeDrop(drag.currentY)
    if (!drop) {
      return
    }
    drag.latestStatusDropTarget = null
    clearWorkspaceKanbanSidebarDropTargetVisual()
    context.setDragOverStatus(null)
    context.setPinDragOver(false)
    context.worktreeDragStateSetter((prev) =>
      prev.dropIndex === drop.dropIndex && prev.dropIndicatorY === drop.dropIndicatorY && prev.pointerY === drag.currentY && sameOffsets(prev.previewOffsetsByWorktreeId, drop.previewOffsetsByWorktreeId)
        ? prev
        : { ...prev, ...drop, pointerY: drag.currentY }
    )
  }, [context])

  const schedule = useCallback((drag: WorktreePointerDrag) => {
    if (drag.frameId === null) {
      drag.frameId = window.requestAnimationFrame(flush)
    }
  }, [flush])

  const runAutoscroll = useCallback((time: number) => {
    context.pointerAutoscrollFrameRef.current = null
    const drag = context.worktreePointerDragRef.current
    const container = context.scrollRef.current
    const session = context.worktreeDragSessionRef.current
    if (!drag?.active || !container || !session) {
      cancelAutoscroll()
      return
    }
    const previous = context.pointerAutoscrollLastFrameRef.current ?? time
    context.pointerAutoscrollLastFrameRef.current = time
    const autoscroll = getWorktreeSidebarDragAutoscroll({ point: { clientX: drag.currentX, clientY: drag.currentY }, containerRect: container.getBoundingClientRect(), scrollTop: container.scrollTop, scrollHeight: container.scrollHeight, clientHeight: container.clientHeight, elapsedMs: time - previous })
    if (autoscroll) {
      context.markScrollMovement()
      container.scrollTop = autoscroll.scrollTop
      if (!context.refreshWorktreeDragSession()) {
        context.clearWorktreeDrag()
        return
      }
      schedule(drag)
    }
    context.pointerAutoscrollFrameRef.current = window.requestAnimationFrame(runAutoscroll)
  }, [cancelAutoscroll, context, schedule])

  const startAutoscroll = useCallback(() => {
    if (context.pointerAutoscrollFrameRef.current === null) {
      context.pointerAutoscrollLastFrameRef.current = null
      context.pointerAutoscrollFrameRef.current = window.requestAnimationFrame(runAutoscroll)
    }
  }, [context.pointerAutoscrollFrameRef, context.pointerAutoscrollLastFrameRef, runAutoscroll])

  const begin = useCallback((drag: WorktreePointerDrag) => {
    const { preview, offsetX, offsetY, height } = createSidebarDragPreview({ sourceRow: drag.sourceRow, pointerX: drag.currentX, pointerY: drag.currentY, draggedCount: drag.draggedIds.length })
    drag.active = true
    drag.preview = preview
    drag.previewOffsetX = offsetX
    drag.previewOffsetY = offsetY
    setSidebarPointerDragDocumentStyles(true)
    context.worktreeDragSessionRef.current = { draggingWorktreeId: drag.worktreeId, sourceGroupKey: drag.sourceGroupKey, draggedIds: drag.draggedIds, reorderDraggedIds: drag.reorderDraggedIds, reorderUnitDraggedIds: drag.reorderUnitDraggedIds, rects: drag.rects, grab: getWorktreeSidebarDragGrab({ offsetY, height }), anchor: null }
    context.worktreeDragStateSetter({ draggingWorktreeId: drag.worktreeId, sourceGroupKey: drag.sourceGroupKey, dropIndex: null, dropIndicatorY: null, previewOffsetsByWorktreeId: EMPTY_OFFSETS, pointerY: drag.currentY })
    startAutoscroll()
    schedule(drag)
  }, [context, schedule, startAutoscroll])

  const onRowPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>, worktreeId: string, rowKey: string) => {
    if (event.button !== 0 || event.pointerType === 'touch') {
      return
    }
    const sourceRow = event.currentTarget
    if (isSidebarPointerDragBlocked(event.target, sourceRow)) {
      return
    }
    const sourceGroupKey = context.groupKeyByRowKey.get(rowKey)
    const container = context.scrollRef.current
    if (!sourceGroupKey || !container) {
      return
    }
    const rects = getWorktreeSidebarDragRectsForGroup(container, sourceGroupKey)
    if (rects.length <= 1 && !hasWorkspaceKanbanSidebarDropBoard() && !context.canPreviewWorkspaceBoardOnDrag) {
      return
    }
    const draggedIds = context.selectedWorktreeIds.has(worktreeId) && context.selectedWorktrees.length > 1 ? context.selectedWorktrees.map((w) => w.id) : [worktreeId]
    const reorderDraggedIds = context.getReorderDraggedIds(draggedIds)
    context.worktreePointerDragRef.current = { pointerId: event.pointerId, sourceRow, startX: event.clientX, startY: event.clientY, currentX: event.clientX, currentY: event.clientY, worktreeId, draggedIds, reorderDraggedIds, reorderUnitDraggedIds: context.getReorderUnitDraggedIds(sourceGroupKey, reorderDraggedIds), sourceGroupKey, rects, active: false, preview: null, previewOffsetX: 0, previewOffsetY: 0, workspaceBoardDragPreviewRequested: false, frameId: null, latestBoardDropTarget: null, latestStatusDropTarget: null }
  }, [context])

  return { onRowPointerDown, begin, schedule }
}