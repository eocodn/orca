export { ipcMain } from 'electron'
export { isFolderRepo } from '../../shared/repo-kind'
export { isPathInsideOrEqual, isWindowsAbsolutePathLike } from '../../shared/cross-platform-path'
export {
  getRepoExecutionHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'
export { assertWorktreeUnlockedForRemoval } from '../../shared/worktree-removal'
export type { RemoveWorktreeResult, Worktree } from '../../shared/types'
export {
  assertWorktreeCleanForRemoval,
  forceDeleteLocalBranch,
  listWorktreesStrict as listGitWorktreesStrict,
  removeWorktree
} from '../git/worktree'
export { gitExecFileAsync } from '../git/runner'
export { withWorktreeRemoveStageSpan, withWorktreeSpan } from '../observability/instrumentation'
export {
  cleanupUnusedWorktreePushTargetRemote,
  cleanupUnusedWorktreePushTargetRemoteSsh,
  notifyWorktreesChanged
} from './worktree-remote'
export { getSshGitProvider, requireSshGitProvider } from '../providers/ssh-git-dispatch'
export { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
export { getLocalProjectWorktreeGitOptions } from '../project-runtime-git-options'
export { killAllProcessesForWorktree } from '../runtime/worktree-teardown'
export { clearProviderPtyState, getLocalPtyProvider } from './pty'
export { findExistingWorktreeSymlinkPaths, removeWorktreeLinkedPaths } from './worktree-symlinks'
export { getWorktreeSharedLinkPaths } from '../git/worktree-shared-directories'
export {
  assertWorktreeDoesNotContainRegisteredWorktree,
  canCleanupUnregisteredOrcaLeftoverDirectory,
  canCleanupUnregisteredOrcaWorktreeDirectory,
  canSafelyRemoveOrphanedWorktreeDirectory,
  findRegisteredDeletableWorktree,
  isDangerousWorktreeRemovalPath,
  isWorktreePathMissing,
  formatWorktreeRemovalError,
  isOrphanCompatiblePreflightError,
  isOrphanedWorktreeError,
  ORPHANED_WORKTREE_DIRECTORY_MESSAGE,
  UNREGISTERED_MISSING_WORKTREE_MESSAGE,
  stripOrcaProvenanceMetaUpdates
} from '../worktree-removal-safety'
export { invalidateAuthorizedRootsCache } from './filesystem-auth'
export { isLocalGitRepository } from './worktree-ipc-foundation'
export { runHook } from '../hooks'
export { removeStaleLocalWorktreeRegistrationAfterFilesystemRemoval } from '../local-worktree-removal-recovery'
export {
  getLocalWorktreePathAccess,
  removeLocalWorktreePath,
  toLocalWorktreeRuntimePath
} from '../local-worktree-filesystem'
export { recoverLocalWindowsWorktreeRemoval } from '../local-worktree-removal-recovery'
export {
  getWorktreeRemovalOptionsKey,
  getWorktreeRemovalInFlightKey,
  removeWorktreeMetadataAndTransientState,
  getArchiveHooksForRemoval,
  stopPtysForDestructiveWorktreeRemoval
} from './worktree-ipc-foundation'
export {
  runRemoteArchiveHook,
  rememberPreservedBranchCleanupTarget,
  preserveBranchHeadFallback,
  getPreservedBranchCleanupTarget,
  preservedBranchCleanupByWorktreeId,
  type PreservedBranchCleanupTarget,
  type WorktreeRemovalInFlight
} from './worktree-ipc-creation'
export { getFolderWorkspaceRootId } from './worktree-ipc-remote'
export { parseWorktreeId } from './worktree-logic'
export { getRepoForWorktreeRemoval } from './worktree-ipc-foundation'
export type { RemoveWorktreeArgs } from './worktree-ipc-foundation'
