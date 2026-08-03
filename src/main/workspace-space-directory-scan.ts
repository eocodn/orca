import type { DirEntry, Repo, Worktree } from "../shared/types"
import type { IFilesystemProvider } from "./providers/types"
import type { WorkspaceSpaceWorktree } from "../shared/workspace-space-types"
import { compactWorkspaceSpaceItems } from "../shared/workspace-space-compaction"
import { mapWithConcurrency } from "../shared/map-with-concurrency"
import { scanWorkspaceSpaceEntryTree } from "../shared/workspace-space-entry-traversal"
import { collectWorkspaceSpaceDirectoryEntries, createWorkspaceSpaceScanBudget, WorkspaceSpaceScanCapacityError } from "../shared/workspace-space-scan-budget"
import { lstat, opendir } from "node:fs/promises"
import { platform } from "node:process"
import { basenameFilesystemPath, joinFilesystemPath, normalizeLocalDuPath, readLocalDuDepthOne, toWorkspaceSpaceItem, createBaseWorktreeRow, createUnavailableWorktreeRow, createScannedWorktreeRow, throwIfAborted, classifyError, WorkspaceSpaceScanCancelledError, isAbortError, isRelayMethodNotFoundError, LOCAL_FS_CONCURRENCY, REMOTE_FS_CONCURRENCY, type ScanStats } from "./workspace-space-scan-support"

export async function scanLocalEntry(
  entryPath: string,
  name: string,
  signal?: AbortSignal
): Promise<ScanStats> {
  return scanWorkspaceSpaceEntryTree<Dirent>({
    rootPath: entryPath,
    rootName: name,
    concurrency: LOCAL_FS_CONCURRENCY,
    signal,
    entryName: (entry) => entry.name,
    joinPath: joinFilesystemPath,
    classifyEntry: async (path) => {
      const stats = await lstat(path)
      throwIfAborted(signal)
      if (stats.isSymbolicLink()) {
        return { kind: 'symlink', sizeBytes: stats.size }
      }
      return stats.isDirectory()
        ? { kind: 'directory', sizeBytes: stats.size }
        : { kind: 'file', sizeBytes: stats.size }
    },
    readDirectory: (path) => opendir(path),
    checkCancelled: () => throwIfAborted(signal),
    createCancellationError: () => new WorkspaceSpaceScanCancelledError(),
    isCancellationError: (error) => error instanceof WorkspaceSpaceScanCancelledError
  })
}

export async function scanRemoteEntry(
  entryPath: string,
  name: string,
  provider: IFilesystemProvider,
  signal?: AbortSignal
): Promise<ScanStats> {
  return scanWorkspaceSpaceEntryTree<DirEntry>({
    rootPath: entryPath,
    rootName: name,
    concurrency: REMOTE_FS_CONCURRENCY,
    signal,
    entryName: (entry) => entry.name,
    joinPath: joinFilesystemPath,
    classifyEntry: async (path, sourceEntry) => {
      if (sourceEntry?.isSymlink) {
        return { kind: 'symlink', sizeBytes: 0 }
      }
      const stats = await provider.stat(path)
      throwIfAborted(signal)
      if (stats.type === 'symlink') {
        return { kind: 'symlink', sizeBytes: stats.size }
      }
      return stats.type === 'directory'
        ? { kind: 'directory', sizeBytes: stats.size }
        : { kind: 'file', sizeBytes: stats.size }
    },
    readDirectory: (path) => provider.readDir(path),
    checkCancelled: () => throwIfAborted(signal),
    createCancellationError: () => new WorkspaceSpaceScanCancelledError(),
    isCancellationError: (error) => error instanceof WorkspaceSpaceScanCancelledError
  })
}

export async function scanLocalTopLevelEntry(
  entryPath: string,
  name: string,
  duSizes: Map<string, number>,
  signal?: AbortSignal
): Promise<ScanStats> {
  throwIfAborted(signal)
  const stats = await lstat(entryPath)
  throwIfAborted(signal)

  if (stats.isSymbolicLink()) {
    return {
      name,
      path: entryPath,
      kind: 'symlink',
      sizeBytes: stats.size,
      skippedEntryCount: 0
    }
  }

  if (!stats.isDirectory()) {
    return {
      name,
      path: entryPath,
      kind: 'file',
      sizeBytes: stats.size,
      skippedEntryCount: 0
    }
  }

  return {
    name,
    path: entryPath,
    kind: 'directory',
    sizeBytes: duSizes.get(normalizeLocalDuPath(entryPath)) ?? stats.size,
    skippedEntryCount: 0
  }
}

export async function scanLocalWorktreeWithDu(
  repo: Repo,
  worktree: Worktree,
  scannedAt: number,
  signal?: AbortSignal
): Promise<WorkspaceSpaceWorktree> {
  throwIfAborted(signal)
  const rootStats = await lstat(worktree.path)
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    const root = await scanLocalEntry(worktree.path, basenameFilesystemPath(worktree.path), signal)
    const compact = compactWorkspaceSpaceItems((root.children ?? []).map(toWorkspaceSpaceItem))
    return {
      ...createBaseWorktreeRow(repo, worktree, scannedAt),
      status: 'ok',
      error: null,
      sizeBytes: root.sizeBytes,
      reclaimableBytes: worktree.isMainWorktree ? 0 : root.sizeBytes,
      skippedEntryCount: root.skippedEntryCount,
      ...compact
    }
  }

  const [entries, duSizes] = await Promise.all([
    opendir(worktree.path).then(async (directory) => {
      const admission = await collectWorkspaceSpaceDirectoryEntries(
        directory,
        worktree.path,
        (entry) => entry.name,
        createWorkspaceSpaceScanBudget(),
        () => throwIfAborted(signal)
      )
      return admission.entries
    }),
    readLocalDuDepthOne(worktree.path, signal)
  ])
  throwIfAborted(signal)
  const childStats = await mapWithConcurrency(
    entries,
    LOCAL_FS_CONCURRENCY,
    async (entry): Promise<ScanStats | null> => {
      try {
        return await scanLocalTopLevelEntry(
          joinFilesystemPath(worktree.path, entry.name),
          entry.name,
          duSizes,
          signal
        )
      } catch (error) {
        if (error instanceof WorkspaceSpaceScanCancelledError) {
          throw error
        }
        return null
      }
    }
  )
  const children = childStats.filter((child): child is ScanStats => child !== null)
  const skippedEntryCount = childStats.length - children.length
  const rootSize =
    duSizes.get(normalizeLocalDuPath(worktree.path)) ??
    rootStats.size + children.reduce((sum, child) => sum + child.sizeBytes, 0)
  const compact = compactWorkspaceSpaceItems(children.map(toWorkspaceSpaceItem))

  return {
    ...createBaseWorktreeRow(repo, worktree, scannedAt),
    status: 'ok',
    error: null,
    sizeBytes: rootSize,
    reclaimableBytes: worktree.isMainWorktree ? 0 : rootSize,
    skippedEntryCount,
    ...compact
  }
}

export async function scanLocalWorktreeWithNode(
  repo: Repo,
  worktree: Worktree,
  scannedAt: number,
  signal?: AbortSignal
): Promise<WorkspaceSpaceWorktree> {
  try {
    const root = await scanLocalEntry(worktree.path, basenameFilesystemPath(worktree.path), signal)
    const compact = compactWorkspaceSpaceItems((root.children ?? []).map(toWorkspaceSpaceItem))
    return {
      ...createBaseWorktreeRow(repo, worktree, scannedAt),
      status: 'ok',
      error: null,
      sizeBytes: root.sizeBytes,
      reclaimableBytes: worktree.isMainWorktree ? 0 : root.sizeBytes,
      skippedEntryCount: root.skippedEntryCount,
      ...compact
    }
  } catch (error) {
    if (error instanceof WorkspaceSpaceScanCancelledError) {
      throw error
    }
    const classified = classifyError(error)
    return createUnavailableWorktreeRow(
      repo,
      worktree,
      scannedAt,
      classified.status,
      classified.message
    )
  }
}

export async function scanLocalWorktree(
  repo: Repo,
  worktree: Worktree,
  scannedAt: number,
  signal?: AbortSignal
): Promise<WorkspaceSpaceWorktree> {
  throwIfAborted(signal)
  if (platform !== 'win32') {
    try {
      // Why: JS per-file stats are too slow for large local workspace fleets;
      // POSIX du gives bounded top-level sizing without following symlinks.
      return await scanLocalWorktreeWithDu(repo, worktree, scannedAt, signal)
    } catch (error) {
      throwIfAborted(signal)
      if (error instanceof WorkspaceSpaceScanCancelledError) {
        throw error
      }
      if (error instanceof WorkspaceSpaceScanCapacityError) {
        const classified = classifyError(error)
        return createUnavailableWorktreeRow(
          repo,
          worktree,
          scannedAt,
          classified.status,
          classified.message
        )
      }
      // Fall through to the portable scanner so unsupported du variants or
      // permission edge cases still produce partial rows instead of failing.
    }
  }
  return scanLocalWorktreeWithNode(repo, worktree, scannedAt, signal)
}

export async function scanRemoteWorktree(
  repo: Repo,
  worktree: Worktree,
  scannedAt: number,
  provider: IFilesystemProvider,
  fallbackTraversalLimit: AsyncLimiter,
  signal?: AbortSignal
): Promise<WorkspaceSpaceWorktree> {
  try {
    if (provider.scanWorkspaceSpace) {
      try {
        const scan = await provider.scanWorkspaceSpace(worktree.path, { signal })
        return createScannedWorktreeRow(repo, worktree, scannedAt, scan)
      } catch (error) {
        if (isAbortError(error)) {
          throw new WorkspaceSpaceScanCancelledError()
        }
        if (!isRelayMethodNotFoundError(error)) {
          throw error
        }
        // Why: old SSH relays do not know the bulk Space scan method. Fall
        // back to the request-by-request walker instead of marking SSH rows
        // unavailable after an app upgrade.
      }
    }

    const root = await fallbackTraversalLimit(() =>
      scanRemoteEntry(worktree.path, basenameFilesystemPath(worktree.path), provider, signal)
    )
    const compact = compactWorkspaceSpaceItems((root.children ?? []).map(toWorkspaceSpaceItem))
    return createScannedWorktreeRow(repo, worktree, scannedAt, {
      sizeBytes: root.sizeBytes,
      skippedEntryCount: root.skippedEntryCount,
      ...compact
    })
  } catch (error) {
    if (error instanceof WorkspaceSpaceScanCancelledError) {
      throw error
    }
    const classified = classifyError(error)
    return createUnavailableWorktreeRow(
      repo,
      worktree,
      scannedAt,
      classified.status,
      classified.message
    )
  }
}
