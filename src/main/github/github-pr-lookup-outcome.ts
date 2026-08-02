import { hostedReviewLocalGitOptionArgs, prRefreshUpstreamError } from './github-client-foundation'
import type { PullRequestLookupData } from './github-work-item-details'
import { derivePullRequestMergeable, isMergedImplicitPR, getCurrentHeadOid, shouldHideMergedImplicitPR, shouldRetryTrackedUpstreamBranch } from './github-pr-branch-state'
import type { GitHubPRBranchLookupOptions } from './github-pr-branch-state'
import { getTrackedUpstreamBranch } from './github-pr-branch-probes'
import { lookupPRByBranchName, lookupPRByNumber, ownerRepoFromPullRequestUrl } from './github-pr-lookup'
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

export async function getPRForBranchOutcome(
  repoPath: string,
  branch: string,
  linkedPRNumber?: number | null,
  connectionId?: string | null,
  fallbackPRNumber?: number | null,
  options: GitHubPRBranchLookupOptions = {}
): Promise<PRRefreshOutcome> {
  const branchName = branch.replace(/^refs\/heads\//, '')
  // Why: detached HEAD can't use branch lookup, but an exact linked/fallback PR number is still safe to query and keeps review state visible.
  if (!branchName && typeof linkedPRNumber !== 'number' && typeof fallbackPRNumber !== 'number') {
    return { kind: 'no-pr', fetchedAt: Date.now() }
  }
  const localGitArgs = hostedReviewLocalGitOptionArgs(options)
  const localGitOptions = localGitArgs[0] ?? {}
  const context = githubRepoContext(repoPath, connectionId, localGitOptions)
  const ghOptions = ghRepoExecOptions(context)

  await acquire()
  try {
    const { candidates, headRepo } = await resolveGitHubApiRepositoryCandidates(
      repoPath,
      connectionId,
      localGitOptions
    )
    // Why: connection-backed gh runs without a repository cwd. A bare lookup
    // here can honor process GH_REPO/GH_HOST and return an unrelated PR.
    if (connectionId && candidates.length === 0) {
      return { kind: 'no-pr', fetchedAt: Date.now() }
    }
    let data: PullRequestLookupData | null = null
    let dataRepo: OwnerRepo | null = null
    let dataHeadRepo: OwnerRepo | null = headRepo
    let pendingBranchLookupError: unknown
    let hasPendingBranchLookupError = false
    let currentHeadOidForMergedImplicit: string | null | undefined

    const explicitCurrentHeadOid =
      typeof options.currentHeadOid === 'string' && options.currentHeadOid.trim().length > 0
        ? options.currentHeadOid.trim()
        : null
    let confirmedContainedHeadOid: string | null = null
    let headDivergedFromMergedPRAtOid: string | null = null
    const mergedPRContainsHead = async (
      candidate: PullRequestLookupData,
      candidateRepo: OwnerRepo | null,
      headOid: string | null
    ): Promise<MergedPRCommitMembership> => {
      if (!candidateRepo || !headOid) {
        return 'unknown'
      }
      const membership = await isCommitPartOfMergedPR({
        ownerRepo: candidateRepo,
        prNumber: candidate.number,
        commitOid: headOid,
        ghOptions
      })
      if (membership === 'contained') {
        confirmedContainedHeadOid = headOid
      }
      return membership
    }
    const recordLinkedMergedPRDivergence = async (
      candidate: PullRequestLookupData | null,
      candidateRepo: OwnerRepo | null
    ): Promise<void> => {
      if (
        typeof linkedPRNumber !== 'number' ||
        !candidate ||
        mapPRState(candidate.state, candidate.isDraft) !== 'merged' ||
        explicitCurrentHeadOid === null ||
        candidate.headRefOid === explicitCurrentHeadOid
      ) {
        return
      }
      const membership = await mergedPRContainsHead(
        candidate,
        candidateRepo ?? ownerRepoFromPullRequestUrl(candidate.url),
        explicitCurrentHeadOid
      )
      if (membership === 'not-contained') {
        // explicitCurrentHeadOid is non-null here (guarded above); record the exact diverged head so consumers clear only that worktree.
        headDivergedFromMergedPRAtOid = explicitCurrentHeadOid
      }
    }
    const hideMergedImplicitPR = async (
      candidate: PullRequestLookupData | null,
      candidateRepo: OwnerRepo | null
    ) => {
      if (!candidate || !isMergedImplicitPR(candidate, linkedPRNumber)) {
        return false
      }
      // Why: prefer the caller's worktree HEAD; only shell out (main repo path) when no explicit oid, keeping merged-at-head PRs visible for secondary worktrees.
      currentHeadOidForMergedImplicit ??=
        explicitCurrentHeadOid !== null
          ? explicitCurrentHeadOid
          : await getCurrentHeadOid(repoPath, connectionId, localGitOptions)
      if (!shouldHideMergedImplicitPR(candidate, linkedPRNumber, currentHeadOidForMergedImplicit)) {
        return false
      }
      // Why: a head that is one of the PR's own commits (update-branch/web commits) is the same work, not a reused branch name — keep the merged PR visible.
      return (
        (await mergedPRContainsHead(candidate, candidateRepo, currentHeadOidForMergedImplicit)) !==
        'contained'
      )
    }

    if (typeof linkedPRNumber === 'number') {
      const exactLookup = await lookupPRByNumber({
        candidates,
        number: linkedPRNumber,
        ghOptions
      })
      data = exactLookup.data
      dataRepo = exactLookup.dataRepo
    } else if (branchName) {
      // During a rebase (detached HEAD) branch is empty; an empty --head filter makes gh return an arbitrary PR.
      const branchLookup = await lookupPRByBranchName({
        candidates,
        headRepo,
        branchName,
        ghOptions
      })
      data = branchLookup.data
      dataRepo = branchLookup.dataRepo
      if ('pendingError' in branchLookup) {
        pendingBranchLookupError = branchLookup.pendingError
        hasPendingBranchLookupError = true
      }
      if (!data) {
        // Why: the tracked upstream identifies the real PR head by branch name or fork owner even when local branch names match.
        const upstreamBranch = await getTrackedUpstreamBranch(
          repoPath,
          branchName,
          connectionId,
          localGitOptions
        )
        if (upstreamBranch) {
          const upstreamHeadRepo =
            (await getGitHubApiRepositoryForRemote(
              repoPath,
              upstreamBranch.remoteName,
              connectionId,
              localGitOptions
            )) ?? headRepo
          if (
            upstreamHeadRepo &&
            shouldRetryTrackedUpstreamBranch(upstreamBranch, branchName, upstreamHeadRepo, headRepo)
          ) {
            const upstreamLookup = await lookupPRByBranchName({
              candidates,
              headRepo: upstreamHeadRepo,
              branchName: upstreamBranch.branchName,
              ghOptions
            })
            data = upstreamLookup.data
            dataRepo = upstreamLookup.dataRepo
            if (!hasPendingBranchLookupError && 'pendingError' in upstreamLookup) {
              pendingBranchLookupError = upstreamLookup.pendingError
              hasPendingBranchLookupError = true
            }
            if (data) {
              dataHeadRepo = upstreamHeadRepo
            }
          }
        }
      }
    }
    let mergedBranchLookupNumber: number | null = null
    if (await hideMergedImplicitPR(data, dataRepo)) {
      mergedBranchLookupNumber = data?.number ?? null
      data = null
      dataRepo = null
      dataHeadRepo = headRepo
    }
    if (!data && typeof linkedPRNumber !== 'number' && typeof fallbackPRNumber === 'number') {
      const fallbackLookup = await lookupPRByNumber({
        candidates,
        number: fallbackPRNumber,
        ghOptions
      })
      data = fallbackLookup.data
      dataRepo = fallbackLookup.dataRepo
    }
    if (!data) {
      if (hasPendingBranchLookupError) {
        return prRefreshUpstreamError(pendingBranchLookupError)
      }
      return { kind: 'no-pr', fetchedAt: Date.now() }
    }
    await recordLinkedMergedPRDivergence(data, dataRepo)
    const fallbackConfirmedMergedBranch =
      typeof fallbackPRNumber === 'number' &&
      mergedBranchLookupNumber === fallbackPRNumber &&
      data.number === fallbackPRNumber
    const explicitHeadHidesMergedImplicitPR =
      explicitCurrentHeadOid !== null &&
      shouldHideMergedImplicitPR(data, linkedPRNumber, explicitCurrentHeadOid) &&
      (await mergedPRContainsHead(data, dataRepo, explicitCurrentHeadOid)) !== 'contained'
    // Why no lazy-HEAD re-check: fallback numbers were already gated on head equality/containment; re-hiding would blank kept deleted-head merged PRs.
    const shouldPreserveMergedFallback =
      !explicitHeadHidesMergedImplicitPR &&
      (fallbackConfirmedMergedBranch || options.acceptMergedFallbackPR === true)
    // Why: a visible PR can be merged outside Orca; keep a caller-marked fallback fresh even when GitHub no longer reports it by branch (e.g. deleted heads).
    if ((await hideMergedImplicitPR(data, dataRepo)) && !shouldPreserveMergedFallback) {
      return { kind: 'no-pr', fetchedAt: Date.now() }
    }
    // Why (#9171): on the default branch an implicit branch/fallback match must
    // never surface a non-open PR — it overrides the merged-fallback
    // preservation and merged-at-head carve-out on the trunk only. An exact
    // linked lookup returns the linked number, so linked PRs are exempt.
    if (
      await shouldHideNonOpenReviewOnDefaultBranch({
        state: mapPRState(data.state, data.isDraft),
        reviewNumber: data.number,
        linkedReviewNumber: linkedPRNumber,
        branchName,
        repoPath,
        connectionId,
        localGitOptions
      })
    ) {
      return { kind: 'no-pr', fetchedAt: Date.now() }
    }

    const mergeable = derivePullRequestMergeable(data)
    const conflictSummary =
      !connectionId &&
      mergeable === 'CONFLICTING' &&
      data.baseRefName &&
      data.baseRefOid &&
      data.headRefOid
        ? await getPRConflictSummary(
            repoPath,
            data.baseRefName,
            data.baseRefOid,
            data.headRefOid,
            localGitOptions
          )
        : undefined

    return {
      kind: 'found',
      fetchedAt: Date.now(),
      pr: {
        number: data.number,
        title: data.title,
        state: mapPRState(data.state, data.isDraft),
        url: data.url,
        checksStatus: deriveCheckStatus(data.statusCheckRollup),
        updatedAt: data.updatedAt,
        mergeable,
        ...(data.reviewDecision !== undefined ? { reviewDecision: data.reviewDecision } : {}),
        ...(data.autoMergeEnabled !== undefined ? { autoMergeEnabled: data.autoMergeEnabled } : {}),
        ...(data.autoMergeAllowed !== undefined ? { autoMergeAllowed: data.autoMergeAllowed } : {}),
        ...(data.mergeQueueRequired !== undefined
          ? { mergeQueueRequired: data.mergeQueueRequired }
          : {}),
        ...(data.mergeMethodSettings !== undefined
          ? { mergeMethodSettings: data.mergeMethodSettings }
          : {}),
        ...(data.mergeStateStatus !== undefined ? { mergeStateStatus: data.mergeStateStatus } : {}),
        headSha: data.headRefOid,
        ...(confirmedContainedHeadOid ? { confirmedContainedHeadOid } : {}),
        ...(headDivergedFromMergedPRAtOid ? { headDivergedFromMergedPRAtOid } : {}),
        ...(data.baseRefName ? { baseRefName: data.baseRefName } : {}),
        ...(data.headRefName ? { headRefName: data.headRefName } : {}),
        prRepo: dataRepo ?? undefined,
        headRepo: dataHeadRepo ?? undefined,
        conflictSummary
      }
    }
  } catch (err) {
    return prRefreshUpstreamError(err)
  } finally {
    release()
  }
}

export const PR_CHECKS_ROLLUP_QUERY = `
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      headRefOid
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun {
                    databaseId
                    name
                    status
                    conclusion
                    detailsUrl
                    url
                    checkSuite {
                      databaseId
                      workflowRun {
                        databaseId
                      }
                    }
                  }
                  ... on StatusContext {
                    context
                    state
                    targetUrl
                  }
                }
              }
            }
            checkSuites(first: 100) {
              nodes {
                databaseId
                status
                conclusion
                url
                app {
                  name
                  slug
                }
              }
            }
          }
        }
      }
    }
  }
}
`

export type GraphQLPRChecksResponse = {
  data?: {
    repository?: {
      pullRequest?: {
        headRefOid?: string | null
        commits?: {
          nodes?: { commit?: GraphQLPRChecksCommit | null }[] | null
        } | null
      } | null
    } | null
  } | null
}

export type GraphQLPRChecksCommit = {
  statusCheckRollup?: {
    contexts?: {
      nodes?: GraphQLStatusCheckContext[] | null
    } | null
  } | null
  checkSuites?: {
    nodes?: GraphQLCheckSuite[] | null
  } | null
}

export type GraphQLCheckRunContext = {
  __typename: 'CheckRun'
  databaseId?: number | null
  name?: string | null
  status?: string | null
  conclusion?: string | null
  detailsUrl?: string | null
  url?: string | null
  checkSuite?: {
    databaseId?: number | null
    workflowRun?: { databaseId?: number | null } | null
  } | null
}

export type GraphQLStatusContext = {
  __typename: 'StatusContext'
  context?: string | null
  state?: string | null
  targetUrl?: string | null
}

export type GraphQLStatusCheckContext =
  | GraphQLCheckRunContext
  | GraphQLStatusContext
  | { __typename?: string | null }

export type GraphQLCheckSuite = {
  databaseId?: number | null
  status?: string | null
  conclusion?: string | null
  url?: string | null
  app?: { name?: string | null; slug?: string | null } | null
}

export type RestCheckRun = {
  id?: number
  name: string
  status: string
  conclusion: string | null
  html_url: string
  details_url: string | null
}

export type RestCommitStatus = {
  context?: string
  state?: string
  target_url?: string | null
}

export type RestCheckSuite = {
  id?: number | null
  status: string | null
  conclusion: string | null
  app?: { name?: string | null; slug?: string | null } | null
}
