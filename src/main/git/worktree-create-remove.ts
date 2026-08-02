import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, posix, resolve, win32 } from 'node:path'
import {
  branchHasNoUnmergedChangesOnAnyTarget,
  getBranchCleanupTargetRefs,
  refreshBranchCleanupTargetRefs
} from '../../shared/git-branch-cleanup'
import { resolveWorktreeAddBaseRef } from '../../shared/worktree-base-ref'
import { withSpan } from '../observability/tracer'
import type {
  GitWorktreeInfo,
  LocalBaseRefRefreshResult,
  LocalBaseRefUpdateSuggestion,
  RemoveWorktreeResult
} from '../../shared/types'
import { assertWorktreeUnlockedForRemoval } from '../../shared/worktree-removal'
import { isSubmoduleWorktreeRemovalRefusal } from '../../shared/worktree-submodule-removal'
import { decodeGitCQuotedPath } from '../../shared/git-cquoted-path'
import { parseGitRevListAheadBehindCounts } from '../../shared/git-rev-list-output'
import { parseWslUncPath } from '../../shared/wsl-paths'
import {
  hasUnsupportedRevParsePathFormatEcho,
  isUnsupportedRevParsePathFormatError,
  isUnsupportedWorktreeListZError
} from '../../shared/git-worktree-command-capabilities'
import { getLocalGitCapabilityCache } from './git-capability-state'
import { gitExecFileAsync, translateWslOutputPaths } from './runner'
import { resolveGitDir, runWithGitReadCacheInvalidation } from './status'
import { hasWorktreeBaseCommitRef } from './worktree-base-ref-probe'
import { type AddWorktreeResult, type SparseWorktreeCreateError, type GitWorktreeExecOptions, type AddWorktreeOptions, type RemoveWorktreeOptions, WORKTREE_ADD_TIMEOUT_MS, gitExecOptions, isBranchCheckedOutInWorktreeError, normalizeLocalBranchRef, getLocalBaseRefUpdateSuggestionForWorktreeCreate, persistWorktreeCreationBase, unsetWorktreeCreationBase, areWorktreePathsEqual } from './worktree-foundation'
import { bumpWorktreeScanGeneration, listWorktrees, refreshLocalBaseRefForWorktreeCreate } from './worktree-listing'
import { forceDeleteLocalBranch, assertWorktreeCleanForRemoval } from './worktree-cleanup-sparse'
async function addWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string,
  baseBranch?: string,
  refreshLocalBaseRef = false,
  noCheckout = false,
  options: AddWorktreeOptions = {}
): Promise<AddWorktreeResult> {
  try {
    return await runWithGitReadCacheInvalidation(() =>
      performAddWorktree(
        repoPath,
        worktreePath,
        branch,
        baseBranch,
        refreshLocalBaseRef,
        noCheckout,
        options
      )
    )
  } finally {
    bumpWorktreeScanGeneration(repoPath)
  }
}

async function performAddWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string,
  baseBranch?: string,
  refreshLocalBaseRef = false,
  noCheckout = false,
  options: AddWorktreeOptions = {}
): Promise<AddWorktreeResult> {
  let localBaseRefRefresh: LocalBaseRefRefreshResult | undefined
  let localBaseRefUpdateSuggestion: LocalBaseRefUpdateSuggestion | undefined
  const args = ['worktree', 'add']
  let effectiveBase: string | undefined
  if (noCheckout) {
    args.push('--no-checkout')
  }
  if (options.checkoutExistingBranch) {
    // Why: -b would create a new branch instead of checking out the selected one.
    args.push(worktreePath, branch)
  } else {
    // Why: --no-track avoids inheriting the base's upstream so `git status` won't misreport "behind by N" pre-publish; first push sets it (see push.autoSetupRemote below).
    args.push('--no-track', '-b', branch, worktreePath)
    if (baseBranch) {
      effectiveBase = await resolveWorktreeAddBaseRef(baseBranch, (qualifiedRef) =>
        hasWorktreeBaseCommitRef(repoPath, qualifiedRef, options)
      )
      // Why: resolve the creation base first to distinguish remote-tracking refs from slash-containing local branches (mutation gated behind the explicit setting).
      if (refreshLocalBaseRef) {
        localBaseRefRefresh = await refreshLocalBaseRefForWorktreeCreate(
          repoPath,
          baseBranch,
          effectiveBase,
          options.remoteTrackingBase,
          options
        )
      } else if (options.suggestLocalBaseRefUpdate) {
        localBaseRefUpdateSuggestion = await getLocalBaseRefUpdateSuggestionForWorktreeCreate(
          repoPath,
          baseBranch,
          effectiveBase,
          options.remoteTrackingBase,
          options
        )
      }
      args.push(effectiveBase)
    }
  }
  await gitExecFileAsync(args, {
    ...gitExecOptions(repoPath, options),
    // Why: bound the checkout so a OneDrive cloud-placeholder stall (STA-1292) fails fast instead of hanging.
    timeout: WORKTREE_ADD_TIMEOUT_MS
  })

  if (options.checkoutExistingBranch) {
    return localBaseRefRefresh ? { localBaseRefRefresh } : {}
  }

  if (effectiveBase) {
    await persistWorktreeCreationBase(worktreePath, branch, effectiveBase, options)
  }

  // SSH parity: relay's addWorktreeOp (src/relay/git-handler-worktree-ops.ts) mirrors this — change both in lockstep.
  // Why: --no-track leaves no upstream until first push; push.autoSetupRemote=true lets a plain
  // `git push` create+set origin/<branch> (git >=2.37; older clients ignore it). `--local` on a
  // linked worktree writes the shared common-dir config (whole repo) — intentional and idempotent,
  // so it's warn-only and not rolled back on failure.
  try {
    // Why: `--get` (not `--local --get`) so a value at any scope counts as "user already chose" and isn't overwritten.
    let alreadySet = false
    try {
      await gitExecFileAsync(['config', '--get', 'push.autoSetupRemote'], {
        ...gitExecOptions(worktreePath, options)
      })
      alreadySet = true
    } catch (readError) {
      // Why: `git config --get` exits 1 only when unset at every scope; any other code is a real read failure — rethrow rather than overwrite the user's value.
      const code = (readError as { code?: unknown })?.code
      if (code !== 1) {
        throw readError
      }
    }
    if (!alreadySet) {
      await gitExecFileAsync(['config', '--local', 'push.autoSetupRemote', 'true'], {
        ...gitExecOptions(worktreePath, options)
      })
    }
  } catch (error) {
    console.warn(`addWorktree: failed to set push.autoSetupRemote for ${worktreePath}`, error)
  }
  return {
    ...(localBaseRefRefresh ? { localBaseRefRefresh } : {}),
    ...(localBaseRefUpdateSuggestion ? { localBaseRefUpdateSuggestion } : {})
  }
}

async function addSparseWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string,
  directories: string[],
  baseBranch?: string,
  refreshLocalBaseRef = false,
  options: AddWorktreeOptions = {}
): Promise<AddWorktreeResult> {
  let created = false
  let addResult: AddWorktreeResult = {}
  try {
    addResult = await addWorktree(
      repoPath,
      worktreePath,
      branch,
      baseBranch,
      refreshLocalBaseRef,
      true,
      options
    )
    created = true
    await gitExecFileAsync(
      ['sparse-checkout', 'init', '--cone'],
      gitExecOptions(worktreePath, options)
    )
    await gitExecFileAsync(
      ['sparse-checkout', 'set', '--', ...directories],
      gitExecOptions(worktreePath, options)
    )
    await gitExecFileAsync(['checkout', branch], gitExecOptions(worktreePath, options))
    return addResult
  } catch (error) {
    const wrapped: SparseWorktreeCreateError =
      error instanceof Error ? (error as SparseWorktreeCreateError) : new Error(String(error))
    if (created) {
      if (!options.checkoutExistingBranch) {
        await unsetWorktreeCreationBase(worktreePath, branch, options)
      }
      try {
        await removeWorktree(repoPath, worktreePath, true, {
          deleteBranch: !options.checkoutExistingBranch,
          // Why: failed-creation rollback — the fresh branch has no user commits, so force-delete rather than orphan it.
          forceBranchDelete: !options.checkoutExistingBranch,
          ...(options.wslDistro ? { wslDistro: options.wslDistro } : {})
        })
      } catch {
        wrapped.cleanupFailed = true
        // Why: surface that manual cleanup may be needed, else a half-created worktree lingers silently on disk.
        wrapped.message = `${wrapped.message} (cleanup also failed — the partially created worktree at "${worktreePath}" may need manual removal)`
      }
    }
    throw wrapped
  }
}

/**
 * Move a worktree with `git worktree move` (not `fs.rename`, which corrupts the
 * `.git` file and the `.git/worktrees/<name>/gitdir` back-pointer). Local-only,
 * so there is no relay parity handler. Caller owns migrating Orca's
 * path-derived worktree identity and pre-checks that the destination is free.
 */
async function moveWorktree(
  repoPath: string,
  oldPath: string,
  newPath: string
): Promise<void> {
  try {
    await runWithGitReadCacheInvalidation(() =>
      gitExecFileAsync(['worktree', 'move', oldPath, newPath], { cwd: repoPath })
    )
  } finally {
    bumpWorktreeScanGeneration(repoPath)
  }
}

/**
 * Remove a worktree.
 */
async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force = false,
  // forceBranchDelete: for failed-creation rollback (fresh branch, no user work); user deletes leave it false so unmerged commits survive.
  options: RemoveWorktreeOptions = {}
): Promise<RemoveWorktreeResult> {
  try {
    return await runWithGitReadCacheInvalidation(() =>
      performRemoveWorktree(repoPath, worktreePath, force, options)
    )
  } finally {
    bumpWorktreeScanGeneration(repoPath)
  }
}

async function performRemoveWorktree(
  repoPath: string,
  worktreePath: string,
  force = false,
  options: RemoveWorktreeOptions = {}
): Promise<RemoveWorktreeResult> {
  const removedWorktree =
    options.knownRemovedWorktree ??
    (await listWorktrees(repoPath, options)).find((worktree) =>
      areWorktreePathsEqual(worktree.path, worktreePath)
    )
  const branchName = normalizeLocalBranchRef(removedWorktree?.branch ?? '')
  const branchHead = removedWorktree?.head ?? ''

  // Why: callers outside the IPC/runtime preflight must not bypass Git's lock contract or rely on localized stderr after side effects.
  assertWorktreeUnlockedForRemoval(removedWorktree)

  const args = ['worktree', 'remove']
  if (force) {
    args.push('--force')
  }
  args.push(worktreePath)
  try {
    await gitExecFileAsync(args, gitExecOptions(repoPath, options))
  } catch (error) {
    if (force || !isSubmoduleWorktreeRemovalRefusal(error)) {
      throw error
    }
    // Why: Git refuses non-force removal of a worktree with an initialised submodule even when clean; re-prove cleanliness, then --force.
    await assertWorktreeCleanForRemoval(worktreePath, false, options)
    await gitExecFileAsync(
      ['worktree', 'remove', '--force', worktreePath],
      gitExecOptions(repoPath, options)
    )
  }

  if (!branchName) {
    return {}
  }
  if (options.deleteBranch === false) {
    return {}
  }

  // Why its own span: branch cleanup can reach the network (`fetch --prune`), so a stall here reads as
  // `git worktree remove` being slow unless it is timed separately.
  return withSpan('worktree.remove.branch_delete', () =>
    deleteBranchAfterWorktreeRemoval(repoPath, branchName, branchHead, options)
  )
}

async function deleteBranchAfterWorktreeRemoval(
  repoPath: string,
  branchName: string,
  branchHead: string,
  options: RemoveWorktreeOptions
): Promise<RemoveWorktreeResult> {
  try {
    // Why: also drop the now-orphaned branch so delete-worktree leaves none; `-d` (not `-D`) preserves
    // unmerged work, and forceBranchDelete opts into `-D` for failed-creation rollback.
    const branchDeleteResult = await deleteLocalBranchAfterWorktreeRemoval(
      repoPath,
      branchName,
      options.forceBranchDelete === true,
      options
    )
    if (branchDeleteResult === 'checked-out') {
      return {}
    }
    return {}
  } catch (error) {
    if (!options.forceBranchDelete && branchHead) {
      try {
        if (
          await deleteAlreadyMergedBranchAfterSafeDeleteFailure(
            repoPath,
            branchName,
            branchHead,
            options
          )
        ) {
          return {}
        }
      } catch (alreadyMergedDeleteError) {
        // Why: worktree is already gone; a raced branch cleanup should degrade to preserved-branch recovery, not fail delete.
        console.warn(
          `[git] Failed to delete already-merged local branch "${branchName}" after removing worktree`,
          alreadyMergedDeleteError
        )
      }
    }
    // Keep an unmerged/unpublished branch: deleting a worktree must never silently discard commits.
    console.warn(
      `[git] Preserved local branch "${branchName}" after removing worktree (not fully merged)`,
      error
    )
    return { preservedBranch: { branchName, ...(branchHead ? { head: branchHead } : {}) } }
  }
}

async function deleteLocalBranchAfterWorktreeRemoval(
  repoPath: string,
  branchName: string,
  forceBranchDelete: boolean,
  options: GitWorktreeExecOptions = {}
): Promise<'deleted' | 'checked-out'> {
  const deleteFlag = forceBranchDelete ? '-D' : '-d'
  try {
    await gitExecFileAsync(
      ['branch', deleteFlag, '--', branchName],
      gitExecOptions(repoPath, options)
    )
    return 'deleted'
  } catch (error) {
    if (!isBranchCheckedOutInWorktreeError(error)) {
      throw error
    }
  }

  try {
    // Why: only pay for `worktree prune` when a stale admin record may be blocking `branch -d`.
    await gitExecFileAsync(['worktree', 'prune'], gitExecOptions(repoPath, options))
  } catch (error) {
    console.warn(`[git] Failed to prune worktrees before deleting branch "${branchName}"`, error)
    return 'checked-out'
  }

  try {
    await gitExecFileAsync(
      ['branch', deleteFlag, '--', branchName],
      gitExecOptions(repoPath, options)
    )
    return 'deleted'
  } catch (error) {
    if (isBranchCheckedOutInWorktreeError(error)) {
      return 'checked-out'
    }
    throw error
  }
}

async function deleteAlreadyMergedBranchAfterSafeDeleteFailure(
  repoPath: string,
  branchName: string,
  branchHead: string,
  options: GitWorktreeExecOptions = {}
): Promise<boolean> {
  const runGit = (args: string[], execOptions?: { stdin?: string }) =>
    gitExecFileAsync(args, {
      ...gitExecOptions(repoPath, options),
      ...(execOptions?.stdin !== undefined ? { stdin: execOptions.stdin } : {})
    })
  const targetRefs = await getBranchCleanupTargetRefs(runGit, branchName)
  await refreshBranchCleanupTargetRefs(runGit, targetRefs)
  // Why: squash merges rewrite commit IDs, so `branch -d` rejects already-merged branches; delete only when Git proves no unmerged tree changes.
  if (
    !(await branchHasNoUnmergedChangesOnAnyTarget(
      runGit,
      branchName,
      targetRefs,
      getLocalGitCapabilityCache({ cwd: repoPath, wslDistro: options.wslDistro })
    ))
  ) {
    return false
  }
  await forceDeleteLocalBranch(repoPath, branchName, branchHead, (args, cwd) =>
    gitExecFileAsync(args, gitExecOptions(cwd, options))
  )
  return true
}

export { addWorktree, performAddWorktree, addSparseWorktree, moveWorktree, removeWorktree, performRemoveWorktree, deleteBranchAfterWorktreeRemoval, deleteLocalBranchAfterWorktreeRemoval, deleteAlreadyMergedBranchAfterSafeDeleteFailure }

