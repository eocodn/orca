import type { ExecutionHostId } from './execution-host'
import type { RemovedSshTargetTombstone, SshRemotePtyLease, SshTarget } from './ssh-types'
import type { Automation, AutomationExecutionTargetType, AutomationRun } from './automations-types'
import type { WorkspaceSource } from './workspace-source'
import type { ReleaseBuild, ReleaseChannel } from './release-channel'
import type { GitHubProjectSettings } from './github-project-types'
import type {
  AgentStatusState,
  AgentType,
  MigrationUnsupportedPtyEntry
} from './agent-status-types'
import type { VoiceSettings } from './speech-types'
import type { WorkspaceCleanupUIState } from './workspace-cleanup'
import type { LargeDiffRenderLimit } from './large-diff-render-limit'
import type { GitLabProjectSettings } from './gitlab-types'
import type { TaskProvider } from './task-providers'
import type { FeatureTipId } from './feature-tips'
import type { ContextualTourId } from './contextual-tours'
import type {
  FeatureInteractionState,
  FeatureInteractionTelemetryBucketState
} from './feature-interactions'
import type { GitBranchChangeStatus } from './git-status-types'
import type { KeybindingOverrides, TerminalShortcutPolicy } from './keybindings'
import type { RepoIcon } from './repo-icon'
import type { AppIconId } from './app-icon'
import type {
  RepoSourceControlAiOverrides,
  SourceControlAiSettings
} from './source-control-ai-types'
import type { StartupCommandDelivery } from './codex-startup-delivery'
import type { AgentKind, LaunchSource, RequestKind } from './telemetry-events'
import type { SleepingAgentLaunchConfig, SleepingAgentSessionRecord } from './agent-session-resume'
import type { ClaudeAgentTeamsMode } from './claude-agent-teams-tmux-compat'
import type { TerminalCustomTheme } from './terminal-custom-themes'
import type { UiLanguage } from './ui-language'
import type { ForkSyncMode } from './git-fork-sync'
import type { GitRemoteIdentity } from './git-remote-identity'
import type {
  GlobalWindowsRuntimeDefault,
  LocalWindowsRuntimePreference
} from './project-execution-runtime'
import type { UsagePercentageDisplay } from './usage-percentage-display'
import type { StatusBarUsageMode } from './status-bar-usage-mode'
import type { PersistedNativeChatSessionOptions } from './native-chat-session-options'
import type { CodexResetCreditAttemptLedger } from './codex-reset-credit-attempt-ledger'
import type { TaskSourceContext } from './task-source-context'

// Re-exported for backward compat with renderer call sites that import
import type * as SharedTypeDefinitions from "./types"
type ShellHydrationFailureReason = SharedTypeDefinitions.ShellHydrationFailureReason; type PathSource = SharedTypeDefinitions.PathSource; type RepoKind = SharedTypeDefinitions.RepoKind; type IssueSourcePreference = SharedTypeDefinitions.IssueSourcePreference; type ExternalWorktreeVisibility = SharedTypeDefinitions.ExternalWorktreeVisibility; type ProjectProviderIdentity = SharedTypeDefinitions.ProjectProviderIdentity; type Project = SharedTypeDefinitions.Project; type ProjectUpdateArgs = SharedTypeDefinitions.ProjectUpdateArgs; type ProjectHostSetupState = SharedTypeDefinitions.ProjectHostSetupState; type ProjectHostSetupMethod = SharedTypeDefinitions.ProjectHostSetupMethod; type RepoProjectHostSetupMethod = SharedTypeDefinitions.RepoProjectHostSetupMethod; type ProjectHostSetup = SharedTypeDefinitions.ProjectHostSetup; type ProjectHostSetupExistingFolderArgs = SharedTypeDefinitions.ProjectHostSetupExistingFolderArgs; type ProjectHostSetupCreateArgs = SharedTypeDefinitions.ProjectHostSetupCreateArgs; type ProjectHostSetupCloneArgs = SharedTypeDefinitions.ProjectHostSetupCloneArgs; type ProjectHostSetupUpdateArgs = SharedTypeDefinitions.ProjectHostSetupUpdateArgs; type ProjectHostSetupDeleteArgs = SharedTypeDefinitions.ProjectHostSetupDeleteArgs; type ProjectHostSetupResult = SharedTypeDefinitions.ProjectHostSetupResult; type ProjectHostSetupCreateResult = SharedTypeDefinitions.ProjectHostSetupCreateResult; type ProjectHostSetupUpdateResult = SharedTypeDefinitions.ProjectHostSetupUpdateResult; type ProjectHostSetupDeleteResult = SharedTypeDefinitions.ProjectHostSetupDeleteResult; type Repo = SharedTypeDefinitions.Repo; type ProjectGroupCreatedFrom = SharedTypeDefinitions.ProjectGroupCreatedFrom; type ProjectGroup = SharedTypeDefinitions.ProjectGroup; type WorkspaceScope = SharedTypeDefinitions.WorkspaceScope; type WorkspaceKey = SharedTypeDefinitions.WorkspaceKey; type FolderWorkspace = SharedTypeDefinitions.FolderWorkspace; type WorkspaceLinkedItem = SharedTypeDefinitions.WorkspaceLinkedItem; type FolderWorkspaceLinkedTask = SharedTypeDefinitions.FolderWorkspaceLinkedTask; type NestedRepoScanOptions = SharedTypeDefinitions.NestedRepoScanOptions; type NestedRepoCandidate = SharedTypeDefinitions.NestedRepoCandidate; type NestedRepoScanResult = SharedTypeDefinitions.NestedRepoScanResult; type ProjectGroupImportMode = SharedTypeDefinitions.ProjectGroupImportMode; type ProjectGroupImportProjectResult = SharedTypeDefinitions.ProjectGroupImportProjectResult; type ProjectGroupImportResult = SharedTypeDefinitions.ProjectGroupImportResult; type SetupRunPolicy = SharedTypeDefinitions.SetupRunPolicy; type SetupAgentStartupPolicy = SharedTypeDefinitions.SetupAgentStartupPolicy; type SetupDecision = SharedTypeDefinitions.SetupDecision; type HookCommandSourcePolicy = SharedTypeDefinitions.HookCommandSourcePolicy; type BaseRefDefaultResult = SharedTypeDefinitions.BaseRefDefaultResult; type BaseRefSearchResult = SharedTypeDefinitions.BaseRefSearchResult; type GitWorktreeInfo = SharedTypeDefinitions.GitWorktreeInfo; type WorktreeHeadIdentity = SharedTypeDefinitions.WorktreeHeadIdentity; type WorkspaceStatus = SharedTypeDefinitions.WorkspaceStatus; type WorkspaceStatusDefinition = SharedTypeDefinitions.WorkspaceStatusDefinition; type Worktree = SharedTypeDefinitions.Worktree; type CliWorkspaceProvenance = SharedTypeDefinitions.CliWorkspaceProvenance; type AutomationWorkspaceProvenance = SharedTypeDefinitions.AutomationWorkspaceProvenance; type AutomationWorkspaceProvenanceRequest = SharedTypeDefinitions.AutomationWorkspaceProvenanceRequest; type GitPushTarget = SharedTypeDefinitions.GitPushTarget; type GitHubPrStartPoint = SharedTypeDefinitions.GitHubPrStartPoint; type WorktreeMeta = SharedTypeDefinitions.WorktreeMeta; type WorktreeOwnership = SharedTypeDefinitions.WorktreeOwnership; type DetectedWorktreeListSource = SharedTypeDefinitions.DetectedWorktreeListSource; type DetectedWorktree = SharedTypeDefinitions.DetectedWorktree; type DetectedWorktreeListResult = SharedTypeDefinitions.DetectedWorktreeListResult; type WorktreeLineageOrigin = SharedTypeDefinitions.WorktreeLineageOrigin; type WorktreeLineageCaptureConfidence = SharedTypeDefinitions.WorktreeLineageCaptureConfidence; type WorktreeLineageCaptureSource = SharedTypeDefinitions.WorktreeLineageCaptureSource; type WorktreeLineageCapture = SharedTypeDefinitions.WorktreeLineageCapture; type WorktreeLineage = SharedTypeDefinitions.WorktreeLineage; type WorkspaceLineage = SharedTypeDefinitions.WorkspaceLineage; type WorktreeLineageWarningCode = SharedTypeDefinitions.WorktreeLineageWarningCode; type WorktreeLineageWarning = SharedTypeDefinitions.WorktreeLineageWarning; type DiffCommentSource = SharedTypeDefinitions.DiffCommentSource; type DiffReviewScope = SharedTypeDefinitions.DiffReviewScope; type MobileDiffReviewFileState = SharedTypeDefinitions.MobileDiffReviewFileState; type MobileDiffReviewState = SharedTypeDefinitions.MobileDiffReviewState; type DiffComment = SharedTypeDefinitions.DiffComment; type TabGroupSplitDirection = SharedTypeDefinitions.TabGroupSplitDirection; type TabGroupLayoutNode = SharedTypeDefinitions.TabGroupLayoutNode; type TabContentType = SharedTypeDefinitions.TabContentType; type WorkspaceVisibleTabType = SharedTypeDefinitions.WorkspaceVisibleTabType; type CtrlTabOrderMode = SharedTypeDefinitions.CtrlTabOrderMode; type Tab = SharedTypeDefinitions.Tab; type TabGroup = SharedTypeDefinitions.TabGroup; type TerminalTab = SharedTypeDefinitions.TerminalTab; type BrowserHistoryEntry = SharedTypeDefinitions.BrowserHistoryEntry; type BrowserLoadError = SharedTypeDefinitions.BrowserLoadError; type BrowserCertificateFailure = SharedTypeDefinitions.BrowserCertificateFailure; type BrowserCertificateProceedFailureReason = SharedTypeDefinitions.BrowserCertificateProceedFailureReason; type BrowserCertificateProceedResult = SharedTypeDefinitions.BrowserCertificateProceedResult; type BrowserViewportPresetId = SharedTypeDefinitions.BrowserViewportPresetId; type BrowserViewportOverride = SharedTypeDefinitions.BrowserViewportOverride; type BrowserPage = SharedTypeDefinitions.BrowserPage; type BrowserWorkspace = SharedTypeDefinitions.BrowserWorkspace; type BrowserTab = SharedTypeDefinitions.BrowserTab; type BrowserSessionProfileScope = SharedTypeDefinitions.BrowserSessionProfileScope; type BrowserSessionProfileSource = SharedTypeDefinitions.BrowserSessionProfileSource; type BrowserSessionProfile = SharedTypeDefinitions.BrowserSessionProfile; type BrowserCookieImportSummary = SharedTypeDefinitions.BrowserCookieImportSummary; type BrowserCookieImportResult = SharedTypeDefinitions.BrowserCookieImportResult; type TerminalPaneSplitDirection = SharedTypeDefinitions.TerminalPaneSplitDirection; type TerminalPaneLayoutNode = SharedTypeDefinitions.TerminalPaneLayoutNode; type TerminalLayoutSnapshot = SharedTypeDefinitions.TerminalLayoutSnapshot; type PersistedOpenFile = SharedTypeDefinitions.PersistedOpenFile; type WorkspaceSessionState = SharedTypeDefinitions.WorkspaceSessionState; type WorkspaceSessionPatch = SharedTypeDefinitions.WorkspaceSessionPatch; type PRState = SharedTypeDefinitions.PRState; type IssueState = SharedTypeDefinitions.IssueState; type CheckStatus = SharedTypeDefinitions.CheckStatus; type PRMergeableState = SharedTypeDefinitions.PRMergeableState; type PRReviewDecision = SharedTypeDefinitions.PRReviewDecision; type PRConflictSummary = SharedTypeDefinitions.PRConflictSummary; type GitHubRepositoryIdentity = SharedTypeDefinitions.GitHubRepositoryIdentity; type GitHubPRMergeMethod = SharedTypeDefinitions.GitHubPRMergeMethod; type GitHubPRMergeMethodSettings = SharedTypeDefinitions.GitHubPRMergeMethodSettings; type PRInfo = SharedTypeDefinitions.PRInfo; type PRRefreshErrorType = SharedTypeDefinitions.PRRefreshErrorType; type PRRefreshUpstreamErrorType = SharedTypeDefinitions.PRRefreshUpstreamErrorType; type PRRefreshOutcome = SharedTypeDefinitions.PRRefreshOutcome; type GitHubPRRefreshReason = SharedTypeDefinitions.GitHubPRRefreshReason; type GitHubPRRefreshEnqueueResult = SharedTypeDefinitions.GitHubPRRefreshEnqueueResult; type GitHubPRRefreshAlias = SharedTypeDefinitions.GitHubPRRefreshAlias; type GitHubPRRefreshCandidate = SharedTypeDefinitions.GitHubPRRefreshCandidate; type GitHubPRRefreshSkippedReason = SharedTypeDefinitions.GitHubPRRefreshSkippedReason; type GitHubPRRefreshEvent = SharedTypeDefinitions.GitHubPRRefreshEvent; type PRCheckDetail = SharedTypeDefinitions.PRCheckDetail; type PRCheckAnnotation = SharedTypeDefinitions.PRCheckAnnotation; type PRCheckStep = SharedTypeDefinitions.PRCheckStep; type PRCheckJob = SharedTypeDefinitions.PRCheckJob; type PRCheckRunDetails = SharedTypeDefinitions.PRCheckRunDetails; type GitHubRerunPRChecksResult = SharedTypeDefinitions.GitHubRerunPRChecksResult; type GitHubReactionContent = SharedTypeDefinitions.GitHubReactionContent; type GitHubReaction = SharedTypeDefinitions.GitHubReaction; type PRComment = SharedTypeDefinitions.PRComment; type GitHubIssueTimelineTarget = SharedTypeDefinitions.GitHubIssueTimelineTarget; type GitHubIssueTimelineItem = SharedTypeDefinitions.GitHubIssueTimelineItem; type GitHubCommentResult = SharedTypeDefinitions.GitHubCommentResult; type IssueInfo = SharedTypeDefinitions.IssueInfo; type GitHubViewer = SharedTypeDefinitions.GitHubViewer; type GitHubAssignableUser = SharedTypeDefinitions.GitHubAssignableUser; type ProviderCheckSummary = SharedTypeDefinitions.ProviderCheckSummary; type GitHubPRReviewSummary = SharedTypeDefinitions.GitHubPRReviewSummary; type GitHubPRFileViewedState = SharedTypeDefinitions.GitHubPRFileViewedState; type GitHubWorkItem = SharedTypeDefinitions.GitHubWorkItem; type GitHubPRFile = SharedTypeDefinitions.GitHubPRFile; type GitHubPRFileContents = SharedTypeDefinitions.GitHubPRFileContents; type GitHubPRReviewCommentInput = SharedTypeDefinitions.GitHubPRReviewCommentInput; type GitHubWorkItemDetails = SharedTypeDefinitions.GitHubWorkItemDetails; type LinearViewer = SharedTypeDefinitions.LinearViewer; type LinearWorkspace = SharedTypeDefinitions.LinearWorkspace; type LinearWorkspaceSelection = SharedTypeDefinitions.LinearWorkspaceSelection; type LinearWorkspaceSelector = SharedTypeDefinitions.LinearWorkspaceSelector; type LinearConcreteWorkspaceId = SharedTypeDefinitions.LinearConcreteWorkspaceId; type LinearWorkspaceError = SharedTypeDefinitions.LinearWorkspaceError; type LinearCollectionResult = SharedTypeDefinitions.LinearCollectionResult; type LinearConnectionStatus = SharedTypeDefinitions.LinearConnectionStatus; type LinearIssue = SharedTypeDefinitions.LinearIssue; type LinearProjectSummary = SharedTypeDefinitions.LinearProjectSummary; type LinearProjectStatusSummary = SharedTypeDefinitions.LinearProjectStatusSummary; type LinearProjectMemberSummary = SharedTypeDefinitions.LinearProjectMemberSummary; type LinearProjectMilestoneSummary = SharedTypeDefinitions.LinearProjectMilestoneSummary; type LinearProjectResourceSummary = SharedTypeDefinitions.LinearProjectResourceSummary; type LinearProjectUpdateSummary = SharedTypeDefinitions.LinearProjectUpdateSummary; type LinearProjectDetail = SharedTypeDefinitions.LinearProjectDetail; type LinearCustomViewModel = SharedTypeDefinitions.LinearCustomViewModel; type LinearCustomViewSummary = SharedTypeDefinitions.LinearCustomViewSummary; type LinearIssueChildSummary = SharedTypeDefinitions.LinearIssueChildSummary; type LinearComment = SharedTypeDefinitions.LinearComment; type GitHubCreateIssueFields = SharedTypeDefinitions.GitHubCreateIssueFields; type GitHubCreateIssueResult = SharedTypeDefinitions.GitHubCreateIssueResult; type GitHubIssueCloseReason = SharedTypeDefinitions.GitHubIssueCloseReason; type GitHubIssueUpdate = SharedTypeDefinitions.GitHubIssueUpdate; type GitHubPullRequestStateUpdate = SharedTypeDefinitions.GitHubPullRequestStateUpdate; type LinearIssueUpdate = SharedTypeDefinitions.LinearIssueUpdate; type ClassifiedError = SharedTypeDefinitions.ClassifiedError; type GitHubOwnerRepo = SharedTypeDefinitions.GitHubOwnerRepo; type GitHubRateLimitBucket = SharedTypeDefinitions.GitHubRateLimitBucket; type GitHubRateLimitSnapshot = SharedTypeDefinitions.GitHubRateLimitSnapshot; type GetRateLimitResult = SharedTypeDefinitions.GetRateLimitResult; type ListWorkItemsResult = SharedTypeDefinitions.ListWorkItemsResult; type LinearWorkflowState = SharedTypeDefinitions.LinearWorkflowState; type LinearLabel = SharedTypeDefinitions.LinearLabel; type LinearMember = SharedTypeDefinitions.LinearMember; type LinearTeam = SharedTypeDefinitions.LinearTeam; type OrcaHooks = SharedTypeDefinitions.OrcaHooks; type OrcaWorktreeDefaults = SharedTypeDefinitions.OrcaWorktreeDefaults; type OrcaDefaultTabTemplate = SharedTypeDefinitions.OrcaDefaultTabTemplate; type OrcaVmRecipe = SharedTypeDefinitions.OrcaVmRecipe; type OrcaVmRecipeDiagnostic = SharedTypeDefinitions.OrcaVmRecipeDiagnostic; type RepoHookSettings = SharedTypeDefinitions.RepoHookSettings; type WorktreeSetupLaunch = SharedTypeDefinitions.WorktreeSetupLaunch; type WorktreeStartupLaunch = SharedTypeDefinitions.WorktreeStartupLaunch; type WorktreeDefaultTabsLaunch = SharedTypeDefinitions.WorktreeDefaultTabsLaunch; type WorktreeCreateTimingPhase = SharedTypeDefinitions.WorktreeCreateTimingPhase; type WorktreeCreateTiming = SharedTypeDefinitions.WorktreeCreateTiming; type CreateSparseCheckoutRequest = SharedTypeDefinitions.CreateSparseCheckoutRequest; type SparsePreset = SharedTypeDefinitions.SparsePreset; type CreateWorktreeArgs = SharedTypeDefinitions.CreateWorktreeArgs; type CreateWorktreeResult = SharedTypeDefinitions.CreateWorktreeResult; type WorktreeCreateBaseFallback = SharedTypeDefinitions.WorktreeCreateBaseFallback; type PreservedWorktreeBranch = SharedTypeDefinitions.PreservedWorktreeBranch; type RemoveWorktreeResult = SharedTypeDefinitions.RemoveWorktreeResult; type ForceDeleteWorktreeBranchResult = SharedTypeDefinitions.ForceDeleteWorktreeBranchResult; type LocalBaseRefRefreshResult = SharedTypeDefinitions.LocalBaseRefRefreshResult; type LocalBaseRefUpdateSuggestion = SharedTypeDefinitions.LocalBaseRefUpdateSuggestion; type WorktreeBaseStatusKind = SharedTypeDefinitions.WorktreeBaseStatusKind; type WorktreeBaseStatusEvent = SharedTypeDefinitions.WorktreeBaseStatusEvent; type WorktreeRemoteBranchConflictEvent = SharedTypeDefinitions.WorktreeRemoteBranchConflictEvent; type ChangelogRelease = SharedTypeDefinitions.ChangelogRelease; type ChangelogData = SharedTypeDefinitions.ChangelogData; type UpdateCheckOptions = SharedTypeDefinitions.UpdateCheckOptions; type UpdateSource = SharedTypeDefinitions.UpdateSource; type UpdateStatus = SharedTypeDefinitions.UpdateStatus; type ReleaseBuildListResult = SharedTypeDefinitions.ReleaseBuildListResult; type NotificationSettings = SharedTypeDefinitions.NotificationSettings; type CodexManagedAccount = SharedTypeDefinitions.CodexManagedAccount; type CodexManagedAccountSummary = SharedTypeDefinitions.CodexManagedAccountSummary; type CodexSystemDefaultIdentity = SharedTypeDefinitions.CodexSystemDefaultIdentity; type CodexRateLimitAccountsState = SharedTypeDefinitions.CodexRateLimitAccountsState; type CodexManagedAccountRuntimeSelection = SharedTypeDefinitions.CodexManagedAccountRuntimeSelection; type ClaudeManagedAccount = SharedTypeDefinitions.ClaudeManagedAccount; type ClaudeManagedAccountSummary = SharedTypeDefinitions.ClaudeManagedAccountSummary; type ClaudeRateLimitAccountsState = SharedTypeDefinitions.ClaudeRateLimitAccountsState; type ClaudeManagedAccountRuntimeSelection = SharedTypeDefinitions.ClaudeManagedAccountRuntimeSelection; type TuiAgent = SharedTypeDefinitions.TuiAgent; type TaskViewPresetId = SharedTypeDefinitions.TaskViewPresetId; type SetupScriptLaunchMode = SharedTypeDefinitions.SetupScriptLaunchMode; type SetupSplitDirection = SharedTypeDefinitions.SetupSplitDirection; type TerminalColorOverrides = SharedTypeDefinitions.TerminalColorOverrides; type TerminalQuickCommandScope = SharedTypeDefinitions.TerminalQuickCommandScope; type TerminalQuickCommandAction = SharedTypeDefinitions.TerminalQuickCommandAction; type TerminalQuickCommandBase = SharedTypeDefinitions.TerminalQuickCommandBase; type TerminalCommandQuickCommand = SharedTypeDefinitions.TerminalCommandQuickCommand; type TerminalAgentQuickCommand = SharedTypeDefinitions.TerminalAgentQuickCommand; type TerminalQuickCommand = SharedTypeDefinitions.TerminalQuickCommand; type OpenInApplication = SharedTypeDefinitions.OpenInApplication; type SourceControlViewMode = SharedTypeDefinitions.SourceControlViewMode; type SourceControlGroupOrder = SharedTypeDefinitions.SourceControlGroupOrder; type LeftSidebarAppearanceMode = SharedTypeDefinitions.LeftSidebarAppearanceMode; type BranchPrefixStrategy = SharedTypeDefinitions.BranchPrefixStrategy; type FloatingTerminalCwdRequest = SharedTypeDefinitions.FloatingTerminalCwdRequest; type HostSettingOverrides = SharedTypeDefinitions.HostSettingOverrides; type AgentDashboardMode = SharedTypeDefinitions.AgentDashboardMode; type GlobalSettings = SharedTypeDefinitions.GlobalSettings; type FilesystemPathFlavor = SharedTypeDefinitions.FilesystemPathFlavor; type DirEntry = SharedTypeDefinitions.DirEntry; type MarkdownDocument = SharedTypeDefinitions.MarkdownDocument; type FsChangeEvent = SharedTypeDefinitions.FsChangeEvent; type FsChangedPayload = SharedTypeDefinitions.FsChangedPayload; type GitBranchChangeEntry = SharedTypeDefinitions.GitBranchChangeEntry; type GitBranchCompareSummary = SharedTypeDefinitions.GitBranchCompareSummary; type GitBranchCompareResult = SharedTypeDefinitions.GitBranchCompareResult; type GitCommitCompareSummary = SharedTypeDefinitions.GitCommitCompareSummary; type GitCommitCompareResult = SharedTypeDefinitions.GitCommitCompareResult; type GitDiffTextResult = SharedTypeDefinitions.GitDiffTextResult; type GitDiffBinaryResult = SharedTypeDefinitions.GitDiffBinaryResult; type GitDiffResult = SharedTypeDefinitions.GitDiffResult; type SearchMatch = SharedTypeDefinitions.SearchMatch; type SearchFileResult = SharedTypeDefinitions.SearchFileResult; type SearchResult = SharedTypeDefinitions.SearchResult; type SearchOptions = SharedTypeDefinitions.SearchOptions; type StatsSummary = SharedTypeDefinitions.StatsSummary; type UsageValues = SharedTypeDefinitions.UsageValues; type ProcessMemoryMetric = SharedTypeDefinitions.ProcessMemoryMetric; type HostAvailableMemorySource = SharedTypeDefinitions.HostAvailableMemorySource; type AppMemory = SharedTypeDefinitions.AppMemory; type SessionMemory = SharedTypeDefinitions.SessionMemory; type WorktreeMemory = SharedTypeDefinitions.WorktreeMemory; type HostMemory = SharedTypeDefinitions.HostMemory; type MemorySnapshot = SharedTypeDefinitions.MemorySnapshot;

export type OrcaWorkspaceLayout = {
  path: string
  nestWorkspaces: boolean
}

export type CommitMessageAiModelCapability = {
  id: string
  label: string
  thinkingLevels?: { id: string; label: string }[]
  defaultThinkingLevel?: string
}

export type CommitMessageAiSettings = {
  enabled: boolean
  /** A TuiAgent id, the literal `'custom'` for a user-supplied command, or null. */
  agentId: TuiAgent | 'custom' | null
  /** Per-agent: switching agents preserves the previously-picked model. */
  selectedModelByAgent: Partial<Record<TuiAgent, string>>
  /** Host-scoped model selections; dynamic agents can expose different models per SSH target. */
  selectedModelByAgentByHost?: Partial<Record<string, Partial<Record<TuiAgent, string>>>>
  /** Per-agent dynamic models last discovered from the CLI, persisted so main can validate selections. */
  discoveredModelsByAgent?: Partial<Record<TuiAgent, CommitMessageAiModelCapability[]>>
  /** Host-scoped dynamic model discovery cache. */
  discoveredModelsByAgentByHost?: Partial<
    Record<string, Partial<Record<TuiAgent, CommitMessageAiModelCapability[]>>>
  >
  /** Per-model: thinking effort depends on the model, not the agent. Keyed by model id. */
  selectedThinkingByModel: Record<string, string>
  /** Optional user-provided suffix appended to the base prompt (style overrides, etc.). */
  customPrompt: string
  /** Command template for agentId === 'custom'; {prompt} substitutes the diff prompt via argv, else the prompt is piped via stdin. */
  customAgentCommand: string
}

export type GhosttyImportPreview = {
  found: boolean
  configPath?: string
  configPaths?: string[]
  diff: Partial<GlobalSettings>
  unsupportedKeys: string[]
  error?: string
}

// Subset of onboarding Ghostty DiscoveryState statuses that emit telemetry; UI-only 'idle'/'detecting' don't.
export type DiscoveryStatusEmitted = 'found' | 'absent' | 'imported'

export type NotificationEventSource = 'agent-task-complete' | 'terminal-bell' | 'test'

export type NotificationDispatchRequest = {
  source: NotificationEventSource
  notificationId?: string
  /** Why: useful for fast native failures, but macOS can still drop notifications after 'show'. */
  requireDisplayConfirmation?: boolean
  worktreeId?: string
  /** Stable `${tabId}:${leafId}` terminal pane key for click-to-focus routing. */
  paneKey?: string
  repoLabel?: string
  worktreeLabel?: string
  hasMultipleActiveRepos?: boolean
  terminalTitle?: string
  isActiveWorktree?: boolean
  agentType?: AgentType
  agentState?: AgentStatusState
  agentPrompt?: string
  agentToolName?: string
  agentToolInput?: string
  agentLastAssistantMessage?: string
  agentInterrupted?: boolean
}

export type NotificationDispatchResult = {
  delivered: boolean
  /** Why delivery was skipped (set when delivered is false); 'blocked-by-system' = macOS would silently swallow it. */
  reason?:
    | 'disabled'
    | 'source-disabled'
    | 'suppressed-focus'
    | 'cooldown'
    | 'not-supported'
    | 'not-displayed'
    | 'blocked-by-system'
    | 'invalid-request'
}

export type NotificationDismissResult = {
  dismissed: number
}

export type NotificationSoundResult = {
  played: boolean
  reason?:
    | 'missing-path'
    | 'invalid-path'
    | 'unsupported-type'
    | 'too-large'
    | 'read-failed'
    | 'playback-failed'
    | 'deduped'
}

export type NotificationSoundDataResult =
  | {
      ok: true
      data: Uint8Array
      mimeType: string
      path: string
    }
  | {
      ok: false
      reason: Exclude<NotificationSoundResult['reason'], 'playback-failed'>
    }

export type NotificationSoundPathResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'missing-path' | 'invalid-path' | 'unsupported-type' }

export type OnboardingOutcome = 'completed' | 'dismissed'

export type OnboardingChecklistState = {
  addedRepo: boolean
  choseAgent: boolean
  ranFirstAgent: boolean
  ranSecondAgentOnSameTask: boolean
  triedCmdJ: boolean
  shapedSidebar: boolean
  reviewedDiff: boolean
  openedPr: boolean
  addedFolder: boolean
  openedFile: boolean
  ranAgentOnFile: boolean
  // Why: UI state flag (panel visibility), not an activation event; telemetry checklist enum omits it.
  dismissed: boolean
}

export type OnboardingState = {
  // Why: step meanings change when pages are removed; version marker prevents migration re-running on new progress.
  flowVersion: number
  closedAt: number | null
  outcome: OnboardingOutcome | null
  // Sentinel -1 = not started; 1..5 = highest finished wizard step. number (not union) because callers clamp via Math.max/min.
  lastCompletedStep: number
  checklist: OnboardingChecklistState
}

export type NotificationPermissionStatusResult = {
  supported: boolean
  platform: NodeJS.Platform
  requested: boolean
}

/** macOS notification permission outcome: authoritative native UNUserNotificationCenter readout, else a weaker
 *  delivery-probe fallback; 'awaiting-decision' = permission dialog unanswered. */
export type NotificationDeliveryProbeResult = {
  state: 'delivered' | 'blocked' | 'awaiting-decision' | 'unsupported'
  /** True when the state comes from the native authorization readout (vs. the delivery-probe fallback). */
  authoritative: boolean
}

export type WorktreeCardProperty =
  | 'status'
  | 'unread'
  // Legacy persisted preference. CI status is now represented by linked PR metadata.
  | 'ci'
  // Migration-only: legacy detailed cards showed branch identity as a visible row.
  | 'branch'
  // Task metadata on workspace cards; provider-specific persisted values kept for older profiles.
  | 'issue'
  | 'linear-issue'
  | 'jira-issue'
  | 'pr'
  | 'automation'
  // Badge marking workspaces created through `orca worktree create`.
  | 'cli'
  | 'comment'
  | 'ports'
  // Inline agent-activity list rendered in each workspace card; on by default (see DEFAULT_WORKTREE_CARD_PROPERTIES in shared/constants.ts).
  | 'inline-agents'

export type WorktreeCardMode = 'Default' | 'Compact'

export type AgentActivityDisplayMode = 'compact' | 'full'

export type StatusBarItem =
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'antigravity'
  | 'opencode-go'
  | 'kimi'
  | 'minimax'
  | 'grok'
  | 'ssh'
  | 'resource-usage'
  | 'ports'
export type FloatingTerminalTriggerLocation = 'floating-button' | 'status-bar'

export type TaskResumeState = {
  githubMode?: 'items' | 'project'
  githubItemsPreset?: TaskViewPresetId | null
  githubItemsQuery?: string
  githubProjectHiddenFieldIdsByView?: Record<string, string[]>
  linearMode?: 'issues' | 'projects' | 'views'
  linearPreset?: 'assigned' | 'created' | 'all' | 'completed'
  linearQuery?: string
  linearContext?: {
    kind: 'project' | 'view'
    id: string
    workspaceId: LinearConcreteWorkspaceId
    model?: LinearCustomViewModel
  }
  jiraPreset?: 'assigned' | 'reported' | 'all' | 'done'
  jiraQuery?: string
}

export type RightSidebarTab =
  | 'explorer'
  | 'search'
  | 'vault'
  | 'workspaces'
  | 'pr-checks'
  | 'source-control'
  | 'checks'
  | 'ports'
  // Plugin-contributed panels are keyed `plugin:<pluginId>/<panelId>` so the
  // static union stays closed while plugin tabs remain type-representable.
  | `plugin:${string}`
export type ActiveRightSidebarTab = Exclude<RightSidebarTab, 'search'>
export type RightSidebarExplorerView = 'files' | 'search'

export type ProjectOrderBy = 'manual' | 'recent'
export type WorkspaceHostScope = 'all' | 'local' | `ssh:${string}` | `runtime:${string}`
export type VisibleWorkspaceHostIds = Exclude<WorkspaceHostScope, 'all'>[] | null
export type WorkspaceHostOrder = Exclude<WorkspaceHostScope, 'all'>[]
export type ManualRepoOrderEntry = {
  hostId: WorkspaceHostOrder[number]
  repoId: string
}

/** The active top-level section shown in the main content area. */
export type TopLevelView =
  | 'terminal'
  | 'settings'
  | 'tasks'
  | 'activity'
  | 'automations'
  | 'space'
  | 'skills'
  | 'mobile'

export type PersistedUIState = {
  lastActiveRepoId: string | null
  lastActiveWorktreeId: string | null
  /** Active top-level view at save time, restored on relaunch; sanitized to 'terminal' if unknown or now-gated. */
  activeView: TopLevelView
  sidebarWidth: number
  rightSidebarOpen: boolean
  rightSidebarTab: RightSidebarTab
  rightSidebarExplorerView: RightSidebarExplorerView
  rightSidebarWidth: number
  markdownTocPanelWidth?: number
  combinedDiffFileTreeWidth?: number
  groupBy: 'none' | 'workspace-status' | 'repo' | 'pr-status'
  sortBy: 'name' | 'smart' | 'recent' | 'repo' | 'manual'
  /** Project header ordering in `groupBy: 'repo'`, independent of `sortBy`: 'manual' uses persisted order + header drag, 'recent' by latest visible activity. */
  projectOrderBy: ProjectOrderBy
  /** Deprecated; the Active only filter is retired and ignored on hydration. */
  showActiveOnly: boolean
  /** Hide sleeping/inactive workspaces from workspace navigation. Off by default. */
  hideSleepingWorkspaces?: boolean
  /** Which execution hosts the sidebar shows; `all` = mixed view, specific IDs focus without tearing down other hosts' sessions. */
  workspaceHostScope?: WorkspaceHostScope
  /** Which execution hosts the sidebar shows; `null` = sticky all-hosts so new hosts appear automatically. */
  visibleWorkspaceHostIds?: VisibleWorkspaceHostIds
  /** User-defined sidebar order for host sections; missing/new hosts append in discovered order. */
  workspaceHostOrder?: WorkspaceHostOrder
  /** Desktop-owned all-host repo order; host-qualified identities keep a manual cross-host interleaving while each host owns its local permutation. */
  manualRepoOrder?: ManualRepoOrderEntry[]
  /** Deprecated legacy positive-form setting. Ignored on hydration. */
  showSleepingWorkspaces?: boolean
  /** Deprecated legacy name used by a short-lived build. Ignored on hydration. */
  showInactiveWorkspaces?: boolean
  /** Hide the repo's checked-out branch from workspace nav (sidebar, Cmd+J); folder-mode repos are unaffected (empty-branch worktrees excluded). */
  hideDefaultBranchWorkspace: boolean
  /** Hide workspaces created by automation new-per-run dispatches. */
  hideAutomationGeneratedWorkspaces?: boolean
  /** Hide workspaces created through `orca worktree create`. */
  hideCliCreatedWorkspaces?: boolean
  /** Hide workspaces sitting on a detached HEAD; folder workspaces (no head at all) are unaffected. */
  hideDetachedHeadWorkspaces?: boolean
  /** Per-worktree Explorer dotfile visibility. Missing entries inherit the default: show. */
  showDotfilesByWorktree?: Record<string, boolean>
  filterRepoIds: string[]
  collapsedGroups: string[]
  uiZoomLevel: number
  editorFontZoomLevel: number
  worktreeCardProperties: WorktreeCardProperty[]
  /** One-shot migration flag for deriving card properties from the two worktree card modes. */
  _worktreeCardModeDefaulted?: boolean
  agentActivityDisplayMode?: AgentActivityDisplayMode
  workspaceStatuses?: WorkspaceStatusDefinition[]
  workspaceBoardOpacity?: number
  workspaceBoardColumnWidth?: number
  syncTaskStatusFromWorkspaceBoard?: boolean
  /** One-shot migration flag for a short-lived build that persisted default statuses in reverse order; once stamped, ordering is never re-inferred from IDs/labels. */
  _workspaceStatusesDefaultOrderMigrated?: boolean
  /** One-shot repair flag for the exact default payload a short-lived build persisted in reverse workflow order. */
  _workspaceStatusesReorderedDefaultRepaired?: boolean
  /** One-shot migration flag for default status workflow labels/visuals; only exact legacy defaults migrate, customized statuses preserved. */
  _workspaceStatusesDefaultWorkflowMigrated?: boolean
  /** One-shot migration flag for the old default status visuals; once stamped, user-authored colors/icons are preserved. */
  _workspaceStatusesDefaultVisualsMigrated?: boolean
  /** One-shot migration flag for adding the default-on Ports status item. */
  _portsStatusBarDefaultAdded?: boolean
  /** One-shot migration flag for adding the default-on Kimi status item. */
  _kimiStatusBarDefaultAdded?: boolean
  /** One-shot migration flag for adding the default-on MiniMax status item. */
  _minimaxStatusBarDefaultAdded?: boolean
  /** One-shot migration flag for adding the default-on Antigravity status item. */
  _antigravityStatusBarDefaultAdded?: boolean
  /** One-shot migration flag for adding the default-on Grok status item. */
  _grokStatusBarDefaultAdded?: boolean
  statusBarItems: StatusBarItem[]
  statusBarVisible: boolean
  /** Why: this is client-side presentation, not a provider/account or execution-host setting. */
  usagePercentageDisplay?: UsagePercentageDisplay
  /** Client-side footer presentation; verbose preserves the pre-roster all-window default. */
  statusBarUsageMode?: StatusBarUsageMode
  dismissedUpdateVersion: string | null
  lastUpdateCheckAt: number | null
  /** Dev-only update channel override; absent means the build's own channel. */
  releaseChannelOverride?: ReleaseChannel | null
  pendingUpdateNudgeId?: string | null
  dismissedUpdateNudgeId?: string | null
  /** Whether Orca already tried triggering the macOS notification permission dialog; prevents re-firing every launch. */
  notificationPermissionRequested?: boolean
  /** Once the "your sessions won't be interrupted" reassurance card is seen, never show it again. */
  updateReassuranceSeen?: boolean
  /** Per-paneKey "row visited" timestamps that mute seen inline-agent rows; persisted because rows survive restart, else acked rows return bold. Renderer-owned via ui:set. */
  acknowledgedAgentsByPaneKey?: Record<string, number>
  /** User-hidden setup-guide sidebar entry; a reversible declutter pref (Help menu stays available), not completion. */
  setupGuideSidebarDismissed?: boolean
  /** One-shot marker for the browser setup-guide milestone; profiles missing it are evaluated once in the renderer (completion needs runtime probes). */
  setupGuideBrowserMilestoneMigrated?: boolean
  /** Existing users who completed/dismissed the pre-browser checklist stay complete after the browser milestone is added. */
  setupGuideBrowserMilestoneLegacyComplete?: boolean
  /** User-dismissed browser import toolbar hint; import stays available from Settings > Browser and the overflow menu. */
  browserImportHintHidden?: boolean
  /** Why: Windows-only. Set once on first hide to tray so the "Orca is still running" notice shows only once. */
  trayMinimizeNoticeShown?: boolean
  /** Set by the OSC 52 default-on migration when it overrode a persisted `false`; the renderer shows one notice and clears it. */
  osc52ClipboardDefaultOnNoticePending?: boolean
  /** User dismissed the first-run Mobile Emulator intro; reversible only by re-enabling the feature in Settings. */
  mobileEmulatorTabIntroDismissed?: boolean
  /** User deferred the in-pane Mobile Emulator CLI + skill setup guide. */
  mobileEmulatorAgentSetupDismissed?: boolean
  /** One-shot rollout notice for manual project ordering default; absent or true keeps the sidebar callout hidden. */
  projectOrderManualDefaultNoticeDismissed?: boolean
  /** One-shot notice that usage meters show percent used, not remaining; absent resolves on load (new profiles dismissed, upgraded see it once). */
  usagePercentageDisplayChangeNoticeDismissed?: boolean
  /** User-hidden empty-state usage CTA; permanently hides the "Connect AI accounts" prompt even if providers are later disconnected. */
  usageEmptyStateDismissed?: boolean
  /** URL for new browser tabs; null = blank tab. */
  browserDefaultUrl?: string | null
  browserDefaultSearchEngine?: 'google' | 'duckduckgo' | 'bing' | 'kagi' | null
  /** Electron browser zoom level applied when a new local browser tab is created. */
  browserDefaultZoomLevel?: number
  /** Optional Kagi private-session link used only when Kagi is the search engine. */
  browserKagiSessionLink?: string | null
  /** Saved window bounds so the app restores last position/size instead of maximizing each launch. */
  windowBounds?: { x: number; y: number; width: number; height: number } | null
  /** Whether the window was maximized when it was last closed. */
  windowMaximized?: boolean
  /** Saved bounds for the pop-out dashboard window so it restores to its last
   *  position/size. Independent of the main window's bounds. */
  dashboardPopoutBounds?: { x: number; y: number; width: number; height: number } | null
  /** One-shot flag: 'recent' once meant the smart sort (v1→v2 rename), migrated to 'smart' once so the new last-activity 'recent' isn't re-clobbered. */
  _sortBySmartMigrated?: boolean
  /** LEGACY inline-agents flag, stamped unconditionally every load so it can't gate migration; kept only for rollback forward-compat (real gate: _inlineAgentsDefaultedForAllUsers). */
  _inlineAgentsDefaultedForExperiment?: boolean
  /** One-shot flag for the inline-agents default-on rollout; distinct from _inlineAgentsDefaultedForExperiment, which was stamped every load and is permanently dirty. */
  _inlineAgentsDefaultedForAllUsers?: boolean
  /** One-shot migration flag for split-out card properties, set once so later deliberate unchecks of Linear issue/Ports stick across restarts. */
  _expandedWorktreeCardPropertiesDefaulted?: boolean
  /** One-shot backfill flag for 'jira-issue', which joined the defaults after the expansion migration had already stamped upgraded profiles. */
  _jiraIssueWorktreeCardPropertyDefaulted?: boolean
  /** totalAgentsSpawned snapshot at first sighting of the current app version, so the nag counts agents since last update (not from zero). */
  starNagBaselineAgents?: number | null
  /** App version that set the current baseline; a version change re-captures the baseline on next spawn, restarting the nag countdown. */
  starNagAppVersion?: string | null
  /** Next agents-since-baseline threshold that fires the star-nag; starts at 35, doubles per dismissal without starring. */
  starNagNextThreshold?: number
  /** Once the user has starred Orca (any entry point), permanently suppress the nag. */
  starNagCompleted?: boolean
  /** Timestamp until which nonterminal dismissals suppress threshold prompts (force-show bypasses for dev/testing). */
  starNagDeferredUntil?: number | null
  /** App version that consumed the first value-moment ask; main-owned so remote/web clients can't spoof the once-per-version cap. */
  starNagAgentValueMomentAppVersion?: string | null
  trustedOrcaHooks?: PersistedTrustedOrcaHooks
  setupScriptPromptDismissedRepoIds?: string[]
  /** Pet overlay visibility, separate from the experimentalPet settings flag so "Hide pet" is a reversible dismiss; absent = true. */
  petVisible?: boolean
  /** Active pet id (bundled id or custom UUID); unknown ids fall back to the default on read so a removed custom pet doesn't blank the overlay. */
  petId?: string
  /** Metadata index for user-uploaded pet images; bytes live under legacy userData/sidekicks/custom/. */
  customPets?: CustomPet[]
  /** Pet overlay size in CSS pixels (square); clamped to [PET_SIZE_MIN, PET_SIZE_MAX] on read. */
  petSize?: number
  /** Legacy keys from before the sidekick -> pet rename; read only during migration, new writes use pet* above. */
  sidekickVisible?: boolean
  sidekickId?: string
  customSidekicks?: CustomPet[]
  sidekickSize?: number
  /** Page-position state for Tasks: only transient tabs/searches (source/repo/team/project selections use their own settings paths). */
  taskResumeState?: TaskResumeState
  workspaceCleanup?: WorkspaceCleanupUIState
  /** Feature tips already surfaced; startup opens the tips modal only when a current tip id is missing here. */
  featureTipsSeenIds?: FeatureTipId[]
  /** Feature ids the user has actually used; education surfaces skip teaching already-discovered features. */
  featureInteractions?: FeatureInteractionState
  /** Contextual tours already surfaced; unknown ids ignored on hydration for downgrade/upgrade forward-compat. */
  contextualToursSeenIds?: ContextualTourId[]
  /** Whether this profile may receive automatic contextual tours; missing = renderer hasn't classified the profile yet. */
  contextualToursAutoEligible?: boolean
}

export const PET_SIZE_MIN = 60
export const PET_SIZE_MAX = 360
export const PET_SIZE_DEFAULT = 180

/** User-uploaded pet image metadata; renderer fetches bytes from main via pet:read (id, fileName), never learning the on-disk path. */
export type CustomPet = {
  id: string
  label: string
  fileName: string
  /** MIME type for the renderer's Blob Content-Type — esp. image/svg+xml, which browsers won't render from a misdeclared blob URL. */
  mimeType: string
  /** Storage layout: `image` = legacy flat file `custom/<id>.<ext>`; `bundle` = `.codex-pet` expanded into `custom/<id>/`; absent = legacy `image`. */
  kind?: 'image' | 'bundle'
  /** Sprite-sheet metadata; present iff from a `.codex-pet` bundle with a manifest frame layout. Dims derived in main so the renderer needn't probe the image. */
  sprite?: {
    frameWidth: number
    frameHeight: number
    columns: number
    rows: number
    sheetWidth: number
    sheetHeight: number
    fps: number
    defaultAnimation?: string
    animations?: Record<string, SpriteAnimation>
  }
  /** Manifest-declared fps kept even when frames are auto-detected, so playback honors the bundle's speed instead of a hardcoded 8 fps. */
  spriteFps?: number
}

/** One animation strip in a sprite sheet: `row` = 0-based y-index, `frames` = consecutive cells played left-to-right. */
export type SpriteAnimation = {
  row: number
  frames: number
  /** Per-frame holds in ms (length === frames). Absent means uniform sheet fps. */
  frameDurationsMs?: number[]
}

export type PersistedTrustedOrcaHookEntry = {
  contentHash: string
  approvedAt: number
}

export type PersistedTrustedOrcaHookRepo = {
  all?: {
    approvedAt: number
  }
  setup?: PersistedTrustedOrcaHookEntry
  archive?: PersistedTrustedOrcaHookEntry
  issueCommand?: PersistedTrustedOrcaHookEntry
  vmRecipe?: PersistedTrustedOrcaHookEntry
}

export type PersistedTrustedOrcaHooks = Record<string, PersistedTrustedOrcaHookRepo>

export type LegacyPaneKeyAliasEntry = {
  ptyId: string
  /** Physical pane key retained by the live process; name is persisted for compatibility (UUID keys after detach). */
  legacyPaneKey: string
  /** Current logical owner pane key. May belong to another tab after detach. */
  stablePaneKey: string
  updatedAt: number
}

/** Last tab selection a paired client made in a worktree; restores phone navigation across host restarts. */
export type PersistedMobileClientTabSelection = {
  activeTabId: string | null
  activeGroupId: string | null
  activeTabIdByGroupId: Readonly<Record<string, string>>
}

/** deviceId → worktreeId → selection. */
export type PersistedMobileClientTabSelections = Record<
  string,
  Record<string, PersistedMobileClientTabSelection>
>

// ─── Persistence shape ──────────────────────────────────────────────
export type PersistedState = {
  schemaVersion: number
  repos: Repo[]
  projects: Project[]
  projectHostSetups: ProjectHostSetup[]
  projectGroups: ProjectGroup[]
  folderWorkspaces: FolderWorkspace[]
  /** Sparse-checkout presets keyed by repoId. */
  sparsePresetsByRepo: Record<string, SparsePreset[]>
  /** Per paired device last tab selection by worktree; keeps mobile navigation across host restarts. */
  mobileClientTabSelectionsByDeviceId?: PersistedMobileClientTabSelections
  worktreeMeta: Record<string, WorktreeMeta>
  worktreeLineageById: Record<string, WorktreeLineage>
  workspaceLineageByChildKey: Record<WorkspaceKey, WorkspaceLineage>
  settings: GlobalSettings
  ui: PersistedUIState
  githubCache: {
    pr: Record<string, { data: PRInfo | null; fetchedAt: number }>
    issue: Record<string, { data: IssueInfo | null; fetchedAt: number }>
  }
  /** Legacy single-blob session, kept as the canonical 'local' host partition so an app downgrade still reads its workspace. */
  workspaceSession: WorkspaceSessionState
  /** Per-execution-host session partitions for non-'local' hosts (ssh:/runtime:); 'local' stays in workspaceSession so pre-partition builds keep working. */
  workspaceSessionsByHostId?: Partial<Record<ExecutionHostId, WorkspaceSessionState>>
  sshTargets: SshTarget[]
  /** SSH config aliases the user deleted; suppresses re-import from ~/.ssh/config so a deleted host doesn't reappear. */
  deletedSshConfigAliases: string[]
  /** Identity records for removed SSH targets so a re-added host can re-adopt workspaces orphaned on the old target id. */
  removedSshTargetTombstones?: RemovedSshTargetTombstone[]
  sshRemotePtyLeases: SshRemotePtyLease[]
  /** Live local Claude daemon session ids; seeds the live-PTY gate so early OAuth refresh can't rotate the single-use refresh token out from under a running daemon. */
  claudeLivePtySessionIds?: string[]
  migrationUnsupportedPtyEntries: MigrationUnsupportedPtyEntry[]
  legacyPaneKeyAliasEntries: LegacyPaneKeyAliasEntry[]
  automations: Automation[]
  automationRuns: AutomationRun[]
  onboarding: OnboardingState
  /** Main-owned telemetry de-dupe marker; never exposed through PersistedUIState. */
  featureInteractionTelemetryBuckets?: FeatureInteractionTelemetryBucketState
  /** Main-owned reset mutation journal. Never expose this through renderer settings APIs. */
  codexResetCreditAttemptLedger?: CodexResetCreditAttemptLedger
}

