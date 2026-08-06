import React from 'react'
import { Check, ChevronDown, Users } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { GitHubUserAvatar } from '@/components/github/github-user-avatar'
import {
  getGitHubPRPrimaryReviewer,
  getGitHubPRReviewerRows,
  getGitHubPRReviewLabel,
  type GitHubPRPrimaryReviewer
} from '@/components/github-pr-reviewer-display'
import { translate } from '@/i18n/i18n'
import type { GitHubAssignableUser, GitHubWorkItem, Repo } from '../../../shared/types'

type ReviewerMetadataViewState = {
  data: GitHubAssignableUser[]
  loading: boolean
  error: string | null
}

type TaskPageGitHubReviewCellViewProps = {
  item: GitHubWorkItem
  repo: Repo | null
  open: boolean
  reviewerInput: string
  setReviewerInput: React.Dispatch<React.SetStateAction<string>>
  reviewerPickerSide: 'top' | 'bottom'
  reviewerPickerMaxHeight: number | null
  submitting: boolean
  reviewerTriggerRef: React.RefObject<HTMLButtonElement | null>
  setReviewerInputNode: (node: HTMLInputElement | null) => void
  reviewerMetadata: ReviewerMetadataViewState
  filteredReviewerCandidates: GitHubAssignableUser[]
  suggestedReviewerRows: GitHubAssignableUser[]
  everyoneElseReviewerRows: GitHubAssignableUser[]
  actionableReviewerRows: GitHubAssignableUser[]
  activeReviewerIndex: number
  setActiveReviewerIndex: (nextIndex: number | ((current: number) => number)) => void
  onReviewerPickerOpenChange: (nextOpen: boolean) => void
  onRequestReviewer: (reviewer: GitHubAssignableUser) => Promise<void>
  onRequestReview: (requestedLogins?: string[]) => Promise<void>
}

function ReviewChipAvatar({
  reviewer,
  avatarHost
}: {
  reviewer: GitHubPRPrimaryReviewer | null
  avatarHost?: string
}): React.JSX.Element {
  if (reviewer?.login) {
    // Why: review requests may contain only logins; use the PR host before falling back to initials.
    const avatarUrl =
      reviewer.avatarUrl || `https://${avatarHost ?? 'github.com'}/${reviewer.login}.png?size=40`
    return (
      <GitHubUserAvatar
        login={reviewer.login}
        name={reviewer.name}
        avatarUrl={avatarUrl}
        title={reviewer.name ? `${reviewer.name} (${reviewer.login})` : reviewer.login}
        className="size-5"
      />
    )
  }
  return <Users className="size-5 shrink-0" />
}

export function TaskPageGitHubReviewCellView({
  item,
  repo,
  open,
  reviewerInput,
  setReviewerInput,
  reviewerPickerSide,
  reviewerPickerMaxHeight,
  submitting,
  reviewerTriggerRef,
  setReviewerInputNode,
  reviewerMetadata,
  filteredReviewerCandidates,
  suggestedReviewerRows,
  everyoneElseReviewerRows,
  actionableReviewerRows,
  activeReviewerIndex,
  setActiveReviewerIndex,
  onReviewerPickerOpenChange,
  onRequestReviewer,
  onRequestReview
}: TaskPageGitHubReviewCellViewProps): React.JSX.Element {
  if (item.type !== 'pr') {
    return (
      <span className="text-[11px] text-muted-foreground">
        {translate('auto.components.TaskPage.b1eaa18ace', 'Issue')}
      </span>
    )
  }

  const itemWithLocalReviewRequests = { ...item, reviewRequests: localReviewRequests }
  const primaryReviewer = getGitHubPRPrimaryReviewer(itemWithLocalReviewRequests)
  const reviewerRows = getGitHubPRReviewerRows(itemWithLocalReviewRequests)
  const extraReviewerCount = Math.max(0, reviewerRows.length - 1)
  const hasReviewerMetadata =
    item.reviewDecision !== undefined ||
    localReviewRequests.length > 0 ||
    item.reviewRequests !== undefined ||
    item.latestReviews !== undefined

  const renderReviewerPickerRow = (
    reviewer: GitHubAssignableUser,
    options: { suggested: boolean; activeIndex: number }
  ): React.JSX.Element => {
    const selected = selectedReviewerLogins.has(reviewer.login.toLowerCase())
    const active = actionableReviewerRows[activeReviewerIndex]?.login === reviewer.login
    return (
      <button
        key={`${options.suggested ? 'suggested' : 'reviewer'}:${reviewer.login}`}
        type="button"
        className={cn(
          'flex min-h-10 w-full items-center gap-2 border-b border-border/50 px-3 py-2 text-left text-[13px] outline-none last:border-b-0 hover:bg-accent/70',
          active && 'bg-accent text-accent-foreground',
          selected && 'font-medium'
        )}
        onMouseEnter={() => setActiveReviewerIndex(options.activeIndex)}
        onMouseDown={(event) => {
          event.preventDefault()
          void onRequestReviewer(reviewer)
        }}
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-foreground">
          {selected ? <Check className="size-3.5" /> : null}
        </span>
        {reviewer.avatarUrl ? (
          <img src={reviewer.avatarUrl} alt="" className="size-5 shrink-0 rounded-full" />
        ) : (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
            {reviewer.login.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            <span className="font-semibold text-foreground">{reviewer.login}</span>
            {reviewer.name ? (
              <span className="ml-1 font-normal text-muted-foreground">{reviewer.name}</span>
            ) : null}
          </span>
          {options.suggested ? (
            <span className="block truncate text-[12px] leading-4 text-muted-foreground">
              {translate(
                'auto.components.TaskPage.5d4fd69a6a',
                'Recently active in this pull request'
              )}
            </span>
          ) : null}
        </span>
      </button>
    )
  }

  return (
    <Popover open={open} onOpenChange={onReviewerPickerOpenChange}>
      <PopoverTrigger asChild>
        <button
          ref={reviewerTriggerRef}
          type="button"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'inline-flex h-7 max-w-full items-center justify-center text-[12px] font-medium transition hover:brightness-110',
            primaryReviewer
              ? 'gap-1 rounded-full border border-border/40 bg-background/70 px-1.5 text-muted-foreground hover:text-foreground'
              : 'min-w-7 text-muted-foreground hover:text-foreground'
          )}
          aria-label={translate(
            'auto.components.TaskPage.editReviewersWithCurrent',
            'Edit reviewers: {{value0}}',
            { value0: getGitHubPRReviewLabel(itemWithLocalReviewRequests) }
          )}
          title={getGitHubPRReviewLabel(itemWithLocalReviewRequests)}
        >
          {primaryReviewer ? (
            <>
              <ReviewChipAvatar reviewer={primaryReviewer} avatarHost={reviewRepo?.host} />
              {extraReviewerCount > 0 ? (
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  +{extraReviewerCount}
                </span>
              ) : null}
              <ChevronDown className="size-3 text-muted-foreground" />
            </>
          ) : (
            <span aria-hidden="true">-</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="flex w-[330px] flex-col overflow-hidden rounded-md border-border/70 p-0"
        align="start"
        side={reviewerPickerSide}
        sideOffset={6}
        avoidCollisions={false}
        style={{ maxHeight: reviewerPickerMaxHeight ? `${reviewerPickerMaxHeight}px` : undefined }}
        onClick={(event) => event.stopPropagation()}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
        }}
      >
        <div className="border-b border-border/70 px-3 py-2">
          <div className="text-[13px] font-semibold text-foreground">
            {translate('auto.components.TaskPage.62c7bd789f', 'Request up to 15 reviewers')}
          </div>
        </div>
        <div className="border-b border-border/70 p-3">
          <Input
            ref={setReviewerInputNode}
            value={reviewerInput}
            onChange={(event) => setReviewerInput(event.target.value)}
            placeholder={translate('auto.components.TaskPage.0b9b04f4b5', 'Type or choose a user')}
            disabled={!repo || submitting}
            className="h-8 rounded-md bg-background px-2 text-[13px]"
            aria-label={translate('auto.components.TaskPage.0b9b04f4b5', 'Type or choose a user')}
            aria-autocomplete="list"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && actionableReviewerRows.length > 0) {
                event.preventDefault()
                setActiveReviewerIndex((current) => (current + 1) % actionableReviewerRows.length)
                return
              }
              if (event.key === 'ArrowUp' && actionableReviewerRows.length > 0) {
                event.preventDefault()
                setActiveReviewerIndex(
                  (current) =>
                    (current - 1 + actionableReviewerRows.length) % actionableReviewerRows.length
                )
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                const activeReviewer = actionableReviewerRows[activeReviewerIndex]
                if (activeReviewer) {
                  void onRequestReviewer(activeReviewer)
                  return
                }
                void onRequestReview()
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                onReviewerPickerOpenChange(false)
              }
            }}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
          {reviewerMetadata.loading ? (
            <div className="px-3 py-2 text-[13px] text-muted-foreground">
              {translate('auto.components.TaskPage.0eacf48491', 'Loading…')}
            </div>
          ) : filteredReviewerCandidates.length > 0 ? (
            <>
              {suggestedReviewerRows.length > 0 ? (
                <>
                  <div className="border-b border-border/70 bg-muted/50 px-3 py-1.5 text-[12px] font-semibold text-foreground">
                    {translate('auto.components.TaskPage.3ace2e6bcf', 'Suggestions')}
                  </div>
                  {suggestedReviewerRows.map((reviewer, index) =>
                    renderReviewerPickerRow(reviewer, { suggested: true, activeIndex: index })
                  )}
                </>
              ) : null}
              <div className="border-b border-border/70 bg-muted/50 px-3 py-1.5 text-[12px] font-semibold text-foreground">
                {translate('auto.components.TaskPage.67755a83a1', 'Everyone else')}
              </div>
              {everyoneElseReviewerRows.length > 0 ? (
                everyoneElseReviewerRows.map((reviewer, index) =>
                  renderReviewerPickerRow(reviewer, {
                    suggested: false,
                    activeIndex: suggestedReviewerRows.length + index
                  })
                )
              ) : (
                <div className="px-3 py-2 text-[13px] text-muted-foreground">
                  {translate('auto.components.TaskPage.8a22eb3f7b', 'No matching reviewers.')}
                </div>
              )}
            </>
          ) : (
            <div className="px-3 py-2 text-[13px] text-muted-foreground">
              {reviewerMetadata.error ??
                (hasReviewerMetadata
                  ? translate('auto.components.TaskPage.8a22eb3f7b', 'No matching reviewers.')
                  : translate(
                      'auto.components.TaskPage.9e03c17847',
                      'Open the PR details to view current reviewers.'
                    ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
