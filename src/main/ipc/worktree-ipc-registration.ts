import { ipcMain, type BrowserWindow } from 'electron'
import type { Store } from '../persistence'
import type { OrcaRuntimeService, RuntimeWorktreeLifecycleEvent } from '../runtime/orca-runtime'
import { createWorktreeIpcRegistrationContext } from './worktree-ipc-registration-context'
import { registerWorktreeListHandlers } from './worktree-ipc-list-handlers'
import { registerWorktreeCreationHandlers } from './worktree-ipc-create-handlers'
import { registerWorktreeRemovalHandler } from './worktree-ipc-removal-handlers'
import { registerWorktreeRemovalCleanupHandlers } from './worktree-ipc-removal-cleanup-handlers'
import { registerWorktreeMetadataHandlers } from './worktree-ipc-metadata-handlers'

const WORKTREE_HANDLER_CHANNELS = [
  'worktrees:listAll',
  'worktrees:list',
  'worktrees:listDetected',
  'worktrees:cancelListDetected',
  'worktrees:create',
  'worktrees:prefetchCreateBase',
  'worktrees:resolvePrBase',
  'worktrees:resolveMrBase',
  'worktrees:remove',
  'worktrees:forgetLocal',
  'worktrees:forceDeletePreservedBranch',
  'worktrees:updateMeta',
  'worktrees:listLineage',
  'worktrees:listLineageForHost',
  'worktrees:updateLineage',
  'worktrees:persistSortOrder',
  'worktrees:getBranchRenameFailureOutput',
  'hooks:check',
  'hooks:inspectSetupScriptImports',
  'hooks:createIssueCommandRunner',
  'hooks:readIssueCommand',
  'hooks:writeIssueCommand'
] as const

export function registerWorktreeHandlers(
  mainWindow: BrowserWindow,
  store: Store,
  runtime: OrcaRuntimeService,
  options?: { onWorktreeLifecycle?: (event: RuntimeWorktreeLifecycleEvent) => void }
): void {
  // Remove handlers before re-registering so macOS window recreation cannot retain stale closures.
  for (const channel of WORKTREE_HANDLER_CHANNELS) {
    ipcMain.removeHandler(channel)
  }

  const context = createWorktreeIpcRegistrationContext(mainWindow, store, runtime, options)
  registerWorktreeListHandlers(context)
  registerWorktreeCreationHandlers(context)
  registerWorktreeRemovalHandler(context)
  registerWorktreeRemovalCleanupHandlers(context)
  registerWorktreeMetadataHandlers(context)
}
