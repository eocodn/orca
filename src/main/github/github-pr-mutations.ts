import type { GhExecOptions } from './github-client-foundation'
import { PR_AUTO_MERGE_IDENTITY_JSON_FIELDS, GITHUB_AUTO_MERGE_METHODS } from './github-work-item-details'
import { detectRepositoryMergeMetadata } from './github-pr-branch-state'
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
 */
export async function mergePR(
  repoPath: string,
  prNumber: number,
  method: 'merge' | 'squash' | 'rebase' = 'squash',
  connectionId?: string | null,
  prRepo?: GitHubApiRepository | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
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
    const mergeBlocker = await getPRMergeBlocker(
      repoPath,
      prNumber,
      ownerRepo,
      ghOptions,
      connectionId,
      localGitOptions
    )
    if (mergeBlocker) {
      return { ok: false, error: mergeBlocker }
    }

    // Don't use --delete-branch: it deletes the local branch, which fails while the worktree is checked out on it.
    const args = ['pr', 'merge', String(prNumber), `--${method}`]
    if (ownerRepo) {
      args.push('--repo', `${ownerRepo.owner}/${ownerRepo.repo}`)
    }
    await ghExecFileAsync(args, {
      ...ghOptions,
      env: { ...process.env, GH_PROMPT_DISABLED: '1' }
    })
    return { ok: true }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
    return { ok: false, error: message }
  } finally {
    release()
  }
}

export async function setPRAutoMerge(
  repoPath: string,
  prNumber: number,
  enabled: boolean,
  method: GitHubPRMergeMethod = 'squash',
  connectionId?: string | null,
  prRepo?: GitHubApiRepository | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
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
    if (enabled) {
      return await enablePRAutoMerge(prNumber, method, ownerRepo, ghOptions)
    }
    const args = ['pr', 'merge', String(prNumber), '--disable-auto']
    if (ownerRepo) {
      args.push('--repo', `${ownerRepo.owner}/${ownerRepo.repo}`)
    }
    await ghExecFileAsync(args, {
      ...ghOptions,
      env: { ...process.env, GH_PROMPT_DISABLED: '1' }
    })
    return { ok: true }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
    return { ok: false, error: classifySetAutoMergeError(message) }
  } finally {
    release()
  }
}

// Why: GitHub rejects auto-merge on an already-mergeable PR ("clean status"); surface an actionable message instead of the raw error.
export function classifySetAutoMergeError(message: string): string {
  if (/in clean status/i.test(message)) {
    return 'This pull request can already be merged. Use Merge instead of auto-merge.'
  }
  return classifyGhError(message).message
}

export type PRAutoMergeIdentity = {
  id?: string
  headRefOid?: string
  baseRefName?: string
}

export async function getPRAutoMergeIdentity(
  prNumber: number,
  ownerRepo: GitHubApiRepository | null,
  ghOptions: GhExecOptions
): Promise<PRAutoMergeIdentity | null> {
  const args = ['pr', 'view', String(prNumber), '--json', PR_AUTO_MERGE_IDENTITY_JSON_FIELDS]
  if (ownerRepo) {
    args.push('--repo', `${ownerRepo.owner}/${ownerRepo.repo}`)
  }
  const { stdout } = await ghExecFileAsync(args, ghOptions)
  const data = JSON.parse(stdout) as PRAutoMergeIdentity
  return {
    id: typeof data.id === 'string' ? data.id : undefined,
    headRefOid: typeof data.headRefOid === 'string' ? data.headRefOid : undefined,
    baseRefName: typeof data.baseRefName === 'string' ? data.baseRefName : undefined
  }
}

export async function runPRAutoMergeCommand(
  prNumber: number,
  method: GitHubPRMergeMethod,
  ownerRepo: GitHubApiRepository | null,
  ghOptions: GhExecOptions
): Promise<void> {
  const args = ['pr', 'merge', String(prNumber), '--auto', `--${method}`]
  if (ownerRepo) {
    args.push('--repo', `${ownerRepo.owner}/${ownerRepo.repo}`)
  }
  await ghExecFileAsync(args, {
    ...ghOptions,
    env: { ...process.env, GH_PROMPT_DISABLED: '1' }
  })
}

export async function shouldUseMergeQueueAutoMerge(
  pr: PRAutoMergeIdentity,
  ownerRepo: GitHubApiRepository | null,
  ghOptions: GhExecOptions
): Promise<boolean> {
  if (!ownerRepo || !pr.baseRefName) {
    return false
  }
  const mergeMetadata = await detectRepositoryMergeMetadata(ownerRepo, pr.baseRefName, ghOptions)
  return mergeMetadata.mergeQueueRequired === true
}

export async function enablePRAutoMerge(
  prNumber: number,
  method: GitHubPRMergeMethod,
  ownerRepo: GitHubApiRepository | null,
  ghOptions: GhExecOptions
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pr = await getPRAutoMergeIdentity(prNumber, ownerRepo, ghOptions)
  if (!pr?.id) {
    return { ok: false, error: 'Could not resolve GitHub pull request ID' }
  }
  if (await shouldUseMergeQueueAutoMerge(pr, ownerRepo, ghOptions)) {
    await runPRAutoMergeCommand(prNumber, method, ownerRepo, ghOptions)
    return { ok: true }
  }
  const query = `mutation($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!, $expectedHeadOid: GitObjectID) {
    enablePullRequestAutoMerge(input: {
      pullRequestId: $pullRequestId,
      mergeMethod: $mergeMethod,
      expectedHeadOid: $expectedHeadOid
    }) {
      pullRequest { id }
    }
  }`
  const args = [
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-f',
    `pullRequestId=${pr.id}`,
    '-f',
    `mergeMethod=${GITHUB_AUTO_MERGE_METHODS[method]}`
  ]
  if (pr.headRefOid) {
    args.push('-f', `expectedHeadOid=${pr.headRefOid}`)
  }
  // Why: `gh pr merge --auto` can merge immediately; this mutation only creates the auto-merge request, letting branch requirements gate it.
  await ghExecFileAsync(args, {
    ...ghOptions,
    env: { ...process.env, GH_PROMPT_DISABLED: '1' }
  })
  return { ok: true }
}

export async function getPRMergeBlocker(
  repoPath: string,
  prNumber: number,
  ownerRepo: GitHubApiRepository | null,
  ghOptions: GhExecOptions,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<string | null> {
  if (!ownerRepo) {
    return null
  }

  try {
    const pr = await getPRByNumber(ownerRepo, prNumber, ghOptions)
    if (!pr) {
      return null
    }
    if (pr.reviewDecision === 'REVIEW_REQUIRED') {
      return 'This pull request requires review approval before it can be merged.'
    }
    if (pr.reviewDecision === 'CHANGES_REQUESTED') {
      return 'This pull request has requested changes and cannot be merged yet.'
    }
    if (pr.mergeQueueRequired === true) {
      return 'This pull request must be merged through GitHub merge queue. Use Merge when ready instead.'
    }
    // Why: conflict summaries shell out to local git; skip for SSH repos until that helper routes through the SSH provider.
    if (
      connectionId ||
      pr.mergeable !== 'CONFLICTING' ||
      !pr.baseRefName ||
      !pr.baseRefOid ||
      !pr.headRefOid
    ) {
      return null
    }

    const summary = await getPRConflictSummary(
      repoPath,
      pr.baseRefName,
      pr.baseRefOid,
      pr.headRefOid,
      localGitOptions
    )
    return formatMergeConflictBlocker(pr.baseRefName, summary)
  } catch {
    // Why: conflict preflight should improve stale UI diagnostics, not block merge on a transient lookup failure.
    return null
  }
}

export function formatMergeConflictBlocker(
  baseRefName: string,
  summary: PRConflictSummary | undefined
): string {
  const heading = 'This pull request has merge conflicts and cannot be merged yet.'
  if (!summary || summary.files.length === 0) {
    return `${heading}\nUpdate the branch with ${baseRefName} and resolve the conflicts before merging.`
  }

  const files = summary.files.map((file) => `- ${file}`).join('\n')
  const behind = `${summary.commitsBehind} commit${summary.commitsBehind === 1 ? '' : 's'} behind ${baseRefName}`
  return `${heading}\n${behind} (base commit: ${summary.baseCommit}).\n\nConflicting files:\n${files}`
}

export async function updatePRState(
  repoPath: string,
  prNumber: number,
  updates: GitHubPullRequestStateUpdate,
  connectionId?: string | null,
  prRepo?: GitHubApiRepository | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
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
    const cmd = updates.state === 'closed' ? 'close' : 'reopen'
    // Why: gh's PR commands use GitHub's supported reopen flow; REST state PATCH can 422 on reopen.
    await ghExecFileAsync(
      ['pr', cmd, String(prNumber), '--repo', `${ownerRepo.owner}/${ownerRepo.repo}`],
      {
        ...ghOptions
      }
    )
    return { ok: true }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
    return { ok: false, error: classifyGhError(message).message }
  } finally {
    release()
  }
}

export async function requestPRReviewers(
  repoPath: string,
  prNumber: number,
  reviewers: string[],
  connectionId?: string | null,
  prRepo?: GitHubApiRepository | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  const logins = reviewers.map((reviewer) => reviewer.trim()).filter(Boolean)
  if (logins.length === 0) {
    return { ok: false, error: 'Enter at least one reviewer' }
  }
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
    const args = ['pr', 'edit', String(prNumber), '--add-reviewer', logins.join(',')]
    if (ownerRepo) {
      args.push('--repo', `${ownerRepo.owner}/${ownerRepo.repo}`)
    }
    await ghExecFileAsync(args, {
      ...ghOptions,
      env: { ...process.env, GH_PROMPT_DISABLED: '1' }
    })
    return { ok: true }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
    return { ok: false, error: message }
  } finally {
    release()
  }
}

export async function removePRReviewers(
  repoPath: string,
  prNumber: number,
  reviewers: string[],
  connectionId?: string | null,
  prRepo?: GitHubApiRepository | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  const logins = reviewers.map((reviewer) => reviewer.trim()).filter(Boolean)
  if (logins.length === 0) {
    return { ok: false, error: 'Enter at least one reviewer' }
  }
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
    const args = ['pr', 'edit', String(prNumber), '--remove-reviewer', logins.join(',')]
    if (ownerRepo) {
      args.push('--repo', `${ownerRepo.owner}/${ownerRepo.repo}`)
    }
    await ghExecFileAsync(args, {
      ...ghOptions,
      env: { ...process.env, GH_PROMPT_DISABLED: '1' }
    })
    return { ok: true }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
    return { ok: false, error: message }
  } finally {
    release()
  }
}

/**
 * Update a PR's title.
 */
export async function updatePRTitle(
  repoPath: string,
  prNumber: number,
  title: string,
  connectionId?: string | null,
  prRepo?: GitHubApiRepository | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<boolean> {
  const { ownerRepo, ghOptions } = await resolveGitHubRepoExecution(
    repoPath,
    prRepo,
    connectionId,
    localGitOptions
  )
  if (!ownerRepo) {
    return false
  }
  await acquire()
  try {
    const args = ['pr', 'edit', String(prNumber), '--title', title]
    if (ownerRepo) {
      args.push('--repo', `${ownerRepo.owner}/${ownerRepo.repo}`)
    }
    await ghExecFileAsync(args, {
      ...ghOptions
    })
    return true
  } catch (err) {
    console.warn('updatePRTitle failed:', err)
    return false
  } finally {
    release()
  }
}

export async function updatePRDetails(
  repoPath: string,
  prNumber: number,
  updates: { title?: string; body?: string },
  connectionId?: string | null,
  prRepo?: GitHubApiRepository | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { ownerRepo, ghOptions } = await resolveGitHubRepoExecution(
    repoPath,
    prRepo,
    connectionId,
    localGitOptions
  )
  if (!ownerRepo) {
    return { ok: false, error: 'Could not resolve GitHub owner/repo for this repository' }
  }

  const fields: string[] = []
  if (updates.title !== undefined) {
    const title = updates.title.trim()
    if (!title) {
      return { ok: false, error: 'Title is required' }
    }
    fields.push(`title=${title}`)
  }
  if (updates.body !== undefined) {
    fields.push(`body=${updates.body}`)
  }
  if (fields.length === 0) {
    return { ok: true }
  }

  await acquire()
  try {
    await ghExecFileAsync(
      [
        'api',
        '-X',
        'PATCH',
        `repos/${ownerRepo.owner}/${ownerRepo.repo}/pulls/${prNumber}`,
        ...fields.flatMap((field) => ['--raw-field', field])
      ],
      ghOptions
    )
    return { ok: true }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
    return { ok: false, error: classifyGhError(message).message }
  } finally {
    release()
  }
}
