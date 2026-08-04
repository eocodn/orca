import { isForEachRefExcludeUnsupportedError } from '../../shared/git-ref-command-capabilities'
import type { BaseRefSearchResult } from '../../shared/types'
import { getLocalGitCapabilityCache } from './git-capability-state'
import { buildHostedRemoteCommitUrl,buildHostedRemoteFileUrl } from './hosted-remote-url'
import { getDefaultBaseRef,getDefaultBaseRefAsync,getRemoteUrl,REF_SEARCH_CANDIDATE_MULTIPLIER,REF_SEARCH_LEGACY_HEADROOM } from './repo-base-ref'
import { type LocalGitExecOptions,gitExecOptions } from './repo-detection'
import { gitExecFileAsync } from './runner'
type RefSearchPatternGroup = 'all' | 'segmented' | 'branchRoot'

function getRefSearchTokens(normalizedQuery: string): string[] {
  return normalizedQuery.split('/').filter((t) => t.length > 0)
}

function getRefSearchCandidateCount(limit: number, excludesRemoteHead: boolean): number {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('invalid_limit')
  }
  const baseCount = limit * REF_SEARCH_CANDIDATE_MULTIPLIER
  return excludesRemoteHead ? baseCount : baseCount + REF_SEARCH_LEGACY_HEADROOM
}

function buildSearchBaseRefsArgv(
  normalizedQuery: string,
  limit: number,
  options: {
    excludeRemoteHead?: boolean
    remoteNames?: readonly string[]
    patternGroup?: RefSearchPatternGroup
  } = {}
): string[] {
  const excludeRemoteHead = options.excludeRemoteHead ?? true
  const candidateCount = getRefSearchCandidateCount(limit, excludeRemoteHead)
  const base = [
    'for-each-ref',
    '--format=%(refname)%00%(refname:short)',
    '--sort=-committerdate',
    ...(excludeRemoteHead
      ? [
          // Why: exclude remote HEAD pseudo-refs before --count so the candidate window holds displayable refs.
          '--exclude=refs/remotes/**/HEAD'
        ]
      : []),
    // Why: cap git output so broad globs don't overflow execFile/SSH buffers in very large repos.
    `--count=${candidateCount}`
  ]
  // Why: split on `/` so display-format queries route each token to one ref segment; filter empties from stray slashes.
  const tokens = getRefSearchTokens(normalizedQuery)
  if (tokens.length <= 1) {
    const q = tokens[0] ?? ''
    // Why `**` not `*`: fnmatch `*` can't cross `/`, so match slash-named branches at both leaf and ancestor segments.
    return [
      ...base,
      `refs/heads/**/*${q}*`,
      `refs/heads/**/*${q}*/**`,
      `refs/remotes/**/*${q}*`,
      `refs/remotes/**/*${q}*/**`
    ]
  }
  // Why: one `*token*` per ref segment because fnmatch `*` can't cross `/`; lets a retyped `<remote>/<branch>` result match.
  const segmented = tokens.map((token) => `*${token}*`).join('/')
  const substringQuery = tokens.join('/')
  const remoteBranchRootPatterns =
    options.remoteNames && options.remoteNames.length > 0
      ? options.remoteNames.flatMap((remote) => [
          `refs/remotes/${remote}/${substringQuery}*`,
          `refs/remotes/${remote}/${substringQuery}*/**`
        ])
      : [`refs/remotes/*/${substringQuery}*`, `refs/remotes/*/${substringQuery}*/**`]
  const segmentedPatterns = [`refs/remotes/${segmented}`, `refs/heads/${segmented}`]
  const branchRootPatterns = [
    // Why: branch names often contain slashes (plan/docs); these root patterns also match a local branch beneath any remote.
    `refs/heads/${substringQuery}*`,
    `refs/heads/${substringQuery}*/**`,
    ...remoteBranchRootPatterns
  ]
  const patterns =
    options.patternGroup === 'segmented'
      ? segmentedPatterns
      : options.patternGroup === 'branchRoot'
        ? branchRootPatterns
        : [...segmentedPatterns, ...branchRootPatterns]
  return [...base, ...patterns]
}

async function runSearchBaseRefsGit(
  path: string,
  normalizedQuery: string,
  limit: number,
  options: { remoteNames: readonly string[]; patternGroup?: RefSearchPatternGroup }
): Promise<{ stdout: string }> {
  return getLocalGitCapabilityCache({ cwd: path }).runWithFallback(
    'for-each-ref-exclude',
    () =>
      gitExecFileAsync(
        buildSearchBaseRefsArgv(normalizedQuery, limit, {
          remoteNames: options.remoteNames,
          patternGroup: options.patternGroup
        }),
        { cwd: path }
      ),
    () =>
      gitExecFileAsync(
        buildSearchBaseRefsArgv(normalizedQuery, limit, {
          excludeRemoteHead: false,
          remoteNames: options.remoteNames,
          patternGroup: options.patternGroup
        }),
        { cwd: path }
      ),
    isForEachRefExcludeUnsupportedError
  )
}

function mergeBaseRefSearchResultGroups(
  groups: readonly BaseRefSearchResult[][],
  limit: number
): BaseRefSearchResult[] {
  const seen = new Set<string>()
  const merged: BaseRefSearchResult[] = []
  const maxLength = Math.max(0, ...groups.map((group) => group.length))
  for (let index = 0; index < maxLength && merged.length < limit; index += 1) {
    for (const group of groups) {
      const entry = group[index]
      if (!entry || seen.has(entry.refName)) {
        continue
      }
      seen.add(entry.refName)
      merged.push(entry)
      if (merged.length >= limit) {
        break
      }
    }
  }
  return merged
}

export { isForEachRefExcludeUnsupportedError } from '../../shared/git-ref-command-capabilities'

/**
 * Resolve the default push remote for a repo.
 * Order: remote configured on the current default branch → origin → the single
 * remote when the repo has exactly one → error.
 */
async function getDefaultRemote(
  path: string,
  options: LocalGitExecOptions = {}
): Promise<string> {
  const defaultRef = await getDefaultBaseRefAsync(path, options)
  // Why: getDefaultBaseRefAsync returns null when no default branch exists; guard so .includes() can't crash.
  const defaultBranch = defaultRef
    ? defaultRef.includes('/')
      ? defaultRef.split('/').slice(1).join('/')
      : defaultRef
    : null

  if (defaultBranch) {
    try {
      const { stdout } = await gitExecFileAsync(
        ['config', '--get', `branch.${defaultBranch}.remote`],
        gitExecOptions(path, options)
      )
      const value = stdout.trim()
      if (value) {
        return value
      }
    } catch {
      // Fall through: branch has no explicit remote configured.
    }
  }

  try {
    const { stdout } = await gitExecFileAsync(['remote'], gitExecOptions(path, options))
    const remotes = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if (remotes.includes('origin')) {
      return 'origin'
    }
    if (remotes.length === 1) {
      return remotes[0]
    }
    if (remotes.length === 0) {
      throw new Error('Repo has no configured git remotes.')
    }
    throw new Error(
      `Repo has multiple remotes (${remotes.join(', ')}) and no default is configured. Set branch.<default>.remote.`
    )
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
    throw new Error('Failed to resolve default remote for repo.')
  }
}

async function searchBaseRefs(path: string, query: string, limit = 25): Promise<string[]> {
  return (await searchBaseRefDetails(path, query, limit)).map((entry) => entry.refName)
}

async function searchBaseRefDetails(
  path: string,
  query: string,
  limit = 25
): Promise<BaseRefSearchResult[]> {
  if (!Number.isInteger(limit) || limit <= 0) {
    return []
  }
  const normalizedQuery = normalizeRefSearchQuery(query)

  try {
    // Why: argv lives in buildSearchBaseRefsArgv so the SSH sibling cannot drift.
    const remotes = await listRemoteNames(path)
    const tokens = getRefSearchTokens(normalizedQuery)
    if (tokens.length > 1) {
      // Why: slash queries need both display-format and local-branch matches; merge before the limit so neither starves.
      const results = await Promise.all([
        runSearchBaseRefsGit(path, normalizedQuery, limit, {
          remoteNames: remotes,
          patternGroup: 'segmented'
        }),
        runSearchBaseRefsGit(path, normalizedQuery, limit, {
          remoteNames: remotes,
          patternGroup: 'branchRoot'
        })
      ])
      return mergeBaseRefSearchResultGroups(
        results.map((entry) => parseAndFilterSearchRefDetails(entry.stdout, limit, remotes)),
        limit
      )
    }

    const result = await runSearchBaseRefsGit(path, normalizedQuery, limit, {
      remoteNames: remotes
    })
    return parseAndFilterSearchRefDetails(result.stdout, limit, remotes)
  } catch (err) {
    // Why: log so a missing result set is debuggable; callers still treat [] as "no matches".
    console.warn('[searchBaseRefs] for-each-ref failed', { path, err })
    return []
  }
}

async function listRemoteNames(path: string, options: LocalGitExecOptions = {}): Promise<string[]> {
  try {
    const { stdout } = await gitExecFileAsync(['remote'], gitExecOptions(path, options))
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Parse `git for-each-ref --format=%(refname)%00%(refname:short)` stdout into a deduped list of short
 * refs, dropping `<remote>/HEAD` pseudo-refs. Shared with the SSH branch in ipc/repos.ts so filtering can't drift.
 */
function parseAndFilterSearchRefs(stdout: string, limit: number): string[] {
  return parseAndFilterSearchRefDetails(stdout, limit).map((entry) => entry.refName)
}

function parseAndFilterSearchRefDetails(
  stdout: string,
  limit: number,
  remotes: string[] = []
): BaseRefSearchResult[] {
  const seen = new Set<string>()
  const sortedRemotes = [...remotes].sort((a, b) => b.length - a.length)
  return (
    stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const nul = line.indexOf('\0')
        if (nul < 0) {
          // Why: no NUL means an unexpected %(refname) format; drop it rather than hand callers an unusable "short" ref.
          return null
        }
        return { full: line.slice(0, nul), short: line.slice(nul + 1) }
      })
      .filter((entry): entry is { full: string; short: string } => entry !== null)
      // Why: drop `<remote>/HEAD` pseudo-refs; `.+` (not `[^/]+`) since git allows slashes in remote names.
      .filter(({ full }) => !/^refs\/remotes\/.+\/HEAD$/.test(full))
      .filter(({ short }) => {
        if (seen.has(short)) {
          return false
        }
        seen.add(short)
        return true
      })
      .map(({ full, short }) => ({
        refName: short,
        localBranchName: resolveLocalBranchName(full, short, sortedRemotes)
      }))
      // Why: Math.max(0, limit) so pathological limit <= 0 yields zero results, not one.
      .slice(0, Math.max(0, limit))
  )
}

function resolveLocalBranchName(fullRef: string, shortRef: string, remotes: string[]): string {
  const remoteRefPrefix = 'refs/remotes/'
  if (!fullRef.startsWith(remoteRefPrefix)) {
    return shortRef
  }
  const remoteAndBranch = fullRef.slice(remoteRefPrefix.length)
  const remote = remotes.find((candidate) => remoteAndBranch.startsWith(`${candidate}/`))
  if (remote) {
    return remoteAndBranch.slice(remote.length + 1)
  }
  return remoteAndBranch.split('/').slice(1).join('/') || shortRef
}

function normalizeRefSearchQuery(query: string): string {
  return query.trim().replace(/[*?[\]\\]/g, '')
}

async function hasGitRefAsync(
  path: string,
  ref: string,
  options: LocalGitExecOptions = {}
): Promise<boolean> {
  try {
    await gitExecFileAsync(['rev-parse', '--verify', ref], gitExecOptions(path, options))
    return true
  } catch {
    return false
  }
}

type BranchConflictKind = 'local' | 'remote'

async function getBranchConflictKind(
  path: string,
  branchName: string,
  allowedBaseRef?: string,
  options: LocalGitExecOptions = {}
): Promise<BranchConflictKind | null> {
  if (await hasGitRefAsync(path, `refs/heads/${branchName}`, options)) {
    return 'local'
  }

  try {
    const remoteNames = (await listRemoteNames(path, options)).sort((a, b) => b.length - a.length)
    const { stdout } = await gitExecFileAsync(
      ['for-each-ref', '--format=%(refname)', 'refs/remotes'],
      gitExecOptions(path, options)
    )
    const hasRemoteConflict = stdout.split('\n').some((ref) => {
      const trimmed = ref.trim()
      if (isAllowedRemoteBaseRef(trimmed, allowedBaseRef)) {
        return false
      }
      const shortRef = trimmed.replace(/^refs\/remotes\//, '')
      // Why: git allows slashes in remote names; use the configured list so foo/bar/feature resolves to branch "feature".
      return resolveLocalBranchName(trimmed, shortRef, remoteNames) === branchName
    })

    return hasRemoteConflict ? 'remote' : null
  } catch {
    return null
  }
}

function isAllowedRemoteBaseRef(refName: string, allowedBaseRef: string | undefined): boolean {
  if (!allowedBaseRef) {
    return false
  }
  const normalizedAllowedRef = allowedBaseRef.startsWith('refs/remotes/')
    ? allowedBaseRef
    : `refs/remotes/${allowedBaseRef}`
  return refName === normalizedAllowedRef
}

/** Build a hosted URL (GitHub/GitLab/Bitbucket) for a file+line; null when the remote isn't a recognized host. */
function getRemoteFileUrl(
  repoPath: string,
  relativePath: string,
  line: number
): string | null {
  const remoteUrl = getRemoteUrl(repoPath)
  if (!remoteUrl) {
    return null
  }

  const defaultBaseRef = getDefaultBaseRef(repoPath)
  if (!defaultBaseRef) {
    return null
  }
  const defaultBranch = defaultBaseRef.replace(/^origin\//, '')

  return buildHostedRemoteFileUrl(remoteUrl, relativePath, defaultBranch, line)
}

/** Build a hosted URL (GitHub/GitLab/Bitbucket) for a commit; null when origin isn't a recognized host. */
function getRemoteCommitUrl(repoPath: string, sha: string): string | null {
  const remoteUrl = getRemoteUrl(repoPath)
  if (!remoteUrl) {
    return null
  }
  return buildHostedRemoteCommitUrl(remoteUrl, sha)
}

export { buildSearchBaseRefsArgv,getBranchConflictKind,getDefaultRemote,getRefSearchCandidateCount,getRefSearchTokens,getRemoteCommitUrl,getRemoteFileUrl,hasGitRefAsync,isAllowedRemoteBaseRef,listRemoteNames,mergeBaseRefSearchResultGroups,normalizeRefSearchQuery,parseAndFilterSearchRefDetails,parseAndFilterSearchRefs,resolveLocalBranchName,runSearchBaseRefsGit,searchBaseRefDetails,searchBaseRefs,type BranchConflictKind,type RefSearchPatternGroup }
