import React from 'react'
import { Check, LoaderCircle, Pencil } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { GitHubAssignableUser } from '../../../shared/types'

export function ReviewerPicker({
  open,
  submitting,
  canRequestReview,
  reviewerInputRef,
  reviewerInput,
  actionableReviewerRows,
  activeReviewerIndex,
  selectedReviewerLogins,
  suggestedReviewerRows,
  everyoneElseReviewerRows,
  hasReviewerCandidates,
  loading,
  error,
  hasReviewerMetadata,
  onOpenChange,
  onInputChange,
  onInputKeyDown,
  onSetActiveReviewerIndex,
  onRequestReviewer
}: {
  open: boolean
  submitting: boolean
  canRequestReview: boolean
  reviewerInputRef: React.RefObject<HTMLInputElement | null>
  reviewerInput: string
  actionableReviewerRows: GitHubAssignableUser[]
  activeReviewerIndex: number
  selectedReviewerLogins: ReadonlySet<string>
  suggestedReviewerRows: GitHubAssignableUser[]
  everyoneElseReviewerRows: GitHubAssignableUser[]
  hasReviewerCandidates: boolean
  loading: boolean
  error?: string | null
  hasReviewerMetadata: boolean
  onOpenChange: (open: boolean) => void
  onInputChange: (value: string) => void
  onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onSetActiveReviewerIndex: (nextIndex: number) => void
  onRequestReviewer: (reviewer: GitHubAssignableUser) => void
}): React.JSX.Element {
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
        aria-label={
          selected
            ? translate(
                'auto.components.GitHubItemDialog.fedc09eeb9',
                'Unrequest reviewer {{value0}}',
                { value0: reviewer.login }
              )
            : translate(
                'auto.components.GitHubItemDialog.8c45901789',
                'Request reviewer {{value0}}',
                { value0: reviewer.login }
              )
        }
        aria-pressed={selected}
        className={cn(
          'flex min-h-10 w-full items-center gap-2 border-b border-border/70 px-3 py-2 text-left text-[13px] outline-none last:border-b-0 hover:bg-accent/70 focus-visible:bg-accent focus-visible:text-accent-foreground',
          active && 'bg-accent text-accent-foreground',
          selected && 'font-medium'
        )}
        onMouseEnter={() => onSetActiveReviewerIndex(options.activeIndex)}
        onMouseDown={(event) => event.preventDefault()}
        onFocus={() => onSetActiveReviewerIndex(options.activeIndex)}
        onClick={() => onRequestReviewer(reviewer)}
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
                'auto.components.GitHubItemDialog.e3243d9376',
                'Recently edited these files'
              )}
            </span>
          ) : null}
        </span>
      </button>
    )
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={submitting || !canRequestReview}
          aria-label={translate('auto.components.GitHubItemDialog.934add88b6', 'Reviewer')}
          className="rounded p-0.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          {submitting ? (
            <LoaderCircle className="size-3 animate-spin" />
          ) : (
            <Pencil className="size-3" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="flex max-h-[420px] w-[330px] flex-col overflow-hidden rounded-md border-border/70 p-0"
        align="end"
        side="bottom"
        sideOffset={6}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="border-b border-border/70 p-2">
          <Input
            ref={reviewerInputRef}
            value={reviewerInput}
            onChange={(event) => onInputChange(event.target.value)}
            disabled={submitting || !canRequestReview}
            placeholder={translate(
              'auto.components.GitHubItemDialog.bb42774171',
              'Type or choose a user'
            )}
            aria-label={translate('auto.components.GitHubItemDialog.934add88b6', 'Reviewer')}
            aria-expanded={open}
            aria-haspopup="listbox"
            className="h-8 min-w-0 cursor-text rounded-md border-border/50 bg-background text-xs"
            onKeyDown={onInputKeyDown}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
          {loading ? (
            <div className="px-3 py-2 text-[13px] text-muted-foreground">
              {translate('auto.components.GitHubItemDialog.a98433e73d', 'Loading...')}
            </div>
          ) : hasReviewerCandidates ? (
            <>
              {suggestedReviewerRows.length > 0 ? (
                <>
                  <div className="border-b border-border/70 bg-muted/50 px-3 py-1.5 text-[12px] font-semibold text-foreground">
                    {translate('auto.components.GitHubItemDialog.c2b21818e1', 'Suggestions')}
                  </div>
                  {suggestedReviewerRows.map((reviewer, index) =>
                    renderReviewerPickerRow(reviewer, { suggested: true, activeIndex: index })
                  )}
                </>
              ) : null}
              <div className="border-b border-border/70 bg-muted/50 px-3 py-1.5 text-[12px] font-semibold text-foreground">
                {translate('auto.components.GitHubItemDialog.1ffce94a8b', 'Everyone else')}
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
                  {translate('auto.components.GitHubItemDialog.70e84e3d0b', 'No matching reviewers.')}
                </div>
              )}
            </>
          ) : (
            <div className="px-3 py-2 text-[13px] text-muted-foreground">
              {error ??
                (hasReviewerMetadata
                  ? translate('auto.components.GitHubItemDialog.70e84e3d0b', 'No matching reviewers.')
                  : translate(
                      'auto.components.GitHubItemDialog.3f79ffc8b7',
                      'Open the PR details to view current reviewers.'
                    ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
