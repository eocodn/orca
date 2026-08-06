import { useCallback } from 'react'
import type React from 'react'
import type { WorktreeCardProps } from './worktree-card-model'
import type { WorktreeCardRuntime } from './worktree-card-runtime-types'
import { isEventTargetInsideCurrentTarget } from './worktree-card-dom-events'
import { writeWorkspaceDragData } from './workspace-status'

export function useWorktreeCardPointerActions(
  props: Pick<
    WorktreeCardProps,
    | 'worktree'
    | 'isMultiSelected'
    | 'selectedWorktrees'
    | 'onCardDragStart'
    | 'onCardDragEnd'
    | 'onContextMenuSelect'
  >,
  runtime: WorktreeCardRuntime
) {
  const {
    worktree,
    isMultiSelected = false,
    selectedWorktrees,
    onCardDragStart,
    onCardDragEnd,
    onContextMenuSelect
  } = props
  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (
        !isEventTargetInsideCurrentTarget(event.currentTarget, event.target) ||
        runtime.isDeleting
      ) {
        event.preventDefault()
        return
      }
      const dragIds =
        isMultiSelected && selectedWorktrees && selectedWorktrees.length > 1
          ? selectedWorktrees.map((item) => item.id)
          : worktree.id
      writeWorkspaceDragData(event.dataTransfer, dragIds)
      onCardDragStart?.(event, worktree.id, Array.isArray(dragIds) ? dragIds : [dragIds])
    },
    [isMultiSelected, onCardDragStart, runtime.isDeleting, selectedWorktrees, worktree.id]
  )
  const handleDragEnd = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (isEventTargetInsideCurrentTarget(event.currentTarget, event.target)) {
        onCardDragEnd?.(event)
      }
    },
    [onCardDragEnd]
  )
  const handleContextMenuSelect = useCallback(
    (event: React.MouseEvent<HTMLElement>) => onContextMenuSelect?.(event, worktree) ?? [worktree],
    [onContextMenuSelect, worktree]
  )
  const stopQuickActionPointerPropagation = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation()
    },
    []
  )
  return {
    handleDragStart,
    handleDragEnd,
    handleContextMenuSelect,
    stopQuickActionPointerPropagation
  }
}
