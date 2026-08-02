export * from './filesystem-ipc-foundation'
import { registerFilesystemFileHandlers } from './filesystem-file-ipc-handlers'
import { registerFilesystemGitGenerationHandlers } from './filesystem-git-generation-ipc-handlers'
import { registerFilesystemGitMutationHandlers } from './filesystem-git-mutation-ipc-handlers'
import { registerFilesystemGitReadHandlers } from './filesystem-git-read-ipc-handlers'
import { registerFilesystemSearchHandlers } from './filesystem-search-ipc-handlers'
import type { Store } from '../persistence'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'

export function registerFilesystemHandlers(
  store: Store,
  commitMessageAgentEnv?: CommitMessageAgentEnvironmentResolvers
): void {
  registerFilesystemFileHandlers(store, commitMessageAgentEnv)
  registerFilesystemSearchHandlers(store)
  registerFilesystemGitReadHandlers(store, commitMessageAgentEnv)
  registerFilesystemGitGenerationHandlers(store, commitMessageAgentEnv)
  registerFilesystemGitMutationHandlers(store, commitMessageAgentEnv)
}
