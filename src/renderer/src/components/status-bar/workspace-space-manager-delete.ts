import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '../../store'
import { runWorktreeBatchDelete } from '../sidebar/delete-worktree-flow'
import { prepareActiveWorktreeFocusAfterDelete } from '../sidebar/active-worktree-focus-after-delete'
import type { WorkspaceSpaceWorktree } from '../../../../shared/workspace-space-types'

type DeletionOptions = {
  selectedDeletableIds: string[]
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>
  setInspectedWorktreeId: Dispatch<SetStateAction<string | null>>
  setTreemapZoomWorktreeId: Dispatch<SetStateAction<string | null>>
}

export function useWorkspaceSpaceManagerDeletion({
  selectedDeletableIds,
  setSelectedIds,
  setInspectedWorktreeId,
  setTreemapZoomWorktreeId
}: DeletionOptions) {
  const removeWorkspaceSpaceWorktrees = useAppStore((state) => state.removeWorkspaceSpaceWorktrees)
  const removeWorktree = useAppStore((state) => state.removeWorktree)

  const handleDeletedWorktrees = useCallback(
    (deletedIds: readonly string[]): void => {
      if (deletedIds.length === 0) {
        return
      }
      removeWorkspaceSpaceWorktrees(deletedIds)
      setInspectedWorktreeId((current) =>
        current && deletedIds.includes(current) ? null : current
      )
      setTreemapZoomWorktreeId((current) =>
        current && deletedIds.includes(current) ? null : current
      )
      setSelectedIds((current) => {
        const next = new Set(current)
        for (const id of deletedIds) {
          next.delete(id)
        }
        return next
      })
      toast.success(
        deletedIds.length === 1
          ? translate(
              'auto.components.status.bar.WorkspaceSpaceManagerPanel.9afc97f9a3',
              'Workspace deleted'
            )
          : translate(
              'auto.components.status.bar.WorkspaceSpaceManagerPanel.eee5240810',
              'Workspaces deleted'
            ),
        {
          description: translate(
            'auto.components.status.bar.WorkspaceSpaceManagerPanel.63efebe0e6',
            '{{value0}} {{value1}} removed from Space.',
            {
              value0: deletedIds.length,
              value1: deletedIds.length === 1 ? 'workspace' : 'workspaces'
            }
          )
        }
      )
    },
    [
      removeWorkspaceSpaceWorktrees,
      setInspectedWorktreeId,
      setSelectedIds,
      setTreemapZoomWorktreeId
    ]
  )

  const deleteWorktrees = useCallback(
    (worktreeIds: readonly string[]): void => {
      if (worktreeIds.length === 0) {
        return
      }
      runWorktreeBatchDelete(worktreeIds, { forceConfirm: true, onDeleted: handleDeletedWorktrees })
    },
    [handleDeletedWorktrees]
  )

  const forceDeleteWorktree = useCallback(
    (worktree: WorkspaceSpaceWorktree): void => {
      const commitFocus = prepareActiveWorktreeFocusAfterDelete(worktree.worktreeId)
      void removeWorktree(worktree.worktreeId, true)
        .then((result) => {
          if (!result.ok) {
            toast.error(
              translate(
                'auto.components.status.bar.WorkspaceSpaceManagerPanel.2965415393',
                'Force delete failed'
              ),
              { description: result.error }
            )
            return
          }
          commitFocus()
          handleDeletedWorktrees([worktree.worktreeId])
        })
        .catch((error: unknown) => {
          toast.error(
            translate(
              'auto.components.status.bar.WorkspaceSpaceManagerPanel.2965415393',
              'Force delete failed'
            ),
            { description: error instanceof Error ? error.message : String(error) }
          )
        })
    },
    [handleDeletedWorktrees, removeWorktree]
  )

  return {
    deleteWorktrees,
    forceDeleteWorktree,
    deleteSelected: () => deleteWorktrees(selectedDeletableIds)
  }
}
