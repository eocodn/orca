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

export function registerFilesystemGitComparisonHandlers(store: Store, commitMessageAgentEnv?: CommitMessageAgentEnvironmentResolvers): void {
  ipcMain.handle(
      'git:abortMerge',
      async (_event, args: { worktreePath: string; connectionId?: string }): Promise<void> => {
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(`No git provider for connection "${args.connectionId}"`)
          }
          return provider.abortMerge(args.worktreePath)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        await abortMerge(worktreePath, gitOptions)
      }
    )

  ipcMain.handle(
      'git:abortRebase',
      async (_event, args: { worktreePath: string; connectionId?: string }): Promise<void> => {
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(`No git provider for connection "${args.connectionId}"`)
          }
          return provider.abortRebase(args.worktreePath)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        await abortRebase(worktreePath, gitOptions)
      }
    )

  ipcMain.handle(
      'git:diff',
      async (
        _event,
        args: {
          worktreePath: string
          filePath: string
          staged: boolean
          compareAgainstHead?: boolean
          connectionId?: string
        }
      ): Promise<GitDiffResult> => {
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.getDiff(
            args.worktreePath,
            args.filePath,
            args.staged,
            args.compareAgainstHead
          )
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const filePath = validateGitRelativeFilePath(worktreePath, args.filePath)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        return getDiff(worktreePath, filePath, args.staged, args.compareAgainstHead, gitOptions)
      }
    )

  ipcMain.handle(
      'git:branchCompare',
      async (
        _event,
        args: { worktreePath: string; baseRef: string; connectionId?: string }
      ): Promise<GitBranchCompareResult> => {
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.getBranchCompare(args.worktreePath, args.baseRef)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        return getBranchCompare(worktreePath, args.baseRef, gitOptions)
      }
    )

  ipcMain.handle(
      'git:commitCompare',
      async (
        _event,
        args: { worktreePath: string; commitId: string; connectionId?: string }
      ): Promise<GitCommitCompareResult> => {
        const commitId = validateFullGitObjectId(args.commitId, 'commitId')
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.getCommitCompare(args.worktreePath, commitId)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        return getCommitCompare(worktreePath, commitId, gitOptions)
      }
    )

  ipcMain.handle(
      'git:upstreamStatus',
      async (
        _event,
        args: { worktreePath: string; connectionId?: string; pushTarget?: GitPushTarget }
      ): Promise<GitUpstreamStatus> => {
        if (args.connectionId) {
          if (args.pushTarget) {
            assertGitPushTargetShape(args.pushTarget)
          }
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.getUpstreamStatus(args.worktreePath, args.pushTarget)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        return getUpstreamStatus(worktreePath, args.pushTarget, gitOptions)
      }
    )

  ipcMain.handle(
      'git:branchDiff',
      async (
        _event,
        args: {
          worktreePath: string
          compare: {
            baseRef: string
            baseOid: string
            headOid: string
            mergeBase: string
          }
          filePath: string
          oldPath?: string
          connectionId?: string
        }
      ): Promise<GitDiffResult> => {
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          const results = await provider.getBranchDiff(args.worktreePath, args.compare.mergeBase, {
            includePatch: true,
            filePath: args.filePath,
            oldPath: args.oldPath
          })
          return (
            results[0] ?? {
              kind: 'text',
              originalContent: '',
              modifiedContent: '',
              originalIsBinary: false,
              modifiedIsBinary: false
            }
          )
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const filePath = validateGitRelativeFilePath(worktreePath, args.filePath)
        const oldPath = args.oldPath
          ? validateGitRelativeFilePath(worktreePath, args.oldPath)
          : undefined
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        return getBranchDiff(
          worktreePath,
          {
            mergeBase: args.compare.mergeBase,
            headOid: args.compare.headOid,
            filePath,
            oldPath
          },
          gitOptions
        )
      }
    )

  ipcMain.handle(
      'git:commitDiff',
      async (
        _event,
        args: {
          worktreePath: string
          commitOid: string
          parentOid?: string | null
          filePath: string
          oldPath?: string
          connectionId?: string
        }
      ): Promise<GitDiffResult> => {
        const commitOid = validateFullGitObjectId(args.commitOid, 'commitOid')
        const parentOid = args.parentOid ? validateFullGitObjectId(args.parentOid, 'parentOid') : null
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.getCommitDiff(args.worktreePath, {
            commitOid,
            parentOid,
            filePath: args.filePath,
            oldPath: args.oldPath
          })
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const filePath = validateGitRelativeFilePath(worktreePath, args.filePath)
        const oldPath = args.oldPath
          ? validateGitRelativeFilePath(worktreePath, args.oldPath)
          : undefined
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        return getCommitDiff(
          worktreePath,
          {
            commitOid,
            parentOid,
            filePath,
            oldPath
          },
          gitOptions
        )
      }
    )

  ipcMain.handle(
      'git:remoteFileUrl',
      async (
        _event,
        args: { worktreePath: string; relativePath: string; line: number; connectionId?: string }
      ): Promise<string | null> => {
        // Why: remote repos can't read relay-side .git/config locally; delegate URL construction to the SSH provider.
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.getRemoteFileUrl(args.worktreePath, args.relativePath, args.line)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        return getRemoteFileUrl(worktreePath, args.relativePath, args.line)
      }
    )


}
