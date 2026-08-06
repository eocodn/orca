import React from 'react'
import { WorktreeCardContent } from './worktree-card-content'
import type { WorktreeCardContentProps } from './worktree-card-content-types'
import type { WorktreeCardProps } from './worktree-card-model'
import type { WorktreeCardRuntime } from './worktree-card-runtime'
import type { WorktreeCardActions } from './worktree-card-actions'
import type { WorktreeCardPrDisplay } from './worktree-card-pr-display'
import type { Worktree } from '../../../../shared/types'
import type { useWorktreeCardMetadata } from './worktree-card-metadata'

export type WorktreeCardParentContext = {
  worktree: Worktree
  repo: WorktreeCardProps['repo']
  isActive: boolean
  renameRowKey?: string
  hostContextLabel?: string
  runtime: WorktreeCardRuntime
  actions: WorktreeCardActions
  metadata: ReturnType<typeof useWorktreeCardMetadata>
  affiliateListMode: boolean
  renamingWorktreeId: WorktreeCardContentProps['renamingWorktreeId']
  setRenamingWorktreeId: WorktreeCardContentProps['setRenamingWorktreeId']
  lineageChildAriaLabel: string
  lineageCollapsed: boolean
  onLineageToggle?: WorktreeCardContentProps['onLineageToggle']
  childWorkspaceShortLabel: string
  lineageChildren?: React.ReactNode
  titleWrapper?: WorktreeCardContentProps['titleWrapper']
  titleRowIndicators: React.ReactNode
  statusLaneReview: WorktreeCardPrDisplay | null | undefined
  hasMetaRow: boolean
  hasHoverDetails: boolean
  detailsAndPorts: React.ReactNode
  titleOnlyCard: boolean
  parentContentMarginLeft: number
}

export function WorktreeCardParent(context: WorktreeCardParentContext): React.JSX.Element {
  const {
    worktree,
    repo,
    isActive,
    renameRowKey,
    hostContextLabel,
    runtime,
    actions,
    metadata,
    titleWrapper,
    titleRowIndicators,
    statusLaneReview,
    hasMetaRow,
    hasHoverDetails,
    detailsAndPorts,
    titleOnlyCard,
    parentContentMarginLeft,
    affiliateListMode,
    renamingWorktreeId,
    setRenamingWorktreeId,
    lineageChildAriaLabel,
    lineageCollapsed,
    onLineageToggle,
    childWorkspaceShortLabel,
    lineageChildren
  } = context
  const {
    settings,
    compactCards,
    newCardStyle,
    isSshDisconnected,
    isRuntimeDisconnected,
    isFolder,
    parsedRepoHost,
    runtimeHostLabel,
    showUnreadEmphasis,
    isDeleting,
    titleRenaming,
    setTitleRenaming,
    showStatus,
    showCombinedStatusSlot,
    showUnreadQuickAction,
    showPinnedRepoIcon,
    showInlineRepoBadge,
    showTitleRowIndicators,
    showTitleRowPrimary,
    showDeleteQuickAction,
    showRepoBadgeInMetaRow,
    showHostContextBadge,
    showIdentityInNewCard,
    showBranch,
    showDetachedHeadInMetaRow,
    showConflictOperationBadge,
    cacheStartedAt,
    cacheTtlMs,
    showMetaRowDetails,
    remoteBranchConflict,
    showInlineAgentList,
    agentActivityDisplayMode,
    compactInlineAgentRows,
    showLineageChildChip
  } = runtime
  const {
    handleRenameTitle,
    handleOpenRenameErrorDialog,
    handleToggleUnreadQuick,
    stopQuickActionPointerPropagation,
    handleWorkspaceQuickAction
  } = actions
  const conflictOperation =
    runtime.conflictOperation === 'unknown' ? 'merge' : runtime.conflictOperation
  const showHeaderActions = showTitleRowPrimary || showDeleteQuickAction
  const contentProps: WorktreeCardContentProps = {
    worktree,
    repo,
    settings,
    isActive,
    isFolder,
    compactCards,
    newCardStyle,
    affiliateListMode,
    isSshDisconnected,
    isRuntimeDisconnected,
    parsedRepoHost,
    runtimeHostLabel,
    visibleCardTitle: metadata.visibleCardTitle,
    showUnreadEmphasis,
    isDeleting,
    titleRenaming,
    setTitleRenaming,
    titleWrapper,
    handleRenameTitle,
    handleOpenRenameErrorDialog,
    renamingWorktreeId,
    renameRowKey,
    setRenamingWorktreeId,
    showStatus,
    showCombinedStatusSlot,
    showUnreadQuickAction,
    unreadTooltip: worktree.isUnread ? 'Mark read' : 'Mark unread',
    stopQuickActionPointerPropagation,
    handleToggleUnreadQuick,
    statusLaneReview,
    branchIdentityDisplay: metadata.branchIdentityDisplay,
    showPinnedRepoIcon,
    showInlineRepoBadge,
    showTitleRowIndicators,
    titleRowIndicators,
    showHeaderActions,
    showTitleRowPrimary,
    showDeleteQuickAction,
    handleWorkspaceQuickAction,
    hasMetaRow,
    showRepoBadgeInMetaRow,
    showHostContextBadge,
    hostContextLabel,
    showIdentityInNewCard,
    identityDisplay: metadata.identityDisplay,
    hasHoverDetails,
    showBranch,
    branch: metadata.branch,
    showDetachedHeadInMetaRow,
    detachedHeadDisplay: metadata.detachedHeadDisplay,
    showConflictOperationBadge,
    conflictOperation,
    cacheStartedAt,
    cacheTtlMs,
    showMetaRowDetails,
    detailsAndPorts,
    remoteBranchConflict,
    showInlineAgentList,
    agentActivityDisplayMode,
    compactInlineAgentRows,
    showLineageChildChip,
    lineageChildAriaLabel,
    lineageCollapsed,
    onLineageToggle,
    childWorkspaceShortLabel,
    lineageChildren,
    titleOnlyCard,
    parentContentMarginLeft
  }
  return <WorktreeCardContent {...contentProps} />
}
