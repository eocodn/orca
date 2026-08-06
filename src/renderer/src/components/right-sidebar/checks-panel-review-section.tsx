import React from 'react'
import {
  Check,
  Ellipsis,
  GitMerge,
  Link,
  Pencil,
  RefreshCw,
  Unlink,
  X,
  LoaderCircle
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  getTerminalUrlOrcaBrowserHint,
  getTerminalUrlSystemBrowserHint
} from '../terminal-pane/terminal-link-open-hints'
import { PullRequestIcon, prStateColor } from './checks-panel-content'
import type { ChecksPanelReview } from './checks-panel-review'
import type { ChecksPanelHostedReviewModifierDestination } from './checks-panel-hosted-review-click-routing'
import { translate } from '@/i18n/i18n'

export type ChecksPanelReviewHeaderProps = {
  review: ChecksPanelReview
  isRefreshing: boolean
  canUnlinkPullRequest: boolean
  modifierHintDestination: ChecksPanelHostedReviewModifierDestination
  onRefresh: () => void
  onOpenReview: (event: React.MouseEvent<HTMLButtonElement>) => void
  onUnlinkPullRequest: () => void
  onLinkAnotherPullRequest: () => void
}

export function ChecksPanelReviewHeader({
  review,
  isRefreshing,
  canUnlinkPullRequest,
  modifierHintDestination,
  onRefresh,
  onOpenReview,
  onUnlinkPullRequest,
  onLinkAnotherPullRequest
}: ChecksPanelReviewHeaderProps): React.JSX.Element {
  const reviewNumberLabel = review.provider === 'gitlab' ? `!${review.number}` : `#${review.number}`
  const ReviewIcon = review.provider === 'gitlab' ? GitMerge : PullRequestIcon
  const reviewHostLabel = review.provider === 'gitlab' ? 'GitLab' : 'GitHub'
  const modifierHint =
    modifierHintDestination === 'system-browser'
      ? getTerminalUrlSystemBrowserHint()
      : modifierHintDestination === 'orca'
        ? getTerminalUrlOrcaBrowserHint()
        : null
  const openTitle = translate(
    'auto.components.right.sidebar.ChecksPanel.5c88c6db07',
    'Open on {{value0}}',
    { value0: reviewHostLabel }
  )
  return (
    <div className="flex items-center gap-2">
      <ReviewIcon className="size-4 text-muted-foreground shrink-0" />
      <button
        type="button"
        className="rounded px-0.5 text-[12px] font-semibold text-foreground underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        title={modifierHint ? `${openTitle}. ${modifierHint}` : openTitle}
        onClick={onOpenReview}
      >
        {reviewNumberLabel}
      </button>
      <span
        className={cn(
          'text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border',
          prStateColor(review.state)
        )}
      >
        {review.state}
      </span>
      <div className="flex-1" />
      <button
        className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50"
        title={translate('auto.components.right.sidebar.ChecksPanel.7f4489f370', 'Refresh')}
        onClick={onRefresh}
        disabled={isRefreshing}
      >
        <RefreshCw className={cn('size-3.5', isRefreshing && 'animate-spin')} />
      </button>
      {review.provider === 'github' && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={translate(
                'auto.components.right.sidebar.ChecksPanel.653c105ecc',
                'More PR actions'
              )}
              title={translate(
                'auto.components.right.sidebar.ChecksPanel.653c105ecc',
                'More PR actions'
              )}
              className="text-muted-foreground hover:text-foreground"
            >
              <Ellipsis className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem disabled={!canUnlinkPullRequest} onSelect={onUnlinkPullRequest}>
              <Unlink className="size-3.5" />
              {translate('auto.components.right.sidebar.ChecksPanel.7202f4a40a', 'unlink PR')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onLinkAnotherPullRequest}>
              <Link className="size-3.5" />
              {translate('auto.components.right.sidebar.ChecksPanel.07871c0589', 'Link another PR')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

export type ChecksPanelReviewTitleProps = {
  title: string
  editing: boolean
  draft: string
  saving: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  onDraftChange: (value: string) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onStartEdit: () => void
  onSave: () => void
  onCancel: () => void
}

export function ChecksPanelReviewTitle({
  title,
  editing,
  draft,
  saving,
  inputRef,
  onDraftChange,
  onKeyDown,
  onStartEdit,
  onSave,
  onCancel
}: ChecksPanelReviewTitleProps): React.JSX.Element {
  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          className="flex-1 text-[12px] bg-background border border-border rounded px-2 py-1 text-foreground outline-none focus:ring-1 focus:ring-ring"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={saving}
        />
        <button
          className="cursor-pointer rounded p-1 text-emerald-500 transition-colors hover:bg-accent hover:text-emerald-400 disabled:cursor-default disabled:opacity-50"
          title={translate('auto.components.right.sidebar.ChecksPanel.2ab7fd4b6d', 'Save')}
          onClick={onSave}
          disabled={saving}
        >
          {saving ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
        </button>
        <button
          className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50"
          title={translate('auto.components.right.sidebar.ChecksPanel.058039787c', 'Cancel')}
          onClick={onCancel}
          disabled={saving}
        >
          <X className="size-3.5" />
        </button>
      </div>
    )
  }
  return (
    <div
      className="group/title flex items-start gap-1.5 cursor-pointer -mx-1 px-1 py-0.5 rounded hover:bg-accent/40 transition-colors"
      onClick={onStartEdit}
    >
      <span className="text-[12px] text-foreground leading-snug flex-1">{title}</span>
      <Pencil className="size-3 text-muted-foreground/40 can-hover:opacity-0 group-hover/title:opacity-100 transition-opacity shrink-0 mt-0.5" />
    </div>
  )
}
