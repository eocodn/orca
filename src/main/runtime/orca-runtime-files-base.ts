import { randomUUID, watchFs, chmod, constants, copyFile, lstat, mkdir, open, readFile, readdir, rename, realpath, rm, stat, writeFile, homedir, tmpdir, basename, dirname, extname, join, isPathInsideOrEqual, isRuntimePathAbsolute, isWindowsAbsolutePathLike, normalizeRuntimePathForComparison, relativePathInsideRoot, resolveRuntimePath, PhysicalExitTracker, closeFileExplorerWatcherInWatcherProcess, watchFileExplorerInWatcherProcess, wslAwareSpawn, parseWslPath, toWindowsWslPath, isENOENT, resolveAuthorizedPath, listQuickOpenFiles, searchWithGitGrep, getLocalGitOptionsForRegisteredWorktree, checkRgAvailable, listMarkdownDocuments, markdownDocumentsFromRelativePaths, buildRgArgs, createAccumulator, DEFAULT_SEARCH_MAX_RESULTS, finalize, ingestRgJsonLine, SEARCH_TIMEOUT_MS, getSshFilesystemProvider, onSshFilesystemProviderRegistered, SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE, isWatcherProcessFailure, WatcherProcessFailure, joinWorktreeRelativePath, normalizeRuntimeRelativePath, rankRuntimeMobileFilePaths, RuntimeMobileFilePathSearchCache, beginWatcherInstall, assertSshMutationExpectation, toSshExecutionHostId, renameLocalPathSerializedByDestination, MOBILE_FILE_LIST_LIMIT, MOBILE_FILE_PATH_SEARCH_CACHE_LIMIT, MOBILE_FILE_PATH_SEARCH_CACHE_ENTRIES, MOBILE_FILE_PATH_SEARCH_CACHE_TTL_MS, MOBILE_FILE_READ_MAX_BYTES, RUNTIME_PREVIEWABLE_BINARY_MAX_BYTES, WINDOWS_RUNTIME_FILE_WATCH_DEBOUNCE_MS, WINDOWS_RUNTIME_FILE_WATCH_CLOSE_DEADLINE_MS, TERMINAL_FILE_GRANT_TTL_MS, OPEN_NOFOLLOW, RUNTIME_FILE_MUTATION_UPDATE_REQUIRED, assertRuntimeFileMutationExpectation, pendingRuntimeFileWatcherUnsubscribes, runtimeFileWatcherLeasesByOwnerAndRoot, sshFileExplorerWatchRearms, MOBILE_BINARY_EXTENSIONS, MOBILE_PREVIEWABLE_IMAGE_EXTENSIONS, isMobilePreviewableImagePath, RUNTIME_PREVIEWABLE_BINARY_MIME_TYPES, trackRuntimeFileWatcherUnsubscribe, normalizeRuntimeWatcherRoot, runtimeWatcherReleaseKey, armSshFileExplorerWatchRearm, stopSshFileExplorerWatchRearms, registerRuntimeFileWatcherRelease, awaitRuntimeFileWatcherUnsubscribes, _getRuntimeFileWatcherReleaseCountForTests, _resetRuntimeFileWatcherLeasesForTests, type ChildProcess, type FileHandle, type DirEntry, type FsChangeEvent, type GitWorktreeInfo, type MarkdownDocument, type SearchOptions, type SearchResult, type Worktree, type RuntimeFileListResult, type RuntimeFileOpenResult, type RuntimeFileReadChunkResult, type RuntimeFilePreviewResult, type RuntimeFileReadResult, type RuntimeTerminalPathResolution, type Store, type FileStat, type IFilesystemProvider, type RuntimeFileWatcherLease, type RuntimeFileStatLike, type TerminalFileGrant, type ResolvedRuntimeFileWorktree, type ResolvedRuntimeFileTarget, type RuntimeFileCommandHost } from './orca-runtime-files-foundation'
import { watchWindowsRuntimeFileExplorer, isSafeMobileRelativePath, isMobileMarkdownPath, isMobileBinaryPath, basenameFromRelativePath, isRuntimeDirectoryEntry, isBinaryBuffer, assertRuntimePathDoesNotExist, rethrowRuntimeFileCreateError, readLocalMobileFile, readLocalTerminalArtifactFileFromHandle, readLocalTerminalArtifactPreviewFromHandle, assertLocalTerminalArtifactPathStillCanonical, openLocalTerminalArtifactGrant, resolveTerminalAbsolutePath, normalizeTerminalFileUriAuthorityPath, provenancePathCandidate, isLoopbackFileUriHostname, normalizeLeadingSlashDrivePath, resolveAllowedLocalTerminalArtifactPath, localTerminalArtifactRoots, canonicalPathForArtifactComparison, readFileHandleBufferBounded, terminalFileStatIdentity, assertTerminalFileGrantFresh, assertTerminalArtifactNotHardLinked, isTerminalArtifactHardLinked, truncateMobileFilePreview } from './orca-runtime-files-support'

export class RuntimeFileCommandsBase {
  protected activeRuntimeTextSearches = new Map<string, ChildProcess>()
  protected terminalFileGrants = new Map<string, TerminalFileGrant>()
  protected mobileFilePathSearchCache = new RuntimeMobileFilePathSearchCache(
    MOBILE_FILE_PATH_SEARCH_CACHE_ENTRIES,
    MOBILE_FILE_PATH_SEARCH_CACHE_TTL_MS
  )

  constructor(protected readonly host: RuntimeFileCommandHost) {}

  protected static isRemoteNotFoundErrorMessage(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /\bENOENT\b|no such file|not found|does not exist/i.test(message)
  }

  protected async statRemoteTerminalPath(
    absolutePath: string,
    connectionId: string
  ): Promise<RuntimeFileStatLike & { isDirectory: () => boolean }> {
    const provider = getSshFilesystemProvider(connectionId)
    if (!provider) {
      throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
    }
    const stats = await provider.stat(absolutePath)
    return { ...stats, isDirectory: () => stats.type === 'directory' }
  }

  protected async resolveAllowedTerminalArtifactPath(args: {
    absolutePath: string
    connectionId?: string
    worktreePath: string
  }): Promise<string | null> {
    if (args.connectionId) {
      return this.resolveAllowedRemoteTerminalArtifactPath(args.absolutePath, args.connectionId)
    }
    return resolveAllowedLocalTerminalArtifactPath(args.absolutePath, args.worktreePath)
  }

  protected async resolveAllowedRemoteTerminalArtifactPath(
    absolutePath: string,
    connectionId: string
  ): Promise<string | null> {
    const provider = getSshFilesystemProvider(connectionId)
    if (!provider) {
      throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
    }
    const roots = ['/tmp', '/protected/tmp']
    const providerTempDir = await provider.getTempDir?.().catch(() => null)
    if (providerTempDir) {
      roots.push(providerTempDir)
    }
    if (!roots.some((root) => isPathInsideOrEqual(root, absolutePath))) {
      return null
    }
    const [realArtifactPath, ...realRoots] = await Promise.all([
      provider.realpath(absolutePath),
      ...roots.map((root) => provider.realpath(root).catch(() => root))
    ])
    // Why: SSH I/O follows symlinks on the relay; grant the canonical target so a /tmp link can't escape the temp boundary.
    return realRoots.some((root) => isPathInsideOrEqual(root, realArtifactPath))
      ? realArtifactPath
      : null
  }

  protected async statLocalTerminalPath(
    absolutePath: string
  ): Promise<RuntimeFileStatLike & { isDirectory: () => boolean }> {
    await assertLocalTerminalArtifactPathStillCanonical(absolutePath)
    const handle = await open(absolutePath, 'r')
    try {
      return handle.stat()
    } finally {
      await handle.close()
    }
  }

  protected createTerminalFileGrant(args: {
    worktreeId: string
    absolutePath: string
    provider: 'local' | 'ssh'
    connectionId?: string
    clientId?: string
    stats: RuntimeFileStatLike
  }): TerminalFileGrant {
    assertTerminalArtifactNotHardLinked(args.stats)
    const grant: TerminalFileGrant = {
      id: randomUUID(),
      worktreeId: args.worktreeId,
      absolutePath: args.absolutePath,
      provider: args.provider,
      ...(args.connectionId ? { connectionId: args.connectionId } : {}),
      ...(args.clientId ? { clientId: args.clientId } : {}),
      expiresAt: Date.now() + TERMINAL_FILE_GRANT_TTL_MS,
      statIdentity: terminalFileStatIdentity(args.stats)
    }
    this.terminalFileGrants.set(grant.id, grant)
    this.scheduleTerminalFileGrantExpiry(grant)
    return grant
  }

  protected async requireTerminalFileGrant(
    worktreeSelector: string,
    grantId: string,
    absolutePath: string,
    clientId?: string
  ): Promise<{ grant: TerminalFileGrant; target: ResolvedRuntimeFileTarget }> {
    const target = await this.host.resolveRuntimeFileTarget(worktreeSelector)
    this.pruneExpiredTerminalFileGrants()
    const grant = this.terminalFileGrants.get(grantId)
    if (!grant) {
      throw new Error('terminal_file_grant_expired')
    }
    if (grant.expiresAt <= Date.now()) {
      this.releaseTerminalFileGrant(grantId, grant)
      throw new Error('terminal_file_grant_expired')
    }
    if (
      grant.worktreeId !== target.worktree.id ||
      grant.absolutePath !== absolutePath ||
      grant.connectionId !== target.connectionId ||
      grant.clientId !== clientId
    ) {
      throw new Error('terminal_file_grant_mismatch')
    }
    return { grant, target }
  }

  protected refreshTerminalFileGrant(grant: TerminalFileGrant): void {
    grant.expiresAt = Date.now() + TERMINAL_FILE_GRANT_TTL_MS
    this.scheduleTerminalFileGrantExpiry(grant)
  }

  protected pruneExpiredTerminalFileGrants(): void {
    const now = Date.now()
    for (const [id, grant] of this.terminalFileGrants) {
      if (grant.expiresAt <= now) {
        this.releaseTerminalFileGrant(id, grant)
      }
    }
  }

  revokeTerminalFileGrantsForClient(clientId: string): void {
    for (const [id, grant] of this.terminalFileGrants) {
      if (grant.clientId === clientId) {
        this.releaseTerminalFileGrant(id, grant)
      }
    }
  }

  protected releaseTerminalFileGrant(id: string, grant: TerminalFileGrant): void {
    this.terminalFileGrants.delete(id)
    if (grant.expiryTimer) {
      clearTimeout(grant.expiryTimer)
      grant.expiryTimer = undefined
    }
  }

  protected scheduleTerminalFileGrantExpiry(grant: TerminalFileGrant): void {
    if (grant.expiryTimer) {
      clearTimeout(grant.expiryTimer)
    }
    grant.expiryTimer = setTimeout(
      () => {
        if (this.terminalFileGrants.get(grant.id) === grant && grant.expiresAt <= Date.now()) {
          this.releaseTerminalFileGrant(grant.id, grant)
        }
      },
      Math.max(1, grant.expiresAt - Date.now())
    )
    grant.expiryTimer.unref?.()
  }

  async readTerminalArtifactFile(
    worktreeSelector: string,
    grantId: string,
    absolutePath: string,
    clientId?: string
  ): Promise<RuntimeFileReadResult> {
    const { grant, target } = await this.requireTerminalFileGrant(
      worktreeSelector,
      grantId,
      absolutePath,
      clientId
    )
    if (isMobileBinaryPath(grant.absolutePath)) {
      throw new Error('binary_file')
    }
    let content: string
    if (grant.connectionId) {
      const provider = await this.assertRemoteTerminalFileGrantFreshForRead(grant)
      content = await this.readRemoteTerminalArtifactFile(
        provider,
        grant,
        MOBILE_FILE_READ_MAX_BYTES
      )
    } else {
      const handle = await openLocalTerminalArtifactGrant(grant, constants.O_RDONLY)
      try {
        content = await readLocalTerminalArtifactFileFromHandle(handle, grant)
      } finally {
        await handle.close()
      }
    }
    this.refreshTerminalFileGrant(grant)
    const truncated = truncateMobileFilePreview(content)

    return {
      worktree: target.worktree.id,
      relativePath: grant.absolutePath,
      content: truncated.content,
      truncated: truncated.truncated,
      byteLength: truncated.byteLength
    }
  }

  async readTerminalArtifactPreview(
    worktreeSelector: string,
    grantId: string,
    absolutePath: string,
    clientId?: string
  ): Promise<RuntimeFilePreviewResult> {
    const { grant } = await this.requireTerminalFileGrant(
      worktreeSelector,
      grantId,
      absolutePath,
      clientId
    )
    if (grant.connectionId) {
      const provider = await this.assertRemoteTerminalFileGrantFreshForRead(grant)
      this.refreshTerminalFileGrant(grant)
      return this.readRemoteTerminalArtifactPreview(provider, grant)
    }
    const handle = await openLocalTerminalArtifactGrant(grant, constants.O_RDONLY)
    try {
      const preview = await readLocalTerminalArtifactPreviewFromHandle(handle, grant)
      this.refreshTerminalFileGrant(grant)
      return preview
    } finally {
      await handle.close()
    }
  }

  async writeTerminalArtifactFile(
    worktreeSelector: string,
    grantId: string,
    absolutePath: string,
    content: string,
    clientId?: string
  ): Promise<{ ok: true }> {
    if (Buffer.byteLength(content, 'utf8') > MOBILE_FILE_READ_MAX_BYTES) {
      throw new Error('file_too_large')
    }
    const { grant } = await this.requireTerminalFileGrant(
      worktreeSelector,
      grantId,
      absolutePath,
      clientId
    )
    if (isMobileBinaryPath(grant.absolutePath)) {
      throw new Error('binary_file')
    }
    if (grant.connectionId) {
      const { provider, fileStat } = await this.assertRemoteTerminalFileGrantFresh(grant)
      if (fileStat.type === 'directory') {
        throw new Error('Cannot write to a directory')
      }
      if (fileStat.size > MOBILE_FILE_READ_MAX_BYTES) {
        throw new Error('file_too_large')
      }
      if (!provider.writeTerminalArtifact) {
        throw new Error('terminal_file_grant_unavailable')
      }
      const nextStat = await provider.writeTerminalArtifact(
        grant.absolutePath,
        content,
        this.terminalArtifactAccessOptions(grant, MOBILE_FILE_READ_MAX_BYTES)
      )
      grant.statIdentity = terminalFileStatIdentity(nextStat)
      this.refreshTerminalFileGrant(grant)
      return { ok: true }
    }

    let originalMode: number | null = null
    const handle = await openLocalTerminalArtifactGrant(grant, constants.O_RDONLY)
    try {
      const fileStats = await handle.stat()
      originalMode = fileStats.mode
      if (fileStats.isDirectory()) {
        throw new Error('Cannot write to a directory')
      }
      if (fileStats.size > MOBILE_FILE_READ_MAX_BYTES) {
        throw new Error('file_too_large')
      }
      assertTerminalFileGrantFresh(grant, fileStats)
      if (
        isBinaryBuffer(await readFileHandleBufferBounded(handle, MOBILE_FILE_READ_MAX_BYTES + 1))
      ) {
        throw new Error('binary_file')
      }
    } finally {
      await handle.close()
    }
    const tempPath = join(
      dirname(grant.absolutePath),
      `.${basename(grant.absolutePath)}.${randomUUID()}.tmp`
    )
    try {
      await writeFile(tempPath, content, { encoding: 'utf-8', flag: 'wx' })
      if (typeof originalMode === 'number') {
        await chmod(tempPath, originalMode & 0o7777)
      }
      const freshHandle = await openLocalTerminalArtifactGrant(grant, constants.O_RDONLY)
      try {
        assertTerminalFileGrantFresh(grant, await freshHandle.stat())
      } finally {
        await freshHandle.close()
      }
      await rename(tempPath, grant.absolutePath)
      grant.statIdentity = terminalFileStatIdentity(
        await this.statLocalTerminalPath(grant.absolutePath)
      )
      this.refreshTerminalFileGrant(grant)
      return { ok: true }
    } finally {
      await rm(tempPath, { force: true }).catch(() => {})
    }
  }

  protected async readRemoteTerminalArtifactPreview(
    provider: IFilesystemProvider,
    grant: TerminalFileGrant
  ): Promise<RuntimeFilePreviewResult> {
    const preview = await this.readRemoteTerminalArtifact(
      provider,
      grant,
      RUNTIME_PREVIEWABLE_BINARY_MAX_BYTES
    )
    if (
      !preview.isBinary &&
      Buffer.byteLength(preview.content, 'utf8') > MOBILE_FILE_READ_MAX_BYTES
    ) {
      throw new Error('file_too_large')
    }
    return preview
  }

  protected async readRemoteTerminalArtifactFile(
    provider: IFilesystemProvider,
    grant: TerminalFileGrant,
    maxBytes: number
  ): Promise<string> {
    const result = await this.readRemoteTerminalArtifact(provider, grant, maxBytes)
    if (result.isBinary) {
      throw new Error('binary_file')
    }
    return result.content
  }

  protected async readRemoteTerminalArtifact(
    provider: IFilesystemProvider,
    grant: TerminalFileGrant,
    maxBytes: number
  ): Promise<RuntimeFilePreviewResult> {
    if (!provider.readTerminalArtifact) {
      throw new Error('terminal_file_grant_unavailable')
    }
    return provider.readTerminalArtifact(
      grant.absolutePath,
      this.terminalArtifactAccessOptions(grant, maxBytes)
    )
  }

  protected terminalArtifactAccessOptions(
    grant: TerminalFileGrant,
    maxBytes: number
  ): { expectedRealPath: string; expectedStatIdentity: string | null; maxBytes: number } {
    return {
      expectedRealPath: grant.absolutePath,
      expectedStatIdentity: grant.statIdentity,
      maxBytes
    }
  }

  protected async assertRemoteTerminalFileGrantFreshForRead(
    grant: TerminalFileGrant
  ): Promise<IFilesystemProvider> {
    const { provider } = await this.assertRemoteTerminalFileGrantFresh(grant)
    return provider
  }

  protected async assertRemoteTerminalFileGrantFresh(
    grant: TerminalFileGrant
  ): Promise<{ provider: IFilesystemProvider; fileStat: FileStat }> {
    const provider = await this.assertRemoteTerminalFileGrantPathStillCanonical(grant)
    const fileStat = await provider.stat(grant.absolutePath)
    assertTerminalFileGrantFresh(grant, fileStat)
    return { provider, fileStat }
  }

  protected async assertRemoteTerminalFileGrantPathStillCanonical(
    grant: TerminalFileGrant
  ): Promise<IFilesystemProvider> {
    if (!grant.connectionId) {
      throw new Error('terminal_file_grant_mismatch')
    }
    const provider = getSshFilesystemProvider(grant.connectionId)
    if (!provider) {
      throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
    }
    const allowedPath = await this.resolveAllowedRemoteTerminalArtifactPath(
      grant.absolutePath,
      grant.connectionId
    )
    // Why: relay I/O follows symlinks, so re-canonicalize a remote temp-artifact grant after the process can mutate it.
    if (allowedPath !== grant.absolutePath) {
      throw new Error('terminal_file_grant_stale')
    }
    return provider
  }

}

