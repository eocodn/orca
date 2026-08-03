import type {
  GitHubAssignableUser,
  GitHubIssueTimelineItem,
  GitHubIssueTimelineTarget,
  PRComment
} from '../../shared/types'
import {
  ghExecFileAsync,
  ghRepoExecOptions,
  githubRepoContext,
  type LocalGitExecOptions
} from './gh-utils'
import {
  githubHostExecOptions,
  type GitHubApiRepository
} from './github-api-repository'
import { noteRepositoryRateLimitSpend, repositoryRateLimitGuard } from './rate-limit'

// Why: cap total PR files so a massive PR can't starve the gh semaphore while paging (100/page).

// Why: bound noisy issue timelines so one huge issue can't monopolize gh/API time.
const MAX_ISSUE_TIMELINE_ITEMS = 300
const GITHUB_REST_PAGE_SIZE = 100
// Why: raw-fetch buffer must exceed the renderer's large-diff threshold, else the UI shows an empty diff instead of the fallback.

import { ISSUE_DETAILS_QUERY } from './github-work-item-timeline'
type GraphQLIssueDetailsResponse = {
  data?: {
    repository?: {
      issue?: {
        body?: string | null
        assignees?: { nodes?: { login?: string; avatarUrl?: string; name?: string | null }[] }
        participants?: { nodes?: GitHubAssignableUser[] }
        comments?: {
          nodes?: {
            databaseId?: number | null
            body?: string | null
            createdAt?: string | null
            url?: string | null
            author?: {
              login?: string | null
              avatarUrl?: string | null
              __typename?: string
            } | null
          }[]
        }
      } | null
    } | null
  }
  errors?: { message?: string }[]
}

type RestTimelineUser = {
  login?: string | null
  avatar_url?: string | null
}

type RestTimelineIssue = {
  number?: number | null
  title?: string | null
  html_url?: string | null
  repository?: {
    name?: string | null
    owner?: { login?: string | null } | null
  } | null
  pull_request?: unknown
}

type RestTimelineEvent = {
  id?: number | string | null
  node_id?: string | null
  event?: string | null
  actor?: RestTimelineUser | null
  user?: RestTimelineUser | null
  assignee?: RestTimelineUser | null
  created_at?: string | null
  source?: {
    issue?: RestTimelineIssue | null
  } | null
  closer?: RestTimelineIssue | null
  state_reason?: string | null
  project_card?: {
    column_name?: string | null
    previous_column_name?: string | null
    project_url?: string | null
  } | null
  project?: {
    name?: string | null
  } | null
  project_column_name?: string | null
  previous_column_name?: string | null
}

function isSupportedTimelineEvent(
  eventName: string | null | undefined
): eventName is GitHubIssueTimelineItem['event'] {
  return (
    eventName === 'assigned' ||
    eventName === 'unassigned' ||
    eventName === 'mentioned' ||
    eventName === 'cross-referenced' ||
    eventName === 'closed' ||
    eventName === 'reopened' ||
    eventName === 'moved_columns_in_project'
  )
}

function mapTimelineTarget(
  issue: RestTimelineIssue | null | undefined
): GitHubIssueTimelineTarget | undefined {
  if (!issue || typeof issue.number !== 'number' || !issue.html_url) {
    return undefined
  }
  const owner = issue.repository?.owner?.login
  const repo = issue.repository?.name
  return {
    type: issue.pull_request ? 'pr' : 'issue',
    number: issue.number,
    title: issue.title ?? '',
    url: issue.html_url,
    repository: owner && repo ? `${owner}/${repo}` : undefined
  }
}

function getTimelineActor(event: RestTimelineEvent): { login: string; avatarUrl: string } {
  const actor = event.actor ?? event.user
  return {
    login: actor?.login ?? 'ghost',
    avatarUrl: actor?.avatar_url ?? ''
  }
}

function mapRestTimelineEvent(event: RestTimelineEvent): GitHubIssueTimelineItem | null {
  const eventName = event.event
  if (!isSupportedTimelineEvent(eventName)) {
    return null
  }
  if (!event.created_at) {
    return null
  }
  const actor = getTimelineActor(event)
  const id = String(event.node_id ?? event.id ?? `${eventName}:${event.created_at}`)
  const base = {
    id,
    event: eventName,
    actor: actor.login,
    actorAvatarUrl: actor.avatarUrl,
    createdAt: event.created_at
  }
  if (eventName === 'assigned' || eventName === 'unassigned') {
    return {
      ...base,
      assignee: event.assignee?.login ?? undefined
    }
  }
  if (eventName === 'mentioned' || eventName === 'cross-referenced') {
    return {
      ...base,
      source: mapTimelineTarget(event.source?.issue)
    }
  }
  if (eventName === 'closed') {
    return {
      ...base,
      stateReason: event.state_reason ?? null,
      closer: mapTimelineTarget(event.closer ?? event.source?.issue)
    }
  }
  if (eventName === 'moved_columns_in_project') {
    return {
      ...base,
      previousColumnName:
        event.previous_column_name ?? event.project_card?.previous_column_name ?? null,
      columnName: event.project_column_name ?? event.project_card?.column_name ?? null,
      projectName: event.project?.name ?? null
    }
  }
  return base
}

function parseRestTimelineEventLines(stdout: string): RestTimelineEvent[] {
  const events: RestTimelineEvent[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        events.push(parsed)
      }
    } catch {
      // Skip malformed jq lines; timeline activity is auxiliary to issue details.
    }
  }
  return events
}

async function getIssueTimelineItems(
  ownerRepo: GitHubApiRepository,
  issueNumber: number,
  ghOptions: ReturnType<typeof ghRepoExecOptions>
): Promise<GitHubIssueTimelineItem[]> {
  try {
    const items: GitHubIssueTimelineItem[] = []
    for (let page = 1; items.length < MAX_ISSUE_TIMELINE_ITEMS; page += 1) {
      if (repositoryRateLimitGuard(ownerRepo, 'core', ghOptions).blocked) {
        return items
      }
      noteRepositoryRateLimitSpend(ownerRepo, 'core', 1, ghOptions)
      const { stdout } = await ghExecFileAsync(
        [
          'api',
          '--cache',
          '60s',
          `repos/${ownerRepo.owner}/${ownerRepo.repo}/issues/${issueNumber}/timeline?per_page=${GITHUB_REST_PAGE_SIZE}&page=${page}`,
          '--jq',
          '.[] | @json'
        ],
        { ...ghOptions, ...githubHostExecOptions(ownerRepo) }
      )
      // Why: --jq emits NDJSON and explicit paging lets us stop once we hit the drawer cap.
      const pageEvents = parseRestTimelineEventLines(stdout)
      for (const event of pageEvents) {
        const item = mapRestTimelineEvent(event)
        if (!item) {
          continue
        }
        items.push(item)
        if (items.length === MAX_ISSUE_TIMELINE_ITEMS) {
          break
        }
      }
      if (pageEvents.length < GITHUB_REST_PAGE_SIZE) {
        break
      }
    }
    return items
  } catch {
    return []
  }
}

/**
 * Fetch an issue's body, comments, assignees, participants, and timeline in one GraphQL round-trip.
 * Returns null on any partial error so the caller falls back to the strict REST path.
 * Avatars are resolved here so GHE users don't render blank.
 */
async function getIssueDetailsViaGraphQL(
  repoPath: string,
  issueNumber: number,
  ownerRepo: GitHubApiRepository | null,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<{
  body: string
  comments: PRComment[]
  assignees: string[]
  // Avatar-bearing assignees, kept separate from the login-only `assignees`; enriches avatars `gh` leaves blank (GHE).
  assigneeUsers: GitHubAssignableUser[]
  participants: GitHubAssignableUser[]
  timelineItems: GitHubIssueTimelineItem[]
} | null> {
  const ghOptions = {
    ...ghRepoExecOptions(githubRepoContext(repoPath, connectionId, localGitOptions)),
    ...githubHostExecOptions(ownerRepo)
  }
  if (!ownerRepo) {
    return null
  }
  if (repositoryRateLimitGuard(ownerRepo, 'graphql', ghOptions).blocked) {
    return null
  }
  try {
    noteRepositoryRateLimitSpend(ownerRepo, 'graphql', 1, ghOptions)
    const { stdout } = await ghExecFileAsync(
      [
        'api',
        'graphql',
        '-f',
        `query=${ISSUE_DETAILS_QUERY}`,
        '-f',
        `owner=${ownerRepo.owner}`,
        '-f',
        `repo=${ownerRepo.repo}`,
        '-F',
        `number=${issueNumber}`
      ],
      ghOptions
    )
    const parsed = JSON.parse(stdout) as GraphQLIssueDetailsResponse
    if (parsed.errors && parsed.errors.length > 0) {
      // Why: any partial GraphQL error forces the strict REST fallback so the drawer never paints a half-built shell.
      return null
    }
    const issue = parsed.data?.repository?.issue
    if (!issue) {
      return null
    }
    const comments: PRComment[] = (issue.comments?.nodes ?? [])
      .filter((c) => typeof c.databaseId === 'number')
      .map((c) => ({
        id: c.databaseId as number,
        author: c.author?.login ?? 'ghost',
        authorAvatarUrl: c.author?.avatarUrl ?? '',
        body: c.body ?? '',
        createdAt: c.createdAt ?? '',
        url: c.url ?? '',
        isBot: c.author?.__typename === 'Bot'
      }))
    const assigneeUsers: GitHubAssignableUser[] = (issue.assignees?.nodes ?? [])
      .filter((a): a is { login: string; avatarUrl?: string; name?: string | null } =>
        Boolean(a.login)
      )
      .map((a) => ({
        login: a.login,
        name: a.name ?? null,
        avatarUrl: a.avatarUrl ?? ''
      }))
    const assignees = assigneeUsers.map((a) => a.login)
    const participants: GitHubAssignableUser[] = (issue.participants?.nodes ?? [])
      .filter((u) => Boolean(u.login))
      .map((u) => ({
        login: u.login,
        name: u.name ?? null,
        avatarUrl: u.avatarUrl ?? ''
      }))
    const timelineItems = await getIssueTimelineItems(ownerRepo, issueNumber, ghOptions)
    return {
      body: issue.body ?? '',
      comments,
      assignees,
      assigneeUsers,
      participants,
      timelineItems
    }
  } catch {
    return null
  }
}

function mergeGitHubUsers(users: GitHubAssignableUser[]): GitHubAssignableUser[] {
  const byLogin = new Map<string, GitHubAssignableUser>()
  for (const user of users) {
    if (!user.login) {
      continue
    }
    const key = user.login.toLowerCase()
    const existing = byLogin.get(key)
    if (existing) {
      // Why: return a new merged record instead of mutating caller-provided objects.
      byLogin.set(key, {
        login: existing.login,
        name: existing.name ?? user.name ?? null,
        avatarUrl: existing.avatarUrl || user.avatarUrl || ''
      })
      continue
    }
    byLogin.set(key, {
      login: user.login,
      name: user.name ?? null,
      avatarUrl: user.avatarUrl ?? ''
    })
  }
  return Array.from(byLogin.values())
}

export { isSupportedTimelineEvent, mapTimelineTarget, getTimelineActor, mapRestTimelineEvent, parseRestTimelineEventLines, getIssueTimelineItems, getIssueDetailsViaGraphQL, mergeGitHubUsers }
export { type GraphQLIssueDetailsResponse, type RestTimelineUser, type RestTimelineIssue, type RestTimelineEvent }
