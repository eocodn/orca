import { isNotFoundGhError } from './github-pr-lookup'
import type {
  GitPushTarget,
  IssueSourcePreference,
  PRRefreshOutcome,
  GitHubViewer,
  GitHubPRMergeMethodSettings
} from '../../shared/types'
import {
  classifyPRRefreshError,
  safePRRefreshErrorMessage
} from './pr-refresh-error-classification'
import {
  execFileAsync,
  ghExecFileAsync,
  acquire,
  release,
  ghRepoExecOptions,
  githubRepoContext,
  getRemoteUrlForRepo,
  type LocalGitExecOptions
} from './gh-utils'
// Why: import from the lightweight module (not ./gh-utils) so tests mocking gh-utils still get the real functions.
import { extractExecError, parseRetryAfterMs } from '../git/exec-error'
import {
  hasHostedReviewLocalGitOptions,
  getHostedReviewLocalGitOptions,
  type HostedReviewExecutionOptions
} from '../source-control/hosted-review-git-options'
import {
  getGitHubApiRepositoryForRemote,
  getOriginGitHubApiRepository,
  githubHostExecOptions,
  resolveGitHubApiRepositoryCandidates,
  type GitHubRepoExecOptions,
  type GitHubApiRepository
} from './github-api-repository'
import { githubRepoIdentityKey } from '../../shared/github-repository-identity-key'
import {
  getRateLimit,
  repositoryRateLimitGuard,
  spendsSharedGitHubComQuota,
  type RateLimitBucketKind
} from './rate-limit'
export type GhExecOptions = GitHubRepoExecOptions
export type HostedReviewLocalGitOptions = ReturnType<typeof getHostedReviewLocalGitOptions>

export const ORCA_REPO = 'stablyai/orca'
export const PR_CHECK_LOG_TAIL_JOB_LIMIT = 5
// Why: each entry holds up to 16KB of log text; bound the cache so a long session can't grow it unbounded.
export const PR_CHECK_LOG_TAIL_CACHE_MAX_ENTRIES = 128
export const prCheckLogTailCache = new Map<string, string | null>()

export function hostedReviewLocalGitOptionArgs(
  options: HostedReviewExecutionOptions = {}
): [] | [HostedReviewLocalGitOptions] {
  return hasHostedReviewLocalGitOptions(options) ? [getHostedReviewLocalGitOptions(options)] : []
}

export function setPrCheckLogTailCache(cacheKey: string, logTail: string | null): void {
  prCheckLogTailCache.set(cacheKey, logTail)
  while (prCheckLogTailCache.size > PR_CHECK_LOG_TAIL_CACHE_MAX_ENTRIES) {
    const oldestKey = prCheckLogTailCache.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    prCheckLogTailCache.delete(oldestKey)
  }
}
export const MERGE_QUEUE_CACHE_TTL_MS = 10 * 60 * 1000
export const MERGE_QUEUE_UNKNOWN_CACHE_TTL_MS = 60 * 1000
export const MERGE_QUEUE_CACHE_MAX_ENTRIES = 256
export type GitHubRepositoryMergeMetadata = {
  mergeQueueRequired: boolean | null
  autoMergeAllowed: boolean | null
  mergeMethodSettings?: GitHubPRMergeMethodSettings
}
export const repositoryMergeMetadataCache = new Map<
  string,
  { value: GitHubRepositoryMergeMetadata; expiresAt: number }
>()

export function _resetMergeQueueCacheForTests(): void {
  repositoryMergeMetadataCache.clear()
}

export function _getMergeQueueCacheSizeForTests(): number {
  return repositoryMergeMetadataCache.size
}

export function pruneRepositoryMergeMetadataCache(now = Date.now()): void {
  for (const [cacheKey, cached] of repositoryMergeMetadataCache) {
    if (cached.expiresAt <= now) {
      repositoryMergeMetadataCache.delete(cacheKey)
    }
  }
  while (repositoryMergeMetadataCache.size > MERGE_QUEUE_CACHE_MAX_ENTRIES) {
    const oldestKey = repositoryMergeMetadataCache.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    repositoryMergeMetadataCache.delete(oldestKey)
  }
}

export async function assertRateLimitBudget(
  bucket: RateLimitBucketKind,
  repository?: GitHubApiRepository | null,
  executionOptions?: Pick<GhExecOptions, 'cwd' | 'wslDistro'>
): Promise<void> {
  if (spendsSharedGitHubComQuota(repository, executionOptions)) {
    await getRateLimit()
  }
  const guard = repositoryRateLimitGuard(repository, bucket, executionOptions)
  if (guard.blocked) {
    throw new Error(
      `GitHub ${bucket} rate limit is low; retry after ${new Date(guard.resetAt * 1000).toLocaleTimeString()}`
    )
  }
}

export function prRefreshUpstreamError(
  err: unknown
): Extract<PRRefreshOutcome, { kind: 'upstream-error' }> {
  const errorType = classifyPRRefreshError(err)
  const outcome: Extract<PRRefreshOutcome, { kind: 'upstream-error' }> = {
    kind: 'upstream-error',
    errorType,
    message: safePRRefreshErrorMessage(errorType),
    fetchedAt: Date.now()
  }
  // Why: a Retry-After is a real cooldown — surface it as the retry schedule so the renderer doesn't retry into another 429.
  if (errorType === 'rate_limited') {
    const retryAfterMs = parseRetryAfterMs(extractExecError(err).stderr)
    if (retryAfterMs !== null && retryAfterMs > 0) {
      const retryAt = Date.now() + retryAfterMs
      outcome.nextAutoRetryAt = retryAt
      outcome.retryDisabledUntil = retryAt
    }
  }
  return outcome
}

export function isNoPullRequestError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /no pull requests? found|could not find.*pull request/i.test(message)
}

/**
 * Check if the authenticated user has starred the Orca repo.
 * Returns true if starred, false if not, null if unable to determine (gh unavailable).
 */
export async function checkOrcaStarred(): Promise<boolean | null> {
  await acquire()
  try {
    const { stdout, stderr } = await execFileAsync(
      'gh',
      ['api', '--include', `user/starred/${ORCA_REPO}`],
      { encoding: 'utf-8' }
    )
    const response = `${stdout ?? ''}\n${stderr ?? ''}`
    if (/HTTP\/\S+\s+(?:200|204)\b/.test(response)) {
      return true
    }
    return null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 404 means the user hasn't starred — the only expected "no" answer
    if (message.includes('HTTP 404')) {
      return false
    }
    // Anything else (gh not installed, not authenticated, network issue)
    return null
  } finally {
    release()
  }
}

export function pickPushRemoteUrl(args: {
  originUrl: string | null
  cloneUrl: string
  sshUrl: string
}): string {
  const { originUrl, cloneUrl, sshUrl } = args
  if (originUrl && (/^(git@|ssh:)/.test(originUrl) || originUrl.includes('ssh.github.com'))) {
    return sshUrl
  }
  return cloneUrl
}

export function sanitizeRemoteName(owner: string, repo: string): string {
  const slug = `${owner}-${repo}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
  return slug ? `pr-${slug}` : 'pr-head'
}

/**
 * A fork push target plus the PR's `maintainer_can_modify` flag, kept outside
 * {@link GitPushTarget} so it never leaks into the persisted push-target shape.
 */
export type PullRequestPushTarget = {
  pushTarget: GitPushTarget
  /** false when the PR has "Allow edits from maintainers" off; a push may be rejected. */
  maintainerCanModify?: boolean
}

// Why: only an explicit `origin` preference is origin-only; `upstream`/`auto`/
// undefined keep the multi-candidate probe ordered upstream-first, matching
// resolvePrWorkItemSource list semantics.
export async function resolvePullRequestLookupCandidates(
  repoPath: string,
  preference: IssueSourcePreference | undefined,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitHubApiRepository[]> {
  if (preference === 'origin') {
    const origin = await getOriginGitHubApiRepository(repoPath, connectionId, localGitOptions)
    return origin ? [origin] : []
  }
  return (await resolveGitHubApiRepositoryCandidates(repoPath, connectionId, localGitOptions))
    .candidates
}

export async function getPullRequestPushTarget(
  repoPath: string,
  prNumber: number,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {},
  preference?: IssueSourcePreference
): Promise<PullRequestPushTarget | null> {
  const context = githubRepoContext(repoPath, connectionId, localGitOptions)
  const ghOptions = ghRepoExecOptions(context)
  const candidates = await resolvePullRequestLookupCandidates(
    repoPath,
    preference,
    connectionId,
    localGitOptions
  )
  if (candidates.length === 0) {
    return null
  }

  await acquire()
  try {
    let prStdout = ''
    let matchedRepository: GitHubApiRepository | null = null
    for (const candidate of candidates) {
      try {
        const { stdout } = await ghExecFileAsync(
          ['api', `repos/${candidate.owner}/${candidate.repo}/pulls/${prNumber}`],
          { ...ghOptions, ...githubHostExecOptions(candidate) }
        )
        prStdout = stdout
        matchedRepository = candidate
        break
      } catch (error) {
        // Why: origin is often the contributor fork while the PR belongs to upstream; probe all PR repos before giving up.
        if (isNotFoundGhError(error)) {
          continue
        }
        throw error
      }
    }
    if (!prStdout || !matchedRepository) {
      return null
    }
    const origin = await getGitHubApiRepositoryForRemote(
      repoPath,
      'origin',
      connectionId,
      localGitOptions
    )
    const pr = JSON.parse(prStdout) as {
      maintainer_can_modify?: boolean
      head?: {
        ref?: string
        repo?: {
          full_name?: string
          clone_url?: string
          ssh_url?: string
          owner?: { login?: string }
          name?: string
        } | null
      }
    }
    const headRepo = pr.head?.repo
    const branchName = pr.head?.ref?.trim()
    const owner = headRepo?.owner?.login?.trim()
    const repo = headRepo?.name?.trim() ?? headRepo?.full_name?.split('/')[1]?.trim()
    const cloneUrl = headRepo?.clone_url?.trim()
    const sshUrl = headRepo?.ssh_url?.trim()
    const maintainerCanModify =
      typeof pr.maintainer_can_modify === 'boolean' ? pr.maintainer_can_modify : undefined
    if (!owner || !repo || !branchName || !cloneUrl || !sshUrl) {
      return null
    }
    if (
      origin &&
      githubRepoIdentityKey(origin) ===
        githubRepoIdentityKey({ owner, repo, host: matchedRepository.host })
    ) {
      return {
        pushTarget: { remoteName: 'origin', branchName },
        ...(maintainerCanModify !== undefined ? { maintainerCanModify } : {})
      }
    }

    let originUrl: string | null = null
    try {
      const rawOriginUrl = await getRemoteUrlForRepo(context, 'origin')
      originUrl = rawOriginUrl?.trim() || null
    } catch {
      originUrl = null
    }
    return {
      pushTarget: {
        remoteName: sanitizeRemoteName(owner, repo),
        branchName,
        remoteUrl: pickPushRemoteUrl({ originUrl, cloneUrl, sshUrl })
      },
      ...(maintainerCanModify !== undefined ? { maintainerCanModify } : {})
    }
  } finally {
    release()
  }
}

/**
 * Star the Orca repo for the authenticated user.
 */
export async function starOrca(): Promise<boolean> {
  await acquire()
  try {
    await execFileAsync('gh', ['api', '-X', 'PUT', `user/starred/${ORCA_REPO}`], {
      encoding: 'utf-8'
    })
    return true
  } catch {
    return false
  } finally {
    release()
  }
}

/**
 * Get the authenticated GitHub viewer when gh is available and logged in.
 * Returns null when gh is unavailable, unauthenticated, or the lookup fails.
 */
export async function getAuthenticatedViewer(): Promise<GitHubViewer | null> {
  await acquire()
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['api', 'user', '--jq', '{login: .login, email: .email}'],
      { encoding: 'utf-8' }
    )
    const viewer = JSON.parse(stdout) as { login?: string; email?: string | null }
    if (!viewer.login?.trim()) {
      return null
    }
    return {
      login: viewer.login.trim(),
      email: viewer.email?.trim() || null
    }
  } catch {
    return null
  } finally {
    release()
  }
}

// Why: omit repoId — the main process only has the path; the renderer stamps repoId after IPC.
