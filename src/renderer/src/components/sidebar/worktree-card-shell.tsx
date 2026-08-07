import React from 'react'
import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import WorktreeContextMenu from './WorktreeContextMenu'
import { SshDisconnectedDialog } from './SshDisconnectedDialog'
import { AutoRenameFailedDialog } from './AutoRenameFailedDialog'
import { WorktreeCardDetailsHover } from './WorktreeCardMeta'
import { WorktreeCardPortsDetails } from './WorktreeCardPorts'
import type { WorktreeCardProps } from './worktree-card-model'
import type { WorktreeCardPrDisplay } from './worktree-card-pr-display'
import type { WorktreeCardDetailsHoverControl } from './worktree-card-details-hover-state'
import type { WorkspacePort } from '../../../../shared/workspace-ports'

export type WorktreeCardShellProps = Pick<
  WorktreeCardProps,
  | 'worktree'
  | 'repo'
  | 'isActiveSurface'
  | 'activeSurfaceVariant'
  | 'isMultiSelected'
  | 'revealHighlight'
  | 'revealHighlightTone'
  | 'selectedWorktrees'
  | 'onAssignWorkspaceStatus'
  | 'isLineageDropTarget'
  | 'affiliateListMode'
  | 'nativeDragEnabled'
  | 'lineageChildren'
  | 'lineageChildrenStyle'
  | 'onContextMenuSelect'
> & {
  parentCardContent: React.ReactNode
  titleOnlyCard: boolean
  flushSurface: boolean
  cardStyle?: React.CSSProperties
  titleRenaming: boolean
  isDeleting: boolean
  isQueuedForDeletion: boolean
  deleteLabel: string
  isSshDisconnected: boolean
  isRuntimeDisconnected: boolean
  handleClick: (event: React.MouseEvent<HTMLDivElement>) => void
  handleDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void
  handleDragStart: (event: React.DragEvent<HTMLDivElement>) => void
  handleDragEnd: (event: React.DragEvent<HTMLDivElement>) => void
  hasHoverDetails: boolean
  hoverIssue: Parameters<typeof WorktreeCardDetailsHover>[0]['issue']
  hoverLinearIssue: Parameters<typeof WorktreeCardDetailsHover>[0]['linearIssue']
  hoverJiraIssue: Parameters<typeof WorktreeCardDetailsHover>[0]['jiraIssue']
  hoverReview: WorktreeCardPrDisplay | null | undefined
  hoverComment: string | null | undefined
  metaCliProvenance: Parameters<typeof WorktreeCardDetailsHover>[0]['cliProvenance']
  branchName?: string
  workspaceTitle?: string
  workspacePorts: WorkspacePort[]
  detailsHoverControl: WorktreeCardDetailsHoverControl
  handleRenameTitle: (displayName: string) => void
  handleEditIssue: (event: React.MouseEvent) => void
  handleEditComment: (event: React.MouseEvent) => void
  handleOpenGitHubIssueInOrca: (event: React.MouseEvent) => void
  handleOpenLinearIssueInOrca: (event: React.MouseEvent) => void
  handleOpenReviewInOrca: (event: React.MouseEvent) => void
  handleUnlinkReview: () => void
  hasExplicitLinkedReview: boolean
  showDisconnectedDialog: boolean
  setShowDisconnectedDialog: (value: boolean) => void
  sshTargetLabel: string
  sshStatus: string | null
  showRenameErrorDialog: boolean
  setShowRenameErrorDialog: (value: boolean) => void
}

export function WorktreeCardShell({
  worktree,
  repo,
  isActiveSurface,
  activeSurfaceVariant,
  isMultiSelected,
  revealHighlight,
  revealHighlightTone,
  selectedWorktrees,
  onAssignWorkspaceStatus,
  isLineageDropTarget,
  affiliateListMode,
  nativeDragEnabled,
  lineageChildren,
  lineageChildrenStyle,
  onContextMenuSelect,
  parentCardContent,
  titleOnlyCard,
  flushSurface,
  cardStyle,
  titleRenaming,
  isDeleting,
  isQueuedForDeletion,
  deleteLabel,
  isSshDisconnected,
  isRuntimeDisconnected,
  handleClick,
  handleDoubleClick,
  handleDragStart,
  handleDragEnd,
  hasHoverDetails,
  hoverIssue,
  hoverLinearIssue,
  hoverJiraIssue,
  hoverReview,
  hoverComment,
  metaCliProvenance,
  branchName,
  workspaceTitle,
  workspacePorts,
  detailsHoverControl,
  handleRenameTitle,
  handleEditIssue,
  handleEditComment,
  handleOpenGitHubIssueInOrca,
  handleOpenLinearIssueInOrca,
  handleOpenReviewInOrca,
  handleUnlinkReview,
  hasExplicitLinkedReview,
  showDisconnectedDialog,
  setShowDisconnectedDialog,
  sshTargetLabel,
  sshStatus,
  showRenameErrorDialog,
  setShowRenameErrorDialog
}: WorktreeCardShellProps): React.JSX.Element {
  const parentHoverTriggerBody = (
    <div className="group/worktree-card w-full min-w-0" data-worktree-card-hover-trigger="">
      {parentCardContent}
    </div>
  )
  const parentCardBodyWithHoverDetails =
    hasHoverDetails && !titleRenaming ? (
      <WorktreeCardDetailsHover
        issue={hoverIssue}
        linearIssue={hoverLinearIssue}
        jiraIssue={hoverJiraIssue}
        review={hoverReview}
        comment={hoverComment}
        cliProvenance={metaCliProvenance}
        branchName={branchName}
        workspaceTitle={workspaceTitle}
        workspaceTitleRenameDisabled={isDeleting || affiliateListMode}
        detailsAfter={
          workspacePorts.length > 0 ? <WorktreeCardPortsDetails ports={workspacePorts} /> : null
        }
        openDelay={100}
        hoverControl={detailsHoverControl}
        onRenameWorkspaceTitle={affiliateListMode ? undefined : handleRenameTitle}
        onEditIssue={affiliateListMode ? undefined : handleEditIssue}
        onEditComment={affiliateListMode ? undefined : handleEditComment}
        onOpenGitHubIssueInOrca={
          hoverIssue && 'url' in hoverIssue && hoverIssue.url
            ? handleOpenGitHubIssueInOrca
            : undefined
        }
        onOpenLinearIssueInOrca={hoverLinearIssue?.url ? handleOpenLinearIssueInOrca : undefined}
        onOpenReviewInOrca={
          hoverReview?.url && hoverReview.provider === 'github' ? handleOpenReviewInOrca : undefined
        }
        onUnlinkReview={
          !affiliateListMode && hasExplicitLinkedReview ? handleUnlinkReview : undefined
        }
      >
        {parentHoverTriggerBody}
      </WorktreeCardDetailsHover>
    ) : (
      parentHoverTriggerBody
    )
  const cardBody = (
    <div
      className={cn(
        'relative flex cursor-pointer flex-col pr-1.5 transition-[background-color,border-color,opacity,box-shadow] duration-200 outline-none select-none',
        titleOnlyCard ? 'py-2' : 'pt-1.25 pb-1.5',
        flushSurface ? 'ml-1 w-[calc(100%-0.25rem)]' : 'ml-1',
        'rounded-lg',
        isLineageDropTarget
          ? 'border border-accent-foreground/20 bg-accent/80'
          : isActiveSurface
            ? 'border border-transparent'
            : isMultiSelected
              ? 'border border-worktree-sidebar-ring/35 bg-worktree-sidebar-accent/70 ring-1 ring-worktree-sidebar-ring/30'
              : 'border border-transparent worktree-sidebar-card-hover',
        isActiveSurface && isMultiSelected && 'ring-1 ring-worktree-sidebar-ring/35',
        revealHighlight && [
          'scroll-to-current-workspace-reveal-highlight',
          revealHighlightTone === 'ai' && 'scroll-to-current-workspace-reveal-highlight--ai'
        ],
        titleRenaming && '!border-transparent !bg-transparent !shadow-none !ring-0',
        isDeleting && 'opacity-50 grayscale cursor-not-allowed',
        (isSshDisconnected || isRuntimeDisconnected) && !isDeleting && 'opacity-60'
      )}
      data-worktree-card-surface="true"
      data-worktree-card-active={isActiveSurface ? activeSurfaceVariant : undefined}
      onClick={handleClick}
      onDoubleClick={affiliateListMode ? undefined : handleDoubleClick}
      draggable={!affiliateListMode && nativeDragEnabled && !isDeleting && !titleRenaming}
      onDragStart={!affiliateListMode && nativeDragEnabled ? handleDragStart : undefined}
      onDragEnd={!affiliateListMode && nativeDragEnabled ? handleDragEnd : undefined}
      aria-busy={isDeleting}
      style={cardStyle}
    >
      {isDeleting && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/50 backdrop-blur-[1px]">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-[11px] font-medium text-foreground shadow-sm border border-border/50">
            {!isQueuedForDeletion ? (
              <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
            ) : null}
            {deleteLabel}
          </div>
        </div>
      )}
      {parentCardBodyWithHoverDetails}
      {lineageChildren ? (
        <div
          className="mt-1.5 space-y-1"
          data-worktree-lineage-children=""
          style={lineageChildrenStyle}
        >
          {lineageChildren}
        </div>
      ) : null}
    </div>
  )
  return (
    <>
      <>
        {affiliateListMode ? (
          cardBody
        ) : (
          <WorktreeContextMenu
            worktree={worktree}
            selectedWorktrees={selectedWorktrees}
            onContextMenuSelect={
              onContextMenuSelect
                ? (event) => onContextMenuSelect(event, worktree) ?? [worktree]
                : undefined
            }
            onAssignWorkspaceStatus={onAssignWorkspaceStatus}
          >
            {cardBody}
          </WorktreeContextMenu>
        )}
      </>
      {repo?.connectionId && (
        <SshDisconnectedDialog
          open={showDisconnectedDialog && isSshDisconnected}
          onOpenChange={setShowDisconnectedDialog}
          targetId={repo.connectionId}
          targetLabel={sshTargetLabel || repo.displayName}
          status={sshStatus ?? 'disconnected'}
        />
      )}
      {typeof worktree.firstAgentMessageRenameError === 'string' &&
        worktree.firstAgentMessageRenameError.length > 0 && (
          <AutoRenameFailedDialog
            open={showRenameErrorDialog}
            onOpenChange={setShowRenameErrorDialog}
            worktreeId={worktree.id}
            worktreeName={worktree.displayName}
            error={worktree.firstAgentMessageRenameError}
          />
        )}
    </>
  )
}
