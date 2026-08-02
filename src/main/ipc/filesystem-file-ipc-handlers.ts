import type { Store } from '../persistence'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'
import { registerFilesystemFileTransferHandlers } from './filesystem-file-transfer-ipc-handlers'
import { registerFilesystemFileCoreHandlers } from './filesystem-file-core-ipc-handlers'

export function registerFilesystemFileHandlers(
  store: Store,
  commitMessageAgentEnv?: CommitMessageAgentEnvironmentResolvers
): void {
  registerFilesystemFileTransferHandlers(store, commitMessageAgentEnv)
  registerFilesystemFileCoreHandlers(store, commitMessageAgentEnv)
}
