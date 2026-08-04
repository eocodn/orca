// Filesystem, search, and source-control IPC handlers.
import { ipcMain } from 'electron'
import type { GitHistoryOptions,GitHistoryResult } from '../../shared/git-history'
import type {
  GitConflictOperation,
  GitStagingArea,
  GitStatusResult
} from '../../shared/types'
import { checkIgnoredPaths } from '../git/check-ignored-paths'
import { getHistory } from '../git/history'
import {
  appendFolderToGitignore,
  findKnownHugeFolderPathsToIgnore
} from '../git/huge-folder-ignore'
import {
  detectConflictOperation,
  getSubmoduleStatus
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

export function registerFilesystemGitHistoryHandlers(store: Store, commitMessageAgentEnv?: CommitMessageAgentEnvironmentResolvers): void {
  ipcMain.handle(
      'git:submoduleStatus',
      async (
        _event,
        args: {
          worktreePath: string
          submodulePath: string
          connectionId?: string
          area?: GitStagingArea
        }
      ): Promise<GitStatusResult> => {
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.getSubmoduleStatus(args.worktreePath, args.submodulePath, args.area)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        return getSubmoduleStatus(worktreePath, args.submodulePath, {
          ...gitOptions,
          ...(args.area === 'staged' ? { staged: true } : {})
        })
      }
    )

  ipcMain.handle(
      'git:checkIgnored',
      async (
        _event,
        args: { worktreePath: string; paths: string[]; connectionId?: string }
      ): Promise<string[]> => {
        if (args.connectionId) {
          const paths = args.paths.map((p) => validateGitRelativeFilePath(args.worktreePath, p))
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.checkIgnoredPaths(args.worktreePath, paths)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const paths = args.paths.map((p) => validateGitRelativeFilePath(worktreePath, p))
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        return checkIgnoredPaths(worktreePath, paths, gitOptions)
      }
    )

    // Why: backs the SCM "ignore the flooding folder" flow; local-only since huge untracked folders are a local-dev pathology.

  ipcMain.handle(
      'git:findHugeFoldersToIgnore',
      async (_event, args: { worktreePath: string }): Promise<string[]> => {
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        return findKnownHugeFolderPathsToIgnore(worktreePath, gitOptions)
      }
    )

  ipcMain.handle(
      'git:appendGitignore',
      async (_event, args: { worktreePath: string; folderName: string }): Promise<boolean> => {
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        return appendFolderToGitignore(worktreePath, args.folderName)
      }
    )

  ipcMain.handle(
      'git:history',
      async (
        _event,
        args: { worktreePath: string; connectionId?: string } & GitHistoryOptions
      ): Promise<GitHistoryResult> => {
        const options: GitHistoryOptions = { limit: args.limit, baseRef: args.baseRef }
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.getHistory(args.worktreePath, options)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        return getHistory(worktreePath, { ...options, ...gitOptions })
      }
    )

    // Why: fs-only conflict-state check so non-active worktrees can clear their Rebasing/Merging badges without a full git status.

  ipcMain.handle(
      'git:conflictOperation',
      async (
        _event,
        args: { worktreePath: string; connectionId?: string }
      ): Promise<GitConflictOperation> => {
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          return provider.detectConflictOperation(args.worktreePath)
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        return detectConflictOperation(worktreePath)
      }
    )


}
