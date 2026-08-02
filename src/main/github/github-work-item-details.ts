import type { MainWorkItem } from './github-work-item-mapping'
import { fetchIssueWorkItem, fetchPullRequestWorkItem, fetchPullRequestWorkItemFromCandidates } from './github-work-item-fetch'
import { listWorkItems } from './github-work-item-listing'
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
import { githubRepoIdentityKey } from '../../shared/github-repository-identity-key'
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
export async function getWorkItem(
  repoPath: string,
  number: number,
  type?: 'issue' | 'pr',
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {},
  preference?: IssueSourcePreference
): Promise<MainWorkItem | null> {
  await acquire()
  try {
    // Why: listWorkItems uses resolveIssueGitHubApiRepositorySource; open-by-number
    // must share that preference so origin/upstream toggles cannot disagree.
    if (type === 'issue') {
      const { source } = await resolveIssueGitHubApiRepositorySource(
        repoPath,
        preference,
        connectionId,
        localGitOptions
      )
      // Why: explicit origin with no origin identity must not bare-lookup ambient gh
      // (same fail-closed rule as origin-pinned PR candidate resolution).
      if (!source && preference === 'origin') {
        return null
      }
      return await fetchIssueWorkItem(repoPath, source, number, connectionId, localGitOptions)
    }
    if (type === 'pr') {
      return await fetchPullRequestWorkItemFromCandidates(
        repoPath,
        number,
        connectionId,
        localGitOptions,
        preference
      )
    }

    try {
      const { source } = await resolveIssueGitHubApiRepositorySource(
        repoPath,
        preference,
        connectionId,
        localGitOptions
      )
      if (source || preference !== 'origin') {
        const issue = await fetchIssueWorkItem(
          repoPath,
          source,
          number,
          connectionId,
          localGitOptions
        )
        if (issue) {
          return issue
        }
      }
    } catch (err) {
      // Why: only fall through to PR #N on a genuine 404; re-throw transient errors so a flake can't surface an unrelated PR.
      const stderr = err instanceof Error ? err.message : String(err)
      if (classifyGhError(stderr).type !== 'not_found') {
        throw err
      }
    }
    return await fetchPullRequestWorkItemFromCandidates(
      repoPath,
      number,
      connectionId,
      localGitOptions,
      preference
    )
  } catch {
    return null
  } finally {
    release()
  }
}

export async function getWorkItemByOwnerRepo(
  repoPath: string,
  ownerRepo: GitHubApiRepository,
  number: number,
  type: 'issue' | 'pr',
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<MainWorkItem | null> {
  const requestedHost = ownerRepo.host?.trim().toLowerCase()
  const requestedRepository = requestedHost
    ? { ...ownerRepo, host: requestedHost }
    : await resolveGitHubApiRepository(repoPath, ownerRepo, connectionId, localGitOptions)
  if (!requestedRepository) {
    return null
  }
  const { candidates } = await resolveGitHubApiRepositoryCandidates(
    repoPath,
    connectionId,
    localGitOptions
  )
  const requestedKey = githubRepoIdentityKey(requestedRepository)
  const matchedRepository = candidates.find(
    (candidate) => githubRepoIdentityKey(candidate) === requestedKey
  )
  // Why: this lookup is reachable from pasted links. Restricting it to a
  // configured remote prevents gh from sending credentials to an arbitrary host.
  if (!matchedRepository) {
    return null
  }
  await acquire()
  try {
    if (type === 'issue') {
      return await fetchIssueWorkItem(
        repoPath,
        matchedRepository,
        number,
        connectionId,
        localGitOptions
      )
    }
    return await fetchPullRequestWorkItem(
      repoPath,
      matchedRepository,
      number,
      connectionId,
      localGitOptions
    )
  } catch {
    return null
  } finally {
    release()
  }
}

export type PullRequestLookupData = {
  number: number
  title: string
  state: string
  url: string
  statusCheckRollup: unknown[]
  updatedAt: string
  isDraft?: boolean
  mergeable: string
  reviewDecision?: PRReviewDecision | null
  autoMergeRequest?: unknown
  autoMergeEnabled?: boolean
  autoMergeAllowed?: boolean | null
  mergeQueueRequired?: boolean | null
  mergeMethodSettings?: GitHubPRMergeMethodSettings
  mergeStateStatus?: string | null
  baseRefName?: string
  headRefName?: string
  baseRefOid?: string
  headRefOid?: string
}

export type RestPullRequest = {
  number: number
  title: string
  state: string
  html_url?: string
  url?: string
  updated_at?: string
  draft?: boolean
  merged_at?: string | null
  mergeable?: boolean | null
  mergeable_state?: string | null
  base?: { ref?: string; sha?: string }
  head?: { ref?: string; sha?: string }
}

export const PR_LOOKUP_JSON_FIELDS =
  'number,title,state,url,statusCheckRollup,updatedAt,isDraft,mergeable,reviewDecision,mergeStateStatus,autoMergeRequest,baseRefName,headRefName,baseRefOid,headRefOid'
export const PR_BRANCH_LIST_JSON_FIELDS =
  'number,title,state,url,statusCheckRollup,updatedAt,isDraft,mergeable,baseRefName,headRefName,baseRefOid,headRefOid'
export const PR_AUTO_MERGE_IDENTITY_JSON_FIELDS = 'id,headRefOid,baseRefName'
export const GITHUB_AUTO_MERGE_METHODS: Record<GitHubPRMergeMethod, 'MERGE' | 'SQUASH' | 'REBASE'> = {
  merge: 'MERGE',
  squash: 'SQUASH',
  rebase: 'REBASE'
}
