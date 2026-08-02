import { resolvePullRequestLookupCandidates } from './github-client-foundation'
import type { GhExecOptions } from './github-client-foundation'
import { mapIssueWorkItem, usersFromUnknown, latestReviewsFromUnknown, mapPullRequestWorkItem, WORK_ITEM_NUMBER_SORT_QUALIFIER, WORK_ITEM_PR_LIST_JSON_FIELDS, WORK_ITEM_PR_DETAIL_JSON_FIELDS } from './github-work-item-mapping'
import type { MainWorkItem } from './github-work-item-mapping'
import { listWorkItems } from './github-work-item-listing'
import { quoteGitHubSearchValue } from './github-work-item-count'
import { detectRepositoryMergeMetadata } from './github-pr-branch-state'
import type {
  ClassifiedError,
  GitPushTarget,
  IssueSourcePreference,
  ListWorkItemsResult,
  PRInfo,
  PRConflictSummary,
  PRRefreshOutcome,
  PRMergeableState,
  PRReviewDecision,
  PRCheckDetail,
  PRCheckRunDetails,
  GitHubCommentResult,
  GitHubPRReviewCommentInput,
  PRComment,
  GitHubViewer,
  GitHubWorkItem,
  GitHubPullRequestStateUpdate,
  GitHubRerunPRChecksResult,
  GitHubPRMergeMethod,
  GitHubPRMergeMethodSettings
} from '../../shared/types'
import type { CreateHostedReviewInput, CreateHostedReviewResult } from '../../shared/hosted-review'
import {
  normalizeHostedReviewBaseRef,
  normalizeHostedReviewHeadRef
} from '../../shared/hosted-review-refs'
import { normalizeGitHubPRMergeMethodSettings } from '../../shared/github-pr-merge-methods'
import { summarizeProviderChecks } from '../../shared/provider-check-summary'
import { isGitHubWorkItemsQueryTooLarge } from '../../shared/github-work-items-query-bounds'
import { classifyGitHubUnavailable } from '../../shared/github-api-availability'
import { parseTaskQuery, type ParsedTaskQuery } from '../../shared/task-query'
import {
  GITHUB_WORK_ITEMS_SSH_REMOTE_REQUIRED_MESSAGE,
  sortWorkItemsByNumber
} from '../../shared/work-items'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sliceCheckLogTail } from './check-job-log-tail-slice'
import {
  classifyPRRefreshError,
  safePRRefreshErrorMessage
} from './pr-refresh-error-classification'
import { getPRConflictSummary } from './conflict-summary'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { joinWorktreeRelativePath } from '../runtime/runtime-relative-paths'
import { splitRemoteBranchName } from '../../shared/git-effective-upstream'
import {
  execFileAsync,
  ghExecFileAsync,
  gitExecFileAsync,
  acquire,
  release,
  classifyGhError,
  classifyListIssuesError,
  ghRepoExecOptions,
  githubRepoContext,
  getRemoteUrlForRepo,
  type LocalGitExecOptions,
  type OwnerRepo
} from './gh-utils'
// Why: import from the lightweight module (not ./gh-utils) so tests mocking gh-utils still get the real functions.
import { extractExecError, parseRetryAfterMs } from '../git/exec-error'
import {
  isCommitPartOfMergedPR,
  type MergedPRCommitMembership
} from './merged-pr-commit-membership'
import { getSshGitProvider } from '../providers/ssh-git-dispatch'
import {
  hasHostedReviewLocalGitOptions,
  getHostedReviewLocalGitOptions,
  type HostedReviewExecutionOptions
} from '../source-control/hosted-review-git-options'
import { shouldHideNonOpenReviewOnDefaultBranch } from '../source-control/repo-default-branch'
import { readLocalGitConfigSignature } from './local-git-config-signature'
import {
  getGitHubApiRepositoryForRemote,
  getOriginGitHubApiRepository,
  githubHostExecOptions,
  githubRepositorySlugArg,
  githubRepositoryWebHost,
  resolveGitHubApiRepository,
  resolveGitHubApiRepositoryCandidates,
  resolveGitHubRepoExecution,
  resolveIssueGitHubApiRepositorySource,
  type GitHubRepoExecOptions,
  type GitHubApiRepository
} from './github-api-repository'
import {
  mapCheckRunRESTStatus,
  mapCheckRunRESTConclusion,
  mapCommitStatusRESTStatus,
  mapCommitStatusRESTConclusion,
  mapCheckStatus,
  mapCheckConclusion,
  mapPRState,
  deriveCheckStatus
} from './mappers'
import { mapGraphQLReactionGroups, type GitHubGraphQLReactionGroup } from './comment-reactions'
import {
  getRateLimit,
  noteRepositoryRateLimitSpend,
  repositoryRateLimitGuard,
  spendsSharedGitHubComQuota,
  type RateLimitBucketKind
} from './rate-limit'
export async function hydrateWorkItemRepositoryMergeMetadata(
  items: MainWorkItem[],
  ownerRepo: OwnerRepo | null,
  ghOptions: GhExecOptions
): Promise<MainWorkItem[]> {
  const hasPullRequest = items.some((item) => item.type === 'pr')
  if (!ownerRepo || !hasPullRequest) {
    return items
  }
  // Why: merge settings are repo-level, so one cached probe keeps Tasks rows accurate without per-PR GraphQL fan-out.
  const mergeMetadata = await detectRepositoryMergeMetadata(ownerRepo, undefined, ghOptions)
  if (!mergeMetadata.mergeMethodSettings && mergeMetadata.autoMergeAllowed === null) {
    return items
  }
  return items.map((item) =>
    item.type === 'pr'
      ? {
          ...item,
          ...(mergeMetadata.autoMergeAllowed !== null
            ? { autoMergeAllowed: mergeMetadata.autoMergeAllowed }
            : {}),
          ...(mergeMetadata.mergeMethodSettings
            ? { mergeMethodSettings: mergeMetadata.mergeMethodSettings }
            : {})
        }
      : item
  )
}

export async function fetchIssueWorkItem(
  repoPath: string,
  ownerRepo: GitHubApiRepository | null,
  number: number,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<MainWorkItem | null> {
  const ghOptions = {
    ...ghRepoExecOptions(githubRepoContext(repoPath, connectionId, localGitOptions)),
    ...githubHostExecOptions(ownerRepo)
  }
  if (ownerRepo) {
    const { stdout } = await ghExecFileAsync(
      ['api', `repos/${ownerRepo.owner}/${ownerRepo.repo}/issues/${number}`],
      ghOptions
    )
    const item = JSON.parse(stdout) as Record<string, unknown>
    if ('pull_request' in item) {
      return null
    }
    return mapIssueWorkItem(item)
  }

  if (connectionId) {
    // Why: SSH-backed gh has no repository cwd. A bare lookup could honor the
    // local process GH_REPO/GH_HOST and return an unrelated repository item.
    return null
  }

  const { stdout } = await ghExecFileAsync(
    ['issue', 'view', String(number), '--json', 'number,title,state,url,labels,updatedAt,author'],
    ghOptions
  )
  return mapIssueWorkItem(JSON.parse(stdout) as Record<string, unknown>)
}

// Why: REST /pulls/{n} lacks latestReviews, so pull review fields from gh so reviewer lists aren't silently empty.
export const WORK_ITEM_PR_REVIEW_JSON_FIELDS = 'reviewRequests,latestReviews'

export async function fetchPullRequestReviewFields(
  number: number,
  ownerRepo: GitHubApiRepository | null,
  ghOptions: GhExecOptions
): Promise<Pick<MainWorkItem, 'reviewRequests' | 'latestReviews'>> {
  try {
    const args = ownerRepo
      ? [
          'pr',
          'view',
          String(number),
          '--repo',
          `${ownerRepo.owner}/${ownerRepo.repo}`,
          '--json',
          WORK_ITEM_PR_REVIEW_JSON_FIELDS
        ]
      : ['pr', 'view', String(number), '--json', WORK_ITEM_PR_REVIEW_JSON_FIELDS]
    const { stdout } = await ghExecFileAsync(args, ghOptions)
    const item = JSON.parse(stdout) as Record<string, unknown>
    return {
      ...(item.reviewRequests !== undefined
        ? { reviewRequests: usersFromUnknown(item.reviewRequests) }
        : {}),
      ...(item.latestReviews !== undefined
        ? { latestReviews: latestReviewsFromUnknown(item.latestReviews) }
        : {})
    }
  } catch {
    return {}
  }
}

export async function fetchPullRequestWorkItem(
  repoPath: string,
  ownerRepo: GitHubApiRepository | null,
  number: number,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<MainWorkItem | null> {
  const ghOptions = {
    ...ghRepoExecOptions(githubRepoContext(repoPath, connectionId, localGitOptions)),
    ...githubHostExecOptions(ownerRepo)
  }
  if (ownerRepo) {
    try {
      const { stdout } = await ghExecFileAsync(
        [
          'pr',
          'view',
          String(number),
          '--repo',
          `${ownerRepo.owner}/${ownerRepo.repo}`,
          '--json',
          WORK_ITEM_PR_DETAIL_JSON_FIELDS
        ],
        ghOptions
      )
      const item = JSON.parse(stdout) as Record<string, unknown>
      const mapped = mapPullRequestWorkItem(item, ownerRepo)
      // Why: merge-metadata GraphQL is best-effort — don't fall through to REST, which drops latestReviews and blanks bot-only reviewer lists.
      const baseRefName = typeof item.baseRefName === 'string' ? item.baseRefName : undefined
      try {
        const mergeMetadata = await detectRepositoryMergeMetadata(ownerRepo, baseRefName, ghOptions)
        return {
          ...mapped,
          mergeQueueRequired: mergeMetadata.mergeQueueRequired,
          ...(mergeMetadata.autoMergeAllowed !== null
            ? { autoMergeAllowed: mergeMetadata.autoMergeAllowed }
            : {}),
          ...(mergeMetadata.mergeMethodSettings
            ? { mergeMethodSettings: mergeMetadata.mergeMethodSettings }
            : {})
        }
      } catch {
        return mapped
      }
    } catch {
      const { stdout } = await ghExecFileAsync(
        ['api', `repos/${ownerRepo.owner}/${ownerRepo.repo}/pulls/${number}`],
        ghOptions
      )
      const mapped = mapPullRequestWorkItem(
        JSON.parse(stdout) as Record<string, unknown>,
        ownerRepo
      )
      const reviewFields = await fetchPullRequestReviewFields(number, ownerRepo, ghOptions)
      return { ...mapped, ...reviewFields }
    }
  }

  if (connectionId) {
    // Why: connection-backed gh cannot infer a repository from cwd. Refuse a
    // bare call so process-level GH_REPO/GH_HOST cannot redirect the lookup.
    return null
  }

  const { stdout } = await ghExecFileAsync(
    ['pr', 'view', String(number), '--json', WORK_ITEM_PR_DETAIL_JSON_FIELDS],
    ghOptions
  )
  return mapPullRequestWorkItem(JSON.parse(stdout) as Record<string, unknown>)
}

export async function fetchPullRequestWorkItemFromCandidates(
  repoPath: string,
  number: number,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {},
  preference?: IssueSourcePreference
): Promise<MainWorkItem | null> {
  const candidates = await resolvePullRequestLookupCandidates(
    repoPath,
    preference,
    connectionId,
    localGitOptions
  )
  if (candidates.length === 0) {
    if (preference === 'origin') {
      return null
    }
    return fetchPullRequestWorkItem(repoPath, null, number, connectionId, localGitOptions)
  }
  for (const candidate of candidates) {
    try {
      return await fetchPullRequestWorkItem(
        repoPath,
        candidate,
        number,
        connectionId,
        localGitOptions
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const classification = classifyGhError(message).type
      if (classification !== 'not_found' && classification !== 'permission_denied') {
        throw err
      }
    }
  }
  return null
}

export type WorkItemListRequest = {
  args: string[]
  offset: number
}

export function normalizeWorkItemPage(page: number | undefined): number {
  return typeof page === 'number' && Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1
}

export function buildWorkItemListRequest(args: {
  kind: 'issue' | 'pr'
  ownerRepo: OwnerRepo
  limit: number
  query: ParsedTaskQuery
  page: number
}): WorkItemListRequest {
  const { kind, ownerRepo, limit, query, page } = args
  const searchParts: string[] = []

  if (kind === 'issue') {
    searchParts.push(`repo:${ownerRepo.owner}/${ownerRepo.repo}`)
  }
  searchParts.push(kind === 'issue' ? 'is:issue' : 'is:pr')

  if (query.state === 'open') {
    searchParts.push('is:open')
  } else if (query.state === 'closed') {
    searchParts.push('is:closed')
    if (kind === 'pr') {
      searchParts.push('-is:merged')
    }
  } else if (query.state === 'merged') {
    searchParts.push('is:merged')
  }

  if (kind === 'pr' && query.draft) {
    searchParts.push('draft:true')
  }

  if (query.assignee) {
    searchParts.push(`assignee:${quoteGitHubSearchValue(query.assignee)}`)
  }
  if (query.author) {
    searchParts.push(`author:${quoteGitHubSearchValue(query.author)}`)
  }
  if (query.labels.length > 0) {
    for (const label of query.labels) {
      searchParts.push(`label:${quoteGitHubSearchValue(label)}`)
    }
  }
  if (kind === 'pr' && query.reviewRequested) {
    searchParts.push(`review-requested:${quoteGitHubSearchValue(query.reviewRequested)}`)
  }
  if (kind === 'pr' && query.reviewedBy) {
    searchParts.push(`reviewed-by:${quoteGitHubSearchValue(query.reviewedBy)}`)
  }
  if (query.freeText) {
    searchParts.push(query.freeText)
  }

  if (kind === 'issue') {
    return {
      args: [
        'api',
        '--cache',
        '120s',
        `search/issues?q=${encodeURIComponent(searchParts.join(' '))}&sort=created&order=desc&per_page=${limit}&page=${page}`,
        '--jq',
        '.items'
      ],
      offset: 0
    }
  }

  // Why: search/issues omits the PR fields the Tasks columns need; use gh's rich PR list on a stable created sort.
  searchParts.push(WORK_ITEM_NUMBER_SORT_QUALIFIER)
  const out = [
    'pr',
    'list',
    '--limit',
    String(Math.min(page * limit, 1000)),
    '--state',
    'all',
    '--json',
    WORK_ITEM_PR_LIST_JSON_FIELDS
  ]
  out.push('--repo', `${ownerRepo.owner}/${ownerRepo.repo}`)
  out.push('--search', searchParts.join(' '))
  return { args: out, offset: (page - 1) * limit }
}

// Why: shared shape so listWorkItems can lift the issue-side error (#1076 silent wrongness) into the IPC envelope; PR errors out of scope (§6).
export type PartialWorkItemsResult = {
  items: MainWorkItem[]
  issuesError?: ClassifiedError
}

export function assertSshRepoHasResolvedGitHubSource(args: {
  connectionId?: string | null
  issueOwnerRepo: OwnerRepo | null
  prOwnerRepo: OwnerRepo | null
}): void {
  if (!args.connectionId || args.issueOwnerRepo || args.prOwnerRepo) {
    return
  }
  // Why: SSH repo paths are remote-only, so without a resolved owner/repo gh would query local state.
  throw new Error(GITHUB_WORK_ITEMS_SSH_REMOTE_REQUIRED_MESSAGE)
}

export type ResolvedPrWorkItemSource = {
  source: OwnerRepo | null
  originCandidate: OwnerRepo | null
  upstreamCandidate: OwnerRepo | null
}

export async function resolvePrWorkItemSource(
  repoPath: string,
  preference: IssueSourcePreference | undefined,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<ResolvedPrWorkItemSource> {
  const [originCandidate, upstreamCandidate] = await Promise.all([
    getOriginGitHubApiRepository(repoPath, connectionId, localGitOptions),
    getGitHubApiRepositoryForRemote(repoPath, 'upstream', connectionId, localGitOptions)
  ])
  // Why: fork-contribution PRs live on the upstream repo (the fork's own PR
  // list is almost always empty), so 'auto' resolves upstream-first exactly
  // like the issue side. Only an explicit 'origin' pick pins PRs to the fork.
  const source = preference === 'origin' ? originCandidate : (upstreamCandidate ?? originCandidate)
  return { source, originCandidate, upstreamCandidate }
}
