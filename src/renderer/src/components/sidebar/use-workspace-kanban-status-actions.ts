import { useCallback } from 'react'
import { useAppStore } from '@/store'
import type { Worktree, WorkspaceStatus } from '../../../../shared/types'
import { makeWorkspaceStatusId } from '../../../../shared/workspace-statuses'

export function useWorkspaceKanbanStatusActions({
  allWorktrees,
  workspaceStatuses,
  setWorkspaceStatuses,
  updateWorktreeMeta
}: {
  allWorktrees: readonly Worktree[]
  workspaceStatuses: readonly WorkspaceStatus[]
  setWorkspaceStatuses: (statuses: WorkspaceStatus[]) => void
  updateWorktreeMeta: (worktreeId: string, update: { workspaceStatus: string }) => Promise<unknown>
}): {
  handleRenameStatus: (statusId: string, label: string) => void
  handleChangeStatusColor: (statusId: string, color: string) => void
  handleChangeStatusIcon: (statusId: string, icon: string) => void
  handleMoveStatus: (statusId: string, direction: -1 | 1) => void
  handleAddStatus: () => void
  handleRemoveStatus: (statusId: string) => void
} {
  const updateStatus = useCallback((statusId: string, update: Partial<WorkspaceStatus>) => {
    setWorkspaceStatuses(workspaceStatuses.map((status) => status.id === statusId ? { ...status, ...update } : status))
    useAppStore.getState().recordFeatureInteraction('workspace-board-actions')
  }, [setWorkspaceStatuses, workspaceStatuses])
  const handleRenameStatus = useCallback((statusId: string, label: string) => {
    const trimmed = label.trim(); if (trimmed) updateStatus(statusId, { label: trimmed })
  }, [updateStatus])
  const handleChangeStatusColor = useCallback((statusId: string, color: string) => updateStatus(statusId, { color }), [updateStatus])
  const handleChangeStatusIcon = useCallback((statusId: string, icon: string) => updateStatus(statusId, { icon }), [updateStatus])
  const handleMoveStatus = useCallback((statusId: string, direction: -1 | 1) => {
    const index = workspaceStatuses.findIndex((status) => status.id === statusId); const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= workspaceStatuses.length) return
    const next = [...workspaceStatuses]; const [moved] = next.splice(index, 1); next.splice(nextIndex, 0, moved)
    setWorkspaceStatuses(next); useAppStore.getState().recordFeatureInteraction('workspace-board-actions')
  }, [setWorkspaceStatuses, workspaceStatuses])
  const handleAddStatus = useCallback(() => {
    const label = `Status ${workspaceStatuses.length + 1}`
    setWorkspaceStatuses([...workspaceStatuses, { id: makeWorkspaceStatusId(label, workspaceStatuses), label }])
    useAppStore.getState().recordFeatureInteraction('workspace-board-actions')
  }, [setWorkspaceStatuses, workspaceStatuses])
  const handleRemoveStatus = useCallback((statusId: string) => {
    if (workspaceStatuses.length <= 1) return
    const index = workspaceStatuses.findIndex((status) => status.id === statusId); if (index < 0) return
    const next = workspaceStatuses.filter((status) => status.id !== statusId)
    const fallbackStatus = next[Math.min(index, next.length - 1)]?.id ?? next[0]!.id
    setWorkspaceStatuses(next); useAppStore.getState().recordFeatureInteraction('workspace-board-actions')
    for (const worktree of allWorktrees) {
      if (worktree.workspaceStatus === statusId) void updateWorktreeMeta(worktree.id, { workspaceStatus: fallbackStatus })
    }
  }, [allWorktrees, setWorkspaceStatuses, updateWorktreeMeta, workspaceStatuses])
  return { handleRenameStatus, handleChangeStatusColor, handleChangeStatusIcon, handleMoveStatus, handleAddStatus, handleRemoveStatus }
}
