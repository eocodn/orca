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
  type AgentStatusOrchestrationContext,
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
export { buildOrchestrationTaskDisplayMetadata } from '../../shared/orchestration-task-display'
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
export { OrchestrationDb } from './orchestration/db'
export { OrchestrationError } from './orchestration/orchestration-error'
export {
  planLegacyWorkerTerminalRecovery,
  type LegacyWorkerTerminalRecoveryPlan
} from './orchestration/orchestration-legacy-worker-terminal-recovery'
export {
  buildObservedSetupCommand,
  createSetupCompletionScanner
} from './orchestration/setup-completion-signal'
export type { RuntimeOrchestrationEnvelope } from '../../shared/runtime-rpc-envelope'
export type { TerminalRevealIdentity } from '../../shared/terminal-reveal-identity'
export type {
  OrchestrationCompatibilityEvidence,
  OrchestrationCompatibilityHostStamp
} from '../../shared/orchestration-compatibility-evidence'
export {
  isOrchestrationMutation,
  orchestrationMigrationData
} from '../../shared/orchestration-rpc-contract'
export type {
  OrchestrationEnvironmentTransport,
  OrchestrationWorkerServer
} from './orchestration/environment-transport'
export { syncFederatedDispatch } from './orchestration/federation-sync'
export { formatMessagesForInjection } from './orchestration/formatter'
export { selectExactWorkerProviderSession } from './orchestration/worker-provider-session'
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
export { getRegisteredSshState } from '../ipc/ssh'
export type {
  AgentProviderSessionMetadata,
  SleepingAgentLaunchConfig
} from '../../shared/agent-session-resume'
export type { ExactWorkerProviderSession } from '../../shared/orchestration-worker-output'
export type { RuntimeClientEvent } from '../../shared/runtime-client-events'
export { toRuntimeActivateWorktreeEvent } from '../../shared/runtime-client-events'
export {
  navigationTargetsClients,
  navigationTargetsHost,
  type RuntimeNavigationTarget
} from '../../shared/runtime-navigation'
export type { SshConnectionState } from '../../shared/ssh-types'
export { getPublicSshState } from './public-ssh-state'
export { closeTerminalTabInWorkspaceSession } from '../../shared/workspace-session-terminal-tab-close'
export type {
  LinearCurrentIssueContextHints,
  LinearAttachResult,
  LinearCommentAddResult,
  LinearCreateResult,
  LinearErrorCode,
  LinearIssueListFilter,
  LinearIssueListResult,
  LinearProjectListResult,
  LinearIssueSummary,
  LinearIssueRequest,
  LinearIssueTaskUpdateRequest,
  LinearIssueTaskUpdateResult,
  LinearMcpIssueListRequest,
  LinearMcpIssueListResult,
  LinearIssueRelationWriteRequest,
  LinearIssueRelationWriteResult,
  LinearSaveIssueRequest,
  LinearSaveIssueResult,
  LinearTeamLabelsResult,
  LinearTeamListResult,
  LinearTeamMembersResult,
  LinearTeamStatesResult,
  LinearStatusSetResult
} from '../../shared/linear-agent-access'
export {
  HEADLESS_RUNTIME_WINDOW_ID,
  type RuntimeDesktopWindowStatus,
  type RuntimeGraphStatus,
  type RuntimeRepoSearchRefs,
  type RuntimeTerminalRead,
  type RuntimeTerminalRename,
  type RuntimeTerminalAgentStatus,
  type RuntimeTerminalSend,
  type RuntimeTerminalCreate,
  type RuntimeTerminalPresentation,
  type RuntimeTerminalSplit,
  type RuntimeTerminalFocus,
  type RuntimeTerminalClose,
  type RuntimeTerminalListResult,
  type RuntimeTerminalOrphanAdoptionRequest,
  type RuntimeTerminalOrphanAdoptionResult,
  type RuntimeWorktreeTerminalSleepResult,
  type RuntimeTerminalResolvePane,
  type RuntimeStatus,
  type RuntimeSyncWindowGraphResult,
  type RuntimeTerminalWait,
  type RuntimeTerminalWaitCondition,
  type RuntimeWorktreePsSummary,
  type RuntimeWorktreeAgentRow,
  type RuntimeSpeechModelSummary,
  type RuntimeSpeechSetupState,
  type RuntimeTerminalShow,
  type RuntimeTerminalInspect,
  type RuntimeTerminalResize,
  type RuntimeTerminalSummary,
  type RuntimeTerminalVisualGroupNode,
  type RuntimeTerminalVisualLayout,
  type RuntimeTerminalVisualLayoutNode,
  type RuntimeTerminalVisualPaneNode,
  type RuntimeTerminalVisualTab,
  type RuntimeSyncedLeaf,
  type RuntimeSyncedTab,
  type RuntimeMarkdownReadTabResult,
  type RuntimeMarkdownSaveTabResult,
  type RuntimeMobileSessionCreateTerminalResult,
  type RuntimeMobileSessionClientTab,
  type RuntimeMobileSessionTabCloseResult,
  type RuntimeMobileSessionMarkdownTab,
  type RuntimeMobileSessionTabMove,
  type RuntimeMobileSessionTabMoveResult,
  type RuntimeMobileSessionTabGroup,
  type RuntimeMobileSessionSnapshotTab,
  type RuntimeMobileSessionTerminalTab,
  type RuntimeMobileSessionBrowserTab,
  type RuntimeMobileSessionTabsRemovedResult,
  type RuntimeMobileSessionTabsResult,
  type RuntimeMobileSessionTabsSnapshot,
  type RuntimeSessionFlushResult,
  type RuntimeSessionSnapshot,
  type RuntimeNativeChatLaunchDraftResolution,
  type RuntimeSessionTabCloseReason,
  type RuntimeBrowserDriverState,
  type RuntimeTerminalDriverState,
  type RuntimeSyncWindowGraph,
  type RuntimeWorktreeListResult,
  type BrowserTabInfo,
  type BrowserScreencastResult
} from '../../shared/runtime-types'
export {
  LINEAR_SEARCH_MAX_LIMIT,
  LINEAR_WRITE_BODY_CAP,
  clampLinearSearchLimit
} from '../../shared/linear-agent-access'
export { isLinearUuid } from '../../shared/linear-uuid'
export type { FeatureInteractionId } from '../../shared/feature-interactions'
export type { TerminalPaneSplitSource } from '../../shared/feature-education-telemetry'
export {
  WORKTREE_ID_SEPARATOR,
  getRepoIdFromWorktreeId,
  splitWorktreeId,
  splitWorktreeIdForFilesystem
} from '../../shared/worktree-id'
export {
  getProjectIdForProviderIdentity,
  getProjectHostSetupForRepo,
  getProjectHostSetupWorktreeMeta
} from '../../shared/project-host-setup-projection'
export { clampLinearIssueListLimit } from '../../shared/linear-issue-read-limits'
export { isFolderRepo } from '../../shared/repo-kind'
export { DEFAULT_WORKSPACE_STATUS_ID } from '../../shared/workspace-statuses'
export {
  buildSetupRunnerCommand,
  getSetupRunnerCommandPlatformForPath
} from '../../shared/setup-runner-command'
export {
  createSequencedSetupAgentCommands,
  SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV
} from '../../shared/setup-agent-sequencing'
export { FIRST_PANE_ID } from '../../shared/pane-key'
export { isTerminalLeafId, makePaneKey, parsePaneKey } from '../../shared/stable-pane-id'
export { parseAppSshPtyId } from '../../shared/ssh-pty-id'
export { isValidHostTerminalTabId, isValidTerminalTabId } from '../../shared/terminal-tab-id'
export type { TerminalQuickCommandMutation } from '../../shared/terminal-quick-commands'
export { isPtyIncarnationId, type PtyIncarnationId } from '../../shared/pty-incarnation'
export {
  buildAgentDraftLaunchPlan,
  buildAgentResumeStartupPlan,
  buildAgentStartupPlan
} from '../../shared/tui-agent-startup'
export { repoIsRemote } from '../../shared/agent-launch-remote'
export {
  isAgentForegroundWrapperProcess,
  isExpectedAgentProcess,
  recognizeAgentProcess
} from '../../shared/agent-process-recognition'
export { isTuiAgentEnabled, pickTuiAgent } from '../../shared/tui-agent-selection'
export {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../shared/tui-agent-launch-defaults'
export { resolveLocalWindowsAgentStartupShell } from '../../shared/windows-terminal-shell'
export { isTuiAgent, TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
export { createDraftPasteReadyScanner } from '../../shared/draft-paste-ready-scanner'
export { detectInstalledAgentsWithShellPathHydration, detectRemoteAgents } from '../ipc/preflight'
export {
  markCodexProjectTrusted,
  markCopilotFolderTrusted,
  markCursorWorkspaceTrusted
} from '../agent-trust-presets'
export { markRemoteAgentWorkspaceTrusted } from '../remote-agent-trust-presets'
export { applyAgentStatusHooksEnabled } from '../agent-hooks/managed-agent-hook-controls'
export { recordManagedHookInstallFailure } from '../agent-hooks/install-telemetry'
export {
  isWindowsAbsolutePathLike,
  isPathInsideOrEqual,
  normalizeRuntimePathForComparison
} from '../../shared/cross-platform-path'
export { resolveTerminalStartupCwd } from '../../shared/terminal-startup-cwd'
export { isWslUncPath, parseWslUncPath } from '../../shared/wsl-paths'
export {
  folderWorkspaceKey,
  isWorkspaceKey,
  parseWorkspaceKey,
  worktreeWorkspaceKey
} from '../../shared/workspace-scope'
export {
  projectResolvedWorktreeLineage,
  sharesResolvedWorktreeLineageBoundary
} from '../../shared/resolved-worktree-lineage'
export { folderWorkspaceToWorktree } from '../../shared/folder-workspace-worktree'
export type {
  FolderWorkspacePathStatus,
  FolderWorkspacePathStatusRequest
} from '../../shared/folder-workspace-path-status'
export {
  applyMetadataFallbackVisibility,
  buildKnownOrcaWorkspaceLayouts,
  isLegacyRepoForExternalWorktreeVisibility,
  toDetectedWorktree
} from '../../shared/worktree-ownership'
export {
  createAgentScratchWorktreePathMatcher,
  type AgentScratchWorktreePathMatcher
} from '../../shared/agent-scratch-worktrees'
export {
  BROWSER_HEADLESS_RUNTIME_CAPABILITY,
  BROWSER_CERTIFICATE_TRUST_RUNTIME_CAPABILITY,
  MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
  ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY,
  ORCHESTRATION_CONTRACT_VERSION,
  REMOTE_RUNTIME_SHARED_CONTROL_CAPABILITY,
  RUNTIME_CAPABILITIES,
  RUNTIME_PROTOCOL_VERSION,
  TERMINAL_PAIRED_PARKING_RUNTIME_CAPABILITY,
  type RuntimeCapability
} from '../../shared/protocol-version'
export {
  configureAiVaultSessionSources,
  listAiVaultSessions
} from '../ai-vault/cached-session-list'
export type { AiVaultListArgs, AiVaultListResult } from '../../shared/ai-vault-types'
export type {
  AiVaultPrepareSessionResumeArgs,
  AiVaultPrepareSessionResumeResult
} from '../../shared/ai-vault-resume-preparation'
export type {
  WorkspacePortKillRequest,
  WorkspacePortKillResult,
  WorkspacePortProbe,
  WorkspacePortScanResult
} from '../../shared/workspace-ports'
export {
  filterWorkspacePortProbes,
  killWorkspacePort,
  scanWorkspacePortProbes
} from '../ports/workspace-port-ownership'
export { advertisedUrlWatcher } from '../ports/advertised-url-watcher'
export type { AutomationService } from '../automations/service'
export { RuntimeBrowserCommands } from './orca-runtime-browser'
export { RemoteRuntimeTerminalCreateIdempotency } from './remote-runtime-terminal-create-idempotency'
export { deriveRemoteRuntimeTerminalCreateHandle } from './remote-runtime-terminal-create-identity'
export {
  buildHeadlessTerminalSplitLayout,
  countTerminalLayoutLeaves
} from './headless-terminal-split-layout'
export { RECENT_PTY_OUTPUT_LIMIT } from './recent-pty-output-buffer'
export { TerminalOutputState, type RuntimeTerminalDataMeta } from './terminal-output-state'
export { RuntimeGithubProjectCommands } from './orca-runtime-github-project-commands'
export { RuntimeJiraCommands } from './orca-runtime-jira-commands'
export { WorktreeResolutionState } from './worktree-resolution-state'
export { RuntimeTerminalInputCommands } from './terminal-input-commands'
export { RuntimeLinearQueryCommands } from './orca-runtime-linear-query-commands'
export { RuntimeLinearConnectionCommands } from './orca-runtime-linear-connection-commands'
export { RuntimeReviewQueryCommands } from './orca-runtime-review-query-commands'
export { RuntimeReviewMutationCommands } from './orca-runtime-review-mutation-commands'
export { RuntimeRepoWorkItemCommands } from './orca-runtime-repo-work-item-commands'
export { RuntimeMessageWaiters, type MessageWaitResult } from './runtime-message-waiters'
export {
  buildHeadlessTabGroupMove,
  buildHeadlessTabGroupSplit
} from './headless-tab-group-split-layout'
export {
  hasExactTerminalOrphanGroupLayout,
  mergeTerminalOrphanGroupLayout
} from './terminal-orphan-topology'
export { terminalOrphanExecutionOwnersEqual } from './terminal-orphan-owner'
export {
  retireTerminalSurfacesFromSnapshot,
  type RetiredTerminalSurface
} from './mobile-session-terminal-retirement'
export { retireTerminalSurfaceFromPersistence } from './mobile-session-terminal-persistence-retirement'
export {
  advanceTerminalTopologyRevision,
  hasHostAuthoritativeTerminalMembership
} from './workspace-session-terminal-membership-authority'
export { RuntimeEmulatorCommands, setEmulatorBridge } from './orca-runtime-emulator'
export type { EmulatorBridge } from '../emulator/emulator-bridge'
export { RuntimeFileCommands } from './orca-runtime-files'
export { RuntimeGitCommands } from './orca-runtime-git'
export {
  appendRecentPtyPathCandidates,
  recentTerminalOutputIncludesPath,
  recentTerminalPathCandidatesIncludePath
} from './terminal-output-path-candidates'
export {
  detectTerminalWaitBlockedReason,
  isKnownReadyPromptPreview
} from './terminal-wait-detection'
export {
  buildPreview,
  buildTerminalWaitText,
  computeTerminalTailWaitState,
  MAX_TAIL_CHARS,
  tailGainedNewerBlockedReason,
  type TerminalTailWaitState
} from './terminal-tail-wait-state'
export { appendNormalizedToTailBuffer } from './terminal-tail-buffer'
export type { RetainedTailRedrawCursor } from './terminal-tail-types'
export {
  appendCompletedTerminalTranscript,
  tailStateMatches
} from './terminal-tail-state-comparison'
export { normalizeTerminalChunk } from './terminal-output-normalization'
export {
  DEFAULT_TERMINAL_READ_LIMIT,
  readTerminalTail,
  terminalReadLimit,
  shouldFallbackToVisibleTerminalSnapshot,
  visibleNonBlankTerminalLines,
  buildVisibleSnapshotReadFallback
} from './terminal-read-pagination'
export {
  MOBILE_AUTO_RESTORE_FIT_MAX_MS,
  MOBILE_AUTO_RESTORE_FIT_MIN_MS,
  TUI_IDLE_DEFAULT_TIMEOUT_MS,
  TUI_IDLE_POLL_INTERVAL_MS,
  TUI_IDLE_QUIESCENCE_MS,
  assertTerminalInputWithinLimitWithYield,
  buildSendPayload,
  buildPtyTerminalWaitResult,
  buildPtyTerminalWaitBlockedResult,
  buildTerminalWaitResult,
  buildTerminalWaitBlockedResult,
  detectExplicitIdleStatusFromTitle,
  getTerminalState
} from './terminal-wait-results'
export {
  activateClientSessionTabSelection,
  ClientSessionTabSelectionStore,
  deriveClientSessionTabSelection,
  projectClientSessionTabSelection
} from './client-session-tab-selection'
export type {
  PtyProviderBufferSnapshot,
  IPtyProvider,
  PtyProcessInfo,
  PtyTransientFact
} from '../providers/types'
export { ClaudeAgentTeamsService } from './claude-agent-teams-service'
export type {
  AgentTeamsTmuxCompatRequest,
  AgentTeamsTmuxCompatResponse
} from './claude-agent-teams-service'
export {
  buildClaudeAgentTeamsLaunchPlan,
  ensureClaudeAgentTeamsShimDir,
  resolveClaudeAgentTeamsShimBin
} from './claude-agent-teams-shim-env'
export {
  addClaudeTeammateModeAuto,
  addClaudeTeammateModeInProcess
} from '../../shared/claude-agent-teams-tmux-compat'
export { collectMemorySnapshot } from '../memory/collector'
export { app, BrowserWindow, ipcMain, Notification } from 'electron'
export type { AgentBrowserBridge } from '../browser/agent-browser-bridge'
export type { BrowserBackend } from '../browser/browser-backend'
export { BrowserError } from '../browser/cdp-bridge'
export { getRepoSlug, getRepoUpstream } from '../github/client'
export type { getPRForBranch } from '../github/client'
export { resolveGitHubPrStartPoint } from '../github/pr-start-point'
export {
  fetchGitHubPullRequestHeadRef,
  fetchPrHeadTrackingRef
} from '../github/pr-head-tracking-ref'
export {
  gitlabMergeRequestHeadLocalRef,
  reviewHeadRemoteRefComponent
} from '../../shared/review-head-tracking-ref'
export { fetchGitLabMergeRequestHeadRef } from '../gitlab/mr-head-tracking-ref'
export { isTransientReviewHeadFetchError } from '../git/fetch-error-classification'
export { resolveGitHubReviewHeadRemote } from '../github/review-head-remote'
export { fetchCompareBaseRefWithLocalFallback } from '../git/compare-base-ref-fetch'
export { pickPreferredGitRemote } from '../../shared/preferred-git-remote'
export {
  closeMR as closeGitLabMR,
  createIssue as createGitLabIssue,
  diagnoseAuth as diagnoseGitLabAuthClient,
  getJobTrace as getGitLabJobTrace,
  getProjectRefForRemote as getGitLabProjectRefForRemote,
  getRateLimit as getGitLabRateLimit,
  getWorkItemByProjectRef as getGitLabWorkItemByProjectRef,
  addIssueComment as addGitLabIssueComment,
  addMRInlineComment as addGitLabMRInlineComment,
  addMRComment as addGitLabMRComment,
  listTodos as listGitLabTodos,
  listIssues as listGitLabIssues,
  listLabels as listGitLabLabels,
  listMergeRequests as listGitLabMergeRequests,
  listWorkItems as listGitLabWorkItems,
  mergeMR as mergeGitLabMR,
  reopenMR as reopenGitLabMR,
  resolveMRDiscussion as resolveGitLabMRDiscussion,
  retryJob as retryGitLabJob,
  updateMR as updateGitLabMR,
  updateMRReviewers as updateGitLabMRReviewers,
  updateIssue as updateGitLabIssue
} from '../gitlab/client'
export { getGlabKnownHosts } from '../gitlab/gl-utils'
export { getWorkItemDetails as getGitLabWorkItemDetails } from '../gitlab/work-item-details'
export {
  normalizeGitLabIssueListArgs,
  normalizeGitLabMRListState,
  normalizeGitLabPositiveInteger,
  type GitLabIssueListState
} from '../gitlab/gitlab-preload-args'
export { recordGitLabProjectRecent } from '../gitlab/gitlab-project-recents'
export type {
  CreateHostedReviewInput,
  CreateHostedReviewResult,
  HostedReviewCreationEligibility,
  HostedReviewCreationEligibilityArgs,
  HostedReviewInfo
} from '../../shared/hosted-review'
export { getHostedReviewForBranch as getHostedReviewForBranchFromRepo } from '../source-control/hosted-review'
export {
  createHostedReview as createHostedReviewFromRepo,
  getHostedReviewCreationEligibility as getHostedReviewCreationEligibilityFromRepo
} from '../source-control/hosted-review-creation'
export {
  getLocalProjectGitExecOptions,
  getLocalProjectWorktreeGitOptions,
  getLocalProjectWorktreeGitOptionsForRuntime,
  resolveLocalProjectRuntimeForRepo,
  resolveLocalProjectRuntimesForRepos
} from '../project-runtime-git-options'
export { resolveLocalProjectRuntimeForWorktreeId } from '../local-project-runtime-resolution'
export type { ProjectExecutionRuntimeResolution } from '../../shared/project-execution-runtime'
export { resolveTerminalOrchestrationCliCommand } from './orchestration/cli-command'
export {
  getLocalWorktreePathAccess,
  removeLocalWorktreePath,
  toLocalWorktreeRuntimePath
} from '../local-worktree-filesystem'
export {
  removeStaleLocalWorktreeRegistrationAfterFilesystemRemoval,
  recoverLocalWindowsWorktreeRemoval
} from '../local-worktree-removal-recovery'
export { getStatus as getLinearStatus, isAuthError as isLinearAuthError } from '../linear/client'
export {
  addIssueCommentForAgent as addLinearIssueCommentForAgent,
  createIssueAttachment as createLinearIssueAttachment,
  createIssueForAgent as createLinearIssueForAgent,
  getAttachmentByUuidForAgent as getLinearAttachmentByUuidForAgent,
  getCommentByUuidForAgent as getLinearCommentByUuidForAgent,
  getIssueByUuidForAgent as getLinearIssueByUuidForAgent,
  getIssueCommentThreadRoot as getLinearIssueCommentThreadRoot,
  listIssues as listLinearIssues,
  updateIssueForAgent as updateLinearIssueForAgent,
  LinearWriteFailure
} from '../linear/issues'
export {
  LinearAgentAccessError,
  getLinearCurrentIssueFromWorktree,
  readLinearIssueContext,
  resolveLegacyLinearLinkWorkspace
} from '../linear/issue-context'
export {
  classifyLinearError,
  linearError,
  linearMessage,
  sanitizeLinearErrorMessage
} from '../linear/issue-context-errors'
export { listMcpIssues } from '../linear/mcp-issue-list'
export { writeIssueRelation } from '../linear/issue-relation-write'
export {
  getProject as getLinearProject,
  listProjectsByExactName as listLinearProjectsByExactName,
  listProjectTeams as listLinearProjectTeams,
  listProjects as listLinearProjects
} from '../linear/projects'
export {
  getTeamLabelsOrThrow as getLinearTeamLabelsOrThrow,
  getTeamMembersOrThrow as getLinearTeamMembersOrThrow,
  getTeamStatesOrThrow as getLinearTeamStatesOrThrow,
  getViewerForWorkspaceOrThrow as getLinearViewerForWorkspaceOrThrow,
  listTeamsForAgent as listLinearTeamsForAgent,
  listTeamsOrThrow as listLinearTeamsOrThrow
} from '../linear/teams'
export {
  getBaseRefDefault,
  getDefaultRemote,
  getBranchConflictKind,
  isGitRepo,
  getRepoName,
  searchBaseRefDetails,
  getRemoteCount,
  normalizeRefSearchQuery,
  parseAndFilterSearchRefDetails,
  parseRemoteCount,
  resolveDefaultBaseRefViaExec,
  resolveDefaultBaseRefWithLocalGit,
  buildSearchBaseRefsArgv,
  isForEachRefExcludeUnsupportedError,
  mergeBaseRefSearchResultGroups,
  getRemoteDrift,
  getRecentDriftSubjects
} from '../git/repo'
export { hasCommitObjectViaGitExec } from '../git/commit-object-ref'
export { hasWorktreeBaseCommitRef } from '../git/worktree-base-ref-probe'
export { resolveLocalGitUsername } from '../git/git-username'
export { getSshGitCapabilityCache } from '../git/git-capability-state'
export {
  listWorktrees,
  listWorktreesStrict,
  addWorktree,
  addSparseWorktree,
  assertWorktreeCleanForRemoval,
  forceDeleteLocalBranch,
  removeWorktree
} from '../git/worktree'
export type { AddWorktreeOptions, AddWorktreeResult } from '../git/worktree'
export { isENOENT, invalidateAuthorizedRootsCache } from '../ipc/filesystem-auth'
export {
  createSetupRunnerScript,
  getDefaultTabsLaunch,
  getEffectiveHooks,
  loadHooks,
  runHook,
  shouldRunSetupForCreate
} from '../hooks'
export {
  DEFAULT_REPO_BADGE_COLOR,
  FLOATING_TERMINAL_WORKTREE_ID,
  getDefaultVoiceSettings
} from '../../shared/constants'
export { listRepoWorktrees } from '../repo-worktrees'
export {
  createWorktreeCopiedPaths,
  createWorktreeLinkedPaths,
  createWorktreeSharedPaths,
  findExistingWorktreeSymlinkPaths,
  removeWorktreeLinkedPaths
} from '../ipc/worktree-symlinks'
export { formatWorktreeIncludeCopyWarning } from '../ipc/worktree-include-copy-budget'
export { resolveWorktreeIncludePaths } from '../git/worktree-include-file'
export {
  getWorktreeSharedLinkPaths,
  resolveWorktreeSharedDirectories
} from '../git/worktree-shared-directories'
export { deleteWorktreeHistoryDir } from '../terminal-history-deletion'
export {
  cleanupUnusedWorktreePushTargetRemote,
  cleanupUnusedWorktreePushTargetRemoteSsh,
  createRemoteWorktree,
  configureCreatedWorktreePushTarget,
  prepareWorktreePushTarget
} from '../ipc/worktree-remote'
export {
  getBranchNameOverrideCandidate,
  getWorktreeCreateCandidate,
  WORKTREE_CREATE_MAX_SUFFIX_ATTEMPTS
} from '../worktree-create-candidates'
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
export type { VoiceSettings } from '../../shared/speech-types'
export { getSpeechModelManager, getSpeechSttService } from '../speech/speech-runtime-service'
export { getCatalogModel, isLocalSpeechModel, SPEECH_MODEL_CATALOG } from '../speech/model-catalog'
export {
  deleteLocalSpeechModel,
  getSpeechModelDeletionErrorCode
} from '../speech/speech-model-deletion'
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
  RuntimeAutomationCommands,
  type RuntimeAutomationCreateInput,
  type RuntimeAutomationUpdateInput
} from './runtime-automation-commands'
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
  isCursorAgentOrchestrationTarget,
  mergeTerminalEnvDeletionKeys,
  normalizeSparsePresetDirectoriesForSave,
  normalizeSparsePresetName,
  resolveBareAgentLaunchCommand
} from './runtime-agent-launch-resolution'

