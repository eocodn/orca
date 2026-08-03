import { assertRateLimitBudget } from './github-client-foundation'
import type { GhExecOptions } from './github-client-foundation'
import type { GraphQLPRChecksResponse, GraphQLCheckRunContext, GraphQLStatusContext, GraphQLStatusCheckContext, GraphQLCheckSuite, RestCheckRun, RestCommitStatus, RestCheckSuite } from './github-pr-lookup-outcome'
import { getPendingApprovalCheckSuiteName, getPendingApprovalCheckSuiteUrl, nullableString, nullableNumber, parseActionsRunId } from './github-pr-checks'
import type {
  PRCheckDetail,
} from '../../shared/types'
import {
  ghExecFileAsync,
  acquire,
  release
} from './gh-utils'
import type { GitHubApiRepository } from './github-api-repository'
import {
  mapCheckRunRESTStatus,
  mapCheckRunRESTConclusion,
  mapCommitStatusRESTStatus,
  mapCommitStatusRESTConclusion
} from './mappers'
import {
  noteRepositoryRateLimitSpend
} from './rate-limit'

export function isGraphQLCheckRunContext(
  context: GraphQLStatusCheckContext
): context is GraphQLCheckRunContext {
  return context.__typename === 'CheckRun'
}

export function isGraphQLStatusContext(
  context: GraphQLStatusCheckContext
): context is GraphQLStatusContext {
  return context.__typename === 'StatusContext'
}

export function mapGraphQLCheckRunContext(context: GraphQLCheckRunContext): PRCheckDetail | null {
  const name = nullableString(context.name)
  if (!name) {
    return null
  }
  const url = nullableString(context.detailsUrl) ?? nullableString(context.url)
  const checkRunId = nullableNumber(context.databaseId)
  const workflowRunId =
    nullableNumber(context.checkSuite?.workflowRun?.databaseId) ?? parseActionsRunId(url)
  return {
    name,
    status: mapCheckRunRESTStatus(context.status ?? ''),
    conclusion: mapCheckRunRESTConclusion(context.status ?? '', context.conclusion ?? null),
    url,
    ...(checkRunId !== null ? { checkRunId } : {}),
    ...(typeof workflowRunId === 'number' ? { workflowRunId } : {})
  }
}

export function mapGraphQLStatusContext(context: GraphQLStatusContext): PRCheckDetail | null {
  const name = nullableString(context.context)
  if (!name) {
    return null
  }
  const url = nullableString(context.targetUrl)
  const workflowRunId = parseActionsRunId(url)
  return {
    name,
    status: mapCommitStatusRESTStatus(context.state ?? ''),
    conclusion: mapCommitStatusRESTConclusion(context.state ?? ''),
    url,
    ...(workflowRunId !== undefined ? { workflowRunId } : {})
  }
}

export function mapRestCheckRun(checkRun: RestCheckRun): PRCheckDetail {
  return {
    name: checkRun.name,
    status: mapCheckRunRESTStatus(checkRun.status),
    conclusion: mapCheckRunRESTConclusion(checkRun.status, checkRun.conclusion),
    url: checkRun.details_url || checkRun.html_url || null,
    ...(typeof checkRun.id === 'number' ? { checkRunId: checkRun.id } : {}),
    workflowRunId: parseActionsRunId(checkRun.details_url || checkRun.html_url || null)
  }
}

export function mapRestCommitStatus(status: RestCommitStatus): PRCheckDetail | null {
  const name = nullableString(status.context)
  if (!name) {
    return null
  }
  const url = nullableString(status.target_url)
  const workflowRunId = parseActionsRunId(url)
  return {
    name,
    status: mapCommitStatusRESTStatus(status.state ?? ''),
    conclusion: mapCommitStatusRESTConclusion(status.state ?? ''),
    url,
    ...(workflowRunId !== undefined ? { workflowRunId } : {})
  }
}

export function mapGraphQLPendingApprovalCheckSuite(
  ownerRepo: GitHubApiRepository,
  suite: GraphQLCheckSuite,
  headSha: string | null | undefined,
  index: number
): PRCheckDetail {
  return {
    name: getPendingApprovalCheckSuiteName(suite, headSha, index),
    status: 'completed',
    conclusion: 'action_required',
    // Why: suite-only approval blockers have no check run; link the suite page when GraphQL exposes one.
    url:
      nullableString(suite.url) ??
      (headSha ? getPendingApprovalCheckSuiteUrl(ownerRepo, headSha, suite.databaseId) : null)
  }
}

export function mapGraphQLPRChecksResponse(
  ownerRepo: GitHubApiRepository,
  response: GraphQLPRChecksResponse
): PRCheckDetail[] | null {
  const pullRequest = response.data?.repository?.pullRequest
  if (!pullRequest) {
    return null
  }
  const commit = pullRequest.commits?.nodes?.[0]?.commit
  if (!commit) {
    return []
  }

  const contexts = commit.statusCheckRollup?.contexts?.nodes ?? []
  const checkRunContexts = contexts.filter(isGraphQLCheckRunContext)
  const checkRuns = checkRunContexts
    .map(mapGraphQLCheckRunContext)
    .filter((check): check is PRCheckDetail => check !== null)
  const checkRunNames = new Set(checkRuns.map((check) => check.name))
  const checkSuiteIdsWithRuns = new Set(
    checkRunContexts
      .map((context) => nullableNumber(context.checkSuite?.databaseId))
      .filter((id): id is number => id !== null)
  )
  // Why: mixed-CI repos expose Jenkins/Prow/Tide as legacy status contexts in the same rollup; keep check-run metadata on name collisions.
  const legacyStatuses = contexts
    .filter(isGraphQLStatusContext)
    .map(mapGraphQLStatusContext)
    .filter((check): check is PRCheckDetail => check !== null && !checkRunNames.has(check.name))
  const pendingApprovalChecks = (commit.checkSuites?.nodes ?? [])
    .filter((suite) => suite.conclusion?.toLowerCase() === 'action_required')
    .filter((suite) => {
      const suiteId = nullableNumber(suite.databaseId)
      return suiteId === null || !checkSuiteIdsWithRuns.has(suiteId)
    })
    .map((suite, index) =>
      mapGraphQLPendingApprovalCheckSuite(ownerRepo, suite, pullRequest.headRefOid, index)
    )

  return [...checkRuns, ...legacyStatuses, ...pendingApprovalChecks]
}

export async function getPRChecksViaRestFallback(
  ownerRepo: GitHubApiRepository,
  headSha: string | undefined,
  ghOptions: GhExecOptions,
  noCache?: boolean
): Promise<PRCheckDetail[] | null> {
  if (!headSha) {
    return null
  }
  try {
    await assertRateLimitBudget('core', ownerRepo, ghOptions)
  } catch (err) {
    console.warn('getPRChecks skipped REST fallback, falling back to gh pr checks:', err)
    return null
  }

  await acquire()
  try {
    const cacheArgs = noCache ? [] : ['--cache', '60s']
    const encodedHeadSha = encodeURIComponent(headSha)
    const { stdout } = await ghExecFileAsync(
      [
        'api',
        ...cacheArgs,
        `repos/${ownerRepo.owner}/${ownerRepo.repo}/commits/${encodedHeadSha}/check-runs?per_page=100`
      ],
      ghOptions
    )
    noteRepositoryRateLimitSpend(ownerRepo, 'core', 1, ghOptions)
    const checkRunData = JSON.parse(stdout) as {
      check_runs?: RestCheckRun[]
    }
    const checkRuns = (checkRunData.check_runs ?? []).map(mapRestCheckRun)
    const checkRunNames = new Set(checkRuns.map((check) => check.name))

    let legacyStatuses: PRCheckDetail[] = []
    try {
      const statusResult = await ghExecFileAsync(
        [
          'api',
          ...cacheArgs,
          `repos/${ownerRepo.owner}/${ownerRepo.repo}/commits/${encodedHeadSha}/status?per_page=100`
        ],
        ghOptions
      )
      noteRepositoryRateLimitSpend(ownerRepo, 'core', 1, ghOptions)
      const statusData = JSON.parse(statusResult.stdout) as {
        statuses?: RestCommitStatus[]
      }
      legacyStatuses = (statusData.statuses ?? [])
        .map(mapRestCommitStatus)
        .filter((check): check is PRCheckDetail => check !== null && !checkRunNames.has(check.name))
    } catch (err) {
      // Why: REST fallback is already degraded; keep the richer check-run rows if legacy-status enrichment fails.
      console.warn('getPRChecks REST status fallback failed:', err)
    }

    let pendingApprovalChecks: PRCheckDetail[] = []
    try {
      const suitesResult = await ghExecFileAsync(
        [
          'api',
          ...cacheArgs,
          `repos/${ownerRepo.owner}/${ownerRepo.repo}/commits/${encodedHeadSha}/check-suites?per_page=100`
        ],
        ghOptions
      )
      noteRepositoryRateLimitSpend(ownerRepo, 'core', 1, ghOptions)
      const suitesData = JSON.parse(suitesResult.stdout) as {
        check_suites?: RestCheckSuite[]
      }
      pendingApprovalChecks = (suitesData.check_suites ?? [])
        .filter((suite) => suite.conclusion?.toLowerCase() === 'action_required')
        .map((suite, index) => ({
          name: getPendingApprovalCheckSuiteName(suite, headSha, index),
          status: 'completed' as const,
          conclusion: 'action_required' as const,
          url: getPendingApprovalCheckSuiteUrl(ownerRepo, headSha, suite.id)
        }))
    } catch (err) {
      console.warn('getPRChecks REST check-suite fallback failed:', err)
    }

    const checks = [...checkRuns, ...legacyStatuses, ...pendingApprovalChecks]
    return checks.length > 0 ? checks : null
  } catch (err) {
    console.warn('getPRChecks via REST fallback failed, falling back to gh pr checks:', err)
    return null
  } finally {
    release()
  }
}
