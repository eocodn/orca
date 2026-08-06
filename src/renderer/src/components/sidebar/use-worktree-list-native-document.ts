import { useCallback, useEffect } from 'react'
import type React from 'react'
import type { WorkspaceStatus } from '../../../../shared/types'
import type { WorktreeRowDragState } from './worktree-list-types'
import type { WorktreeSidebarDragSession } from './worktree-sidebar-drag-autoscroll'
import type { WorktreeDragGroup } from './worktree-manual-order'
import { getFullDropIndexForWorktreeDragUnit } from './worktree-drag-units'
import { getPointerDropStatusTarget } from './worktree-list-drop-target'

export type WorktreeListNativeDocumentContext = {
  scrollRef: React.MutableRefObject<HTMLDivElement | null>
  dragSessionRef: React.MutableRefObject<WorktreeSidebarDragSession | null>
  groups: readonly WorktreeDragGroup[]
  unitGroups: readonly WorktreeDragGroup[]
  refreshDragSession: () => boolean
  computeDrop: (pointerY: number) => WorktreeRowDragState | null
  computeStatusDrop: (args: { pointerY: number; status: WorkspaceStatus; draggedIds: readonly string[] }) => WorktreeRowDragState | null
  getEligibleLineageDropTarget: <T extends { status: WorkspaceStatus | null; isPinDrop: boolean; lineageParentId: string | null }>(target: T, ids: readonly string[]) => T
  commitLineageParentDrop: (ids: readonly string[], parentId: string) => boolean
  moveWorktreesToStatusAtIndex: (args: { worktreeIds: readonly string[]; status: WorkspaceStatus; dropIndex: number; groups: readonly WorktreeDragGroup[] }) => void
  reorderWorktrees: (args: { groups: readonly WorktreeDragGroup[]; sourceGroupKey: string; draggedIds: readonly string[]; dropIndex: number }) => void
  clearReorderedParents: (args: { draggedIds: readonly string[]; sourceGroupKey: string }) => void
  clearDrag: () => void
}

/** Capture browser-level drag termination before external status bridges run. */
export function useWorktreeListNativeDocument(context: WorktreeListNativeDocumentContext): void {
  const onDocumentDrop = useCallback((event: DragEvent): void => {
    const session = context.dragSessionRef.current
    if (!session) {
      return
    }
    if (!context.refreshDragSession()) {
      context.clearDrag()
      return
    }
    const drop = context.computeDrop(event.clientY)
    if (!drop) {
      const target = context.getEligibleLineageDropTarget(
        context.scrollRef.current
          ? getPointerDropStatusTarget({ container: context.scrollRef.current, x: event.clientX, y: event.clientY })
          : { status: null, isPinDrop: false, lineageParentId: null },
        session.draggedIds
      )
      if (target.lineageParentId) {
        event.preventDefault()
        event.stopPropagation()
        context.commitLineageParentDrop(session.draggedIds, target.lineageParentId)
        context.clearDrag()
        return
      }
      const statusDrop = target.status ? context.computeStatusDrop({ pointerY: event.clientY, status: target.status, draggedIds: session.reorderDraggedIds }) : null
      if (target.status && statusDrop) {
        event.preventDefault()
        event.stopPropagation()
        context.moveWorktreesToStatusAtIndex({ worktreeIds: session.reorderDraggedIds, status: target.status, dropIndex: statusDrop.dropIndex, groups: context.groups })
      }
      context.clearDrag()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    context.reorderWorktrees({ groups: context.groups, sourceGroupKey: session.sourceGroupKey, draggedIds: session.reorderDraggedIds, dropIndex: getFullDropIndexForWorktreeDragUnit({ groups: context.unitGroups, sourceGroupKey: session.sourceGroupKey, dropIndex: drop.dropIndex }) })
    context.clearReorderedParents({ draggedIds: session.draggedIds, sourceGroupKey: session.sourceGroupKey })
    context.clearDrag()
  }, [context])
  const onDocumentDragEnd = useCallback(() => {
    if (context.dragSessionRef.current) {
      context.clearDrag()
    }
  }, [context])
  const onVisibilityChange = useCallback(() => {
    if (document.visibilityState !== 'visible' && context.dragSessionRef.current) {
      context.clearDrag()
    }
  }, [context])
  useEffect(() => {
    document.addEventListener('drop', onDocumentDrop, true)
    document.addEventListener('dragend', onDocumentDragEnd, true)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('drop', onDocumentDrop, true)
      document.removeEventListener('dragend', onDocumentDragEnd, true)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [onDocumentDragEnd, onDocumentDrop, onVisibilityChange])
}