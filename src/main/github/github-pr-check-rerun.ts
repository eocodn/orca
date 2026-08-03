import { getPRChecks, parseActionsRunId } from './github-pr-checks'
import type {
  GitHubRerunPRChecksResult
} from '../../shared/types'
import {
  ghExecFileAsync,
  acquire,
  release,
  classifyGhError,
  type LocalGitExecOptions
} from './gh-utils'
// Why: import from the lightweight module (not ./gh-utils) so tests mocking gh-utils still get the real functions.
import {
  resolveGitHubRepoExecution,
  type GitHubApiRepository
} from './github-api-repository'

export async function rerunPRChecks(
  repoPath: string,
  prNumber: number,
  options: {
    headSha?: string
    failedOnly?: boolean
    prRepo?: GitHubApiRepository | null
  } = {},
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitHubRerunPRChecksResult> {
  const { ownerRepo, ghOptions } = await resolveGitHubRepoExecution(
    repoPath,
    options.prRepo,
    connectionId,
    localGitOptions
  )
  if (!ownerRepo) {
    return { ok: false, error: 'Could not resolve GitHub owner/repo for this repository' }
  }

  const checks = await getPRChecks(
    repoPath,
    prNumber,
    options.headSha,
    ownerRepo,
    { noCache: true },
    connectionId,
    localGitOptions
  )
  const candidates = options.failedOnly
    ? checks.filter((check) =>
        ['failure', 'cancelled', 'timed_out'].includes(check.conclusion ?? '')
      )
    : checks
  const workflowRunIds = new Set(
    candidates
      .map((check) => check.workflowRunId ?? parseActionsRunId(check.url))
      .filter((id): id is number => typeof id === 'number')
  )
  const checkRunIds = new Set(
    candidates
      .filter((check) => !check.workflowRunId && !parseActionsRunId(check.url))
      .map((check) => check.checkRunId)
      .filter((id): id is number => typeof id === 'number')
  )

  if (workflowRunIds.size === 0 && checkRunIds.size === 0) {
    return {
      ok: false,
      error: options.failedOnly
        ? 'No failed GitHub Actions checks to rerun.'
        : 'No rerunnable checks found.'
    }
  }

  let count = 0
  await acquire()
  try {
    for (const runId of workflowRunIds) {
      const endpoint = options.failedOnly
        ? `repos/${ownerRepo.owner}/${ownerRepo.repo}/actions/runs/${runId}/rerun-failed-jobs`
        : `repos/${ownerRepo.owner}/${ownerRepo.repo}/actions/runs/${runId}/rerun`
      await ghExecFileAsync(['api', '-X', 'POST', endpoint], {
        ...ghOptions,
        env: { ...process.env, GH_PROMPT_DISABLED: '1' }
      })
      count += 1
    }
    for (const checkRunId of checkRunIds) {
      await ghExecFileAsync(
        [
          'api',
          '-X',
          'POST',
          `repos/${ownerRepo.owner}/${ownerRepo.repo}/check-runs/${checkRunId}/rerequest`
        ],
        { ...ghOptions, env: { ...process.env, GH_PROMPT_DISABLED: '1' } }
      )
      count += 1
    }
    return { ok: true, count }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
    return { ok: false, error: classifyGhError(message).message }
  } finally {
    release()
  }
}

// Why: review thread resolution status + thread IDs are GraphQL-only (REST pulls/{n}/comments omits them).
export const REVIEW_THREADS_QUERY = `
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          line
          startLine
          originalLine
          originalStartLine
          comments(first: 100) {
            nodes {
              databaseId
              author { __typename login avatarUrl(size: 48) }
              body
              createdAt
              url
              path
              reactionGroups {
                content
                reactors {
                  totalCount
                }
              }
            }
          }
        }
      }
      comments(first: 100) {
        nodes {
          databaseId
          author { __typename login avatarUrl(size: 48) }
          body
          createdAt
          url
          reactionGroups {
            content
            reactors {
              totalCount
            }
          }
        }
      }
    }
  }
}`
