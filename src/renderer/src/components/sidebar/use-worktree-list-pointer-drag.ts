import { useCallback, useMemo } from 'react'
import type React from 'react'
import type { WorkspaceStatus, WorkspaceStatusDefinition } from '../../../../shared/types'
import type { WorktreePointerDrag, WorktreeRowDragState } from './worktree-list-types'
import type { WorktreeDragGroup } from './worktree-manual-order'
import type { WorktreeSidebarDragSession } from './worktree-sidebar-drag-autoscroll'
import type {
  WorktreeSidebarStatusDropTarget,
  WorktreeSidebarDropPreview
} from './worktree-sidebar-drop-preview'
import { useEffect } from 'react'
import { registerWorktreeListPointerListeners } from './worktree-list-pointer-listeners'
import {
  createSidebarDragPreview,
  isSidebarPointerDragBlocked,
  setSidebarPointerDragDocumentStyles,
  updateSidebarDragPreviewPosition
} from './worktree-sidebar-pointer-drag-dom'
import {
  getWorktreeSidebarDragAutoscroll,
  getWorktreeSidebarDragRectsForGroup
} from './worktree-sidebar-drag-autoscroll'
import { getWorktreeSidebarDragGrab } from './worktree-sidebar-drag-geometry'
import {
  clearWorkspaceKanbanSidebarDropTargetVisual,
  getWorkspaceKanbanSidebarDropGroups,
  getWorkspaceKanbanSidebarDropTarget,
  hasWorkspaceKanbanSidebarDropBoard,
  isWorkspaceKanbanSidebarDropPointInBoard,
  resolveWorkspaceKanbanSidebarFullLaneDropIndex,
  updateWorkspaceKanbanSidebarDropTargetVisual
} from './workspace-kanban-sidebar-drop'
import { resolveWorkspaceKanbanCardDropCommitTarget } from './workspace-kanban-card-pointer-drag-dom'
import { getFullDropIndexForWorktreeDragUnit } from './worktree-drag-units'
import { resolveWorktreeSidebarStatusDropCommitTarget } from './worktree-sidebar-drop-preview'
import {
  getPointerDropStatusTarget,
  shouldPreferSidebarStatusDropTarget
} from './worktree-list-drop-target'

const DRAG_THRESHOLD = 4
const EMPTY_OFFSETS: ReadonlyMap<string, number> = new Map()

type StatusTarget = WorktreeSidebarStatusDropTarget & { lineageParentId: string | null }
type StatusPreview = WorktreeSidebarDropPreview | null

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
  computeWorktreeStatusDrop: (args: {
    pointerY: number
    status: WorkspaceStatus
    draggedIds: readonly string[]
  }) => WorktreeRowDragState | null
  getReorderDraggedIds: (ids: readonly string[]) => readonly string[]
  getReorderUnitDraggedIds: (groupKey: string, ids: readonly string[]) => readonly string[]
  getEligibleLineageDropTarget: (target: StatusTarget, ids: readonly string[]) => StatusTarget
  commitLineageParentDrop: (ids: readonly string[], parentId: string) => boolean
  clearReorderedParents: (args: { draggedIds: readonly string[]; sourceGroupKey: string }) => void
  markScrollMovement: () => void
  onWorkspaceBoardDragPreviewStart: () => void
  onWorkspaceBoardDragPreviewCommit: () => void
  onWorkspaceBoardDragPreviewCancel: () => void
  shouldShowWorkspaceBoardDropIndicator: (
    ids: readonly string[],
    status: WorkspaceStatus
  ) => boolean
  onDropWorktreesOnWorkspaceBoard: (args: {
    worktreeIds: readonly string[]
    status: WorkspaceStatus
    dropIndex: number
    groups: readonly WorktreeDragGroup[]
  }) => void
  onPinWorktrees: (ids: readonly string[]) => void
  onMoveWorktreesToStatus: (ids: readonly string[], status: WorkspaceStatus) => void
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

function updateLatestStatus(
  drag: WorktreePointerDrag,
  target: StatusTarget,
  preview: StatusPreview
): void {
  drag.latestStatusDropTarget =
    target.status || target.isPinDrop || target.lineageParentId
      ? { target, preview, x: drag.currentX, y: drag.currentY }
      : null
}

/** Pointer drag orchestration for sidebar rows. */
export function useWorktreeListPointerDragController(context: WorktreeListPointerDragContext) {
  const {
    scrollRef,
    worktreePointerDragRef,
    pointerAutoscrollFrameRef,
    pointerAutoscrollLastFrameRef,
    worktreeDragSessionRef,
    worktreeDragStateSetter,
    setDragOverStatus,
    setPinDragOver,
    clearWorktreeDrag,
    refreshWorktreeDragSession,
    computeWorktreeDrop,
    computeWorktreeStatusDrop,
    getEligibleLineageDropTarget,
    commitLineageParentDrop,
    clearReorderedParents,
    markScrollMovement,
    ...actions
  } = context

  const cancelAutoscroll = useCallback(() => {
    if (pointerAutoscrollFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerAutoscrollFrameRef.current)
      pointerAutoscrollFrameRef.current = null
    }
    pointerAutoscrollLastFrameRef.current = null
  }, [pointerAutoscrollFrameRef, pointerAutoscrollLastFrameRef])

  const flush = useCallback(() => {
    const drag = worktreePointerDragRef.current
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
    if (!refreshWorktreeDragSession()) {
      clearWorktreeDrag()
      return
    }
    if (
      !drag.workspaceBoardDragPreviewRequested &&
      !context.workspaceBoardOpen &&
      !hasWorkspaceKanbanSidebarDropBoard()
    ) {
      drag.workspaceBoardDragPreviewRequested = true
      actions.onWorkspaceBoardDragPreviewStart()
    }
    const boardTarget = updateWorkspaceKanbanSidebarDropTargetVisual({
      x: drag.currentX,
      y: drag.currentY,
      shouldShowDropIndicator: (target) =>
        Boolean(
          target.status &&
          actions.shouldShowWorkspaceBoardDropIndicator(drag.reorderDraggedIds, target.status)
        )
    })
    drag.latestBoardDropTarget = { target: boardTarget, x: drag.currentX, y: drag.currentY }
    if (isWorkspaceKanbanSidebarDropPointInBoard(drag.currentX, drag.currentY)) {
      actions.onWorkspaceBoardDragPreviewCommit()
    }
    if (boardTarget.status || boardTarget.isPinDrop) {
      drag.latestStatusDropTarget = null
      setDragOverStatus(null)
      setPinDragOver(false)
      worktreeDragStateSetter((prev) =>
        prev.dropIndex === null &&
        prev.dropIndicatorY === null &&
        prev.pointerY === drag.currentY &&
        prev.previewOffsetsByWorktreeId.size === 0
          ? prev
          : {
              ...prev,
              dropIndex: null,
              dropIndicatorY: null,
              previewOffsetsByWorktreeId: EMPTY_OFFSETS,
              pointerY: drag.currentY
            }
      )
      return
    }
    const target = getEligibleLineageDropTarget(
      scrollRef.current
        ? getPointerDropStatusTarget({
            container: scrollRef.current,
            x: drag.currentX,
            y: drag.currentY
          })
        : { status: null, isPinDrop: false, lineageParentId: null },
      drag.draggedIds
    )
    if (target.lineageParentId) {
      updateLatestStatus(drag, target, null)
      clearWorkspaceKanbanSidebarDropTargetVisual()
      setDragOverStatus(null)
      setPinDragOver(false)
      worktreeDragStateSetter((prev) => ({
        ...prev,
        dropIndex: null,
        dropIndicatorY: null,
        previewOffsetsByWorktreeId: EMPTY_OFFSETS,
        pointerY: drag.currentY
      }))
      return
    }
    const preferred = shouldPreferSidebarStatusDropTarget({
      sourceGroupKey: drag.sourceGroupKey,
      target,
      workspaceStatuses: context.workspaceStatuses
    })
    const statusDrop = target.status
      ? computeWorktreeStatusDrop({
          pointerY: drag.currentY,
          status: target.status,
          draggedIds: drag.reorderDraggedIds
        })
      : null
    if (preferred || !computeWorktreeDrop(drag.currentY)) {
      if (statusDrop) {
        updateLatestStatus(drag, target, statusDrop)
        clearWorkspaceKanbanSidebarDropTargetVisual()
        setDragOverStatus(null)
        setPinDragOver(false)
        worktreeDragStateSetter((prev) =>
          prev.dropIndex === statusDrop.dropIndex &&
          prev.dropIndicatorY === statusDrop.dropIndicatorY &&
          prev.pointerY === drag.currentY &&
          sameOffsets(prev.previewOffsetsByWorktreeId, statusDrop.previewOffsetsByWorktreeId)
            ? prev
            : { ...prev, ...statusDrop, pointerY: drag.currentY }
        )
        return
      }
      updateLatestStatus(drag, target, null)
      setDragOverStatus(target.status)
      setPinDragOver(target.isPinDrop)
      worktreeDragStateSetter((prev) => ({
        ...prev,
        dropIndex: null,
        dropIndicatorY: null,
        previewOffsetsByWorktreeId: EMPTY_OFFSETS,
        pointerY: drag.currentY
      }))
      return
    }
    const drop = computeWorktreeDrop(drag.currentY)
    if (drop) {
      drag.latestStatusDropTarget = null
      clearWorkspaceKanbanSidebarDropTargetVisual()
      setDragOverStatus(null)
      setPinDragOver(false)
      worktreeDragStateSetter((prev) =>
        prev.dropIndex === drop.dropIndex &&
        prev.dropIndicatorY === drop.dropIndicatorY &&
        prev.pointerY === drag.currentY &&
        sameOffsets(prev.previewOffsetsByWorktreeId, drop.previewOffsetsByWorktreeId)
          ? prev
          : { ...prev, ...drop, pointerY: drag.currentY }
      )
    }
  }, [
    actions,
    clearWorktreeDrag,
    computeWorktreeDrop,
    computeWorktreeStatusDrop,
    context.workspaceBoardOpen,
    context.workspaceStatuses,
    getEligibleLineageDropTarget,
    pointerAutoscrollFrameRef,
    refreshWorktreeDragSession,
    scrollRef,
    setDragOverStatus,
    setPinDragOver,
    worktreeDragStateSetter,
    worktreePointerDragRef
  ])

  const schedule = useCallback(
    (drag: WorktreePointerDrag) => {
      if (drag.frameId === null) {
        drag.frameId = window.requestAnimationFrame(flush)
      }
    },
    [flush]
  )

  const runAutoscroll = useCallback(
    (time: number) => {
      pointerAutoscrollFrameRef.current = null
      const drag = worktreePointerDragRef.current
      const container = scrollRef.current
      const session = worktreeDragSessionRef.current
      if (!drag?.active || !container || !session) {
        cancelAutoscroll()
        return
      }
      const previous = pointerAutoscrollLastFrameRef.current ?? time
      pointerAutoscrollLastFrameRef.current = time
      const autoscroll = getWorktreeSidebarDragAutoscroll({
        point: { clientX: drag.currentX, clientY: drag.currentY },
        containerRect: container.getBoundingClientRect(),
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        elapsedMs: time - previous
      })
      if (autoscroll) {
        markScrollMovement()
        container.scrollTop = autoscroll.scrollTop
        if (!refreshWorktreeDragSession()) {
          clearWorktreeDrag()
          return
        }
        schedule(drag)
      }
      pointerAutoscrollFrameRef.current = window.requestAnimationFrame(runAutoscroll)
    },
    [
      cancelAutoscroll,
      clearWorktreeDrag,
      markScrollMovement,
      pointerAutoscrollFrameRef,
      pointerAutoscrollLastFrameRef,
      refreshWorktreeDragSession,
      schedule,
      scrollRef,
      worktreeDragSessionRef,
      worktreePointerDragRef
    ]
  )

  const startAutoscroll = useCallback(() => {
    if (pointerAutoscrollFrameRef.current === null) {
      pointerAutoscrollLastFrameRef.current = null
      pointerAutoscrollFrameRef.current = window.requestAnimationFrame(runAutoscroll)
    }
  }, [pointerAutoscrollFrameRef, pointerAutoscrollLastFrameRef, runAutoscroll])
  const begin = useCallback(
    (drag: WorktreePointerDrag) => {
      const { preview, offsetX, offsetY, height } = createSidebarDragPreview({
        sourceRow: drag.sourceRow,
        pointerX: drag.currentX,
        pointerY: drag.currentY,
        draggedCount: drag.draggedIds.length
      })
      drag.active = true
      drag.preview = preview
      drag.previewOffsetX = offsetX
      drag.previewOffsetY = offsetY
      setSidebarPointerDragDocumentStyles(true)
      worktreeDragSessionRef.current = {
        draggingWorktreeId: drag.worktreeId,
        sourceGroupKey: drag.sourceGroupKey,
        draggedIds: drag.draggedIds,
        reorderDraggedIds: drag.reorderDraggedIds,
        reorderUnitDraggedIds: drag.reorderUnitDraggedIds,
        rects: drag.rects,
        grab: getWorktreeSidebarDragGrab({ offsetY, height }),
        anchor: null
      }
      worktreeDragStateSetter({
        draggingWorktreeId: drag.worktreeId,
        sourceGroupKey: drag.sourceGroupKey,
        dropIndex: null,
        dropIndicatorY: null,
        previewOffsetsByWorktreeId: EMPTY_OFFSETS,
        pointerY: drag.currentY
      })
      startAutoscroll()
      schedule(drag)
    },
    [schedule, startAutoscroll, worktreeDragSessionRef, worktreeDragStateSetter]
  )

  const onRowPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, worktreeId: string, rowKey: string) => {
      if (event.button !== 0 || event.pointerType === 'touch') {
        return
      }
      const sourceRow = event.currentTarget
      if (isSidebarPointerDragBlocked(event.target, sourceRow)) {
        return
      }
      const sourceGroupKey = context.groupKeyByRowKey.get(rowKey)
      const container = scrollRef.current
      if (!sourceGroupKey || !container) {
        return
      }
      const rects = getWorktreeSidebarDragRectsForGroup(container, sourceGroupKey)
      if (
        rects.length <= 1 &&
        !hasWorkspaceKanbanSidebarDropBoard() &&
        !context.canPreviewWorkspaceBoardOnDrag
      ) {
        return
      }
      const draggedIds =
        context.selectedWorktreeIds.has(worktreeId) && context.selectedWorktrees.length > 1
          ? context.selectedWorktrees.map((w) => w.id)
          : [worktreeId]
      const reorderDraggedIds = context.getReorderDraggedIds(draggedIds)
      worktreePointerDragRef.current = {
        pointerId: event.pointerId,
        sourceRow,
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY,
        worktreeId,
        draggedIds,
        reorderDraggedIds,
        reorderUnitDraggedIds: context.getReorderUnitDraggedIds(sourceGroupKey, reorderDraggedIds),
        sourceGroupKey,
        rects,
        active: false,
        preview: null,
        previewOffsetX: 0,
        previewOffsetY: 0,
        workspaceBoardDragPreviewRequested: false,
        frameId: null,
        latestBoardDropTarget: null,
        latestStatusDropTarget: null
      }
    },
    [actions.onWorkspaceBoardDragPreviewStart, context, scrollRef, worktreePointerDragRef]
  )

  const handlers = useMemo(
    () => ({
      onPointerMove: (event: PointerEvent) => {
        const drag = worktreePointerDragRef.current
        if (!drag || event.pointerId !== drag.pointerId) {
          return
        }
        drag.currentX = event.clientX
        drag.currentY = event.clientY
        if (!drag.active) {
          if (
            Math.hypot(drag.currentX - drag.startX, drag.currentY - drag.startY) < DRAG_THRESHOLD
          ) {
            return
          }
          begin(drag)
        }
        event.preventDefault()
        event.stopPropagation()
        schedule(drag)
      },
      onPointerUp: (event: PointerEvent) => {
        const drag = worktreePointerDragRef.current
        if (!drag || event.pointerId !== drag.pointerId) {
          return
        }
        drag.currentX = event.clientX
        drag.currentY = event.clientY
        if (!drag.active) {
          worktreePointerDragRef.current = null
          return
        }
        event.preventDefault()
        event.stopPropagation()
        if (!refreshWorktreeDragSession()) {
          clearWorktreeDrag()
          return
        }
        const boardTarget = resolveWorkspaceKanbanCardDropCommitTarget({
          currentTarget: getWorkspaceKanbanSidebarDropTarget(event.clientX, event.clientY),
          latestTrackedTarget: drag.latestBoardDropTarget,
          x: event.clientX,
          y: event.clientY
        })
        if (isWorkspaceKanbanSidebarDropPointInBoard(event.clientX, event.clientY)) {
          actions.onWorkspaceBoardDragPreviewCommit()
        }
        if (boardTarget.isPinDrop) {
          actions.onPinWorktrees(drag.draggedIds)
        } else if (boardTarget.status) {
          actions.onDropWorktreesOnWorkspaceBoard({
            worktreeIds: drag.reorderDraggedIds,
            status: boardTarget.status,
            dropIndex: resolveWorkspaceKanbanSidebarFullLaneDropIndex(
              boardTarget.status,
              boardTarget.dropIndex
            ),
            groups: getWorkspaceKanbanSidebarDropGroups()
          })
        } else {
          const target = getEligibleLineageDropTarget(
            scrollRef.current
              ? getPointerDropStatusTarget({
                  container: scrollRef.current,
                  x: event.clientX,
                  y: event.clientY
                })
              : { status: null, isPinDrop: false, lineageParentId: null },
            drag.draggedIds
          )
          if (target.lineageParentId) {
            commitLineageParentDrop(drag.draggedIds, target.lineageParentId)
            clearWorktreeDrag()
            return
          }
          const statusDrop = target.status
            ? computeWorktreeStatusDrop({
                pointerY: event.clientY,
                status: target.status,
                draggedIds: drag.reorderDraggedIds
              })
            : null
          if (
            shouldPreferSidebarStatusDropTarget({
              sourceGroupKey: drag.sourceGroupKey,
              target,
              workspaceStatuses: context.workspaceStatuses
            })
          ) {
            if (target.isPinDrop) {
              actions.onPinWorktrees(drag.draggedIds)
            } else if (target.status) {
              if (statusDrop) {
                actions.onMoveWorktreesToStatusAtIndex({
                  worktreeIds: drag.reorderDraggedIds,
                  status: target.status,
                  dropIndex: statusDrop.dropIndex,
                  groups: context.worktreeDragGroups
                })
              } else {
                actions.onMoveWorktreesToStatus(drag.reorderDraggedIds, target.status)
              }
            }
            clearWorktreeDrag()
            return
          }
          const drop = computeWorktreeDrop(event.clientY)
          if (drop) {
            actions.onReorderWorktrees({
              groups: context.worktreeDragGroups,
              sourceGroupKey: drag.sourceGroupKey,
              draggedIds: drag.reorderDraggedIds,
              dropIndex: getFullDropIndexForWorktreeDragUnit({
                groups: context.worktreeDragUnitGroups,
                sourceGroupKey: drag.sourceGroupKey,
                dropIndex: drop.dropIndex
              })
            })
            clearReorderedParents({
              draggedIds: drag.draggedIds,
              sourceGroupKey: drag.sourceGroupKey
            })
          } else {
            const latest = resolveWorktreeSidebarStatusDropCommitTarget({
              currentTarget: target,
              currentPreview: statusDrop,
              latestTrackedTarget: drag.latestStatusDropTarget,
              x: event.clientX,
              y: event.clientY
            })
            if (latest.target.lineageParentId) {
              commitLineageParentDrop(drag.draggedIds, latest.target.lineageParentId)
            } else if (latest.target.isPinDrop) {
              actions.onPinWorktrees(drag.draggedIds)
            } else if (latest.target.status) {
              if (latest.preview) {
                actions.onMoveWorktreesToStatusAtIndex({
                  worktreeIds: drag.reorderDraggedIds,
                  status: latest.target.status,
                  dropIndex: latest.preview.dropIndex,
                  groups: context.worktreeDragGroups
                })
              } else {
                actions.onMoveWorktreesToStatus(drag.reorderDraggedIds, latest.target.status)
              }
            }
          }
        }
        clearWorktreeDrag()
      },
      onPointerCancel: (event: PointerEvent) => {
        const drag = worktreePointerDragRef.current
        if (drag && event.pointerId === drag.pointerId) {
          clearWorktreeDrag()
        }
      }
    }),
    [
      actions,
      begin,
      clearReorderedParents,
      clearWorktreeDrag,
      commitLineageParentDrop,
      computeWorktreeDrop,
      computeWorktreeStatusDrop,
      context,
      getEligibleLineageDropTarget,
      refreshWorktreeDragSession,
      schedule,
      scrollRef,
      worktreePointerDragRef
    ]
  )
  useEffect(
    () =>
      registerWorktreeListPointerListeners(
        handlers.onPointerMove,
        handlers.onPointerUp,
        handlers.onPointerCancel
      ),
    [handlers]
  )
  return {
    onRowPointerDown,
    onRowClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
    }
  }
}
