import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { watch as watchFs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import {
  chmod,
  constants,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  realpath,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import type {
  DirEntry,
  FsChangeEvent,
  GitWorktreeInfo,
  MarkdownDocument,
  SearchOptions,
  SearchResult,
  Worktree
} from '../../shared/types'
import {
  isPathInsideOrEqual,
  isRuntimePathAbsolute,
  isWindowsAbsolutePathLike,
  normalizeRuntimePathForComparison,
  relativePathInsideRoot,
  resolveRuntimePath
} from '../../shared/cross-platform-path'
import { PhysicalExitTracker } from '../../shared/physical-exit-tracker'
import type {
  RuntimeFileListResult,
  RuntimeFileOpenResult,
  RuntimeFileReadChunkResult,
  RuntimeFilePreviewResult,
  RuntimeFileReadResult,
  RuntimeTerminalPathResolution
} from '../../shared/runtime-types'
import {
  closeFileExplorerWatcherInWatcherProcess,
  watchFileExplorerInWatcherProcess
} from './file-watcher-host'
import { wslAwareSpawn } from '../git/runner'
import { parseWslPath, toWindowsWslPath } from '../wsl'
import { isENOENT, resolveAuthorizedPath } from '../ipc/filesystem-auth'
import { listQuickOpenFiles } from '../ipc/filesystem-list-files'
import { searchWithGitGrep } from '../ipc/filesystem-search-git'
import { getLocalGitOptionsForRegisteredWorktree } from '../ipc/local-worktree-runtime-options'
import { checkRgAvailable } from '../ipc/rg-availability'
import {
  listMarkdownDocuments,
  markdownDocumentsFromRelativePaths
} from '../ipc/markdown-documents'
import {
  buildRgArgs,
  createAccumulator,
  DEFAULT_SEARCH_MAX_RESULTS,
  finalize,
  ingestRgJsonLine,
  SEARCH_TIMEOUT_MS
} from '../../shared/text-search'
import type { Store } from '../persistence'
import {
  getSshFilesystemProvider,
  onSshFilesystemProviderRegistered,
  SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE
} from '../providers/ssh-filesystem-dispatch'
import type { FileStat, IFilesystemProvider } from '../providers/types'
import {
  isWatcherProcessFailure,
  WatcherProcessFailure
} from '../ipc/parcel-watcher-process-failure'
import { joinWorktreeRelativePath, normalizeRuntimeRelativePath } from './runtime-relative-paths'
import {
  rankRuntimeMobileFilePaths,
  RuntimeMobileFilePathSearchCache
} from './runtime-mobile-file-path-search'
import { beginWatcherInstall } from '../ipc/watcher-removal-gate'
import { assertSshMutationExpectation } from '../ssh/ssh-connection-generation'
import { toSshExecutionHostId } from '../../shared/execution-host'
import { renameLocalPathSerializedByDestination } from '../destination-serialized-local-rename'

export * from './orca-runtime-file-watcher-state'

export type ResolvedRuntimeFileWorktree = Worktree & { git: GitWorktreeInfo }
export type ResolvedRuntimeFileTarget = {
  worktree: ResolvedRuntimeFileWorktree
  connectionId?: string
}

export type RuntimeFileCommandHost = {
  getRuntimeId(): string
  requireStore(): Store
  resolveWorktreeSelector(selector: string): Promise<ResolvedRuntimeFileWorktree>
  resolveRuntimeFileTarget(selector: string): Promise<ResolvedRuntimeFileTarget>
  resolveTerminalCwd?(terminalHandle: string): string | null | Promise<string | null>
  resolveTerminalContext?(
    terminalHandle: string
  ): { worktreeId: string; connectionId: string | null } | null
  resolveTerminalFileUriHostname?(terminalHandle: string): string | null | Promise<string | null>
  hasRecentTerminalOutputPath?(
    terminalHandle: string,
    pathText: string,
    absolutePath: string
  ): boolean | Promise<boolean>
  resolveRuntimeGitTarget(
    selector: string
  ): Promise<{ worktree: ResolvedRuntimeFileWorktree; connectionId?: string }>
  openFile(
    worktreeId: string,
    filePath: string,
    relativePath: string,
    runtimeEnvironmentId?: string | null
  ): void
  openDiff(
    worktreeId: string,
    filePath: string,
    relativePath: string,
    staged: boolean,
    runtimeEnvironmentId?: string | null
  ): void
}

export type { ChildProcess } from 'node:child_process'
export { randomUUID } from 'node:crypto'
export { watch as watchFs } from 'node:fs'
export type { FileHandle } from 'node:fs/promises'
export {
  chmod,
  constants,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  realpath,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
export { homedir, tmpdir } from 'node:os'
export { basename, dirname, extname, join } from 'node:path'
export type {
  DirEntry,
  FsChangeEvent,
  GitWorktreeInfo,
  MarkdownDocument,
  SearchOptions,
  SearchResult,
  Worktree
} from '../../shared/types'
export {
  isPathInsideOrEqual,
  isRuntimePathAbsolute,
  isWindowsAbsolutePathLike,
  normalizeRuntimePathForComparison,
  relativePathInsideRoot,
  resolveRuntimePath
} from '../../shared/cross-platform-path'
export { PhysicalExitTracker } from '../../shared/physical-exit-tracker'
export type {
  RuntimeFileListResult,
  RuntimeFileOpenResult,
  RuntimeFileReadChunkResult,
  RuntimeFilePreviewResult,
  RuntimeFileReadResult,
  RuntimeTerminalPathResolution
} from '../../shared/runtime-types'
export {
  closeFileExplorerWatcherInWatcherProcess,
  watchFileExplorerInWatcherProcess
} from './file-watcher-host'
export { wslAwareSpawn } from '../git/runner'
export { parseWslPath, toWindowsWslPath } from '../wsl'
export { isENOENT, resolveAuthorizedPath } from '../ipc/filesystem-auth'
export { listQuickOpenFiles } from '../ipc/filesystem-list-files'
export { searchWithGitGrep } from '../ipc/filesystem-search-git'
export { getLocalGitOptionsForRegisteredWorktree } from '../ipc/local-worktree-runtime-options'
export { checkRgAvailable } from '../ipc/rg-availability'
export {
  listMarkdownDocuments,
  markdownDocumentsFromRelativePaths
} from '../ipc/markdown-documents'
export {
  buildRgArgs,
  createAccumulator,
  DEFAULT_SEARCH_MAX_RESULTS,
  finalize,
  ingestRgJsonLine,
  SEARCH_TIMEOUT_MS
} from '../../shared/text-search'
export type { Store } from '../persistence'
export {
  getSshFilesystemProvider,
  onSshFilesystemProviderRegistered,
  SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE
} from '../providers/ssh-filesystem-dispatch'
export type { FileStat, IFilesystemProvider } from '../providers/types'
export {
  isWatcherProcessFailure,
  WatcherProcessFailure
} from '../ipc/parcel-watcher-process-failure'
export { joinWorktreeRelativePath, normalizeRuntimeRelativePath } from './runtime-relative-paths'
export {
  rankRuntimeMobileFilePaths,
  RuntimeMobileFilePathSearchCache
} from './runtime-mobile-file-path-search'
export { beginWatcherInstall } from '../ipc/watcher-removal-gate'
export { assertSshMutationExpectation } from '../ssh/ssh-connection-generation'
export { toSshExecutionHostId } from '../../shared/execution-host'
export { renameLocalPathSerializedByDestination } from '../destination-serialized-local-rename'
