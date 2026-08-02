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
  spendsSharedGitHubComQuota,
  type RateLimitBucketKind
} from './rate-limit'
export function mapReviewCommentResponse(
  data: {
    id?: number
    user: { login: string; avatar_url: string; type?: string } | null
    body?: string
    created_at?: string
    html_url?: string
    path?: string
    line?: number | null
  },
  body: string,
  path?: string,
  line?: number,
  startLine?: number,
  threadId?: string
): PRComment {
  return {
    id: data.id ?? Date.now(),
    author: data.user?.login ?? 'You',
    authorAvatarUrl: data.user?.avatar_url ?? '',
    body: data.body ?? body,
    createdAt: data.created_at ?? new Date().toISOString(),
    url: data.html_url ?? '',
    isBot: data.user?.type === 'Bot',
    path: data.path ?? path,
    line: data.line ?? line,
    startLine,
    threadId
  }
}

export async function addPRReviewCommentReply(
  repoPath: string,
  prNumber: number,
  commentId: number,
  body: string,
  threadId?: string,
  path?: string,
  line?: number,
  connectionId?: string | null,
  prRepo?: GitHubApiRepository | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitHubCommentResult> {
  const { ownerRepo, ghOptions } = await resolveGitHubRepoExecution(
    repoPath,
    prRepo,
    connectionId,
    localGitOptions
  )
  if (!ownerRepo) {
    return { ok: false, error: 'Could not resolve GitHub owner/repo for this repository' }
  }
  await acquire()
  try {
    const { stdout } = await ghExecFileAsync(
      [
        'api',
        '-X',
        'POST',
        `repos/${ownerRepo.owner}/${ownerRepo.repo}/pulls/${prNumber}/comments/${commentId}/replies`,
        '--raw-field',
        `body=${body}`
      ],
      ghOptions
    )
    const data = JSON.parse(stdout) as Parameters<typeof mapReviewCommentResponse>[0]
    if (typeof data.id !== 'number' || !Number.isSafeInteger(data.id) || data.id < 1) {
      return { ok: false, error: 'Unexpected response from GitHub' }
    }
    return {
      ok: true,
      comment: mapReviewCommentResponse(data, body, path, line, undefined, threadId)
    }
  } catch (err) {
    const stderr = err instanceof Error ? err.message : String(err)
    return { ok: false, error: classifyGhError(stderr).message }
  } finally {
    release()
  }
}

export async function addPRReviewComment(
  args: GitHubPRReviewCommentInput & {
    connectionId?: string | null
    localGitOptions?: LocalGitExecOptions
  }
): Promise<GitHubCommentResult> {
  const { ownerRepo, ghOptions } = await resolveGitHubRepoExecution(
    args.repoPath,
    args.prRepo,
    args.connectionId,
    args.localGitOptions
  )
  if (!ownerRepo) {
    return { ok: false, error: 'Could not resolve GitHub owner/repo for this repository' }
  }
  await acquire()
  try {
    const fields = [
      'api',
      '-X',
      'POST',
      `repos/${ownerRepo.owner}/${ownerRepo.repo}/pulls/${args.prNumber}/comments`,
      '--raw-field',
      `body=${args.body}`,
      '--raw-field',
      `commit_id=${args.commitId}`,
      '--raw-field',
      `path=${args.path}`,
      '--field',
      `line=${String(args.line)}`,
      '--raw-field',
      'side=RIGHT'
    ]
    if (typeof args.startLine === 'number' && args.startLine !== args.line) {
      fields.push(
        '--field',
        `start_line=${String(args.startLine)}`,
        '--raw-field',
        'start_side=RIGHT'
      )
    }
    const { stdout } = await ghExecFileAsync(fields, ghOptions)
    return {
      ok: true,
      comment: mapReviewCommentResponse(
        JSON.parse(stdout),
        args.body,
        args.path,
        args.line,
        args.startLine
      )
    }
  } catch (err) {
    const stderr = err instanceof Error ? err.message : String(err)
    return { ok: false, error: classifyGhError(stderr).message }
  } finally {
    release()
  }
}
