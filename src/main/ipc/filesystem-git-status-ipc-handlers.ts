// Filesystem, search, and source-control IPC handlers.
import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type {
  GitStatusResult
} from '../../shared/types'
import { getStatus } from '../git/status'
import { resolveRegisteredWorktreePath } from './filesystem-auth'
import {
  getLocalRepoForRegisteredWorktree
} from './local-worktree-runtime-options'
import {
  getSshGitProvider,
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE
} from '../providers/ssh-git-dispatch'
import { getWorktreeSharedLinkPaths } from '../git/worktree-shared-directories'
import { createSenderScopedRequestCancellations } from './sender-scoped-request-cancellation'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'

export function registerFilesystemGitStatusHandlers(store: Store, commitMessageAgentEnv?: CommitMessageAgentEnvironmentResolvers): void {
  const gitStatusCancellations = createSenderScopedRequestCancellations()

  ipcMain.handle(
      'git:status',
      async (
        event,
        args: {
          worktreePath: string
          connectionId?: string
          includeIgnored?: boolean
          bypassEffectiveUpstreamNegativeCache?: boolean
          reuseLineStats?: boolean
          requestToken?: string
        }
      ): Promise<GitStatusResult> => {
        const controller = gitStatusCancellations.begin(event, args.requestToken)
        const options = {
          includeIgnored: args.includeIgnored ?? false,
          ...(args.reuseLineStats === true ? { reuseLineStats: true } : {}),
          ...(args.bypassEffectiveUpstreamNegativeCache === true
            ? { bypassEffectiveUpstreamNegativeCache: true }
            : {}),
          ...(controller ? { signal: controller.signal } : {})
        }
        try {
          if (args.connectionId) {
            const provider = getSshGitProvider(args.connectionId)
            if (!provider) {
              throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
            }
            // Why: await keeps the cancellation token registered until the remote request settles (an early finally would free it).
            return await provider.getStatus(args.worktreePath, options)
          }
          const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
          // Why: one registered-worktree lookup feeds both — status polls this
          // handler, and the scan walks every repo's worktree meta.
          const repo = getLocalRepoForRegisteredWorktree(store, args.worktreePath, worktreePath)
          const gitOptions = getLocalGitOptionsForRepo(store, repo)
          const sharedLinkPaths = repo ? getWorktreeSharedLinkPaths(repo) : []
          return await getStatus(worktreePath, {
            ...options,
            ...gitOptions,
            ...(sharedLinkPaths.length > 0 ? { sharedLinkPaths } : {})
          })
        } finally {
          gitStatusCancellations.finish(event, args.requestToken, controller)
        }
      }
    )

  ipcMain.handle('git:cancelStatus', (event, args: { requestToken: string }): void => {
      gitStatusCancellations.cancel(event, args.requestToken)
    })

    // Why: parent status reports only one gitlink row per submodule; fetch inner per-file changes from the submodule's own worktree.


}
