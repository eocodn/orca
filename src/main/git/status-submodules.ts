import * as path from 'node:path'
import type {
  GitStatusEntry,
  GitStatusResult
} from '../../shared/types'
import {
  applyLineStats,
  collectUntrackedAdditions,
  parseNumstat,
  type GitLineStats
} from '../../shared/git-uncommitted-line-stats'
import {
  gitExecFileAsync,
  gitOptionalLocksDisabledEnv
} from './runner'
import { capGitStatusEntries, resolveGitStatusLimit } from '../../shared/git-status-limit'
import type { GitRuntimeOptions } from './git-runtime-options'
import { gitOptionsForWorktree } from './git-runtime-options'
import { type GetStatusOptions, getStatus } from './status-read'
import { readGitlinkOidFromTree, readGitlinkOidFromIndex, readWorkingSubmoduleHead, getDiff } from './status-branch-diff'
import { parseBranchChangeLine } from './status-commit-diff'
function resolveSubmoduleWorktreePath(worktreePath: string, submodulePath: string): string {
  if (!submodulePath || submodulePath.includes('\0') || path.isAbsolute(submodulePath)) {
    throw new Error('Access denied: invalid submodule path')
  }
  const resolved = path.resolve(worktreePath, submodulePath)
  const rel = path.relative(worktreePath, resolved)
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error('Access denied: submodule path escapes the selected worktree')
  }
  return resolved
}

/**
 * Run a plain status inside a submodule's own worktree (lazy "expand submodule"
 * flow). Entry paths are relative to the submodule root; the renderer prefixes them.
 */
async function getSubmoduleStatus(
  worktreePath: string,
  submodulePath: string,
  options: GetStatusOptions & { staged?: boolean } = {}
): Promise<GitStatusResult> {
  const submoduleWorktreePath = resolveSubmoduleWorktreePath(worktreePath, submodulePath)
  const limit = resolveGitStatusLimit(options.limit)
  // Why: staged expansion only represents HEAD→index; scanning the submodule worktree is wasted work.
  const workingResult = options.staged
    ? ({ entries: [], conflictOperation: 'unknown' } satisfies GitStatusResult)
    : await getStatus(submoduleWorktreePath, options)
  // Why: a moved gitlink (clean worktree) has no status rows; surface the parent-commit→checkout range as inner rows.
  const fromOid = options.staged
    ? await readGitlinkOidFromTree(worktreePath, 'HEAD', submodulePath, options)
    : (await readGitlinkOidFromIndex(worktreePath, submodulePath, options)) ||
      (await readGitlinkOidFromTree(worktreePath, 'HEAD', submodulePath, options))
  const toOid = options.staged
    ? await readGitlinkOidFromIndex(worktreePath, submodulePath, options)
    : await readWorkingSubmoduleHead(submoduleWorktreePath, options)
  if (fromOid && toOid && fromOid !== toOid) {
    const rangeEntries = await computeSubmoduleRangeEntries(
      submoduleWorktreePath,
      fromOid,
      toOid,
      options
    )
    if (options.staged) {
      return { ...workingResult, ...capGitStatusEntries(rangeEntries, limit) }
    }
    const rangePaths = new Set(rangeEntries.map((entry) => entry.path))
    // Range rows win on overlap so the diff matches getDiff's commit-range route.
    const entries = [
      ...rangeEntries,
      ...workingResult.entries.filter((entry) => !rangePaths.has(entry.path))
    ]
    return {
      ...workingResult,
      ...capGitStatusEntries(entries, limit, workingResult)
    }
  }
  if (options.staged) {
    return { ...workingResult, entries: [] }
  }
  return workingResult
}

/**
 * List files changed between two submodule commits as status rows — used when a
 * gitlink pointer moved so the expanded submodule shows committed changes.
 */
async function computeSubmoduleRangeEntries(
  submoduleWorktreePath: string,
  fromOid: string,
  toOid: string,
  options: GitRuntimeOptions = {}
): Promise<GitStatusEntry[]> {
  const gitOptions = {
    ...gitOptionsForWorktree(submoduleWorktreePath, options),
    env: gitOptionalLocksDisabledEnv()
  }
  let nameStatus = ''
  let numstat = ''
  try {
    const [statusResult, numstatResult] = await Promise.all([
      gitExecFileAsync(
        ['-c', 'core.quotePath=false', 'diff', '--name-status', '-M', '-C', fromOid, toOid],
        gitOptions
      ),
      gitExecFileAsync(
        ['-c', 'core.quotePath=false', 'diff', '-z', '--numstat', '-M', '-C', fromOid, toOid],
        gitOptions
      )
    ])
    nameStatus = statusResult.stdout
    numstat = numstatResult.stdout
  } catch {
    return []
  }
  const statsByPath = parseNumstat(numstat)
  const entries: GitStatusEntry[] = []
  for (const line of nameStatus.split(/\r?\n/)) {
    if (!line) {
      continue
    }
    const change = parseBranchChangeLine(line)
    if (!change) {
      continue
    }
    entries.push({
      path: change.path,
      status: change.status,
      area: 'unstaged',
      ...(change.oldPath ? { oldPath: change.oldPath } : {}),
      ...statsByPath.get(change.path)
    })
  }
  return entries
}

async function runNumstat(
  worktreePath: string,
  cached: boolean,
  options: GitRuntimeOptions = {}
): Promise<Map<string, GitLineStats> | null> {
  try {
    const { stdout } = await gitExecFileAsync(
      [
        '-c',
        'core.quotePath=false',
        'diff',
        '-z',
        ...(cached ? ['--cached'] : []),
        '--numstat',
        '-M'
      ],
      { ...gitOptionsForWorktree(worktreePath, options), env: gitOptionalLocksDisabledEnv() }
    )
    return parseNumstat(stdout)
  } catch (error) {
    // Why: an aborted pass must reject; only a genuine numstat failure degrades to uncounted rows.
    if (options.signal?.aborted) {
      throw error
    }
    // Why: a numstat failure leaves rows uncounted; null (not empty map) flags the pass incomplete and uncacheable.
    return null
  }
}

/** Returns false when a numstat pass failed, so callers skip caching it. */
async function attachLineStats(
  worktreePath: string,
  entries: GitStatusEntry[],
  options: GitRuntimeOptions = {}
): Promise<boolean> {
  if (entries.length === 0) {
    return true
  }
  const hasStaged = entries.some((entry) => entry.area === 'staged')
  const hasUnstaged = entries.some((entry) => entry.area === 'unstaged')
  const untrackedPaths = entries
    .filter((entry) => entry.area === 'untracked')
    .map((entry) => entry.path)
  const emptyStats = new Map<string, GitLineStats>()
  const [stagedStats, unstagedStats, untrackedStats] = await Promise.all([
    hasStaged ? runNumstat(worktreePath, true, options) : Promise.resolve(emptyStats),
    hasUnstaged ? runNumstat(worktreePath, false, options) : Promise.resolve(emptyStats),
    collectUntrackedAdditions(worktreePath, untrackedPaths, options.signal)
  ])
  for (const entry of entries) {
    applyLineStats(
      entry,
      entry.area === 'staged'
        ? (stagedStats ?? emptyStats).get(entry.path)
        : entry.area === 'unstaged'
          ? (unstagedStats ?? emptyStats).get(entry.path)
          : untrackedStats.get(entry.path)
    )
  }
  return stagedStats !== null && unstagedStats !== null
}

export { resolveSubmoduleWorktreePath, getSubmoduleStatus, computeSubmoduleRangeEntries, runNumstat, attachLineStats }
