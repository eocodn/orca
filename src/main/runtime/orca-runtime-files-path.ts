import {
  joinWorktreeRelativePath,
  normalizeRuntimeRelativePath,
  getSshFilesystemProvider,
  SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE,
  MOBILE_FILE_READ_MAX_BYTES
} from './orca-runtime-files-foundation'
import type { ResolvedRuntimeFileWorktree } from './orca-runtime-files-foundation'
import { RuntimeFileCommandsBase } from './orca-runtime-files-base'

export class RuntimeFilePathCommands extends RuntimeFileCommandsBase {
  protected async resolveFileExplorerPath(
    worktreeSelector: string,
    relativePath: string
  ): Promise<{ worktree: ResolvedRuntimeFileWorktree; path: string; connectionId?: string }> {
    const [target] = await this.resolveFileExplorerPaths(worktreeSelector, [relativePath])
    return target
  }

  protected async resolveFileExplorerPaths(
    worktreeSelector: string,
    relativePaths: readonly string[]
  ): Promise<{ worktree: ResolvedRuntimeFileWorktree; path: string; connectionId?: string }[]> {
    const target = await this.host.resolveRuntimeFileTarget(worktreeSelector)
    return relativePaths.map((relativePath) => ({
      worktree: target.worktree,
      path: joinWorktreeRelativePath(
        target.worktree.path,
        normalizeRuntimeRelativePath(relativePath)
      ),
      connectionId: target.connectionId
    }))
  }

  protected async listRemoteMobileFiles(
    rootPath: string,
    connectionId: string,
    maxResults?: number
  ): Promise<string[]> {
    const provider = getSshFilesystemProvider(connectionId)
    if (!provider) {
      return []
    }
    return provider.listFiles(rootPath, { maxResults })
  }

  protected async readRemoteMobileFile(filePath: string, connectionId: string): Promise<string> {
    const provider = getSshFilesystemProvider(connectionId)
    if (!provider) {
      throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
    }
    const fileStat = await provider.stat(filePath)
    if (fileStat.size > MOBILE_FILE_READ_MAX_BYTES) {
      throw new Error('file_too_large')
    }
    const result = await provider.readFile(filePath)
    if (result.isBinary) {
      throw new Error('binary_file')
    }
    return result.content
  }
}
