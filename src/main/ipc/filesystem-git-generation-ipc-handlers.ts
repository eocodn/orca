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

export function registerFilesystemGitGenerationHandlers(store: Store, commitMessageAgentEnv?: CommitMessageAgentEnvironmentResolvers): void {
  ipcMain.handle(
      'git:generateCommitMessage',
      async (
        _event,
        args: {
          worktreePath: string
          // Raw (unstripped) meta key; validated against worktreePath before any meta read.
          worktreeId?: string
          repoId?: string
          connectionId?: string
          sourceControlAiResolvedParams?: ResolvedSourceControlAiGenerationParams
          sourceControlAi?: GlobalSettings['sourceControlAi']
          agentCmdOverrides?: GlobalSettings['agentCmdOverrides']
        }
      ): Promise<GenerateCommitMessageResult> => {
        const discoveryHostKey = getCommitMessageModelDiscoveryHostKey(args.connectionId ?? null)
        const baseSettings = store.getSettings()
        const requestSettings = {
          ...baseSettings,
          ...(args.sourceControlAi !== undefined ? { sourceControlAi: args.sourceControlAi } : {}),
          ...(args.agentCmdOverrides !== undefined
            ? { agentCmdOverrides: args.agentCmdOverrides }
            : {})
        }
        const resolvedSettings = args.sourceControlAiResolvedParams
          ? { ok: true as const, params: args.sourceControlAiResolvedParams }
          : resolveCommitMessageSettings(
              requestSettings,
              discoveryHostKey,
              'commitMessage',
              await getRepoForSourceControlAi(store, args)
            )
        if (!resolvedSettings.ok) {
          return { success: false, error: resolvedSettings.error }
        }
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            return {
              success: false,
              error: SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE
            }
          }
          let context
          try {
            context = await provider.getStagedCommitContext(args.worktreePath)
          } catch (error) {
            console.error('[filesystem] Failed to read remote staged commit context:', error)
            return {
              success: false,
              error: 'Failed to read staged changes.'
            }
          }
          if (!context) {
            return { success: false, error: 'No staged changes to summarize.' }
          }
          context = withLinkedIssueDraftContext(
            context,
            resolveSourceControlAiLinkedIssue(store, args)
          )
          return generateCommitMessageFromContext(context, resolvedSettings.params, {
            kind: 'remote',
            cwd: args.worktreePath,
            execute: (plan, cwd, timeoutMs, operation) =>
              provider.executeCommitMessagePlan(plan, cwd, timeoutMs, operation),
            missingBinaryLocation: 'remote PATH'
          })
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        let context
        try {
          context = await getStagedCommitContext(worktreePath, gitOptions)
        } catch (error) {
          console.error('[filesystem] Failed to read staged commit context:', error)
          return {
            success: false,
            error: 'Failed to read staged changes.'
          }
        }
        if (!context) {
          return { success: false, error: 'No staged changes to summarize.' }
        }
        context = withLinkedIssueDraftContext(
          context,
          resolveSourceControlAiLinkedIssue(store, args, worktreePath)
        )
        const localEnv = await prepareLocalCommitMessageAgentEnv(
          resolvedSettings.params.agentId,
          commitMessageAgentEnv,
          getLocalAgentRuntimeTarget(gitOptions)
        )
        if (!localEnv.ok) {
          return { success: false, error: localEnv.error }
        }
        return generateCommitMessageFromContext(
          context,
          resolvedSettings.params,
          getLocalTextGenerationTarget(worktreePath, gitOptions, localEnv.env)
        )
      }
    )

  ipcMain.handle(
      'git:cancelGenerateCommitMessage',
      async (_event, args: { worktreePath: string; connectionId?: string }): Promise<void> => {
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            return
          }
          await provider.cancelGenerateCommitMessage(args.worktreePath, 'commit-message')
          return
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        cancelGenerateCommitMessageLocal(worktreePath)
      }
    )

  ipcMain.handle(
      'git:discoverCommitMessageModels',
      async (
        _event,
        args: { agentId: string; worktreePath?: string; connectionId?: string }
      ): Promise<DiscoverCommitMessageModelsResult> => {
        const agentId = args.agentId
        const agentCommandOverride = store.getSettings().agentCmdOverrides?.[agentId as TuiAgent]
        if (args.connectionId) {
          if (!args.worktreePath) {
            return { success: false, error: 'Missing worktree path for remote model discovery.' }
          }
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            return {
              success: false,
              error: `No git provider for connection "${args.connectionId}"`
            }
          }
          return discoverCommitMessageModelsRemote(
            agentId as TuiAgent,
            args.worktreePath,
            (plan, cwd, timeoutMs) => provider.executeCommitMessagePlan(plan, cwd, timeoutMs),
            agentCommandOverride
          )
        }
        let localRuntimeTarget: CommitMessageAgentRuntimeTarget = { runtime: 'host' }
        let localDiscoveryOptions: Parameters<typeof discoverCommitMessageModelsLocal>[3]
        if (args.worktreePath) {
          const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
          const gitOptions = getLocalGitOptionsForRegisteredWorktree(
            store,
            args.worktreePath,
            worktreePath
          )
          localRuntimeTarget = getLocalAgentRuntimeTarget(gitOptions)
          localDiscoveryOptions = gitOptions.wslDistro
            ? { cwd: worktreePath, wslDistro: gitOptions.wslDistro }
            : { cwd: worktreePath }
        }
        const localEnv = await prepareLocalCommitMessageAgentEnv(
          agentId,
          commitMessageAgentEnv,
          localRuntimeTarget
        )
        if (!localEnv.ok) {
          return { success: false, error: localEnv.error }
        }
        return localDiscoveryOptions
          ? discoverCommitMessageModelsLocal(
              agentId as TuiAgent,
              localEnv.env,
              agentCommandOverride,
              localDiscoveryOptions
            )
          : discoverCommitMessageModelsLocal(agentId as TuiAgent, localEnv.env, agentCommandOverride)
      }
    )

  ipcMain.handle(
      'git:generatePullRequestFields',
      async (
        _event,
        args: {
          worktreePath: string
          // Raw (unstripped) meta key; validated against worktreePath before any meta read.
          worktreeId?: string
          repoId?: string
          base: string
          title: string
          body: string
          draft: boolean
          provider?: HostedReviewProvider
          useTemplate?: boolean
          connectionId?: string
          sourceControlAiResolvedParams?: ResolvedSourceControlAiGenerationParams
          sourceControlAi?: GlobalSettings['sourceControlAi']
          agentCmdOverrides?: GlobalSettings['agentCmdOverrides']
        }
      ): Promise<GeneratePullRequestFieldsResult> => {
        const discoveryHostKey = getCommitMessageModelDiscoveryHostKey(args.connectionId ?? null)
        const baseSettings = store.getSettings()
        const requestSettings = {
          ...baseSettings,
          ...(args.sourceControlAi !== undefined ? { sourceControlAi: args.sourceControlAi } : {}),
          ...(args.agentCmdOverrides !== undefined
            ? { agentCmdOverrides: args.agentCmdOverrides }
            : {})
        }
        const resolvedSettings = args.sourceControlAiResolvedParams
          ? { ok: true as const, params: args.sourceControlAiResolvedParams }
          : resolveCommitMessageSettings(
              requestSettings,
              discoveryHostKey,
              'pullRequest',
              await getRepoForSourceControlAi(store, args)
            )
        if (!resolvedSettings.ok) {
          return { success: false, error: resolvedSettings.error }
        }
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            return {
              success: false,
              error: SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE
            }
          }
          let context: Awaited<ReturnType<typeof getPullRequestDraftContext>>
          try {
            const currentBody = await resolveHostedReviewBodyForGeneration({
              body: args.body,
              repoPath: args.worktreePath,
              connectionId: args.connectionId,
              provider: args.provider,
              useTemplate: args.useTemplate
            })
            context = await getPullRequestDraftContext(
              (argv) => provider.exec(argv, args.worktreePath),
              {
                base: args.base,
                currentTitle: args.title,
                currentBody,
                currentDraft: args.draft
              }
            )
          } catch (error) {
            return {
              success: false,
              error:
                error instanceof Error ? error.message : 'Failed to prepare branch for PR details.'
            }
          }
          if (!context) {
            return { success: false, error: 'No branch changes to summarize.' }
          }
          context = withLinkedIssueDraftContext(
            context,
            resolveSourceControlAiLinkedIssue(store, args)
          )
          return generatePullRequestFieldsFromContext(context, resolvedSettings.params, {
            kind: 'remote',
            cwd: args.worktreePath,
            execute: (plan, cwd, timeoutMs, operation) =>
              provider.executeCommitMessagePlan(plan, cwd, timeoutMs, operation),
            missingBinaryLocation: 'remote PATH'
          })
        }
  
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        let context: Awaited<ReturnType<typeof getPullRequestDraftContext>>
        try {
          const currentBody = await resolveHostedReviewBodyForGeneration({
            body: args.body,
            repoPath: worktreePath,
            connectionId: args.connectionId,
            provider: args.provider,
            useTemplate: args.useTemplate
          })
          context = await getPullRequestDraftContext(
            (argv, options) =>
              gitExecFileAsync(argv, { cwd: worktreePath, ...gitOptions, ...options }),
            {
              base: args.base,
              currentTitle: args.title,
              currentBody,
              currentDraft: args.draft
            }
          )
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to prepare branch for PR details.'
          }
        }
        if (!context) {
          return { success: false, error: 'No branch changes to summarize.' }
        }
        context = withLinkedIssueDraftContext(
          context,
          resolveSourceControlAiLinkedIssue(store, args, worktreePath)
        )
        const localEnv = await prepareLocalCommitMessageAgentEnv(
          resolvedSettings.params.agentId,
          commitMessageAgentEnv,
          getLocalAgentRuntimeTarget(gitOptions)
        )
        if (!localEnv.ok) {
          return { success: false, error: localEnv.error }
        }
        return generatePullRequestFieldsFromContext(
          context,
          resolvedSettings.params,
          getLocalTextGenerationTarget(worktreePath, gitOptions, localEnv.env)
        )
      }
    )

  ipcMain.handle(
      'git:cancelGeneratePullRequestFields',
      async (_event, args: { worktreePath: string; connectionId?: string }): Promise<void> => {
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            return
          }
          await provider.cancelGenerateCommitMessage(args.worktreePath, 'pull-request-fields')
          return
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        cancelGeneratePullRequestFieldsLocal(worktreePath)
      }
    )
}
