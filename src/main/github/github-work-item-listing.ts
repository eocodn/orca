import { mapIssueWorkItem, mapPullRequestWorkItem } from './github-work-item-mapping'
import type { MainWorkItem } from './github-work-item-mapping'
import { hydrateWorkItemRepositoryMergeMetadata, normalizeWorkItemPage, buildWorkItemListRequest, assertSshRepoHasResolvedGitHubSource, resolvePrWorkItemSource } from './github-work-item-fetch'
import type { PartialWorkItemsResult } from './github-work-item-fetch'
import type {
  ClassifiedError,
  IssueSourcePreference,
  ListWorkItemsResult
} from '../../shared/types'
import { isGitHubWorkItemsQueryTooLarge } from '../../shared/github-work-items-query-bounds'
import { classifyGitHubUnavailable } from '../../shared/github-api-availability'
import { parseTaskQuery, type ParsedTaskQuery } from '../../shared/task-query'
import {
  sortWorkItemsByNumber
} from '../../shared/work-items'
import {
  ghExecFileAsync,
  acquire,
  release,
  classifyListIssuesError,
  ghRepoExecOptions,
  githubRepoContext,
  type LocalGitExecOptions,
  type OwnerRepo
} from './gh-utils'
// Why: import from the lightweight module (not ./gh-utils) so tests mocking gh-utils still get the real functions.
import {
  githubHostExecOptions,
  resolveIssueGitHubApiRepositorySource
} from './github-api-repository'
export async function listRecentWorkItems(
  repoPath: string,
  issueOwnerRepo: OwnerRepo | null,
  prOwnerRepo: OwnerRepo | null,
  limit: number,
  page: number,
  connectionId?: string | null,
  noCache?: boolean,
  localGitOptions: LocalGitExecOptions = {}
): Promise<PartialWorkItemsResult> {
  const ghOptions = ghRepoExecOptions(githubRepoContext(repoPath, connectionId, localGitOptions))
  assertSshRepoHasResolvedGitHubSource({ connectionId, issueOwnerRepo, prOwnerRepo })
  const recentQuery = parseTaskQuery('is:open')
  const issueRequest = issueOwnerRepo
    ? buildWorkItemListRequest({
        kind: 'issue',
        ownerRepo: issueOwnerRepo,
        limit,
        query: recentQuery,
        page
      })
    : null
  const prRequest = prOwnerRepo
    ? buildWorkItemListRequest({
        kind: 'pr',
        ownerRepo: prOwnerRepo,
        limit,
        query: recentQuery,
        page
      })
    : null
  if (noCache && issueRequest) {
    issueRequest.args.splice(1, 2)
  }
  // Why: unresolved sources must stay empty — an unscoped Search API would return other public repos' issues (#9660).
  // Why: allSettled so a 403 on the issue side doesn't zero the PR half (partial results + banner).
  const [issuesSettled, prsSettled] = await Promise.allSettled([
    issueRequest && issueOwnerRepo
      ? ghExecFileAsync(issueRequest.args, {
          ...ghOptions,
          ...githubHostExecOptions(issueOwnerRepo)
        })
      : Promise.resolve({ stdout: '[]' }),
    prRequest && prOwnerRepo
      ? ghExecFileAsync(prRequest.args, {
          ...ghOptions,
          ...githubHostExecOptions(prOwnerRepo)
        })
      : Promise.resolve({ stdout: '[]' })
  ])

  let issues: MainWorkItem[] = []
  let issuesError: ClassifiedError | undefined
  if (issuesSettled.status === 'fulfilled') {
    issues = (JSON.parse(issuesSettled.value.stdout) as Record<string, unknown>[])
      // Why: search/issues can still return PRs (pull_request marker) even with is:issue; filter them out.
      .filter((item) => !('pull_request' in item))
      .map(mapIssueWorkItem)
  } else {
    const stderr =
      issuesSettled.reason instanceof Error
        ? issuesSettled.reason.message
        : String(issuesSettled.reason)
    issuesError = classifyListIssuesError(stderr)
  }

  let prs: MainWorkItem[] = []
  if (prsSettled.status === 'fulfilled') {
    prs = (JSON.parse(prsSettled.value.stdout) as Record<string, unknown>[])
      .slice(prRequest?.offset ?? 0, (prRequest?.offset ?? 0) + limit)
      .map((item) => mapPullRequestWorkItem(item, prOwnerRepo))
    prs = await hydrateWorkItemRepositoryMergeMetadata(prs, prOwnerRepo, {
      ...ghOptions,
      ...githubHostExecOptions(prOwnerRepo)
    })
  } else {
    // Why: re-throw PR errors so the cross-repo aggregator counts the repo failed; this feature only fixes issue-side swallowing (#1076).
    // Why: log issuesError first so a both-sides-failed case isn't blind to the classification we're about to drop.
    if (issuesError) {
      console.warn(
        'listRecentWorkItems: both issue and PR sides failed; issuesError was classified:',
        issuesError.type,
        issuesError.message
      )
    }
    throw prsSettled.reason
  }

  return {
    items: sortWorkItemsByNumber([...issues, ...prs]).slice(0, limit),
    issuesError
  }
}

export async function listQueriedWorkItems(
  repoPath: string,
  issueOwnerRepo: OwnerRepo | null,
  prOwnerRepo: OwnerRepo | null,
  query: ParsedTaskQuery,
  limit: number,
  page?: number,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<PartialWorkItemsResult> {
  const ghOptions = ghRepoExecOptions(githubRepoContext(repoPath, connectionId, localGitOptions))
  assertSshRepoHasResolvedGitHubSource({ connectionId, issueOwnerRepo, prOwnerRepo })
  const hasPrOnlyFilter =
    query.state === 'merged' ||
    query.draft ||
    query.reviewRequested !== null ||
    query.reviewedBy !== null
  const issueScope = query.scope !== 'pr' && !hasPrOnlyFilter
  const prScope = query.scope !== 'issue'
  let successfulRequestCount = 0
  let nonAvailabilityFailureCount = 0
  let availabilityError: unknown

  // Why: surface the issue-side error separately for the IPC envelope; PR-side keeps prior swallow-and-log (parent doc §6).
  const issueFetch = (async (): Promise<PartialWorkItemsResult> => {
    if (!issueScope) {
      return { items: [] }
    }
    if (!issueOwnerRepo) {
      return { items: [] }
    }
    const request = buildWorkItemListRequest({
      kind: 'issue',
      ownerRepo: issueOwnerRepo,
      limit,
      query,
      page: page ?? 1
    })
    try {
      const { stdout } = await ghExecFileAsync(request.args, {
        ...ghOptions,
        ...githubHostExecOptions(issueOwnerRepo)
      })
      const items = (JSON.parse(stdout) as Record<string, unknown>[])
        .filter((item) => !('pull_request' in item))
        .map(mapIssueWorkItem)
      successfulRequestCount += 1
      return { items }
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err)
      if (classifyGitHubUnavailable(stderr)) {
        availabilityError ??= err
      } else {
        nonAvailabilityFailureCount += 1
      }
      return { items: [], issuesError: classifyListIssuesError(stderr) }
    }
  })()

  const prFetch = (async (): Promise<MainWorkItem[]> => {
    if (!prScope) {
      return []
    }
    if (!prOwnerRepo) {
      return []
    }
    const request = buildWorkItemListRequest({
      kind: 'pr',
      ownerRepo: prOwnerRepo,
      limit,
      query,
      page: page ?? 1
    })
    try {
      const { stdout } = await ghExecFileAsync(request.args, {
        ...ghOptions,
        ...githubHostExecOptions(prOwnerRepo)
      })
      const mapped = (JSON.parse(stdout) as Record<string, unknown>[])
        .slice(request.offset, request.offset + limit)
        .map((item) => mapPullRequestWorkItem(item, prOwnerRepo))
      const hydrated = await hydrateWorkItemRepositoryMergeMetadata(mapped, prOwnerRepo, {
        ...ghOptions,
        ...githubHostExecOptions(prOwnerRepo)
      })
      successfulRequestCount += 1
      if (query.state === 'closed') {
        return hydrated.filter((item) => item.state !== 'merged')
      }
      return hydrated
    } catch (err) {
      console.warn('listQueriedWorkItems PRs partial failure:', err)
      const stderr = err instanceof Error ? err.message : String(err)
      if (classifyGitHubUnavailable(stderr)) {
        availabilityError ??= err
      } else {
        nonAvailabilityFailureCount += 1
      }
      return []
    }
  })()

  const [issueResult, prItems] = await Promise.all([issueFetch, prFetch])
  if (availabilityError && successfulRequestCount === 0 && nonAvailabilityFailureCount === 0) {
    // Why: when every half hit the same availability failure, propagate it so Tasks can distinguish an outage from no data.
    throw availabilityError
  }
  return {
    items: sortWorkItemsByNumber([...issueResult.items, ...prItems]).slice(0, limit),
    issuesError: issueResult.issuesError
  }
}

export async function listWorkItems(
  repoPath: string,
  limit = 24,
  query?: string,
  page?: number,
  preference?: IssueSourcePreference,
  connectionId?: string | null,
  noCache?: boolean,
  localGitOptions: LocalGitExecOptions = {}
): Promise<ListWorkItemsResult<MainWorkItem>> {
  const trimmedQuery = query?.trim() ?? ''
  const requestedPage = normalizeWorkItemPage(page)
  if (isGitHubWorkItemsQueryTooLarge(trimmedQuery)) {
    return {
      items: [],
      sources: {
        issues: null,
        prs: null,
        originCandidate: null,
        upstreamCandidate: null
      }
    }
  }
  const [issueResolved, prResolved] = await Promise.all([
    resolveIssueGitHubApiRepositorySource(repoPath, preference, connectionId, localGitOptions),
    resolvePrWorkItemSource(repoPath, preference, connectionId, localGitOptions)
  ])
  const issueOwnerRepo = issueResolved.source
  const prOwnerRepo = prResolved.source
  await acquire()
  try {
    // Why: let errors propagate to IPC — a catch-all would make failure indistinguishable from empty and under-report per-repo failures.
    const partial = !trimmedQuery
      ? await listRecentWorkItems(
          repoPath,
          issueOwnerRepo,
          prOwnerRepo,
          limit,
          requestedPage,
          connectionId,
          noCache,
          localGitOptions
        )
      : await listQueriedWorkItems(
          repoPath,
          issueOwnerRepo,
          prOwnerRepo,
          parseTaskQuery(trimmedQuery),
          limit,
          requestedPage,
          connectionId,
          localGitOptions
        )

    const errors = partial.issuesError ? { issues: partial.issuesError } : undefined
    return {
      items: partial.items,
      sources: {
        issues: issueOwnerRepo,
        prs: prOwnerRepo,
        originCandidate: prResolved.originCandidate,
        upstreamCandidate: prResolved.upstreamCandidate
      },
      ...(errors ? { errors } : {}),
      ...(issueResolved.fellBack ? { issueSourceFellBack: true } : {})
    }
  } finally {
    release()
  }
}
