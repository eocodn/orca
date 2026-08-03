import type { BrowserWindow } from 'electron'
import type { Store } from '../persistence'
import type { BaseRefSearchResult, Repo } from '../../shared/types'
import { isFolderRepo } from '../../shared/repo-kind'
import { isGitRepo, normalizeRefSearchQuery, parseAndFilterSearchRefDetails, buildSearchBaseRefsArgv, isForEachRefExcludeUnsupportedError, mergeBaseRefSearchResultGroups, searchBaseRefDetails } from '../git/repo'
import { getSshGitProvider } from '../providers/ssh-git-dispatch'
import { getSshGitCapabilityCache } from '../git/git-capability-state'
import { normalizeSparseDirectories } from './sparse-checkout-directories'
import { scheduleCurrentWorktreeBaseDirectoryWatcherSync } from './worktree-base-directory-watcher'
import { getRepoExecutionHostId, type ExecutionHostId } from '../../shared/execution-host'

// Why: `method` is the IPC entry point the user took, not what they added (never path/URL/name); repos:create → 'folder_picker'.
// Why: `isGitRepo` is a non-identifying git-vs-folder signal from the caller's detection; pass undefined when unknown, never default false.
// Why: it replaced onboarding_completed.is_git_repo, which lost meaning once repo selection left onboarding (1.4.46).
import { registerRepoHandlers } from './repo-ipc-scans'
export { registerRepoHandlers } from './repo-ipc-scans'

export async function searchBaseRefDetailsForRepo(
  store: Store,
  args: { repoId: string; query: string; limit?: number; hostId?: ExecutionHostId }
): Promise<BaseRefSearchResult[]> {
  const repo = getRepoForExecutionHost(store, args.repoId, args.hostId)
  if (!repo || isFolderRepo(repo)) {
    return []
  }
  const limit = args.limit ?? 25
  if (!Number.isInteger(limit) || limit <= 0) {
    return []
  }
  // Why: remote repos need the relay to list branches on the remote host.
  if (repo.connectionId) {
    const provider = getSshGitProvider(repo.connectionId)
    if (!provider) {
      return []
    }
    // Why: strip glob metacharacters to prevent glob injection (mirrors local normalizeRefSearchQuery).
    const normalizedQuery = normalizeRefSearchQuery(args.query)
    try {
      // Why: argv lives in buildSearchBaseRefsArgv so SSH and local paths cannot drift.
      const remotesResult = await provider.exec(['remote'], repo.path).catch(() => ({ stdout: '' }))
      const remotes = remotesResult.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      const capabilities = getSshGitCapabilityCache(provider)
      const runSearch = async (patternGroup?: 'segmented' | 'branchRoot'): Promise<string> => {
        return capabilities.runWithFallback(
          'for-each-ref-exclude',
          async () =>
            (
              await provider.exec(
                buildSearchBaseRefsArgv(normalizedQuery, limit, {
                  remoteNames: remotes,
                  patternGroup
                }),
                repo.path
              )
            ).stdout,
          async () =>
            (
              await provider.exec(
                buildSearchBaseRefsArgv(normalizedQuery, limit, {
                  excludeRemoteHead: false,
                  remoteNames: remotes,
                  patternGroup
                }),
                repo.path
              )
            ).stdout,
          isForEachRefExcludeUnsupportedError
        )
      }
      // Why: delegate the parse/filter/dedup/limit pipeline to the shared helper so SSH and local paths cannot diverge.
      const searchTokens = normalizedQuery.split('/').filter((token) => token.length > 0)
      if (searchTokens.length > 1) {
        const results = await Promise.all([runSearch('segmented'), runSearch('branchRoot')])
        return mergeBaseRefSearchResultGroups(
          results.map((stdout) => parseAndFilterSearchRefDetails(stdout, limit, remotes)),
          limit
        )
      }
      return parseAndFilterSearchRefDetails(await runSearch(), limit, remotes)
    } catch (err) {
      console.warn('[repos:searchBaseRefs] SSH for-each-ref failed', {
        path: repo.path,
        err
      })
      return []
    }
  }
  return searchBaseRefDetails(repo.path, args.query, limit)
}

export function getRepoForExecutionHost(
  store: Store,
  repoId: string,
  hostId?: ExecutionHostId
): Repo | null {
  if (!hostId) {
    return store.getRepo(repoId) ?? null
  }
  // Why: repo ids can collide across local and SSH hosts; read must use the same host the Settings pane selected for the write.
  return (
    store
      .getRepos()
      .find((repo) => repo.id === repoId && getRepoExecutionHostId(repo) === hostId) ?? null
  )
}

export function notifyReposChanged(mainWindow: BrowserWindow): void {
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send('repos:changed')
  }
  scheduleCurrentWorktreeBaseDirectoryWatcherSync()
}

export function notifySparsePresetsChanged(mainWindow: BrowserWindow, repoId: string): void {
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sparsePresets:changed', { repoId })
  }
}

export function normalizeSparsePresetName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Preset name is required.')
  }
  if (trimmed.length > 80) {
    throw new Error('Preset name is too long.')
  }
  return trimmed
}

export function normalizeSparsePresetDirectories(directories: string[]): string[] {
  let normalized: string[]
  try {
    normalized = normalizeSparseDirectories(directories)
  } catch (err) {
    if (
      err instanceof Error &&
      err.message === 'Sparse checkout directories must be repo-relative paths.'
    ) {
      throw new Error('Preset directories must be repo-relative paths.')
    }
    throw err
  }
  if (normalized.length === 0) {
    throw new Error('Preset must have at least one directory.')
  }
  return normalized
}
