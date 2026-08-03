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
export type { AgentBrowserBridge } from '../browser/agent-browser-command-bridge'
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
