import { useCallback } from 'react'
import { useAppStore } from '@/store'
import type {
  Worktree,
  WorktreeMeta,
  WorkspaceStatus,
  WorkspaceStatusDefinition
} from '../../../../shared/types'
import { getWorkspaceStatus, getWorkspaceStatusGroupKey } from './workspace-status'
import {
  buildManualOrderUpdatesForGroupDrop,
  buildManualOrderUpdatesForVisibleGroups,
  type WorktreeDragGroup
} from './worktree-manual-order'
import { buildWorkspaceKanbanSidebarDropUpdates } from './workspace-kanban-sidebar-drop'
import { shouldWriteManualOrderForGroupDrop } from './worktree-manual-order'

type Args = {
  worktreeMap: ReadonlyMap<string, Worktree>
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
  sortBy: string
  setSortBy: (sortBy: 'name' | 'smart' | 'recent' | 'repo' | 'manual') => void
  updateWorktreeMeta: (id: string, update: Partial<WorktreeMeta>) => Promise<unknown>
  updateWorktreesMeta: (updates: Map<string, Partial<WorktreeMeta>>) => Promise<unknown>
  setWorktreesPinnedAndReveal: (ids: readonly string[], pinned: boolean) => void
}

export function useWorktreeListStatusActions({
  worktreeMap,
  workspaceStatuses,
  sortBy,
  setSortBy,
  updateWorktreeMeta,
  updateWorktreesMeta,
  setWorktreesPinnedAndReveal
}: Args) {
  const moveWorktreeToStatus = useCallback(
    (worktreeId: string, status: WorkspaceStatus) => {
      const current = worktreeMap.get(worktreeId)
      if (current && getWorkspaceStatus(current, workspaceStatuses) !== status) {
        void updateWorktreeMeta(worktreeId, { workspaceStatus: status })
      }
    },
    [updateWorktreeMeta, worktreeMap, workspaceStatuses]
  )
  const moveWorktreesToStatus = useCallback(
    (worktreeIds: readonly string[], status: WorkspaceStatus) => {
      const updates = new Map<string, { workspaceStatus: WorkspaceStatus }>()
      for (const id of worktreeIds) {
        const current = worktreeMap.get(id)
        if (current && getWorkspaceStatus(current, workspaceStatuses) !== status) {
          updates.set(id, { workspaceStatus: status })
        }
      }
      if (updates.size) {
        void updateWorktreesMeta(updates)
      }
    },
    [updateWorktreesMeta, worktreeMap, workspaceStatuses]
  )
  const moveWorktreesToStatusAtIndex = useCallback(
    (args: {
      worktreeIds: readonly string[]
      status: WorkspaceStatus
      dropIndex: number
      groups: readonly WorktreeDragGroup[]
    }) => {
      const rankByWorktreeId = new Map<string, number>()
      for (const group of args.groups) {
        for (const id of group.worktreeIds) {
          const worktree = worktreeMap.get(id)
          if (worktree) {
            rankByWorktreeId.set(id, worktree.manualOrder ?? worktree.sortOrder)
          }
        }
      }
      const order = buildManualOrderUpdatesForGroupDrop({
        groups: args.groups,
        targetGroupKey: getWorkspaceStatusGroupKey(args.status),
        draggedIds: args.worktreeIds,
        dropIndex: args.dropIndex,
        now: Date.now(),
        rankByWorktreeId
      })
      const updates = new Map<string, Partial<WorktreeMeta>>()
      for (const id of args.worktreeIds) {
        const current = worktreeMap.get(id)
        if (!current) {
          continue
        }
        const next: Partial<WorktreeMeta> = {}
        if (getWorkspaceStatus(current, workspaceStatuses) !== args.status) {
          next.workspaceStatus = args.status
        }
        if (Object.keys(next).length) {
          updates.set(id, next)
        }
      }
      for (const [id, update] of order.updates) {
        updates.set(id, { ...updates.get(id), ...update })
      }
      if (updates.size) {
        if (order.changed) {
          setSortBy('manual')
        }
        void updateWorktreesMeta(updates)
      }
    },
    [setSortBy, updateWorktreesMeta, worktreeMap, workspaceStatuses]
  )
  const pinWorktree = useCallback(
    (id: string) => setWorktreesPinnedAndReveal([id], true),
    [setWorktreesPinnedAndReveal]
  )
  const pinWorktrees = useCallback(
    (ids: readonly string[]) => setWorktreesPinnedAndReveal(ids, true),
    [setWorktreesPinnedAndReveal]
  )
  const reorderWorktrees = useCallback(
    (args: {
      groups: readonly WorktreeDragGroup[]
      sourceGroupKey: string
      draggedIds: readonly string[]
      dropIndex: number
    }) => {
      const rankByWorktreeId = new Map<string, number>()
      for (const group of args.groups) {
        for (const id of group.worktreeIds) {
          const worktree = worktreeMap.get(id)
          if (worktree) {
            rankByWorktreeId.set(id, worktree.manualOrder ?? worktree.sortOrder)
          }
        }
      }
      const result = buildManualOrderUpdatesForVisibleGroups({
        ...args,
        now: Date.now(),
        rankByWorktreeId
      })
      if (result.changed) {
        setSortBy('manual')
        void updateWorktreesMeta(result.updates)
      }
    },
    [setSortBy, updateWorktreesMeta, worktreeMap]
  )
  const shouldShowWorkspaceBoardDropIndicator = useCallback(
    (ids: readonly string[], status: WorkspaceStatus) => {
      const sourceGroupKeys = ids.flatMap((id) => {
        const worktree = worktreeMap.get(id)
        return worktree ? [getWorkspaceStatus(worktree, workspaceStatuses)] : []
      })
      return shouldWriteManualOrderForGroupDrop({ sortBy, sourceGroupKeys, targetGroupKey: status })
    },
    [sortBy, worktreeMap, workspaceStatuses]
  )
  const dropWorktreesOnWorkspaceBoard = useCallback(
    (args: {
      worktreeIds: readonly string[]
      status: WorkspaceStatus
      dropIndex: number
      groups: readonly WorktreeDragGroup[]
    }) => {
      const result = buildWorkspaceKanbanSidebarDropUpdates({
        ...args,
        worktreeById: worktreeMap,
        workspaceStatuses,
        sortBy,
        now: Date.now()
      })
      if (!result.updates.size) {
        return
      }
      if (result.shouldSwitchToManual) {
        setSortBy('manual')
      }
      useAppStore.getState().recordFeatureInteraction('workspace-board-actions')
      void updateWorktreesMeta(result.updates)
    },
    [setSortBy, sortBy, updateWorktreesMeta, worktreeMap, workspaceStatuses]
  )
  return {
    moveWorktreeToStatus,
    moveWorktreesToStatus,
    moveWorktreesToStatusAtIndex,
    pinWorktree,
    pinWorktrees,
    reorderWorktrees,
    shouldShowWorkspaceBoardDropIndicator,
    dropWorktreesOnWorkspaceBoard
  }
}
