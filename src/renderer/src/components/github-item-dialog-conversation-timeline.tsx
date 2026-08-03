import React from 'react'
import { CheckCircle2, CircleDot, Link2, MoveRight, UserMinus, UserPlus } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { GitHubIssueTimelineItem, GitHubIssueTimelineTarget, PRComment } from '../../../shared/types'

export type IssueConversationEntry =
  | { kind: 'comment'; id: string; createdAt: string; comment: PRComment; index: number }
  | {
      kind: 'activity'
      id: string
      createdAt: string
      activity: GitHubIssueTimelineItem
      index: number
    }

export const EMPTY_GITHUB_ISSUE_TIMELINE_ITEMS: GitHubIssueTimelineItem[] = []

export function getIssueConversationEntries(
  comments: PRComment[],
  timelineItems: GitHubIssueTimelineItem[]
): IssueConversationEntry[] {
  return [
    ...comments.map(
      (comment, index): IssueConversationEntry => ({
        kind: 'comment',
        id: `comment:${comment.id}`,
        createdAt: comment.createdAt,
        comment,
        index
      })
    ),
    ...timelineItems.map(
      (activity, index): IssueConversationEntry => ({
        kind: 'activity',
        id: `activity:${activity.id}`,
        createdAt: activity.createdAt,
        activity,
        index: comments.length + index
      })
    )
  ].sort((a, b) => {
    const left = getTimelineSortValue(a.createdAt)
    const right = getTimelineSortValue(b.createdAt)
    return left === right ? a.index - b.index : left - right
  })
}

export function TimelineActivity({ activity }: { activity: GitHubIssueTimelineItem }): React.JSX.Element {
  const Icon =
    activity.event === 'assigned'
      ? UserPlus
      : activity.event === 'unassigned'
        ? UserMinus
        : activity.event === 'closed'
          ? CheckCircle2
          : activity.event === 'reopened'
            ? CircleDot
            : activity.event === 'moved_columns_in_project'
              ? MoveRight
              : Link2
  return (
    <div
      className="flex min-w-0 items-start gap-3 rounded-md px-1 py-1.5 text-[13px] text-muted-foreground"
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border/50 bg-muted/30 text-muted-foreground">
        <Icon className="size-3.5" />
      </span>
      {activity.actorAvatarUrl ? (
        <img src={activity.actorAvatarUrl} alt="" className="mt-1 size-5 shrink-0 rounded-full" />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="font-medium text-foreground">{activity.actor}</span>
          <span className="contents">{renderTimelineActivityMessage(activity)}</span>
          <span className="text-[12px] text-muted-foreground">
            {formatRelativeTime(activity.createdAt)}
          </span>
        </div>
      </div>
    </div>
  )
}

function getTimelineSortValue(createdAt: string): number {
  const value = new Date(createdAt).getTime()
  return Number.isFinite(value) ? value : 0
}

function getTimelineTargetLabel(target: GitHubIssueTimelineTarget): string {
  const prefix = target.type === 'pr' ? 'PR' : 'issue'
  const title = target.title ? ` ${target.title}` : ''
  return `${prefix} #${target.number}${title}`
}

function renderTimelineTarget(target: GitHubIssueTimelineTarget | undefined): React.ReactNode {
  if (!target) {
    return null
  }
  return (
    <button
      key={target.url}
      type="button"
      className="min-w-0 truncate font-medium text-foreground underline underline-offset-2 hover:text-muted-foreground"
      title={getTimelineTargetLabel(target)}
      onClick={() => window.api.shell.openUrl(target.url)}
    >
      {getTimelineTargetLabel(target)}
    </button>
  )
}

function renderTimelineActivityMessage(activity: GitHubIssueTimelineItem): React.ReactNode {
  const assignee =
    activity.assignee ?? translate('auto.components.GitHubItemDialog.timeline.someone', 'someone')
  if (activity.event === 'assigned') {
    return (
      <>
        {translate('auto.components.GitHubItemDialog.timeline.assigned', 'assigned')}{' '}
        <span className="font-medium text-foreground">{assignee}</span>
      </>
    )
  }
  if (activity.event === 'unassigned') {
    return (
      <>
        {translate('auto.components.GitHubItemDialog.timeline.unassigned', 'unassigned')}{' '}
        <span className="font-medium text-foreground">{assignee}</span>
      </>
    )
  }
  if (activity.event === 'mentioned' || activity.event === 'cross-referenced') {
    return (
      <>
        {translate('auto.components.GitHubItemDialog.timeline.mentioned', 'mentioned this')}
        {activity.source ? (
          <>
            {' '}
            {translate('auto.components.GitHubItemDialog.timeline.in', 'in')}{' '}
            {renderTimelineTarget(activity.source)}
          </>
        ) : null}
      </>
    )
  }
  if (activity.event === 'closed') {
    const stateReason = getTimelineStateReasonLabel(activity.stateReason)
    return (
      <>
        {translate('auto.components.GitHubItemDialog.timeline.closed', 'closed this')}
        {stateReason ? ` ${stateReason}` : ''}
        {activity.closer ? (
          <>
            {' '}
            {translate('auto.components.GitHubItemDialog.timeline.in', 'in')}{' '}
            {renderTimelineTarget(activity.closer)}
          </>
        ) : null}
      </>
    )
  }
  if (activity.event === 'reopened') {
    return translate('auto.components.GitHubItemDialog.timeline.reopened', 'reopened this')
  }
  return (
    <>
      {translate('auto.components.GitHubItemDialog.timeline.moved', 'moved this')}
      {activity.previousColumnName ? (
        <>
          {' '}
          {translate('auto.components.GitHubItemDialog.timeline.from', 'from')}{' '}
          <span className="font-medium text-foreground">{activity.previousColumnName}</span>
        </>
      ) : null}
      {activity.columnName ? (
        <>
          {' '}
          {translate('auto.components.GitHubItemDialog.timeline.to', 'to')}{' '}
          <span className="font-medium text-foreground">{activity.columnName}</span>
        </>
      ) : null}
      {activity.projectName ? (
        <>
          {' '}
          {translate('auto.components.GitHubItemDialog.timeline.in', 'in')}{' '}
          <span className="font-medium text-foreground">{activity.projectName}</span>
        </>
      ) : null}
    </>
  )
}

function getTimelineStateReasonLabel(reason: string | null | undefined): string | null {
  if (reason === 'completed') {
    return translate('auto.components.GitHubItemDialog.timeline.completed', 'as completed')
  }
  if (reason === 'not_planned') {
    return translate('auto.components.GitHubItemDialog.timeline.notPlanned', 'as not planned')
  }
  return null
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
