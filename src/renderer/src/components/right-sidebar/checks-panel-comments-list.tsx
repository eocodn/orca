import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  LoaderCircle,
  MessageSquare,
  Plus,
  SendHorizontal,
  SlidersHorizontal,
  Sparkles,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  filterPRCommentsByAudience,
  getPRCommentAudienceCounts,
  getPRCommentAudienceEmptyLabel,
  getPrCommentAudienceFilters,
  type PRCommentAudienceFilter
} from '@/lib/pr-comment-audience'
import { usePRBotAuthorOverrides } from '@/lib/pr-bot-author-overrides'
import { groupPRComments, type PRCommentGroup } from '@/lib/pr-comment-groups'
import {
  isPRCommentGroupQueueableForAI,
  partitionPRCommentGroupsForTriage,
  sortPRCommentGroupsForTimeline
} from '@/lib/pr-comment-action-state'
import {
  RightPanelCommentComposer,
  type RightPanelCommentSubmitResult
} from './right-panel-comment-composer'
import {
  usePRCommentsListSelection,
  type PRCommentsListSelectionClearRequest
} from './pr-comments-list-selection'
import { PRCommentGroupView, ResolvedCommentGroupsSection } from './checks-panel-comment-groups'
import { translate } from '@/i18n/i18n'
import type { PRComment } from '../../../../shared/types'

type PRCommentsListDisplayMode = 'triage' | 'timeline'
const PR_COMMENT_LIST_DISPLAY_MODES: PRCommentsListDisplayMode[] = ['triage', 'timeline']

function getPRCommentsListDisplayModeLabel(mode: PRCommentsListDisplayMode): string {
  return mode === 'triage'
    ? translate('auto.components.right.sidebar.checks.panel.content.8a621a2c4f', 'Grouped')
    : translate('auto.components.right.sidebar.checks.panel.content.b13f85d75c', 'Timeline')
}

function findVerticalScrollParent(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement
  while (parent) {
    const style = window.getComputedStyle(parent)
    const canScroll = style.overflowY === 'auto' || style.overflowY === 'scroll'
    if (canScroll && parent.scrollHeight > parent.clientHeight) {
      return parent
    }
    parent = parent.parentElement
  }
  return null
}

function scrollElementBottomIntoView(element: HTMLElement): void {
  const scrollParent = findVerticalScrollParent(element)
  if (!scrollParent) {
    element.scrollIntoView({ block: 'end', behavior: 'smooth' })
    return
  }
  const padding = 8
  const parentRect = scrollParent.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  const bottomOverflow = elementRect.bottom - parentRect.bottom + padding
  if (bottomOverflow > 0) {
    scrollParent.scrollTo({
      top: scrollParent.scrollTop + bottomOverflow,
      behavior: 'smooth'
    })
    return
  }
  const topOverflow = elementRect.top - parentRect.top - padding
  if (topOverflow < 0) {
    scrollParent.scrollTo({
      top: Math.max(0, scrollParent.scrollTop + topOverflow),
      behavior: 'smooth'
    })
  }
}

/** Renders the PR comments section below checks. */
export function PRCommentsList({
  comments,
  commentsLoading,
  reviewKind = 'PR',
  commentsDisabled,
  commentsDisabledReason,
  selectionContextKey,
  selectionClearRequest,
  resolveCommentsWithAIDisabled,
  resolveCommentsWithAIDisabledReason,
  onAddComment,
  onResolveSelectedCommentsWithAI,
  onReply,
  onResolve,
  onEditComment,
  onDeleteComment
}: {
  comments: PRComment[]
  commentsLoading: boolean
  reviewKind?: 'PR' | 'MR'
  commentsDisabled?: boolean
  commentsDisabledReason?: string
  selectionContextKey?: string
  selectionClearRequest?: PRCommentsListSelectionClearRequest | null
  resolveCommentsWithAIDisabled?: boolean
  resolveCommentsWithAIDisabledReason?: string
  onAddComment?: (body: string) => Promise<RightPanelCommentSubmitResult>
  onResolveSelectedCommentsWithAI?: (groups: PRCommentGroup[]) => void
  onReply?: (comment: PRComment, body: string) => Promise<RightPanelCommentSubmitResult>
  onResolve?: (threadId: string, resolve: boolean) => boolean | Promise<boolean>
  onEditComment?: (comment: PRComment, body: string) => Promise<boolean>
  onDeleteComment?: (comment: PRComment) => void | Promise<void>
}): React.JSX.Element {
  const presentation = React.useMemo(() => getPRCommentPresentationClasses(), [])
  const [commentFilter, setCommentFilter] = useState<PRCommentAudienceFilter>('all')
  const [displayMode, setDisplayMode] = useState<PRCommentsListDisplayMode>('triage')
  const [replyingCommentId, setReplyingCommentId] = useState<number | null>(null)
  const [isAddingComment, setIsAddingComment] = useState(false)
  const addCommentSurfaceRef = useRef<HTMLDivElement>(null)
  const shouldScrollAddCommentRef = useRef(false)
  const botAuthorOverrides = usePRBotAuthorOverrides()
  const commentCounts = React.useMemo(
    () => getPRCommentAudienceCounts(comments, botAuthorOverrides),
    [botAuthorOverrides, comments]
  )
  const {
    isSelectingForAI,
    selectedGroupIds,
    selectableGroups,
    selectableGroupsById,
    selectedGroups,
    addGroupToSelection,
    clearSelection,
    toggleGroupSelection
  } = usePRCommentsListSelection(comments, selectionContextKey, selectionClearRequest)
  const visibleComments = React.useMemo(
    () => filterPRCommentsByAudience(comments, commentFilter, botAuthorOverrides),
    [botAuthorOverrides, commentFilter, comments]
  )
  const groups = React.useMemo(() => groupPRComments(visibleComments), [visibleComments])
  const triageGroups = React.useMemo(() => partitionPRCommentGroupsForTriage(groups), [groups])
  // Why: triage mode prioritizes actionability; timeline restores the host discussion history.
  const timelineGroups = React.useMemo(() => sortPRCommentGroupsForTimeline(groups), [groups])
  const canShowResolveWithAI = Boolean(
    onResolveSelectedCommentsWithAI && selectableGroups.length > 0
  )
  const selectedCommentQueueCount = selectedGroups.length

  useEffect(() => {
    if (!isAddingComment || !shouldScrollAddCommentRef.current) {
      return
    }
    shouldScrollAddCommentRef.current = false
    let secondFrame: number | null = null
    const scrollComposerIntoView = (): void => {
      const surface = addCommentSurfaceRef.current
      if (surface) {
        scrollElementBottomIntoView(surface)
      }
    }
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(scrollComposerIntoView)
    })
    // Why: the composer expands and focuses in separate layout passes; the
    // timeout catches the final height so the footer is visible in short panels.
    const settledTimer = window.setTimeout(scrollComposerIntoView, 120)
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame !== null) {
        window.cancelAnimationFrame(secondFrame)
      }
      window.clearTimeout(settledTimer)
    }
  }, [isAddingComment])

  const startAddComment = useCallback(() => {
    shouldScrollAddCommentRef.current = true
    setIsAddingComment(true)
  }, [])

  const cancelAddComment = useCallback(() => {
    shouldScrollAddCommentRef.current = false
    setIsAddingComment(false)
  }, [])

  const renderSelectionControl = (group: PRCommentGroup): React.ReactNode => {
    if (!isSelectingForAI || !selectableGroupsById.has(getPRCommentGroupId(group))) {
      return null
    }
    const groupId = getPRCommentGroupId(group)
    const checked = selectedGroupIds.has(groupId)
    return (
      <Checkbox
        aria-label={translate(
          'auto.components.right.sidebar.checks.panel.content.5dc3af25c0',
          'Select comment'
        )}
        checked={checked}
        onCheckedChange={(value) => toggleGroupSelection(groupId, value === true)}
        className="shrink-0"
      />
    )
  }

  const renderCommentGroup = (group: PRCommentGroup): React.JSX.Element => {
    const groupId = getPRCommentGroupId(group)
    const actionState = getPRCommentGroupActionState(group)
    const isQueued = selectedGroupIds.has(groupId)
    const canQueue =
      canShowResolveWithAI &&
      !isQueued &&
      isPRCommentGroupQueueableForAI(group) &&
      selectableGroupsById.has(groupId) &&
      !isSelectingForAI
    return (
      <PRCommentGroupView
        key={groupId}
        group={group}
        botAuthorOverrides={botAuthorOverrides}
        replyingCommentId={replyingCommentId}
        selectionControl={renderSelectionControl(group)}
        actionState={actionState}
        isQueued={isQueued}
        replyDisabled={commentsDisabled}
        replyDisabledReason={commentsDisabledReason}
        presentation={presentation}
        onResolve={onResolve}
        onStartReply={setReplyingCommentId}
        onCancelReply={(commentId) =>
          setReplyingCommentId((current) => (current === commentId ? null : current))
        }
        onReply={onReply}
        onEditComment={onEditComment}
        onDeleteComment={onDeleteComment}
        onQueueForAgent={canQueue ? () => addGroupToSelection(groupId) : undefined}
      />
    )
  }

  const renderAddCommentComposer = (empty: boolean): React.JSX.Element => (
    <div
      ref={addCommentSurfaceRef}
      className={cn(empty ? 'px-3 py-2' : 'border-t border-border px-3 py-2')}
    >
      <RightPanelCommentComposer
        placeholder={
          empty
            ? translate(
                'auto.components.right.sidebar.checks.panel.content.ea9fd5ed6a',
                'Start conversation...'
              )
            : translate(
                'auto.components.right.sidebar.checks.panel.content.3fff651d32',
                'Add a PR comment'
              )
        }
        submitLabel="Send"
        autoFocus
        disabled={commentsDisabled}
        disabledReason={commentsDisabledReason}
        onCancel={cancelAddComment}
        onSubmit={
          onAddComment ??
          (async () => ({
            ok: false,
            error: translate(
              'auto.components.right.sidebar.checks.panel.content.b37ebdc51c',
              'Commenting unavailable.'
            )
          }))
        }
      />
    </div>
  )

  return (
    <div className="border-t border-border">
      {/* Header */}
      <div
        className={cn(
          presentation.sectionHeader,
          // Why: the checks sidebar scrolls as one column; pinning this header keeps
          // filter and add-comment actions reachable while reading long threads.
          'sticky top-0 z-10 bg-sidebar/95 backdrop-blur-sm'
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquare className="size-3.5 text-muted-foreground" />
          <span className={presentation.sectionHeaderLabel}>
            {translate('auto.components.right.sidebar.checks.panel.content.94557d68e2', 'Comments')}
          </span>
          {comments.length > 0 && (
            <span className={presentation.sectionCount}>{comments.length}</span>
          )}
          <div className="-mr-1 ml-auto flex items-center gap-0.5">
            {canShowResolveWithAI && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={translate(
                        'auto.components.right.sidebar.checks.panel.content.d7a2f9c401',
                        'Send unresolved {{value0}} comments',
                        { value0: reviewKind }
                      )}
                      disabled={commentsLoading || resolveCommentsWithAIDisabled}
                      title={
                        resolveCommentsWithAIDisabled
                          ? resolveCommentsWithAIDisabledReason
                          : undefined
                      }
                      onClick={() => onResolveSelectedCommentsWithAI?.(selectableGroups)}
                    >
                      <Sparkles className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={4}>
                    {resolveCommentsWithAIDisabled && resolveCommentsWithAIDisabledReason
                      ? resolveCommentsWithAIDisabledReason
                      : translate(
                          'auto.components.right.sidebar.checks.panel.content.d7a2f9c401',
                          'Send unresolved {{value0}} comments',
                          { value0: reviewKind }
                        )}
                  </TooltipContent>
                </Tooltip>
                {isSelectingForAI && (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="default"
                          size="icon-xs"
                          className="relative"
                          aria-label={translate(
                            'auto.components.right.sidebar.checks.panel.content.d91f2a6c39',
                            'Send {{value0}} queued comments to AI',
                            { value0: selectedCommentQueueCount }
                          )}
                          disabled={
                            selectedCommentQueueCount === 0 ||
                            commentsLoading ||
                            resolveCommentsWithAIDisabled
                          }
                          title={
                            resolveCommentsWithAIDisabled
                              ? resolveCommentsWithAIDisabledReason
                              : undefined
                          }
                          onClick={() => onResolveSelectedCommentsWithAI?.(selectedGroups)}
                        >
                          <SendHorizontal className="size-3" />
                          <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-border bg-background px-0.5 text-[9px] leading-none text-foreground tabular-nums">
                            {selectedCommentQueueCount}
                          </span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={4}>
                        {resolveCommentsWithAIDisabled && resolveCommentsWithAIDisabledReason
                          ? resolveCommentsWithAIDisabledReason
                          : translate(
                              'auto.components.right.sidebar.checks.panel.content.d91f2a6c39',
                              'Send {{value0}} queued comments to AI',
                              { value0: selectedCommentQueueCount }
                            )}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={translate(
                            'auto.components.right.sidebar.checks.panel.content.a6de3e5a20',
                            'Clear queued comments'
                          )}
                          onClick={clearSelection}
                        >
                          <X className="size-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={4}>
                        {translate(
                          'auto.components.right.sidebar.checks.panel.content.a6de3e5a20',
                          'Clear queued comments'
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </>
                )}
              </>
            )}
            {comments.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={translate(
                      'auto.components.right.sidebar.checks.panel.content.f5cf324efa',
                      'Comment display options'
                    )}
                  >
                    <SlidersHorizontal className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="bottom" sideOffset={6}>
                  <DropdownMenuLabel>
                    {translate(
                      'auto.components.right.sidebar.checks.panel.content.5e6e5a13fa',
                      'View'
                    )}
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={displayMode}
                    onValueChange={(value) => setDisplayMode(value as PRCommentsListDisplayMode)}
                  >
                    {PR_COMMENT_LIST_DISPLAY_MODES.map((mode) => (
                      <DropdownMenuRadioItem key={mode} value={mode}>
                        {getPRCommentsListDisplayModeLabel(mode)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {onAddComment && !isAddingComment && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={
                      comments.length === 0
                        ? translate(
                            'auto.components.right.sidebar.checks.panel.content.7440d09d2c',
                            'Start conversation'
                          )
                        : translate(
                            'auto.components.right.sidebar.checks.panel.content.2b2be92919',
                            'Add comment'
                          )
                    }
                    disabled={commentsDisabled}
                    title={commentsDisabled ? commentsDisabledReason : undefined}
                    className="text-muted-foreground hover:text-foreground"
                    onClick={startAddComment}
                  >
                    <Plus className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={4}>
                  {commentsDisabled && commentsDisabledReason
                    ? commentsDisabledReason
                    : comments.length === 0
                      ? translate(
                          'auto.components.right.sidebar.checks.panel.content.7440d09d2c',
                          'Start conversation'
                        )
                      : translate(
                          'auto.components.right.sidebar.checks.panel.content.2b2be92919',
                          'Add comment'
                        )}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        {comments.length > 0 && (
          <div className={presentation.audienceTabs}>
            {getPrCommentAudienceFilters().map((filter) => {
              const isActive = commentFilter === filter.value
              return (
                <button
                  key={filter.value}
                  type="button"
                  className={cn(
                    presentation.audienceTab,
                    isActive && presentation.audienceTabActive
                  )}
                  aria-pressed={isActive}
                  onClick={() => setCommentFilter(filter.value)}
                >
                  <span>{filter.label}</span>
                  <span className="tabular-nums">{commentCounts[filter.value]}</span>
                </button>
              )
            })}
          </div>
        )}
        {comments.length >= 100 && (
          <div className="mt-1.5 text-[10px] text-muted-foreground">
            {translate(
              'auto.components.right.sidebar.checks.panel.content.751f7c6e5c',
              'Showing first 100 comments per source'
            )}
          </div>
        )}
      </div>

      {/* List */}
      {commentsLoading && comments.length === 0 ? (
        <div className="flex items-center justify-center py-6">
          <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : comments.length === 0 && isAddingComment && onAddComment ? (
        renderAddCommentComposer(true)
      ) : comments.length === 0 ? (
        !onAddComment && (
          <div className="flex items-center justify-center py-5 text-[11px] text-muted-foreground">
            {translate(
              'auto.components.right.sidebar.checks.panel.content.755be805f6',
              'No comments'
            )}
          </div>
        )
      ) : visibleComments.length === 0 ? (
        <div className="flex items-center justify-center py-5 text-[11px] text-muted-foreground">
          {getPRCommentAudienceEmptyLabel(commentFilter)}
        </div>
      ) : (
        <div className={presentation.list}>
          {displayMode === 'timeline' ? (
            timelineGroups.map(renderCommentGroup)
          ) : (
            <>
              {triageGroups.open.length > 0 ? (
                <>
                  <div className={presentation.sectionTriageLabel}>
                    {translate(
                      'auto.components.right.sidebar.checks.panel.content.c3a8e5d710',
                      'Needs review · {{value0}}',
                      { value0: triageGroups.open.length }
                    )}
                  </div>
                  {triageGroups.open.map(renderCommentGroup)}
                </>
              ) : null}
              {triageGroups.conversation.map(renderCommentGroup)}
              <ResolvedCommentGroupsSection
                groups={triageGroups.resolved}
                botAuthorOverrides={botAuthorOverrides}
                replyingCommentId={replyingCommentId}
                replyDisabled={commentsDisabled}
                replyDisabledReason={commentsDisabledReason}
                presentation={presentation}
                onResolve={onResolve}
                onStartReply={setReplyingCommentId}
                onCancelReply={(commentId) =>
                  setReplyingCommentId((current) => (current === commentId ? null : current))
                }
                onReply={onReply}
                onEditComment={onEditComment}
                onDeleteComment={onDeleteComment}
              />
            </>
          )}
        </div>
      )}
      {onAddComment && comments.length > 0 && isAddingComment && renderAddCommentComposer(false)}
    </div>
  )
}
