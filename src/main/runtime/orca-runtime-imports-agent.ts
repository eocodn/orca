export {
  detectAgentStatusFromTitle,
  isClaudeManagementTitle,
  isCursorNativeAgentTitle,
  isShellProcess,
  normalizeTerminalTitle
} from '../../shared/agent-detection'
export { extractOscTitleScanTail } from '../../shared/osc-title-scan-tail'
export { normalizeFolderWorkspaceOperationId } from '../../shared/folder-workspaces'
export { isServerDriveListRequest, listWindowsDrives } from './windows-drive-listing'
export { extractLastOsc7Uri, extractOscScanTail } from '../daemon/osc7-uri-extraction'
export { parseFileUriPathParts } from '../daemon/osc7-file-uri'
export type { AgentStatus } from '../../shared/agent-detection'
export type { TerminalOscLinkRange } from '../../shared/terminal-osc-link-ranges'
export type { TerminalOscColorQueryReplyColors } from '../../shared/terminal-osc-color-reply'
export type { TerminalOutputSourceRange } from '../../shared/terminal-output-source-range'
export type {
  RemoteTerminalSourceRangeConsumerHooks,
  RemoteTerminalSourceRangeReplacementPublication,
  RemoteTerminalSourceRangeReplacementReservation,
  RemoteTerminalSourceRangeStreamIdentity
} from './remote-terminal-source-range-consumer'
export {
  createTerminalTitleTracker,
  stripBrailleSpinnerGlyphs,
  type TerminalTitleTracker
} from '../../shared/terminal-output-side-effects'
export { createCommandCodeOutputStatusDetector } from '../../shared/command-code-output-status'
export type {
  TerminalSideEffectBatch,
  TerminalSideEffectFact
} from '../../shared/terminal-side-effect-facts'
export type { TerminalGitHubPRLink } from '../../shared/terminal-github-pr-link-detector'
export { TerminalKittyKeyboardModeTracker } from '../../shared/terminal-kitty-keyboard-mode-tracker'
export {
  AGENT_STATUS_STALE_AFTER_MS,
  isFreshNonDoneAgentStatus,
  type AgentStatusIpcPayload,
  type ParsedAgentStatusPayload,
  type AgentStatusEntry
} from '../../shared/agent-status-types'
export { indexAgentStatusRowsByPaneKey } from '../agent-hooks/agent-status-pane-index'
export type { AgentHookAuthorityAttestation } from '../agent-hooks/server'
export type {
  AgentSessionClaimedSpawnResult,
  AgentSessionExecutionClaim,
  AgentSessionSurfaceBinding,
  AgentLaunchPreferences,
  RuntimeAgentSessionRpcCaller,
  RuntimeCreateAgentSessionRequest,
  RuntimeCreateAgentSessionResult,
  RuntimeEnsureAgentSessionRequest,
  RuntimeEnsureAgentSessionResult
} from '../../shared/agent-session-host-authority'
export {
  AGENT_SESSION_MAX_NEW_OPERATION_AGE_MS,
  AGENT_SESSION_OPERATION_FUTURE_SKEW_MS,
  parseAgentSessionOperationTimestamp
} from '../../shared/agent-session-host-authority'
export {
  canonicalizeAgentSessionIdentity,
  createEphemeralAgentSessionClaimSigner,
  type AgentSessionClaimSigner
} from './agent-session-claim-identity'
export {
  hasCompatibleAgentTitleIdentity,
  normalizeCompatibleAgentStatusEntryForOwner,
  normalizeCompatibleAgentTitleForOwner,
  resolveCompatibleAgentTypeForOwner
} from '../../shared/agent-title-owner'
export { resolvePaneAgentOwner } from '../../shared/pane-agent-owner'
export {
  createAgentStatusOscProcessor,
  type ProcessedAgentStatusChunk
} from '../../shared/agent-status-osc'
export { assertTerminalDimensions } from '../../shared/terminal-dimensions'
export {
  AGENT_PROMPT_SUBMIT,
  buildAgentPromptPasteBytes
} from '../../shared/agent-prompt-injection'
export { gitExecFileAsync, gitSpawn, nonInteractiveGitEnv } from '../git/runner'
export { runWithGitReadCacheInvalidation } from '../git/status'
export {
  cleanupClaimedCloneTarget,
  claimCloneTarget,
  deriveValidatedClonePath,
  getClonePathComparisonKey
} from '../git/repo-clone-path'
export { getGitCloneFailureMessage } from '../../shared/git-clone-failure-message'
export { GIT_FETCH_SKIP_AUTO_MAINTENANCE_CONFIG_ARGS } from '../../shared/git-fetch-auto-maintenance'
export { createHash, randomUUID } from 'node:crypto'
export { homedir } from 'node:os'
export { isAbsolute, join, resolve } from 'node:path'
export { mkdir, readdir, rm, stat } from 'node:fs/promises'
export { resolveWorktreeCreateBase } from '../worktree-create-base'
export { resolveWorktreeAddBaseRef } from '../../shared/worktree-base-ref'
export {
  buildObservedSetupCommand,
  createSetupCompletionScanner
} from './orchestration/setup-completion-signal'
export type { TerminalRevealIdentity } from '../../shared/terminal-reveal-identity'
export type {
  OrchestrationCompatibilityEvidence,
  OrchestrationCompatibilityHostStamp
} from '../../shared/orchestration-compatibility-evidence'
export type { Automation, AutomationRun } from '../../shared/automations-types'
export type {
  AutomationWorkspaceProvenance,
  CliWorkspaceProvenance,
  BaseRefSearchResult,
  CreateWorktreeResult,
  DetectedWorktree,
  DetectedWorktreeListResult,
  ForceDeleteWorktreeBranchResult,
  GitHubPrStartPoint,
  GitPushTarget,
  GitWorktreeInfo,
  GitHubOwnerRepo,
  GlobalSettings,
  PersistedUIState,
  Project,
  ProjectUpdateArgs,
  ProjectHostSetup,
  ProjectHostSetupCloneArgs,
  ProjectHostSetupCreateArgs,
  ProjectHostSetupCreateResult,
  ProjectHostSetupDeleteArgs,
  ProjectHostSetupDeleteResult,
  ProjectHostSetupExistingFolderArgs,
  ProjectHostSetupResult,
  ProjectHostSetupUpdateArgs,
  ProjectHostSetupUpdateResult,
  Repo,
  RemoveWorktreeResult,
  StatsSummary,
  Worktree,
  WorktreeLineage,
  WorkspaceLineage,
  WorkspaceKey,
  WorktreeLineageWarning,
  WorktreeMeta,
  WorktreeBaseStatusEvent,
  WorktreeRemoteBranchConflictEvent,
  WorktreeStartupLaunch,
  LinearIssueUpdate,
  LinearProjectSummary,
  NestedRepoScanResult,
  ProjectGroup,
  FolderWorkspace,
  ProjectGroupImportMode,
  ProjectGroupImportResult,
  MemorySnapshot,
  Tab,
  TabGroupLayoutNode,
  TerminalQuickCommand,
  TerminalLayoutSnapshot,
  TerminalPaneLayoutNode,
  TerminalTab,
  TuiAgent,
  WorkspaceCreateTelemetrySource,
  WorkspaceSessionState,
  WorkspaceLinkedItem,
  DirEntry,
  FilesystemPathFlavor,
  GitLabIssueUpdate,
  GitLabMRInlineCommentInput,
  GitLabProjectRef,
  GitLabWorkItem,
  MRListState,
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../../shared/types'
export type { TaskSourceContext } from '../../shared/task-source-context'
export { assertWorktreeUnlockedForRemoval } from '../../shared/worktree-removal'
export {
  LOCAL_EXECUTION_HOST_ID,
  getRepoExecutionHostId,
  getWorktreeExecutionHostId,
  parseExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'
