import { pruneRepositoryMergeMetadataCache, MERGE_QUEUE_CACHE_TTL_MS, MERGE_QUEUE_UNKNOWN_CACHE_TTL_MS, repositoryMergeMetadataCache } from './github-client-foundation'
import type { GhExecOptions, GitHubRepositoryMergeMetadata } from './github-client-foundation'
import { normalizePRMergeable, normalizeReviewDecision, isAutoMergeEnabled } from './github-work-item-mapping'
import { PR_BRANCH_LIST_JSON_FIELDS } from './github-work-item-details'
import type { PullRequestLookupData, RestPullRequest } from './github-work-item-details'
import { getPRByNumber } from './github-pr-lookup'
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
} from './issues'
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
export type GitHubPRBranchLookupOptions = HostedReviewExecutionOptions & {
  acceptMergedFallbackPR?: boolean
  // Why: compare merged implicit PRs against the worktree HEAD, not main repo HEAD, without a worktree-scoped git call.
  currentHeadOid?: string | null
}

export function mapRestPRMergeable(pr: RestPullRequest): PRMergeableState {
  const mergeableState = pr.mergeable_state?.toLowerCase()
  if (mergeableState === 'dirty') {
    return 'CONFLICTING'
  }
  if (mergeableState === 'clean' || pr.mergeable === true) {
    return 'MERGEABLE'
  }
  return 'UNKNOWN'
}

export function derivePullRequestMergeable(data: PullRequestLookupData): PRMergeableState {
  const mergeable = normalizePRMergeable(data.mergeable)
  if (mergeable === 'CONFLICTING' || data.mergeStateStatus === 'DIRTY') {
    return 'CONFLICTING'
  }
  return mergeable ?? 'UNKNOWN'
}

export function mapRestPullRequest(pr: RestPullRequest): PullRequestLookupData {
  return {
    number: pr.number,
    title: pr.title,
    state: pr.merged_at ? 'MERGED' : pr.state,
    url: pr.html_url ?? pr.url ?? '',
    statusCheckRollup: [],
    updatedAt: pr.updated_at ?? '',
    isDraft: pr.draft,
    mergeable: mapRestPRMergeable(pr),
    baseRefName: pr.base?.ref,
    headRefName: pr.head?.ref,
    baseRefOid: pr.base?.sha,
    headRefOid: pr.head?.sha
  }
}

export function isMergedImplicitPR(data: PullRequestLookupData, linkedPRNumber?: number | null): boolean {
  // Why: a merged PR without an explicit link is just a historical branch match, not implicit review context.
  return typeof linkedPRNumber !== 'number' && mapPRState(data.state, data.isDraft) === 'merged'
}

export async function getCurrentHeadOid(
  repoPath: string,
  connectionId?: string | null,
  localGitOptions: { wslDistro?: string } = {}
): Promise<string | null> {
  try {
    const provider = connectionId ? getSshGitProvider(connectionId) : null
    const result = provider
      ? await provider.exec(['rev-parse', 'HEAD'], repoPath)
      : await gitExecFileAsync(['rev-parse', 'HEAD'], {
          cwd: repoPath,
          ...(localGitOptions.wslDistro ? { wslDistro: localGitOptions.wslDistro } : {})
        })
    return result.stdout.trim() || null
  } catch {
    return null
  }
}

export function shouldHideMergedImplicitPR(
  data: PullRequestLookupData | null,
  linkedPRNumber: number | null | undefined,
  currentHeadOid: string | null
): boolean {
  if (!data || !isMergedImplicitPR(data, linkedPRNumber)) {
    return false
  }
  // Why: keep hiding historical merged branch matches, but preserve the merged PR for the exact commit currently checked out.
  return !currentHeadOid || data.headRefOid !== currentHeadOid
}

export function normalizePullRequestLookupData(data: PullRequestLookupData): PullRequestLookupData {
  return {
    ...data,
    reviewDecision:
      data.reviewDecision !== undefined ? normalizeReviewDecision(data.reviewDecision) : undefined,
    autoMergeEnabled:
      data.autoMergeEnabled ??
      ('autoMergeRequest' in data ? isAutoMergeEnabled(data.autoMergeRequest) : undefined)
  }
}

export function cacheRepositoryMergeMetadata(
  cacheKey: string,
  value: GitHubRepositoryMergeMetadata,
  ttlMs: number
): void {
  const now = Date.now()
  pruneRepositoryMergeMetadataCache(now)
  // Why: merge metadata is keyed by user-controlled branch names; keep the cache bounded across many short-lived branches.
  repositoryMergeMetadataCache.delete(cacheKey)
  repositoryMergeMetadataCache.set(cacheKey, {
    value,
    expiresAt: now + ttlMs
  })
  pruneRepositoryMergeMetadataCache(now)
}

export async function detectRepositoryMergeMetadata(
  ownerRepo: GitHubApiRepository,
  branchName: string | undefined,
  ghOptions: GhExecOptions
): Promise<GitHubRepositoryMergeMetadata> {
  const cacheKey = `${githubRepoIdentityKey(ownerRepo)}:${branchName ?? '__repo__'}`
  pruneRepositoryMergeMetadataCache()
  const cached = repositoryMergeMetadataCache.get(cacheKey)
  if (cached) {
    return cached.value
  }
  const guard = repositoryRateLimitGuard(ownerRepo, 'graphql', ghOptions)
  if (guard.blocked) {
    return { mergeQueueRequired: null, autoMergeAllowed: null }
  }
  const query = branchName
    ? `query($owner: String!, $repo: String!, $branch: String!) {
    repository(owner: $owner, name: $repo) {
      viewerDefaultMergeMethod
      mergeCommitAllowed
      rebaseMergeAllowed
      squashMergeAllowed
      autoMergeAllowed
      mergeQueue(branch: $branch) { id }
    }
  }`
    : `query($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      viewerDefaultMergeMethod
      mergeCommitAllowed
      rebaseMergeAllowed
      squashMergeAllowed
      autoMergeAllowed
    }
  }`
  try {
    noteRepositoryRateLimitSpend(ownerRepo, 'graphql', 1, ghOptions)
    const args = [
      'api',
      'graphql',
      '-f',
      `query=${query}`,
      '-f',
      `owner=${ownerRepo.owner}`,
      '-f',
      `repo=${ownerRepo.repo}`
    ]
    if (branchName) {
      args.push('-f', `branch=${branchName}`)
    }
    const { stdout } = await ghExecFileAsync(args, {
      ...ghOptions,
      ...githubHostExecOptions(ownerRepo)
    })
    const parsed = JSON.parse(stdout) as {
      data?: {
        repository?: {
          viewerDefaultMergeMethod?: unknown
          mergeCommitAllowed?: unknown
          rebaseMergeAllowed?: unknown
          squashMergeAllowed?: unknown
          autoMergeAllowed?: unknown
          mergeQueue?: { id?: unknown } | null
        } | null
      }
    }
    const repository = parsed.data?.repository
    const mergeMethodSettings = repository
      ? normalizeGitHubPRMergeMethodSettings({
          defaultMethod: repository.viewerDefaultMergeMethod,
          mergeCommitAllowed: repository.mergeCommitAllowed,
          rebaseMergeAllowed: repository.rebaseMergeAllowed,
          squashMergeAllowed: repository.squashMergeAllowed
        })
      : undefined
    const value: GitHubRepositoryMergeMetadata = {
      mergeQueueRequired: branchName ? Boolean(repository?.mergeQueue) : null,
      autoMergeAllowed:
        typeof repository?.autoMergeAllowed === 'boolean' ? repository.autoMergeAllowed : null,
      ...(mergeMethodSettings ? { mergeMethodSettings } : {})
    }
    cacheRepositoryMergeMetadata(cacheKey, value, MERGE_QUEUE_CACHE_TTL_MS)
    return value
  } catch {
    // Why: cache a conservative result for failed merge-queue probes so we don't retry GraphQL on every poll while GitHub/network is unhappy.
    const value: GitHubRepositoryMergeMetadata = {
      mergeQueueRequired: null,
      autoMergeAllowed: null
    }
    cacheRepositoryMergeMetadata(cacheKey, value, MERGE_QUEUE_UNKNOWN_CACHE_TTL_MS)
    return value
  }
}

export async function hydratePullRequestLookupData(
  ownerRepo: OwnerRepo,
  data: PullRequestLookupData,
  ghOptions: GhExecOptions
): Promise<PullRequestLookupData> {
  const normalized = normalizePullRequestLookupData(data)
  const hasRichMergeFields =
    'reviewDecision' in data || 'mergeStateStatus' in data || 'autoMergeRequest' in data
  const mergeMetadata = hasRichMergeFields
    ? await detectRepositoryMergeMetadata(ownerRepo, normalized.baseRefName, ghOptions)
    : undefined
  return {
    ...normalized,
    ...(mergeMetadata ? { mergeQueueRequired: mergeMetadata.mergeQueueRequired } : {}),
    ...(mergeMetadata ? { autoMergeAllowed: mergeMetadata.autoMergeAllowed } : {}),
    ...(mergeMetadata?.mergeMethodSettings
      ? { mergeMethodSettings: mergeMetadata.mergeMethodSettings }
      : {})
  }
}

export async function hydrateBranchLookupWithExactPR(
  ownerRepo: OwnerRepo,
  branchData: PullRequestLookupData | null,
  ghOptions: GhExecOptions
): Promise<PullRequestLookupData | null> {
  if (!branchData) {
    return null
  }
  try {
    return (await getPRByNumber(ownerRepo, branchData.number, ghOptions)) ?? branchData
  } catch {
    return branchData
  }
}

export async function getRestPRForBranch(
  prRepo: GitHubApiRepository,
  headOwner: string,
  branchName: string,
  ghOptions: ReturnType<typeof ghRepoExecOptions>
): Promise<PullRequestLookupData | null> {
  const head = encodeURIComponent(`${headOwner}:${branchName}`)
  const { stdout } = await ghExecFileAsync(
    ['api', `repos/${prRepo.owner}/${prRepo.repo}/pulls?head=${head}&state=all&per_page=1`],
    { ...ghOptions, ...githubHostExecOptions(prRepo) }
  )
  const list = JSON.parse(stdout) as RestPullRequest[]
  const pr = list[0]
  return pr ? mapRestPullRequest(pr) : null
}

export async function getFallbackPRListForBranch(
  prRepo: GitHubApiRepository,
  branchName: string,
  ghOptions: ReturnType<typeof ghRepoExecOptions>
): Promise<PullRequestLookupData | null> {
  const { stdout } = await ghExecFileAsync(
    [
      'pr',
      'list',
      '--repo',
      `${prRepo.owner}/${prRepo.repo}`,
      '--head',
      branchName,
      '--state',
      'all',
      '--limit',
      '1',
      '--json',
      PR_BRANCH_LIST_JSON_FIELDS
    ],
    { ...ghOptions, ...githubHostExecOptions(prRepo) }
  )
  const list = JSON.parse(stdout) as PullRequestLookupData[]
  return list[0] ?? null
}

export type TrackedUpstreamBranch = {
  remoteName: string
  branchName: string
}

export const TRACKED_UPSTREAM_SNAPSHOT_CACHE_TTL_MS = 30_000
export const TRACKED_UPSTREAM_SNAPSHOT_CACHE_MAX_ENTRIES = 512

export type TrackedUpstreamSnapshotCacheEntry = {
  expiresAt: number
  gitConfigSignature?: string
  upstreamsByBranchName: Map<string, TrackedUpstreamBranch | null>
}

export type TrackedUpstreamSnapshotProbeResult = {
  cacheable: boolean
  gitConfigSignature?: string
  probeFailed: boolean
  upstreamsByBranchName: Map<string, TrackedUpstreamBranch | null>
}

export const trackedUpstreamSnapshotCache = new Map<string, TrackedUpstreamSnapshotCacheEntry>()
export const trackedUpstreamSnapshotInFlight = new Map<
  string,
  Promise<TrackedUpstreamSnapshotProbeResult>
>()
export const trackedUpstreamSnapshotGenerations = new Map<string, symbol>()

export function beginTrackedUpstreamSnapshotProbe(cacheKey: string): symbol {
  const generation = Symbol()
  trackedUpstreamSnapshotGenerations.set(cacheKey, generation)
  return generation
}

export function finishTrackedUpstreamSnapshotProbe(cacheKey: string, generation: symbol): void {
  // Why: generations only guard an active probe; retaining completed keys leaks worktree/runtime identities past the snapshot TTL.
  if (trackedUpstreamSnapshotGenerations.get(cacheKey) === generation) {
    trackedUpstreamSnapshotGenerations.delete(cacheKey)
  }
}

export function pruneTrackedUpstreamSnapshotCache(now: number): void {
  for (const [cacheKey, cached] of trackedUpstreamSnapshotCache) {
    if (cached.expiresAt <= now) {
      trackedUpstreamSnapshotCache.delete(cacheKey)
    }
  }
  // Why: workspace/runtime churn can create unbounded unique keys within one TTL window, so expiry sweeping alone isn't a memory bound.
  while (trackedUpstreamSnapshotCache.size > TRACKED_UPSTREAM_SNAPSHOT_CACHE_MAX_ENTRIES) {
    const oldestKey = trackedUpstreamSnapshotCache.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    trackedUpstreamSnapshotCache.delete(oldestKey)
  }
}

export function _getTrackedUpstreamBranchCacheSizesForTests(): {
  snapshots: number
  inFlight: number
  generations: number
} {
  return {
    snapshots: trackedUpstreamSnapshotCache.size,
    inFlight: trackedUpstreamSnapshotInFlight.size,
    generations: trackedUpstreamSnapshotGenerations.size
  }
}

export function __resetTrackedUpstreamBranchCacheForTests(): void {
  trackedUpstreamSnapshotCache.clear()
  trackedUpstreamSnapshotInFlight.clear()
  trackedUpstreamSnapshotGenerations.clear()
}

export function parseTrackedUpstreamBranch(upstreamRef: string): TrackedUpstreamBranch | null {
  const parsed = splitRemoteBranchName(upstreamRef.trim())
  if (!parsed) {
    return null
  }
  return parsed
}

export function shouldRetryTrackedUpstreamBranch(
  upstreamBranch: TrackedUpstreamBranch,
  branchName: string,
  upstreamHeadRepo: OwnerRepo,
  headRepo: OwnerRepo | null
): boolean {
  if (upstreamBranch.branchName !== branchName) {
    return true
  }
  if (!headRepo) {
    return true
  }
  return githubRepoIdentityKey(upstreamHeadRepo) !== githubRepoIdentityKey(headRepo)
}
