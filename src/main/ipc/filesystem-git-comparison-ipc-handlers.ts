// Filesystem, search, and source-control IPC handlers.
import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type {
  GitBranchCompareResult,
  GitCommitCompareResult,
  GitDiffResult,
  GitPushTarget,
  GitUpstreamStatus
} from '../../shared/types'
import {
  abortMerge,
  getDiff,
  getBranchCompare,
  getBranchDiff,
  getCommitCompare,
  getCommitDiff
} from '../git/status'
import { getUpstreamStatus } from '../git/upstream'
import { assertGitPushTargetShape } from '../../shared/git-push-target-validation'
import {
  getSshGitProvider,
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE
} from '../providers/ssh-git-dispatch'
import { resolveRegisteredWorktreePath, validateGitRelativeFilePath } from './filesystem-auth'
import { getLocalGitOptionsForRegisteredWorktree } from './local-worktree-runtime-options'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'
import { validateFullGitObjectId } from './filesystem-ipc-foundation'

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
