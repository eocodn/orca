import React from 'react'
import { ChevronDown, CircleDashed, ExternalLink, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { CHECK_COLOR, CHECK_ICON } from '@/components/right-sidebar/checks-panel-content'
import { getCheckConclusion } from '@/components/pr-check-counts'
import { sortChecksBySeverity } from '../../../shared/pr-check-severity-order'
import type { CheckDetailsLoadState } from './github-checks-tab-state'
import type { PRCheckDetail } from '../../../shared/types'

function getCheckStatusLabel(check: PRCheckDetail): string {
  const conclusion = getCheckConclusion(check)
  if (conclusion === 'success') {
    return 'Successful'
  }
  if (conclusion === 'failure') {
    return 'Failed'
  }
  if (conclusion === 'cancelled') {
    return 'Cancelled'
  }
  if (conclusion === 'timed_out') {
    return 'Timed out'
  }
  if (conclusion === 'action_required') {
    return 'Action required'
  }
  if (conclusion === 'neutral') {
    return 'Neutral'
  }
  if (conclusion === 'skipped') {
    return 'Skipped'
  }
  if (check.status === 'queued') {
    return 'Queued'
  }
  if (check.status === 'in_progress') {
    return 'In progress'
  }
  return 'Pending'
}

export function getCheckDetailsKey(check: PRCheckDetail): string {
  return String(check.checkRunId ?? check.workflowRunId ?? check.url ?? check.name)
}

function formatCheckTimestamp(input: string | null | undefined): string | null {
  if (!input) {
    return null
  }
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

export type GitHubChecksSummaryCounts = {
  passing: number
  failing: number
  pending: number
  neutral: number
  needsAction: number
}

export function GitHubChecksResults({
  loading,
  list,
  variant,
  actions,
  compactHeader,
  SummaryIcon,
  summaryColor,
  summaryLabel,
  counts,
  expandedCheckKey,
  detailsByCheckKey,
  onToggleCheckDetails
}: {
  loading: boolean
  list: PRCheckDetail[]
  variant: 'compact' | 'page'
  actions: React.ReactNode
  compactHeader: React.ReactNode
  SummaryIcon: React.ElementType<{ className?: string }>
  summaryColor: string
  summaryLabel: string
  counts: GitHubChecksSummaryCounts
  expandedCheckKey: string | null
  detailsByCheckKey: Record<string, CheckDetailsLoadState>
  onToggleCheckDetails: (check: PRCheckDetail) => void
}): React.JSX.Element {
  const sorted = sortChecksBySeverity(list)
  const renderCheckRow = (check: PRCheckDetail): React.JSX.Element => {
    const conclusion = getCheckConclusion(check)
    const Icon = CHECK_ICON[conclusion] ?? CircleDashed
    const color = CHECK_COLOR[conclusion] ?? 'text-muted-foreground'
    const statusLabel = getCheckStatusLabel(check)
    const key = getCheckDetailsKey(check)
    const expanded = expandedCheckKey === key
    const detailsState = detailsByCheckKey[key]
    return (
      <div key={key} className="min-w-0">
        <button
          type="button"
          onClick={() => onToggleCheckDetails(check)}
          aria-expanded={expanded}
          className={cn(
            'flex w-full min-w-0 items-center gap-2 rounded-md text-left transition',
            variant === 'page' ? 'px-3 py-2.5 hover:bg-accent/60' : 'px-2 py-1.5 hover:bg-muted/40'
          )}
        >
          <ChevronDown
            className={cn(
              'size-3 shrink-0 text-muted-foreground transition-transform',
              !expanded && '-rotate-90'
            )}
          />
          <Icon
            className={cn('size-3.5 shrink-0', color, conclusion === 'pending' && 'animate-spin')}
          />
          <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{check.name}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{statusLabel}</span>
        </button>
        {expanded && renderCheckDetails(check, detailsState)}
      </div>
    )
  }

  const renderCheckDetails = (
    check: PRCheckDetail,
    state: CheckDetailsLoadState | undefined
  ): React.JSX.Element => {
    const details = state?.details
    const openUrl = details?.detailsUrl ?? details?.url ?? check.url
    const startedAt = formatCheckTimestamp(details?.startedAt)
    const completedAt = formatCheckTimestamp(details?.completedAt)
    const detailsStatusCheck: PRCheckDetail = {
      ...check,
      status: (details?.status as PRCheckDetail['status'] | undefined) ?? check.status,
      conclusion:
        (details?.conclusion as PRCheckDetail['conclusion'] | undefined) ?? check.conclusion
    }
    const hasOutput = Boolean(details?.title || details?.summary || details?.text)
    const hasAnnotations = (details?.annotations.length ?? 0) > 0
    const hasJobs = (details?.jobs.length ?? 0) > 0

    return (
      <div className="mx-2 mb-2 mt-1 min-w-0 rounded-md border border-border/50 bg-muted/20 px-3 py-2">
        {state?.loading ? (
          <div className="flex items-center gap-2 py-2 text-[12px] text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" />
            {translate('auto.components.GitHubItemDialog.934d87ab96', 'Loading check details…')}
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>
                {translate('auto.components.GitHubItemDialog.9c3ba11a05', 'Status:')}{' '}
                {details ? getCheckStatusLabel(detailsStatusCheck) : getCheckStatusLabel(check)}
              </span>
              {startedAt && (
                <span>
                  {translate('auto.components.GitHubItemDialog.4812814bc8', 'Started')} {startedAt}
                </span>
              )}
              {completedAt && (
                <span>
                  {translate('auto.components.GitHubItemDialog.0f478f5efa', 'Completed')}{' '}
                  {completedAt}
                </span>
              )}
              {check.checkRunId && (
                <span className="font-mono">
                  {translate('auto.components.GitHubItemDialog.485609c4f2', 'check #')}
                  {check.checkRunId}
                </span>
              )}
            </div>

            {state?.error && <div className="text-[12px] text-muted-foreground">{state.error}</div>}

            {hasOutput && (
              <div className="min-w-0 rounded-md border border-border/40 bg-background/70 px-2.5 py-2">
                {details?.title && (
                  <div className="mb-1 text-[12px] font-medium text-foreground">
                    {details.title}
                  </div>
                )}
                {details?.summary && (
                  <CommentMarkdown
                    content={details.summary}
                    variant="document"
                    className="min-w-0 max-w-full overflow-hidden break-words text-[12px] leading-relaxed [&_a]:break-all [&_code]:break-words [&_pre]:max-w-full"
                  />
                )}
                {details?.text && (
                  <CommentMarkdown
                    content={details.text}
                    variant="document"
                    className="mt-2 min-w-0 max-w-full overflow-hidden break-words text-[12px] leading-relaxed [&_a]:break-all [&_code]:break-words [&_pre]:max-w-full"
                  />
                )}
              </div>
            )}

            {hasAnnotations && (
              <div className="min-w-0 rounded-md border border-border/40 bg-background/70">
                <div className="border-b border-border/40 px-2.5 py-1.5 text-[11px] font-medium text-foreground">
                  {translate('auto.components.GitHubItemDialog.96d8f36798', 'Annotations')}
                </div>
                <div className="flex flex-col">
                  {details!.annotations.map((annotation, index) => (
                    <div
                      key={`${annotation.path ?? 'annotation'}-${index}`}
                      className={cn(
                        'min-w-0 px-2.5 py-2 text-[12px]',
                        index > 0 && 'border-t border-border/30'
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                          {annotation.path ??
                            translate('auto.components.GitHubItemDialog.7d42606f66', 'Annotation')}
                          {annotation.startLine ? `:${annotation.startLine}` : ''}
                        </span>
                        {annotation.annotationLevel && (
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {annotation.annotationLevel}
                          </span>
                        )}
                      </div>
                      {annotation.title && (
                        <div className="mt-1 text-[12px] font-medium text-foreground">
                          {annotation.title}
                        </div>
                      )}
                      <div className="mt-1 break-words text-[12px] text-foreground">
                        {annotation.message}
                      </div>
                      {annotation.rawDetails && (
                        <pre className="mt-1 whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">
                          {annotation.rawDetails}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hasJobs && (
              <div className="min-w-0 rounded-md border border-border/40 bg-background/70">
                <div className="border-b border-border/40 px-2.5 py-1.5 text-[11px] font-medium text-foreground">
                  {translate('auto.components.GitHubItemDialog.08d072664d', 'Jobs')}
                </div>
                <div className="flex flex-col">
                  {details!.jobs.map((job, index) => (
                    <div
                      key={`${job.name}-${index}`}
                      className={cn(
                        'min-w-0 px-2.5 py-2',
                        index > 0 && 'border-t border-border/30'
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
                          {job.name}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {job.conclusion ??
                            job.status ??
                            translate('auto.components.GitHubItemDialog.773ff70035', 'unknown')}
                        </span>
                      </div>
                      {job.steps.length > 0 && (
                        <div className="mt-1 grid gap-1">
                          {job.steps.map((step) => (
                            <div
                              key={step.name}
                              className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground"
                            >
                              <span className="min-w-0 flex-1 truncate">{step.name}</span>
                              <span className="shrink-0">{step.conclusion ?? step.status}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!state?.error && !hasOutput && !hasAnnotations && !hasJobs && (
              <div className="text-[12px] text-muted-foreground">
                {getCheckConclusion(check) === 'action_required'
                  ? translate(
                      'auto.components.GitHubItemDialog.checkActionRequiredHint',
                      'Needs a manual action on GitHub (e.g. approving the run) to unblock merging.'
                    )
                  : translate(
                      'auto.components.GitHubItemDialog.744197c84d',
                      'No inline output is available for this check.'
                    )}
              </div>
            )}

            {openUrl && (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={() => window.api.shell.openUrl(openUrl)}
                >
                  {translate('auto.components.GitHubItemDialog.5dddefdf58', 'Open in GitHub')}
                  <ExternalLink className="size-3" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  if (loading && list.length === 0) {
    return (
      <>
        {variant === 'compact' ? compactHeader : null}
        <div className="flex items-center justify-center py-10">
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        </div>
      </>
    )
  }
  if (list.length === 0) {
    if (variant === 'page') {
      return (
        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <CircleDashed className="size-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-medium text-foreground">
                {translate('auto.components.GitHubItemDialog.ecffebc251', 'No checks found')}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {translate(
                  'auto.components.GitHubItemDialog.90020cc1f3',
                  'This pull request has no reported checks yet.'
                )}
              </span>
            </div>
            {actions}
          </div>
        </div>
      )
    }
    return (
      <>
        {compactHeader}
        <div className="flex flex-col items-center justify-center gap-1 px-4 py-6 text-center">
          <CircleDashed className="size-4 text-muted-foreground/60" />
          <div className="text-[12px] text-muted-foreground">
            {translate('auto.components.GitHubItemDialog.e52bed9264', 'No checks reported yet')}
          </div>
        </div>
      </>
    )
  }
  if (variant === 'page') {
    const countChips: { label: string; className: string }[] = []
    if (counts.passing > 0) {
      countChips.push({
        label: translate('auto.components.GitHubItemDialog.311d0cee55', '{{value0}} passing', {
          value0: counts.passing
        }),
        className: CHECK_COLOR.success
      })
    }
    if (counts.failing > 0) {
      countChips.push({
        label: translate('auto.components.GitHubItemDialog.b1ac991806', '{{value0}} failing', {
          value0: counts.failing
        }),
        className: CHECK_COLOR.failure
      })
    }
    if (counts.needsAction > 0) {
      countChips.push({
        label: translate(
          'auto.components.GitHubItemDialog.checksNeedActionChip',
          '{{value0}} action required',
          {
            value0: counts.needsAction
          }
        ),
        className: CHECK_COLOR.action_required
      })
    }
    if (counts.pending > 0) {
      countChips.push({
        label: translate('auto.components.GitHubItemDialog.18f80e1329', '{{value0}} pending', {
          value0: counts.pending
        }),
        className: CHECK_COLOR.pending
      })
    }
    if (counts.neutral > 0) {
      countChips.push({
        label: translate('auto.components.GitHubItemDialog.d23bbb6416', '{{value0}} skipped', {
          value0: counts.neutral
        }),
        className: 'text-muted-foreground'
      })
    }
    return (
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <SummaryIcon
            className={cn(
              'size-4 shrink-0',
              summaryColor,
              counts.pending > 0 && counts.failing === 0 && 'animate-spin'
            )}
          />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-foreground">{summaryLabel}</span>
            {countChips.length > 1 && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {countChips.map((chip, i) => (
                  <React.Fragment key={chip.label}>
                    {i > 0 && <span className="opacity-40">·</span>}
                    <span className={chip.className}>{chip.label}</span>
                  </React.Fragment>
                ))}
              </span>
            )}
          </div>
          {actions}
        </div>
        <div className="overflow-hidden rounded-lg border border-border/50 bg-card/50 shadow-xs">
          {sorted.map((check, index) => (
            <div
              key={getCheckDetailsKey(check)}
              className={cn(index > 0 && 'border-t border-border/40')}
            >
              {renderCheckRow(check)}
            </div>
          ))}
        </div>
      </div>
    )
  }
  return (
    <>
      {compactHeader}
      <div className="max-h-[280px] overflow-y-auto p-1 scrollbar-sleek">
        {sorted.map(renderCheckRow)}
      </div>
    </>
  )
}
