import { randomUUID, watchFs, chmod, constants, copyFile, lstat, mkdir, open, readFile, readdir, rename, realpath, rm, stat, writeFile, homedir, tmpdir, basename, dirname, extname, join, isPathInsideOrEqual, isRuntimePathAbsolute, isWindowsAbsolutePathLike, normalizeRuntimePathForComparison, relativePathInsideRoot, resolveRuntimePath, PhysicalExitTracker, closeFileExplorerWatcherInWatcherProcess, watchFileExplorerInWatcherProcess, wslAwareSpawn, parseWslPath, toWindowsWslPath, isENOENT, resolveAuthorizedPath, listQuickOpenFiles, searchWithGitGrep, getLocalGitOptionsForRegisteredWorktree, checkRgAvailable, listMarkdownDocuments, markdownDocumentsFromRelativePaths, buildRgArgs, createAccumulator, DEFAULT_SEARCH_MAX_RESULTS, finalize, ingestRgJsonLine, SEARCH_TIMEOUT_MS, getSshFilesystemProvider, onSshFilesystemProviderRegistered, SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE, isWatcherProcessFailure, WatcherProcessFailure, joinWorktreeRelativePath, normalizeRuntimeRelativePath, rankRuntimeMobileFilePaths, RuntimeMobileFilePathSearchCache, beginWatcherInstall, assertSshMutationExpectation, toSshExecutionHostId, renameLocalPathSerializedByDestination, MOBILE_FILE_LIST_LIMIT, MOBILE_FILE_PATH_SEARCH_CACHE_LIMIT, MOBILE_FILE_PATH_SEARCH_CACHE_ENTRIES, MOBILE_FILE_PATH_SEARCH_CACHE_TTL_MS, MOBILE_FILE_READ_MAX_BYTES, RUNTIME_PREVIEWABLE_BINARY_MAX_BYTES, WINDOWS_RUNTIME_FILE_WATCH_DEBOUNCE_MS, WINDOWS_RUNTIME_FILE_WATCH_CLOSE_DEADLINE_MS, TERMINAL_FILE_GRANT_TTL_MS, OPEN_NOFOLLOW, RUNTIME_FILE_MUTATION_UPDATE_REQUIRED, assertRuntimeFileMutationExpectation, pendingRuntimeFileWatcherUnsubscribes, runtimeFileWatcherLeasesByOwnerAndRoot, sshFileExplorerWatchRearms, MOBILE_BINARY_EXTENSIONS, MOBILE_PREVIEWABLE_IMAGE_EXTENSIONS, isMobilePreviewableImagePath, RUNTIME_PREVIEWABLE_BINARY_MIME_TYPES, trackRuntimeFileWatcherUnsubscribe, normalizeRuntimeWatcherRoot, runtimeWatcherReleaseKey, armSshFileExplorerWatchRearm, stopSshFileExplorerWatchRearms, registerRuntimeFileWatcherRelease, awaitRuntimeFileWatcherUnsubscribes, _getRuntimeFileWatcherReleaseCountForTests, _resetRuntimeFileWatcherLeasesForTests, type ChildProcess, type FileHandle, type DirEntry, type FsChangeEvent, type GitWorktreeInfo, type MarkdownDocument, type SearchOptions, type SearchResult, type Worktree, type RuntimeFileListResult, type RuntimeFileOpenResult, type RuntimeFileReadChunkResult, type RuntimeFilePreviewResult, type RuntimeFileReadResult, type RuntimeTerminalPathResolution, type Store, type FileStat, type IFilesystemProvider, type RuntimeFileWatcherLease, type RuntimeFileStatLike, type TerminalFileGrant, type ResolvedRuntimeFileWorktree, type ResolvedRuntimeFileTarget, type RuntimeFileCommandHost } from './orca-runtime-files-foundation'
import { watchWindowsRuntimeFileExplorer, isSafeMobileRelativePath, isMobileMarkdownPath, isMobileBinaryPath, basenameFromRelativePath, isRuntimeDirectoryEntry, isBinaryBuffer, assertRuntimePathDoesNotExist, rethrowRuntimeFileCreateError, readLocalMobileFile, readLocalTerminalArtifactFileFromHandle, readLocalTerminalArtifactPreviewFromHandle, assertLocalTerminalArtifactPathStillCanonical, openLocalTerminalArtifactGrant, resolveTerminalAbsolutePath, normalizeTerminalFileUriAuthorityPath, provenancePathCandidate, isLoopbackFileUriHostname, normalizeLeadingSlashDrivePath, resolveAllowedLocalTerminalArtifactPath, localTerminalArtifactRoots, canonicalPathForArtifactComparison, readFileHandleBufferBounded, terminalFileStatIdentity, assertTerminalFileGrantFresh, assertTerminalArtifactNotHardLinked, isTerminalArtifactHardLinked, truncateMobileFilePreview } from './orca-runtime-files-support'

export class RuntimeFileWatchCommands extends RuntimeFileExplorerCommands {
  forgetFileExplorerWatchersAfterRemoval(rootPath: string, connectionId?: string): void {
    const key = runtimeWatcherReleaseKey(this.host.getRuntimeId(), connectionId, rootPath)
    // Why: forget() never runs the lease's unsubscribe, so the re-arm would outlive a deleted
    // worktree and re-watch it on the next reconnect.
    stopSshFileExplorerWatchRearms(key)
    const leases = runtimeFileWatcherLeasesByOwnerAndRoot.get(key)
    if (leases) {
      for (const lease of Array.from(leases)) {
        lease.forget()
      }
    }
  }

  async readFileExplorerPreview(
    worktreeSelector: string,
    relativePath: string
  ): Promise<RuntimeFilePreviewResult> {
    const target = await this.resolveFileExplorerPath(worktreeSelector, relativePath)
    const provider = target.connectionId ? getSshFilesystemProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      const fileStats = await provider.stat(target.path)
      if (fileStats.size > RUNTIME_PREVIEWABLE_BINARY_MAX_BYTES) {
        throw new Error('file_too_large')
      }
      const result = await provider.readFile(target.path)
      return result
    }

    const filePath = await resolveAuthorizedPath(target.path, this.host.requireStore())
    const fileStats = await stat(filePath)
    const mimeType = RUNTIME_PREVIEWABLE_BINARY_MIME_TYPES[extname(filePath).toLowerCase()]
    if (mimeType) {
      if (fileStats.size > RUNTIME_PREVIEWABLE_BINARY_MAX_BYTES) {
        throw new Error('file_too_large')
      }
      const buffer = await readFile(filePath)
      return {
        content: buffer.toString('base64'),
        isBinary: true,
        isImage: true,
        mimeType
      }
    }

    if (fileStats.size > MOBILE_FILE_READ_MAX_BYTES) {
      throw new Error('file_too_large')
    }
    const buffer = await readFile(filePath)
    if (isBinaryBuffer(buffer)) {
      return { content: '', isBinary: true }
    }
    return { content: buffer.toString('utf-8'), isBinary: false }
  }

  async readFileExplorerChunk(
    worktreeSelector: string,
    relativePath: string,
    offset: number,
    length: number
  ): Promise<RuntimeFileReadChunkResult> {
    const target = await this.resolveFileExplorerPath(worktreeSelector, relativePath)
    const provider = target.connectionId ? getSshFilesystemProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      const fileStat = await provider.stat(target.path)
      if (fileStat.type === 'directory') {
        throw new Error('Cannot download a directory')
      }
      throw new Error('SSH runtime chunked download is unavailable; use the SSH download path')
    }

    const filePath = await resolveAuthorizedPath(target.path, this.host.requireStore())
    const fileStats = await stat(filePath)
    if (fileStats.isDirectory()) {
      throw new Error('Cannot download a directory')
    }
    const handle = await open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(length, Math.max(0, fileStats.size - offset)))
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, offset)
      const chunk = buffer.subarray(0, bytesRead)
      return {
        contentBase64: chunk.toString('base64'),
        bytesRead,
        eof: offset + bytesRead >= fileStats.size
      }
    } finally {
      await handle.close()
    }
  }

  async writeFileExplorerFile(
    worktreeSelector: string,
    relativePath: string,
    content: string,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<{ ok: true }> {
    const target = await this.resolveFileExplorerPath(worktreeSelector, relativePath)
    assertRuntimeFileMutationExpectation(
      target.connectionId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    const provider = target.connectionId ? getSshFilesystemProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.writeFile(target.path, content)
      return { ok: true }
    }

    const filePath = await resolveAuthorizedPath(target.path, this.host.requireStore())
    try {
      const fileStats = await lstat(filePath)
      if (fileStats.isDirectory()) {
        throw new Error('Cannot write to a directory')
      }
    } catch (error) {
      if (!isENOENT(error)) {
        throw error
      }
    }
    await writeFile(filePath, content, 'utf-8')
    return { ok: true }
  }

  async writeFileExplorerFileBase64(
    worktreeSelector: string,
    relativePath: string,
    contentBase64: string,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<{ ok: true }> {
    const target = await this.resolveFileExplorerPath(worktreeSelector, relativePath)
    assertRuntimeFileMutationExpectation(
      target.connectionId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    const provider = target.connectionId ? getSshFilesystemProvider(target.connectionId) : null
    const content = Buffer.from(contentBase64, 'base64')
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.writeFileBase64(target.path, contentBase64)
      return { ok: true }
    }

    const filePath = await resolveAuthorizedPath(target.path, this.host.requireStore())
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, { flag: 'wx' })
    return { ok: true }
  }

  async writeFileExplorerFileBase64Chunk(
    worktreeSelector: string,
    relativePath: string,
    contentBase64: string,
    append: boolean,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<{ ok: true }> {
    const target = await this.resolveFileExplorerPath(worktreeSelector, relativePath)
    assertRuntimeFileMutationExpectation(
      target.connectionId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    const provider = target.connectionId ? getSshFilesystemProvider(target.connectionId) : null
    const content = Buffer.from(contentBase64, 'base64')
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.writeFileBase64Chunk(target.path, contentBase64, append)
      return { ok: true }
    }

    const filePath = await resolveAuthorizedPath(target.path, this.host.requireStore())
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, { flag: append ? 'a' : 'wx' })
    return { ok: true }
  }

  async createFileExplorerFile(
    worktreeSelector: string,
    relativePath: string,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<{ ok: true }> {
    const target = await this.resolveFileExplorerPath(worktreeSelector, relativePath)
    assertRuntimeFileMutationExpectation(
      target.connectionId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    const provider = target.connectionId ? getSshFilesystemProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.createFile(target.path)
      return { ok: true }
    }

    const filePath = await resolveAuthorizedPath(target.path, this.host.requireStore())
    await mkdir(dirname(filePath), { recursive: true })
    try {
      await writeFile(filePath, '', { encoding: 'utf-8', flag: 'wx' })
    } catch (error) {
      rethrowRuntimeFileCreateError(error, filePath)
    }
    return { ok: true }
  }

  async createFileExplorerDir(
    worktreeSelector: string,
    relativePath: string,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<{ ok: true }> {
    const target = await this.resolveFileExplorerPath(worktreeSelector, relativePath)
    assertRuntimeFileMutationExpectation(
      target.connectionId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    const provider = target.connectionId ? getSshFilesystemProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.createDir(target.path)
      return { ok: true }
    }

    const dirPath = await resolveAuthorizedPath(target.path, this.host.requireStore())
    await assertRuntimePathDoesNotExist(dirPath)
    await mkdir(dirPath, { recursive: false })
    return { ok: true }
  }

  async createFileExplorerDirNoClobber(
    worktreeSelector: string,
    relativePath: string,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<{ ok: true }> {
    const target = await this.resolveFileExplorerPath(worktreeSelector, relativePath)
    assertRuntimeFileMutationExpectation(
      target.connectionId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    const provider = target.connectionId ? getSshFilesystemProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.createDirNoClobber(target.path)
      return { ok: true }
    }

    const dirPath = await resolveAuthorizedPath(target.path, this.host.requireStore())
    await mkdir(dirPath, { recursive: false })
    return { ok: true }
  }

  async commitFileExplorerUpload(
    worktreeSelector: string,
    tempRelativePath: string,
    finalRelativePath: string,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<{ ok: true }> {
    const [tempTarget, finalTarget] = await this.resolveFileExplorerPaths(worktreeSelector, [
      tempRelativePath,
      finalRelativePath
    ])
    assertRuntimeFileMutationExpectation(
      tempTarget.connectionId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    const provider = tempTarget.connectionId
      ? getSshFilesystemProvider(tempTarget.connectionId)
      : null
    if (tempTarget.connectionId) {
      if (!provider) {
        throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.copy(tempTarget.path, finalTarget.path)
      await provider.deletePath(tempTarget.path, false).catch(() => {})
      return { ok: true }
    }

    const store = this.host.requireStore()
    const tempPath = await resolveAuthorizedPath(tempTarget.path, store)
    const finalPath = await resolveAuthorizedPath(finalTarget.path, store)
    await mkdir(dirname(finalPath), { recursive: true })
    await copyFile(tempPath, finalPath, constants.COPYFILE_EXCL)
    await rm(tempPath, { force: true })
    return { ok: true }
  }

  async renameFileExplorerPath(
    worktreeSelector: string,
    oldRelativePath: string,
    newRelativePath: string,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<{ ok: true }> {
    const [oldTarget, newTarget] = await this.resolveFileExplorerPaths(worktreeSelector, [
      oldRelativePath,
      newRelativePath
    ])
    assertRuntimeFileMutationExpectation(
      oldTarget.connectionId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    const provider = oldTarget.connectionId
      ? getSshFilesystemProvider(oldTarget.connectionId)
      : null
    if (oldTarget.connectionId) {
      if (!provider) {
        throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.renameNoClobber(oldTarget.path, newTarget.path)
      return { ok: true }
    }

    const store = this.host.requireStore()
    const oldPath = await resolveAuthorizedPath(oldTarget.path, store, { preserveSymlink: true })
    const newPath = await resolveAuthorizedPath(newTarget.path, store, { preserveSymlink: true })
    await renameLocalPathSerializedByDestination(oldPath, newPath)
    return { ok: true }
  }

  async copyFileExplorerPath(
    worktreeSelector: string,
    sourceRelativePath: string,
    destinationRelativePath: string,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<{ ok: true }> {
    const [sourceTarget, destinationTarget] = await this.resolveFileExplorerPaths(
      worktreeSelector,
      [sourceRelativePath, destinationRelativePath]
    )
    assertRuntimeFileMutationExpectation(
      sourceTarget.connectionId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    const provider = sourceTarget.connectionId
      ? getSshFilesystemProvider(sourceTarget.connectionId)
      : null
    if (sourceTarget.connectionId) {
      if (!provider) {
        throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.copy(sourceTarget.path, destinationTarget.path)
      return { ok: true }
    }

    const store = this.host.requireStore()
    const sourcePath = await resolveAuthorizedPath(sourceTarget.path, store, {
      preserveSymlink: true
    })
    const destinationPath = await resolveAuthorizedPath(destinationTarget.path, store, {
      preserveSymlink: true
    })
    await mkdir(dirname(destinationPath), { recursive: true })
    // Why: COPYFILE_EXCL preserves the no-clobber invariant of the local shell copy IPC (caller already deconflicts names).
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL)
    return { ok: true }
  }

  async deleteFileExplorerPath(
    worktreeSelector: string,
    relativePath: string,
    recursive?: boolean,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<{ ok: true }> {
    const target = await this.resolveFileExplorerPath(worktreeSelector, relativePath)
    assertRuntimeFileMutationExpectation(
      target.connectionId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    const provider = target.connectionId ? getSshFilesystemProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.deletePath(target.path, recursive)
      return { ok: true }
    }

    const targetPath = await resolveAuthorizedPath(target.path, this.host.requireStore(), {
      preserveSymlink: true
    })
    // Why: a non-local runtime has no client Trash; this delete is permanent, so the renderer confirms before calling.
    await rm(targetPath, { recursive: recursive === true, force: true })
    return { ok: true }
  }

  async searchRuntimeFiles(
    worktreeSelector: string,
    options: Omit<SearchOptions, 'rootPath'>
  ): Promise<SearchResult> {
    const target = await this.host.resolveRuntimeFileTarget(worktreeSelector)
    const provider = target.connectionId ? getSshFilesystemProvider(target.connectionId) : null
    const rootPath = target.worktree.path
    const searchOptions = { ...options, rootPath }
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      return provider.search(searchOptions)
    }
    return this.searchLocalRuntimeFiles(rootPath, searchOptions)
  }

  async listRuntimeFiles(
    worktreeSelector: string,
    options: { excludePaths?: string[] } = {}
  ): Promise<string[]> {
    const target = await this.host.resolveRuntimeFileTarget(worktreeSelector)
    const provider = target.connectionId ? getSshFilesystemProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        return []
      }
      return provider.listFiles(target.worktree.path, { excludePaths: options.excludePaths })
    }
    return listQuickOpenFiles(target.worktree.path, this.host.requireStore(), options.excludePaths)
  }

}

