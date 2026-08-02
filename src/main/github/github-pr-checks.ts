import { setPrCheckLogTailCache, assertRateLimitBudget, PR_CHECK_LOG_TAIL_JOB_LIMIT, prCheckLogTailCache } from './github-client-foundation'
import type { GhExecOptions } from './github-client-foundation'
import { PR_CHECKS_ROLLUP_QUERY } from './github-pr-lookup-outcome'
import type { GraphQLPRChecksResponse } from './github-pr-lookup-outcome'
import { mapGraphQLPRChecksResponse, getPRChecksViaRestFallback } from './github-pr-check-mapping'
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
export async function getPRChecks(
  repoPath: string,
  prNumber: number,
  headSha?: string,
  prRepo?: GitHubApiRepository | null,
  options?: { noCache?: boolean },
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<PRCheckDetail[]> {
  void headSha
  const { ownerRepo, ghOptions } = await resolveGitHubRepoExecution(
    repoPath,
    prRepo,
    connectionId,
    localGitOptions
  )
  if (connectionId && !ownerRepo) {
    throw new Error(GITHUB_WORK_ITEMS_SSH_REMOTE_REQUIRED_MESSAGE)
  }
  const fallbackToPRChecks = async (): Promise<PRCheckDetail[]> => {
    await assertRateLimitBudget('graphql', ownerRepo, ghOptions)
    await acquire()
    try {
      const fallbackArgs = ['pr', 'checks', String(prNumber), '--json', 'name,state,link']
      if (ownerRepo) {
        fallbackArgs.push('--repo', `${ownerRepo.owner}/${ownerRepo.repo}`)
      }
      const { stdout } = await ghExecFileAsync(fallbackArgs, ghOptions).catch((err: unknown) => {
        const { stderr } = extractExecError(err)
        // Why: `gh pr checks` exits non-zero when a PR has no check runs yet; treat that as empty, not a load failure.
        if (stderr.toLowerCase().includes('no checks reported')) {
          return { stdout: '[]', stderr }
        }
        throw err
      })
      noteRepositoryRateLimitSpend(ownerRepo, 'graphql', 1, ghOptions)
      const data = JSON.parse(stdout) as { name: string; state: string; link: string }[]
      return data.map((d) => ({
        name: d.name,
        status: mapCheckStatus(d.state),
        conclusion: mapCheckConclusion(d.state),
        url: d.link || null,
        workflowRunId: parseActionsRunId(d.link)
      }))
    } finally {
      release()
    }
  }

  if (ownerRepo) {
    let canUseGraphQLRollup = true
    try {
      await assertRateLimitBudget('graphql', ownerRepo, ghOptions)
    } catch (err) {
      canUseGraphQLRollup = false
      console.warn('getPRChecks skipped GraphQL rollup, falling back to gh pr checks:', err)
    }
    if (canUseGraphQLRollup) {
      await acquire()
      try {
        // Why: --cache 60s saves rate-limit budget during polling; explicit refresh skips it for fresh data.
        const cacheArgs = options?.noCache ? [] : ['--cache', '60s']
        const { stdout } = await ghExecFileAsync(
          [
            'api',
            'graphql',
            ...cacheArgs,
            '-f',
            `owner=${ownerRepo.owner}`,
            '-f',
            `repo=${ownerRepo.repo}`,
            '-F',
            `pr=${prNumber}`,
            '-f',
            `query=${PR_CHECKS_ROLLUP_QUERY}`
          ],
          ghOptions
        )
        noteRepositoryRateLimitSpend(ownerRepo, 'graphql', 1, ghOptions)
        const checks = mapGraphQLPRChecksResponse(
          ownerRepo,
          JSON.parse(stdout) as GraphQLPRChecksResponse
        )
        if (checks !== null) {
          return checks
        }
      } catch (err) {
        // Why: fall back to older `gh pr checks` when GitHub's richer rollup query is unavailable.
        console.warn('getPRChecks via GraphQL rollup failed, falling back to gh pr checks:', err)
      } finally {
        release()
      }
    }
    const restChecks = await getPRChecksViaRestFallback(
      ownerRepo,
      headSha,
      ghOptions,
      options?.noCache
    )
    if (restChecks !== null) {
      return restChecks
    }
  }

  try {
    return await fallbackToPRChecks()
  } catch (err) {
    console.warn('getPRChecks failed:', err)
    throw err
  }
}

export function getPendingApprovalCheckSuiteName(
  suite: {
    id?: number | null
    databaseId?: number | null
    app?: { name?: string | null; slug?: string | null } | null
  },
  headSha: string | null | undefined,
  index: number
): string {
  const appName = suite.app?.name ?? suite.app?.slug ?? null
  const rawSuiteId = suite.databaseId ?? suite.id
  const suiteId =
    typeof rawSuiteId === 'number' && Number.isFinite(rawSuiteId) ? `#${rawSuiteId}` : null
  if (appName && suiteId) {
    return `${appName} ${suiteId}`
  }
  if (appName) {
    return appName
  }
  if (suiteId) {
    return suiteId
  }
  return `${headSha?.slice(0, 12) ?? 'check-suite'}:${index + 1}`
}

export function getPendingApprovalCheckSuiteUrl(
  ownerRepo: GitHubApiRepository,
  headSha: string,
  suiteId: number | null | undefined
): string {
  const base = `https://${githubRepositoryWebHost(ownerRepo)}/${ownerRepo.owner}/${ownerRepo.repo}/commits/${headSha}/checks`
  return typeof suiteId === 'number' && Number.isFinite(suiteId)
    ? `${base}#check-suite-${suiteId}`
    : base
}

export function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function mapCheckAnnotations(raw: unknown): PRCheckRunDetails['annotations'] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .filter((annotation): annotation is Record<string, unknown> => Boolean(annotation))
    .map((annotation) => ({
      path: nullableString(annotation.path),
      startLine: nullableNumber(annotation.start_line),
      endLine: nullableNumber(annotation.end_line),
      annotationLevel: nullableString(annotation.annotation_level),
      title: nullableString(annotation.title),
      message: nullableString(annotation.message) ?? '',
      rawDetails: nullableString(annotation.raw_details)
    }))
}

export function mapWorkflowJobs(raw: unknown, checkName?: string): PRCheckRunDetails['jobs'] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { jobs?: unknown }).jobs)) {
    return []
  }
  const jobs = (raw as { jobs: unknown[] }).jobs
    .filter((job): job is Record<string, unknown> => Boolean(job))
    .map((job) => ({
      id: nullableNumber(job.id),
      name: nullableString(job.name) ?? 'Unnamed job',
      status: nullableString(job.status),
      conclusion: nullableString(job.conclusion),
      startedAt: nullableString(job.started_at),
      completedAt: nullableString(job.completed_at),
      url: nullableString(job.html_url),
      logTail: null,
      steps: Array.isArray(job.steps)
        ? job.steps
            .filter((step): step is Record<string, unknown> => Boolean(step))
            .map((step) => ({
              name: nullableString(step.name) ?? 'Unnamed step',
              status: nullableString(step.status),
              conclusion: nullableString(step.conclusion),
              startedAt: nullableString(step.started_at),
              completedAt: nullableString(step.completed_at)
            }))
        : []
    }))
  const exactMatches = checkName ? jobs.filter((job) => job.name === checkName) : []
  return exactMatches.length > 0 ? exactMatches : jobs
}

export function isCheckJobFailureState(state: string | null | undefined): boolean {
  return (
    state === 'failure' ||
    state === 'failed' ||
    state === 'action_required' ||
    state === 'cancelled' ||
    state === 'stale' ||
    state === 'startup_failure' ||
    state === 'timed_out'
  )
}

export function getCheckJobLogTailCacheKey(job: PRCheckRunDetails['jobs'][number]): string | null {
  if (job.id === null) {
    return null
  }
  return `${job.id}:${job.completedAt ?? ''}`
}

export async function attachFailedJobLogTails(
  jobs: PRCheckRunDetails['jobs'],
  ownerRepo: GitHubApiRepository,
  ghOptions: GhExecOptions
): Promise<void> {
  const failedJobs = jobs
    .filter((job) => {
      const state = job.conclusion ?? job.status
      return job.id !== null && isCheckJobFailureState(state)
    })
    .slice(0, PR_CHECK_LOG_TAIL_JOB_LIMIT)

  // Why: cap log fetches so failed-job details stay a bounded follow-up, not a burst of hosted log downloads.
  for (const job of failedJobs) {
    const jobCacheKey = getCheckJobLogTailCacheKey(job)
    const cacheKey = jobCacheKey ? `${githubRepoIdentityKey(ownerRepo)}:${jobCacheKey}` : null
    if (!cacheKey) {
      continue
    }
    if (prCheckLogTailCache.has(cacheKey)) {
      job.logTail = prCheckLogTailCache.get(cacheKey) ?? null
      continue
    }
    try {
      const { stdout } = await ghExecFileAsync(
        ['api', `repos/${ownerRepo.owner}/${ownerRepo.repo}/actions/jobs/${job.id}/logs`],
        ghOptions
      )
      job.logTail = sliceCheckLogTail(stdout)
    } catch (err) {
      console.warn('getPRCheckDetails workflow job log fetch failed:', err)
      job.logTail = null
    }
    setPrCheckLogTailCache(cacheKey, job.logTail)
  }
}

export function getWorkflowRunIdFromCheckRun(
  checkRun: Record<string, unknown> | null
): number | undefined {
  const checkSuite = checkRun?.check_suite
  if (!checkSuite || typeof checkSuite !== 'object') {
    return undefined
  }
  const workflowRun = (checkSuite as { workflow_run?: unknown }).workflow_run
  if (!workflowRun || typeof workflowRun !== 'object') {
    return undefined
  }
  const id = (workflowRun as { id?: unknown }).id
  return typeof id === 'number' && Number.isSafeInteger(id) ? id : undefined
}

export async function getPRCheckDetails(
  repoPath: string,
  args: {
    checkRunId?: number
    workflowRunId?: number
    checkName?: string
    url?: string | null
    prRepo?: GitHubApiRepository | null
  },
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<PRCheckRunDetails | null> {
  const { ownerRepo, ghOptions } = await resolveGitHubRepoExecution(
    repoPath,
    args.prRepo,
    connectionId,
    localGitOptions
  )
  if (!ownerRepo) {
    return null
  }

  await acquire()
  try {
    let checkRun: Record<string, unknown> | null = null
    let annotations: PRCheckRunDetails['annotations'] = []
    if (args.checkRunId) {
      const { stdout } = await ghExecFileAsync(
        ['api', `repos/${ownerRepo.owner}/${ownerRepo.repo}/check-runs/${args.checkRunId}`],
        ghOptions
      )
      checkRun = JSON.parse(stdout) as Record<string, unknown>
      try {
        const annotationsResult = await ghExecFileAsync(
          [
            'api',
            `repos/${ownerRepo.owner}/${ownerRepo.repo}/check-runs/${args.checkRunId}/annotations?per_page=20`
          ],
          ghOptions
        )
        annotations = mapCheckAnnotations(JSON.parse(annotationsResult.stdout))
      } catch (err) {
        console.warn('getPRCheckDetails annotations fetch failed:', err)
      }
    }

    const workflowRunId = args.workflowRunId ?? getWorkflowRunIdFromCheckRun(checkRun)
    let jobs: PRCheckRunDetails['jobs'] = []
    if (workflowRunId) {
      try {
        const { stdout } = await ghExecFileAsync(
          [
            'api',
            `repos/${ownerRepo.owner}/${ownerRepo.repo}/actions/runs/${workflowRunId}/jobs?per_page=100`
          ],
          ghOptions
        )
        jobs = mapWorkflowJobs(JSON.parse(stdout), args.checkName)
        await attachFailedJobLogTails(jobs, ownerRepo, ghOptions)
      } catch (err) {
        console.warn('getPRCheckDetails workflow jobs fetch failed:', err)
      }
    }

    const output =
      checkRun?.output && typeof checkRun.output === 'object'
        ? (checkRun.output as Record<string, unknown>)
        : null
    return {
      name: nullableString(checkRun?.name) ?? args.checkName ?? 'Check',
      status: nullableString(checkRun?.status),
      conclusion: nullableString(checkRun?.conclusion),
      url: nullableString(checkRun?.html_url) ?? args.url ?? null,
      detailsUrl: nullableString(checkRun?.details_url) ?? args.url ?? null,
      startedAt: nullableString(checkRun?.started_at),
      completedAt: nullableString(checkRun?.completed_at),
      title: nullableString(output?.title),
      summary: nullableString(output?.summary),
      text: nullableString(output?.text),
      annotations,
      jobs
    }
  } catch (err) {
    console.warn('getPRCheckDetails failed:', err)
    return null
  } finally {
    release()
  }
}

export function parseActionsRunId(url: string | null | undefined): number | undefined {
  if (!url) {
    return undefined
  }
  const match = /\/actions\/runs\/(\d+)(?:\/|$)/.exec(url)
  if (!match) {
    return undefined
  }
  const id = Number(match[1])
  return Number.isSafeInteger(id) ? id : undefined
}
