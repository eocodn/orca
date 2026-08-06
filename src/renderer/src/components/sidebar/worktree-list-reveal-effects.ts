import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import {
  getFolderWorkspaceRevealGroupKeys,
  sidebarWorkspaceStillExists
} from './worktree-list-folder-reveal'
import { getWorktreeLineageAncestors } from './worktree-lineage-projection'
import { getLineageGroupKey, getGroupKeysForWorktree } from './worktree-list-groups'
import { getWorktreeExecutionHostId } from '../../../../shared/execution-host'
import {
  getPinnedWorktreeRevealCollapsedGroupKeys,
  findPreferredRenderRowIndexForWorktree,
  getRenderRowOptionId
} from './worktree-list-row-model'
import { getRenderRowSidebarKey, revealMountedWorktreeElement } from './worktree-list-row-dom'
import type { PendingSidebarRowReveal, PendingSidebarWorktreeReveal } from '@/store/slices/ui'
import type React from 'react'
import type { AppState } from '@/store/types'
import type {
  FolderWorkspace,
  ProjectGroup,
  Repo,
  Worktree,
  WorktreeLineage,
  WorkspaceStatusDefinition
} from '../../../../shared/types'
import type {
  ProjectGroupingModel,
  PinnedWorktreeDisplayPolicy,
  WorktreeGroupBy,
  Row
} from './worktree-list-groups'
import { useWorktreeListRevealHighlight } from './worktree-list-reveal-highlight'
import { useWorktreeListSidebarRevealEffect } from './worktree-list-sidebar-reveal-effect'

type RenderRow = Row

export type WorktreeListRevealEffectsArgs = {
  pendingRevealWorktree: PendingSidebarWorktreeReveal | null
  pendingRevealSidebarRow: PendingSidebarRowReveal | null
  clearPendingRevealWorktreeId: () => void
  clearPendingRevealSidebarRow: () => void
  agentSendTargetWorktreeId: string | null
  groupBy: WorktreeGroupBy
  worktrees: readonly Worktree[]
  folderWorkspaces: readonly FolderWorkspace[]
  repoMap: Map<string, Repo>
  defaultHostId: string
  worktreeMap: Map<string, Worktree>
  worktreeLineageById: Record<string, WorktreeLineage>
  projectGroups: readonly ProjectGroup[]
  projectGrouping?: ProjectGroupingModel
  pinnedDisplayPolicy: PinnedWorktreeDisplayPolicy
  collapsedGroups: Set<string>
  toggleGroup: (key: string) => void
  prCache: AppState['prCache']
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
  settings: AppState['settings']
  renderRows: readonly RenderRow[]
  virtualizer: {
    scrollToIndex: (
      index: number,
      options?: { align?: 'auto' | 'start' | 'center' | 'end'; behavior?: 'auto' | 'smooth' }
    ) => void
  }
  scrollRef: React.RefObject<HTMLDivElement | null>
}

export function useWorktreeListRevealEffects(args: WorktreeListRevealEffectsArgs) {
  const {
    pendingRevealWorktree,
    pendingRevealSidebarRow,
    clearPendingRevealWorktreeId,
    clearPendingRevealSidebarRow,
    agentSendTargetWorktreeId,
    groupBy,
    worktrees,
    folderWorkspaces,
    repoMap,
    defaultHostId,
    worktreeMap,
    worktreeLineageById,
    projectGroups,
    projectGrouping,
    pinnedDisplayPolicy,
    collapsedGroups,
    toggleGroup,
    prCache,
    workspaceStatuses,
    settings,
    renderRows,
    virtualizer
  } = args
  const setRenamingWorktreeId = useAppStore((state) => state.setRenamingWorktreeId)
  const [pendingRevealRetryTick, setPendingRevealRetryTick] = useState(0)
  const {
    highlightedRevealRowKey,
    flashRevealedRow,
    clearRevealHighlightFrame,
    clearRevealHighlightTimeout
  } = useWorktreeListRevealHighlight()
  const pendingRevealRetryRef = useRef<{ worktreeId: string; count: number } | null>(null)
  const pendingRowRevealRetryRef = useRef<{ rowKey: string; count: number } | null>(null)
  const pendingRevealFrameIdsRef = useRef<Set<number>>(new Set())
  const cancelPendingRevealFrames = useCallback(() => {
    for (const frameId of pendingRevealFrameIdsRef.current) {
      window.cancelAnimationFrame(frameId)
    }
    pendingRevealFrameIdsRef.current.clear()
  }, [])
  const schedulePendingRevealFrame = useCallback((callback: FrameRequestCallback) => {
    const frameId = window.requestAnimationFrame((time) => {
      pendingRevealFrameIdsRef.current.delete(frameId)
      callback(time)
    })
    pendingRevealFrameIdsRef.current.add(frameId)
  }, [])

  useEffect(() => {
    if (!pendingRevealWorktree) {
      return
    }
    if (agentSendTargetWorktreeId !== pendingRevealWorktree.worktreeId) {
      const folderKeys = getFolderWorkspaceRevealGroupKeys(
        pendingRevealWorktree.worktreeId,
        folderWorkspaces,
        projectGroups
      )
      if (folderKeys.length > 0) {
        for (const key of folderKeys) {
          if (collapsedGroups.has(key)) {
            toggleGroup(key)
          }
        }
      } else {
        const target = worktrees.find(
          (worktree) => worktree.id === pendingRevealWorktree.worktreeId
        )
        const repo = target ? repoMap.get(target.repoId) : undefined
        if (target) {
          const hostKey = `host:${getWorktreeExecutionHostId(target, repo, defaultHostId)}`
          if (collapsedGroups.has(hostKey)) {
            toggleGroup(hostKey)
          }
          for (const parent of getWorktreeLineageAncestors(
            target,
            worktreeLineageById,
            worktreeMap
          )) {
            const key = getLineageGroupKey(parent.id)
            if (collapsedGroups.has(key)) {
              toggleGroup(key)
            }
          }
          const groupKeys =
            target.isPinned && pinnedDisplayPolicy === 'single-location'
              ? getPinnedWorktreeRevealCollapsedGroupKeys({ worktree: target, collapsedGroups })
              : getGroupKeysForWorktree(
                  groupBy,
                  target,
                  repoMap,
                  prCache,
                  workspaceStatuses,
                  settings,
                  projectGroups,
                  projectGrouping
                )
          for (const key of groupKeys) {
            if (collapsedGroups.has(key)) {
              toggleGroup(key)
            }
          }
        }
      }
    }
    let cancelled = false
    schedulePendingRevealFrame(() => {
      if (cancelled) {
        return
      }
      const targetExists = sidebarWorkspaceStillExists(
        pendingRevealWorktree.worktreeId,
        worktrees,
        folderWorkspaces
      )
      const targetIndex = findPreferredRenderRowIndexForWorktree(
        renderRows,
        pendingRevealWorktree.worktreeId,
        pinnedDisplayPolicy
      )
      if (targetIndex < 0 || !targetExists) {
        pendingRevealRetryRef.current = null
        clearPendingRevealWorktreeId()
        return
      }
      const targetRow = renderRows[targetIndex]
      const container = scrollRef.current
      const option =
        container && targetRow
          ? revealMountedWorktreeElement(
              container,
              pendingRevealWorktree.worktreeId,
              pendingRevealWorktree.behavior,
              getRenderRowOptionId(targetRow, pendingRevealWorktree.worktreeId)
            )
          : null
      if (option) {
        if (pendingRevealWorktree.highlight) {
          flashRevealedRow(option.dataset.worktreeRowKey ?? getRenderRowSidebarKey(targetRow))
        }
        if (pendingRevealWorktree.beginRename) {
          setRenamingWorktreeId({
            worktreeId: pendingRevealWorktree.worktreeId,
            rowKey: option.dataset.worktreeRowKey
          })
        }
        pendingRevealRetryRef.current = null
        clearPendingRevealWorktreeId()
        return
      }
      virtualizer.scrollToIndex(targetIndex, { align: 'auto', behavior: 'auto' })
      const previous = pendingRevealRetryRef.current
      const count =
        previous?.worktreeId === pendingRevealWorktree.worktreeId ? previous.count + 1 : 1
      pendingRevealRetryRef.current = { worktreeId: pendingRevealWorktree.worktreeId, count }
      if (count > 8) {
        pendingRevealRetryRef.current = null
        clearPendingRevealWorktreeId()
      } else {
        schedulePendingRevealFrame(() => {
          if (!cancelled) {
            setPendingRevealRetryTick((tick) => tick + 1)
          }
        })
      }
    })
    return () => {
      cancelled = true
      cancelPendingRevealFrames()
    }
  }, [
    agentSendTargetWorktreeId,
    cancelPendingRevealFrames,
    clearPendingRevealWorktreeId,
    collapsedGroups,
    defaultHostId,
    flashRevealedRow,
    folderWorkspaces,
    groupBy,
    pinnedDisplayPolicy,
    prCache,
    projectGrouping,
    projectGroups,
    repoMap,
    renderRows,
    schedulePendingRevealFrame,
    setRenamingWorktreeId,
    settings,
    toggleGroup,
    virtualizer,
    worktreeLineageById,
    worktreeMap,
    worktrees,
    workspaceStatuses,
    pendingRevealRetryTick,
    pendingRevealWorktree
  ])

  useWorktreeListSidebarRevealEffect({
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
    setPendingRevealRetryTick,
    pendingRowRevealRetryRef,
    schedulePendingRevealFrame,
    cancelPendingRevealFrames,
    flashRevealedRow,
    scrollRef
  })

  return {
    highlightedRevealRowKey,
    cancelPendingRevealFrames,
    clearRevealHighlightFrame,
    clearRevealHighlightTimeout
  }
}
