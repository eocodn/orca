import React from 'react'
import { MessageSquare, Plus, SendHorizontal, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { getPrCommentAudienceFilters } from '@/lib/pr-comment-audience'
import { translate } from '@/i18n/i18n'
import type { PRCommentGroup } from '@/lib/pr-comment-groups'
import type { PRComment } from '../../../../shared/types'
import type { PRCommentAudienceFilter } from '@/lib/pr-comment-audience'
import type { PRCommentPresentationClasses } from './pr-comment-presentation'

export type PRCommentsListDisplayMode = 'triage' | 'timeline'
export const PR_COMMENT_LIST_DISPLAY_MODES: PRCommentsListDisplayMode[] = ['triage', 'timeline']

export function getPRCommentsListDisplayModeLabel(mode: PRCommentsListDisplayMode): string {
  return mode === 'triage'
    ? translate('auto.components.right.sidebar.checks.panel.content.8a621a2c4f', 'Grouped')
    : translate('auto.components.right.sidebar.checks.panel.content.b13f85d75c', 'Timeline')
}

export function CommentsHeader({
  presentation,
  comments,
  reviewKind,
  commentsLoading,
  canShowResolveWithAI,
  resolveCommentsWithAIDisabled,
  resolveCommentsWithAIDisabledReason,
  onResolveSelectedCommentsWithAI,
  selectableGroups,
  isSelectingForAI,
  selectedCommentQueueCount,
  selectedGroups,
  clearSelection,
  displayMode,
  setDisplayMode,
  onAddComment,
  isAddingComment,
  commentsDisabled,
  commentsDisabledReason,
  startAddComment,
  commentFilter,
  setCommentFilter,
  commentCounts
}: {
  presentation: PRCommentPresentationClasses
  comments: PRComment[]
  reviewKind: 'PR' | 'MR'
  commentsLoading: boolean
  canShowResolveWithAI: boolean
  resolveCommentsWithAIDisabled?: boolean
  resolveCommentsWithAIDisabledReason?: string
  onResolveSelectedCommentsWithAI?: (groups: PRCommentGroup[]) => void
  selectableGroups: PRCommentGroup[]
  isSelectingForAI: boolean
  selectedCommentQueueCount: number
  selectedGroups: PRCommentGroup[]
  clearSelection: () => void
  displayMode: PRCommentsListDisplayMode
  setDisplayMode: (mode: PRCommentsListDisplayMode) => void
  onAddComment?: (body: string) => Promise<unknown>
  isAddingComment: boolean
  commentsDisabled?: boolean
  commentsDisabledReason?: string
  startAddComment: () => void
  commentFilter: PRCommentAudienceFilter
  setCommentFilter: (filter: PRCommentAudienceFilter) => void
  commentCounts: Record<PRCommentAudienceFilter, number>
}): React.JSX.Element {
  return (
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
                className={cn(presentation.audienceTab, isActive && presentation.audienceTabActive)}
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
  )
}
