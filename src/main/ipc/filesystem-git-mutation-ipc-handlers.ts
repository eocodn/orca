// Filesystem, search, and source-control IPC handlers.
import { ipcMain } from 'electron'
import { validateGitForkSyncExpectedUpstream } from '../../shared/git-fork-sync'
import { assertGitPushTargetShape } from '../../shared/git-push-target-validation'
import type {
  GitForkSyncExpectedUpstream,
  GitForkSyncResult,
  GitPushTarget
} from '../../shared/types'
import { gitSyncForkDefaultBranch } from '../git/fork-sync'
import { validateGitPushTarget } from '../git/push-target-validation'
import { gitFastForward,gitFetch,gitPull,gitPullRebaseFromBase,gitPush } from '../git/remote'
import {
  bulkDiscardChanges,
  bulkStageFiles,
  bulkUnstageFiles,
  commitChanges,
  discardChanges,
  stageFile,
  unstageFile
} from '../git/status'
import type { Store } from '../persistence'
import {
  getSshGitProvider,
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE
} from '../providers/ssh-git-dispatch'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'
import {
  resolveRegisteredWorktreePath,
  validateGitRelativeFilePath
} from './filesystem-auth'
import { getLocalGitOptionsForRegisteredWorktree } from './local-worktree-runtime-options'
import { createSenderScopedRequestCancellations } from './sender-scoped-request-cancellation'

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
