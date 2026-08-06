import type React from 'react'
import type { Repo, Worktree } from '../../../../shared/types'
import type { AppState } from '@/store/types'
import type { parseExecutionHostId } from '../../../../shared/execution-host'
import type { getWorktreeGitIdentityDisplay } from '@/lib/worktree-git-identity-display'
import type { WorktreeCardPrDisplay } from './worktree-card-pr-display'
import type { CONFLICT_OPERATION_LABELS } from './WorktreeCardHelpers'
import type { shouldBeginWorktreeRename } from './worktree-card-model'

export type WorktreeCardContentProps = {
  worktree: Worktree
  repo: Repo | undefined
  settings: AppState['settings']
  isActive: boolean
  isFolder: boolean
  compactCards: boolean
  newCardStyle: boolean
  affiliateListMode: boolean
  isSshDisconnected: boolean
  isRuntimeDisconnected: boolean
  parsedRepoHost: ReturnType<typeof parseExecutionHostId>
  runtimeHostLabel: string | null
  visibleCardTitle: string
  showUnreadEmphasis: boolean
  isDeleting: boolean
  titleRenaming: boolean
  setTitleRenaming: (value: boolean) => void
  titleWrapper?: (title: React.ReactElement) => React.ReactElement
  handleRenameTitle: (displayName: string) => void
  handleOpenRenameErrorDialog: (event: React.MouseEvent<HTMLButtonElement>) => void
  renamingWorktreeId: Parameters<typeof shouldBeginWorktreeRename>[0]
  renameRowKey?: string
  setRenamingWorktreeId: (value: null) => void
  showStatus: boolean
  showCombinedStatusSlot: boolean
  showUnreadQuickAction: boolean
  unreadTooltip: string
  stopQuickActionPointerPropagation: (event: React.PointerEvent<HTMLButtonElement>) => void
  handleToggleUnreadQuick: (event: React.MouseEvent<HTMLButtonElement>) => void
  statusLaneReview: WorktreeCardPrDisplay | null
  branchIdentityDisplay?: string
  showPinnedRepoIcon: boolean
  showInlineRepoBadge: boolean
  showTitleRowIndicators: boolean
  titleRowIndicators: React.ReactNode
  showHeaderActions: boolean
  showTitleRowPrimary: boolean
  showDeleteQuickAction: boolean
  handleWorkspaceQuickAction: (event: React.MouseEvent<HTMLButtonElement>) => void
  hasMetaRow: boolean
  showRepoBadgeInMetaRow: boolean
  showHostContextBadge: boolean
  hostContextLabel?: string
  showIdentityInNewCard: boolean
  identityDisplay?: string
  hasHoverDetails: boolean
  showBranch: boolean
  branch: string
  showDetachedHeadInMetaRow: boolean
  detachedHeadDisplay: NonNullable<ReturnType<typeof getWorktreeGitIdentityDisplay>>
  showConflictOperationBadge: boolean
  conflictOperation: keyof typeof CONFLICT_OPERATION_LABELS
  cacheStartedAt: number | null | undefined
  cacheTtlMs: number
  showMetaRowDetails: boolean
  detailsAndPorts: React.ReactNode
  remoteBranchConflict?: { remote: string; branchName: string } | null
  showInlineAgentList: boolean
  agentActivityDisplayMode: AppState['agentActivityDisplayMode']
  compactInlineAgentRows: readonly unknown[]
  showLineageChildChip: boolean
  lineageChildAriaLabel: string
  lineageCollapsed: boolean
  onLineageToggle?: (event: React.MouseEvent<HTMLButtonElement>) => void
  childWorkspaceShortLabel: string
  lineageChildren?: React.ReactNode
  titleOnlyCard: boolean
  parentContentMarginLeft: number
}
