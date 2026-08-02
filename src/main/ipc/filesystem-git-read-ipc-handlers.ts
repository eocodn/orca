import type { Store } from '../persistence'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'
import { registerFilesystemGitStatusHandlers } from './filesystem-git-status-ipc-handlers'
import { registerFilesystemGitHistoryHandlers } from './filesystem-git-history-ipc-handlers'
import { registerFilesystemGitComparisonHandlers } from './filesystem-git-comparison-ipc-handlers'

export function registerFilesystemGitReadHandlers(
  store: Store,
  commitMessageAgentEnv?: CommitMessageAgentEnvironmentResolvers
): void {
  registerFilesystemGitStatusHandlers(store, commitMessageAgentEnv)
  registerFilesystemGitHistoryHandlers(store, commitMessageAgentEnv)
  registerFilesystemGitComparisonHandlers(store, commitMessageAgentEnv)
}
