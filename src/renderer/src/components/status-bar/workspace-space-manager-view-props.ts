import type { WorkspaceSpaceSortKey } from './workspace-space-presentation'
import type { WorkspaceSpaceManagerDeletion } from './workspace-space-manager-delete'
import type { WorkspaceSpaceManagerScan } from './workspace-space-manager-scan'

export type WorkspaceSpaceManagerViewProps = WorkspaceSpaceManagerScan &
  WorkspaceSpaceManagerDeletion & {
    toggleSort: (key: WorkspaceSpaceSortKey) => void
    selectSortKey: (key: WorkspaceSpaceSortKey) => void
    toggleSelection: (worktreeId: string) => void
    toggleVisibleSelection: () => void
    activateAndRevealWorktree: typeof activateAndRevealWorktree
  }
import type { activateAndRevealWorktree } from '@/lib/worktree-activation'
