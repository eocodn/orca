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

export function registerFilesystemGitMutationHandlers(store: Store, commitMessageAgentEnv?: CommitMessageAgentEnvironmentResolvers): void {
  const gitStatusCancellations = createSenderScopedRequestCancellations()

  ipcMain.handle(
      'git:commit',
      async (
        _event,
        args: { worktreePath: string; message: string; connectionId?: string }
      ): Promise<{ success: boolean; error?: string }> => {
        // Why: validate at the IPC boundary so the renderer gets a clear error instead of an opaque execFile failure.
        if (typeof args.message !== 'string' || args.message.trim().length === 0) {
          throw new Error('Commit message is required')
        }
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.commit(args.worktreePath, args.message)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        return commitChanges(worktreePath, args.message, gitOptions)
      }
    )

  ipcMain.handle(
      'git:fetch',
      async (
        _event,
        args: { worktreePath: string; connectionId?: string; pushTarget?: GitPushTarget }
      ): Promise<void> => {
        if (args.connectionId) {
          if (args.pushTarget) {
            assertGitPushTargetShape(args.pushTarget)
          }
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.fetchRemote(args.worktreePath, args.pushTarget)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        if (args.pushTarget) {
          await validateGitPushTarget(worktreePath, args.pushTarget, gitOptions)
        }
        await gitFetch(worktreePath, args.pushTarget, gitOptions)
      }
    )

  ipcMain.handle(
      'git:syncFork',
      async (
        _event,
        args: {
          worktreePath: string
          connectionId?: string
          expectedUpstream: GitForkSyncExpectedUpstream
        }
      ): Promise<GitForkSyncResult> => {
        const expectedUpstream = validateGitForkSyncExpectedUpstream(args.expectedUpstream, {
          required: true
        })
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.syncForkDefaultBranch(args.worktreePath, expectedUpstream)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        return gitSyncForkDefaultBranch(worktreePath, expectedUpstream, gitOptions)
      }
    )

  ipcMain.handle(
      'git:push',
      async (
        _event,
        args: {
          worktreePath: string
          publish?: boolean
          forceWithLease?: boolean
          connectionId?: string
          pushTarget?: GitPushTarget
        }
      ): Promise<void> => {
        // Why: coerce to strict boolean so a malformed payload (e.g. string 'false') can't enable --set-upstream; mirror in src/relay/git-handler.ts.
        const publish = args.publish === true
        if (args.connectionId) {
          if (args.pushTarget) {
            assertGitPushTargetShape(args.pushTarget)
          }
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.pushBranch(args.worktreePath, publish, args.pushTarget, {
            forceWithLease: args.forceWithLease === true
          })
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        if (args.pushTarget) {
          await validateGitPushTarget(worktreePath, args.pushTarget, gitOptions)
        }
        await gitPush(worktreePath, publish, args.pushTarget, {
          forceWithLease: args.forceWithLease === true,
          ...gitOptions
        })
      }
    )

  ipcMain.handle(
      'git:pull',
      async (
        _event,
        args: { worktreePath: string; connectionId?: string; pushTarget?: GitPushTarget }
      ): Promise<void> => {
        if (args.connectionId) {
          if (args.pushTarget) {
            assertGitPushTargetShape(args.pushTarget)
          }
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.pullBranch(args.worktreePath, args.pushTarget)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        if (args.pushTarget) {
          await validateGitPushTarget(worktreePath, args.pushTarget, gitOptions)
        }
        await gitPull(worktreePath, args.pushTarget, gitOptions)
      }
    )

  ipcMain.handle(
      'git:fastForward',
      async (
        _event,
        args: { worktreePath: string; connectionId?: string; pushTarget?: GitPushTarget }
      ): Promise<void> => {
        if (args.connectionId) {
          if (args.pushTarget) {
            assertGitPushTargetShape(args.pushTarget)
          }
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.fastForwardBranch(args.worktreePath, args.pushTarget)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        if (args.pushTarget) {
          await validateGitPushTarget(worktreePath, args.pushTarget, gitOptions)
        }
        await gitFastForward(worktreePath, args.pushTarget, gitOptions)
      }
    )

  ipcMain.handle(
      'git:rebaseFromBase',
      async (
        _event,
        args: { worktreePath: string; baseRef: string; connectionId?: string }
      ): Promise<void> => {
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.rebaseFromBase(args.worktreePath, args.baseRef)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        await gitPullRebaseFromBase(worktreePath, args.baseRef, gitOptions)
      }
    )

  ipcMain.handle(
      'git:stage',
      async (
        _event,
        args: { worktreePath: string; filePath: string; connectionId?: string }
      ): Promise<void> => {
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.stageFile(args.worktreePath, args.filePath)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const filePath = validateGitRelativeFilePath(worktreePath, args.filePath)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        await stageFile(worktreePath, filePath, gitOptions)
      }
    )

  ipcMain.handle(
      'git:unstage',
      async (
        _event,
        args: { worktreePath: string; filePath: string; connectionId?: string }
      ): Promise<void> => {
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.unstageFile(args.worktreePath, args.filePath)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const filePath = validateGitRelativeFilePath(worktreePath, args.filePath)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        await unstageFile(worktreePath, filePath, gitOptions)
      }
    )

  ipcMain.handle(
      'git:discard',
      async (
        _event,
        args: { worktreePath: string; filePath: string; connectionId?: string }
      ): Promise<void> => {
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.discardChanges(args.worktreePath, args.filePath)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const filePath = validateGitRelativeFilePath(worktreePath, args.filePath)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        await discardChanges(worktreePath, filePath, gitOptions)
      }
    )

  ipcMain.handle(
      'git:bulkDiscard',
      async (
        _event,
        args: { worktreePath: string; filePaths: string[]; connectionId?: string }
      ): Promise<void> => {
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.bulkDiscardChanges(args.worktreePath, args.filePaths)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const filePaths = args.filePaths.map((p) => validateGitRelativeFilePath(worktreePath, p))
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        await bulkDiscardChanges(worktreePath, filePaths, gitOptions)
      }
    )

  ipcMain.handle(
      'git:bulkStage',
      async (
        _event,
        args: { worktreePath: string; filePaths: string[]; connectionId?: string }
      ): Promise<void> => {
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.bulkStageFiles(args.worktreePath, args.filePaths)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const filePaths = args.filePaths.map((p) => validateGitRelativeFilePath(worktreePath, p))
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        await bulkStageFiles(worktreePath, filePaths, gitOptions)
      }
    )

  ipcMain.handle(
      'git:bulkUnstage',
      async (
        _event,
        args: { worktreePath: string; filePaths: string[]; connectionId?: string }
      ): Promise<void> => {
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.bulkUnstageFiles(args.worktreePath, args.filePaths)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const filePaths = args.filePaths.map((p) => validateGitRelativeFilePath(worktreePath, p))
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        await bulkUnstageFiles(worktreePath, filePaths, gitOptions)
      }
    )
}
