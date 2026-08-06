import { parseTaskQuery } from '../../../shared/task-query'
import { getTaskPresetQuery } from '@/lib/new-workspace'
import type { TaskViewPresetId } from '../../../shared/types'
import type { GitHubTaskKind } from '@/components/task-page-localized-options'

export function isPRFocusedTaskView(preset: TaskViewPresetId | null, query: string): boolean {
  if (preset === 'prs' || preset === 'my-prs' || preset === 'review') {
    return true
  }
  const parsed = parseTaskQuery(query)
  return (
    parsed.scope === 'pr' ||
    parsed.state === 'merged' ||
    parsed.draft ||
    parsed.reviewRequested !== null ||
    parsed.reviewedBy !== null
  )
}

export function normalizeGitHubTaskPreset(
  preset: TaskViewPresetId | null | undefined
): TaskViewPresetId {
  // Legacy "all" defaults map to the Issues tab after the split tabs removed mixed results.
  return !preset || preset === 'all' ? 'issues' : preset
}

export function getGitHubTaskKind(preset: TaskViewPresetId | null, query: string): GitHubTaskKind {
  return isPRFocusedTaskView(preset, query) ? 'prs' : 'issues'
}

export function getDefaultPresetForGitHubTaskKind(kind: GitHubTaskKind): TaskViewPresetId {
  return kind === 'prs' ? 'prs' : 'issues'
}

export function scopeGitHubTaskSearch(query: string, kind: GitHubTaskKind): string {
  const trimmed = query.trim()
  if (!trimmed) {
    return getTaskPresetQuery(getDefaultPresetForGitHubTaskKind(kind))
  }
  if (/\bis:(?:issue|pr|pull-request)\b/i.test(trimmed)) {
    return trimmed
  }
  const parsed = parseTaskQuery(trimmed)
  const inferredKind = parsed.scope === 'pr' ? 'prs' : parsed.scope === 'issue' ? 'issues' : kind
  return `${inferredKind === 'prs' ? 'is:pr' : 'is:issue'} ${trimmed}`
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function formatRelativeTime(input: string): string {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) {
    return 'recently'
  }
  const diffMinutes = Math.round((date.getTime() - Date.now()) / 60_000)
  if (Math.abs(diffMinutes) < 60) {
    return relativeTimeFormatter.format(diffMinutes, 'minute')
  }
  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) {
    return relativeTimeFormatter.format(diffHours, 'hour')
  }
  return relativeTimeFormatter.format(Math.round(diffHours / 24), 'day')
}
