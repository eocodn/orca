import React from 'react'
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Clipboard, GitBranch, Link, LoaderCircle, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LinearIcon } from '@/components/icons/LinearIcon'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { LinearIssueTextEditor } from '@/components/LinearIssueTextEditor'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { LinearIssueEditSection, type LinearEditState } from '@/components/LinearItemDrawer'
import { LinearIssueCommentFooter, type LinearLocalComment } from '@/components/linear-issue-comment-footer'
import { LinearIssueSidebarProjectCard } from './linear-issue-sidebar-project-card'
import { buildLinearIssueContextSnapshot } from '@/lib/linear-issue-context-snapshot'
import { buildContainedLinkedContextBlock } from '@/lib/linked-work-item-context'
import { buildLinearIssueBranchName, formatLinearIssueRelativeTime } from '@/components/linear-issue-workspace-text'
import type { LinearComment, LinearIssue, LinearProjectSummary } from '../../../shared/types'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import { translate } from '@/i18n/i18n'

type WorkspaceAvatar = React.ComponentType<{ avatarUrl?: string; name?: string; className?: string }>
type SubIssueButton = React.ComponentType<{ issue: LinearIssue; onOpenIssue: (issue: LinearIssue) => void; sourceContext?: TaskSourceContext | null }>
type ActionItem = { label: string; icon: React.ComponentType<{ className?: string }>; action: () => void }

type Props = {
  displayed: LinearIssue | null
  variant: 'sheet' | 'page'
  backLabel: string
  issueLoading: boolean
  onClose: () => void
  onUseIssue: () => void
  onOpenIssue: (issue: LinearIssue) => void
  sourceContext?: TaskSourceContext | null
  handleIssueTextChange: (patch: Partial<Pick<LinearIssue, 'title' | 'description'>>) => void
  SubIssueButton: SubIssueButton
  IssueAvatar: WorkspaceAvatar
  commentsError: string | null
  loadComments: (issue: LinearIssue, requestId: number) => void
  requestIdRef: React.MutableRefObject<number>
  commentsLoading: boolean
  comments: LinearComment[]
  handleCommentAdded: (comment: LinearLocalComment) => void
  editState: LinearEditState | null
  handleEditStateChange: (patch: Partial<LinearEditState>) => void
  handleProjectChanged: (project: LinearProjectSummary) => void
  actionItems: ActionItem[]
}

export function LinearIssueWorkspaceContent({
  displayed,
  variant,
  backLabel,
  issueLoading,
  onClose,
  onUseIssue,
  onOpenIssue,
  sourceContext,
  handleIssueTextChange,
  SubIssueButton,
  IssueAvatar,
  commentsError,
  loadComments,
  requestIdRef,
  commentsLoading,
  comments,
  handleCommentAdded,
  editState,
  handleEditStateChange,
  handleProjectChanged,
  actionItems
}: Props): React.JSX.Element | null {
  return displayed ? (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex h-[61px] flex-none items-center justify-between gap-4 border-b border-border/60 px-5">
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          {variant === 'page' ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="-ml-2 shrink-0 gap-1.5"
              aria-label={backLabel}
            >
              <ChevronLeft className="size-4" />
              {backLabel}
            </Button>
          ) : null}
          <LinearIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-foreground">
            {displayed.workspaceName ??
              translate('auto.components.LinearIssueWorkspace.65239a714b', 'Linear')}
          </span>
          <ChevronRight className="size-3.5 shrink-0" />
          <span className="shrink-0">
            {translate('auto.components.LinearIssueWorkspace.f63ef94ea8', 'Issues')}
          </span>
          <ChevronRight className="size-3.5 shrink-0" />
          <span className="shrink-0 font-mono">{displayed.identifier}</span>
          <span className="min-w-0 truncate font-medium text-foreground">{displayed.title}</span>
          {issueLoading ? <LoaderCircle className="size-3.5 shrink-0 animate-spin" /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="hidden px-2 text-sm text-muted-foreground md:inline">2 / 17</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void copyTextToClipboard(displayed.url, 'URL')}
                aria-label={translate(
                  'auto.components.LinearIssueWorkspace.97c19a84f1',
                  'Copy Linear URL'
                )}
              >
                <Link className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.components.LinearIssueWorkspace.9a9a884236', 'Copy URL')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void copyTextToClipboard(displayed.identifier, 'Identifier')}
                aria-label={translate(
                  'auto.components.LinearIssueWorkspace.9e3c49beb8',
                  'Copy issue identifier'
                )}
              >
                <Clipboard className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.components.LinearIssueWorkspace.30c1242f3a', 'Copy identifier')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleUseIssue}
                aria-label={translate(
                  'auto.components.LinearIssueWorkspace.30a7f56c0a',
                  'Start workspace from issue'
                )}
              >
                <ArrowRight className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.components.LinearIssueWorkspace.e1e0a9bca9', 'Start workspace')}
            </TooltipContent>
          </Tooltip>
          {variant === 'sheet' ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onClose}
                  aria-label={translate(
                    'auto.components.LinearIssueWorkspace.7a4997d8bb',
                    'Close Linear issue preview'
                  )}
                >
                  <X className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {translate('auto.components.LinearIssueWorkspace.df4c86ed12', 'Close')}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
        <div className="mx-auto grid w-full grid-cols-1 gap-10 px-7 py-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-10 xl:px-12">
          <main className="min-w-0">
            <LinearIssueTextEditor
              issue={displayed}
              onIssueChange={handleIssueTextChange}
              sourceContext={sourceContext}
            />

            <SubIssueButton
              issue={displayed}
              onOpenIssue={onOpenIssue}
              sourceContext={sourceContext}
            />

            <section className="mt-12 border-t border-border/60 pt-9">
              <div className="mb-8 flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-foreground">
                  {translate('auto.components.LinearIssueWorkspace.543970c87a', 'Activity')}
                </h2>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <IssueAvatar
                    avatarUrl={displayed.assignee?.avatarUrl}
                    name={displayed.assignee?.displayName}
                    className="size-6"
                  />
                </div>
              </div>

              <div className="mb-7 flex items-center gap-3 text-sm text-muted-foreground">
                <IssueAvatar
                  avatarUrl={displayed.assignee?.avatarUrl}
                  name={displayed.assignee?.displayName}
                  className="size-5"
                />
                <span>
                  {displayed.assignee?.displayName ??
                    translate('auto.components.LinearIssueWorkspace.8a33c85e9c', 'Someone')}{' '}
                  {translate(
                    'auto.components.LinearIssueWorkspace.fabbd3f974',
                    'updated the issue ·'
                  )}{' '}
                  {formatLinearIssueRelativeTime(displayed.updatedAt)}
                </span>
              </div>

              {commentsError ? (
                <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <span>{commentsError}</span>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => void loadComments(displayed, requestIdRef.current)}
                    disabled={commentsLoading}
                    className="gap-1"
                  >
                    {commentsLoading ? (
                      <LoaderCircle className="size-3 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3" />
                    )}
                    {translate('auto.components.LinearIssueWorkspace.b0eac92d85', 'Retry')}
                  </Button>
                </div>
              ) : null}

              {commentsLoading && comments.length === 0 ? (
                <div className="mb-5 flex items-center justify-center py-8">
                  <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : comments.length > 0 ? (
                <div className="mb-6 flex flex-col gap-5">
                  {comments.map((comment) => (
                    <article key={comment.id} className="flex gap-3">
                      <IssueAvatar
                        avatarUrl={comment.user?.avatarUrl}
                        name={comment.user?.displayName}
                        className="size-7"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex min-w-0 items-center gap-2 text-sm">
                          <span className="truncate font-semibold text-foreground">
                            {comment.user?.displayName ??
                              translate(
                                'auto.components.LinearIssueWorkspace.ca8778c124',
                                'Unknown'
                              )}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {formatLinearIssueRelativeTime(comment.createdAt)}
                          </span>
                        </div>
                        <div className="rounded-lg border border-border/60 bg-card px-4 py-3">
                          <CommentMarkdown
                            content={comment.body}
                            className="text-[14px] leading-7"
                          />
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}

              <LinearIssueCommentFooter
                issueId={displayed.id}
                workspaceId={displayed.workspaceId}
                onCommentAdded={handleCommentAdded}
                variant="linear-page"
                sourceContext={sourceContext}
              />
            </section>
          </main>

          <aside className="space-y-3 lg:sticky lg:top-6 lg:self-start">
            {editState ? (
              <LinearIssueEditSection
                issue={displayed}
                editState={editState}
                onEditStateChange={handleEditStateChange}
                layout="properties"
                sourceContext={sourceContext}
              />
            ) : null}
            <LinearIssueSidebarProjectCard
              issue={displayed}
              onProjectChanged={handleProjectChanged}
              sourceContext={sourceContext}
            />
            <section className="rounded-xl border border-border/60 bg-card text-card-foreground shadow-xs">
              <div className="flex h-10 items-center gap-1 border-b border-border/50 px-4 text-sm font-medium text-muted-foreground">
                <span>
                  {translate('auto.components.LinearIssueWorkspace.c23e79e5c0', 'Actions')}
                </span>
                <ChevronDown className="size-3.5" />
              </div>
              <div className="space-y-1 p-3">
                {actionItems.map((item) => {
                  const Icon = item.icon
                  return (
                    <Tooltip key={item.label}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={item.action}
                          className="flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          <Icon className="size-4 shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left" sideOffset={6}>
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  ) : null
}
