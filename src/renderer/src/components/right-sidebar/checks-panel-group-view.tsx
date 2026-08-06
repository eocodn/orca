import React from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PRCommentGroupActionState } from '@/lib/pr-comment-action-state'
import type { PRCommentGroup } from '@/lib/pr-comment-groups'
import {
  getPRCommentGroupSurfaceClasses,
  type PRCommentPresentationClasses
} from './pr-comment-presentation'
import { CommentRow } from './checks-panel-comment-groups'
import { RightPanelCommentComposer } from './right-panel-comment-composer'
import { translate } from '@/i18n/i18n'
import type { PRComment } from '../../../../shared/types'
import type { RightPanelCommentSubmitResult } from './right-panel-comment-composer'

export function PRCommentGroupView({
  group,
  botAuthorOverrides,
  replyingCommentId,
  selectionControl,
  actionState,
  isQueued,
  replyDisabled,
  replyDisabledReason,
  presentation,
  onResolve,
  onStartReply,
  onCancelReply,
  onReply,
  onEditComment,
  onDeleteComment,
  onQueueForAgent
}: {
  group: PRCommentGroup
  botAuthorOverrides: ReadonlySet<string>
  replyingCommentId: number | null
  selectionControl?: React.ReactNode
  actionState: PRCommentGroupActionState
  isQueued: boolean
  replyDisabled?: boolean
  replyDisabledReason?: string
  presentation: PRCommentPresentationClasses
  onResolve?: (threadId: string, resolve: boolean) => boolean | Promise<boolean>
  onStartReply?: (commentId: number) => void
  onCancelReply?: (commentId: number) => void
  onReply?: (comment: PRComment, body: string) => Promise<RightPanelCommentSubmitResult>
  onEditComment?: (comment: PRComment, body: string) => Promise<boolean>
  onDeleteComment?: (comment: PRComment) => void | Promise<void>
  onQueueForAgent?: () => void
}): React.JSX.Element {
  // Reply targets a specific comment id so any comment in a thread — root or
  // nested reply — can be replied to, not just the thread root.
  const renderReplyComposer = (comment: PRComment): React.ReactNode =>
    replyingCommentId === comment.id && onReply ? (
      <div className={cn('px-3 pb-2', group.kind === 'thread' && 'pl-6')}>
        <RightPanelCommentComposer
          placeholder={translate(
            'auto.components.right.sidebar.checks.panel.content.ba20d1a896',
            'Reply to {{value0}}',
            { value0: comment.author }
          )}
          submitLabel="Reply"
          autoFocus
          disabled={replyDisabled}
          disabledReason={replyDisabledReason}
          onCancel={() => onCancelReply?.(comment.id)}
          onSubmit={(body) => onReply(comment, body)}
        />
      </div>
    ) : null
  const startReply = onStartReply ? (comment: PRComment) => onStartReply(comment.id) : undefined
  const surfaceClassName = cn(
    getPRCommentGroupSurfaceClasses(presentation, actionState, {
      queued: isQueued
    }),
    group.kind === 'standalone' ? presentation.groupStandalone : presentation.groupThread
  )
  const sharedRowProps = {
    botAuthorOverrides,
    actionState,
    isQueued,
    replyDisabled,
    replyDisabledReason,
    presentation,
    onResolve,
    onEditComment,
    onDeleteComment,
    onQueueForAgent
  }

  const content =
    group.kind === 'standalone' ? (
      <div className={surfaceClassName} data-testid="pr-comment-group">
        <CommentRow
          comment={group.comment}
          isReply={false}
          showResolve={false}
          showReply={Boolean(onReply)}
          selectionControl={selectionControl}
          onReply={startReply}
          {...sharedRowProps}
        />
        {renderReplyComposer(group.comment)}
      </div>
    ) : (
      <div className={surfaceClassName} data-testid="pr-comment-group">
        <CommentRow
          comment={group.root}
          isReply={false}
          showResolve={true}
          showReply={Boolean(onReply)}
          selectionControl={selectionControl}
          onReply={startReply}
          {...sharedRowProps}
        />
        {renderReplyComposer(group.root)}
        {group.replies.length > 0 && (
          <div className={presentation.repliesContainer}>
            {group.replies.map((reply) => (
              <React.Fragment key={reply.id}>
                <CommentRow
                  {...sharedRowProps}
                  comment={reply}
                  isReply={true}
                  showResolve={false}
                  showReply={Boolean(onReply)}
                  isQueued={false}
                  onReply={startReply}
                />
                {renderReplyComposer(reply)}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    )

  if (!onQueueForAgent) {
    return content
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onQueueForAgent()}>
          <Sparkles />
          {translate(
            'auto.components.right.sidebar.checks.panel.content.f8a2c91d04',
            'Queue for agent'
          )}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
