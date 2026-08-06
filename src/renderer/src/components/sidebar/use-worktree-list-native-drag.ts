import { useCallback } from 'react'
import type React from 'react'
import type { WorkspaceStatus } from '../../../../shared/types'
import type {
  WorktreeSidebarDragPoint,
  WorktreeSidebarDragSession
} from './worktree-sidebar-drag-autoscroll'
import type { WorktreeDragGroup } from './worktree-manual-order'
import type { WorktreeRowDragState } from './worktree-list-types'
import {
  getWorktreeSidebarDragAutoscroll,
  getWorktreeSidebarDragRectsForGroup
} from './worktree-sidebar-drag-autoscroll'
import { getWorktreeSidebarDragGrab } from './worktree-sidebar-drag-geometry'
import { getFullDropIndexForWorktreeDragUnit } from './worktree-drag-units'
import { getPointerDropStatusTarget } from './worktree-list-drop-target'
import { getWorkspaceKanbanSidebarDropTarget } from './workspace-kanban-sidebar-drop'

export type WorktreeListNativeDragContext = {
  scrollRef: React.MutableRefObject<HTMLDivElement | null>
  nativeFrameRef: React.MutableRefObject<number | null>
  nativeLastFrameRef: React.MutableRefObject<number | null>
  nativeLatestPointRef: React.MutableRefObject<WorktreeSidebarDragPoint | null>
  dragSessionRef: React.MutableRefObject<WorktreeSidebarDragSession | null>
  groups: readonly WorktreeDragGroup[]
  unitGroups: readonly WorktreeDragGroup[]
  setLineageTarget: (id: string | null) => void
  setDragState: React.Dispatch<React.SetStateAction<WorktreeRowDragState>>
  refreshDragSession: () => boolean
  computeDrop: (pointerY: number) => WorktreeRowDragState | null
  computeStatusDrop: (args: {
    pointerY: number
    status: WorkspaceStatus
    draggedIds: readonly string[]
  }) => WorktreeRowDragState | null
  getEligibleLineageDropTarget: <
    T extends { status: WorkspaceStatus | null; isPinDrop: boolean; lineageParentId: string | null }
  >(
    target: T,
    ids: readonly string[]
  ) => T
  commitLineageParentDrop: (ids: readonly string[], parentId: string) => boolean
  clearReorderedParents: (args: { draggedIds: readonly string[]; sourceGroupKey: string }) => void
  clearDrag: () => void
  markScrollMovement: () => void
  getReorderDraggedIds: (ids: readonly string[]) => readonly string[]
  getReorderUnitDraggedIds: (key: string, ids: readonly string[]) => readonly string[]
  onMoveWorktreesToStatusAtIndex: (args: {
    worktreeIds: readonly string[]
    status: WorkspaceStatus
    dropIndex: number
    groups: readonly WorktreeDragGroup[]
  }) => void
  onReorderWorktrees: (args: {
    groups: readonly WorktreeDragGroup[]
    sourceGroupKey: string
    draggedIds: readonly string[]
    dropIndex: number
  }) => void
}

export function useWorktreeListNativeDrag(context: WorktreeListNativeDragContext) {
  const runAutoscroll = useCallback(
    (time: number) => {
      context.nativeFrameRef.current = null
      const point = context.nativeLatestPointRef.current
      const container = context.scrollRef.current
      const session = context.dragSessionRef.current
      if (!point || !container || !session) {
        context.nativeLastFrameRef.current = null
        context.nativeLatestPointRef.current = null
        return
      }
      const previous = context.nativeLastFrameRef.current ?? time
      context.nativeLastFrameRef.current = time
      const autoscroll = getWorktreeSidebarDragAutoscroll({
        point,
        containerRect: container.getBoundingClientRect(),
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        elapsedMs: time - previous
      })
      if (autoscroll) {
        context.markScrollMovement()
        container.scrollTop = autoscroll.scrollTop
        if (!context.refreshDragSession()) {
          context.clearDrag()
          return
        }
        const drop = context.computeDrop(point.clientY)
        context.setDragState((prev) =>
          drop
            ? { ...prev, ...drop, pointerY: point.clientY }
            : {
                ...prev,
                dropIndex: null,
                dropIndicatorY: null,
                previewOffsetsByWorktreeId: new Map(),
                pointerY: null
              }
        )
      }
      context.nativeFrameRef.current = window.requestAnimationFrame(runAutoscroll)
    },
    [context]
  )
  const startAutoscroll = useCallback(() => {
    if (context.nativeFrameRef.current === null) {
      context.nativeLastFrameRef.current = null
      context.nativeFrameRef.current = window.requestAnimationFrame(runAutoscroll)
    }
  }, [context, runAutoscroll])
  const handleCardDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>, worktreeId: string, draggedIds: readonly string[]) => {
      const sourceGroupKey = context.groups.find((group) =>
        group.worktreeIds.includes(worktreeId)
      )?.key
      if (!sourceGroupKey) {
        return
      }
      const reorderDraggedIds = context.getReorderDraggedIds(draggedIds)
      const container = context.scrollRef.current
      const sourceRect = event.currentTarget.getBoundingClientRect()
      context.dragSessionRef.current = {
        draggingWorktreeId: worktreeId,
        sourceGroupKey,
        draggedIds,
        reorderDraggedIds,
        reorderUnitDraggedIds: context.getReorderUnitDraggedIds(sourceGroupKey, reorderDraggedIds),
        rects: container ? getWorktreeSidebarDragRectsForGroup(container, sourceGroupKey) : [],
        grab: getWorktreeSidebarDragGrab({
          offsetY: event.clientY - sourceRect.top,
          height: sourceRect.height
        }),
        anchor: null
      }
      context.setDragState({
        draggingWorktreeId: worktreeId,
        sourceGroupKey,
        dropIndex: null,
        dropIndicatorY: null,
        previewOffsetsByWorktreeId: new Map(),
        pointerY: null
      })
    },
    [context]
  )
  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const session = context.dragSessionRef.current
      if (!session) {
        return
      }
      context.nativeLatestPointRef.current = { clientX: event.clientX, clientY: event.clientY }
      startAutoscroll()
      if (!context.refreshDragSession()) {
        context.clearDrag()
        return
      }
      const target = context.getEligibleLineageDropTarget(
        getPointerDropStatusTarget({
          container: event.currentTarget,
          x: event.clientX,
          y: event.clientY
        }),
        session.draggedIds
      )
      if (target.lineageParentId) {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        context.setLineageTarget(target.lineageParentId)
        context.setDragState((prev) => ({
          ...prev,
          dropIndex: null,
          dropIndicatorY: null,
          previewOffsetsByWorktreeId: new Map(),
          pointerY: event.clientY
        }))
        return
      }
      context.setLineageTarget(null)
      const drop = context.computeDrop(event.clientY)
      if (!drop) {
        const statusDrop = target.status
          ? context.computeStatusDrop({
              pointerY: event.clientY,
              status: target.status,
              draggedIds: session.reorderDraggedIds
            })
          : null
        if (statusDrop) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          context.setDragState((prev) => ({ ...prev, ...statusDrop, pointerY: event.clientY }))
          return
        }
        context.setDragState((prev) => ({
          ...prev,
          dropIndex: null,
          dropIndicatorY: null,
          previewOffsetsByWorktreeId: new Map(),
          pointerY: null
        }))
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      context.setDragState((prev) => ({ ...prev, ...drop, pointerY: event.clientY }))
    },
    [context, startAutoscroll]
  )
  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const session = context.dragSessionRef.current
      if (!session) {
        return
      }
      if (!context.refreshDragSession()) {
        context.clearDrag()
        return
      }
      const board = getWorkspaceKanbanSidebarDropTarget(event.clientX, event.clientY)
      if (board.status || board.isPinDrop) {
        context.clearDrag()
        return
      }
      const target = context.getEligibleLineageDropTarget(
        getPointerDropStatusTarget({
          container: context.scrollRef.current ?? event.currentTarget,
          x: event.clientX,
          y: event.clientY
        }),
        session.draggedIds
      )
      if (target.lineageParentId) {
        event.preventDefault()
        event.stopPropagation()
        context.commitLineageParentDrop(session.draggedIds, target.lineageParentId)
        context.clearDrag()
        return
      }
      const drop = context.computeDrop(event.clientY)
      if (!drop) {
        const statusDrop = target.status
          ? context.computeStatusDrop({
              pointerY: event.clientY,
              status: target.status,
              draggedIds: session.reorderDraggedIds
            })
          : null
        if (target.status && statusDrop) {
          event.preventDefault()
          event.stopPropagation()
          context.onMoveWorktreesToStatusAtIndex({
            worktreeIds: session.reorderDraggedIds,
            status: target.status,
            dropIndex: statusDrop.dropIndex,
            groups: context.groups
          })
        }
        context.clearDrag()
        return
      }
      event.preventDefault()
      context.onReorderWorktrees({
        groups: context.groups,
        sourceGroupKey: session.sourceGroupKey,
        draggedIds: session.reorderDraggedIds,
        dropIndex: getFullDropIndexForWorktreeDragUnit({
          groups: context.unitGroups,
          sourceGroupKey: session.sourceGroupKey,
          dropIndex: drop.dropIndex
        })
      })
      context.clearReorderedParents({
        draggedIds: session.draggedIds,
        sourceGroupKey: session.sourceGroupKey
      })
      context.clearDrag()
    },
    [context]
  )
  return { handleCardDragStart, handleDragOver, handleDrop }
}
