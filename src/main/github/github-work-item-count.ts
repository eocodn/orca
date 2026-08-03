import { hostedReviewLocalGitOptionArgs } from './github-client-foundation'
import { resolvePrWorkItemSource } from './github-work-item-fetch'
import type {
  IssueSourcePreference
} from '../../shared/types'
import { isGitHubWorkItemsQueryTooLarge } from '../../shared/github-work-items-query-bounds'
import { parseTaskQuery, type ParsedTaskQuery } from '../../shared/task-query'
import {
  ghExecFileAsync,
  acquire,
  release,
  ghRepoExecOptions,
  githubRepoContext,
  type LocalGitExecOptions,
  type OwnerRepo
} from './gh-utils'
// Why: import from the lightweight module (not ./gh-utils) so tests mocking gh-utils still get the real functions.
import {
  getHostedReviewLocalGitOptions,
  type HostedReviewExecutionOptions
} from '../source-control/hosted-review-git-options'
import {
  getGitHubApiRepositoryForRemote,
  getOriginGitHubApiRepository,
  githubHostExecOptions,
  githubRepositorySlugArg,
  resolveGitHubRepoExecution,
  resolveIssueGitHubApiRepositorySource,
  type GitHubApiRepository
} from './github-api-repository'
import { githubRepoIdentityKey } from '../../shared/github-repository-identity-key'
import {
  getRateLimit,
  noteRepositoryRateLimitSpend,
  repositoryRateLimitGuard,
  spendsSharedGitHubComQuota
} from './rate-limit'
export function buildSearchQueryString(
  ownerRepo: { owner: string; repo: string },
  query: ParsedTaskQuery
): string {
  const parts: string[] = [`repo:${ownerRepo.owner}/${ownerRepo.repo}`]
  if (query.scope === 'pr') {
    parts.push('is:pull-request')
  } else if (query.scope === 'issue') {
    parts.push('is:issue')
  }
  if (query.state === 'open') {
    parts.push('is:open')
  } else if (query.state === 'closed') {
    // Why: GitHub search treats merged PRs as closed; exclude merged so "Closed" means closed-without-merge.
    parts.push('is:closed')
    if (query.scope !== 'issue') {
      parts.push('-is:merged')
    }
  } else if (query.state === 'merged') {
    parts.push('is:merged')
  }
  if (query.draft) {
    parts.push('draft:true')
  }
  if (query.assignee) {
    parts.push(`assignee:${quoteGitHubSearchValue(query.assignee)}`)
  }
  if (query.author) {
    parts.push(`author:${quoteGitHubSearchValue(query.author)}`)
  }
  if (query.reviewRequested) {
    parts.push(`review-requested:${quoteGitHubSearchValue(query.reviewRequested)}`)
  }
  if (query.reviewedBy) {
    parts.push(`reviewed-by:${quoteGitHubSearchValue(query.reviewedBy)}`)
  }
  for (const label of query.labels) {
    parts.push(`label:${quoteGitHubSearchValue(label)}`)
  }
  if (query.freeText) {
    parts.push(query.freeText)
  }
  return parts.join(' ')
}

export function quoteGitHubSearchValue(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"` : value
}

export async function countWorkItemsForQuery(
  repoPath: string,
  ownerRepo: OwnerRepo,
  query: ParsedTaskQuery,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<number> {
  const searchQ = buildSearchQueryString(ownerRepo, query)
  const ghOptions = {
    ...ghRepoExecOptions(githubRepoContext(repoPath, connectionId, localGitOptions)),
    ...githubHostExecOptions(ownerRepo)
  }
  const { stdout } = await ghExecFileAsync(
    [
      'api',
      '--cache',
      '120s',
      `search/issues?q=${encodeURIComponent(searchQ)}&per_page=1`,
      '--jq',
      '.total_count'
    ],
    ghOptions
  )
  // Why: over-counting cache hits is the safe direction — the next probe corrects the estimate.
  noteRepositoryRateLimitSpend(ownerRepo, 'search', 1, ghOptions)
  return Number.parseInt(stdout.trim(), 10) || 0
}

export function sameOwnerRepo(left: OwnerRepo | null, right: OwnerRepo | null): boolean {
  // Why: casing does not distinguish GitHub repos, but the same slug on different hosts does.
  return Boolean(left && right && githubRepoIdentityKey(left) === githubRepoIdentityKey(right))
}

export function defaultOpenWorkItemQuery(): ParsedTaskQuery {
  return {
    scope: 'all',
    state: 'open',
    draft: false,
    assignee: null,
    author: null,
    reviewRequested: null,
    reviewedBy: null,
    labels: [],
    freeText: ''
  }
}

// Why: cached 120s to avoid burning the 30/min search rate limit that backs the pagination total.
export async function countWorkItems(
  repoPath: string,
  query?: string,
  preference?: IssueSourcePreference,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<number> {
  const trimmedQuery = query?.trim() ?? ''
  if (isGitHubWorkItemsQueryTooLarge(trimmedQuery)) {
    return 0
  }
  const [issueResolved, prResolved] = await Promise.all([
    resolveIssueGitHubApiRepositorySource(repoPath, preference, connectionId, localGitOptions),
    resolvePrWorkItemSource(repoPath, preference, connectionId, localGitOptions)
  ])
  const issueOwnerRepo = issueResolved.source
  const prOwnerRepo = prResolved.source
  const ownerRepo = prOwnerRepo ?? issueOwnerRepo
  if (!ownerRepo) {
    return 0
  }

  const parsedQuery = trimmedQuery ? parseTaskQuery(trimmedQuery) : null
  const effectiveQuery = parsedQuery ?? defaultOpenWorkItemQuery()
  const ghOptions = {
    ...ghRepoExecOptions(githubRepoContext(repoPath, connectionId, localGitOptions)),
    ...githubHostExecOptions(ownerRepo)
  }

  // Why: counts are decorative, so stop when the 30/min search budget is gone rather than spawn into 403s (getRateLimit is 30s-cached).
  if (spendsSharedGitHubComQuota(ownerRepo, ghOptions)) {
    await getRateLimit()
  }
  if (repositoryRateLimitGuard(ownerRepo, 'search', ghOptions).blocked) {
    return 0
  }

  await acquire()
  try {
    if (sameOwnerRepo(issueOwnerRepo, prOwnerRepo)) {
      return await countWorkItemsForQuery(
        repoPath,
        ownerRepo,
        effectiveQuery,
        connectionId,
        localGitOptions
      )
    }

    const counts: Promise<number>[] = []
    // Why: draft/reviewRequested/reviewedBy are PR-only, so the issue half would always return 0 — skip it to save a search call.
    const hasPrOnlyFilter =
      effectiveQuery.draft ||
      effectiveQuery.reviewRequested !== null ||
      effectiveQuery.reviewedBy !== null
    if (
      effectiveQuery.scope !== 'pr' &&
      effectiveQuery.state !== 'merged' &&
      !hasPrOnlyFilter &&
      issueOwnerRepo
    ) {
      counts.push(
        countWorkItemsForQuery(
          repoPath,
          issueOwnerRepo,
          { ...effectiveQuery, scope: 'issue' },
          connectionId,
          localGitOptions
        )
      )
    }
    if (effectiveQuery.scope !== 'issue' && prOwnerRepo) {
      counts.push(
        countWorkItemsForQuery(
          repoPath,
          prOwnerRepo,
          { ...effectiveQuery, scope: 'pr' },
          connectionId,
          localGitOptions
        )
      )
    }
    // Why: allSettled so one failing search side doesn't zero the total; sum only fulfilled halves.
    const results = await Promise.allSettled(counts)
    let total = 0
    for (const r of results) {
      if (r.status === 'fulfilled') {
        total += r.value
      } else {
        console.warn('countWorkItems partial failure:', r.reason)
      }
    }
    return total
  } catch (err) {
    console.warn('countWorkItems failed:', err)
    return 0
  } finally {
    release()
  }
}

export async function getRepoSlug(
  repoPath: string,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<GitHubApiRepository | null> {
  return getOriginGitHubApiRepository(
    repoPath,
    connectionId,
    getHostedReviewLocalGitOptions(options)
  )
}

/**
 * Resolve a fork's upstream/parent owner/repo, or null when not a fork.
 * Why: a fork's `origin` is the personal copy, so repo identity (avatar) should prefer upstream.
 * Best-effort: any failure (offline, unauthed, non-GitHub) resolves to null.
 */
export async function getRepoUpstream(
  repoPath: string,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<OwnerRepo | null> {
  const localGitArgs = hostedReviewLocalGitOptionArgs(options)
  const localGitOptions = localGitArgs[0] ?? {}
  const { ownerRepo: origin, ghOptions } = await resolveGitHubRepoExecution(
    repoPath,
    undefined,
    connectionId,
    localGitOptions
  )
  if (!origin) {
    return null
  }
  const upstreamRemote = await getGitHubApiRepositoryForRemote(
    repoPath,
    'upstream',
    connectionId,
    localGitOptions
  )
  if (upstreamRemote && !sameOwnerRepo(upstreamRemote, origin)) {
    return upstreamRemote
  }
  await acquire()
  try {
    // Why: positional slugs bypass the runner's --repo qualifier, so the slug
    // itself must carry the Enterprise host.
    const { stdout } = await ghExecFileAsync(
      ['repo', 'view', githubRepositorySlugArg(origin), '--json', 'isFork,parent'],
      // Why: cap this best-effort add-time lookup so a stalled gh process can't hold up repo creation.
      {
        ...ghOptions,
        timeout: 10_000
      }
    )
    const data = JSON.parse(stdout) as {
      isFork?: boolean
      parent?: { name?: string; owner?: { login?: string } } | null
    }
    const owner = data.parent?.owner?.login
    const repo = data.parent?.name
    // Why: a fork parent lives on the same server as the fork.
    return data.isFork && owner && repo
      ? { owner, repo, ...(origin.host ? { host: origin.host } : {}) }
      : null
  } catch {
    return null
  } finally {
    release()
  }
}
