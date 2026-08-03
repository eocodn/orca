import * as path from 'node:path'
import type {
  GitBranchCompareResult,
  GitBranchCompareSummary,
  GitDiffResult
} from '../../shared/types'
import {
  gitExecFileAsync,
  gitOptionalLocksDisabledEnv
} from './runner'
import { readBranchCompareHead } from '../../shared/git-branch-compare-head'
import { resolveWorktreeAddBaseRef } from '../../shared/worktree-base-ref'
import { resolveWorktreeBaseCommitOid } from './worktree-base-ref-probe'
import { stableInFlightKey } from '../../shared/in-flight-promise-dedupe'
import type { GitRuntimeOptions } from './git-runtime-options'
import { gitOptionsForWorktree } from './git-runtime-options'
import { submodulePathsCacheGeneration, gitDiffReadDedupe, gitRuntimeOptionsKey, getSubmodulePathsCacheKey, pruneExpiredSubmodulePathsCache, getCachedSubmodulePaths, rememberSubmodulePaths } from './status-read'
import { resolveSubmoduleWorktreePath } from './status-submodules'
import { loadBranchChanges, resolveCompareRef, resolveRefOid, resolveMergeBase, countAheadCommits, readUnstagedLeftBlob, readGitBlobAtIndexPath, readGitBlobAtOidPath, readWorkingTreeFile, buildDiffResult } from './status-commit-diff'
async function listSubmodulePaths(
  worktreePath: string,
  options: GitRuntimeOptions = {}
): Promise<string[]> {
  const now = Date.now()
  const cacheKey = getSubmodulePathsCacheKey(worktreePath, options)
  const cached = getCachedSubmodulePaths(cacheKey, now)
  if (cached) {
    return cached
  }
  // Why: prune on misses so removed worktrees don't accumulate; hot hits stay O(1).
  pruneExpiredSubmodulePathsCache(now)
  const cacheGeneration = submodulePathsCacheGeneration
  let paths: string[] = []
  try {
    const { stdout } = await gitExecFileAsync(
      ['config', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'],
      { ...gitOptionsForWorktree(worktreePath, options), env: gitOptionalLocksDisabledEnv() }
    )
    paths = stdout
      .split(/\r?\n/)
      .map((line) => {
        const spaceIndex = line.indexOf(' ')
        return spaceIndex === -1
          ? ''
          : line
              .slice(spaceIndex + 1)
              .trim()
              .replace(/\/+$/, '')
      })
      .filter((value) => value.length > 0)
  } catch {
    // No .gitmodules (or git config failure) — treat as a repo without submodules.
    paths = []
  }
  if (cacheGeneration === submodulePathsCacheGeneration) {
    rememberSubmodulePaths(cacheKey, paths, Date.now())
  }
  return paths
}

/**
 * Find the submodule whose root equals or contains `filePath`. Returns the
 * submodule path (forward-slash) or null when the path is not in a submodule.
 */
function findContainingSubmodule(submodulePaths: string[], filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '')
  let best: string | null = null
  for (const sub of submodulePaths) {
    if (normalized === sub || normalized.startsWith(`${sub}/`)) {
      // Prefer the longest match to support nested submodule roots.
      if (!best || sub.length > best.length) {
        best = sub
      }
    }
  }
  return best
}

async function readGitlinkOidFromTree(
  worktreePath: string,
  ref: string,
  submodulePath: string,
  options: GitRuntimeOptions
): Promise<string> {
  try {
    const { stdout } = await gitExecFileAsync(['ls-tree', ref, '--', submodulePath], {
      ...gitOptionsForWorktree(worktreePath, options),
      env: gitOptionalLocksDisabledEnv()
    })
    return stdout.match(/^160000 commit ([0-9a-f]+)\t/m)?.[1] ?? ''
  } catch {
    return ''
  }
}

async function readGitlinkOidFromIndex(
  worktreePath: string,
  submodulePath: string,
  options: GitRuntimeOptions
): Promise<string> {
  try {
    const { stdout } = await gitExecFileAsync(['ls-files', '-s', '--', submodulePath], {
      ...gitOptionsForWorktree(worktreePath, options),
      env: gitOptionalLocksDisabledEnv()
    })
    return stdout.match(/^160000 ([0-9a-f]+) /m)?.[1] ?? ''
  } catch {
    return ''
  }
}

async function readWorkingSubmoduleHead(
  submoduleWorktreePath: string,
  options: GitRuntimeOptions
): Promise<string> {
  try {
    const { stdout } = await gitExecFileAsync(['rev-parse', 'HEAD'], {
      ...gitOptionsForWorktree(submoduleWorktreePath, options),
      env: gitOptionalLocksDisabledEnv()
    })
    return stdout.trim()
  } catch {
    return ''
  }
}

/**
 * Synthesize a gitlink pointer diff: Git represents submodule commit changes as a
 * one-line `Subproject commit <oid>` swap, so the old/new oids feed the text differ.
 */
async function buildSubmodulePointerDiff(
  worktreePath: string,
  submodulePath: string,
  staged: boolean,
  compareAgainstHead: boolean,
  options: GitRuntimeOptions,
  // Why: default to the validated resolver so every caller is guarded against path escape.
  submoduleWorktreePath = resolveSubmoduleWorktreePath(worktreePath, submodulePath)
): Promise<GitDiffResult> {
  let leftOid = ''
  let rightOid = ''
  if (staged) {
    leftOid = await readGitlinkOidFromTree(worktreePath, 'HEAD', submodulePath, options)
    rightOid = await readGitlinkOidFromIndex(worktreePath, submodulePath, options)
  } else if (compareAgainstHead) {
    leftOid = await readGitlinkOidFromTree(worktreePath, 'HEAD', submodulePath, options)
    rightOid = await readWorkingSubmoduleHead(submoduleWorktreePath, options)
  } else {
    leftOid =
      (await readGitlinkOidFromIndex(worktreePath, submodulePath, options)) ||
      (await readGitlinkOidFromTree(worktreePath, 'HEAD', submodulePath, options))
    rightOid = await readWorkingSubmoduleHead(submoduleWorktreePath, options)
  }
  return buildDiffResult(
    leftOid ? `Subproject commit ${leftOid}\n` : '',
    rightOid ? `Subproject commit ${rightOid}\n` : '',
    false,
    false,
    submodulePath
  )
}

/**
 * Diff a file inside a submodule across two of its commits — used when the parent
 * gitlink moved but the submodule worktree is clean (change is committed).
 */
async function buildSubmoduleInnerCommitRangeDiff(
  submoduleWorktreePath: string,
  innerPath: string,
  fromOid: string,
  toOid: string,
  options: GitRuntimeOptions
): Promise<GitDiffResult> {
  let originalContent = ''
  let modifiedContent = ''
  let originalIsBinary = false
  let modifiedIsBinary = false
  try {
    const left = await readGitBlobAtOidPath(submoduleWorktreePath, fromOid, innerPath, options)
    originalContent = left.content
    originalIsBinary = left.isBinary
    const right = await readGitBlobAtOidPath(submoduleWorktreePath, toOid, innerPath, options)
    modifiedContent = right.content
    modifiedIsBinary = right.isBinary
  } catch {
    // Fallback to empty content; a missing blob (add/delete) reads as one side.
  }
  return buildDiffResult(
    originalContent,
    modifiedContent,
    originalIsBinary,
    modifiedIsBinary,
    innerPath
  )
}

/**
 * Get original and modified content for diffing a file.
 */
async function getDiff(
  worktreePath: string,
  filePath: string,
  staged: boolean,
  compareAgainstHead = false,
  options: GitRuntimeOptions = {}
): Promise<GitDiffResult> {
  // Why: register the dedupe synchronously (before any await) so concurrent identical reads coalesce.
  return gitDiffReadDedupe.run(
    stableInFlightKey([
      'diff',
      worktreePath,
      filePath,
      staged,
      compareAgainstHead,
      ...gitRuntimeOptionsKey(options)
    ]),
    () => loadDiff(worktreePath, filePath, staged, compareAgainstHead, options)
  )
}

async function loadDiff(
  worktreePath: string,
  filePath: string,
  staged: boolean,
  compareAgainstHead: boolean,
  options: GitRuntimeOptions
): Promise<GitDiffResult> {
  // Why: gitlink paths can't be read as blobs, so route submodule diffs explicitly (root → pointer, inner → recurse).
  const submodulePaths = await listSubmodulePaths(worktreePath, options)
  if (submodulePaths.length > 0) {
    const matchedSubmodule = findContainingSubmodule(submodulePaths, filePath)
    if (matchedSubmodule) {
      // Why: validate the .gitmodules-derived path against the worktree boundary so a crafted one can't escape the repo.
      const submoduleWorktreePath = resolveSubmoduleWorktreePath(worktreePath, matchedSubmodule)
      const normalizedFilePath = filePath.replace(/\\/g, '/').replace(/\/+$/, '')
      if (normalizedFilePath === matchedSubmodule) {
        return buildSubmodulePointerDiff(
          worktreePath,
          matchedSubmodule,
          staged,
          compareAgainstHead,
          options,
          submoduleWorktreePath
        )
      }
      const innerPath = normalizedFilePath.slice(matchedSubmodule.length + 1)
      const fromOid = staged
        ? await readGitlinkOidFromTree(worktreePath, 'HEAD', matchedSubmodule, options)
        : (await readGitlinkOidFromIndex(worktreePath, matchedSubmodule, options)) ||
          (await readGitlinkOidFromTree(worktreePath, 'HEAD', matchedSubmodule, options))
      const toOid = staged
        ? await readGitlinkOidFromIndex(worktreePath, matchedSubmodule, options)
        : await readWorkingSubmoduleHead(submoduleWorktreePath, options)
      // Why: a moved gitlink with a clean submodule worktree means the change is committed — diff the two commits.
      if (fromOid && toOid && fromOid !== toOid) {
        return buildSubmoduleInnerCommitRangeDiff(
          submoduleWorktreePath,
          innerPath,
          fromOid,
          toOid,
          options
        )
      }
      return getDiff(submoduleWorktreePath, innerPath, staged, compareAgainstHead, options)
    }
  }

  let originalContent = ''
  let modifiedContent = ''
  let originalIsBinary = false
  let modifiedIsBinary = false
  let modifiedDeleted = false

  try {
    if (staged) {
      // Why concurrent: HEAD and the index are independent `git show` spawns.
      // Only this branch qualifies — the unstaged left read chains index→HEAD.
      const [leftBlob, rightBlob] = await Promise.all([
        readGitBlobAtOidPath(worktreePath, 'HEAD', filePath, options),
        readGitBlobAtIndexPath(worktreePath, filePath, options)
      ])
      originalContent = leftBlob.content
      originalIsBinary = leftBlob.isBinary
      modifiedContent = rightBlob.content
      modifiedIsBinary = rightBlob.isBinary
      modifiedDeleted = !rightBlob.exists
    } else {
      // The left chain (index→HEAD) is sequential within itself, but the working
      // tree read is a plain fs read that does not depend on it.
      const [leftBlob, workingTreeBlob] = await Promise.all([
        compareAgainstHead
          ? readGitBlobAtOidPath(worktreePath, 'HEAD', filePath, options)
          : readUnstagedLeftBlob(worktreePath, filePath, options),
        readWorkingTreeFile(path.join(worktreePath, filePath))
      ])
      originalContent = leftBlob.content
      originalIsBinary = leftBlob.isBinary
      modifiedContent = workingTreeBlob.content
      modifiedIsBinary = workingTreeBlob.isBinary
      modifiedDeleted = !workingTreeBlob.exists
    }
  } catch {
    // Fallback
  }

  const result = buildDiffResult(
    originalContent,
    modifiedContent,
    originalIsBinary,
    modifiedIsBinary,
    filePath
  )
  // Why: mark a proven deletion so previewers don't mistake a read failure's empty side for one.
  if (result.kind === 'binary' && modifiedDeleted) {
    return { ...result, modifiedDeleted: true }
  }
  return result
}

async function getBranchCompare(
  worktreePath: string,
  baseRef: string,
  options: GitRuntimeOptions = {}
): Promise<GitBranchCompareResult> {
  const summary: GitBranchCompareSummary = {
    baseRef,
    baseOid: null,
    compareRef: 'HEAD',
    headOid: null,
    mergeBase: null,
    changedFiles: 0,
    status: 'loading'
  }

  // The base-ref probe peels to a commit. Only branch refs are guaranteed to store
  // commits; remote-tracking refs may store annotated tags whose raw oid must be preserved.
  const reusableProbedOidByRef = new Map<string, string>()
  const { compareRef, headOidResult, baseOidResult } = await readBranchCompareHead({
    readCompareRef: () => resolveCompareRef(worktreePath, options),
    resolveBaseRef: () =>
      // Why: short refs like "origin/main" can collide with a local branch; use the proven remote-tracking ref.
      resolveWorktreeAddBaseRef(baseRef, async (qualifiedRef) => {
        const oid = await resolveWorktreeBaseCommitOid(worktreePath, qualifiedRef, options)
        if (oid !== null && qualifiedRef.startsWith('refs/heads/')) {
          reusableProbedOidByRef.set(qualifiedRef, oid)
        }
        return oid !== null
      }),
    readHeadOid: () => resolveRefOid(worktreePath, 'HEAD', options),
    readBaseOid: (ref) => {
      const reusableOid = reusableProbedOidByRef.get(ref)
      return reusableOid === undefined
        ? resolveRefOid(worktreePath, ref, options)
        : Promise.resolve(reusableOid)
    }
  })
  summary.compareRef = compareRef

  let headOid = ''
  let baseOid = ''
  if (headOidResult.ok) {
    headOid = headOidResult.oid
    summary.headOid = headOid
  } else {
    if (baseOidResult.ok) {
      baseOid = baseOidResult.oid
      summary.baseOid = baseOid
      // Why: an unborn branch (new remote worktree) has no changes yet; a compare error would look broken.
      summary.changedFiles = 0
      summary.commitsAhead = 0
      summary.status = 'ready'
      return { summary, entries: [] }
    }
    summary.status = 'unborn-head'
    summary.errorMessage =
      'This branch does not have a committed HEAD yet, so compare-to-base is unavailable.'
    return { summary, entries: [] }
  }

  if (baseOidResult.ok) {
    baseOid = baseOidResult.oid
    summary.baseOid = baseOid
  } else {
    summary.status = 'invalid-base'
    summary.errorMessage = `Base ref ${baseRef} could not be resolved in this repository.`
    return { summary, entries: [] }
  }

  let mergeBase = ''
  try {
    mergeBase = await resolveMergeBase(worktreePath, baseOid, headOid, options)
    summary.mergeBase = mergeBase
  } catch {
    summary.status = 'no-merge-base'
    summary.errorMessage = `This branch and ${baseRef} do not share a merge base, so compare-to-base is unavailable.`
    return { summary, entries: [] }
  }

  try {
    const [entries, commitsAhead] = await Promise.all([
      loadBranchChanges(worktreePath, mergeBase, headOid, options),
      countAheadCommits(worktreePath, baseOid, headOid, options)
    ])
    summary.changedFiles = entries.length
    summary.commitsAhead = commitsAhead
    summary.status = 'ready'
    return { summary, entries }
  } catch (error) {
    summary.status = 'error'
    summary.errorMessage = error instanceof Error ? error.message : 'Failed to load branch compare'
    return { summary, entries: [] }
  }
}

async function getBranchDiff(
  worktreePath: string,
  args: {
    headOid: string
    mergeBase: string
    filePath: string
    oldPath?: string
  },
  options: GitRuntimeOptions = {}
): Promise<GitDiffResult> {
  return gitDiffReadDedupe.run(
    stableInFlightKey([
      'branchDiff',
      worktreePath,
      args.headOid,
      args.mergeBase,
      args.filePath,
      args.oldPath ?? null,
      ...gitRuntimeOptionsKey(options)
    ]),
    () => loadBranchDiff(worktreePath, args, options)
  )
}

async function loadBranchDiff(
  worktreePath: string,
  args: {
    headOid: string
    mergeBase: string
    filePath: string
    oldPath?: string
  },
  options: GitRuntimeOptions
): Promise<GitDiffResult> {
  try {
    const leftPath = args.oldPath ?? args.filePath
    // Why concurrent: the two sides are independent `git show` spawns, so awaiting
    // them in series doubles the latency of every diff the review panel opens.
    const [leftBlob, rightBlob] = await Promise.all([
      readGitBlobAtOidPath(worktreePath, args.mergeBase, leftPath, options),
      readGitBlobAtOidPath(worktreePath, args.headOid, args.filePath, options)
    ])

    return buildDiffResult(
      leftBlob.content,
      rightBlob.content,
      leftBlob.isBinary,
      rightBlob.isBinary,
      args.filePath
    )
  } catch {
    return {
      kind: 'text',
      originalContent: '',
      modifiedContent: '',
      originalIsBinary: false,
      modifiedIsBinary: false
    }
  }
}

export { listSubmodulePaths, findContainingSubmodule, readGitlinkOidFromTree, readGitlinkOidFromIndex, readWorkingSubmoduleHead, buildSubmodulePointerDiff, buildSubmoduleInnerCommitRangeDiff, getDiff, loadDiff, getBranchCompare, getBranchDiff, loadBranchDiff }
