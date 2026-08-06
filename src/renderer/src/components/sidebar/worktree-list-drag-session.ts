import { useCallback, useMemo, useRef } from 'react'
import type React from 'react'
import type { HostSectionRow } from './host-section-rows'
import type {
  WorktreeSidebarDragRect,
  WorktreeSidebarDragSession
} from './worktree-sidebar-drag-autoscroll'
import {
  getWorktreeSidebarDragRectsForGroup,
  refreshWorktreeSidebarDragSession
} from './worktree-sidebar-drag-autoscroll'
import {
  computeWorktreeSidebarDropPreview,
  type WorktreeSidebarDropAnchor,
  type WorktreeSidebarDropPreview
} from './worktree-sidebar-drop-preview'
import { getWorktreeDragGroups, getWorktreeDragIndexes } from './worktree-list-row-model'
import { PINNED_GROUP_KEY } from './worktree-list-groups'
import { getWorktreeDragUnitGroups } from './worktree-drag-units'
import { expandDraggedWorktreeIdsForVisibleLineage } from './worktree-manual-order'
import { getWorkspaceStatusGroupKey } from './workspace-status'
import type { WorktreeItemRow } from './worktree-list-types'
import {
  shouldReevaluateWorktreeSidebarDropAnchor,
  type WorktreeSidebarDragGrab
} from './worktree-sidebar-drag-geometry'
import type { WorkspaceStatus } from '../../../../shared/types'

export type WorktreeListDragSessionArgs = {
  rows: readonly HostSectionRow[]
  scrollRef: React.RefObject<HTMLDivElement | null>
}

export function useWorktreeListDragSession({ rows, scrollRef }: WorktreeListDragSessionArgs) {
  const worktreeDragSessionRef = useRef<WorktreeSidebarDragSession | null>(null)
  const statusDropAnchorsRef = useRef<Map<string, WorktreeSidebarDropAnchor>>(new Map())
  const worktreeDragGroups = useMemo(() => getWorktreeDragGroups(rows), [rows])
  const worktreeDragUnitGroups = useMemo(() => getWorktreeDragUnitGroups(rows), [rows])
  const naturalDragWorktreeIds = useMemo(
    () =>
      new Set(
        rows.flatMap((row) =>
          row.type === 'item' && row.sectionKey !== PINNED_GROUP_KEY ? [row.worktree.id] : []
        )
      ),
    [rows]
  )
  const worktreeLineageDragRows = useMemo(
    () =>
      rows
        .filter((row): row is WorktreeItemRow => row.type === 'item')
        .filter(
          (row) =>
            row.sectionKey !== PINNED_GROUP_KEY || !naturalDragWorktreeIds.has(row.worktree.id)
        )
        .map((row) => ({ worktreeId: row.worktree.id, depth: row.depth })),
    [naturalDragWorktreeIds, rows]
  )
  const getReorderDraggedIds = useCallback(
    (draggedIds: readonly string[]) =>
      expandDraggedWorktreeIdsForVisibleLineage(worktreeLineageDragRows, draggedIds),
    [worktreeLineageDragRows]
  )
  const getReorderUnitDraggedIds = useCallback(
    (sourceGroupKey: string, reorderDraggedIds: readonly string[]) => {
      const group = worktreeDragUnitGroups.find((candidate) => candidate.key === sourceGroupKey)
      if (!group) {
        return reorderDraggedIds
      }
      const unitIds = new Set(group.worktreeIds)
      const filtered = reorderDraggedIds.filter((id) => unitIds.has(id))
      return filtered.length > 0 ? filtered : reorderDraggedIds
    },
    [worktreeDragUnitGroups]
  )
  const { groupKeyByRowKey, groupIndexByRowKey } = useMemo(
    () => getWorktreeDragIndexes(rows),
    [rows]
  )
  const refreshDragSession = useCallback(() => {
    const session = worktreeDragSessionRef.current
    const container = scrollRef.current
    if (!session || !container) {
      return false
    }
    const refreshed = refreshWorktreeSidebarDragSession({
      session,
      groups: worktreeDragGroups,
      unitGroups: worktreeDragUnitGroups,
      rects: getWorktreeSidebarDragRectsForGroup(container, session.sourceGroupKey)
    })
    worktreeDragSessionRef.current = refreshed
    return refreshed !== null
  }, [scrollRef, worktreeDragGroups, worktreeDragUnitGroups])
  const computeDropForGroup = useCallback(
    (args: {
      pointerY: number
      groupKey: string
      rects: readonly WorktreeSidebarDragRect[]
      draggedIds: readonly string[]
      draggingWorktreeId?: string | null
      grab?: WorktreeSidebarDragGrab | null
      anchor?: WorktreeSidebarDropAnchor | null
    }): WorktreeSidebarDropPreview | null => {
      const container = scrollRef.current
      const group = worktreeDragUnitGroups.find((candidate) => candidate.key === args.groupKey)
      if (!container || !group) {
        return null
      }
      const rect = container.getBoundingClientRect()
      return computeWorktreeSidebarDropPreview({
        pointerY: args.pointerY,
        containerTop: rect.top,
        scrollTop: container.scrollTop,
        rects: args.rects,
        groupIds: group.worktreeIds,
        draggedIds: args.draggedIds,
        draggingWorktreeId: args.draggingWorktreeId,
        grab: args.grab,
        anchor: args.anchor
      })
    },
    [scrollRef, worktreeDragUnitGroups]
  )
  const computeDrop = useCallback(
    (pointerY: number) => {
      const session = worktreeDragSessionRef.current
      const container = scrollRef.current
      if (!session || !container) {
        return null
      }
      const scrollTop = container.scrollTop
      const anchor = shouldReevaluateWorktreeSidebarDropAnchor({
        anchor: session.anchor,
        pointerY,
        scrollTop
      })
        ? null
        : session.anchor
      const preview = computeDropForGroup({
        pointerY,
        groupKey: session.sourceGroupKey,
        rects: session.rects,
        draggedIds: session.reorderUnitDraggedIds,
        draggingWorktreeId: session.draggingWorktreeId,
        grab: session.grab,
        anchor
      })
      worktreeDragSessionRef.current = {
        ...session,
        anchor: preview ? { beforeWorktreeId: preview.dropAnchorId, pointerY, scrollTop } : null
      }
      return preview
    },
    [computeDropForGroup, scrollRef]
  )
  const computeStatusDrop = useCallback(
    (args: { pointerY: number; status: WorkspaceStatus; draggedIds: readonly string[] }) => {
      const container = scrollRef.current
      if (!container) {
        return null
      }
      const groupKey = getWorkspaceStatusGroupKey(args.status)
      const session = worktreeDragSessionRef.current
      const scrollTop = container.scrollTop
      const heldAnchor = statusDropAnchorsRef.current.get(groupKey) ?? null
      const anchor = shouldReevaluateWorktreeSidebarDropAnchor({
        anchor: heldAnchor,
        pointerY: args.pointerY,
        scrollTop
      })
        ? null
        : heldAnchor
      const preview = computeDropForGroup({
        pointerY: args.pointerY,
        groupKey,
        rects: getWorktreeSidebarDragRectsForGroup(container, groupKey),
        draggedIds: args.draggedIds,
        draggingWorktreeId: session?.draggingWorktreeId ?? null,
        grab: session?.grab ?? null,
        anchor
      })
      if (preview) {
        statusDropAnchorsRef.current.set(groupKey, {
          beforeWorktreeId: preview.dropAnchorId,
          pointerY: args.pointerY,
          scrollTop
        })
      } else {
        statusDropAnchorsRef.current.delete(groupKey)
      }
      return preview
    },
    [computeDropForGroup, scrollRef]
  )
  return {
    worktreeDragSessionRef,
    statusDropAnchorsRef,
    worktreeDragGroups,
    worktreeDragUnitGroups,
    groupKeyByRowKey,
    groupIndexByRowKey,
    getReorderDraggedIds,
    getReorderUnitDraggedIds,
    refreshDragSession,
    computeDropForGroup,
    computeDrop,
    computeStatusDrop
  }
}
