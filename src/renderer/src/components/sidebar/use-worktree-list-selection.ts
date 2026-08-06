import { useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import type { Worktree } from '../../../../shared/types'
import { markSidebarWorktreeActiveImmediately } from './worktree-list-row-dom'
import type { WorktreeListSource } from './use-worktree-list-source'
import {
  areWorktreeSelectionsEqual,
  getWorktreeSelectionIntent,
  pruneWorktreeSelection,
  updateWorktreeSelection
} from './worktree-multi-selection'

type SelectionArgs = {
  renderedWorktrees: readonly Worktree[]
  renderedWorktreeIds: readonly string[]
  activeView: WorktreeListSource['activeView']
  currentSidebarWorktreeId: string | null
}

export function useWorktreeListSelection({
  renderedWorktrees,
  renderedWorktreeIds,
  activeView,
  currentSidebarWorktreeId
}: SelectionArgs) {
  const [selectedWorktreeIds, setSelectedWorktreeIds] = useState<Set<string>>(new Set())
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const prunedSelection = pruneWorktreeSelection(
    selectedWorktreeIds,
    selectionAnchorId,
    renderedWorktreeIds
  )
  const visibleSelectedWorktreeIds = areWorktreeSelectionsEqual(
    selectedWorktreeIds,
    prunedSelection.selectedIds
  )
    ? selectedWorktreeIds
    : prunedSelection.selectedIds
  const visibleSelectionAnchorId =
    selectionAnchorId === prunedSelection.anchorId ? selectionAnchorId : prunedSelection.anchorId
  useEffect(() => {
    if (!areWorktreeSelectionsEqual(selectedWorktreeIds, prunedSelection.selectedIds)) {
      setSelectedWorktreeIds(prunedSelection.selectedIds)
    }
    if (selectionAnchorId !== prunedSelection.anchorId) {
      setSelectionAnchorId(prunedSelection.anchorId)
    }
  }, [prunedSelection, selectedWorktreeIds, selectionAnchorId])
  const selectedWorktrees = useMemo(() => {
    if (visibleSelectedWorktreeIds.size === 0) {
      return []
    }
    const selected = new Map<string, Worktree>()
    for (const worktree of renderedWorktrees) {
      if (visibleSelectedWorktreeIds.has(worktree.id) && !selected.has(worktree.id)) {
        selected.set(worktree.id, worktree)
      }
    }
    return Array.from(selected.values())
  }, [renderedWorktrees, visibleSelectedWorktreeIds])
  useEffect(() => {
    if (visibleSelectedWorktreeIds.size === 0) {
      return
    }
    const clearSelectionOutsideSidebar = (event: PointerEvent): void => {
      const target = event.target
      const sidebarContainer = document.querySelector('[data-worktree-sidebar-container]')
      if (target instanceof Node && sidebarContainer?.contains(target)) {
        return
      }
      setSelectedWorktreeIds(new Set())
      setSelectionAnchorId(null)
    }
    document.addEventListener('pointerdown', clearSelectionOutsideSidebar, { capture: true })
    return () =>
      document.removeEventListener('pointerdown', clearSelectionOutsideSidebar, { capture: true })
  }, [visibleSelectedWorktreeIds.size])
  const updateSelectionForGesture = useCallback(
    (event: React.MouseEvent<HTMLElement>, worktreeId: string): boolean => {
      const intent = getWorktreeSelectionIntent(event, navigator.userAgent.includes('Mac'))
      const result = updateWorktreeSelection({
        visibleIds: renderedWorktreeIds,
        previousSelectedIds: visibleSelectedWorktreeIds,
        previousAnchorId: visibleSelectionAnchorId,
        targetId: worktreeId,
        intent
      })
      setSelectedWorktreeIds(result.selectedIds)
      setSelectionAnchorId(result.anchorId)
      return intent !== 'replace'
    },
    [renderedWorktreeIds, visibleSelectedWorktreeIds, visibleSelectionAnchorId]
  )
  const selectForContextMenu = useCallback(
    (_event: React.MouseEvent<HTMLElement>, worktree: Worktree): readonly Worktree[] => {
      if (visibleSelectedWorktreeIds.has(worktree.id) && visibleSelectedWorktreeIds.size > 1) {
        return selectedWorktrees
      }
      setSelectedWorktreeIds(new Set([worktree.id]))
      setSelectionAnchorId(worktree.id)
      return [worktree]
    },
    [visibleSelectedWorktreeIds, selectedWorktrees]
  )
  const handleImmediateWorktreeActivate = useCallback(
    (worktreeId: string, rowKey?: string): void => {
      // Why: pointer activation updates the DOM before the virtualized list reconciles.
      markSidebarWorktreeActiveImmediately(worktreeId, rowKey)
    },
    []
  )
  const selectedSidebarWorktreeId =
    activeView === 'tasks' || activeView === 'activity' ? null : currentSidebarWorktreeId
  return {
    selectedWorktreeIds: visibleSelectedWorktreeIds,
    selectedWorktrees,
    updateSelectionForGesture,
    selectForContextMenu,
    handleImmediateWorktreeActivate,
    selectedSidebarWorktreeId
  }
}
