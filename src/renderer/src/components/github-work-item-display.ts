import type { GitHubOwnerRepo, GitHubWorkItem } from '../../../shared/types'

export function parseOwnerRepoFromItemUrl(url: string): GitHubOwnerRepo | null {
  try {
    const parsed = new URL(url)
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !parsed.host) {
      return null
    }
    const segments = parsed.pathname.split('/').filter(Boolean)
    if (segments.length < 2) {
      return null
    }
    return { owner: segments[0], repo: segments[1], host: parsed.host }
  } catch {
    return null
  }
}

export function formatGitHubWorkItemRelativeTime(input: string): string {
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

export function getGitHubWorkItemStateLabel(item: GitHubWorkItem): string {
  if (item.type === 'pr') {
    if (item.state === 'merged') return 'Merged'
    if (item.state === 'draft') return 'Draft'
    if (item.state === 'closed') return 'Closed'
  }
  return item.state === 'closed' ? 'Closed' : 'Open'
}

export function getGitHubWorkItemStateTone(item: GitHubWorkItem): string {
  if (item.type === 'pr') {
    if (item.state === 'merged') {
      return 'border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-300'
    }
    if (item.state === 'draft') {
      return 'border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300'
    }
    if (item.state === 'closed') {
      return 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300'
    }
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
  }
  if (item.state === 'closed') return 'border-ring/50 bg-primary/10 text-foreground'
  return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
}
