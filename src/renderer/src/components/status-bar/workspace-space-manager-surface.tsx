import { useCallback } from 'react'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { WorkspaceSpaceManagerView } from './workspace-space-manager-view'
import { useWorkspaceSpaceManagerDeletion } from './workspace-space-manager-delete'
import { useWorkspaceSpaceManagerScan } from './workspace-space-manager-scan'

export { getWorkspaceDecisionDetails } from './workspace-space-manager-decision-model'
export type { WorkspaceDecisionDetails } from './workspace-space-manager-decision-model'

export function WorkspaceSpaceManagerPanel(): React.JSX.Element {
  const scan = useWorkspaceSpaceManagerScan()
  const deletion = useWorkspaceSpaceManagerDeletion({
    selectedDeletableIds: scan.selectedDeletableIds,
    setSelectedIds: scan.setSelectedIds,
    setInspectedWorktreeId: scan.setInspectedWorktreeId,
    setTreemapZoomWorktreeId: scan.setTreemapZoomWorktreeId
  })
  const toggleSort = useCallback(
    (key: typeof scan.sortKey): void => {
      if (scan.sortKey === key) {
        scan.setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
        return
      }
      scan.setSortKey(key)
      scan.setSortDirection(key === 'name' || key === 'repo' ? 'asc' : 'desc')
    },
    [scan]
  )
  const selectSortKey = useCallback(
    (key: typeof scan.sortKey): void => {
      scan.setSortKey(key)
      scan.setSortDirection(key === 'name' || key === 'repo' ? 'asc' : 'desc')
    },
    [scan]
  )
  const toggleSelection = useCallback(
    (id: string): void => {
      scan.setSelectedIds((current) => {
        const next = new Set(current)
        if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }
        return next
      })
    },
    [scan]
  )
  const toggleVisibleSelection = useCallback((): void => {
    scan.setSelectedIds((current) => {
      const next = new Set(current)
      for (const id of scan.visibleDeletableIds) {
        if (scan.allVisibleSelected) {
          next.delete(id)
        } else {
          next.add(id)
        }
      }
      return next
    })
  }, [scan])

  const viewProps = {
    ...scan,
    ...deletion,
    toggleSort,
    selectSortKey,
    toggleSelection,
    toggleVisibleSelection,
    activateAndRevealWorktree
  }
  return <WorkspaceSpaceManagerView {...viewProps} />
}
