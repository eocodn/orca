import { isNoPullRequestError } from './github-client-foundation'
import type { GhExecOptions } from './github-client-foundation'
import { PR_LOOKUP_JSON_FIELDS } from './github-work-item-details'
import type { PullRequestLookupData, RestPullRequest } from './github-work-item-details'
import { mapRestPullRequest, normalizePullRequestLookupData, hydratePullRequestLookupData, hydrateBranchLookupWithExactPR, getRestPRForBranch, getFallbackPRListForBranch } from './github-pr-branch-state'
import type { GitHubPRBranchLookupOptions } from './github-pr-branch-state'
import { getPRForBranchOutcome } from './github-pr-lookup-outcome'
import type {
  PRInfo
} from '../../shared/types'
import {
  ghExecFileAsync,
  classifyGhError
} from './gh-utils'
import type { ghRepoExecOptions, OwnerRepo } from './gh-utils'
// Why: import from the lightweight module (not ./gh-utils) so tests mocking gh-utils still get the real functions.
import {
  githubHostExecOptions,
  type GitHubApiRepository
} from './github-api-repository'

export async function lookupPRByBranchName(args: {
  candidates: OwnerRepo[]
  headRepo: OwnerRepo | null
  branchName: string
  ghOptions: GhExecOptions
}): Promise<{
  data: PullRequestLookupData | null
  dataRepo: OwnerRepo | null
  pendingError?: unknown
}> {
  if (args.candidates.length > 0) {
    let pendingError: unknown
    let hasPendingError = false
    for (const candidate of args.candidates) {
      try {
        const branchData = args.headRepo
          ? await getRestPRForBranch(
              candidate,
              args.headRepo.owner,
              args.branchName,
              args.ghOptions
            )
          : await getFallbackPRListForBranch(candidate, args.branchName, args.ghOptions)
        // Why: REST/list branch lookup identifies the PR cheaply; exact `gh pr view` carries review, merge-queue, and auto-merge state.
        const data = await hydrateBranchLookupWithExactPR(candidate, branchData, args.ghOptions)
        if (data) {
          return { data, dataRepo: candidate }
        }
      } catch (err) {
        if (args.headRepo) {
          throw err
        }
        if (!hasPendingError) {
          pendingError = err
          hasPendingError = true
        }
        try {
          const branchData = await getRestPRForBranch(
            candidate,
            candidate.owner,
            args.branchName,
            args.ghOptions
          )
          const data = await hydrateBranchLookupWithExactPR(candidate, branchData, args.ghOptions)
          if (data) {
            return { data, dataRepo: candidate }
          }
        } catch (retryErr) {
          if (!hasPendingError) {
            pendingError = retryErr
            hasPendingError = true
          }
        }
      }
    }
    // Why: branch-list failures are ambiguous for fork discovery; give exact fallback-number recovery a chance before surfacing the error.
    return hasPendingError
      ? { data: null, dataRepo: null, pendingError }
      : { data: null, dataRepo: null }
  }

  try {
    const { stdout } = await ghExecFileAsync(
      ['pr', 'view', args.branchName, '--json', PR_LOOKUP_JSON_FIELDS],
      args.ghOptions
    )
    return {
      data: normalizePullRequestLookupData(JSON.parse(stdout) as PullRequestLookupData),
      dataRepo: null
    }
  } catch (err) {
    if (isNoPullRequestError(err)) {
      return { data: null, dataRepo: null }
    }
    throw err
  }
}

export async function getRestPRByNumber(
  ownerRepo: GitHubApiRepository,
  number: number,
  ghOptions: ReturnType<typeof ghRepoExecOptions>
): Promise<PullRequestLookupData | null> {
  const { stdout } = await ghExecFileAsync(
    ['api', `repos/${ownerRepo.owner}/${ownerRepo.repo}/pulls/${number}`],
    { ...ghOptions, ...githubHostExecOptions(ownerRepo) }
  )
  return mapRestPullRequest(JSON.parse(stdout) as RestPullRequest)
}

export async function getPRByNumber(
  ownerRepo: GitHubApiRepository,
  number: number,
  ghOptions: ReturnType<typeof ghRepoExecOptions>
): Promise<PullRequestLookupData | null> {
  try {
    const { stdout } = await ghExecFileAsync(
      [
        'pr',
        'view',
        String(number),
        '--repo',
        `${ownerRepo.owner}/${ownerRepo.repo}`,
        '--json',
        PR_LOOKUP_JSON_FIELDS
      ],
      { ...ghOptions, ...githubHostExecOptions(ownerRepo) }
    )
    return hydratePullRequestLookupData(
      ownerRepo,
      JSON.parse(stdout) as PullRequestLookupData,
      ghOptions
    )
  } catch (err) {
    // Why: deleted/edited linked PR metadata falls back to branch discovery; quota/auth/network failures get one cheaper REST exact lookup.
    if (isNotFoundGhError(err)) {
      return null
    }
    try {
      const restData = await getRestPRByNumber(ownerRepo, number, ghOptions)
      return restData ? hydratePullRequestLookupData(ownerRepo, restData, ghOptions) : null
    } catch (restErr) {
      if (isNotFoundGhError(restErr)) {
        return null
      }
      if (!shouldStopAfterExactLookupError(restErr)) {
        return null
      }
      throw restErr
    }
  }
}

export async function lookupPRByNumber(args: {
  candidates: OwnerRepo[]
  number: number
  ghOptions: ReturnType<typeof ghRepoExecOptions>
}): Promise<{ data: PullRequestLookupData | null; dataRepo: OwnerRepo | null }> {
  for (const candidate of args.candidates) {
    try {
      const linkedData = await getPRByNumber(candidate, args.number, args.ghOptions)
      if (!linkedData) {
        continue
      }
      return { data: linkedData, dataRepo: candidate }
    } catch (err) {
      if (shouldStopAfterExactLookupError(err)) {
        throw err
      }
      // Candidate probing is best-effort; another repo may own the PR.
    }
  }

  if (args.candidates.length > 0) {
    return { data: null, dataRepo: null }
  }

  try {
    const { stdout } = await ghExecFileAsync(
      ['pr', 'view', String(args.number), '--json', PR_LOOKUP_JSON_FIELDS],
      args.ghOptions
    )
    return {
      data: normalizePullRequestLookupData(JSON.parse(stdout) as PullRequestLookupData),
      dataRepo: null
    }
  } catch (err) {
    if (isNoPullRequestError(err)) {
      // Why: stale cached fallback numbers shouldn't error every poll when the PR was deleted or belongs to another repo.
      return { data: null, dataRepo: null }
    }
    throw err
  }
}

export function isNotFoundGhError(err: unknown): boolean {
  const stderr = err instanceof Error ? err.message : String(err)
  return classifyGhError(stderr).type === 'not_found'
}

export function shouldStopAfterExactLookupError(err: unknown): boolean {
  const stderr = err instanceof Error ? err.message : String(err)
  const type = classifyGhError(stderr).type
  return type !== 'not_found'
}

/**
 * Get PR info for a given branch using gh CLI.
 * Returns null if gh is not installed, or no PR exists for the branch.
 *
 * When `linkedPRNumber` is provided, it is the source of truth. This handles
 * "create from PR" worktrees whose local branch differs from the PR head ref,
 * and prevents a coalesced linked-PR refresh from fanning out an unrelated
 * branch lookup result to sibling aliases.
 * `fallbackPRNumber` is weaker: branch lookup still wins, and exact lookup is
 * used only after branch lookup misses.
 */
export async function getPRForBranch(
  repoPath: string,
  branch: string,
  linkedPRNumber?: number | null,
  connectionId?: string | null,
  fallbackPRNumber?: number | null,
  options: GitHubPRBranchLookupOptions = {}
): Promise<PRInfo | null> {
  const outcome = await getPRForBranchOutcome(
    repoPath,
    branch,
    linkedPRNumber,
    connectionId,
    fallbackPRNumber,
    options
  )
  return outcome.kind === 'found' ? outcome.pr : null
}

// Why: exact-linked fallback has no dataRepo; derive its host-aware identity from the web URL for merged-PR membership checks.
export function ownerRepoFromPullRequestUrl(url: string): OwnerRepo | null {
  const match = url.match(/^https?:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)\/pull\/\d+/)
  return match ? { owner: match[2], repo: match[3], host: match[1] } : null
}
