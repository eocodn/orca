import React from 'react'
import {
  AlertTriangle,
  CircleCheck,
  CircleDashed,
  CircleX,
  Files,
  LoaderCircle,
  RefreshCw,
  Sparkles
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { PRCheckDetail, PRConflictSummary, PRMergeableState } from '../../../../shared/types'
import { summarizeProviderChecks } from '../../../../shared/provider-check-summary'

type ConflictReview = {
  mergeable: PRMergeableState
  conflictSummary?: PRConflictSummary
}

export function buildMergeabilityRecalculationCommands(): string {
  return [
    'git fetch origin',
    'git commit --allow-empty --only -m "chore: refresh PR mergeability"',
    'git push'
  ].join('\n')
}

export function ConflictingFilesSection({ pr }: { pr: ConflictReview }): React.JSX.Element | null {
  const files = pr.conflictSummary?.files ?? []
  if (pr.mergeable !== 'CONFLICTING' || files.length === 0) {
    return null
  }

  // Why: the resolve action lives in the triage strip above; this section is
  // purely the informational conflict file list so the action isn't duplicated.
  return (
    <div className="border-b border-border px-3 py-3">
      <div className="text-[11px] text-muted-foreground">
        {pr.conflictSummary!.commitsBehind}{' '}
        {translate('auto.components.right.sidebar.checks.panel.content.6fa7f8723f', 'commit')}
        {pr.conflictSummary!.commitsBehind === 1 ? '' : 's'}{' '}
        {translate(
          'auto.components.right.sidebar.checks.panel.content.3916814392',
          'behind (base commit:'
        )}{' '}
        <span className="font-mono text-[10px]">{pr.conflictSummary!.baseCommit}</span>)
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Files className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="text-[11px] text-muted-foreground">
          {translate(
            'auto.components.right.sidebar.checks.panel.content.0975eeaaef',
            'Conflicting files'
          )}
        </div>
      </div>
      <div className="mt-2 space-y-1.5">
        {files.map((filePath) => (
          <div
            key={filePath}
            className="rounded-md border border-border bg-accent/20 px-2.5 py-1.5"
          >
            <div className="break-all font-mono text-[11px] leading-4 text-foreground">
              {filePath}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Fallback shown when the hosted review reports merge conflicts but no file list is available yet. */
export function MergeConflictNotice({
  pr,
  isRefreshingConflictDetails
}: {
  pr: ConflictReview
  isRefreshingConflictDetails: boolean
}): React.JSX.Element | null {
  if (pr.mergeable !== 'CONFLICTING' || (pr.conflictSummary?.files.length ?? 0) > 0) {
    return null
  }
  const locallyClean = pr.conflictSummary?.localMergeState === 'clean'
  let noticeBody = translate(
    'auto.components.right.sidebar.checks.panel.content.ae8a04ef17',
    'Conflict file details are unavailable'
  )
  if (isRefreshingConflictDetails) {
    noticeBody = translate(
      'auto.components.right.sidebar.checks.panel.content.73d0675356',
      'Refreshing conflict details…'
    )
  } else if (locallyClean) {
    noticeBody = translate(
      'auto.components.right.sidebar.checks.panel.content.f5bc5c4cf1',
      'The hosting provider reports conflicts, but local Git did not reproduce them. Refresh the review or push the branch to recalculate mergeability.'
    )
  }
  const refreshCommands = locallyClean ? buildMergeabilityRecalculationCommands() : null

  return (
    <div className="border-t border-border px-3 py-3">
      <div className="text-[11px] font-medium text-foreground">
        {translate(
          'auto.components.right.sidebar.checks.panel.content.87cd07c69a',
          'This branch has conflicts that must be resolved'
        )}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">{noticeBody}</div>
      {refreshCommands ? <MergeabilityRecalculationCommandBox commands={refreshCommands} /> : null}
    </div>
  )
}

import { MergeabilityRecalculationCommandBox } from './checks-panel-mergeability-command'

export function PRTriageStrip({
  review,
  pr,
  reviewKind = 'PR',
  checks,
  isResolvingConflictsWithAI,
  onResolveConflictsWithAI,
  resolveConflictsDisabled,
  resolveConflictsDisabledReason,
  isFixingChecksWithAI,
  onFixChecksWithAI,
  fixChecksDisabled,
  fixChecksDisabledReason
}: {
  review?: ConflictReview
  pr?: ConflictReview
  reviewKind?: 'PR' | 'MR'
  checks: PRCheckDetail[]
  isResolvingConflictsWithAI: boolean
  onResolveConflictsWithAI: () => void
  resolveConflictsDisabled?: boolean
  resolveConflictsDisabledReason?: string
  isFixingChecksWithAI: boolean
  onFixChecksWithAI: () => void
  fixChecksDisabled?: boolean
  fixChecksDisabledReason?: string
}): React.JSX.Element {
  const resolvedReview = review ?? pr
  // Why: the whole strip reads one shared summary so it cannot contradict the checks pill — a
  // `{status: completed, conclusion: null}` check used to spin here as "1 pending" forever while
  // the pill two panes away called it unresolved.
  const summary = summarizeProviderChecks(checks)
  const failingCount = summary.failed
  const pendingCount = summary.pending

  if (resolvedReview?.mergeable === 'CONFLICTING') {
    return (
      <ConflictTriageStrip
        reviewKind={reviewKind}
        isResolvingConflictsWithAI={isResolvingConflictsWithAI}
        onResolveConflictsWithAI={onResolveConflictsWithAI}
        resolveConflictsDisabled={resolveConflictsDisabled}
        resolveConflictsDisabledReason={resolveConflictsDisabledReason}
      />
    )
  }

  if (failingCount > 0) {
    return (
      <div className="border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <CircleX className="size-3.5 shrink-0 text-rose-500" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-medium text-foreground">
              {failingCount}{' '}
              {translate(
                'auto.components.right.sidebar.checks.panel.content.b652f38caf',
                'failing check'
              )}
              {failingCount === 1 ? '' : 's'}
            </div>
            <div className="truncate text-[10px] text-muted-foreground">
              {translate(
                'auto.components.right.sidebar.checks.panel.content.5d4ebf9391',
                'Inspect details or start an AI fix pass.'
              )}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={isFixingChecksWithAI || fixChecksDisabled}
            title={fixChecksDisabled ? fixChecksDisabledReason : undefined}
            onClick={onFixChecksWithAI}
          >
            {isFixingChecksWithAI ? (
              <RefreshCw className="size-3 animate-spin" />
            ) : (
              <Sparkles className="size-3" />
            )}
            {translate('auto.components.right.sidebar.checks.panel.content.b45db92d0e', 'Fix')}
          </Button>
        </div>
      </div>
    )
  }

  if (pendingCount > 0) {
    return (
      <div className="border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-amber-500" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-medium text-foreground">
              {pendingCount}{' '}
              {translate('auto.components.right.sidebar.checks.panel.content.5341023167', 'check')}
              {pendingCount === 1 ? '' : 's'}{' '}
              {translate(
                'auto.components.right.sidebar.checks.panel.content.9ad98f2a17',
                'pending'
              )}
            </div>
            <div className="truncate text-[10px] text-muted-foreground">
              {translate(
                'auto.components.right.sidebar.checks.panel.content.5856874b59',
                'Orca will refresh checks while this panel stays open.'
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Why: nothing passed, failed or is still running — a green tick here would contradict the grey
  // "Unresolved checks" pill reading the same list.
  if (summary.state === 'neutral') {
    return (
      <div className="border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <CircleDashed className="size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-medium text-foreground">
              {summary.neutral}{' '}
              {translate('auto.components.right.sidebar.checks.panel.content.5341023167', 'check')}
              {summary.neutral === 1 ? '' : 's'}{' '}
              {translate(
                'auto.components.right.sidebar.checks.panel.content.checksUnresolvedChip',
                'unresolved'
              )}
            </div>
            <div className="truncate text-[10px] text-muted-foreground">
              {translate(
                'auto.components.right.sidebar.checks.panel.content.checksUnresolvedStripHint',
                'These checks finished without a pass or fail verdict.'
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="border-b border-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <CircleCheck className="size-3.5 shrink-0 text-emerald-500" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-medium text-foreground">
            {translate(
              'auto.components.right.sidebar.checks.panel.content.9d0e7bcefc',
              'No blocking PR action'
            )}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {translate(
              'auto.components.right.sidebar.checks.panel.content.c16762ac8c',
              'Checks and comments below show the current fetched context.'
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function ConflictTriageStrip({
  reviewKind,
  isResolvingConflictsWithAI,
  onResolveConflictsWithAI,
  resolveConflictsDisabled,
  resolveConflictsDisabledReason
}: {
  reviewKind: 'PR' | 'MR'
  isResolvingConflictsWithAI: boolean
  onResolveConflictsWithAI: () => void
  resolveConflictsDisabled?: boolean
  resolveConflictsDisabledReason?: string
}): React.JSX.Element {
  return (
    <div className="border-b border-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-medium text-foreground">
            {translate(
              'auto.components.right.sidebar.checks.panel.content.60186d8498',
              'Conflicts block this'
            )}{' '}
            {reviewKind}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {translate(
              'auto.components.right.sidebar.checks.panel.content.3a71a6ed0b',
              'Resolve conflicts before checks and merge can complete.'
            )}
          </div>
        </div>
        <Button
          type="button"
          variant="default"
          size="xs"
          disabled={isResolvingConflictsWithAI || resolveConflictsDisabled}
          title={resolveConflictsDisabled ? resolveConflictsDisabledReason : undefined}
          onClick={onResolveConflictsWithAI}
        >
          {isResolvingConflictsWithAI ? (
            <RefreshCw className="size-3 animate-spin" />
          ) : (
            <Sparkles className="size-3" />
          )}
          {translate('auto.components.right.sidebar.checks.panel.content.0c96cd25e5', 'Resolve')}
        </Button>
      </div>
    </div>
  )
}
