import React from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleDashed,
  CircleDot,
  Copy,
  ExternalLink,
  FolderKanban,
  GitPullRequest,
  Plus
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { formatGitHubWorkItemRelativeTime as formatRelativeTime } from '@/components/github-work-item-display'
import { WorkItemStateBadge } from './github-item-dialog-model'
import { WorkItemIssueSourceIndicator } from './github-item-dialog-source-indicator'
import type { GitHubItemDialogContentProps } from './github-item-dialog-content-props'

type GitHubItemDialogHeaderProps = Pick<
  GitHubItemDialogContentProps,
  | 'workItem'
  | 'isIssuePage'
  | 'ownerRepo'
  | 'issueStateBadgeTone'
  | 'localState'
  | 'linkCopied'
  | 'backLabel'
  | 'issueAttachedWorkspace'
  | 'issueAttachedWorkspaceLabel'
  | 'effectiveRepoId'
  | 'repoPath'
  | 'setLinkCopyButtonRef'
  | 'handleCopyWorkItemLink'
  | 'handleOpenOrUseIssueWorkspace'
  | 'onUse'
  | 'onClose'
>

export function GitHubItemDialogHeader({
  workItem,
  isIssuePage,
  ownerRepo,
  issueStateBadgeTone,
  localState,
  linkCopied,
  backLabel,
  issueAttachedWorkspace,
  issueAttachedWorkspaceLabel,
  effectiveRepoId,
  repoPath,
  setLinkCopyButtonRef,
  handleCopyWorkItemLink,
  handleOpenOrUseIssueWorkspace,
  onUse,
  onClose
}: GitHubItemDialogHeaderProps): React.JSX.Element {
  const Icon = workItem.type === 'pr' ? GitPullRequest : CircleDot

  return (
    <>
      {isIssuePage ? (
        <>
          {/* Row 1: breadcrumb-style strip mirroring GitHub's canvas-subtle header */}
          <div className="flex-none border-b border-border/60 bg-muted/30 px-6 py-2.5">
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="-ml-2 h-7 gap-1 px-2 text-muted-foreground hover:text-foreground"
                aria-label={backLabel}
              >
                <ChevronLeft className="size-4" />
                {backLabel}
              </Button>
              <span className="text-border">·</span>
              {ownerRepo ? (
                <>
                  <span className="truncate">
                    <span className="text-muted-foreground">{ownerRepo.owner}</span>
                    <span className="mx-1 text-muted-foreground/60">/</span>
                    <span className="font-medium text-foreground">{ownerRepo.repo}</span>
                  </span>
                  <span className="text-muted-foreground/60">·</span>
                </>
              ) : null}
              <span className="font-mono text-muted-foreground">#{workItem.number}</span>
              <div className="ml-auto flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      ref={setLinkCopyButtonRef}
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void handleCopyWorkItemLink()}
                      aria-label={translate(
                        'auto.components.GitHubItemDialog.c43fe79ee0',
                        'Copy GitHub link'
                      )}
                    >
                      {linkCopied ? (
                        <Check className="size-4 text-emerald-500" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6}>
                    {linkCopied
                      ? translate('auto.components.GitHubItemDialog.038b3d39b1', 'Copied')
                      : translate(
                          'auto.components.GitHubItemDialog.c43fe79ee0',
                          'Copy GitHub link'
                        )}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => window.api.shell.openUrl(workItem.url)}
                      aria-label={translate(
                        'auto.components.GitHubItemDialog.3fdf777817',
                        'Open on GitHub'
                      )}
                    >
                      <ExternalLink className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6}>
                    {translate('auto.components.GitHubItemDialog.3fdf777817', 'Open on GitHub')}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>

          {/* Row 2: large title block */}
          <div className="flex-none border-b border-border/60 bg-card px-6 py-4">
            <div className="flex items-start gap-4">
              <h1 className="min-w-0 flex-1 text-[28px] font-medium leading-tight text-foreground">
                <span className="break-words">{workItem.title}</span>
                <span className="ml-2 font-light text-muted-foreground">#{workItem.number}</span>
              </h1>
              <div className="flex shrink-0 items-center gap-2">
                {/* Why: Orca's signature affordance — keep primary so it stands out against GitHub's familiar surface. */}
                {issueAttachedWorkspace ? (
                  <DropdownMenu modal={false}>
                    <ButtonGroup>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleOpenOrUseIssueWorkspace(workItem)}
                        className="gap-1.5 whitespace-nowrap"
                        aria-label={translate(
                          'auto.components.GitHubItemDialog.84855fedd0',
                          'Open workspace attached to issue'
                        )}
                      >
                        {translate('auto.components.GitHubItemDialog.726db41722', 'Open workspace')}
                        <ArrowRight className="size-3.5" />
                      </Button>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="icon-sm"
                          aria-label={translate(
                            'auto.components.GitHubItemDialog.fe6ff12dc2',
                            'More issue workspace actions'
                          )}
                        >
                          <ChevronDown className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                    </ButtonGroup>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onUse(workItem)}>
                        <Plus className="size-4" />
                        {translate(
                          'auto.components.GitHubItemDialog.36182aa57f',
                          'Start new workspace'
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => window.api.shell.openUrl(workItem.url)}>
                        <ExternalLink className="size-4" />
                        {translate('auto.components.GitHubItemDialog.3fdf777817', 'Open on GitHub')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onUse(workItem)}
                    className="gap-1.5 whitespace-nowrap"
                    aria-label={translate(
                      'auto.components.GitHubItemDialog.0ab4664a8b',
                      'Start workspace from issue'
                    )}
                  >
                    {translate(
                      'auto.components.GitHubItemDialog.0ab4664a8b',
                      'Start workspace from issue'
                    )}
                    <ArrowRight className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium',
                  issueStateBadgeTone
                )}
              >
                {localState === 'closed' ? (
                  <CircleDashed className="size-3.5" />
                ) : (
                  <CircleDot className="size-3.5" />
                )}
                {localState === 'closed'
                  ? translate('auto.components.GitHubItemDialog.ab050dffec', 'Closed')
                  : translate('auto.components.GitHubItemDialog.dc1ca081a8', 'Open')}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-foreground">
                  {workItem.author ??
                    translate('auto.components.GitHubItemDialog.773ff70035', 'unknown')}
                </span>
                <span>
                  {translate('auto.components.GitHubItemDialog.55962099bc', 'opened this issue')}
                </span>
                <span className="text-muted-foreground/80">
                  {translate('auto.components.GitHubItemDialog.10ef1afb8e', '· updated')}
                  {formatRelativeTime(workItem.updatedAt)}
                </span>
              </span>
              <WorkItemIssueSourceIndicator
                url={workItem.url}
                repoId={effectiveRepoId}
                repoPath={repoPath}
              />
              {issueAttachedWorkspaceLabel ? (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <FolderKanban className="size-3.5 shrink-0" />
                  <span className="truncate">{issueAttachedWorkspaceLabel}</span>
                </span>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-none border-b border-border/60 bg-card/80 px-4 py-3 shadow-xs backdrop-blur supports-[backdrop-filter]:bg-card/70">
          <div className="flex items-start gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="-ml-1 mt-0.5 shrink-0 gap-1.5"
              aria-label={backLabel}
            >
              <ChevronLeft className="size-4" />
              {backLabel}
            </Button>
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground">
              <Icon className="size-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <WorkItemStateBadge item={{ ...workItem, state: localState }} />
                <span className="font-mono">#{workItem.number}</span>
                <span>
                  {workItem.type === 'pr'
                    ? translate('auto.components.GitHubItemDialog.a2495e4784', 'Pull request')
                    : translate('auto.components.GitHubItemDialog.3e544d966d', 'Issue')}
                </span>
              </div>
              <h2 className="text-[15px] font-semibold leading-snug text-foreground">
                {workItem.title}
              </h2>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                <span>
                  {workItem.author ??
                    translate('auto.components.GitHubItemDialog.773ff70035', 'unknown')}
                </span>
                <span>
                  {translate('auto.components.GitHubItemDialog.8223320f8d', 'updated')}
                  {formatRelativeTime(workItem.updatedAt)}
                </span>
                {workItem.branchName && (
                  <span className="max-w-full truncate rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {workItem.branchName}
                  </span>
                )}
                {issueAttachedWorkspaceLabel ? (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <FolderKanban className="size-3 shrink-0" />
                    <span className="truncate">{issueAttachedWorkspaceLabel}</span>
                  </span>
                ) : null}
              </div>
              {workItem.type === 'issue' && (
                <WorkItemIssueSourceIndicator
                  url={workItem.url}
                  repoId={effectiveRepoId}
                  repoPath={repoPath}
                />
              )}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-1">
              {workItem.type === 'pr' && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onUse(workItem)}
                  className="gap-1.5 whitespace-nowrap"
                  aria-label={translate(
                    'auto.components.GitHubItemDialog.0caac1a18f',
                    'Start workspace from PR'
                  )}
                >
                  {translate(
                    'auto.components.GitHubItemDialog.0caac1a18f',
                    'Start workspace from PR'
                  )}
                  <ArrowRight className="size-3.5" />
                </Button>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    ref={setLinkCopyButtonRef}
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void handleCopyWorkItemLink()}
                    aria-label={translate(
                      'auto.components.GitHubItemDialog.c43fe79ee0',
                      'Copy GitHub link'
                    )}
                  >
                    {linkCopied ? (
                      <Check className="size-4 text-emerald-500" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  {linkCopied
                    ? translate('auto.components.GitHubItemDialog.038b3d39b1', 'Copied')
                    : translate('auto.components.GitHubItemDialog.c43fe79ee0', 'Copy GitHub link')}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => window.api.shell.openUrl(workItem.url)}
                    aria-label={translate(
                      'auto.components.GitHubItemDialog.3fdf777817',
                      'Open on GitHub'
                    )}
                  >
                    <ExternalLink className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  {translate('auto.components.GitHubItemDialog.3fdf777817', 'Open on GitHub')}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
