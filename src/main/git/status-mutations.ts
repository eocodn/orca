import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import * as path from 'node:path'
import type {
  GitBranchChangeEntry,
  GitBranchChangeStatus,
  GitBranchCompareResult,
  GitBranchCompareSummary,
  GitCommitCompareResult,
  GitConflictKind,
  GitConflictOperation,
  GitDiffResult,
  GitFileStatus,
  GitStatusEntry,
  GitStatusResult,
  GitUpstreamStatus
} from '../../shared/types'
import type { CommitMessageDraftContext } from '../../shared/commit-message-generation'
import {
  getEffectiveGitUpstreamStatus,
  getGitUpstreamStatusForUpstreamName,
  splitRemoteBranchName
} from '../../shared/git-effective-upstream'
import { createGitConfigSnapshotRunner } from '../../shared/git-config-snapshot-runner'
import { isBinaryBuffer } from '../../shared/binary-buffer'
import {
  applyLineStats,
  collectUntrackedAdditions,
  parseNumstat,
  type GitLineStats
} from '../../shared/git-uncommitted-line-stats'
import { decodeGitCQuotedPath } from '../../shared/git-cquoted-path'
import {
  gitExecFileAsync,
  gitExecFileAsyncBuffer,
  gitOptionalLocksDisabledEnv,
  gitStreamStdout
} from './runner'
import { StatusPorcelainParser } from '../../shared/git-status-porcelain-parser'
import { findExistingWorktreeSymlinkPaths } from './worktree-symlink-detection'
import { capGitStatusEntries, resolveGitStatusLimit } from '../../shared/git-status-limit'
import { describeMaxBufferOverflowError, isMaxBufferOverflowError } from './max-buffer-overflow'
import {
  removeSafeUntrackedDiscardTarget,
  removeSafeUntrackedDiscardTargets
} from '../../shared/git-discard-path-safety'
import { readBranchCompareHead } from '../../shared/git-branch-compare-head'
import { resolveWorktreeAddBaseRef } from '../../shared/worktree-base-ref'
import { resolveWorktreeBaseCommitOid } from './worktree-base-ref-probe'
import { getLargeDiffRenderLimit } from '../../shared/large-diff-render-limit'
import { InFlightPromiseDedupe, stableInFlightKey } from '../../shared/in-flight-promise-dedupe'
import type { GitRuntimeOptions } from './git-runtime-options'
import { gitOptionsForWorktree } from './git-runtime-options'
import { GitStatusReadLeaseOwner } from './git-status-read-lease-owner'
import { parseGitRevListFirstParentOid } from '../../shared/git-rev-list-output'
import {
  beginGitStatusLineStatsCacheWrite,
  clearGitStatusLineStatsCache,
  clearGitStatusLineStatsCacheKey,
  reuseOrRecomputeGitStatusLineStats
} from '../../shared/git-status-line-stats-cache'
import { MAX_STAGED_COMMIT_CONTEXT_BYTES, BULK_CHUNK_SIZE, invalidateGitReadCaches } from './status-read'
async function stageFile(
  worktreePath: string,
  filePath: string,
  options: GitRuntimeOptions = {}
): Promise<void> {
  invalidateGitReadCaches()
  try {
    await gitExecFileAsync(
      ['add', '--', literalPathspec(filePath, options)],
      gitOptionsForWorktree(worktreePath, options)
    )
  } finally {
    invalidateGitReadCaches()
  }
}

/**
 * Unstage a file.
 */
async function unstageFile(
  worktreePath: string,
  filePath: string,
  options: GitRuntimeOptions = {}
): Promise<void> {
  invalidateGitReadCaches()
  try {
    await gitExecFileAsync(['restore', '--staged', '--', literalPathspec(filePath, options)], {
      ...gitOptionsForWorktree(worktreePath, options)
    })
  } finally {
    invalidateGitReadCaches()
  }
}

async function getStagedCommitContext(
  worktreePath: string,
  options: GitRuntimeOptions = {}
): Promise<CommitMessageDraftContext | null> {
  const branchPromise = gitExecFileAsync(['branch', '--show-current'], {
    ...gitOptionsForWorktree(worktreePath, options)
  }).catch(() => ({ stdout: '' }))
  const summaryPromise = gitExecFileAsync(['diff', '--cached', '--name-status'], {
    ...gitOptionsForWorktree(worktreePath, options),
    maxBuffer: MAX_STAGED_COMMIT_CONTEXT_BYTES
  })

  const [branchResult, summaryResult] = await Promise.all([branchPromise, summaryPromise])
  const stagedSummary = summaryResult.stdout.trim()
  if (!stagedSummary) {
    return null
  }

  let stagedPatch = ''
  try {
    const patchResult = await gitExecFileAsync(
      ['diff', '--cached', '--patch', '--minimal', '--no-color', '--no-ext-diff'],
      {
        ...gitOptionsForWorktree(worktreePath, options),
        maxBuffer: MAX_STAGED_COMMIT_CONTEXT_BYTES
      }
    )
    stagedPatch = patchResult.stdout
  } catch (error) {
    if (!isMaxBufferOverflowError(error)) {
      throw error
    }
    // Why: staged patch is optional context (truncated later anyway); degrade to file-name summary rather than fail.
    console.warn(
      '[git] Staged patch too large to read; using file summary only:',
      describeMaxBufferOverflowError(error)
    )
  }

  return {
    branch: branchResult.stdout.trim() || null,
    stagedSummary,
    stagedPatch
  }
}

async function commitChanges(
  worktreePath: string,
  message: string,
  options: GitRuntimeOptions = {}
): Promise<{ success: boolean; error?: string }> {
  invalidateGitReadCaches()
  try {
    await gitExecFileAsync(['commit', '-m', message], gitOptionsForWorktree(worktreePath, options))
    return { success: true }
  } catch (error) {
    // Why: useful message may be on stderr (hook/GPG failures) or stdout ("nothing to commit"), so try both then message.
    const readStringField = (field: string): string | null => {
      if (typeof error === 'object' && error && field in error) {
        const v = (error as Record<string, unknown>)[field]
        if (typeof v === 'string' && v.length > 0) {
          return v
        }
      }
      return null
    }
    const errorMessage =
      readStringField('stderr') ??
      readStringField('stdout') ??
      (error instanceof Error ? error.message : 'Commit failed')
    return { success: false, error: errorMessage }
  } finally {
    invalidateGitReadCaches()
  }
}

/**
 * Discard working tree changes for a file.
 */
async function discardChanges(
  worktreePath: string,
  filePath: string,
  options: GitRuntimeOptions = {}
): Promise<void> {
  invalidateGitReadCaches()
  const resolvedWorktree = path.resolve(worktreePath)
  const resolvedTarget = path.resolve(worktreePath, filePath)
  try {
    if (!isWithinWorktree(path, resolvedWorktree, resolvedTarget)) {
      throw new Error(`Path "${filePath}" resolves outside the worktree`)
    }

    let tracked = false
    try {
      await gitExecFileAsync(
        ['ls-files', '--error-unmatch', '--', literalPathspec(filePath, options)],
        {
          ...gitOptionsForWorktree(worktreePath, options)
        }
      )
      tracked = true
    } catch {
      // File is not tracked by git
    }

    if (tracked) {
      await gitExecFileAsync(
        ['restore', '--worktree', '--source=HEAD', '--', literalPathspec(filePath, options)],
        {
          ...gitOptionsForWorktree(worktreePath, options)
        }
      )
      return
    }

    await removeSafeUntrackedDiscardTarget(worktreePath, filePath, (targetPath) =>
      cleanUntrackedPaths(worktreePath, [targetPath], options)
    )
  } finally {
    invalidateGitReadCaches()
  }
}

function normalizeGitPathForCompare(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/\/+$/, '')
}

function literalPathspec(filePath: string, options: GitRuntimeOptions): string {
  // Why: Git inside WSL needs POSIX paths, but host paths must stay literal, so convert backslashes only for WSL.
  const runtimePath = options.wslDistro ? filePath.replace(/\\/g, '/') : filePath
  return `:(literal)${runtimePath}`
}

function isTrackedPathSpec(filePath: string, trackedPaths: readonly string[]): boolean {
  const normalized = normalizeGitPathForCompare(filePath)
  return trackedPaths.some((trackedPath) => {
    const normalizedTracked = normalizeGitPathForCompare(trackedPath)
    return normalizedTracked === normalized || normalizedTracked.startsWith(`${normalized}/`)
  })
}

async function listTrackedPathSpecs(
  worktreePath: string,
  filePaths: readonly string[],
  options: GitRuntimeOptions = {}
): Promise<string[]> {
  const trackedPaths: string[] = []
  for (let i = 0; i < filePaths.length; i += BULK_CHUNK_SIZE) {
    const chunk = filePaths.slice(i, i + BULK_CHUNK_SIZE)
    const { stdout } = await gitExecFileAsync(
      ['ls-files', '-z', '--', ...chunk.map((filePath) => literalPathspec(filePath, options))],
      {
        ...gitOptionsForWorktree(worktreePath, options)
      }
    )
    // Why: a tracked directory can hold enough paths to exceed the JS argument limit.
    for (const trackedPath of stdout.split('\0')) {
      if (trackedPath) {
        trackedPaths.push(trackedPath)
      }
    }
  }
  return trackedPaths
}

async function cleanUntrackedPaths(
  worktreePath: string,
  filePaths: readonly string[],
  options: GitRuntimeOptions = {}
): Promise<void> {
  for (let i = 0; i < filePaths.length; i += BULK_CHUNK_SIZE) {
    const chunk = filePaths.slice(i, i + BULK_CHUNK_SIZE)
    if (chunk.length > 0) {
      // Why: Git pathspec cleanup avoids raw recursive deletion through symlinked parents.
      await gitExecFileAsync(
        ['clean', '-ffdx', '--', ...chunk.map((filePath) => literalPathspec(filePath, options))],
        {
          ...gitOptionsForWorktree(worktreePath, options)
        }
      )
    }
  }
}

/**
 * Discard working tree changes for many paths in a small number of subprocesses.
 */
async function bulkDiscardChanges(
  worktreePath: string,
  filePaths: string[],
  options: GitRuntimeOptions = {}
): Promise<void> {
  invalidateGitReadCaches()
  if (filePaths.length === 0) {
    return
  }

  try {
    const resolvedWorktree = path.resolve(worktreePath)
    for (const filePath of filePaths) {
      const resolvedTarget = path.resolve(worktreePath, filePath)
      if (!isWithinWorktree(path, resolvedWorktree, resolvedTarget)) {
        throw new Error(`Path "${filePath}" resolves outside the worktree`)
      }
    }

    const trackedPathSpecs = await listTrackedPathSpecs(worktreePath, filePaths, options)
    const trackedPaths = filePaths.filter((filePath) =>
      isTrackedPathSpec(filePath, trackedPathSpecs)
    )
    const untrackedPaths = filePaths.filter(
      (filePath) => !isTrackedPathSpec(filePath, trackedPathSpecs)
    )
    await removeSafeUntrackedDiscardTargets(
      worktreePath,
      untrackedPaths,
      (targetPaths) => cleanUntrackedPaths(worktreePath, targetPaths, options),
      async () => {
        for (let i = 0; i < trackedPaths.length; i += BULK_CHUNK_SIZE) {
          const chunk = trackedPaths.slice(i, i + BULK_CHUNK_SIZE)
          await gitExecFileAsync(
            [
              'restore',
              '--worktree',
              '--source=HEAD',
              '--',
              ...chunk.map((filePath) => literalPathspec(filePath, options))
            ],
            {
              ...gitOptionsForWorktree(worktreePath, options)
            }
          )
        }
      }
    )
  } finally {
    invalidateGitReadCaches()
  }
}

function isWithinWorktree(
  pathApi: Pick<typeof path, 'isAbsolute' | 'relative' | 'sep'>,
  resolvedWorktree: string,
  resolvedTarget: string
): boolean {
  const relativeTarget = pathApi.relative(resolvedWorktree, resolvedTarget)
  return !(
    relativeTarget === '' ||
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relativeTarget)
  )
}

/**
 * Bulk stage files in batches to avoid E2BIG.
 */
async function bulkStageFiles(
  worktreePath: string,
  filePaths: string[],
  options: GitRuntimeOptions = {}
): Promise<void> {
  invalidateGitReadCaches()
  if (filePaths.length === 0) {
    return
  }
  try {
    for (let i = 0; i < filePaths.length; i += BULK_CHUNK_SIZE) {
      const chunk = filePaths.slice(i, i + BULK_CHUNK_SIZE)
      await gitExecFileAsync(
        ['add', '--', ...chunk.map((filePath) => literalPathspec(filePath, options))],
        gitOptionsForWorktree(worktreePath, options)
      )
    }
  } finally {
    invalidateGitReadCaches()
  }
}

/**
 * Bulk unstage files in batches to avoid E2BIG.
 */
async function bulkUnstageFiles(
  worktreePath: string,
  filePaths: string[],
  options: GitRuntimeOptions = {}
): Promise<void> {
  invalidateGitReadCaches()
  if (filePaths.length === 0) {
    return
  }
  try {
    for (let i = 0; i < filePaths.length; i += BULK_CHUNK_SIZE) {
      const chunk = filePaths.slice(i, i + BULK_CHUNK_SIZE)
      await gitExecFileAsync(
        [
          'restore',
          '--staged',
          '--',
          ...chunk.map((filePath) => literalPathspec(filePath, options))
        ],
        {
          ...gitOptionsForWorktree(worktreePath, options)
        }
      )
    }
  } finally {
    invalidateGitReadCaches()
  }
}

export { stageFile, unstageFile, getStagedCommitContext, commitChanges, discardChanges, normalizeGitPathForCompare, literalPathspec, isTrackedPathSpec, listTrackedPathSpecs, cleanUntrackedPaths, bulkDiscardChanges, isWithinWorktree, bulkStageFiles, bulkUnstageFiles }

