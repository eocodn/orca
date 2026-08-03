import type { Store } from "./persistence"
import type { WorkspaceSpaceAnalysis } from "../shared/workspace-space-types"
import { mapWithConcurrency } from "../shared/map-with-concurrency"
import { REPO_SCAN_CONCURRENCY, LOCAL_WORKTREE_SCAN_CONCURRENCY, REMOTE_FALLBACK_SCAN_CONCURRENCY, createAsyncLimiter, throwIfAborted, type WorkspaceSpaceAnalyzeOptions, type WorkspaceSpaceProgressState, type WorkspaceSpaceScanLimiters } from "./workspace-space-scan-support"
import { scanRepo } from "./workspace-space-repo-scan"

export async function analyzeWorkspaceSpace(
  store: Store,
  options: WorkspaceSpaceAnalyzeOptions = {}
): Promise<WorkspaceSpaceAnalysis> {
  throwIfAborted(options.signal)
  const scannedAt = Date.now()
  const reposToScan = store.getRepos()
  const progress: WorkspaceSpaceProgressState = {
    scanId: options.scanId ?? String(scannedAt),
    state: 'running',
    startedAt: scannedAt,
    updatedAt: scannedAt,
    totalRepoCount: reposToScan.length,
    scannedRepoCount: 0,
    totalWorktreeCount: 0,
    scannedWorktreeCount: 0,
    currentRepoDisplayName: null,
    currentWorktreeDisplayName: null
  }
  options.onProgress?.({ ...progress })
  const limiters: WorkspaceSpaceScanLimiters = {
    localWorktree: createAsyncLimiter(LOCAL_WORKTREE_SCAN_CONCURRENCY, options.signal),
    remoteFallbackTraversal: createAsyncLimiter(REMOTE_FALLBACK_SCAN_CONCURRENCY, options.signal)
  }
  const repoResults = await mapWithConcurrency(reposToScan, REPO_SCAN_CONCURRENCY, (repo) =>
    scanRepo(repo, scannedAt, store, limiters, progress, options)
  )
  throwIfAborted(options.signal)
  const repos = repoResults.map((result) => result.summary)
  const worktrees = repoResults
    .flatMap((result) => result.worktrees)
    .sort((a, b) => b.sizeBytes - a.sizeBytes || a.displayName.localeCompare(b.displayName))
  throwIfAborted(options.signal)

  return {
    scannedAt,
    totalSizeBytes: worktrees.reduce((sum, row) => sum + row.sizeBytes, 0),
    reclaimableBytes: worktrees.reduce((sum, row) => sum + row.reclaimableBytes, 0),
    worktreeCount: worktrees.length,
    scannedWorktreeCount: worktrees.filter((row) => row.status === 'ok').length,
    unavailableWorktreeCount:
      worktrees.filter((row) => row.status !== 'ok').length +
      repos.filter((repo) => repo.error !== null).length,
    repos,
    worktrees
  }
}
