import type { Store } from "./persistence"
import { isFolderRepo } from "../shared/repo-kind"
import type { GitWorktreeInfo, Repo, Worktree } from "../shared/types"
import type { WorkspaceSpaceWorktree } from "../shared/workspace-space-types"
import { getSshFilesystemProvider } from "./providers/ssh-filesystem-dispatch"
import { getSshGitProvider } from "./providers/ssh-git-dispatch"
import { createFolderWorktree, listRepoWorktrees } from "./repo-worktrees"
import { mergeWorktree } from "./ipc/worktree-logic"
import { getLocalProjectWorktreeGitOptions } from "./project-runtime-git-options"
import { mapWithConcurrency } from "../shared/map-with-concurrency"
import { scanLocalWorktree, scanRemoteWorktree } from "./workspace-space-directory-scan"
import { WORKTREE_SCAN_CONCURRENCY, throwIfAborted, classifyError, createUnavailableWorktreeRow, type WorkspaceSpaceAnalyzeOptions, type WorkspaceSpaceProgressState, type WorkspaceSpaceScanLimiters, type RepoScanResult } from "./workspace-space-scan-support"

export async function listWorktreesForSpaceScan(
  store: Store,
  repo: Repo,
  signal?: AbortSignal
): Promise<WorktreeListResult> {
  try {
    throwIfAborted(signal)
    if (isFolderRepo(repo)) {
      return { ok: true, worktrees: [createFolderWorktree(repo)] }
    }
    if (repo.connectionId) {
      const provider = getSshGitProvider(repo.connectionId)
      if (!provider) {
        return {
          ok: false,
          status: 'unavailable',
          error: `SSH connection "${repo.connectionId}" is not connected.`
        }
      }
      const worktrees = await provider.listWorktrees(repo.path, { signal })
      throwIfAborted(signal)
      return { ok: true, worktrees }
    }
    const worktrees = await listRepoWorktrees(repo, {
      ...getLocalProjectWorktreeGitOptions(store, repo),
      signal
    })
    throwIfAborted(signal)
    return { ok: true, worktrees }
  } catch (error) {
    if (error instanceof WorkspaceSpaceScanCancelledError) {
      throw error
    }
    const classified = classifyError(error)
    return { ok: false, status: classified.status, error: classified.message }
  }
}

export function mergeForSpaceScan(repo: Repo, gitWorktree: GitWorktreeInfo, store: Store): Worktree {
  const worktreeId = `${repo.id}::${gitWorktree.path}`
  return mergeWorktree(repo.id, gitWorktree, store.getWorktreeMeta(worktreeId), repo.displayName)
}

export function reportProgress(
  progress: WorkspaceSpaceProgressState,
  updates: Partial<WorkspaceSpaceProgressState>,
  onProgress: WorkspaceSpaceAnalyzeOptions['onProgress']
): void {
  Object.assign(progress, updates, { updatedAt: Date.now() })
  onProgress?.({ ...progress })
}

export async function scanRepo(
  repo: Repo,
  scannedAt: number,
  store: Store,
  limiters: WorkspaceSpaceScanLimiters,
  progress: WorkspaceSpaceProgressState,
  options: WorkspaceSpaceAnalyzeOptions
): Promise<RepoScanResult> {
  throwIfAborted(options.signal)
  reportProgress(
    progress,
    {
      currentRepoDisplayName: repo.displayName,
      currentWorktreeDisplayName: null
    },
    options.onProgress
  )
  const listed = await listWorktreesForSpaceScan(store, repo, options.signal)
  if (!listed.ok) {
    reportProgress(
      progress,
      { scannedRepoCount: progress.scannedRepoCount + 1 },
      options.onProgress
    )
    return {
      worktrees: [],
      summary: {
        repoId: repo.id,
        displayName: repo.displayName,
        path: repo.path,
        isRemote: Boolean(repo.connectionId),
        worktreeCount: 0,
        scannedWorktreeCount: 0,
        unavailableWorktreeCount: 1,
        totalSizeBytes: 0,
        reclaimableBytes: 0,
        error: listed.error
      }
    }
  }

  // Why: a prunable registration has no directory to size or reclaim (issue
  // #8389); it would only render a dead "Missing" row with no available
  // action. Removal flows list worktrees separately and still see it.
  const worktrees = listed.worktrees
    .filter((gitWorktree) => !gitWorktree.prunable)
    .map((gitWorktree) => mergeForSpaceScan(repo, gitWorktree, store))
  reportProgress(
    progress,
    { totalWorktreeCount: progress.totalWorktreeCount + worktrees.length },
    options.onProgress
  )
  const remoteProvider = repo.connectionId ? getSshFilesystemProvider(repo.connectionId) : undefined
  const rows = await mapWithConcurrency(worktrees, WORKTREE_SCAN_CONCURRENCY, async (worktree) => {
    throwIfAborted(options.signal)
    reportProgress(
      progress,
      {
        currentRepoDisplayName: repo.displayName,
        currentWorktreeDisplayName: worktree.displayName
      },
      options.onProgress
    )
    const row: WorkspaceSpaceWorktree = repo.connectionId
      ? remoteProvider
        ? await scanRemoteWorktree(
            repo,
            worktree,
            scannedAt,
            remoteProvider,
            limiters.remoteFallbackTraversal,
            options.signal
          )
        : createUnavailableWorktreeRow(
            repo,
            worktree,
            scannedAt,
            'unavailable',
            `SSH filesystem for "${repo.connectionId}" is not connected.`
          )
      : await limiters.localWorktree(() =>
          scanLocalWorktree(repo, worktree, scannedAt, options.signal)
        )
    reportProgress(
      progress,
      { scannedWorktreeCount: progress.scannedWorktreeCount + 1 },
      options.onProgress
    )
    return row
  })
  reportProgress(
    progress,
    {
      scannedRepoCount: progress.scannedRepoCount + 1,
      currentRepoDisplayName: repo.displayName,
      currentWorktreeDisplayName: null
    },
    options.onProgress
  )

  return {
    worktrees: rows,
    summary: {
      repoId: repo.id,
      displayName: repo.displayName,
      path: repo.path,
      isRemote: Boolean(repo.connectionId),
      worktreeCount: rows.length,
      scannedWorktreeCount: rows.filter((row) => row.status === 'ok').length,
      unavailableWorktreeCount: rows.filter((row) => row.status !== 'ok').length,
      totalSizeBytes: rows.reduce((sum, row) => sum + row.sizeBytes, 0),
      reclaimableBytes: rows.reduce((sum, row) => sum + row.reclaimableBytes, 0),
      error: null
    }
  }
}
