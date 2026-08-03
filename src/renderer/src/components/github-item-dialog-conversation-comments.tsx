import React from 'react'
import { ExternalLink, MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import {
  getPRCommentGroupCount,
  getPRCommentGroupId,
  getPRCommentGroupRoot,
  isResolvedPRCommentGroup,
  PR_COMMENT_OPEN_AUTHOR_CLASS,
  PR_COMMENT_RESOLVED_AUTHOR_CLASS,
  PR_COMMENT_RESOLVED_CONTAINER_CLASS,
  type PRCommentGroup
} from '@/lib/pr-comment-groups'
import { CommentReactions, CommentReplyForm } from './github-item-dialog-comments'
import { CommentCodeContext } from './github-item-dialog-conversation-code-context'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type {
  GitHubOwnerRepo,
  GitHubPRFile,
  GitHubWorkItem,
  PRComment
} from '../../../shared/types'

type CommentCardProps = {
  comment: PRComment
  isReply?: boolean
  item: Pick<GitHubWorkItem, 'repoId' | 'number' | 'type'>
  repoPath: string | null
  sourceContext?: TaskSourceContext | null
  prRepo: GitHubOwnerRepo | null
  files: GitHubPRFile[]
  headSha: string | undefined
  baseSha: string | undefined
  markdownGitHubRepo: GitHubOwnerRepo | null
  isReplying: boolean
  onToggleReply: () => void
  onCancelReply: () => void
  onReply: (comment: PRComment, body: string) => Promise<boolean>
}

export function CommentCard({
  comment,
  isReply = false,
  item,
  repoPath,
  sourceContext,
  prRepo,
  files,
  headSha,
  baseSha,
  markdownGitHubRepo,
  isReplying,
  onToggleReply,
  onCancelReply,
  onReply
}: CommentCardProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'min-w-0 overflow-hidden rounded-lg border border-border/40 bg-card/50 shadow-xs',
        isReply && 'ml-6 max-w-[calc(100%-1.5rem)]',
        comment.isResolved && PR_COMMENT_RESOLVED_CONTAINER_CLASS
      )}
    >
      <div className="flex min-w-0 items-center gap-2 border-b border-border/40 px-3 py-2">
        {comment.authorAvatarUrl ? (
          <img
            src={comment.authorAvatarUrl}
            alt={comment.author}
            className="size-5 shrink-0 rounded-full"
          />
        ) : (
          <div className="size-5 shrink-0 rounded-full bg-muted" />
        )}
        <span
          className={cn(
            'min-w-0 truncate text-[13px] font-semibold',
            comment.isResolved ? PR_COMMENT_RESOLVED_AUTHOR_CLASS : PR_COMMENT_OPEN_AUTHOR_CLASS
          )}
        >
          {comment.author}
        </span>
        <span className="shrink-0 text-[12px] text-muted-foreground">
          · {formatRelativeTime(comment.createdAt)}
        </span>
        {comment.path && (
          <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/70">
            {comment.path.split('/').pop()}
            {comment.line
              ? translate('auto.components.GitHubItemDialog.136542c9ba', ':L{{value0}}', {
                  value0: comment.line
                })
              : ''}
          </span>
        )}
        {comment.isResolved && (
          <span className="rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {translate('auto.components.GitHubItemDialog.68cb993d61', 'resolved')}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-7"
                onClick={onToggleReply}
                aria-label={translate(
                  'auto.components.GitHubItemDialog.bca8eb39ac',
                  'Reply to comment'
                )}
              >
                <MessageSquarePlus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {translate('auto.components.GitHubItemDialog.bca8eb39ac', 'Reply to comment')}
            </TooltipContent>
          </Tooltip>
          {comment.url && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-7"
                  onClick={() => window.api.shell.openUrl(comment.url)}
                  aria-label={translate(
                    'auto.components.GitHubItemDialog.a154ec5224',
                    'Open comment on GitHub'
                  )}
                >
                  <ExternalLink className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {translate('auto.components.GitHubItemDialog.a154ec5224', 'Open comment on GitHub')}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="min-w-0 px-3 py-2">
        <CommentCodeContext
          comment={comment}
          repoPath={repoPath}
          repoId={item.repoId}
          sourceContext={sourceContext}
          prNumber={item.number}
          prRepo={prRepo}
          files={files}
          headSha={headSha}
          baseSha={baseSha}
        />
        <CommentMarkdown
          content={comment.body}
          variant="document"
          githubRepo={markdownGitHubRepo}
          className="min-w-0 max-w-full overflow-hidden break-words text-[13px] leading-relaxed [&_a]:break-all [&_code]:break-words [&_pre]:max-w-full"
        />
        <CommentReactions reactions={comment.reactions} />
        {isReplying && (
          <CommentReplyForm
            className="mt-3"
            placeholder={
              comment.path
                ? translate(
                    'auto.components.GitHubItemDialog.86f809e2ce',
                    'Reply in this review thread'
                  )
                : translate('auto.components.GitHubItemDialog.080d071d48', 'Reply to @{{value0}}', {
                    value0: comment.author
                  })
            }
            onCancel={onCancelReply}
            onSubmit={(body) => onReply(comment, body)}
          />
        )}
      </div>
    </div>
  )
}

type CommentGroupProps = Omit<
  CommentCardProps,
  'comment' | 'isReply' | 'isReplying' | 'onToggleReply'
> & {
  group: PRCommentGroup
  replyingTo: number | null
  onToggleReply: (comment: PRComment) => void
}

export function CommentGroup({
  group,
  replyingTo,
  onToggleReply,
  ...cardProps
}: CommentGroupProps): React.JSX.Element {
  const renderCard = (comment: PRComment, isReply = false): React.JSX.Element => (
    <CommentCard
      key={comment.id}
      comment={comment}
      isReply={isReply}
      isReplying={replyingTo === comment.id}
      onToggleReply={() => onToggleReply(comment)}
      {...cardProps}
    />
  )
  const cards =
    group.kind === 'thread'
      ? [renderCard(group.root), ...group.replies.map((reply) => renderCard(reply, true))]
      : [renderCard(group.comment)]

  if (!isResolvedPRCommentGroup(group)) {
    return (
      <div key={getPRCommentGroupId(group)} className="flex min-w-0 flex-col gap-3">
        {cards}
      </div>
    )
  }

  const root = getPRCommentGroupRoot(group)
  const count = getPRCommentGroupCount(group)
  return (
    <Accordion key={getPRCommentGroupId(group)} type="single" collapsible>
      <AccordionItem
        value={getPRCommentGroupId(group)}
        className="rounded-lg border border-border/40 bg-card/40"
      >
        <AccordionTrigger className="px-3 py-2 text-[13px] text-muted-foreground hover:bg-accent/30">
          <span className="min-w-0 truncate">
            {translate('auto.components.GitHubItemDialog.228e2f59d3', 'Resolved')}{' '}
            {group.kind === 'thread'
              ? translate('auto.components.GitHubItemDialog.28d0d3374f', 'thread')
              : translate('auto.components.GitHubItemDialog.e2bf3e41a9', 'comment')}{' '}
            {translate('auto.components.GitHubItemDialog.0ae387d8ca', 'by')} {root.author}
            {count > 1 ? ` (${count})` : ''}
          </span>
        </AccordionTrigger>
        <AccordionContent className="flex min-w-0 flex-col gap-3 px-3 pb-3 pt-0">
          {cards}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

function formatRelativeTime(input: string): string {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) {
    return 'recently'
  }
  const diffMinutes = Math.round((date.getTime() - Date.now()) / 60_000)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, 'minute')
  }
  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, 'hour')
  }
  return formatter.format(Math.round(diffHours / 24), 'day')
}
