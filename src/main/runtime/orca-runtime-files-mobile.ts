import { stat, homedir, relativePathInsideRoot, resolveRuntimePath, isENOENT, resolveAuthorizedPath, listQuickOpenFiles, joinWorktreeRelativePath, rankRuntimeMobileFilePaths, MOBILE_FILE_LIST_LIMIT, MOBILE_FILE_PATH_SEARCH_CACHE_LIMIT, isMobilePreviewableImagePath, _getRuntimeFileWatcherReleaseCountForTests, _resetRuntimeFileWatcherLeasesForTests, type RuntimeFileListResult, type RuntimeFileOpenResult, type RuntimeFileReadResult, type RuntimeTerminalPathResolution} from './orca-runtime-files-foundation'
import { isSafeMobileRelativePath, isMobileMarkdownPath, isMobileBinaryPath, basenameFromRelativePath, readLocalMobileFile, resolveTerminalAbsolutePath, provenancePathCandidate, isTerminalArtifactHardLinked, truncateMobileFilePreview } from './orca-runtime-files-support'

import { RuntimeFilePathCommands } from './orca-runtime-files-path'
import { RuntimeFileCommandsBase } from './orca-runtime-files-base'

export class RuntimeFileMobileCommands extends RuntimeFilePathCommands {
  async listMobileFiles(worktreeSelector: string): Promise<RuntimeFileListResult> {
    const store = this.host.requireStore()
    const target = await this.host.resolveRuntimeFileTarget(worktreeSelector)
    const { worktree, connectionId } = target
    const files = connectionId
      ? await this.listRemoteMobileFiles(worktree.path, connectionId)
      : await listQuickOpenFiles(worktree.path, store)
    const entries = files
      .filter((relativePath) => isSafeMobileRelativePath(relativePath))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MOBILE_FILE_LIST_LIMIT)
      .map((relativePath) => ({
        relativePath,
        basename: basenameFromRelativePath(relativePath),
        kind: isMobileBinaryPath(relativePath) ? ('binary' as const) : ('text' as const)
      }))

    return {
      worktree: worktree.id,
      rootPath: worktree.path,
      files: entries,
      totalCount: files.length,
      truncated: files.length > MOBILE_FILE_LIST_LIMIT
    }
  }

  async searchMobileFilePaths(
    worktreeSelector: string,
    query: string,
    limit: number
  ): Promise<RuntimeFileListResult> {
    const store = this.host.requireStore()
    const target = await this.host.resolveRuntimeFileTarget(worktreeSelector)
    const { worktree, connectionId } = target
    const cacheKey = `${connectionId ?? 'local'}:${worktree.id}:${worktree.path}`
    const inventory = await this.mobileFilePathSearchCache.get(cacheKey, async () => {
      const listed = connectionId
        ? await this.listRemoteMobileFiles(
            worktree.path,
            connectionId,
            MOBILE_FILE_PATH_SEARCH_CACHE_LIMIT + 1
          )
        : await listQuickOpenFiles(
            worktree.path,
            store,
            undefined,
            undefined,
            MOBILE_FILE_PATH_SEARCH_CACHE_LIMIT + 1
          )
      const safePaths = listed
        .filter((relativePath) => isSafeMobileRelativePath(relativePath))
        .sort((a, b) => a.localeCompare(b))
      return {
        paths: safePaths.slice(0, MOBILE_FILE_PATH_SEARCH_CACHE_LIMIT),
        totalCount: safePaths.length,
        truncated: safePaths.length > MOBILE_FILE_PATH_SEARCH_CACHE_LIMIT
      }
    })
    const matches = rankRuntimeMobileFilePaths(inventory.paths, query, limit)
    return {
      worktree: worktree.id,
      rootPath: worktree.path,
      files: matches.paths.map((relativePath) => ({
        relativePath,
        basename: basenameFromRelativePath(relativePath),
        kind: isMobileBinaryPath(relativePath) ? ('binary' as const) : ('text' as const)
      })),
      totalCount: matches.totalCount,
      truncated: inventory.truncated || matches.totalCount > limit
    }
  }

  async openMobileFile(
    worktreeSelector: string,
    relativePath: string
  ): Promise<RuntimeFileOpenResult> {
    const { worktree, connectionId } = await this.host.resolveRuntimeFileTarget(worktreeSelector)
    if (!isSafeMobileRelativePath(relativePath)) {
      throw new Error('invalid_relative_path')
    }
    // Previewable images open like text (mobile renders via files.readPreview); other binaries stay unavailable on mobile.
    const kind = isMobilePreviewableImagePath(relativePath)
      ? 'image'
      : isMobileBinaryPath(relativePath)
        ? 'binary'
        : isMobileMarkdownPath(relativePath)
          ? 'markdown'
          : 'text'
    if (kind === 'binary') {
      return { worktree: worktree.id, relativePath, kind, opened: false }
    }
    const filePath = joinWorktreeRelativePath(worktree.path, relativePath)
    // Why: CLI/agents treat opened:true as success; stat first so missing paths fail the RPC instead of opening a ghost tab.
    await this.assertMobileOpenTargetExists(filePath, connectionId)
    // Why: the internal runtimeId isn't a valid env selector; pass undefined so openFile falls back to activeRuntimeEnvironmentId.
    this.host.openFile(worktree.id, filePath, relativePath, undefined)
    return { worktree: worktree.id, relativePath, kind, opened: true }
  }

  protected async assertMobileOpenTargetExists(
    filePath: string,
    connectionId?: string
  ): Promise<void> {
    try {
      await (connectionId
        ? this.statRemoteTerminalPath(filePath, connectionId)
        : stat(await resolveAuthorizedPath(filePath, this.host.requireStore())))
    } catch (error) {
      if (
        isENOENT(error) ||
        (connectionId && RuntimeFileCommandsBase.isRemoteNotFoundErrorMessage(error))
      ) {
        throw new Error(`ENOENT: no such file or directory, open '${filePath}'`)
      }
      throw error
    }
  }

  async openMobileDiff(
    worktreeSelector: string,
    relativePath: string,
    staged: boolean
  ): Promise<RuntimeFileOpenResult> {
    const { worktree } = await this.host.resolveRuntimeFileTarget(worktreeSelector)
    if (!isSafeMobileRelativePath(relativePath)) {
      throw new Error('invalid_relative_path')
    }
    const kind = isMobileBinaryPath(relativePath)
      ? 'binary'
      : isMobileMarkdownPath(relativePath)
        ? 'markdown'
        : 'text'
    const filePath = joinWorktreeRelativePath(worktree.path, relativePath)
    // Why: see openMobileFile; avoid stamping internal runtimeId as runtimeEnvironmentId.
    this.host.openDiff(worktree.id, filePath, relativePath, staged, undefined)
    return { worktree: worktree.id, relativePath, kind, opened: true }
  }

  async readMobileFile(
    worktreeSelector: string,
    relativePath: string
  ): Promise<RuntimeFileReadResult> {
    const store = this.host.requireStore()
    const target = await this.host.resolveRuntimeFileTarget(worktreeSelector)
    const { worktree, connectionId } = target
    if (!isSafeMobileRelativePath(relativePath)) {
      throw new Error('invalid_relative_path')
    }
    if (isMobileBinaryPath(relativePath)) {
      throw new Error('binary_file')
    }

    const filePath = joinWorktreeRelativePath(worktree.path, relativePath)
    const content = connectionId
      ? await this.readRemoteMobileFile(filePath, connectionId)
      : await readLocalMobileFile(filePath, store)
    const truncated = truncateMobileFilePreview(content)

    return {
      worktree: worktree.id,
      relativePath,
      content: truncated.content,
      truncated: truncated.truncated,
      byteLength: truncated.byteLength
    }
  }

  // Resolves a mobile terminal tap to a worktree-relative path; relatives resolve against cwd, else the worktree root.
  async resolveTerminalPath(
    worktreeSelector: string,
    pathText: string,
    cwd?: string | null,
    clientId?: string,
    terminalHandle?: string | null
  ): Promise<RuntimeTerminalPathResolution> {
    const store = this.host.requireStore()
    const target = await this.host.resolveRuntimeFileTarget(worktreeSelector)
    const { worktree, connectionId } = target
    // Why: mobile may attach after OSC7 cwd was emitted; the runtime still owns the terminal's latest cwd to resolve the tap.
    const normalizedTerminalHandle =
      terminalHandle && terminalHandle.trim().length > 0 ? terminalHandle.trim() : null
    const terminalCwd = normalizedTerminalHandle
      ? await this.host.resolveTerminalCwd?.(normalizedTerminalHandle)
      : null
    const terminalFileUriHostname = normalizedTerminalHandle
      ? await this.host.resolveTerminalFileUriHostname?.(normalizedTerminalHandle)
      : null
    const base = terminalCwd || (cwd && cwd.trim().length > 0 ? cwd : worktree.path)

    const empty: RuntimeTerminalPathResolution = {
      worktree: worktree.id,
      relativePath: null,
      absolutePath: null,
      exists: false,
      isDirectory: false
    }

    // Why: remote home is unknown (only local os.homedir), so a tapped ~/… on a remote worktree is not-openable, not guessed.
    const isTilde = pathText.startsWith('~/') || pathText.startsWith('~\\')
    if (isTilde && connectionId) {
      return empty
    }
    const expanded = isTilde ? resolveRuntimePath(homedir(), pathText.slice(2)) : pathText
    const absolutePath = resolveTerminalAbsolutePath({
      base,
      expanded,
      worktreePath: worktree.path,
      connectionId,
      terminalFileUriHostname
    })
    const relativePath = relativePathInsideRoot(worktree.path, absolutePath)

    try {
      if (relativePath !== null && relativePath !== '' && isSafeMobileRelativePath(relativePath)) {
        const stats = connectionId
          ? await this.statRemoteTerminalPath(absolutePath, connectionId)
          : await stat(await resolveAuthorizedPath(absolutePath, store))
        return {
          worktree: worktree.id,
          relativePath,
          absolutePath,
          exists: true,
          isDirectory: stats.isDirectory(),
          openTarget: stats.isDirectory()
            ? undefined
            : {
                kind: 'worktree-file',
                provider: connectionId ? 'ssh' : 'local',
                relativePath,
                absolutePath
              }
        }
      }

      // Why: mobile taps may hit agent artifacts outside the worktree; grant the exact path, not arbitrary absolute paths.
      if (!normalizedTerminalHandle || !terminalCwd) {
        return { ...empty, relativePath, absolutePath }
      }
      const terminalContext = this.host.resolveTerminalContext?.(normalizedTerminalHandle)
      if (
        !terminalContext ||
        terminalContext.worktreeId !== worktree.id ||
        (terminalContext.connectionId ?? undefined) !== connectionId
      ) {
        return { ...empty, relativePath, absolutePath }
      }
      const artifactPath = await this.resolveAllowedTerminalArtifactPath({
        absolutePath,
        connectionId,
        worktreePath: worktree.path
      })
      if (!artifactPath) {
        return { ...empty, relativePath, absolutePath }
      }
      if (
        !(await this.host.hasRecentTerminalOutputPath?.(
          normalizedTerminalHandle,
          provenancePathCandidate(pathText, absolutePath),
          artifactPath
        ))
      ) {
        return { ...empty, relativePath, absolutePath }
      }
      const stats = connectionId
        ? await this.statRemoteTerminalPath(artifactPath, connectionId)
        : await this.statLocalTerminalPath(artifactPath)
      const isDirectory = stats.isDirectory()
      if (!isDirectory && isTerminalArtifactHardLinked(stats)) {
        return { ...empty, relativePath, absolutePath }
      }
      const grant = isDirectory
        ? null
        : this.createTerminalFileGrant({
            worktreeId: worktree.id,
            absolutePath: artifactPath,
            provider: connectionId ? 'ssh' : 'local',
            connectionId,
            clientId,
            stats
          })
      return {
        worktree: worktree.id,
        relativePath: null,
        absolutePath: artifactPath,
        exists: true,
        isDirectory,
        openTarget: grant
          ? {
              kind: 'absolute-file',
              provider: grant.provider,
              absolutePath: artifactPath,
              grantId: grant.id
            }
          : undefined
      }
    } catch (error) {
      // Report genuine not-found as missing; let transport/permission errors surface so remote taps aren't all reported missing.
      if (
        isENOENT(error) ||
        (connectionId && RuntimeFileCommandsBase.isRemoteNotFoundErrorMessage(error))
      ) {
        return { ...empty, relativePath, absolutePath }
      }
      throw error
    }
  }

  // The mux drops ErrnoException.code, so match not-found by message shape (vs transport/permission/provider errors).
}
