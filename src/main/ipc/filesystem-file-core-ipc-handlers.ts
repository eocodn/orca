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
import { MAX_TEXT_FILE_SIZE, BINARY_PROBE_BYTES, FULL_GIT_OBJECT_ID_PATTERN, MAX_PREVIEWABLE_BINARY_SIZE, PREVIEWABLE_BINARY_MIME_TYPES, readLocalLogSnapshot, DownloadFileResult, validateRequiredString, decodeDownloadedFileContent, DownloadSession, DOWNLOAD_SESSION_TTL_MS, createSiblingTransferPath, cleanupLocalTransferPath, inspectDownloadDestination, assertDestinationStillUnclaimed, promoteDownloadedFile, comparableLocalPath, getCandidateLocalWorktreePaths, hasRegisteredWorktreeMetaForRepo, comparableRemotePath, hasRegisteredRemoteWorktreeMetaForRepo, localRepoOwnsWorktree, remoteRepoOwnsWorktree, getRepoForSourceControlAi, getLocalAgentRuntimeTarget, getLocalTextGenerationTarget, validateFullGitObjectId, isBinaryBuffer, isBinaryFilePrefix, isDirectoryEntry } from './filesystem-ipc-foundation'

export function registerFilesystemFileCoreHandlers(store: Store, commitMessageAgentEnv?: CommitMessageAgentEnvironmentResolvers): void {
  ipcMain.handle(
      'fs:listMarkdownDocuments',
      async (
        _event,
        args: { rootPath: string; connectionId?: string }
      ): Promise<MarkdownDocument[]> => {
        if (args.connectionId) {
          const provider = requireSshFilesystemProvider(args.connectionId)
          const relativePaths = await provider.listFiles(args.rootPath)
          return markdownDocumentsFromRelativePaths(args.rootPath, relativePaths)
        }

        const rootPath = await resolveRegisteredWorktreePath(args.rootPath, store)
        return listMarkdownDocuments(rootPath)
      }
    )

  ipcMain.handle(
      'fs:writeFile',
      async (
        _event,
        args: { filePath: string; content: string; connectionId?: string } & SshMutationExpectation
      ): Promise<void> => {
        assertSshMutationExpectation(
          args.connectionId,
          args.expectedSshTargetId,
          args.expectedSshConnectionGeneration,
          args.expectedExecutionHostId
        )
        if (args.connectionId) {
          const provider = requireSshFilesystemProvider(args.connectionId)
          return provider.writeFile(args.filePath, args.content)
        }
        const filePath = await resolveAuthorizedPath(args.filePath, store)

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

        await writeFile(filePath, args.content, 'utf-8')
      }
    )

  ipcMain.handle(
      'fs:deletePath',
      async (
        _event,
        args: {
          targetPath: string
          connectionId?: string
          recursive?: boolean
        } & SshMutationExpectation
      ): Promise<void> => {
        assertSshMutationExpectation(
          args.connectionId,
          args.expectedSshTargetId,
          args.expectedSshConnectionGeneration,
          args.expectedExecutionHostId
        )
        if (args.connectionId) {
          const provider = requireSshFilesystemProvider(args.connectionId)
          return provider.deletePath(args.targetPath, args.recursive)
        }
        // Why: preserve the symlink so we delete the link, not its target (realpath would trash the real file, possibly outside all roots).
        const targetPath = await resolveAuthorizedPath(args.targetPath, store, {
          preserveSymlink: true
        })

        // Why: WSL UNC targets have no Recycle Bin (shell.trashItem throws), so hard-delete via `rm` inside the distro (issue #6415).
        if (await tryDeleteWslUncPath(targetPath, { recursive: args.recursive })) {
          return
        }

        // Why: swallow ENOENT so an external delete racing this UI delete stays idempotent (design §7.1).
        try {
          await shell.trashItem(targetPath)
        } catch (error) {
          if (isENOENT(error)) {
            return
          }
          throw error
        }
      }
    )

  registerFilesystemMutationHandlers(store)

  ipcMain.handle('fs:authorizeExternalPath', (_event, args: { targetPath: string }): void => {
      authorizeExternalPath(args.targetPath)
    })

  ipcMain.handle(
      'fs:stat',
      async (
        _event,
        args: { filePath: string; connectionId?: string }
      ): Promise<{ size: number; isDirectory: boolean; mtime: number }> => {
        if (args.connectionId) {
          const provider = requireSshFilesystemProvider(args.connectionId)
          const s = await provider.stat(args.filePath)
          return { size: s.size, isDirectory: s.type === 'directory', mtime: s.mtime }
        }
        const filePath = await resolveAuthorizedPath(args.filePath, store)
        const stats = await stat(filePath)
        return {
          size: stats.size,
          isDirectory: stats.isDirectory(),
          mtime: stats.mtimeMs
        }
      }
    )

  ipcMain.handle(
      'fs:pathExists',
      async (_event, args: { filePath: string; connectionId?: string }): Promise<boolean> => {
        try {
          if (args.connectionId) {
            const provider = requireSshFilesystemProvider(args.connectionId)
            await provider.stat(args.filePath)
            return true
          }
          const filePath = await resolveAuthorizedPath(args.filePath, store)
          await stat(filePath)
          return true
        } catch (error) {
          if (isENOENT(error)) {
            return false
          }
          throw error
        }
      }
    )

    // ─── Search ────────────────────────────────────────────

  registerLocalLogTailHandlers(store)
}
