import React from 'react'
import { useAppStore } from '@/store'
import {
  getFlushWorktreeCardPaddingLeft,
  getNewCardStyleParentContentMarginLeft
} from './worktree-list-indentation'
import { translate } from '@/i18n/i18n'
import type { WorktreeCardProps } from './worktree-card-model'
import { useWorktreeCardRuntime } from './worktree-card-runtime'
import { useWorktreeCardActions } from './worktree-card-actions'
import { useWorktreeCardDecorationEffects } from './worktree-card-decoration-effects'
import { WorktreeCardShell } from './worktree-card-shell'
import { getLineageChildLabels, hasDetailedMetaRowContent } from './worktree-card-display-model'
import { buildWorktreeCardDetailRenderModel } from './worktree-card-detail-render'
import { WorktreeCardParent } from './worktree-card-parent'
const WorktreeCardSurface = React.memo(function WorktreeCardSurface({
  worktree,
  repo,
  isActive,
  isActiveSurface = isActive,
  activeSurfaceVariant = 'primary',
  isMultiSelected = false,
  revealHighlight = false,
  revealHighlightTone = 'default',
  selectedWorktrees,
  onActivate,
  onImmediateActivate,
  onSelectionGesture,
  onContextMenuSelect,
  onAssignWorkspaceStatus,
  onCardDragStart,
  onCardDragEnd,
  nativeDragEnabled = true,
  hideRepoBadge,
  hostContextLabel,
  inPinnedSection = false,
  activationRowKey,
  renameRowKey,
  contentIndent = 0,
  flushSurface = false,
  lineageChildCount = 0,
  lineageCollapsed = false,
  lineageChildren,
  lineageChildrenStyle,
  onLineageToggle,
  isLineageDropTarget = false,
  affiliateListMode = false,
  statusPrDisplay = null
}: WorktreeCardProps) {
  const renamingWorktreeId = useAppStore((s) => s.renamingWorktreeId)
  const setRenamingWorktreeId = useAppStore((s) => s.setRenamingWorktreeId)
  const fetchHostedReviewForBranch = useAppStore((s) => s.fetchHostedReviewForBranch)
  const fetchIssue = useAppStore((s) => s.fetchIssue)
  const fetchLinearIssue = useAppStore((s) => s.fetchLinearIssue)
  const runtime = useWorktreeCardRuntime({
    worktree,
    repo,
    hostContextLabel,
    hideRepoBadge,
    inPinnedSection,
    affiliateListMode
  })
  const {
    cardProps,
    newCardStyle,
    compactCards,
    remoteBranchConflict,
    workspacePorts,
    sshStatus,
    sshTargetLabel,
    isSshDisconnected,
    isRuntimeDisconnected,
    showDisconnectedDialog,
    setShowDisconnectedDialog,
    titleRenaming,
    showRenameErrorDialog,
    setShowRenameErrorDialog,
    detailsHoverControl,
    hoverDetailsOpen,
    metadata,
    showIssue,
    showLinearIssue,
    showJiraIssue,
    showPR,
    showAutomation,
    showCli,
    showComment,
    showPorts,
    shouldRefreshHostedReview,
    showInlineAgentList,
    cacheStartedAt,
    isFolder,
    isDeleting,
    isQueuedForDeletion,
    showDeleteQuickAction,
    showRepoBadgeInMetaRow,
    showHostContextBadge,
    showDetachedHeadInMetaRow,
    showBranch,
    showConflictOperationBadge,
    showCombinedStatusSlot,
    showMetaRowDetails,
    showTitleRowIndicators
  } = runtime
  const {
    branch,
    identityDisplay,
    showIdentityInNewCard,
    folderMetaRowContent,
    hostedReviewCacheKey,
    issueCacheKey,
    linkedGitLabMR,
    linkedBitbucketPR,
    linkedAzureDevOpsPR,
    linkedGiteaPR,
    cachedBranchFallbackGitHubPRNumber,
    prDisplay,
    issueDisplay,
    linearIssue,
    linearIssueDisplay,
    jiraIssueDisplay,
    visibleCardTitle
  } = metadata
  const actions = useWorktreeCardActions(
    {
      ...({
        worktree,
        repo,
        isActive,
        isMultiSelected,
        selectedWorktrees,
        onActivate,
        onImmediateActivate,
        onSelectionGesture,
        onContextMenuSelect,
        onCardDragStart,
        onCardDragEnd,
        activationRowKey,
        affiliateListMode,
        nativeDragEnabled
      } as WorktreeCardProps)
    },
    runtime,
    showDeleteQuickAction
  )
  const {
    handleEditIssue,
    handleEditComment,
    handleOpenAutomation,
    handleOpenAutomationRun,
    handleClick,
    handleRenameTitle,
    handleDoubleClick,
    handleDragStart,
    handleDragEnd,
    handleContextMenuSelect,
    handleOpenGitHubIssueInOrca,
    handleOpenReviewInOrca,
    handleUnlinkReview,
    handleOpenLinearIssueInOrca
  } = actions
  useWorktreeCardDecorationEffects({
    worktree,
    repo,
    branch,
    isFolder,
    newCardStyle,
    hoverDetailsOpen,
    shouldRefreshHostedReview,
    showIssue,
    showLinearIssue,
    hostedReviewCacheKey,
    issueCacheKey,
    cachedBranchFallbackGitHubPRNumber,
    linkedGitLabMR,
    linkedBitbucketPR,
    linkedAzureDevOpsPR,
    linkedGiteaPR,
    fetchHostedReviewForBranch,
    fetchIssue,
    fetchLinearIssue
  })
  const { ariaLabel: lineageChildAriaLabel, shortLabel: childWorkspaceShortLabel } =
    getLineageChildLabels(lineageChildCount, lineageCollapsed)
  const showLineageChildChip = lineageChildCount > 0 && onLineageToggle !== undefined
  const statusLaneReview = statusPrDisplay ?? prDisplay
  const detailModel = buildWorktreeCardDetailRenderModel({
    worktreeHostId: worktree.hostId,
    worktreeDisplayName: worktree.displayName,
    newCardStyle,
    compactCards,
    affiliateListMode,
    showIssue,
    showLinearIssue,
    showJiraIssue,
    showPR,
    showAutomation,
    showCli,
    showComment,
    showPorts,
    cardProps,
    visibleCardTitle,
    identityDisplay,
    branch,
    isDeleting,
    workspacePorts,
    detailsHoverControl,
    issueDisplay,
    linearIssueDisplay,
    jiraIssueDisplay,
    prDisplay,
    linearIssue,
    comment: worktree.comment,
    automationProvenance: worktree.automationProvenance,
    cliProvenance: worktree.cliProvenance,
    linkedReview: Boolean(prDisplay),
    handleEditIssue,
    handleEditComment,
    handleOpenGitHubIssueInOrca,
    handleOpenLinearIssueInOrca,
    handleOpenReviewInOrca,
    handleOpenAutomation,
    handleOpenAutomationRun,
    handleUnlinkReview
  })
  const {
    metaAutomationProvenance,
    metaCliProvenance,
    hasHoverDetails,
    hoverBranchName,
    hoverWorkspaceTitle,
    titleWrapper,
    detailsAndPorts
  } = detailModel
  const titleRowIndicators = showTitleRowIndicators ? (
    <div className="ml-auto flex shrink-0 items-center gap-1 pr-1.5">{detailsAndPorts}</div>
  ) : null
  const deleteLabel = isQueuedForDeletion
    ? translate('auto.components.sidebar.WorktreeCard.ef18787206', 'Queued for deletion')
    : translate('auto.components.sidebar.WorktreeCard.691ccfd622', 'Deleting…')
  const hasDetailedMetaRow = hasDetailedMetaRowContent({
    repoBadge: Boolean(showRepoBadgeInMetaRow && repo),
    hostContext: showHostContextBadge,
    folderContent: folderMetaRowContent,
    branch: showBranch,
    identity: showIdentityInNewCard,
    detached: showDetachedHeadInMetaRow,
    conflict: showConflictOperationBadge,
    cache: cacheStartedAt != null,
    details: showMetaRowDetails
  })
  const hasMetaRow = compactCards
    ? showConflictOperationBadge || cacheStartedAt != null
    : hasDetailedMetaRow
  const applyNewCardStyleStatusLaneOffset = newCardStyle && showCombinedStatusSlot
  const cardPaddingLeft = flushSurface
    ? getFlushWorktreeCardPaddingLeft(contentIndent, applyNewCardStyleStatusLaneOffset)
    : contentIndent > 0
      ? `calc(0.125rem + ${contentIndent}px)`
      : null
  const parentContentMarginLeft =
    flushSurface && applyNewCardStyleStatusLaneOffset
      ? getNewCardStyleParentContentMarginLeft(contentIndent)
      : 0
  const cardStyle = cardPaddingLeft ? { paddingLeft: cardPaddingLeft } : undefined
  const hasSecondaryCardContent =
    hasMetaRow || !!remoteBranchConflict || showInlineAgentList || showLineageChildChip
  const titleOnlyCard = !hasSecondaryCardContent

  const parentCardContent = (
    <WorktreeCardParent
      worktree={worktree}
      repo={repo}
      isActive={isActive}
      renameRowKey={renameRowKey}
      hostContextLabel={hostContextLabel}
      runtime={runtime}
      actions={actions}
      metadata={metadata}
      titleWrapper={titleWrapper}
      titleRowIndicators={titleRowIndicators}
      statusLaneReview={statusLaneReview}
      hasMetaRow={hasMetaRow}
      hasHoverDetails={hasHoverDetails}
      detailsAndPorts={detailsAndPorts}
      titleOnlyCard={titleOnlyCard}
      parentContentMarginLeft={parentContentMarginLeft}
      affiliateListMode={affiliateListMode}
      renamingWorktreeId={renamingWorktreeId}
      setRenamingWorktreeId={setRenamingWorktreeId}
      lineageChildAriaLabel={lineageChildAriaLabel}
      lineageCollapsed={lineageCollapsed}
      onLineageToggle={onLineageToggle}
      childWorkspaceShortLabel={childWorkspaceShortLabel}
      lineageChildren={lineageChildren}
    />
  )

  return (
    <WorktreeCardShell
      worktree={worktree}
      repo={repo}
      isActiveSurface={isActiveSurface}
      activeSurfaceVariant={activeSurfaceVariant}
      isMultiSelected={isMultiSelected}
      revealHighlight={revealHighlight}
      revealHighlightTone={revealHighlightTone}
      selectedWorktrees={selectedWorktrees}
      onAssignWorkspaceStatus={onAssignWorkspaceStatus}
      isLineageDropTarget={isLineageDropTarget}
      affiliateListMode={affiliateListMode}
      nativeDragEnabled={nativeDragEnabled}
      lineageChildren={newCardStyle ? lineageChildren : undefined}
      lineageChildrenStyle={lineageChildrenStyle}
      onContextMenuSelect={handleContextMenuSelect}
      parentCardContent={parentCardContent}
      titleOnlyCard={titleOnlyCard}
      flushSurface={flushSurface}
      cardStyle={cardStyle}
      titleRenaming={titleRenaming}
      isDeleting={isDeleting}
      isQueuedForDeletion={isQueuedForDeletion}
      deleteLabel={deleteLabel}
      isSshDisconnected={isSshDisconnected}
      isRuntimeDisconnected={isRuntimeDisconnected}
      handleClick={handleClick}
      handleDoubleClick={handleDoubleClick}
      handleDragStart={handleDragStart}
      handleDragEnd={handleDragEnd}
      hasHoverDetails={hasHoverDetails}
      hoverIssue={issueDisplay}
      hoverLinearIssue={linearIssueDisplay}
      hoverJiraIssue={jiraIssueDisplay}
      hoverReview={prDisplay}
      hoverComment={worktree.comment}
      metaAutomationProvenance={metaAutomationProvenance}
      metaCliProvenance={metaCliProvenance}
      branchName={hoverBranchName}
      workspaceTitle={hoverWorkspaceTitle}
      workspacePorts={workspacePorts}
      detailsHoverControl={detailsHoverControl}
      handleRenameTitle={handleRenameTitle}
      handleEditIssue={handleEditIssue}
      handleEditComment={handleEditComment}
      handleOpenGitHubIssueInOrca={handleOpenGitHubIssueInOrca}
      handleOpenLinearIssueInOrca={handleOpenLinearIssueInOrca}
      handleOpenReviewInOrca={handleOpenReviewInOrca}
      handleOpenAutomation={handleOpenAutomation}
      handleOpenAutomationRun={handleOpenAutomationRun}
      handleUnlinkReview={handleUnlinkReview}
      hasExplicitLinkedReview={Boolean(prDisplay)}
      showDisconnectedDialog={showDisconnectedDialog}
      setShowDisconnectedDialog={setShowDisconnectedDialog}
      sshTargetLabel={sshTargetLabel}
      sshStatus={sshStatus}
      showRenameErrorDialog={showRenameErrorDialog}
      setShowRenameErrorDialog={setShowRenameErrorDialog}
    />
  )
})
export default WorktreeCardSurface
