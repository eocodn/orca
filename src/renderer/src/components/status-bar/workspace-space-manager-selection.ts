import { useCallback, useMemo } from 'react'
import type { WorkspaceSpaceWorktree } from '../../../../shared/workspace-space-types'
import type { WorkspaceDecisionDetails } from './workspace-space-manager-decision-model'
import {
  getSelectedDeletableWorkspaceIds,
  getVisibleDeletableWorkspaceIds,
  isWorkspaceSpaceRowReadyToDelete
} from './workspace-space-presentation'

export function useWorkspaceSpaceManagerSelection({
  sourceRows,
  rows,
  deleteStateByWorktreeId,
  nextSelectedIds,
  decisionDetailsByWorktreeId
}: {
  sourceRows: WorkspaceSpaceWorktree[]
  rows: WorkspaceSpaceWorktree[]
  deleteStateByWorktreeId: Record<string, { isDeleting?: boolean }>
  nextSelectedIds: Set<string>
  decisionDetailsByWorktreeId: Map<string, WorkspaceDecisionDetails>
}) {
  const isWorktreeDeleting = useCallback(
    (id: string) => deleteStateByWorktreeId[id]?.isDeleting ?? false,
    [deleteStateByWorktreeId]
  )
  const isWorktreeUnavailableForDelete = useCallback(
    (id: string) => {
      if (isWorktreeDeleting(id)) {
        return true
      }
      const worktree = sourceRows.find((row) => row.worktreeId === id)
      return (
        !worktree ||
        !isWorkspaceSpaceRowReadyToDelete(worktree, decisionDetailsByWorktreeId.get(id))
      )
    },
    [decisionDetailsByWorktreeId, isWorktreeDeleting, sourceRows]
  )
  const selectedDeletableIds = useMemo(
    () => getSelectedDeletableWorkspaceIds(rows, nextSelectedIds, isWorktreeUnavailableForDelete),
    [isWorktreeUnavailableForDelete, nextSelectedIds, rows]
  )
  const visibleDeletableIds = useMemo(
    () => getVisibleDeletableWorkspaceIds(rows, isWorktreeUnavailableForDelete),
    [isWorktreeUnavailableForDelete, rows]
  )
  const allVisibleSelected =
    visibleDeletableIds.length > 0 && visibleDeletableIds.every((id) => nextSelectedIds.has(id))
  return {
    selectedDeletableIds,
    visibleDeletableIds,
    allVisibleSelected,
    someVisibleSelected: visibleDeletableIds.some((id) => nextSelectedIds.has(id))
  }
}
