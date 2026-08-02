import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { gitExecFileSync, gitExecFileAsync } from './runner'
import type { BaseRefSearchResult } from '../../shared/types'
import { parseGitRevListAheadBehindCounts } from '../../shared/git-rev-list-output'
import { normalizeRuntimePathSeparators } from '../../shared/cross-platform-path'
import { isForEachRefExcludeUnsupportedError } from '../../shared/git-ref-command-capabilities'
import { parseWslUncPath } from '../../shared/wsl-paths'
import { toWindowsWslPath } from '../wsl'
import { buildHostedRemoteCommitUrl, buildHostedRemoteFileUrl } from './hosted-remote-url'
import { getLocalGitCapabilityCache } from './git-capability-state'
import { type LocalGitExecOptions, type LocalDefaultBaseRefGitOptions, DEFAULT_BASE_REF_PROBE_TIMEOUT_MS, gitExecOptions, DEFAULT_BASE_REF_PROBES, resolveDefaultBaseRefFromProbes } from './repo-detection'
function getRepoName(path: string): string {
  const name = basename(path)
  // Strip .git suffix from bare repos
  return name.endsWith('.git') ? name.slice(0, -4) : name
}

/** Get the remote origin URL, or null if not set. */
function getRemoteUrl(path: string): string | null {
  try {
    return getRemoteUrlByName(path, 'origin')
  } catch {
    return null
  }
}

function getRemoteUrlByName(path: string, remote: string): string {
  return gitExecFileSync(['remote', 'get-url', remote], {
    cwd: path
  }).trim()
}

function hasGitRef(path: string, ref: string): boolean {
  try {
    gitExecFileSync(['rev-parse', '--verify', ref], {
      cwd: path
    })
    return true
  } catch {
    return false
  }
}

function gitRefToDefaultBaseRef(ref: string): string {
  return ref.replace(/^refs\/remotes\//, '')
}

function getVerifiedOriginHeadBaseRef(path: string): string | null {
  try {
    const ref = gitExecFileSync(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], {
      cwd: path
    }).trim()

    // Why: origin/HEAD may survive a default-branch rename pointing at a deleted ref; verify before trusting it.
    return ref && hasGitRef(path, ref) ? gitRefToDefaultBaseRef(ref) : null
  } catch {
    return null
  }
}

/**
 * Resolve the default base ref for new worktrees, preferring the remote primary over a stale local branch.
 * Returns null when nothing resolves (rather than a hardcoded `origin/main`) so callers fail loudly or degrade.
 */
function getDefaultBaseRef(path: string): string | null {
  const originHeadBaseRef = getVerifiedOriginHeadBaseRef(path)
  if (originHeadBaseRef) {
    return originHeadBaseRef
  }

  // Why: walk the shared DEFAULT_BASE_REF_PROBES so sync and async/SSH paths can't drift on ref order.
  for (const { ref, returnAs } of DEFAULT_BASE_REF_PROBES) {
    if (hasGitRef(path, ref)) {
      return returnAs
    }
  }
  return null
}

async function getBaseRefDefault(
  path: string,
  options: LocalGitExecOptions = {}
): Promise<string | null> {
  return getDefaultBaseRefAsync(path, options)
}

/**
 * Return { ahead, behind } (merge-base-symmetric delta) for localRef vs remoteRef, or null on failure.
 * ahead = commits on localRef not in remoteRef; behind = the reverse. Used by the stale-base dispatch guard (§3.1).
 */
function getRemoteDrift(
  repoPath: string,
  localRef: string,
  remoteRef: string,
  options: LocalGitExecOptions = {}
): { ahead: number; behind: number } | null {
  try {
    const stdout = gitExecFileSync(
      ['rev-list', '--left-right', '--count', `${localRef}...${remoteRef}`],
      gitExecOptions(repoPath, options)
    )
    const counts = parseGitRevListAheadBehindCounts(stdout)
    if (counts.status !== 'ok') {
      return null
    }
    return { ahead: counts.ahead, behind: counts.behind }
  } catch {
    return null
  }
}

/**
 * Up to `limit` commit subjects on remoteRef but not localRef, recency order; [] on git failure.
 * Powers the preamble drift section (§3.2) so a worker sees whether stale-base drift touches its area.
 */
function getRecentDriftSubjects(
  repoPath: string,
  localRef: string,
  remoteRef: string,
  limit: number,
  options: LocalGitExecOptions = {}
): string[] {
  try {
    const stdout = gitExecFileSync(
      ['log', '--format=%s', '-n', String(limit), `${localRef}..${remoteRef}`],
      gitExecOptions(repoPath, options)
    )
    return stdout.split('\n').filter((s) => s.trim().length > 0)
  } catch {
    return []
  }
}

/** Parse `git remote` stdout into a remote count. Shared local/SSH so count semantics can't drift. */
function parseRemoteCount(stdout: string): number {
  return stdout.split('\n').filter((line) => line.trim().length > 0).length
}

/** Count configured remotes via `git remote`; returns 0 on error (callers read 0 as "unknown / no hint"). */
async function getRemoteCount(path: string): Promise<number> {
  try {
    const { stdout } = await gitExecFileAsync(['remote'], { cwd: path })
    return parseRemoteCount(stdout)
  } catch (err) {
    // Why: log so a missing multi-remote hint is debuggable; callers still treat 0 as "unknown".
    console.warn('[getRemoteCount] git remote failed', { path, err })
    return 0
  }
}

/** Callback shape for a git exec function that yields stdout. */
type GitExec = (argv: string[]) => Promise<{ stdout: string }>

async function hasGitRefViaExec(exec: GitExec, ref: string): Promise<boolean> {
  try {
    await exec(['rev-parse', '--verify', '--quiet', ref])
    return true
  } catch {
    return false
  }
}

async function resolveVerifiedOriginHeadBaseRefViaExec(exec: GitExec): Promise<string | null> {
  try {
    const { stdout } = await exec(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
    const ref = stdout.trim()
    if (!ref || !(await hasGitRefViaExec(exec, ref))) {
      return null
    }
    return gitRefToDefaultBaseRef(ref)
  } catch {
    return null
  }
}

/**
 * Resolve the default base ref via a git exec callback: prefer origin/HEAD's symbolic-ref target,
 * else fall back to DEFAULT_BASE_REF_PROBES. Shared local/SSH so both transports agree.
 *
 * Why swallow symbolic-ref's error: a non-zero exit is the expected "origin/HEAD unset" signal, not a failure.
 */
async function resolveDefaultBaseRefViaExec(exec: GitExec): Promise<string | null> {
  const originHeadBaseRef = await resolveVerifiedOriginHeadBaseRefViaExec(exec)
  if (originHeadBaseRef) {
    return originHeadBaseRef
  }
  return resolveDefaultBaseRefFromProbes((ref) => hasGitRefViaExec(exec, ref))
}

function resolveDefaultBaseRefWithLocalGit(
  options: LocalDefaultBaseRefGitOptions
): Promise<string | null> {
  return resolveDefaultBaseRefViaExec((argv) =>
    gitExecFileAsync(argv, {
      ...options,
      // Why: async avoids main-thread stalls, but dead local/WSL filesystems still need a bound.
      timeout: DEFAULT_BASE_REF_PROBE_TIMEOUT_MS
    })
  )
}

async function getDefaultBaseRefAsync(
  path: string,
  options: LocalGitExecOptions = {}
): Promise<string | null> {
  return resolveDefaultBaseRefWithLocalGit(gitExecOptions(path, options))
}

/**
 * Build the argv for `git for-each-ref` used by ref search, given an already-normalized query.
 *
 * Why: glob every remote (`refs/remotes/*\/*`), not just origin, so fork workflows can find branches like
 * `upstream/main` — see docs/upstream-base-ref-design.md. Shared with the SSH relay path so argv can't diverge.
 */
const REF_SEARCH_CANDIDATE_MULTIPLIER = 4
const REF_SEARCH_LEGACY_HEADROOM = 100

export { getRepoName, getRemoteUrl, getRemoteUrlByName, hasGitRef, gitRefToDefaultBaseRef, getVerifiedOriginHeadBaseRef, getDefaultBaseRef, getBaseRefDefault, getRemoteDrift, getRecentDriftSubjects, parseRemoteCount, getRemoteCount, hasGitRefViaExec, resolveVerifiedOriginHeadBaseRefViaExec, resolveDefaultBaseRefViaExec, resolveDefaultBaseRefWithLocalGit, getDefaultBaseRefAsync, REF_SEARCH_CANDIDATE_MULTIPLIER, REF_SEARCH_LEGACY_HEADROOM }
export { type GitExec }

