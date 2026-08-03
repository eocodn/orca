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

export function registerFilesystemSearchHandlers(store: Store, commitMessageAgentEnv?: CommitMessageAgentEnvironmentResolvers): void {
  const activeTextSearches = new Map<string, ChildProcess>()

  ipcMain.handle(
      'fs:search',
      async (event, args: SearchOptions & { connectionId?: string }): Promise<SearchResult> => {
        if (args.connectionId) {
          const provider = requireSshFilesystemProvider(args.connectionId)
          return provider.search(args)
        }
        const rootPath = await resolveAuthorizedPath(args.rootPath, store)
        const localGitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.rootPath,
          rootPath
        )
        const maxResults = Math.max(
          1,
          Math.min(args.maxResults ?? DEFAULT_SEARCH_MAX_RESULTS, DEFAULT_SEARCH_MAX_RESULTS)
        )
        const searchKey = `${event.sender.id}:${rootPath}`
  
        // Why: probe rg upfront; on some platforms spawn emits 'close' before 'error', resolving empty before the git-grep fallback runs.
        const rgAvailable = await checkRgAvailable(rootPath, localGitOptions.wslDistro)
        if (!rgAvailable) {
          return searchWithGitGrep(rootPath, args, maxResults, localGitOptions)
        }
  
        return new Promise((resolvePromise) => {
          const rgArgs = buildRgArgs(args.query, rootPath, args)
  
          // Why: kill the prior rg so it stops parsing thousands of matches on the main thread (the large-repo freeze) after the UI moved on.
          activeTextSearches.get(searchKey)?.kill()
  
          const acc = createAccumulator()
          let stdoutBuffer = ''
          let resolved = false
          let child: ChildProcess | null = null
          let killTimeout: ReturnType<typeof setTimeout>
  
          // Why: WSL-routed rg emits Linux paths; UNC repos carry the distro in the path, Windows-path repos in project runtime.
          const wslDistroForOutput = parseWslPath(rootPath)?.distro ?? localGitOptions.wslDistro
          const transformAbsPath = wslDistroForOutput
            ? (p: string): string => (p.startsWith('/') ? toWindowsWslPath(p, wslDistroForOutput) : p)
            : undefined
  
          const resolveOnce = (): void => {
            if (resolved) {
              return
            }
            resolved = true
            if (activeTextSearches.get(searchKey) === child) {
              activeTextSearches.delete(searchKey)
            }
            clearTimeout(killTimeout)
            // Why: child.kill() is advisory; detach our closures so repeated searches don't retain old scans if rg ignores it.
            child?.stdout?.off('data', handleStdoutData)
            child?.stderr?.off('data', handleStderrData)
            child?.off('error', handleError)
            child?.off('close', handleClose)
            resolvePromise(finalize(acc))
          }
  
          const processLine = (line: string): void => {
            const verdict = ingestRgJsonLine(line, rootPath, acc, maxResults, transformAbsPath)
            if (verdict === 'stop') {
              child?.kill()
            }
          }
  
          const nextChild = wslAwareSpawn('rg', rgArgs, {
            cwd: rootPath,
            ...(localGitOptions.wslDistro ? { wslDistro: localGitOptions.wslDistro } : {}),
            stdio: ['ignore', 'pipe', 'pipe']
          })
          child = nextChild
          activeTextSearches.set(searchKey, nextChild)
  
          const handleStdoutData = (chunk: string): void => {
            stdoutBuffer += chunk
            const lines = stdoutBuffer.split('\n')
            stdoutBuffer = lines.pop() ?? ''
            for (const line of lines) {
              processLine(line)
            }
          }
          const handleStderrData = (): void => {
            // Drain stderr so rg cannot block on a full pipe.
          }
          const handleError = (): void => {
            resolveOnce()
          }
          const handleClose = (): void => {
            if (stdoutBuffer) {
              processLine(stdoutBuffer)
            }
            resolveOnce()
          }
  
          nextChild.stdout!.setEncoding('utf-8')
          nextChild.stdout!.on('data', handleStdoutData)
          nextChild.stderr!.on('data', handleStderrData)
          nextChild.once('error', handleError)
          nextChild.once('close', handleClose)
  
          // Why: timeout kills the child mid-scan; mark truncated so the UI shows incomplete results.
          killTimeout = setTimeout(() => {
            acc.truncated = true
            child?.kill()
            resolveOnce()
          }, SEARCH_TIMEOUT_MS)
        })
      }
    )
  
    // ─── List all files (for quick-open) ─────────────────────
    // Why #7721: token-keyed so a workspace switch aborts the prior full-tree scan (SSH otherwise stacks scans past the 30s timeout).

  const listFilesCancellations = createSenderScopedRequestCancellations()

  ipcMain.handle(
      'fs:listFiles',
      async (
        event,
        args: {
          rootPath: string
          connectionId?: string
          excludePaths?: string[]
          requestToken?: string
        }
      ): Promise<string[]> => {
        const controller = listFilesCancellations.begin(event, args.requestToken)
        try {
          if (args.connectionId) {
            const provider = getSshFilesystemProvider(args.connectionId)
            // Why: no provider (cold start / disconnected) → return [] so quick-open shows "No matching files" instead of an error.
            if (!provider) {
              return []
            }
            // Why: forward excludePaths or nested linked worktrees get double-scanned over SSH, causing timeout-induced partial results.
            return await provider.listFiles(args.rootPath, {
              excludePaths: args.excludePaths,
              signal: controller?.signal
            })
          }
          return await listQuickOpenFiles(args.rootPath, store, args.excludePaths, controller?.signal)
        } finally {
          listFilesCancellations.finish(event, args.requestToken, controller)
        }
      }
    )

  ipcMain.handle('fs:cancelListFiles', (event, args: { requestToken: string }): void => {
      listFilesCancellations.cancel(event, args.requestToken)
    })
  
    // ─── Git operations ─────────────────────────────────────
}
