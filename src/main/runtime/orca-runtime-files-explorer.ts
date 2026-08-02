import { randomUUID, watchFs, chmod, constants, copyFile, lstat, mkdir, open, readFile, readdir, rename, realpath, rm, stat, writeFile, homedir, tmpdir, basename, dirname, extname, join, isPathInsideOrEqual, isRuntimePathAbsolute, isWindowsAbsolutePathLike, normalizeRuntimePathForComparison, relativePathInsideRoot, resolveRuntimePath, PhysicalExitTracker, closeFileExplorerWatcherInWatcherProcess, watchFileExplorerInWatcherProcess, wslAwareSpawn, parseWslPath, toWindowsWslPath, isENOENT, resolveAuthorizedPath, listQuickOpenFiles, searchWithGitGrep, getLocalGitOptionsForRegisteredWorktree, checkRgAvailable, listMarkdownDocuments, markdownDocumentsFromRelativePaths, buildRgArgs, createAccumulator, DEFAULT_SEARCH_MAX_RESULTS, finalize, ingestRgJsonLine, SEARCH_TIMEOUT_MS, getSshFilesystemProvider, onSshFilesystemProviderRegistered, SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE, isWatcherProcessFailure, WatcherProcessFailure, joinWorktreeRelativePath, normalizeRuntimeRelativePath, rankRuntimeMobileFilePaths, RuntimeMobileFilePathSearchCache, beginWatcherInstall, assertSshMutationExpectation, toSshExecutionHostId, renameLocalPathSerializedByDestination, MOBILE_FILE_LIST_LIMIT, MOBILE_FILE_PATH_SEARCH_CACHE_LIMIT, MOBILE_FILE_PATH_SEARCH_CACHE_ENTRIES, MOBILE_FILE_PATH_SEARCH_CACHE_TTL_MS, MOBILE_FILE_READ_MAX_BYTES, RUNTIME_PREVIEWABLE_BINARY_MAX_BYTES, WINDOWS_RUNTIME_FILE_WATCH_DEBOUNCE_MS, WINDOWS_RUNTIME_FILE_WATCH_CLOSE_DEADLINE_MS, TERMINAL_FILE_GRANT_TTL_MS, OPEN_NOFOLLOW, RUNTIME_FILE_MUTATION_UPDATE_REQUIRED, assertRuntimeFileMutationExpectation, pendingRuntimeFileWatcherUnsubscribes, runtimeFileWatcherLeasesByOwnerAndRoot, sshFileExplorerWatchRearms, MOBILE_BINARY_EXTENSIONS, MOBILE_PREVIEWABLE_IMAGE_EXTENSIONS, isMobilePreviewableImagePath, RUNTIME_PREVIEWABLE_BINARY_MIME_TYPES, trackRuntimeFileWatcherUnsubscribe, normalizeRuntimeWatcherRoot, runtimeWatcherReleaseKey, armSshFileExplorerWatchRearm, stopSshFileExplorerWatchRearms, registerRuntimeFileWatcherRelease, awaitRuntimeFileWatcherUnsubscribes, _getRuntimeFileWatcherReleaseCountForTests, _resetRuntimeFileWatcherLeasesForTests, type ChildProcess, type FileHandle, type DirEntry, type FsChangeEvent, type GitWorktreeInfo, type MarkdownDocument, type SearchOptions, type SearchResult, type Worktree, type RuntimeFileListResult, type RuntimeFileOpenResult, type RuntimeFileReadChunkResult, type RuntimeFilePreviewResult, type RuntimeFileReadResult, type RuntimeTerminalPathResolution, type Store, type FileStat, type IFilesystemProvider, type RuntimeFileWatcherLease, type RuntimeFileStatLike, type TerminalFileGrant, type ResolvedRuntimeFileWorktree, type ResolvedRuntimeFileTarget, type RuntimeFileCommandHost } from './orca-runtime-files-foundation'
import { watchWindowsRuntimeFileExplorer, isSafeMobileRelativePath, isMobileMarkdownPath, isMobileBinaryPath, basenameFromRelativePath, isRuntimeDirectoryEntry, isBinaryBuffer, assertRuntimePathDoesNotExist, rethrowRuntimeFileCreateError, readLocalMobileFile, readLocalTerminalArtifactFileFromHandle, readLocalTerminalArtifactPreviewFromHandle, assertLocalTerminalArtifactPathStillCanonical, openLocalTerminalArtifactGrant, resolveTerminalAbsolutePath, normalizeTerminalFileUriAuthorityPath, provenancePathCandidate, isLoopbackFileUriHostname, normalizeLeadingSlashDrivePath, resolveAllowedLocalTerminalArtifactPath, localTerminalArtifactRoots, canonicalPathForArtifactComparison, readFileHandleBufferBounded, terminalFileStatIdentity, assertTerminalFileGrantFresh, assertTerminalArtifactNotHardLinked, isTerminalArtifactHardLinked, truncateMobileFilePreview } from './orca-runtime-files-support'

export class RuntimeFileExplorerCommands extends RuntimeFileMobileCommands {
  async readFileExplorerDir(worktreeSelector: string, relativePath: string): Promise<DirEntry[]> {
    const target = await this.resolveFileExplorerPath(worktreeSelector, relativePath)
    const provider = target.connectionId ? getSshFilesystemProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      return provider.readDir(target.path)
    }

    const dirPath = await resolveAuthorizedPath(target.path, this.host.requireStore())
    const entries = await readdir(dirPath, { withFileTypes: true })
    const mapped = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = join(dirPath, entry.name)
        return {
          name: entry.name,
          isDirectory: await isRuntimeDirectoryEntry(entry, entryPath),
          isSymlink: entry.isSymbolicLink()
        }
      })
    )
    return mapped.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  }

  async watchFileExplorer(
    worktreeSelector: string,
    callback: (events: FsChangeEvent[]) => void,
    onTerminalError: (error: Error) => void = () => undefined,
    signal?: AbortSignal
  ): Promise<() => Promise<void>> {
    const target = await this.resolveFileExplorerPath(worktreeSelector, '')
    const open = async (): Promise<{
      unsubscribe: () => Promise<void>
      rootPaths: string[]
    }> => {
      const finishInstall = beginWatcherInstall(target.path, target.connectionId)
      try {
        const provider = target.connectionId ? getSshFilesystemProvider(target.connectionId) : null
        if (target.connectionId) {
          if (!provider) {
            throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          // Why: the RPC layer already threads AbortSignal for local watches; SSH must cancel the remote fs.watch, not wait it out.
          const close = await provider.watch(target.path, callback, { signal, onTerminalError })
          const rearm = armSshFileExplorerWatchRearm({
            runtimeId: this.host.getRuntimeId(),
            connectionId: target.connectionId,
            rootPath: target.path,
            callback,
            onTerminalError,
            signal,
            initialUnwatch: close
          })
          return { unsubscribe: rearm.unsubscribe, rootPaths: [target.path] }
        }

        const rootPath = await resolveAuthorizedPath(target.path, this.host.requireStore())
        const rootStats = await stat(rootPath)
        if (!rootStats.isDirectory()) {
          throw new Error('not_a_directory')
        }
        if (process.platform === 'win32') {
          const close = watchWindowsRuntimeFileExplorer(rootPath, callback, onTerminalError)
          return { unsubscribe: close, rootPaths: [target.path, rootPath] }
        }
        // Why: the forked watcher keeps the blocking crawl and native faults out of the main/`serve` process (issues #5308, #8212).
        const dispose = await watchFileExplorerInWatcherProcess(
          rootPath,
          callback,
          onTerminalError,
          signal
        )
        return { unsubscribe: dispose, rootPaths: [target.path, rootPath] }
      } finally {
        finishInstall()
      }
    }
    const initial = await open()
    return registerRuntimeFileWatcherRelease(
      this.host.getRuntimeId(),
      target.connectionId,
      initial.rootPaths,
      initial.unsubscribe,
      async () => (await open()).unsubscribe,
      onTerminalError
    )
  }

  async closeFileExplorerWatchersForPath(rootPath: string, connectionId?: string): Promise<void> {
    const key = runtimeWatcherReleaseKey(this.host.getRuntimeId(), connectionId, rootPath)
    const leases = runtimeFileWatcherLeasesByOwnerAndRoot.get(key)
    if (leases) {
      await Promise.all(Array.from(leases, (lease) => lease.suspend()))
    }
    if (!connectionId) {
      // Why: setup can fail before registerRuntimeFileWatcherRelease publishes its callback while the child owner still lives.
      const resolvedRootPath = await resolveAuthorizedPath(rootPath, this.host.requireStore())
      await closeFileExplorerWatcherInWatcherProcess(resolvedRootPath)
    }
  }

  async restoreFileExplorerWatchersAfterFailedRemoval(
    rootPath: string,
    connectionId?: string
  ): Promise<void> {
    const key = runtimeWatcherReleaseKey(this.host.getRuntimeId(), connectionId, rootPath)
    const leases = runtimeFileWatcherLeasesByOwnerAndRoot.get(key)
    if (leases) {
      await Promise.all(Array.from(leases, (lease) => lease.resume()))
    }
  }

}

