import { useEffect } from 'react'
import type React from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import {
  getSidebarRowRevealAncestorKeys,
  revealMountedSidebarRowElement,
  rowKeyMatchesRenderRow
} from './worktree-list-row-dom'
import type { PendingSidebarRowReveal } from '@/store/slices/ui'
import type { ProjectGroup } from '../../../../shared/types'
import type { ProjectGroupingModel, Row, WorktreeGroupBy } from './worktree-list-groups'
import type { Repo } from '../../../../shared/types'

export type WorktreeListSidebarRevealArgs = {
  pendingRevealSidebarRow: PendingSidebarRowReveal | null
  clearPendingRevealSidebarRow: () => void
  repoMap: Map<string, Repo>
  projectGroups: readonly ProjectGroup[]
  projectGrouping?: ProjectGroupingModel
  collapsedGroups: Set<string>
  groupBy: WorktreeGroupBy
  toggleGroup: (key: string) => void
  renderRows: readonly Row[]
  virtualizer: {
    scrollToIndex: (index: number, options?: { align?: 'auto'; behavior?: 'auto' }) => void
  }
  pendingRevealRetryTick: number
  setPendingRevealRetryTick: (updater: (tick: number) => number) => void
  pendingRowRevealRetryRef: React.MutableRefObject<{ rowKey: string; count: number } | null>
  schedulePendingRevealFrame: (callback: FrameRequestCallback) => void
  cancelPendingRevealFrames: () => void
  flashRevealedRow: (rowKey: string) => void
  scrollRef: React.RefObject<HTMLDivElement | null>
}

export function useWorktreeListSidebarRevealEffect(args: WorktreeListSidebarRevealArgs) {
  const {
    pendingRevealSidebarRow,
    clearPendingRevealSidebarRow,
    repoMap,
    projectGroups,
    projectGrouping,
    collapsedGroups,
    groupBy,
    toggleGroup,
    renderRows,
    virtualizer,
    pendingRevealRetryTick,
    pendingRowRevealRetryRef,
    setPendingRevealRetryTick,
    schedulePendingRevealFrame,
    cancelPendingRevealFrames,
    flashRevealedRow,
    scrollRef
  } = args
  useEffect(() => {
    if (!pendingRevealSidebarRow) {
      return
    }
    const headerTarget = /^(project-group|project|repo):/.test(pendingRevealSidebarRow.rowKey)
    if (headerTarget && groupBy !== 'repo') {
      return
    }
    let cancelled = false
    let toggled = false
    for (const key of getSidebarRowRevealAncestorKeys({
      rowKey: pendingRevealSidebarRow.rowKey,
      repoMap,
      projectGroups,
      projectGrouping
    })) {
      if (collapsedGroups.has(key)) {
        toggleGroup(key)
        toggled = true
      }
    }
    if (toggled) {
      return
    }
    schedulePendingRevealFrame(() => {
      if (cancelled) {
        return
      }
      const targetIndex = renderRows.findIndex((row) =>
        rowKeyMatchesRenderRow(row, pendingRevealSidebarRow.rowKey)
      )
      const element = scrollRef.current
        ? revealMountedSidebarRowElement(
            scrollRef.current,
            pendingRevealSidebarRow.rowKey,
            pendingRevealSidebarRow.behavior
          )
        : null
      if (element) {
        if (pendingRevealSidebarRow.highlight) {
          flashRevealedRow(pendingRevealSidebarRow.rowKey)
        }
        pendingRowRevealRetryRef.current = null
        clearPendingRevealSidebarRow()
      } else if (targetIndex >= 0) {
        virtualizer.scrollToIndex(targetIndex, { align: 'auto', behavior: 'auto' })
        const previous = pendingRowRevealRetryRef.current
        const count = previous?.rowKey === pendingRevealSidebarRow.rowKey ? previous.count + 1 : 1
        pendingRowRevealRetryRef.current = { rowKey: pendingRevealSidebarRow.rowKey, count }
        if (count <= 8) {
          schedulePendingRevealFrame(() => {
            if (!cancelled) {
              setPendingRevealRetryTick((tick) => tick + 1)
            }
          })
        } else {
          pendingRowRevealRetryRef.current = null
          clearPendingRevealSidebarRow()
        }
      } else {
        pendingRowRevealRetryRef.current = null
        clearPendingRevealSidebarRow()
        toast.error(
          translate(
            'auto.components.sidebar.WorktreeList.sidebarRowMissing',
            'Target no longer exists'
          )
        )
      }
    })
    return () => {
      cancelled = true
      cancelPendingRevealFrames()
    }
  }, [
    cancelPendingRevealFrames,
    clearPendingRevealSidebarRow,
    collapsedGroups,
    flashRevealedRow,
    groupBy,
    pendingRowRevealRetryRef,
    pendingRevealRetryTick,
    pendingRevealSidebarRow,
    projectGrouping,
    projectGroups,
    repoMap,
    renderRows,
    schedulePendingRevealFrame,
    setPendingRevealRetryTick,
    scrollRef,
    toggleGroup,
    virtualizer
  ])
}
