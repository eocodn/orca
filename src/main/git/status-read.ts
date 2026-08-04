import { resolveGitStatusLimit } from '../../shared/git-status-limit'
import {
  beginGitStatusLineStatsCacheWrite,
  clearGitStatusLineStatsCache,
  clearGitStatusLineStatsCacheKey,
  reuseOrRecomputeGitStatusLineStats
} from '../../shared/git-status-line-stats-cache'
import { StatusPorcelainParser } from '../../shared/git-status-porcelain-parser'
import { InFlightPromiseDedupe,stableInFlightKey } from '../../shared/in-flight-promise-dedupe'
import type {
  GitDiffResult,
  GitStatusEntry,
  GitStatusResult,
  GitUpstreamStatus
} from '../../shared/types'
import type { GitRuntimeOptions } from './git-runtime-options'
import { GitStatusReadLeaseOwner } from './git-status-read-lease-owner'
import {
  gitOptionalLocksDisabledEnv,
  gitStreamStdout
} from './runner'
import { attachLineStats } from './status-submodules'
import { detectConflictOperation,getEffectiveUpstreamStatusCacheKey,getShortBranchName,parseUnmergedEntry,readOrProbeEffectiveUpstreamStatus,shouldProbeEffectiveUpstreamStatus } from './status-upstream'
import { findExistingWorktreeSymlinkPaths } from './worktree-symlink-detection'
const MAX_GIT_SHOW_BYTES = 10 * 1024 * 1024
const MAX_STAGED_COMMIT_CONTEXT_BYTES = MAX_GIT_SHOW_BYTES
const BULK_CHUNK_SIZE = 100
const EFFECTIVE_UPSTREAM_NEGATIVE_CACHE_TTL_MS = 5 * 60_000
const MAX_EFFECTIVE_UPSTREAM_NEGATIVE_CACHE_ENTRIES = 512

type EffectiveUpstreamStatusCacheEntry = {
  expiresAt: number
  status: GitUpstreamStatus
}

const SUBMODULE_PATHS_CACHE_TTL_MS = 5_000
const MAX_SUBMODULE_PATHS_CACHE_ENTRIES = 512
type SubmodulePathsCacheEntry = { paths: string[]; expiresAt: number }
const submodulePathsCache = new Map<string, SubmodulePathsCacheEntry>()
let submodulePathsCacheGeneration = 0

// Why: cache the upstream name to skip its 4-5-spawn resolution chain each poll; revalidate via one rev-list (issue #7576).
const RESOLVED_UPSTREAM_NAME_CACHE_TTL_MS = 60_000

type ResolvedUpstreamNameCacheEntry = {
  upstreamName: string
  expiresAt: number
}

const resolvedUpstreamNameCache = new Map<string, ResolvedUpstreamNameCacheEntry>()

const effectiveUpstreamStatusCache = new Map<string, EffectiveUpstreamStatusCacheEntry>()
const effectiveUpstreamStatusInFlight = new Map<string, Promise<GitUpstreamStatus>>()
const retiredEffectiveUpstreamStatusInFlight = new Map<string, Promise<GitUpstreamStatus>>()
const gitDiffReadDedupe = new InFlightPromiseDedupe<GitDiffResult>()
const effectiveUpstreamStatusWriteGeneration = new Map<string, number>()
const statusReadLeaseOwner = new GitStatusReadLeaseOwner<GitStatusResult>()

// Why: clear both diff and status in-flight caches; clearing only diff would let getStatus() join a pre-mutation read.
function invalidateGitReadCaches(): void {
  gitDiffReadDedupe.clear()
  statusReadLeaseOwner.invalidate()
  clearGitStatusLineStatsCache()
  clearSubmodulePathsCache()
  resolvedUpstreamNameCache.clear()
}

async function runWithGitReadCacheInvalidation<T>(run: () => Promise<T>): Promise<T> {
  invalidateGitReadCaches()
  try {
    return await run()
  } finally {
    // Why: a read that started mid-mutation can be stale too, so invalidate again after.
    invalidateGitReadCaches()
  }
}

function clearSubmodulePathsCacheForTests(): void {
  clearSubmodulePathsCache()
}

function clearSubmodulePathsCache(): void {
  submodulePathsCache.clear()
  // Why: bump the generation so a pre-mutation read can't repopulate the invalidated cache.
  submodulePathsCacheGeneration += 1
}

function getSubmodulePathsCacheCountForTests(): number {
  return submodulePathsCache.size
}

function gitRuntimeOptionsKey(options: GitRuntimeOptions): readonly unknown[] {
  return [options.wslDistro ?? null]
}

function getSubmodulePathsCacheKey(worktreePath: string, options: GitRuntimeOptions): string {
  // Why: the same path can map to different WSL-distro filesystems, so key the cache by runtime routing.
  return [worktreePath, ...gitRuntimeOptionsKey(options)].join('\0')
}

function pruneExpiredSubmodulePathsCache(now: number): void {
  for (const [cacheKey, entry] of submodulePathsCache) {
    if (entry.expiresAt <= now) {
      submodulePathsCache.delete(cacheKey)
    }
  }
}

function trimSubmodulePathsCache(): void {
  while (submodulePathsCache.size > MAX_SUBMODULE_PATHS_CACHE_ENTRIES) {
    const oldestKey = submodulePathsCache.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    submodulePathsCache.delete(oldestKey)
  }
}

function getCachedSubmodulePaths(cacheKey: string, now: number): string[] | null {
  const cached = submodulePathsCache.get(cacheKey)
  if (!cached) {
    return null
  }
  if (cached.expiresAt <= now) {
    submodulePathsCache.delete(cacheKey)
    return null
  }
  submodulePathsCache.delete(cacheKey)
  submodulePathsCache.set(cacheKey, cached)
  return cached.paths
}

function rememberSubmodulePaths(cacheKey: string, paths: string[], now: number): void {
  submodulePathsCache.delete(cacheKey)
  submodulePathsCache.set(cacheKey, { paths, expiresAt: now + SUBMODULE_PATHS_CACHE_TTL_MS })
  trimSubmodulePathsCache()
}

// Why: tests reuse this hook, so every memoization layer resets together despite the upstream-only name.
function clearEffectiveUpstreamStatusCacheForTests(): void {
  effectiveUpstreamStatusCache.clear()
  effectiveUpstreamStatusInFlight.clear()
  retiredEffectiveUpstreamStatusInFlight.clear()
  effectiveUpstreamStatusWriteGeneration.clear()
  invalidateGitReadCaches()
}

function getEffectiveUpstreamStatusCacheCountForTests(): number {
  return effectiveUpstreamStatusCache.size
}

function getEffectiveUpstreamStatusGenerationCountForTests(): number {
  return effectiveUpstreamStatusWriteGeneration.size
}

type GetStatusOptions = GitRuntimeOptions & {
  includeIgnored?: boolean
  reuseLineStats?: boolean
  /**
   * Max changed-file entries before git is stopped and the result is marked
   * `didHitLimit`. Defaults to DEFAULT_GIT_STATUS_LIMIT; 0 disables the cap.
   */
  limit?: number
  bypassEffectiveUpstreamNegativeCache?: boolean
  /** Paths Orca may have symlinked into this worktree (per-user shared paths
   *  plus `orca.yaml` shared directories). Untracked entries that are one of
   *  these *and* really symlinks are dropped: Git cannot ignore them when the
   *  repo's rule is directory-only (`node_modules/`), but they are Orca's own
   *  artifacts, not user work. */
  sharedLinkPaths?: readonly string[]
}

/**
 * Parse `git status --porcelain=v2` output into structured entries.
 */
async function getStatus(
  worktreePath: string,
  options: GetStatusOptions = {}
): Promise<GitStatusResult> {
  gitDiffReadDedupe.clear()
  // Why: dedupe only concurrent identical reads; after settle, callers must run a fresh read.
  const cacheKey = getStatusReadKey(worktreePath, options)
  return statusReadLeaseOwner.lease(cacheKey, options.signal, (sharedSignal) =>
    runGetStatus(worktreePath, { ...options, signal: sharedSignal })
  )
}

function getStatusReadKey(worktreePath: string, options: GetStatusOptions): string {
  // Why: each key part can change the output shape or runtime routing.
  const limit = resolveGitStatusLimit(options.limit)
  return stableInFlightKey([
    worktreePath,
    options.wslDistro ?? '',
    options.includeIgnored === true,
    options.reuseLineStats === true,
    options.bypassEffectiveUpstreamNegativeCache === true,
    limit,
    // Why: this changes which entries survive, so it must not share a cache slot.
    options.sharedLinkPaths ?? []
  ])
}

/** Remove untracked entries that are shared symlinks Orca created.
 *
 *  Why this can't be left to Git: a directory-only ignore rule (`node_modules/`)
 *  matches the primary checkout's real directory but never the worktree's
 *  symlink, so Git reports it untracked forever — a phantom row in the diff and
 *  a permanently "dirty" worktree.
 *
 *  Tight on both axes: an entry must be configured as shared *and* actually be a
 *  symlink. A regular file the user created at a configured name still shows up,
 *  and so does a symlink at a path nobody declared shared. Mutates `entries`. */
async function dropSharedSymlinkUntrackedEntries(
  worktreePath: string,
  entries: GitStatusEntry[],
  sharedLinkPaths: readonly string[]
): Promise<void> {
  // Why: a clean tree has no untracked entries, so this costs nothing on the
  // common status-poll path — no syscall, no config read, no subprocess.
  if (sharedLinkPaths.length === 0 || !entries.some((entry) => entry.area === 'untracked')) {
    return
  }
  const sharedLinks = new Set(await findExistingWorktreeSymlinkPaths(worktreePath, sharedLinkPaths))
  if (sharedLinks.size === 0) {
    return
  }
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (entry.area === 'untracked' && sharedLinks.has(entry.path)) {
      entries.splice(index, 1)
    }
  }
}

async function runGetStatus(
  worktreePath: string,
  options: GetStatusOptions = {}
): Promise<GitStatusResult> {
  const lineStatsCacheKey = getStatusLineStatsCacheKey(worktreePath, options)
  const lineStatsWriteToken = beginGitStatusLineStatsCacheWrite(lineStatsCacheKey)
  let effectiveUpstreamStatus: GitUpstreamStatus | undefined
  let statusSucceeded = false
  // Why: a bad limit (negative/fractional/NaN) breaks early-stop; require a valid non-negative int (0 disables the cap).
  const limit = resolveGitStatusLimit(options.limit)

  // Why: detectConflictOperation and git status are independent, so run them concurrently to save I/O latency.
  const conflictPromise = detectConflictOperation(worktreePath)
  // Why: core.quotePath=false keeps non-ASCII paths as raw UTF-8, not octal escapes, so entry.path is readable and lookups match.
  const statusArgs = [
    '-c',
    'core.quotePath=false',
    'status',
    '--porcelain=v2',
    '--branch',
    '--untracked-files=all'
  ]
  if (options.includeIgnored) {
    statusArgs.push('--ignored=matching')
  }

  // Why: stream + parse and stop at `limit` so a huge un-ignored folder can't buffer enough to crash the process.
  const parser = new StatusPorcelainParser()
  let didHitLimit = false
  const conflictOperation = await conflictPromise

  try {
    const { stoppedEarly } = await gitStreamStdout(statusArgs, {
      cwd: worktreePath,
      wslDistro: options.wslDistro,
      // Why: status polling is read-like; disable optional locks to avoid racing terminal Git on index.lock.
      env: gitOptionalLocksDisabledEnv(),
      signal: options.signal,
      onStdout: (chunk) => parser.update(chunk, limit)
    })
    if (!stoppedEarly) {
      parser.finish()
    }
    didHitLimit = stoppedEarly
    statusSucceeded = true
  } catch (error) {
    // Why: an aborted scan must reject, not resolve as an empty result.
    if (options.signal?.aborted) {
      throw error
    }
    // Not a git repo or git not available
  }

  const entries: GitStatusEntry[] = []
  const { head, branch, upstreamName, upstreamAheadBehind } = parser.branch

  // Why: resolve deferred conflicts in Git's output order so the cap cannot hide
  // an early conflict behind ordinary rows that appeared later in the stream.
  for (const record of parser.statusRecords) {
    if (didHitLimit && entries.length >= limit) {
      break
    }
    if (record.type === 'entry') {
      entries.push(record.entry)
    } else {
      const unmergedEntry = await parseUnmergedEntry(worktreePath, record.line)
      if (unmergedEntry) {
        entries.push(unmergedEntry)
      }
    }
  }

  await dropSharedSymlinkUntrackedEntries(worktreePath, entries, options.sharedLinkPaths ?? [])

  if (statusSucceeded && !didHitLimit && shouldProbeEffectiveUpstreamStatus(branch, upstreamName)) {
    const branchName = getShortBranchName(branch)
    if (branchName) {
      const cacheKey = getEffectiveUpstreamStatusCacheKey(
        worktreePath,
        branchName,
        upstreamName,
        options
      )
      try {
        // Why: the shared probe/caches serve concurrent reads, so run it unbound from this signal — one abort mustn't reject it for others.
        const { signal: _requestSignal, ...sharedProbeOptions } = options
        effectiveUpstreamStatus = await readOrProbeEffectiveUpstreamStatus(
          cacheKey,
          worktreePath,
          branchName,
          sharedProbeOptions,
          options.bypassEffectiveUpstreamNegativeCache === true
        )
      } catch {
        // Why: don't fail status polling on a transient upstream-probe error; the explicit upstream path surfaces those.
      }
    }
  }

  // Why: line counts run only for areas with entries (clean tree = 0 calls); skip past the limit to avoid numstat over a huge set.
  if (!didHitLimit) {
    await reuseOrRecomputeGitStatusLineStats({
      cacheKey: lineStatsCacheKey,
      head,
      entries,
      writeToken: lineStatsWriteToken,
      reuse: options.reuseLineStats === true,
      isAborted: () => options.signal?.aborted === true,
      recompute: () => attachLineStats(worktreePath, entries, options)
    })
  } else {
    clearGitStatusLineStatsCacheKey(lineStatsCacheKey, lineStatsWriteToken)
  }

  // Why: an abort after the stream (unmerged/upstream/line-stats work) must still reject, not resolve.
  if (options.signal?.aborted) {
    const error = new Error('The operation was aborted.')
    error.name = 'AbortError'
    throw error
  }

  return {
    entries,
    conflictOperation,
    head,
    branch,
    ...(options.includeIgnored ? { ignoredPaths: parser.ignoredPaths } : {}),
    ...(didHitLimit ? { didHitLimit: true, statusLength: parser.statusLength } : {}),
    ...(statusSucceeded
      ? {
          upstreamStatus:
            effectiveUpstreamStatus ??
            (upstreamName
              ? {
                  hasUpstream: true,
                  upstreamName,
                  ahead: upstreamAheadBehind?.ahead ?? 0,
                  behind: upstreamAheadBehind?.behind ?? 0
                }
              : { hasUpstream: false, ahead: 0, behind: 0 })
        }
      : {})
  }
}

function getStatusLineStatsCacheKey(worktreePath: string, options: GitRuntimeOptions = {}): string {
  // Why: identical paths can map to different WSL-distro filesystems, so key stats by Git's execution host.
  return `${options.wslDistro ?? 'native'}\0${worktreePath}`
}

/**
 * Resolve a submodule's own worktree path from a parent worktree + relative
 * submodule path, rejecting anything that escapes the parent.
 */

export { BULK_CHUNK_SIZE,clearEffectiveUpstreamStatusCacheForTests,clearSubmodulePathsCache,clearSubmodulePathsCacheForTests,dropSharedSymlinkUntrackedEntries,EFFECTIVE_UPSTREAM_NEGATIVE_CACHE_TTL_MS,effectiveUpstreamStatusCache,effectiveUpstreamStatusInFlight,effectiveUpstreamStatusWriteGeneration,getCachedSubmodulePaths,getEffectiveUpstreamStatusCacheCountForTests,getEffectiveUpstreamStatusGenerationCountForTests,getStatus,getStatusLineStatsCacheKey,getStatusReadKey,getSubmodulePathsCacheCountForTests,getSubmodulePathsCacheKey,gitDiffReadDedupe,gitRuntimeOptionsKey,invalidateGitReadCaches,MAX_EFFECTIVE_UPSTREAM_NEGATIVE_CACHE_ENTRIES,MAX_GIT_SHOW_BYTES,MAX_STAGED_COMMIT_CONTEXT_BYTES,MAX_SUBMODULE_PATHS_CACHE_ENTRIES,pruneExpiredSubmodulePathsCache,rememberSubmodulePaths,RESOLVED_UPSTREAM_NAME_CACHE_TTL_MS,resolvedUpstreamNameCache,retiredEffectiveUpstreamStatusInFlight,runGetStatus,runWithGitReadCacheInvalidation,statusReadLeaseOwner,SUBMODULE_PATHS_CACHE_TTL_MS,submodulePathsCache,submodulePathsCacheGeneration,trimSubmodulePathsCache,type EffectiveUpstreamStatusCacheEntry,type GetStatusOptions,type ResolvedUpstreamNameCacheEntry,type SubmodulePathsCacheEntry }
