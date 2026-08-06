import React from 'react'
import { cn } from '@/lib/utils'
import {
  getGitHubWorkItemStateLabel as getStateLabel,
  getGitHubWorkItemStateTone as getStateTone
} from '@/components/github-work-item-display'
import { githubProjectHost } from '../../../shared/github-project-identity'
import { parseOwnerRepoFromItemUrl } from '@/components/github-work-item-display'
import type { GitHubAssignableUser, GitHubOwnerRepo, GitHubWorkItem } from '../../../shared/types'
import type { TaskSourceContext } from '../../../shared/task-source-context'

export type ItemDialogTab = 'conversation' | 'checks' | 'files'

export type GitHubItemDialogProjectOrigin = {
  owner: string
  repo: string
  /** GitHub host (e.g. GHES); absent means github.com. */
  host?: string
  number: number
  type: 'issue' | 'pr'
  projectId: string
  projectItemId: string
  cacheKey: string
}

export type GitHubItemDialogProps = {
  workItem: GitHubWorkItem | null
  repoPath: string | null
  repoId?: string | null
  sourceContext?: TaskSourceContext | null
  initialTab?: ItemDialogTab
  backLabel?: string
  /** Called when the user clicks the primary CTA to start work from this item. */
  onUse: (item: GitHubWorkItem) => void
  onReviewRequestsChange?: (
    itemKey: { id: string; repoId: string },
    reviewRequests: GitHubAssignableUser[]
  ) => void
  onClose: () => void
  /** Optional Project-origin context; when set, edits route via slug-addressed IPCs against the row's repo (slug routing wins for writes). */
  projectOrigin?: GitHubItemDialogProjectOrigin
}

export function getGitHubRepositoryLabelsUrl(itemUrl: string): string | null {
  try {
    const parsed = new URL(itemUrl)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null
    }
    const segments = parsed.pathname.split('/').filter(Boolean)
    if (segments.length < 2) {
      return null
    }
    // Why: preserve the origin so GitHub Enterprise URLs keep working while re-pathing to the repo-scoped labels page.
    parsed.pathname = `/${segments[0]}/${segments[1]}/labels`
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return null
  }
}

export function normalizeItemDialogTab(
  item: GitHubWorkItem | null,
  tab: ItemDialogTab | undefined
): ItemDialogTab {
  if (item?.type !== 'pr') {
    return 'conversation'
  }
  return tab ?? 'conversation'
}

// Why: every PR mutation needs the same host-pinned identity so process GH_HOST cannot redirect a github.com item or a Project row to the wrong server.
export function resolvePullRequestRepo(
  item: Pick<GitHubWorkItem, 'prRepo' | 'url'>,
  projectOrigin?: Pick<GitHubItemDialogProjectOrigin, 'owner' | 'repo' | 'host'>
): GitHubOwnerRepo | null {
  const repo =
    item.prRepo ??
    (projectOrigin
      ? {
          owner: projectOrigin.owner,
          repo: projectOrigin.repo,
          host: projectOrigin.host
        }
      : null) ??
    parseOwnerRepoFromItemUrl(item.url)
  return repo ? { ...repo, host: githubProjectHost(repo.host) } : null
}

export function mergeReviewerSuggestions(
  users: GitHubAssignableUser[],
  seedUsers: GitHubAssignableUser[]
): GitHubAssignableUser[] {
  const byLogin = new Map<string, GitHubAssignableUser>()
  for (const user of [...seedUsers, ...users]) {
    const key = user.login.toLowerCase()
    const existing = byLogin.get(key)
    if (!existing) {
      byLogin.set(key, user)
      continue
    }
    if (!existing.avatarUrl && user.avatarUrl) {
      byLogin.set(key, { ...existing, avatarUrl: user.avatarUrl })
    }
  }
  return Array.from(byLogin.values()).sort((a, b) => a.login.localeCompare(b.login))
}

export function buildRequestedReviewUsers(
  logins: string[],
  candidates: GitHubAssignableUser[],
  existingRequests: GitHubAssignableUser[]
): GitHubAssignableUser[] {
  const byLogin = new Map<string, GitHubAssignableUser>()
  for (const user of existingRequests) {
    byLogin.set(user.login.toLowerCase(), user)
  }
  const candidatesByLogin = new Map(candidates.map((user) => [user.login.toLowerCase(), user]))
  for (const login of logins) {
    const key = login.toLowerCase()
    if (byLogin.has(key)) {
      continue
    }
    byLogin.set(key, candidatesByLogin.get(key) ?? { login, name: null, avatarUrl: '' })
  }
  return Array.from(byLogin.values())
}

export function WorkItemStateBadge({
  item,
  className
}: {
  item: GitHubWorkItem
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium',
        getStateTone(item),
        className
      )}
    >
      {getStateLabel(item)}
    </span>
  )
}
