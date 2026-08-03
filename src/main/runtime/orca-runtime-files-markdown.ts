import { stat, wslAwareSpawn, parseWslPath, toWindowsWslPath, resolveAuthorizedPath, searchWithGitGrep, getLocalGitOptionsForRegisteredWorktree, checkRgAvailable, listMarkdownDocuments, markdownDocumentsFromRelativePaths, buildRgArgs, createAccumulator, DEFAULT_SEARCH_MAX_RESULTS, finalize, ingestRgJsonLine, SEARCH_TIMEOUT_MS, getSshFilesystemProvider, SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE, _getRuntimeFileWatcherReleaseCountForTests, _resetRuntimeFileWatcherLeasesForTests, type ChildProcess, type MarkdownDocument, type SearchOptions, type SearchResult} from './orca-runtime-files-foundation'

import { RuntimeFileWatchCommands } from './orca-runtime-files-watch'

export class RuntimeFileMarkdownCommands extends RuntimeFileWatchCommands {
  async listRuntimeMarkdownDocuments(worktreeSelector: string): Promise<MarkdownDocument[]> {
    const target = await this.host.resolveRuntimeFileTarget(worktreeSelector)
    const provider = target.connectionId ? getSshFilesystemProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      const relativePaths = await provider.listFiles(target.worktree.path)
      return markdownDocumentsFromRelativePaths(target.worktree.path, relativePaths)
    }
    return listMarkdownDocuments(target.worktree.path)
  }

  async statRuntimeFile(
    worktreeSelector: string,
    relativePath: string
  ): Promise<{ size: number; isDirectory: boolean; mtime: number }> {
    const target = await this.resolveFileExplorerPath(worktreeSelector, relativePath)
    const provider = target.connectionId ? getSshFilesystemProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      const fileStat = await provider.stat(target.path)
      return {
        size: fileStat.size,
        isDirectory: fileStat.type === 'directory',
        mtime: fileStat.mtime
      }
    }
    const filePath = await resolveAuthorizedPath(target.path, this.host.requireStore())
    const stats = await stat(filePath)
    return { size: stats.size, isDirectory: stats.isDirectory(), mtime: stats.mtimeMs }
  }

  protected async searchLocalRuntimeFiles(
    rootPath: string,
    options: SearchOptions
  ): Promise<SearchResult> {
    const store = this.host.requireStore()
    const authorizedRootPath = await resolveAuthorizedPath(rootPath, store)
    const localGitOptions = getLocalGitOptionsForRegisteredWorktree(
      store,
      rootPath,
      authorizedRootPath
    )
    const maxResults = Math.max(
      1,
      Math.min(options.maxResults ?? DEFAULT_SEARCH_MAX_RESULTS, DEFAULT_SEARCH_MAX_RESULTS)
    )
    const rgAvailable = await checkRgAvailable(authorizedRootPath, localGitOptions.wslDistro)
    if (!rgAvailable) {
      return searchWithGitGrep(authorizedRootPath, options, maxResults, localGitOptions)
    }

    return new Promise((resolvePromise) => {
      const searchKey = `${this.host.getRuntimeId()}:${authorizedRootPath}`
      const rgArgs = buildRgArgs(options.query, authorizedRootPath, options)
      this.activeRuntimeTextSearches.get(searchKey)?.kill()

      const acc = createAccumulator()
      let stdoutBuffer = ''
      let resolved = false
      let child: ChildProcess | null = null
      const wslInfo = parseWslPath(authorizedRootPath)
      const transformAbsPath = wslInfo
        ? (p: string): string => toWindowsWslPath(p, wslInfo.distro)
        : undefined

      const resolveOnce = (): void => {
        if (resolved) {
          return
        }
        resolved = true
        if (this.activeRuntimeTextSearches.get(searchKey) === child) {
          this.activeRuntimeTextSearches.delete(searchKey)
        }
        cleanupListeners()
        resolvePromise(finalize(acc))
      }

      let killTimeout: ReturnType<typeof setTimeout> | null = null
      const cleanupListeners = (): void => {
        if (killTimeout) {
          clearTimeout(killTimeout)
          killTimeout = null
        }
        child?.stdout?.off('data', onStdoutData)
        child?.stderr?.off('data', onStderrData)
        child?.off('error', onError)
        child?.off('close', onClose)
      }

      const processLine = (line: string): void => {
        const verdict = ingestRgJsonLine(
          line,
          authorizedRootPath,
          acc,
          maxResults,
          transformAbsPath
        )
        if (verdict === 'stop') {
          child?.kill()
        }
      }

      const nextChild = wslAwareSpawn('rg', rgArgs, {
        cwd: authorizedRootPath,
        ...(localGitOptions.wslDistro ? { wslDistro: localGitOptions.wslDistro } : {}),
        stdio: ['ignore', 'pipe', 'pipe']
      })
      child = nextChild
      this.activeRuntimeTextSearches.set(searchKey, nextChild)

      nextChild.stdout!.setEncoding('utf-8')
      const onStdoutData = (chunk: string): void => {
        stdoutBuffer += chunk
        const lines = stdoutBuffer.split('\n')
        stdoutBuffer = lines.pop() ?? ''
        for (const line of lines) {
          processLine(line)
        }
      }
      const onStderrData = (): void => {
        // Drain stderr so rg cannot block on a full pipe.
      }
      const onError = (): void => resolveOnce()
      const onClose = (): void => {
        if (stdoutBuffer) {
          processLine(stdoutBuffer)
        }
        resolveOnce()
      }

      nextChild.stdout!.on('data', onStdoutData)
      nextChild.stderr!.on('data', onStderrData)
      nextChild.once('error', onError)
      nextChild.once('close', onClose)

      killTimeout = setTimeout(() => {
        acc.truncated = true
        child?.kill()
        resolveOnce()
      }, SEARCH_TIMEOUT_MS)
    })
  }

}
