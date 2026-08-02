// Filesystem, search, and source-control IPC handlers.
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readdir, readFile, writeFile, stat, lstat, open, rename, rm } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, extname, join, resolve } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { gitExecFileAsync, wslAwareSpawn } from '../git/runner'
import { parseWslPath, toWindowsWslPath } from '../wsl'
import { tryDeleteWslUncPath } from '../wsl-unc-delete'
import type { Store } from '../persistence'
import type {
  DirEntry,
  GitBranchCompareResult,
  GitCommitCompareResult,
  GitConflictOperation,
  GitDiffResult,
  GitForkSyncExpectedUpstream,
  GitForkSyncResult,
  GlobalSettings,
  GitStagingArea,
  GitPushTarget,
  GitUpstreamStatus,
  GitStatusResult,
  MarkdownDocument,
  SearchOptions,
  SearchResult,
  Repo,
  TuiAgent
} from '../../shared/types'
import type { GitHistoryOptions, GitHistoryResult } from '../../shared/git-history'
import type { SshMutationExpectation } from '../../shared/ssh-types'
import { assertSshMutationExpectation } from '../ssh/ssh-connection-generation'
import {
  buildRgArgs,
  createAccumulator,
  DEFAULT_SEARCH_MAX_RESULTS,
  finalize,
  ingestRgJsonLine,
  SEARCH_TIMEOUT_MS
} from '../../shared/text-search'
import {
  getStatus,
  getSubmoduleStatus,
  abortMerge,
  abortRebase,
  detectConflictOperation,
  getDiff,
  commitChanges,
  stageFile,
  unstageFile,
  bulkStageFiles,
  bulkUnstageFiles,
  bulkDiscardChanges,
  discardChanges,
  getStagedCommitContext,
  getBranchCompare,
  getBranchDiff,
  getCommitCompare,
  getCommitDiff
} from '../git/status'
import { getHistory } from '../git/history'
import {
  cancelGenerateCommitMessageLocal,
  cancelGeneratePullRequestFieldsLocal,
  discoverCommitMessageModelsLocal,
  discoverCommitMessageModelsRemote,
  generateCommitMessageFromContext,
  generatePullRequestFieldsFromContext,
  resolveCommitMessageSettings,
  type DiscoverCommitMessageModelsResult,
  type CommitMessageGenerationTarget,
  type GenerateCommitMessageResult,
  type GeneratePullRequestFieldsResult
} from '../text-generation/commit-message-text-generation'
import { getPullRequestDraftContext } from '../text-generation/pull-request-context'
import { getUpstreamStatus } from '../git/upstream'
import { gitFastForward, gitFetch, gitPull, gitPullRebaseFromBase, gitPush } from '../git/remote'
import { gitSyncForkDefaultBranch } from '../git/fork-sync'
import { validateGitForkSyncExpectedUpstream } from '../../shared/git-fork-sync'
import { checkIgnoredPaths } from '../git/check-ignored-paths'
import {
  appendFolderToGitignore,
  findKnownHugeFolderPathsToIgnore
} from '../git/huge-folder-ignore'
import { assertGitPushTargetShape } from '../../shared/git-push-target-validation'
import { getCommitMessageModelDiscoveryHostKey } from '../../shared/commit-message-host-key'
import type { HostedReviewProvider } from '../../shared/hosted-review'
import type { ResolvedSourceControlAiGenerationParams } from '../../shared/source-control-ai'
import { withLinkedIssueDraftContext } from '../../shared/source-control-ai-action-variables'
import { validateGitPushTarget } from '../git/push-target-validation'
import { getRemoteCommitUrl, getRemoteFileUrl } from '../git/repo'
import {
  resolveAuthorizedPath,
  resolveRegisteredWorktreePath,
  validateGitRelativeFilePath,
  isENOENT,
  authorizeExternalPath
} from './filesystem-auth'
import { listQuickOpenFiles } from './filesystem-list-files'
import { registerFilesystemMutationHandlers } from './filesystem-mutations'
import { searchWithGitGrep } from './filesystem-search-git'
import {
  getLocalGitOptionsForRegisteredWorktree,
  getLocalGitOptionsForRepo,
  getLocalRepoForRegisteredWorktree
} from './local-worktree-runtime-options'
import { resolveSourceControlAiLinkedIssue } from './source-control-ai-linked-issue'
import { listMarkdownDocuments, markdownDocumentsFromRelativePaths } from './markdown-documents'
import { checkRgAvailable } from './rg-availability'
import {
  getSshFilesystemProvider,
  requireSshFilesystemProvider
} from '../providers/ssh-filesystem-dispatch'
import {
  getSshGitProvider,
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE
} from '../providers/ssh-git-dispatch'
import { resolveHostedReviewBodyForGeneration } from '../source-control/pull-request-template'
import {
  prepareLocalCommitMessageAgentEnv,
  type CommitMessageAgentRuntimeTarget,
  type CommitMessageAgentEnvironmentResolvers
} from '../text-generation/commit-message-agent-environment'
import { listRepoWorktrees } from '../repo-worktrees'
import { recordCrashBreadcrumb } from '../crash-reporting/crash-breadcrumb-store'
import { buildReadDirErrorBreadcrumb, type ReadDirThrowSite } from './readdir-error-diagnostics'
import { splitWorktreeId } from '../../shared/worktree-id'
import { getRuntimePathBasename } from '../../shared/cross-platform-path'
import type { LocalProjectWorktreeGitOptions } from '../project-runtime-git-options'
import { registerLocalLogTailHandlers } from './local-log-tail'
import { localLogFileIdentity } from '../ai-vault/local-log-tail-reader'
import { sanitizeLocalDownloadFilename } from '../local-download-filename'
import { registerFilesystemDownloadFolderHandlers } from './filesystem-download-folder'
import { getWorktreeSharedLinkPaths } from '../git/worktree-shared-directories'
import { createSenderScopedRequestCancellations } from './sender-scoped-request-cancellation'

// Why: Monaco degrades features on large files like VS Code, so a 5MB block would needlessly lock out ordinary JSON/log files.
export const MAX_TEXT_FILE_SIZE = 50 * 1024 * 1024 // 50MB
export const BINARY_PROBE_BYTES = 8192
export const FULL_GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/
// Why: previewable binaries are base64 blobs (not parsed as text), and local IPC has no frame limit (unlike the relay's 10MB), so 50MB is safe.
export const MAX_PREVIEWABLE_BINARY_SIZE = 50 * 1024 * 1024 // 50MB
export const PREVIEWABLE_BINARY_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf'
}
export async function readLocalLogSnapshot(filePath: string): Promise<{
  content: string
  isBinary: boolean
  fileIdentity?: string
}> {
  const handle = await open(filePath, 'r')
  try {
    const stats = await handle.stat()
    if (stats.size > MAX_TEXT_FILE_SIZE) {
      throw new Error(
        `File too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_TEXT_FILE_SIZE / 1024 / 1024}MB limit`
      )
    }
    const buffer = await handle.readFile()
    if (buffer.byteLength > MAX_TEXT_FILE_SIZE) {
      throw new Error(
        `File too large: ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_TEXT_FILE_SIZE / 1024 / 1024}MB limit`
      )
    }
    if (isBinaryBuffer(buffer)) {
      return { content: '', isBinary: true }
    }
    return {
      content: buffer.toString('utf8'),
      isBinary: false,
      fileIdentity: localLogFileIdentity(stats)
    }
  } finally {
    await handle.close()
  }
}

export type DownloadFileResult = { canceled: true } | { canceled: false; destinationPath: string }

export function validateRequiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required`)
  }
  return value
}

export function decodeDownloadedFileContent(content: string, encoding: 'utf8' | 'base64'): Buffer {
  if (encoding === 'base64') {
    return Buffer.from(content, 'base64')
  }
  return Buffer.from(content, 'utf8')
}

export type DownloadSession = {
  destinationPath: string
  tempPath: string
  destinationExisted: boolean
  handle: FileHandle
  cleanupTimer: ReturnType<typeof setTimeout>
  senderId: number
}

export const DOWNLOAD_SESSION_TTL_MS = 30 * 60 * 1000

export function createSiblingTransferPath(destinationPath: string, suffix: string): string {
  // Why: promotion renames must stay on the destination volume, so transfer paths remain siblings.
  return join(dirname(destinationPath), `.${randomUUID()}.${suffix}`)
}

export async function cleanupLocalTransferPath(filePath: string | null): Promise<void> {
  if (!filePath) {
    return
  }
  await rm(filePath, { force: true }).catch(() => {})
}

export async function inspectDownloadDestination(destinationPath: string): Promise<{ existed: boolean }> {
  try {
    const destinationStat = await stat(destinationPath)
    if (destinationStat.isDirectory()) {
      throw new Error('Cannot download to a directory')
    }
    return { existed: true }
  } catch (error) {
    if (isENOENT(error)) {
      return { existed: false }
    }
    throw error
  }
}

export async function assertDestinationStillUnclaimed(destinationPath: string): Promise<void> {
  try {
    await stat(destinationPath)
  } catch (error) {
    if (isENOENT(error)) {
      return
    }
    throw error
  }
  throw new Error('Destination file appeared before download completed')
}

export async function promoteDownloadedFile(
  tempPath: string,
  destinationPath: string,
  destinationExisted: boolean
): Promise<void> {
  if (!destinationExisted) {
    await assertDestinationStillUnclaimed(destinationPath)
    await rename(tempPath, destinationPath)
    return
  }

  const backupPath = createSiblingTransferPath(destinationPath, 'backup')
  let backupCreated = false
  try {
    await rename(destinationPath, backupPath)
    backupCreated = true
    await rename(tempPath, destinationPath)
    await cleanupLocalTransferPath(backupPath)
  } catch (error) {
    if (backupCreated) {
      await rename(backupPath, destinationPath).catch(() => {})
    }
    throw error
  }
}

export function comparableLocalPath(value: string): string {
  const normalized = resolve(value)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function getCandidateLocalWorktreePaths(
  worktreePath: string,
  resolvedWorktreePath: string
): Set<string> {
  return new Set([worktreePath, resolvedWorktreePath].map(comparableLocalPath))
}

export function hasRegisteredWorktreeMetaForRepo(
  store: Store,
  repoId: string,
  candidatePaths: Set<string>
): boolean {
  for (const worktreeId of Object.keys(store.getAllWorktreeMeta())) {
    const parsed = splitWorktreeId(worktreeId)
    if (parsed?.repoId === repoId && candidatePaths.has(comparableLocalPath(parsed.worktreePath))) {
      return true
    }
  }
  return false
}

export function comparableRemotePath(value: string): string {
  return value.replace(/[/\\]+$/g, '')
}

export function hasRegisteredRemoteWorktreeMetaForRepo(
  store: Store,
  repoId: string,
  worktreePath: string
): boolean {
  const comparableWorktreePath = comparableRemotePath(worktreePath)
  for (const worktreeId of Object.keys(store.getAllWorktreeMeta())) {
    const parsed = splitWorktreeId(worktreeId)
    if (
      parsed?.repoId === repoId &&
      comparableRemotePath(parsed.worktreePath) === comparableWorktreePath
    ) {
      return true
    }
  }
  return false
}

export async function localRepoOwnsWorktree(
  store: Store,
  repo: Repo,
  worktreePath: string
): Promise<boolean> {
  let resolvedWorktreePath: string
  try {
    resolvedWorktreePath = await resolveRegisteredWorktreePath(worktreePath, store)
  } catch {
    return false
  }
  const candidatePaths = getCandidateLocalWorktreePaths(worktreePath, resolvedWorktreePath)
  if (candidatePaths.has(comparableLocalPath(repo.path))) {
    return true
  }
  if (hasRegisteredWorktreeMetaForRepo(store, repo.id, candidatePaths)) {
    return true
  }
  try {
    const worktrees = await listRepoWorktrees(repo)
    return worktrees.some((worktree) => candidatePaths.has(comparableLocalPath(worktree.path)))
  } catch {
    return false
  }
}

export async function remoteRepoOwnsWorktree(
  store: Store,
  repo: Repo,
  worktreePath: string,
  connectionId: string
): Promise<boolean> {
  const comparableWorktreePath = comparableRemotePath(worktreePath)
  if (comparableRemotePath(repo.path) === comparableWorktreePath) {
    return true
  }
  const provider = getSshGitProvider(connectionId)
  if (!provider) {
    return hasRegisteredRemoteWorktreeMetaForRepo(store, repo.id, worktreePath)
  }
  try {
    const worktrees = await provider.listWorktrees(repo.path)
    return worktrees.some(
      (worktree) => comparableRemotePath(worktree.path) === comparableWorktreePath
    )
  } catch {
    return false
  }
}

export async function getRepoForSourceControlAi(
  store: Store,
  args: { repoId?: string; worktreePath: string; connectionId?: string }
): Promise<Repo | null> {
  if (!args.repoId) {
    return null
  }
  const repo = store.getRepo(args.repoId)
  if (!repo) {
    return null
  }
  if (args.connectionId) {
    if (repo.connectionId !== args.connectionId) {
      return null
    }
    // Why: one SSH connection can host several repos; repo-scoped AI overrides apply only when the worktree belongs to that repo.
    return (await remoteRepoOwnsWorktree(store, repo, args.worktreePath, args.connectionId))
      ? repo
      : null
  }
  if (repo.connectionId) {
    return null
  }
  // Why: renderer-supplied repoId is advisory; apply repo overrides only when the local worktree belongs to that repo.
  return (await localRepoOwnsWorktree(store, repo, args.worktreePath)) ? repo : null
}

export function getLocalAgentRuntimeTarget(
  gitOptions: LocalProjectWorktreeGitOptions
): CommitMessageAgentRuntimeTarget {
  return gitOptions.wslDistro
    ? { runtime: 'wsl', wslDistro: gitOptions.wslDistro }
    : { runtime: 'host' }
}

export function getLocalTextGenerationTarget(
  worktreePath: string,
  gitOptions: LocalProjectWorktreeGitOptions,
  env?: NodeJS.ProcessEnv
): Extract<CommitMessageGenerationTarget, { kind: 'local' }> {
  return {
    kind: 'local',
    cwd: worktreePath,
    ...(gitOptions.wslDistro ? { wslDistro: gitOptions.wslDistro } : {}),
    ...(env ? { env } : {})
  }
}

export function validateFullGitObjectId(value: string, label: string): string {
  if (!FULL_GIT_OBJECT_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a full git object id`)
  }
  return value
}

/**
 * Check if a buffer appears to be binary (contains null bytes in first 8KB).
 */
export function isBinaryBuffer(buffer: Buffer): boolean {
  const len = Math.min(buffer.length, 8192)
  for (let i = 0; i < len; i++) {
    if (buffer[i] === 0) {
      return true
    }
  }
  return false
}

export async function isBinaryFilePrefix(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r')
  try {
    const probe = Buffer.alloc(BINARY_PROBE_BYTES)
    const { bytesRead } = await handle.read(probe, 0, probe.length, 0)
    return isBinaryBuffer(probe.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

export async function isDirectoryEntry(
  dirPath: string,
  entry: { name: string; isDirectory(): boolean; isSymbolicLink(): boolean },
  _resolveEntryPath: (entryPath: string) => Promise<string>
): Promise<boolean> {
  // Why: following a symlink in readDir can touch macOS TCC-protected containers; treat links as file-like until explicitly opened.
  void _resolveEntryPath
  if (entry.isSymbolicLink()) {
    void dirPath
    return false
  }
  if (entry.isDirectory()) {
    return true
  }
  return false
}

