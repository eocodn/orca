import type {
  ClassifiedError,
  GitLabAssignableUser,
  GitLabAuthDiagnostic,
  GitLabDiscussionResolveResult,
  GitLabJobTraceResult,
  GitLabPagedResult,
  GitLabPipelineJob,
  GitLabRateLimitSnapshot,
  GitLabMRInlineCommentInput,
  GitLabMRReviewersUpdateResult,
  GitLabRetryJobResult,
  GitLabTodo,
  GitLabViewer,
  GitLabWorkItem,
  GetGitLabRateLimitResult,
  IssueSourcePreference,
  ListMergeRequestsResult,
  MRComment,
  MRInfo,
  MRListState
} from '../../shared/types'
import { derivePipelineStatus, mapIssueToWorkItem, mapMRInfo, mapMRToWorkItem } from './mappers'
import {
  acquire,
  classifyGlabError,
  classifyListIssuesError,
  getGlabKnownHosts,
  getProjectRef,
  getProjectRefForRemote,
  glabHostnameArgs,
  glabRepoExecOptions,
  glabApiWithHeaders,
  glabExecFileAsync,
  parseGlabAuthStatusHosts,
  release,
  resolveIssueSource,
  type LocalGitExecOptions,
  type ProjectRef
} from './gl-utils'
import { rememberGlabKnownHosts } from './gitlab-known-host-probe'
import type { IssueListState } from './issues'
import {
  hasHostedReviewLocalGitOptions,
  getHostedReviewLocalGitOptions,
  type HostedReviewExecutionOptions
} from '../source-control/hosted-review-git-options'
import { shouldHideNonOpenReviewOnDefaultBranch } from '../source-control/repo-default-branch'

// Why: glab REST addresses projects by URL-encoded path; escapes slashes for nested groups.
function encodedProject(projectPath: string): string {
  return encodeURIComponent(projectPath)
}

const GITLAB_RATE_LIMIT_CACHE_TTL_MS = 30_000
const GITLAB_RATE_LIMIT_CACHE_MAX_ENTRIES = 64
const gitLabRateLimitCache = new Map<string, GitLabRateLimitSnapshot>()

type HostedReviewLocalGitOptions = ReturnType<typeof getHostedReviewLocalGitOptions>

function hostedReviewLocalGitOptionArgs(
  options: HostedReviewExecutionOptions = {}
): [] | [HostedReviewLocalGitOptions] {
  return hasHostedReviewLocalGitOptions(options) ? [getHostedReviewLocalGitOptions(options)] : []
}

/**
 * Get the authenticated GitLab viewer.
 * Returns null when glab is unavailable, unauthenticated, or the lookup fails.
 */
async function getAuthenticatedViewer(): Promise<GitLabViewer | null> {
  await acquire()
  try {
    const { stdout } = await glabExecFileAsync(['api', 'user'])
    const viewer = JSON.parse(stdout) as { username?: string; email?: string | null }
    if (!viewer.username?.trim()) {
      return null
    }
    return {
      username: viewer.username.trim(),
      email: viewer.email?.trim() || null
    }
  } catch {
    return null
  } finally {
    release()
  }
}

async function diagnoseAuth(): Promise<GitLabAuthDiagnostic> {
  const envTokenInProcess = process.env.GITLAB_TOKEN
    ? 'GITLAB_TOKEN'
    : process.env.GLAB_TOKEN
      ? 'GLAB_TOKEN'
      : null
  try {
    // Why: a host-global diagnostic must not wake an unrelated default WSL distro.
    const { stdout, stderr } = await glabExecFileAsync(['auth', 'status'], {
      allowDefaultWslFallback: false
    })
    const output = `${stdout}\n${stderr}`
    const hosts = parseGlabAuthStatusHosts(output)
    // Why: refreshing auth must advance the provider cache key past a stale null result.
    rememberGlabKnownHosts(hosts)
    return {
      glabAvailable: true,
      authenticated:
        /logged in|authenticated|token/i.test(output) && !/not logged in/i.test(output),
      hosts,
      activeHost: hosts[0] ?? null,
      envTokenInProcess,
      error: null
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      glabAvailable: !/ENOENT|not found|spawn/i.test(message),
      authenticated: false,
      hosts: [],
      activeHost: null,
      envTokenInProcess,
      error: message
    }
  }
}

function parseRateLimitHeader(
  headers: Record<string, string>,
  keys: readonly string[]
): number | null {
  for (const key of keys) {
    const parsed = Number.parseInt(headers[key], 10)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function parseRateLimitResetAt(headers: Record<string, string>): number | null {
  const numeric = parseRateLimitHeader(headers, ['ratelimit-reset', 'x-ratelimit-reset'])
  if (numeric !== null) {
    return numeric
  }
  const resetTime = headers['ratelimit-resettime'] ?? headers['x-ratelimit-resettime']
  if (!resetTime) {
    return null
  }
  const millis = Date.parse(resetTime)
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : null
}

function parseGitLabRateLimitSnapshot(
  headers: Record<string, string>,
  host: string | null
): GitLabRateLimitSnapshot {
  const limit = parseRateLimitHeader(headers, ['ratelimit-limit', 'x-ratelimit-limit'])
  const remaining = parseRateLimitHeader(headers, ['ratelimit-remaining', 'x-ratelimit-remaining'])
  const resetAt = parseRateLimitResetAt(headers)
  return {
    host,
    fetchedAt: Date.now(),
    rest:
      limit === null && remaining === null && resetAt === null
        ? null
        : {
            limit: limit ?? 0,
            remaining: remaining ?? 0,
            resetAt
          }
  }
}

/** @internal — test-only */
function _resetGitLabRateLimitCache(): void {
  gitLabRateLimitCache.clear()
}

/** @internal — test-only */
function _getGitLabRateLimitCacheSize(): number {
  return gitLabRateLimitCache.size
}

function pruneGitLabRateLimitCache(now = Date.now()): void {
  for (const [cacheKey, snapshot] of gitLabRateLimitCache) {
    if (now - snapshot.fetchedAt >= GITLAB_RATE_LIMIT_CACHE_TTL_MS) {
      gitLabRateLimitCache.delete(cacheKey)
    }
  }
  while (gitLabRateLimitCache.size > GITLAB_RATE_LIMIT_CACHE_MAX_ENTRIES) {
    const oldestKey = gitLabRateLimitCache.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    gitLabRateLimitCache.delete(oldestKey)
  }
}

function rememberGitLabRateLimitSnapshot(
  cacheKey: string,
  snapshot: GitLabRateLimitSnapshot
): void {
  pruneGitLabRateLimitCache()
  // Why: self-managed hostnames come from repo config; keep this cache bounded across many transient hosts.
  gitLabRateLimitCache.delete(cacheKey)
  gitLabRateLimitCache.set(cacheKey, snapshot)
  pruneGitLabRateLimitCache()
}

async function getRateLimit(options?: {
  force?: boolean
  host?: string | null
}): Promise<GetGitLabRateLimitResult> {
  const host = options?.host?.trim() || null
  const cacheKey = host ?? 'default'
  pruneGitLabRateLimitCache()
  const cached = gitLabRateLimitCache.get(cacheKey)
  if (!options?.force && cached && Date.now() - cached.fetchedAt < GITLAB_RATE_LIMIT_CACHE_TTL_MS) {
    return { ok: true, snapshot: cached }
  }

  await acquire()
  try {
    // Why: GitLab exposes REST budget headers inconsistently; a null bucket means this host omitted them.
    const args = host ? ['--hostname', host, 'user'] : ['user']
    const { headers } = await glabApiWithHeaders(args)
    const snapshot = parseGitLabRateLimitSnapshot(headers, host)
    rememberGitLabRateLimitSnapshot(cacheKey, snapshot)
    return { ok: true, snapshot }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  } finally {
    release()
  }
}

/** Resolve a project's full GitLab project ref (host + path); null for non-GitLab remotes. */
async function getProjectSlug(
  repoPath: string,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<ProjectRef | null> {
  const localGitArgs = hostedReviewLocalGitOptionArgs(options)
  const knownHosts = await getGlabKnownHosts(connectionId, localGitArgs[0])
  return getProjectRef(repoPath, knownHosts, connectionId, ...localGitArgs)
}

/**
 * Fetch a single merge request with pipeline status rolled up.
 * Returns null when the MR doesn't exist or glab fails.
 */
async function getMergeRequest(
  repoPath: string,
  iid: number,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<MRInfo | null> {
  const localGitArgs = hostedReviewLocalGitOptionArgs(options)
  const localGitOptions = localGitArgs[0] ?? {}
  const knownHosts = await getGlabKnownHosts(connectionId, localGitOptions)
  const projectRef = await getProjectRef(repoPath, knownHosts, connectionId, ...localGitArgs)
  await acquire()
  try {
    const args = projectRef
      ? [
          'api',
          ...glabHostnameArgs(projectRef, connectionId),
          `projects/${encodedProject(projectRef.path)}/merge_requests/${iid}`
        ]
      : ['mr', 'view', String(iid), '--output', 'json']
    const { stdout } = await glabExecFileAsync(
      args,
      glabRepoExecOptions(repoPath, connectionId, localGitOptions)
    )
    const data = JSON.parse(stdout) as Parameters<typeof mapMRInfo>[0] & {
      head_pipeline?: { status?: string } | null
      pipeline?: { status?: string } | null
    }
    // Why: older GitLab instances expose `pipeline` instead of `head_pipeline`; try both.
    const pipelineStatus = derivePipelineStatus(data.head_pipeline ?? data.pipeline ?? null)
    return mapMRInfo(data, pipelineStatus)
  } catch {
    return null
  } finally {
    release()
  }
}

/**
 * Find the merge request whose source branch matches the given name.
 * Returns the most recently updated MR for the branch, or null when none exists.
 */
async function getMergeRequestForBranch(
  repoPath: string,
  branch: string,
  linkedMRIid?: number | null,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {},
  // Why: when true, a failed lookup throws instead of returning null, so callers never report a false not_found.
  throwOnFailure = false
): Promise<MRInfo | null> {
  const branchName = branch.replace(/^refs\/heads\//, '')
  if (!branchName && linkedMRIid == null) {
    return null
  }
  const localGitArgs = hostedReviewLocalGitOptionArgs(options)
  const localGitOptions = localGitArgs[0] ?? {}
  const knownHosts = await getGlabKnownHosts(connectionId, localGitOptions)
  const projectRef = await getProjectRef(repoPath, knownHosts, connectionId, ...localGitArgs)
  if (!projectRef) {
    return null
  }
  await acquire()
  try {
    if (branchName) {
      const { stdout } = await glabExecFileAsync(
        [
          'api',
          ...glabHostnameArgs(projectRef, connectionId),
          `projects/${encodedProject(projectRef.path)}/merge_requests?source_branch=${encodeURIComponent(branchName)}&order_by=updated_at&sort=desc&per_page=1`
        ],
        glabRepoExecOptions(repoPath, connectionId, localGitOptions)
      )
      const data = JSON.parse(stdout) as (Parameters<typeof mapMRInfo>[0] & {
        head_pipeline?: { status?: string } | null
        pipeline?: { status?: string } | null
      })[]
      if (Array.isArray(data) && data.length > 0) {
        const raw = data[0]
        // Why: older GitLab list payloads expose `pipeline` instead of `head_pipeline`.
        const pipelineStatus = derivePipelineStatus(raw.head_pipeline ?? raw.pipeline ?? null)
        const info = mapMRInfo(raw, pipelineStatus)
        // Why (#9171): discard a non-open implicit branch match on the repo
        // default branch and fall through to the linked-iid fallback below.
        const hideOnDefaultBranch = await shouldHideNonOpenReviewOnDefaultBranch({
          state: info.state,
          reviewNumber: info.number,
          linkedReviewNumber: linkedMRIid,
          branchName,
          repoPath,
          connectionId,
          localGitOptions
        })
        if (!hideOnDefaultBranch) {
          return info
        }
      }
    }
    if (typeof linkedMRIid !== 'number') {
      return null
    }
    // Why: create-from-MR worktrees may rename the branch; fall back to the durable linked iid.
    const { stdout } = await glabExecFileAsync(
      [
        'api',
        ...glabHostnameArgs(projectRef, connectionId),
        `projects/${encodedProject(projectRef.path)}/merge_requests/${linkedMRIid}`
      ],
      glabRepoExecOptions(repoPath, connectionId, localGitOptions)
    )
    const raw = JSON.parse(stdout) as Parameters<typeof mapMRInfo>[0] & {
      head_pipeline?: { status?: string } | null
      pipeline?: { status?: string } | null
    }
    const pipelineStatus = derivePipelineStatus(raw.head_pipeline ?? raw.pipeline ?? null)
    return mapMRInfo(raw, pipelineStatus)
  } catch (error) {
    if (throwOnFailure) {
      throw error
    }
    return null
  } finally {
    release()
  }
}

/**
 * Like getMergeRequestForBranch but throws glab failures instead of returning null, so callers report 'unavailable' not a false "not found".
 */
function getMergeRequestForBranchOrThrow(
  repoPath: string,
  branch: string,
  linkedMRIid?: number | null,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<MRInfo | null> {
  return getMergeRequestForBranch(repoPath, branch, linkedMRIid, connectionId, options, true)
}

export { encodedProject, GITLAB_RATE_LIMIT_CACHE_TTL_MS, GITLAB_RATE_LIMIT_CACHE_MAX_ENTRIES, gitLabRateLimitCache, hostedReviewLocalGitOptionArgs, getAuthenticatedViewer, diagnoseAuth, parseRateLimitHeader, parseRateLimitResetAt, parseGitLabRateLimitSnapshot, _resetGitLabRateLimitCache, _getGitLabRateLimitCacheSize, pruneGitLabRateLimitCache, rememberGitLabRateLimitSnapshot, getRateLimit, getProjectSlug, getMergeRequest, getMergeRequestForBranch, getMergeRequestForBranchOrThrow }
export { type HostedReviewLocalGitOptions }

