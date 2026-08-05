export { normalizeSparseDirectories } from '../ipc/sparse-checkout-directories'
export type { Store } from '../persistence'
export type { StatsCollector } from '../stats/collector'
export { AgentDetector } from '../stats/agent-detector'
export {
  computeWorktreePath,
  computeWorkspaceRoot,
  ensurePathWithinWorkspace,
  formatWorktreeRemovalError,
  getWorktreeCreationLayout,
  getWorktreePathSettings,
  isOrphanCompatiblePreflightError,
  isOrphanedWorktreeError,
  mergeWorktree,
  sanitizeWorktreeName,
  shouldSetDisplayName,
  areWorktreePathsEqual
} from '../ipc/worktree-logic'
export { findCreatedWorktree } from '../ipc/created-worktree-reconciliation'
export {
  assertWorktreeDoesNotContainRegisteredWorktree,
  canCleanupUnregisteredOrcaLeftoverDirectory,
  canCleanupUnregisteredOrcaWorktreeDirectory,
  canSafelyRemoveOrphanedWorktreeDirectory,
  findRegisteredDeletableWorktree,
  isDangerousWorktreeRemovalPath,
  ORPHANED_WORKTREE_DIRECTORY_MESSAGE,
  stripOrcaProvenanceMetaUpdates,
  UNREGISTERED_MISSING_WORKTREE_MESSAGE
} from '../worktree-removal-safety'
export { prefetchWorktreeCreateBase } from '../worktree-create-base-prefetch'
export { prepareLocalWorktreeRootForRepo } from '../worktree-root-preparation'
export {
  closeLocalWatcherForWorktreePath,
  closeRemoteWatcherForWorktreePath,
  forgetLocalWatcherRemovalSnapshot,
  forgetRemoteWatcherRemovalSnapshot,
  restoreLocalWatcherAfterFailedRemoval,
  restoreRemoteWatcherAfterFailedRemoval
} from '../ipc/filesystem-watcher'
export { acquireWatcherRemovalGate } from '../ipc/watcher-removal-gate'
export {
  createWatcherRemovalDeadline,
  drainBeforeWatcherRemoval,
  type WatcherRemovalDeadline
} from '../ipc/watcher-removal-drain'
export { withWorktreeSpan } from '../observability/instrumentation'
export { HeadlessEmulator } from '../daemon/headless-emulator'
export {
  isNativeWindowsConptyPty,
  registerConptyDa1OverrideInstaller,
  shouldModelAnswerHiddenPtyQueries
} from './terminal-model-query-authority'
export {
  getTerminalViewAttributes,
  getTerminalViewColorQueryReplyColors,
  registerTerminalViewAttributesApplier
} from './terminal-view-attribute-store'
export { killAllProcessesForWorktree, teardownRpcDeadline } from './worktree-teardown'
export { stopMissingWorktreeTerminals } from './missing-worktree-terminal-reconciliation'
export type { ReplayableMobileNotification } from './mobile-notification-replay'
export { RuntimeNotificationRegistry } from './runtime-notification-registry'
export { MOBILE_SUBSCRIBE_SCROLLBACK_ROWS } from './scrollback-limits'
export {
  createMobileSessionTabsNotifyCoalescer,
  type MobileSessionTabsNotifyCoalescer
} from './mobile-session-tabs-notify-coalescer'
export { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
export {
  assertFolderWorkspacePathUsable,
  getFolderWorkspacePathStatus,
  getFolderWorkspacePathStatusForPath,
  inferFolderWorkspacePathConnection
} from '../project-groups/folder-workspace-path-status'
export {
  getSshGitProvider,
  getSshGitProviderGeneration,
  requireSshGitProvider
} from '../providers/ssh-git-dispatch'
export { detectRepoIconAndUpstream } from '../repo-icon-autodetect'
export { enrichMissingRepoGitRemoteIdentities } from '../repo-git-remote-identity-enrichment'
export { githubAvatarIcon } from '../../shared/repo-icon'
export type { ClaudeAccountService } from '../claude-accounts/service'
export type {
  CodexAccountService,
  CodexResetCreditRejectedBeforeProviderReason
} from '../codex-accounts/service'
export type { CodexAccountSelectionTarget } from '../codex-accounts/runtime-selection'
export type { RateLimitService } from '../rate-limits/service'
export type { CodexRateLimitResetOutcome, RateLimitState } from '../../shared/rate-limit-types'
export type { CodexResetCreditExpectedScope } from '../../shared/codex-reset-credit-scope'
export type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'
export { scanNestedRepos } from '../project-groups/nested-repo-discovery'
export {
  createNestedProjectGroupResolver,
  resolveNestedRepoSelection
} from '../project-groups/nested-repo-import'
export { createNestedRepoImportTargetResolver } from '../project-groups/nested-repo-import-target'
export {
  RuntimeClientSettingsCommands,
  type RuntimeClientSettings
} from './runtime-client-settings-commands'
export {
  PtyLayoutQueue,
  type ApplyLayoutResult,
  type PtyLayoutState,
  type PtyLayoutTarget
} from './pty-layout-queue'
export { PtyGenerationReferenceCount } from './pty-generation-reference-count'
export { RuntimeRepoHookCommands } from './runtime-repo-hook-commands'
export {
  branchSelectorMatches,
  buildRuntimeWorktreeSummaryPathIndex,
  canonicalizeTerminalSessionWorktreeId,
  classifyAgentTitle,
  classifyLatestAgentTitle,
  compareWorktreePs,
  findResolvedWorktreeIdForPath,
  findRuntimeWorktreeSummaryByPath,
  getExplicitWorktreeIdSelector,
  getLatestAgentCandidateTitle,
  getLatestAgentCandidateTitleInfo,
  getLatestLeafTitle,
  getLatestPtyTitle,
  getLeafWorktreeStatus,
  getSavedTabWorktreeStatus,
  includeTargetResolvedWorktree,
  indexPersistedPtySurfaceBindings,
  indexPersistedPtyWorktreeBindings,
  inferWorktreeIdFromPtyId,
  mapExplicitAgentStateToRuntimeTerminalStatus,
  maxTimestamp,
  mergeWorktreeStatus,
  notifyRuntimeListeners,
  parseRuntimeWorktreeId,
  resolveTerminalSessionWorktreeId,
  resolveWorktreeScanCacheTtlMs,
  runtimePathsEqual,
  runtimeWorktreeIdentityKey,
  runtimeWorktreeIdsEqual,
  type RuntimeWorktreeSummaryPathIndex,
  setBoundedMapEntry,
  setsEqual,
  terminalTitleBlocksExplicitAgentStatus,
  waitForWorktreeTerminalMutation,
  withTimeout,
  withTimeoutResult
} from './runtime-worktree-summary'
export {
  getRuntimeWorktreeRemovalKey,
  getRuntimeWorktreeRemovalOptionsKey,
  isLocalRuntimeGitRepository,
  isRuntimeWorktreePathMissing,
  omitUndefinedProperties,
  parseExactWorktreeIdSelector,
  type PreservedBranchCleanupTarget,
  type RuntimeWorktreeRemovalInFlight,
  type RuntimeWorktreeRemovalTarget
} from './runtime-worktree-selection'
export {
  addListenerToMap,
  canCheckoutExistingLocalBranch,
  clampTerminalViewport,
  getLocalGitHubPrForBranch,
  getSelectedHostedReviewForBranch,
  getSelectedReviewBranch,
  hasLocalGitOptions,
  isAllowedPushTargetRemoteConflict,
  isMatchingSelectedGitHubPr,
  resolveCreateBranchName
} from './runtime-branch-review-selection'
export {
  getRuntimeFolderWorkspaceInstanceId,
  getRuntimeFolderWorkspaceRootId,
  listRuntimeFolderWorkspaces,
  mergeRuntimeFolderWorkspace
} from './runtime-folder-workspace-selection'
export {
  copySleepingAgentLaunchConfig,
  deterministicAgentSessionUuid,
  inferCapturedClaudeAgentTeamsMode,
  isAgentSessionOperationOutcomeUnknown,
  mergeTerminalEnvDeletionKeys,
  normalizeSparsePresetDirectoriesForSave,
  normalizeSparsePresetName,
  resolveBareAgentLaunchCommand
} from './runtime-agent-launch-resolution'
