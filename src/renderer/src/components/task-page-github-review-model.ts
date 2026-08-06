import { githubProjectHost } from '../../../shared/github-project-identity'
import { parseGitHubIssueOrPRLink } from '@/lib/github-links'
import type { GitHubAssignableUser, GitHubOwnerRepo, GitHubWorkItem } from '../../../shared/types'

// Why: Task grid PR actions must keep the URL's host when list data has not
// hydrated prRepo yet, while still pinning host-less github.com identities.
export function resolveTaskPullRequestRepo(
  item: Pick<GitHubWorkItem, 'prRepo' | 'url'>
): GitHubOwnerRepo | null {
  const repo = item.prRepo ?? parseGitHubIssueOrPRLink(item.url)?.slug ?? null
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
