import { useCallback } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
import type { Worktree, WorktreeMeta, WorkspaceStatus } from '../../../../shared/types'
import {
  getWorkspaceBoardTaskStatusSyncRequest,
  syncWorkspaceBoardTaskStatuses,
  type WorkspaceBoardTaskStatusSyncResult
} from './workspace-board-task-status-sync'
import { getWorkspaceStatus } from './workspace-status'
import {
  buildManualOrderUpdatesForGroupDrop,
  shouldWriteManualOrderForGroupDrop,
  type WorktreeDragGroup
} from './worktree-manual-order'
import { translate } from '@/i18n/i18n'

function formatTaskStatusSyncMessage(message: { kind: string; issueIdentifier?: string; statusLabel?: string }): string {
  switch (message.kind) {
    case 'issue-read-failed': return translate('auto.components.sidebar.WorkspaceKanbanDrawer.c1d2e3f4a5', 'Linear issue {{value0}} could not be read.', { value0: message.issueIdentifier })
    case 'missing-workflow-state': return translate('auto.components.sidebar.WorkspaceKanbanDrawer.d2e3f4a5b6', 'No matching Linear workflow state for {{value0}}.', { value0: message.statusLabel })
    case 'ambiguous-workflow-state': return translate('auto.components.sidebar.WorkspaceKanbanDrawer.e3f4a5b6c7', 'Multiple Linear workflow states match {{value0}}.', { value0: message.statusLabel })
    case 'update-failed': return translate('auto.components.sidebar.WorkspaceKanbanDrawer.f4e5f6a7d8', 'Could not update Linear issue {{value0}}.', { value0: message.issueIdentifier })
    case 'provider-error': return translate('auto.components.sidebar.WorkspaceKanbanDrawer.a5b6c7d8e9', 'Could not sync Linear issue {{value0}}.', { value0: message.issueIdentifier })
    default: return translate('auto.components.sidebar.WorkspaceKanbanDrawer.b6c7d8e9f0', 'Task status sync could not finish.')
  }
}

function formatTaskStatusSyncDescription(result: WorkspaceBoardTaskStatusSyncResult): string {
  const counts = [
    result.updated > 0 ? translate('auto.components.sidebar.WorkspaceKanbanDrawer.c7d8e9f0a1', '{{value0}} updated', { value0: result.updated }) : null,
    result.skipped > 0 ? translate('auto.components.sidebar.WorkspaceKanbanDrawer.d8e9f0a1b2', '{{value0}} skipped', { value0: result.skipped }) : null,
    result.failed > 0 ? translate('auto.components.sidebar.WorkspaceKanbanDrawer.e9f0a1b2c3', '{{value0}} failed', { value0: result.failed }) : null
  ].filter((part): part is string => part !== null)
  return [counts.join(', '), result.messages[0] ? formatTaskStatusSyncMessage(result.messages[0]) : null].filter(Boolean).join('. ')
}

export function useWorkspaceKanbanBoardActions({
  worktreeById,
  workspaceStatuses,
  boardDragGroups,
  sortBy,
  setSortBy,
  syncTaskStatusFromWorkspaceBoard,
  updateWorktreeMeta,
  updateWorktreesMeta
}: {
  worktreeById: Map<string, Worktree>
  workspaceStatuses: readonly WorkspaceStatus[]
  boardDragGroups: readonly WorktreeDragGroup[]
  sortBy: string
  setSortBy: (sort: 'manual') => void
  syncTaskStatusFromWorkspaceBoard: boolean
  updateWorktreeMeta: (worktreeId: string, update: Partial<WorktreeMeta>) => Promise<unknown>
  updateWorktreesMeta: (updates: Map<string, Partial<WorktreeMeta>>) => Promise<unknown>
}): {
  moveWorktreeToStatus: (worktreeId: string, status: WorkspaceStatus) => void
  moveWorktreesToStatus: (worktreeIds: readonly string[], status: WorkspaceStatus) => void
  dropWorktreesInStatus: (args: { worktreeIds: readonly string[]; status: WorkspaceStatus; dropIndex: number; writeManualOrder?: boolean }) => void
  pinWorktree: (worktreeId: string) => void
  pinWorktrees: (worktreeIds: readonly string[]) => void
  shouldWriteDropManualOrder: (worktreeIds: readonly string[], status: WorkspaceStatus) => boolean
} {
  const handleTaskStatusSyncResult = useCallback((result: WorkspaceBoardTaskStatusSyncResult) => {
    if (result.failed === 0 && result.messages.length === 0) return
    const description = formatTaskStatusSyncDescription(result)
    if (result.failed > 0) {
      toast.error(translate('auto.components.sidebar.WorkspaceKanbanDrawer.1975a4e480', 'Task status sync failed'), { description })
    } else {
      toast.warning(translate('auto.components.sidebar.WorkspaceKanbanDrawer.e02b0d92ff', 'Task status sync skipped'), { description })
    }
  }, [])
  const maybeSync = useCallback((worktreeIds: readonly string[], status: WorkspaceStatus) => {
    const request = getWorkspaceBoardTaskStatusSyncRequest({ enabled: syncTaskStatusFromWorkspaceBoard, worktreeIds, status, worktreesById: worktreeById, workspaceStatuses })
    if (!request) return
    void syncWorkspaceBoardTaskStatuses({
      worktreeIds: request.worktreeIds,
      targetStatus: request.targetStatus,
      worktreesById: worktreeById,
      getSettingsForWorktree: (worktreeId) => getSettingsForWorktreeRuntimeOwner(useAppStore.getState(), worktreeId),
      getLatestWorkspaceStatus: (worktreeId) => useAppStore.getState().getKnownWorktreeById(worktreeId)?.workspaceStatus
    }).then(handleTaskStatusSyncResult).catch((error: unknown) => handleTaskStatusSyncResult({
      updated: 0, skipped: 0, failed: request.worktreeIds.length,
      messages: [{ kind: 'unexpected-error', detail: error instanceof Error ? error.message : undefined }]
    }))
  }, [handleTaskStatusSyncResult, syncTaskStatusFromWorkspaceBoard, worktreeById, workspaceStatuses])
  const moveWorktreeToStatus = useCallback((worktreeId: string, status: WorkspaceStatus) => {
    const current = worktreeById.get(worktreeId)
    if (!current || getWorkspaceStatus(current, workspaceStatuses) === status) return
    useAppStore.getState().recordFeatureInteraction('workspace-board-actions')
    void updateWorktreeMeta(worktreeId, { workspaceStatus: status })
    maybeSync([worktreeId], status)
  }, [maybeSync, updateWorktreeMeta, worktreeById, workspaceStatuses])
  const moveWorktreesToStatus = useCallback((worktreeIds: readonly string[], status: WorkspaceStatus) => {
    const updates = new Map<string, Partial<WorktreeMeta>>(); const changedIds: string[] = []
    for (const worktreeId of worktreeIds) {
      const current = worktreeById.get(worktreeId)
      if (current && getWorkspaceStatus(current, workspaceStatuses) !== status) {
        changedIds.push(worktreeId); updates.set(worktreeId, { workspaceStatus: status })
      }
    }
    if (changedIds.length === 0) return
    useAppStore.getState().recordFeatureInteraction('workspace-board-actions')
    void updateWorktreesMeta(updates); maybeSync(changedIds, status)
  }, [maybeSync, updateWorktreesMeta, worktreeById, workspaceStatuses])
  const getSourceStatusKeys = useCallback((ids: readonly string[]) => ids.flatMap((id) => {
    const worktree = worktreeById.get(id); return worktree ? [getWorkspaceStatus(worktree, workspaceStatuses)] : []
  }), [worktreeById, workspaceStatuses])
  const shouldWriteDropManualOrder = useCallback((ids: readonly string[], status: WorkspaceStatus) => shouldWriteManualOrderForGroupDrop({ sortBy, sourceGroupKeys: getSourceStatusKeys(ids), targetGroupKey: status }), [getSourceStatusKeys, sortBy])
  const dropWorktreesInStatus = useCallback((args: { worktreeIds: readonly string[]; status: WorkspaceStatus; dropIndex: number; writeManualOrder?: boolean }) => {
    const updates = new Map<string, Partial<WorktreeMeta>>(); const writeManualOrder = args.writeManualOrder ?? shouldWriteDropManualOrder(args.worktreeIds, args.status)
    const rankByWorktreeId = writeManualOrder ? new Map(boardDragGroups.flatMap((group) => group.worktreeIds.flatMap((id) => { const worktree = worktreeById.get(id); return worktree ? [[id, worktree.manualOrder ?? worktree.sortOrder] as const] : [] }))) : undefined
    const order = writeManualOrder ? buildManualOrderUpdatesForGroupDrop({ groups: boardDragGroups, targetGroupKey: args.status, draggedIds: args.worktreeIds, dropIndex: args.dropIndex, now: Date.now(), rankByWorktreeId }) : { changed: false, updates: new Map<string, { manualOrder: number }>() }
    for (const id of args.worktreeIds) { const current = worktreeById.get(id); if (!current) continue; const update = updates.get(id) ?? {}; if (getWorkspaceStatus(current, workspaceStatuses) !== args.status) update.workspaceStatus = args.status; updates.set(id, update) }
    if (writeManualOrder) for (const [id, manualOrder] of order.updates) updates.set(id, { ...(updates.get(id) ?? {}), ...manualOrder })
    for (const [id, update] of updates) if (Object.keys(update).length === 0) updates.delete(id)
    if (updates.size === 0) return
    if (writeManualOrder && order.changed) setSortBy('manual')
    useAppStore.getState().recordFeatureInteraction('workspace-board-actions'); void updateWorktreesMeta(updates); maybeSync(args.worktreeIds, args.status)
  }, [boardDragGroups, maybeSync, setSortBy, shouldWriteDropManualOrder, updateWorktreesMeta, worktreeById, workspaceStatuses])
  const pinWorktree = useCallback((id: string) => { const current = worktreeById.get(id); if (current && !current.isPinned) void updateWorktreeMeta(id, { isPinned: true }) }, [updateWorktreeMeta, worktreeById])
  const pinWorktrees = useCallback((ids: readonly string[]) => { const updates = new Map<string, { isPinned: true }>(); for (const id of ids) { const current = worktreeById.get(id); if (current && !current.isPinned) updates.set(id, { isPinned: true }) } if (updates.size) { useAppStore.getState().recordFeatureInteraction('workspace-board-actions'); void updateWorktreesMeta(updates) } }, [updateWorktreesMeta, worktreeById])
  return { moveWorktreeToStatus, moveWorktreesToStatus, dropWorktreesInStatus, pinWorktree, pinWorktrees, shouldWriteDropManualOrder }
}
