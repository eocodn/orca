import type {
  GitHubAssignableUser,
  GitHubIssueTimelineItem,
  GitHubWorkItem,
  PRCheckDetail,
  PRComment
} from '../../shared/types'
import {
  ghExecFileAsync,
  ghRepoExecOptions,
  githubRepoContext,
  type LocalGitExecOptions
} from './gh-utils'
import { getPRChecks } from './client'
import {
  githubHostExecOptions,
  type GitHubApiRepository
} from './github-api-repository'
import { noteRepositoryRateLimitSpend, repositoryRateLimitGuard } from './rate-limit'

// Why: cap total PR files so a massive PR can't starve the gh semaphore while paging (100/page).

// Why: bound noisy issue timelines so one huge issue can't monopolize gh/API time.


// Why: raw-fetch buffer must exceed the renderer's large-diff threshold, else the UI shows an empty diff instead of the fallback.

import { localGitOptionArgs, WORK_ITEM_PARTICIPANTS_QUERY } from './github-work-item-timeline'
import { getIssueTimelineItems, mergeGitHubUsers } from './github-work-item-graphql'
async function getIssueBodyAndComments(
  repoPath: string,
  issueNumber: number,
  ownerRepo: GitHubApiRepository | null,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<{
  body: string
  comments: PRComment[]
  assignees: string[]
  timelineItems: GitHubIssueTimelineItem[]
}> {
  const ghOptions = {
    ...ghRepoExecOptions(githubRepoContext(repoPath, connectionId, localGitOptions)),
    ...githubHostExecOptions(ownerRepo)
  }
  try {
    if (ownerRepo) {
      if (repositoryRateLimitGuard(ownerRepo, 'core', ghOptions).blocked) {
        return { body: '', comments: [], assignees: [], timelineItems: [] }
      }
      // Why: the fallback starts the issue and comments reads together; debit
      // both before spawning so a failed response cannot leave quota overstated.
      noteRepositoryRateLimitSpend(ownerRepo, 'core', 2, ghOptions)
      const [issueResult, commentsResult, timelineItems] = await Promise.all([
        ghExecFileAsync(
          [
            'api',
            '--cache',
            '60s',
            `repos/${ownerRepo.owner}/${ownerRepo.repo}/issues/${issueNumber}`
          ],
          ghOptions
        ),
        ghExecFileAsync(
          [
            'api',
            '--cache',
            '60s',
            `repos/${ownerRepo.owner}/${ownerRepo.repo}/issues/${issueNumber}/comments?per_page=100`
          ],
          ghOptions
        ),
        getIssueTimelineItems(ownerRepo, issueNumber, ghOptions)
      ])
      const issue = JSON.parse(issueResult.stdout) as {
        body?: string | null
        assignees?: { login: string }[]
      }
      type RESTComment = {
        id: number
        user: { login: string; avatar_url: string; type?: string } | null
        body: string
        created_at: string
        html_url: string
      }
      const comments = (JSON.parse(commentsResult.stdout) as RESTComment[]).map(
        (c): PRComment => ({
          id: c.id,
          author: c.user?.login ?? 'ghost',
          authorAvatarUrl: c.user?.avatar_url ?? '',
          body: c.body ?? '',
          createdAt: c.created_at,
          url: c.html_url,
          isBot: c.user?.type === 'Bot'
        })
      )
      const assignees = (issue.assignees ?? []).map((a) => a.login)
      return { body: issue.body ?? '', comments, assignees, timelineItems }
    }
    if (connectionId) {
      // Why: connection-backed gh has no cwd. A bare issue lookup could honor
      // process GH_REPO/GH_HOST and return an unrelated repository's issue.
      return { body: '', comments: [], assignees: [], timelineItems: [] }
    }
    // Fallback: non-GitHub remote
    const { stdout } = await ghExecFileAsync(
      ['issue', 'view', String(issueNumber), '--json', 'body,comments,assignees'],
      ghOptions
    )
    const data = JSON.parse(stdout) as {
      body?: string
      comments?: {
        author: { login: string }
        body: string
        createdAt: string
        url: string
      }[]
      assignees?: { login: string }[]
    }
    const comments = (data.comments ?? []).map(
      (c, i): PRComment => ({
        id: i,
        author: c.author?.login ?? 'ghost',
        authorAvatarUrl: '',
        body: c.body ?? '',
        createdAt: c.createdAt,
        url: c.url ?? ''
      })
    )
    const fallbackAssignees = (data.assignees ?? []).map((a) => a.login)
    return { body: data.body ?? '', comments, assignees: fallbackAssignees, timelineItems: [] }
  } catch {
    return { body: '', comments: [], assignees: [], timelineItems: [] }
  }
}

async function getWorkItemParticipants(
  repoPath: string,
  item: Pick<GitHubWorkItem, 'number' | 'type'>,
  resolvedRepository: GitHubApiRepository | null,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitHubAssignableUser[]> {
  // Why: reuse the fan-out's repository identity so details cannot drift across hosts.
  const ownerRepo = resolvedRepository
  if (!ownerRepo) {
    return []
  }
  const ghOptions = {
    ...ghRepoExecOptions(githubRepoContext(repoPath, connectionId, localGitOptions)),
    ...githubHostExecOptions(ownerRepo)
  }
  if (repositoryRateLimitGuard(ownerRepo, 'graphql', ghOptions).blocked) {
    return []
  }
  try {
    noteRepositoryRateLimitSpend(ownerRepo, 'graphql', 1, ghOptions)
    const { stdout } = await ghExecFileAsync(
      [
        'api',
        'graphql',
        '-f',
        `query=${WORK_ITEM_PARTICIPANTS_QUERY}`,
        '-f',
        `owner=${ownerRepo.owner}`,
        '-f',
        `repo=${ownerRepo.repo}`,
        '-F',
        `number=${item.number}`,
        '-F',
        `isPr=${item.type === 'pr'}`
      ],
      ghOptions
    )
    const data = JSON.parse(stdout) as {
      data?: {
        repository?: {
          pullRequest?: {
            participants?: { nodes?: GitHubAssignableUser[] }
          } | null
          issue?: {
            participants?: { nodes?: GitHubAssignableUser[] }
          } | null
        }
      }
    }
    const nodes =
      data.data?.repository?.pullRequest?.participants?.nodes ??
      data.data?.repository?.issue?.participants?.nodes ??
      []
    return nodes
      .map((user) => ({
        login: user.login,
        name: user.name ?? null,
        avatarUrl: user.avatarUrl ?? ''
      }))
      .filter((user) => user.login)
  } catch {
    return []
  }
}

async function getGitHubUsersByLogin(
  repoPath: string,
  logins: string[],
  repository: GitHubApiRepository | null,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitHubAssignableUser[]> {
  if (!repository) {
    return []
  }
  const uniqueLogins = Array.from(
    new Set(logins.filter((login) => login && login !== 'ghost').map((login) => login.trim()))
  ).slice(0, 40)
  if (uniqueLogins.length === 0) {
    return []
  }
  const ghOptions = {
    ...ghRepoExecOptions(githubRepoContext(repoPath, connectionId, localGitOptions)),
    ...githubHostExecOptions(repository)
  }
  const guard = repositoryRateLimitGuard(repository, 'graphql', ghOptions)
  if (guard.blocked) {
    // Why: log the skip — callers degrade silently to blank GHE avatars, so it's otherwise untraceable.
    console.warn(
      `getGitHubUsersByLogin skipped: GraphQL rate-limit budget exhausted (${uniqueLogins.length} logins unresolved)`
    )
    return []
  }
  const fields = uniqueLogins
    .map(
      (login, index) =>
        `u${index}: user(login: ${JSON.stringify(login)}) { login name avatarUrl(size: 48) }`
    )
    .join('\n')
  try {
    noteRepositoryRateLimitSpend(repository, 'graphql', 1, ghOptions)
    const { stdout } = await ghExecFileAsync(
      ['api', 'graphql', '-f', `query=query { ${fields} }`],
      ghOptions
    )
    const data = JSON.parse(stdout) as {
      data?: Record<
        string,
        {
          login?: string
          name?: string | null
          avatarUrl?: string | null
        } | null
      >
    }
    return Object.values(data.data ?? {})
      .filter(
        (
          user
        ): user is {
          login: string
          name?: string | null
          avatarUrl?: string | null
        } => Boolean(user?.login)
      )
      .map((user) => ({
        login: user.login,
        name: user.name ?? null,
        avatarUrl: user.avatarUrl ?? ''
      }))
  } catch {
    return []
  }
}

/**
 * Stamp GraphQL-resolved avatars onto a work item's author, reviewers, review requests, latest reviews, and assignees.
 *
 * Why: `gh pr view` omits avatar_url, so login-based avatars 404 on GHE; knownUsers carries the GraphQL-resolved ones. See #8784.
 */
function enrichItemDisplayAvatars(
  item: Omit<GitHubWorkItem, 'repoId'>,
  knownUsers: GitHubAssignableUser[]
): Omit<GitHubWorkItem, 'repoId'> {
  const avatarByLogin = new Map<string, string>()
  for (const user of knownUsers) {
    if (user.login && user.avatarUrl) {
      avatarByLogin.set(user.login.toLowerCase(), user.avatarUrl)
    }
  }
  if (avatarByLogin.size === 0) {
    return item
  }
  // Why: prefer the GraphQL-resolved avatar — `gh pr view` returns empty/`u/0` placeholders for enterprise users; fall back to the original only when the lookup is empty.
  const avatarFor = (login: string): string | undefined => avatarByLogin.get(login.toLowerCase())
  const resolvedAvatar = (login: string, existing?: string | null): string | undefined =>
    avatarFor(login) || existing || undefined
  // Callers coalesce a missing result to each field's "no avatar" sentinel ('' or null); GitHubUserAvatar falls back to login URL then initials.
  const authorAvatarUrl = (item.author ? avatarFor(item.author) : undefined) || item.authorAvatarUrl
  return {
    ...item,
    ...(authorAvatarUrl ? { authorAvatarUrl } : {}),
    ...(item.reviewRequests
      ? {
          reviewRequests: item.reviewRequests.map((user) => ({
            ...user,
            avatarUrl: resolvedAvatar(user.login, user.avatarUrl) ?? ''
          }))
        }
      : {}),
    ...(item.latestReviews
      ? {
          latestReviews: item.latestReviews.map((review) => ({
            ...review,
            avatarUrl: resolvedAvatar(review.login, review.avatarUrl) ?? null
          }))
        }
      : {}),
    ...(item.assignees
      ? {
          assignees: item.assignees.map((user) => ({
            ...user,
            avatarUrl: resolvedAvatar(user.login, user.avatarUrl) ?? ''
          }))
        }
      : {})
  }
}

async function getMentionParticipants(
  repoPath: string,
  item: Pick<
    GitHubWorkItem,
    'author' | 'number' | 'type' | 'reviewRequests' | 'latestReviews' | 'assignees'
  >,
  comments: PRComment[],
  participants: GitHubAssignableUser[],
  repository: GitHubApiRepository | null,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitHubAssignableUser[]> {
  // Why: resolve mention authors + display users (reviewers/assignees) in one aliased trip so avatars reuse it without a second rate-limited lookup (#8784).
  // Why: order display users before comment authors so the 40-login cap in getGitHubUsersByLogin can't drop a reviewer/assignee avatar.
  const visibleLogins = [
    item.author ?? '',
    ...(item.reviewRequests ?? []).map((user) => user.login),
    ...(item.latestReviews ?? []).map((review) => review.login),
    ...(item.assignees ?? []).map((user) => user.login),
    ...comments.map((comment) => comment.author)
  ]
  const graphQlUsers = await getGitHubUsersByLogin(
    repoPath,
    visibleLogins,
    repository,
    connectionId,
    localGitOptions
  )
  return mergeGitHubUsers([...participants, ...graphQlUsers])
}

async function getPRChecksForDetails(
  repoPath: string,
  prNumber: number,
  headSha: string | undefined,
  repository: GitHubApiRepository | null,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<PRCheckDetail[]> {
  if (!repository) {
    return []
  }
  try {
    return await getPRChecks(
      repoPath,
      prNumber,
      headSha,
      repository,
      undefined,
      connectionId,
      ...localGitOptionArgs(localGitOptions)
    )
  } catch (err) {
    // Why: checks are auxiliary — a gh failure must not block opening the PR drawer.
    console.warn('getWorkItemDetails PR checks failed:', err)
    return []
  }
}

export { getIssueBodyAndComments, getWorkItemParticipants, getGitHubUsersByLogin, enrichItemDisplayAvatars, getMentionParticipants, getPRChecksForDetails }

