import type { WorktreeForceDeleteReason } from '../../../../shared/worktree-removal'

export type WorkspaceSpaceDeleteState = {
  isDeleting: boolean
  error: string | null
  canForceDelete: boolean
  forceDeleteReason: WorktreeForceDeleteReason | null
}

export type WorkspaceGitRefreshState = {
  isRefreshing: boolean
  error: string | null
}
