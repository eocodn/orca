import React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { AlertCircle, Server, ServerOff } from 'lucide-react'
import { LinearAgentSkillSetupPrompt } from './LinearAgentSkillSetupPrompt'
import WorktreeCardAgents from './WorktreeCardAgents'
import { WorktreeCardStatusSlot } from './WorktreeCardStatusSlot'
import { WorktreeTitleInlineRename } from './WorktreeTitleInlineRename'
import { RepoIconGlyph } from '@/components/repo/repo-icon'
import { RepoIdentityChip } from './worktree-card-repo-identity'
import type { CONFLICT_OPERATION_LABELS } from './WorktreeCardHelpers'
import { resolveRepoHeaderColor } from './project-header-color'
import { formatSparseDirectoryPreview, shouldBeginWorktreeRename } from './worktree-card-model'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { WorktreeCardContentProps } from './worktree-card-content-types'
import { WorktreeCardLineage } from './worktree-card-lineage'
import { WorktreeCardHeaderActions } from './worktree-card-header-actions'
import { WorktreeCardMetadataRow } from './worktree-card-metadata-row'
import { WorktreeCardConflict } from './worktree-card-conflict'

export function WorktreeCardContent({
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
  visibleCardTitle,
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
  unreadTooltip,
  stopQuickActionPointerPropagation,
  handleToggleUnreadQuick,
  statusLaneReview,
  branchIdentityDisplay,
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
  identityDisplay,
  hasHoverDetails,
  showBranch,
  branch,
  showDetachedHeadInMetaRow,
  detachedHeadDisplay,
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
}: WorktreeCardContentProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex w-full min-w-0 gap-0.5 pl-0',
        titleOnlyCard ? 'items-center' : 'items-start'
      )}
      style={
        parentContentMarginLeft < 0 ? { marginLeft: `${parentContentMarginLeft}px` } : undefined
      }
      data-worktree-card-parent-content=""
    >
      {showCombinedStatusSlot ? (
        <div
          className={cn(
            'flex shrink-0 justify-center',
            newCardStyle ? 'mr-1 w-5 items-center' : 'items-start pt-[2px]',
            affiliateListMode && 'px-1'
          )}
          data-worktree-card-status-slot=""
        >
          <WorktreeCardStatusSlot
            worktreeId={worktree.id}
            showStatus={showStatus}
            showUnreadAction={showUnreadQuickAction}
            isUnread={worktree.isUnread}
            unreadTooltip={unreadTooltip}
            onPointerDown={stopQuickActionPointerPropagation}
            onToggleUnread={handleToggleUnreadQuick}
            prDisplay={statusLaneReview}
            newCardStyle={newCardStyle}
            hasBranchIdentity={Boolean(branchIdentityDisplay)}
          />
        </div>
      ) : null}

      {/* Content area */}
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col gap-1.5',
          // Why: inline agent rows intentionally outdent into the card gutter; inner elements handle truncation.
          showInlineAgentList || (!newCardStyle && lineageChildren)
            ? 'overflow-visible'
            : 'overflow-hidden'
        )}
      >
        {/* Header row: Title */}
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {showPinnedRepoIcon && (
              <RepoIdentityChip repo={repo}>
                <RepoIconGlyph
                  repoIcon={repo.repoIcon}
                  color={resolveRepoHeaderColor(repo.badgeColor)}
                  className="size-full"
                  iconClassName="size-3"
                />
              </RepoIdentityChip>
            )}

            {repo?.connectionId && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0 inline-flex items-center">
                    {isSshDisconnected ? (
                      <ServerOff className="size-3 text-red-400" />
                    ) : (
                      <Server className="size-3 text-muted-foreground" />
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {isSshDisconnected
                    ? translate(
                        'auto.components.sidebar.WorktreeCard.021538e1d1',
                        'SSH disconnected'
                      )
                    : translate(
                        'auto.components.sidebar.WorktreeCard.ca74db7550',
                        'Project on SSH host'
                      )}
                </TooltipContent>
              </Tooltip>
            )}

            {!repo?.connectionId && parsedRepoHost?.kind === 'runtime' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0 inline-flex items-center">
                    {isRuntimeDisconnected ? (
                      <ServerOff className="size-3 text-red-400" />
                    ) : (
                      <Server className="size-3 text-muted-foreground" />
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {isRuntimeDisconnected
                    ? runtimeHostLabel
                      ? translate(
                          'auto.components.sidebar.WorktreeCard.runtimeHostDisconnectedNamed',
                          '{{hostName}} disconnected',
                          { hostName: runtimeHostLabel }
                        )
                      : translate(
                          'auto.components.sidebar.WorktreeCard.runtimeHostDisconnected',
                          'Server disconnected'
                        )
                    : runtimeHostLabel
                      ? translate(
                          'auto.components.sidebar.WorktreeCard.runtimeHostProjectNamed',
                          'Project on {{hostName}}',
                          { hostName: runtimeHostLabel }
                        )
                      : translate(
                          'auto.components.sidebar.WorktreeCard.runtimeHostProject',
                          'Project on Orca server'
                        )}
                </TooltipContent>
              </Tooltip>
            )}

            {showInlineRepoBadge && (
              <RepoIdentityChip repo={repo}>
                <RepoIconGlyph
                  repoIcon={repo.repoIcon}
                  color={resolveRepoHeaderColor(repo.badgeColor)}
                  className="size-full"
                  iconClassName="size-3"
                />
              </RepoIdentityChip>
            )}

            {/* Why: unread alert lives in the left status lane; title-row contrast comes from weight and dimmed read titles. */}
            <WorktreeTitleInlineRename
              displayName={visibleCardTitle}
              disabled={isDeleting || affiliateListMode}
              showUnreadEmphasis={showUnreadEmphasis}
              dimReadTitle={newCardStyle}
              className="text-[13px] leading-5"
              editingClassName="flex-1"
              titleWrapper={titleWrapper}
              onEditingChange={affiliateListMode ? undefined : setTitleRenaming}
              onRename={handleRenameTitle}
              beginEditing={
                !affiliateListMode &&
                shouldBeginWorktreeRename(renamingWorktreeId, worktree.id, renameRowKey)
              }
              onBeginEditingConsumed={
                affiliateListMode ? undefined : () => setRenamingWorktreeId(null)
              }
            />

            {typeof worktree.firstAgentMessageRenameError === 'string' &&
            worktree.firstAgentMessageRenameError.length > 0 &&
            !titleRenaming ? (
              // Why: the error can be raw agent CLI output, so the badge opens a dialog rather than a tooltip.
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    onPointerDown={stopQuickActionPointerPropagation}
                    onClick={handleOpenRenameErrorDialog}
                    onDoubleClick={handleOpenRenameErrorDialog}
                    className="h-4 shrink-0 gap-0.5 rounded !px-0.5 text-[10px] font-medium leading-none text-destructive border border-destructive/40 bg-destructive/10 hover:bg-destructive/15 hover:text-destructive has-[>svg]:!px-0.5"
                    aria-label={translate(
                      'auto.components.sidebar.WorktreeCard.02e19349f4',
                      'Auto-rename failed: view error'
                    )}
                  >
                    <AlertCircle className="size-2.5" />
                    {translate('auto.components.sidebar.WorktreeCard.74522ee457', 'rename failed')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {translate(
                    'auto.components.sidebar.WorktreeCard.4eba2ea99e',
                    'Auto-name failed. Click to see details.'
                  )}
                </TooltipContent>
              </Tooltip>
            ) : null}
            {!compactCards && worktree.isMainWorktree && !isFolder && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="h-[16px] px-1.5 text-[10px] font-medium rounded shrink-0 leading-none text-foreground/70 border-foreground/20 bg-foreground/[0.06]"
                  >
                    {translate('auto.components.sidebar.WorktreeCard.7d517f82e2', 'primary')}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {translate(
                    'auto.components.sidebar.WorktreeCard.0777de5970',
                    'Primary worktree (original clone directory)'
                  )}
                </TooltipContent>
              </Tooltip>
            )}

            {worktree.isSparse && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="h-[16px] px-1.5 text-[10px] font-medium rounded shrink-0 leading-none text-amber-700 dark:text-amber-300 border-amber-500/30 bg-amber-500/5"
                  >
                    {translate('auto.components.sidebar.WorktreeCard.4f964d5e8c', 'sparse')}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8} className="max-w-72">
                  <div className="space-y-1">
                    <div>
                      {translate(
                        'auto.components.sidebar.WorktreeCard.0f33af979b',
                        'Partial checkout. Files outside these paths are not on disk.'
                      )}
                    </div>
                    {worktree.sparseDirectories && worktree.sparseDirectories.length > 0 ? (
                      <div className="font-mono text-[11px] opacity-80">
                        {formatSparseDirectoryPreview(worktree.sparseDirectories)}
                      </div>
                    ) : null}
                  </div>
                </TooltipContent>
              </Tooltip>
            )}

            {showTitleRowIndicators && titleRowIndicators}
          </div>

          <WorktreeCardHeaderActions
            showHeaderActions={showHeaderActions}
            showTitleRowPrimary={showTitleRowPrimary}
            showDeleteQuickAction={showDeleteQuickAction}
            stopQuickActionPointerPropagation={stopQuickActionPointerPropagation}
            handleWorkspaceQuickAction={handleWorkspaceQuickAction}
          />
        </div>

        <WorktreeCardMetadataRow
          hasMetaRow={hasMetaRow}
          repo={repo}
          worktree={worktree}
          showRepoBadgeInMetaRow={showRepoBadgeInMetaRow}
          showHostContextBadge={showHostContextBadge}
          hostContextLabel={hostContextLabel}
          showIdentityInNewCard={showIdentityInNewCard}
          identityDisplay={identityDisplay}
          hasHoverDetails={hasHoverDetails}
          isFolder={isFolder}
          newCardStyle={newCardStyle}
          showBranch={showBranch}
          branch={branch}
          showDetachedHeadInMetaRow={showDetachedHeadInMetaRow}
          detachedHeadDisplay={detachedHeadDisplay}
          showConflictOperationBadge={showConflictOperationBadge}
          conflictOperation={conflictOperation as keyof typeof CONFLICT_OPERATION_LABELS}
          cacheStartedAt={cacheStartedAt}
          cacheTtlMs={cacheTtlMs}
          showMetaRowDetails={showMetaRowDetails}
          detailsAndPorts={detailsAndPorts}
        />

        <WorktreeCardConflict remoteBranchConflict={remoteBranchConflict} />

        {isActive && worktree.linkedLinearIssue ? (
          <LinearAgentSkillSetupPrompt
            linked
            remote={Boolean(repo?.connectionId || settings?.activeRuntimeEnvironmentId?.trim())}
            surface="modal"
            settings={settings}
          />
        ) : null}

        {/* Why: counterbalance the card stack gap (-mt-1) so agents right after the title read as one header group. */}
        {showInlineAgentList && (
          <WorktreeCardAgents
            worktreeId={worktree.id}
            agents={agentActivityDisplayMode === 'compact' ? compactInlineAgentRows : undefined}
            className={hasMetaRow || remoteBranchConflict ? 'mt-0' : '-mt-1'}
          />
        )}

        <WorktreeCardLineage
          newCardStyle={newCardStyle}
          showLineageChildChip={showLineageChildChip}
          lineageChildAriaLabel={lineageChildAriaLabel}
          lineageCollapsed={lineageCollapsed}
          onLineageToggle={onLineageToggle}
          childWorkspaceShortLabel={childWorkspaceShortLabel}
          lineageChildren={lineageChildren}
        />
      </div>
    </div>
  )
}
