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
export type MainWorkItem = Omit<GitHubWorkItem, 'repoId'>

// Why: issue numbers follow creation order, so this sort aligns gh's PR rows with numbered Search API issue pages.
export const WORK_ITEM_NUMBER_SORT_QUALIFIER = 'sort:created-desc'

export const WORK_ITEM_PR_LIST_JSON_FIELDS =
  'number,title,state,url,labels,updatedAt,author,isDraft,headRefName,baseRefName,headRefOid,headRepositoryOwner,reviewRequests'

// Why: kept out of `gh pr list` — statusCheckRollup/reviewDecision/merge metadata fan out into expensive per-row GraphQL.
// Requested reviewers stay in the list payload because Tasks renders that column on first paint.
export const WORK_ITEM_PR_DETAIL_JSON_FIELDS =
  'number,title,state,url,labels,updatedAt,author,isDraft,headRefName,baseRefName,headRefOid,headRepositoryOwner,additions,deletions,changedFiles,reviewDecision,reviewRequests,latestReviews,assignees,statusCheckRollup,mergeable,mergeStateStatus,autoMergeRequest,maintainerCanModify'

export function mapIssueWorkItem(item: Record<string, unknown>): MainWorkItem {
  return {
    id: `issue:${String(item.number)}`,
    type: 'issue',
    number: Number(item.number),
    title: String(item.title ?? ''),
    state: String(item.state ?? 'open') === 'closed' ? 'closed' : 'open',
    url: String(item.html_url ?? item.url ?? ''),
    labels: Array.isArray(item.labels)
      ? item.labels
          .map((label) =>
            typeof label === 'object' && label !== null && 'name' in label
              ? String((label as { name?: unknown }).name ?? '')
              : ''
          )
          .filter(Boolean)
      : [],
    updatedAt: String(item.updated_at ?? item.updatedAt ?? ''),
    ...authorFieldsFromUnknown(item),
    ...(item.assignees !== undefined ? { assignees: usersFromUnknown(item.assignees) } : {})
  }
}

/**
 * Derive author login + avatar_url together so GHE avatars render — the login-only
 * `{login}.png` URL 404s on GHE. REST uses `user.avatar_url`, gh/GraphQL `author.avatarUrl` (#8784).
 */
export function authorFieldsFromUnknown(
  item: Record<string, unknown>
): Pick<MainWorkItem, 'author' | 'authorAvatarUrl'> {
  const user = userFromUnknown(item.user ?? item.author)
  if (!user) {
    return { author: null }
  }
  return {
    author: user.login,
    ...(user.avatarUrl ? { authorAvatarUrl: user.avatarUrl } : {})
  }
}

export function extractHeadOwnerLogin(item: Record<string, unknown>): string | null {
  // gh CLI `pr list --json headRepositoryOwner` shape: { login }
  if (typeof item.headRepositoryOwner === 'object' && item.headRepositoryOwner !== null) {
    const login = (item.headRepositoryOwner as { login?: unknown }).login
    if (typeof login === 'string' && login.trim()) {
      return login
    }
  }
  // REST API `pull_request` shape: head.repo.owner.login
  if (typeof item.head === 'object' && item.head !== null) {
    const head = item.head as { repo?: unknown; user?: unknown; label?: unknown }
    const repo = head.repo
    if (typeof repo === 'object' && repo !== null) {
      const owner = (repo as { owner?: unknown }).owner
      if (typeof owner === 'object' && owner !== null) {
        const login = (owner as { login?: unknown }).login
        if (typeof login === 'string' && login.trim()) {
          return login
        }
      }
    }
    // Why: a deleted/inaccessible fork returns head.repo = null but still has head.user/head.label.
    const user = head.user
    if (typeof user === 'object' && user !== null) {
      const login = (user as { login?: unknown }).login
      if (typeof login === 'string' && login.trim()) {
        return login
      }
    }
    if (typeof head.label === 'string') {
      const owner = head.label.split(':', 1)[0]?.trim()
      if (owner) {
        return owner
      }
    }
  }
  return null
}

export function userFromUnknown(
  value: unknown
): { login: string; name: string | null; avatarUrl: string } | null {
  if (typeof value === 'string') {
    const login = value.trim()
    return login ? { login, name: null, avatarUrl: '' } : null
  }
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const raw = value as Record<string, unknown>
  const login = typeof raw.login === 'string' ? raw.login.trim() : ''
  if (!login) {
    return null
  }
  const databaseId = numberFromUnknown(raw.databaseId)
  return {
    login,
    name: typeof raw.name === 'string' ? raw.name : null,
    avatarUrl:
      typeof raw.avatarUrl === 'string'
        ? raw.avatarUrl
        : typeof raw.avatar_url === 'string'
          ? raw.avatar_url
          : databaseId !== undefined
            ? `https://avatars.githubusercontent.com/u/${databaseId}?v=4`
            : ''
  }
}

export function usersFromUnknown(
  value: unknown
): { login: string; name: string | null; avatarUrl: string }[] {
  if (!Array.isArray(value)) {
    return []
  }
  const users: { login: string; name: string | null; avatarUrl: string }[] = []
  for (const entry of value) {
    const direct = userFromUnknown(entry)
    if (direct) {
      users.push(direct)
      continue
    }
    if (typeof entry === 'object' && entry !== null) {
      const raw = entry as Record<string, unknown>
      const nested = userFromUnknown(raw.requestedReviewer ?? raw.user ?? raw.author)
      if (nested) {
        users.push(nested)
      }
    }
  }
  return users
}

export function latestReviewsFromUnknown(value: unknown): NonNullable<GitHubWorkItem['latestReviews']> {
  if (!Array.isArray(value)) {
    return []
  }
  const reviews: NonNullable<GitHubWorkItem['latestReviews']> = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const raw = entry as Record<string, unknown>
    const author = userFromUnknown(raw.author)
    if (!author) {
      continue
    }
    reviews.push({
      login: author.login,
      state: typeof raw.state === 'string' ? raw.state : null,
      avatarUrl: author.avatarUrl
    })
  }
  return reviews
}

export function numberFromUnknown(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

export function normalizePRMergeable(value: unknown): PRMergeableState | undefined {
  const raw = typeof value === 'string' ? value.toUpperCase() : ''
  if (raw === 'MERGEABLE' || raw === 'CONFLICTING' || raw === 'UNKNOWN') {
    return raw
  }
  if (typeof value === 'boolean') {
    return value ? 'MERGEABLE' : 'CONFLICTING'
  }
  return undefined
}

export function normalizeReviewDecision(value: unknown): PRReviewDecision | null {
  return value === 'APPROVED' || value === 'CHANGES_REQUESTED' || value === 'REVIEW_REQUIRED'
    ? value
    : null
}

export function isAutoMergeEnabled(value: unknown): boolean {
  return typeof value === 'object' && value !== null
}

export function checkRollupEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value
  }
  if (typeof value !== 'object' || value === null) {
    return []
  }
  const raw = value as Record<string, unknown>
  const nodes = (raw.contexts as { nodes?: unknown } | undefined)?.nodes
  return Array.isArray(nodes) ? nodes : []
}

export function deriveWorkItemCheckSummary(value: unknown): GitHubWorkItem['checksSummary'] {
  return summarizeProviderChecks(
    checkRollupEntries(value).map((entry) => {
      if (typeof entry !== 'object' || entry === null) {
        return { status: '', conclusion: '' }
      }
      const raw = entry as Record<string, unknown>
      // Why: StatusContext reports `state` and carries no `status`; CheckRun reports both.
      return {
        status: String(raw.status ?? ''),
        conclusion: String(raw.conclusion ?? raw.state ?? '')
      }
    })
  )
}

export function mapPullRequestWorkItem(
  item: Record<string, unknown>,
  baseOwnerRepo: OwnerRepo | null = null
): MainWorkItem {
  // Why: fork PRs are disabled in the Start-from picker; compare head owner to the selected repo's owner.
  const headOwnerLogin = extractHeadOwnerLogin(item)
  // Why: leave isCrossRepository undefined when the head owner is unknown, rather than falsely claiming "not a fork".
  const isCrossRepository =
    headOwnerLogin !== null && baseOwnerRepo !== null
      ? headOwnerLogin !== baseOwnerRepo.owner
      : null
  const state = String(item.state ?? '').toLowerCase()
  const additions = numberFromUnknown(item.additions)
  const deletions = numberFromUnknown(item.deletions)
  const changedFiles = numberFromUnknown(
    item.changedFiles ??
      item.changed_files ??
      (item.files as { totalCount?: unknown } | undefined)?.totalCount
  )
  const mergeable = normalizePRMergeable(item.mergeable)
  const headSha =
    typeof item.headRefOid === 'string'
      ? item.headRefOid
      : typeof item.head === 'object' && item.head !== null
        ? typeof (item.head as { sha?: unknown }).sha === 'string'
          ? (item.head as { sha: string }).sha
          : undefined
        : undefined
  return {
    id: `pr:${String(item.number)}`,
    type: 'pr',
    number: Number(item.number),
    title: String(item.title ?? ''),
    state:
      state === 'merged' || item.merged_at || item.mergedAt
        ? 'merged'
        : state === 'closed'
          ? 'closed'
          : item.isDraft || item.draft
            ? 'draft'
            : 'open',
    url: String(item.html_url ?? item.url ?? ''),
    labels: Array.isArray(item.labels)
      ? item.labels
          .map((label) =>
            typeof label === 'object' && label !== null && 'name' in label
              ? String((label as { name?: unknown }).name ?? '')
              : ''
          )
          .filter(Boolean)
      : [],
    updatedAt: String(item.updated_at ?? item.updatedAt ?? ''),
    ...authorFieldsFromUnknown(item),
    branchName:
      typeof item.head === 'object' && item.head !== null && 'ref' in item.head
        ? String((item.head as { ref?: unknown }).ref ?? '')
        : String(item.headRefName ?? ''),
    baseRefName:
      typeof item.base === 'object' && item.base !== null && 'ref' in item.base
        ? String((item.base as { ref?: unknown }).ref ?? '')
        : String(item.baseRefName ?? ''),
    ...(headSha ? { headSha } : {}),
    ...(baseOwnerRepo
      ? {
          prRepo: {
            owner: baseOwnerRepo.owner,
            repo: baseOwnerRepo.repo,
            ...(baseOwnerRepo.host ? { host: baseOwnerRepo.host } : {})
          }
        }
      : {}),
    ...(additions !== undefined ? { additions } : {}),
    ...(deletions !== undefined ? { deletions } : {}),
    ...(changedFiles !== undefined ? { changedFiles } : {}),
    ...('reviewDecision' in item
      ? { reviewDecision: normalizeReviewDecision(item.reviewDecision) }
      : {}),
    ...(item.reviewRequests !== undefined || item.requested_reviewers !== undefined
      ? { reviewRequests: usersFromUnknown(item.reviewRequests ?? item.requested_reviewers) }
      : {}),
    ...(item.latestReviews !== undefined
      ? { latestReviews: latestReviewsFromUnknown(item.latestReviews) }
      : {}),
    ...(item.assignees !== undefined ? { assignees: usersFromUnknown(item.assignees) } : {}),
    ...(item.statusCheckRollup !== undefined
      ? { checksSummary: deriveWorkItemCheckSummary(item.statusCheckRollup) }
      : {}),
    ...(mergeable ? { mergeable } : {}),
    ...('autoMergeRequest' in item
      ? { autoMergeEnabled: isAutoMergeEnabled(item.autoMergeRequest) }
      : {}),
    ...('mergeStateStatus' in item
      ? {
          mergeStateStatus: typeof item.mergeStateStatus === 'string' ? item.mergeStateStatus : null
        }
      : {}),
    ...(typeof item.maintainerCanModify === 'boolean'
      ? { maintainerCanModify: item.maintainerCanModify }
      : {}),
    ...(isCrossRepository !== null ? { isCrossRepository } : {})
  }
}
