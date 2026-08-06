import React from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Button } from '@/components/ui/button'
import { Sparkles } from 'lucide-react'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { cn } from '@/lib/utils'
import { formatPrCommentRelativeTime } from '@/lib/pr-comment-time'
import { getPRCommentGroupId, type PRCommentGroup } from '@/lib/pr-comment-groups'
import type { PRCommentGroupActionState } from '@/lib/pr-comment-action-state'
import {
  getPRCommentGroupSurfaceClasses,
  type PRCommentPresentationClasses
} from './pr-comment-presentation'
import { RightPanelCommentComposer } from './right-panel-comment-composer'
import {
  CommentMoreMenu,
  CopyButton,
  PRCommentActionBadge,
  QueueForAgentButton,
  ResolveButton,
  buildCopyText
} from './checks-panel-comment-actions'
import { translate } from '@/i18n/i18n'
import type { PRComment } from '../../../../shared/types'

/** A single comment row — used for both root and reply comments. */
export function CommentRow({
  comment,
  botAuthorOverrides,
  isReply,
  showResolve,
  showReply,
  selectionControl,
  actionState,
  isQueued,
  replyDisabled,
  replyDisabledReason,
  presentation,
  onResolve,
  onReply,
  onEditComment,
  onDeleteComment,
  onQueueForAgent
}: {
  comment: PRComment
  botAuthorOverrides: ReadonlySet<string>
  isReply: boolean
  showResolve: boolean
  showReply?: boolean
  selectionControl?: React.ReactNode
  actionState: PRCommentGroupActionState
  isQueued: boolean
  replyDisabled?: boolean
  replyDisabledReason?: string
  presentation: PRCommentPresentationClasses
  onResolve?: (threadId: string, resolve: boolean) => boolean | Promise<boolean>
  onReply?: (comment: PRComment) => void
  onEditComment?: (comment: PRComment, body: string) => Promise<boolean>
  onDeleteComment?: (comment: PRComment) => void | Promise<void>
  onQueueForAgent?: () => void
}): React.JSX.Element {
  const automated = isBotPRComment(comment, botAuthorOverrides)
  const canMutateComment = isMutablePRConversationComment(comment)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const [submittingEdit, setSubmittingEdit] = useState(false)

  useEffect(() => {
    if (!editing) {
      setDraft(comment.body)
    }
  }, [comment.body, editing])

  const handleStartEdit = useCallback((): void => {
    setDraft(comment.body)
    setEditing(true)
  }, [comment.body])

  const handleCancelEdit = useCallback(
    (event: React.MouseEvent): void => {
      event.stopPropagation()
      setEditing(false)
      setDraft(comment.body)
    },
    [comment.body]
  )

  const handleSaveEdit = useCallback(
    async (event: React.MouseEvent): Promise<void> => {
      event.stopPropagation()
      const trimmedDraft = draft.trim()
      if (!onEditComment || !trimmedDraft || trimmedDraft === comment.body) {
        setEditing(false)
        return
      }
      setSubmittingEdit(true)
      try {
        const ok = await onEditComment(comment, trimmedDraft)
        if (ok) {
          setEditing(false)
        }
      } finally {
        setSubmittingEdit(false)
      }
    },
    [comment, draft, onEditComment]
  )

  const handleDelete = useCallback((): void => {
    void onDeleteComment?.(comment)
  }, [comment, onDeleteComment])

  const trimmedDraft = draft.trim()
  const canSaveEdit = !submittingEdit && trimmedDraft.length > 0 && trimmedDraft !== comment.body
  const relativeTime = formatPrCommentRelativeTime(comment.createdAt, Date.now())

  const authorAvatar = comment.authorAvatarUrl ? (
    <img
      src={comment.authorAvatarUrl}
      alt={comment.author}
      className={cn(isReply ? presentation.avatarReply : presentation.avatar)}
    />
  ) : (
    <div className={cn(isReply ? presentation.avatarReply : presentation.avatar)} aria-hidden />
  )

  const authorName = (
    <span className={cn(presentation.author, comment.isResolved && presentation.authorResolved)}>
      {comment.author}
    </span>
  )
  const queueButton =
    !isReply && onQueueForAgent ? <QueueForAgentButton onQueueForAgent={onQueueForAgent} /> : null

  const hoverActions = !editing ? (
    <div className="flex items-center gap-0.5 can-hover:opacity-0 group-hover/comment:opacity-100 transition-opacity">
      {showResolve &&
        comment.threadId != null &&
        onResolve &&
        (actionState === 'open' || actionState === 'resolved') && (
          <ResolveButton
            threadId={comment.threadId}
            isResolved={comment.isResolved ?? false}
            onResolve={onResolve}
          />
        )}
      {showReply && onReply && (
        <button
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          title={
            replyDisabled
              ? replyDisabledReason
              : translate('auto.components.right.sidebar.checks.panel.content.c1f6fc006a', 'Reply')
          }
          disabled={replyDisabled}
          onClick={(event) => {
            event.stopPropagation()
            onReply(comment)
          }}
        >
          {translate('auto.components.right.sidebar.checks.panel.content.c1f6fc006a', 'Reply')}
        </button>
      )}
      <CopyButton text={buildCopyText(comment)} />
      <CommentMoreMenu
        comment={comment}
        botAuthorOverrides={botAuthorOverrides}
        onStartEdit={canMutateComment && onEditComment ? handleStartEdit : undefined}
        onDelete={canMutateComment && onDeleteComment ? handleDelete : undefined}
        onQueueForAgent={!isReply ? onQueueForAgent : undefined}
      />
    </div>
  ) : null

  const commentActions = !editing ? (
    <div className="flex shrink-0 items-center gap-0.5">
      {presentation.useCardLayout ? null : queueButton}
      {hoverActions}
    </div>
  ) : null

  const cardMetaRow =
    presentation.useCardLayout && !isReply ? (
      <div
        className={
          selectionControl
            ? presentation.commentHeaderMetaWithSelection
            : presentation.commentHeaderMeta
        }
      >
        {relativeTime ? <span>{relativeTime}</span> : null}
        {automated ? (
          <span className={presentation.botBadge}>
            {translate('auto.components.right.sidebar.checks.panel.content.2ba0a32bdd', 'bot')}
          </span>
        ) : null}
        {comment.path ? (
          <span className={presentation.pathBadge} title={comment.path}>
            {comment.path.split('/').pop()}
            {formatLineRange(comment) && `:${formatLineRange(comment)}`}
          </span>
        ) : null}
        <PRCommentActionBadge
          actionState={actionState}
          isQueued={isQueued}
          presentation={presentation}
        />
        {onQueueForAgent ? (
          <QueueForAgentButton
            className="ml-auto can-hover:opacity-0 group-hover/comment:opacity-100 group-focus-within/comment:opacity-100"
            onQueueForAgent={onQueueForAgent}
          />
        ) : null}
      </div>
    ) : null

  const authorLine =
    presentation.useCardLayout && !isReply ? (
      <>
        <div className={presentation.commentHeaderPrimary}>
          {selectionControl}
          {authorAvatar}
          {authorName}
          {commentActions}
        </div>
        {cardMetaRow}
      </>
    ) : (
      <>
        {selectionControl}
        {authorAvatar}
        {authorName}
        {relativeTime ? (
          <span className={presentation.time} aria-hidden={presentation.time === 'hidden'}>
            {presentation.useCardLayout ? `· ${relativeTime}` : relativeTime}
          </span>
        ) : null}
        {automated && (
          <span className={presentation.botBadge}>
            {translate('auto.components.right.sidebar.checks.panel.content.2ba0a32bdd', 'bot')}
          </span>
        )}
        {!isReply && comment.path && (
          <span className={presentation.pathBadge}>
            {comment.path.split('/').pop()}
            {formatLineRange(comment) && `:${formatLineRange(comment)}`}
          </span>
        )}
        {!isReply ? (
          <PRCommentActionBadge
            actionState={actionState}
            isQueued={isQueued}
            presentation={presentation}
          />
        ) : null}
        <div className="flex-1" />
        {commentActions}
      </>
    )

  return (
    <div
      className={cn(
        'group/comment min-w-0',
        presentation.commentRow,
        isReply && presentation.commentRowReply,
        comment.isResolved && presentation.resolvedContainer
      )}
    >
      <div className="min-w-0">
        <div
          className={cn(
            isReply && presentation.useCardLayout
              ? presentation.commentHeaderReply
              : presentation.commentHeader
          )}
        >
          {authorLine}
        </div>
        {editing ? (
          <div
            className={cn(
              'mt-1 flex flex-col gap-1.5',
              presentation.useCardLayout ? 'px-3 pb-3' : isReply ? 'pl-5' : 'pl-[22px]'
            )}
          >
            <textarea
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              className="min-h-[60px] w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-[11px] leading-snug text-foreground"
            />
            <div className="flex justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={submittingEdit}
                onClick={handleCancelEdit}
              >
                {translate(
                  'auto.components.right.sidebar.checks.panel.content.b062f55f29',
                  'Cancel'
                )}
              </Button>
              <Button
                type="button"
                size="xs"
                disabled={!canSaveEdit}
                onClick={(event) => void handleSaveEdit(event)}
              >
                {translate('auto.components.right.sidebar.checks.panel.content.f6a40263ff', 'Save')}
              </Button>
            </div>
          </div>
        ) : (
          <CommentMarkdown
            content={comment.body}
            className={cn(
              isReply ? presentation.commentBodyReply : presentation.commentBody,
              presentation.commentBodyMarkdown
            )}
          />
        )}
      </div>
    </div>
  )
}

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

export function ResolvedCommentGroupsSection({
  groups,
  botAuthorOverrides,
  replyingCommentId,
  replyDisabled,
  replyDisabledReason,
  presentation,
  onResolve,
  onStartReply,
  onCancelReply,
  onReply,
  onEditComment,
  onDeleteComment
}: {
  groups: PRCommentGroup[]
  botAuthorOverrides: ReadonlySet<string>
  replyingCommentId: number | null
  replyDisabled?: boolean
  replyDisabledReason?: string
  presentation: PRCommentPresentationClasses
  onResolve?: (threadId: string, resolve: boolean) => boolean | Promise<boolean>
  onStartReply?: (commentId: number) => void
  onCancelReply?: (commentId: number) => void
  onReply?: (comment: PRComment, body: string) => Promise<RightPanelCommentSubmitResult>
  onEditComment?: (comment: PRComment, body: string) => Promise<boolean>
  onDeleteComment?: (comment: PRComment) => void | Promise<void>
}): React.JSX.Element | null {
  if (groups.length === 0) {
    return null
  }
  return (
    <div className={presentation.resolvedSection}>
      <Accordion type="single" collapsible>
        <AccordionItem value="resolved-all" className="border-b-0">
          <AccordionTrigger className={presentation.resolvedSectionTrigger}>
            <span className="min-w-0 truncate">
              {translate(
                'auto.components.right.sidebar.checks.panel.content.e8b4c1a903',
                'Resolved · {{value0}}',
                { value0: groups.length }
              )}
            </span>
          </AccordionTrigger>
          <AccordionContent className={presentation.resolvedSectionContent}>
            {groups.map((group) => (
              <PRCommentGroupView
                key={getPRCommentGroupId(group)}
                group={group}
                botAuthorOverrides={botAuthorOverrides}
                replyingCommentId={replyingCommentId}
                actionState="resolved"
                isQueued={false}
                replyDisabled={replyDisabled}
                replyDisabledReason={replyDisabledReason}
                presentation={presentation}
                onResolve={onResolve}
                onStartReply={onStartReply}
                onCancelReply={onCancelReply}
                onReply={onReply}
                onEditComment={onEditComment}
                onDeleteComment={onDeleteComment}
              />
            ))}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
