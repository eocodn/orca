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
type ShellHydrationFailureReason = SharedTypeDefinitions.ShellHydrationFailureReason; type PathSource = SharedTypeDefinitions.PathSource; type RepoKind = SharedTypeDefinitions.RepoKind; type IssueSourcePreference = SharedTypeDefinitions.IssueSourcePreference; type ExternalWorktreeVisibility = SharedTypeDefinitions.ExternalWorktreeVisibility; type ProjectProviderIdentity = SharedTypeDefinitions.ProjectProviderIdentity; type Project = SharedTypeDefinitions.Project; type ProjectUpdateArgs = SharedTypeDefinitions.ProjectUpdateArgs; type ProjectHostSetupState = SharedTypeDefinitions.ProjectHostSetupState; type ProjectHostSetupMethod = SharedTypeDefinitions.ProjectHostSetupMethod; type RepoProjectHostSetupMethod = SharedTypeDefinitions.RepoProjectHostSetupMethod; type ProjectHostSetup = SharedTypeDefinitions.ProjectHostSetup; type ProjectHostSetupExistingFolderArgs = SharedTypeDefinitions.ProjectHostSetupExistingFolderArgs; type ProjectHostSetupCreateArgs = SharedTypeDefinitions.ProjectHostSetupCreateArgs; type ProjectHostSetupCloneArgs = SharedTypeDefinitions.ProjectHostSetupCloneArgs; type ProjectHostSetupUpdateArgs = SharedTypeDefinitions.ProjectHostSetupUpdateArgs; type ProjectHostSetupDeleteArgs = SharedTypeDefinitions.ProjectHostSetupDeleteArgs; type ProjectHostSetupResult = SharedTypeDefinitions.ProjectHostSetupResult; type ProjectHostSetupCreateResult = SharedTypeDefinitions.ProjectHostSetupCreateResult; type ProjectHostSetupUpdateResult = SharedTypeDefinitions.ProjectHostSetupUpdateResult; type ProjectHostSetupDeleteResult = SharedTypeDefinitions.ProjectHostSetupDeleteResult; type Repo = SharedTypeDefinitions.Repo; type ProjectGroupCreatedFrom = SharedTypeDefinitions.ProjectGroupCreatedFrom; type ProjectGroup = SharedTypeDefinitions.ProjectGroup; type WorkspaceScope = SharedTypeDefinitions.WorkspaceScope; type WorkspaceKey = SharedTypeDefinitions.WorkspaceKey; type FolderWorkspace = SharedTypeDefinitions.FolderWorkspace; type WorkspaceLinkedItem = SharedTypeDefinitions.WorkspaceLinkedItem; type FolderWorkspaceLinkedTask = SharedTypeDefinitions.FolderWorkspaceLinkedTask; type NestedRepoScanOptions = SharedTypeDefinitions.NestedRepoScanOptions; type NestedRepoCandidate = SharedTypeDefinitions.NestedRepoCandidate; type NestedRepoScanResult = SharedTypeDefinitions.NestedRepoScanResult; type ProjectGroupImportMode = SharedTypeDefinitions.ProjectGroupImportMode; type ProjectGroupImportProjectResult = SharedTypeDefinitions.ProjectGroupImportProjectResult; type ProjectGroupImportResult = SharedTypeDefinitions.ProjectGroupImportResult; type SetupRunPolicy = SharedTypeDefinitions.SetupRunPolicy; type SetupAgentStartupPolicy = SharedTypeDefinitions.SetupAgentStartupPolicy; type SetupDecision = SharedTypeDefinitions.SetupDecision; type HookCommandSourcePolicy = SharedTypeDefinitions.HookCommandSourcePolicy; type BaseRefDefaultResult = SharedTypeDefinitions.BaseRefDefaultResult; type BaseRefSearchResult = SharedTypeDefinitions.BaseRefSearchResult; type GitWorktreeInfo = SharedTypeDefinitions.GitWorktreeInfo; type WorktreeHeadIdentity = SharedTypeDefinitions.WorktreeHeadIdentity; type WorkspaceStatus = SharedTypeDefinitions.WorkspaceStatus; type WorkspaceStatusDefinition = SharedTypeDefinitions.WorkspaceStatusDefinition; type Worktree = SharedTypeDefinitions.Worktree; type CliWorkspaceProvenance = SharedTypeDefinitions.CliWorkspaceProvenance; type AutomationWorkspaceProvenance = SharedTypeDefinitions.AutomationWorkspaceProvenance; type AutomationWorkspaceProvenanceRequest = SharedTypeDefinitions.AutomationWorkspaceProvenanceRequest; type GitPushTarget = SharedTypeDefinitions.GitPushTarget; type GitHubPrStartPoint = SharedTypeDefinitions.GitHubPrStartPoint; type WorktreeMeta = SharedTypeDefinitions.WorktreeMeta; type WorktreeOwnership = SharedTypeDefinitions.WorktreeOwnership; type DetectedWorktreeListSource = SharedTypeDefinitions.DetectedWorktreeListSource; type DetectedWorktree = SharedTypeDefinitions.DetectedWorktree; type DetectedWorktreeListResult = SharedTypeDefinitions.DetectedWorktreeListResult; type WorktreeLineageOrigin = SharedTypeDefinitions.WorktreeLineageOrigin; type WorktreeLineageCaptureConfidence = SharedTypeDefinitions.WorktreeLineageCaptureConfidence; type WorktreeLineageCaptureSource = SharedTypeDefinitions.WorktreeLineageCaptureSource; type WorktreeLineageCapture = SharedTypeDefinitions.WorktreeLineageCapture; type WorktreeLineage = SharedTypeDefinitions.WorktreeLineage; type WorkspaceLineage = SharedTypeDefinitions.WorkspaceLineage; type WorktreeLineageWarningCode = SharedTypeDefinitions.WorktreeLineageWarningCode; type WorktreeLineageWarning = SharedTypeDefinitions.WorktreeLineageWarning; type DiffCommentSource = SharedTypeDefinitions.DiffCommentSource; type DiffReviewScope = SharedTypeDefinitions.DiffReviewScope; type MobileDiffReviewFileState = SharedTypeDefinitions.MobileDiffReviewFileState; type MobileDiffReviewState = SharedTypeDefinitions.MobileDiffReviewState; type DiffComment = SharedTypeDefinitions.DiffComment; type TabGroupSplitDirection = SharedTypeDefinitions.TabGroupSplitDirection; type TabGroupLayoutNode = SharedTypeDefinitions.TabGroupLayoutNode; type TabContentType = SharedTypeDefinitions.TabContentType; type WorkspaceVisibleTabType = SharedTypeDefinitions.WorkspaceVisibleTabType; type CtrlTabOrderMode = SharedTypeDefinitions.CtrlTabOrderMode; type Tab = SharedTypeDefinitions.Tab; type TabGroup = SharedTypeDefinitions.TabGroup; type TerminalTab = SharedTypeDefinitions.TerminalTab; type BrowserHistoryEntry = SharedTypeDefinitions.BrowserHistoryEntry; type BrowserLoadError = SharedTypeDefinitions.BrowserLoadError; type BrowserCertificateFailure = SharedTypeDefinitions.BrowserCertificateFailure; type BrowserCertificateProceedFailureReason = SharedTypeDefinitions.BrowserCertificateProceedFailureReason; type BrowserCertificateProceedResult = SharedTypeDefinitions.BrowserCertificateProceedResult; type BrowserViewportPresetId = SharedTypeDefinitions.BrowserViewportPresetId; type BrowserViewportOverride = SharedTypeDefinitions.BrowserViewportOverride; type BrowserPage = SharedTypeDefinitions.BrowserPage; type BrowserWorkspace = SharedTypeDefinitions.BrowserWorkspace; type BrowserTab = SharedTypeDefinitions.BrowserTab; type BrowserSessionProfileScope = SharedTypeDefinitions.BrowserSessionProfileScope; type BrowserSessionProfileSource = SharedTypeDefinitions.BrowserSessionProfileSource; type BrowserSessionProfile = SharedTypeDefinitions.BrowserSessionProfile; type BrowserCookieImportSummary = SharedTypeDefinitions.BrowserCookieImportSummary; type BrowserCookieImportResult = SharedTypeDefinitions.BrowserCookieImportResult; type TerminalPaneSplitDirection = SharedTypeDefinitions.TerminalPaneSplitDirection; type TerminalPaneLayoutNode = SharedTypeDefinitions.TerminalPaneLayoutNode; type TerminalLayoutSnapshot = SharedTypeDefinitions.TerminalLayoutSnapshot; type PersistedOpenFile = SharedTypeDefinitions.PersistedOpenFile; type WorkspaceSessionState = SharedTypeDefinitions.WorkspaceSessionState; type WorkspaceSessionPatch = SharedTypeDefinitions.WorkspaceSessionPatch; type PRState = SharedTypeDefinitions.PRState; type IssueState = SharedTypeDefinitions.IssueState; type CheckStatus = SharedTypeDefinitions.CheckStatus; type PRMergeableState = SharedTypeDefinitions.PRMergeableState; type PRReviewDecision = SharedTypeDefinitions.PRReviewDecision; type PRConflictSummary = SharedTypeDefinitions.PRConflictSummary; type GitHubRepositoryIdentity = SharedTypeDefinitions.GitHubRepositoryIdentity; type GitHubPRMergeMethod = SharedTypeDefinitions.GitHubPRMergeMethod; type GitHubPRMergeMethodSettings = SharedTypeDefinitions.GitHubPRMergeMethodSettings; type PRInfo = SharedTypeDefinitions.PRInfo; type PRRefreshErrorType = SharedTypeDefinitions.PRRefreshErrorType; type PRRefreshUpstreamErrorType = SharedTypeDefinitions.PRRefreshUpstreamErrorType; type PRRefreshOutcome = SharedTypeDefinitions.PRRefreshOutcome; type GitHubPRRefreshReason = SharedTypeDefinitions.GitHubPRRefreshReason; type GitHubPRRefreshEnqueueResult = SharedTypeDefinitions.GitHubPRRefreshEnqueueResult; type GitHubPRRefreshAlias = SharedTypeDefinitions.GitHubPRRefreshAlias; type GitHubPRRefreshCandidate = SharedTypeDefinitions.GitHubPRRefreshCandidate; type GitHubPRRefreshSkippedReason = SharedTypeDefinitions.GitHubPRRefreshSkippedReason; type GitHubPRRefreshEvent = SharedTypeDefinitions.GitHubPRRefreshEvent; type PRCheckDetail = SharedTypeDefinitions.PRCheckDetail; type PRCheckAnnotation = SharedTypeDefinitions.PRCheckAnnotation; type PRCheckStep = SharedTypeDefinitions.PRCheckStep; type PRCheckJob = SharedTypeDefinitions.PRCheckJob; type PRCheckRunDetails = SharedTypeDefinitions.PRCheckRunDetails; type GitHubRerunPRChecksResult = SharedTypeDefinitions.GitHubRerunPRChecksResult; type GitHubReactionContent = SharedTypeDefinitions.GitHubReactionContent; type GitHubReaction = SharedTypeDefinitions.GitHubReaction; type PRComment = SharedTypeDefinitions.PRComment; type GitHubIssueTimelineTarget = SharedTypeDefinitions.GitHubIssueTimelineTarget; type GitHubIssueTimelineItem = SharedTypeDefinitions.GitHubIssueTimelineItem; type GitHubCommentResult = SharedTypeDefinitions.GitHubCommentResult; type IssueInfo = SharedTypeDefinitions.IssueInfo; type GitHubViewer = SharedTypeDefinitions.GitHubViewer; type GitHubAssignableUser = SharedTypeDefinitions.GitHubAssignableUser; type ProviderCheckSummary = SharedTypeDefinitions.ProviderCheckSummary; type GitHubPRReviewSummary = SharedTypeDefinitions.GitHubPRReviewSummary; type GitHubPRFileViewedState = SharedTypeDefinitions.GitHubPRFileViewedState; type GitHubWorkItem = SharedTypeDefinitions.GitHubWorkItem; type GitHubPRFile = SharedTypeDefinitions.GitHubPRFile; type GitHubPRFileContents = SharedTypeDefinitions.GitHubPRFileContents; type GitHubPRReviewCommentInput = SharedTypeDefinitions.GitHubPRReviewCommentInput; type GitHubWorkItemDetails = SharedTypeDefinitions.GitHubWorkItemDetails; type LinearViewer = SharedTypeDefinitions.LinearViewer; type LinearWorkspace = SharedTypeDefinitions.LinearWorkspace; type LinearWorkspaceSelection = SharedTypeDefinitions.LinearWorkspaceSelection; type LinearWorkspaceSelector = SharedTypeDefinitions.LinearWorkspaceSelector; type LinearConcreteWorkspaceId = SharedTypeDefinitions.LinearConcreteWorkspaceId; type LinearWorkspaceError = SharedTypeDefinitions.LinearWorkspaceError; type LinearCollectionResult = SharedTypeDefinitions.LinearCollectionResult; type LinearConnectionStatus = SharedTypeDefinitions.LinearConnectionStatus; type LinearIssue = SharedTypeDefinitions.LinearIssue; type LinearProjectSummary = SharedTypeDefinitions.LinearProjectSummary; type LinearProjectStatusSummary = SharedTypeDefinitions.LinearProjectStatusSummary; type LinearProjectMemberSummary = SharedTypeDefinitions.LinearProjectMemberSummary; type LinearProjectMilestoneSummary = SharedTypeDefinitions.LinearProjectMilestoneSummary; type LinearProjectResourceSummary = SharedTypeDefinitions.LinearProjectResourceSummary; type LinearProjectUpdateSummary = SharedTypeDefinitions.LinearProjectUpdateSummary; type LinearProjectDetail = SharedTypeDefinitions.LinearProjectDetail; type LinearCustomViewModel = SharedTypeDefinitions.LinearCustomViewModel; type LinearCustomViewSummary = SharedTypeDefinitions.LinearCustomViewSummary; type LinearIssueChildSummary = SharedTypeDefinitions.LinearIssueChildSummary; type LinearComment = SharedTypeDefinitions.LinearComment; type GitHubCreateIssueFields = SharedTypeDefinitions.GitHubCreateIssueFields; type GitHubCreateIssueResult = SharedTypeDefinitions.GitHubCreateIssueResult; type GitHubIssueCloseReason = SharedTypeDefinitions.GitHubIssueCloseReason; type GitHubIssueUpdate = SharedTypeDefinitions.GitHubIssueUpdate; type GitHubPullRequestStateUpdate = SharedTypeDefinitions.GitHubPullRequestStateUpdate; type LinearIssueUpdate = SharedTypeDefinitions.LinearIssueUpdate; type ClassifiedError = SharedTypeDefinitions.ClassifiedError; type GitHubOwnerRepo = SharedTypeDefinitions.GitHubOwnerRepo; type GitHubRateLimitBucket = SharedTypeDefinitions.GitHubRateLimitBucket; type GitHubRateLimitSnapshot = SharedTypeDefinitions.GitHubRateLimitSnapshot; type GetRateLimitResult = SharedTypeDefinitions.GetRateLimitResult; type ListWorkItemsResult = SharedTypeDefinitions.ListWorkItemsResult; type LinearWorkflowState = SharedTypeDefinitions.LinearWorkflowState; type LinearLabel = SharedTypeDefinitions.LinearLabel; type LinearMember = SharedTypeDefinitions.LinearMember; type LinearTeam = SharedTypeDefinitions.LinearTeam; type OrcaHooks = SharedTypeDefinitions.OrcaHooks; type OrcaWorktreeDefaults = SharedTypeDefinitions.OrcaWorktreeDefaults; type OrcaDefaultTabTemplate = SharedTypeDefinitions.OrcaDefaultTabTemplate; type OrcaVmRecipe = SharedTypeDefinitions.OrcaVmRecipe; type OrcaVmRecipeDiagnostic = SharedTypeDefinitions.OrcaVmRecipeDiagnostic; type RepoHookSettings = SharedTypeDefinitions.RepoHookSettings; type WorktreeSetupLaunch = SharedTypeDefinitions.WorktreeSetupLaunch; type WorktreeStartupLaunch = SharedTypeDefinitions.WorktreeStartupLaunch; type WorktreeDefaultTabsLaunch = SharedTypeDefinitions.WorktreeDefaultTabsLaunch; type WorktreeCreateTimingPhase = SharedTypeDefinitions.WorktreeCreateTimingPhase; type WorktreeCreateTiming = SharedTypeDefinitions.WorktreeCreateTiming; type CreateSparseCheckoutRequest = SharedTypeDefinitions.CreateSparseCheckoutRequest; type SparsePreset = SharedTypeDefinitions.SparsePreset; type CreateWorktreeArgs = SharedTypeDefinitions.CreateWorktreeArgs; type CreateWorktreeResult = SharedTypeDefinitions.CreateWorktreeResult; type WorktreeCreateBaseFallback = SharedTypeDefinitions.WorktreeCreateBaseFallback; type PreservedWorktreeBranch = SharedTypeDefinitions.PreservedWorktreeBranch; type RemoveWorktreeResult = SharedTypeDefinitions.RemoveWorktreeResult; type ForceDeleteWorktreeBranchResult = SharedTypeDefinitions.ForceDeleteWorktreeBranchResult; type LocalBaseRefRefreshResult = SharedTypeDefinitions.LocalBaseRefRefreshResult; type LocalBaseRefUpdateSuggestion = SharedTypeDefinitions.LocalBaseRefUpdateSuggestion; type WorktreeBaseStatusKind = SharedTypeDefinitions.WorktreeBaseStatusKind; type WorktreeBaseStatusEvent = SharedTypeDefinitions.WorktreeBaseStatusEvent; type WorktreeRemoteBranchConflictEvent = SharedTypeDefinitions.WorktreeRemoteBranchConflictEvent; type ChangelogRelease = SharedTypeDefinitions.ChangelogRelease; type ChangelogData = SharedTypeDefinitions.ChangelogData; type UpdateCheckOptions = SharedTypeDefinitions.UpdateCheckOptions; type UpdateSource = SharedTypeDefinitions.UpdateSource; type UpdateStatus = SharedTypeDefinitions.UpdateStatus; type ReleaseBuildListResult = SharedTypeDefinitions.ReleaseBuildListResult; type GlobalSettings = SharedTypeDefinitions.GlobalSettings; type OrcaWorkspaceLayout = SharedTypeDefinitions.OrcaWorkspaceLayout; type CommitMessageAiModelCapability = SharedTypeDefinitions.CommitMessageAiModelCapability; type CommitMessageAiSettings = SharedTypeDefinitions.CommitMessageAiSettings; type GhosttyImportPreview = SharedTypeDefinitions.GhosttyImportPreview; type DiscoveryStatusEmitted = SharedTypeDefinitions.DiscoveryStatusEmitted; type NotificationEventSource = SharedTypeDefinitions.NotificationEventSource; type NotificationDispatchRequest = SharedTypeDefinitions.NotificationDispatchRequest; type NotificationDispatchResult = SharedTypeDefinitions.NotificationDispatchResult; type NotificationDismissResult = SharedTypeDefinitions.NotificationDismissResult; type NotificationSoundResult = SharedTypeDefinitions.NotificationSoundResult; type NotificationSoundDataResult = SharedTypeDefinitions.NotificationSoundDataResult; type NotificationSoundPathResult = SharedTypeDefinitions.NotificationSoundPathResult; type OnboardingOutcome = SharedTypeDefinitions.OnboardingOutcome; type OnboardingChecklistState = SharedTypeDefinitions.OnboardingChecklistState; type OnboardingState = SharedTypeDefinitions.OnboardingState; type NotificationPermissionStatusResult = SharedTypeDefinitions.NotificationPermissionStatusResult; type NotificationDeliveryProbeResult = SharedTypeDefinitions.NotificationDeliveryProbeResult; type WorktreeCardProperty = SharedTypeDefinitions.WorktreeCardProperty; type WorktreeCardMode = SharedTypeDefinitions.WorktreeCardMode; type AgentActivityDisplayMode = SharedTypeDefinitions.AgentActivityDisplayMode; type StatusBarItem = SharedTypeDefinitions.StatusBarItem; type FloatingTerminalTriggerLocation = SharedTypeDefinitions.FloatingTerminalTriggerLocation; type TaskResumeState = SharedTypeDefinitions.TaskResumeState; type RightSidebarTab = SharedTypeDefinitions.RightSidebarTab; type ActiveRightSidebarTab = SharedTypeDefinitions.ActiveRightSidebarTab; type RightSidebarExplorerView = SharedTypeDefinitions.RightSidebarExplorerView; type ProjectOrderBy = SharedTypeDefinitions.ProjectOrderBy; type WorkspaceHostScope = SharedTypeDefinitions.WorkspaceHostScope; type VisibleWorkspaceHostIds = SharedTypeDefinitions.VisibleWorkspaceHostIds; type WorkspaceHostOrder = SharedTypeDefinitions.WorkspaceHostOrder; type ManualRepoOrderEntry = SharedTypeDefinitions.ManualRepoOrderEntry; type TopLevelView = SharedTypeDefinitions.TopLevelView; type PersistedUIState = SharedTypeDefinitions.PersistedUIState; type CustomPet = SharedTypeDefinitions.CustomPet; type SpriteAnimation = SharedTypeDefinitions.SpriteAnimation; type PersistedTrustedOrcaHookEntry = SharedTypeDefinitions.PersistedTrustedOrcaHookEntry; type PersistedTrustedOrcaHookRepo = SharedTypeDefinitions.PersistedTrustedOrcaHookRepo; type PersistedTrustedOrcaHooks = SharedTypeDefinitions.PersistedTrustedOrcaHooks; type LegacyPaneKeyAliasEntry = SharedTypeDefinitions.LegacyPaneKeyAliasEntry; type PersistedMobileClientTabSelection = SharedTypeDefinitions.PersistedMobileClientTabSelection; type PersistedMobileClientTabSelections = SharedTypeDefinitions.PersistedMobileClientTabSelections; type PersistedState = SharedTypeDefinitions.PersistedState; type FilesystemPathFlavor = SharedTypeDefinitions.FilesystemPathFlavor; type DirEntry = SharedTypeDefinitions.DirEntry; type MarkdownDocument = SharedTypeDefinitions.MarkdownDocument; type FsChangeEvent = SharedTypeDefinitions.FsChangeEvent; type FsChangedPayload = SharedTypeDefinitions.FsChangedPayload; type GitBranchChangeEntry = SharedTypeDefinitions.GitBranchChangeEntry; type GitBranchCompareSummary = SharedTypeDefinitions.GitBranchCompareSummary; type GitBranchCompareResult = SharedTypeDefinitions.GitBranchCompareResult; type GitCommitCompareSummary = SharedTypeDefinitions.GitCommitCompareSummary; type GitCommitCompareResult = SharedTypeDefinitions.GitCommitCompareResult; type GitDiffTextResult = SharedTypeDefinitions.GitDiffTextResult; type GitDiffBinaryResult = SharedTypeDefinitions.GitDiffBinaryResult; type GitDiffResult = SharedTypeDefinitions.GitDiffResult; type SearchMatch = SharedTypeDefinitions.SearchMatch; type SearchFileResult = SharedTypeDefinitions.SearchFileResult; type SearchResult = SharedTypeDefinitions.SearchResult; type SearchOptions = SharedTypeDefinitions.SearchOptions; type StatsSummary = SharedTypeDefinitions.StatsSummary; type UsageValues = SharedTypeDefinitions.UsageValues; type ProcessMemoryMetric = SharedTypeDefinitions.ProcessMemoryMetric; type HostAvailableMemorySource = SharedTypeDefinitions.HostAvailableMemorySource; type AppMemory = SharedTypeDefinitions.AppMemory; type SessionMemory = SharedTypeDefinitions.SessionMemory; type WorktreeMemory = SharedTypeDefinitions.WorktreeMemory; type HostMemory = SharedTypeDefinitions.HostMemory; type MemorySnapshot = SharedTypeDefinitions.MemorySnapshot;

// ─── Settings ────────────────────────────────────────────────────────
export type NotificationSettings = {
  enabled: boolean
  agentTaskComplete: boolean
  terminalBell: boolean
  suppressWhenFocused: boolean
  customSoundId:
    | 'system'
    | 'two-tone'
    | 'bong'
    | 'thump'
    | 'blip'
    | 'sonar'
    | 'blop'
    | 'ding'
    | 'clack'
    | 'beep'
    | 'custom'
  customSoundPath: string | null
  customSoundVolume: number
}

export type CodexManagedAccount = {
  id: string
  email: string
  managedHomePath: string
  managedHomeRuntime?: 'host' | 'wsl'
  wslDistro?: string | null
  wslLinuxHomePath?: string | null
  providerAccountId?: string | null
  workspaceLabel?: string | null
  workspaceAccountId?: string | null
  createdAt: number
  updatedAt: number
  lastAuthenticatedAt: number
}

export type CodexManagedAccountSummary = {
  id: string
  email: string
  managedHomeRuntime?: 'host' | 'wsl'
  wslDistro?: string | null
  providerAccountId?: string | null
  workspaceLabel?: string | null
  workspaceAccountId?: string | null
  createdAt: number
  updatedAt: number
  lastAuthenticatedAt: number
}

/** Live, read-only identity of the user's real ~/.codex used by the
 *  system-default (activeAccountId:null) Codex account. Orca reads this to
 *  display and attribute the system default; it never writes ~/.codex. */
export type CodexSystemDefaultIdentity = {
  /** True when ~/.codex/auth.json exists (signed in via a token file). */
  hasAuth: boolean
  /** 'oauth' = ChatGPT sign-in with an id token (has ChatGPT usage);
   *  'api-key' = env-key/custom provider (no ChatGPT usage);
   *  'none' = signed out or identity could not be resolved. */
  authKind: 'oauth' | 'api-key' | 'none'
  email: string | null
  providerAccountId: string | null
  workspaceLabel: string | null
}

export type CodexRateLimitAccountsState = {
  accounts: CodexManagedAccountSummary[]
  activeAccountId: string | null
  activeAccountIdsByRuntime?: CodexManagedAccountRuntimeSelection
  /** Resolved identity of the host system-default (real ~/.codex) account.
   *  Omitted for runtimes where it is not resolved (e.g. per-distro WSL). */
  systemDefault?: CodexSystemDefaultIdentity
}

export type CodexManagedAccountRuntimeSelection = {
  host: string | null
  wsl: Record<string, string | null>
}

export type ClaudeManagedAccount = {
  id: string
  email: string
  managedAuthPath: string
  managedAuthRuntime?: 'host' | 'wsl'
  wslDistro?: string | null
  wslLinuxAuthPath?: string | null
  authMethod: 'subscription-oauth' | 'unknown'
  organizationUuid?: string | null
  organizationName?: string | null
  createdAt: number
  updatedAt: number
  lastAuthenticatedAt: number
}

export type ClaudeManagedAccountSummary = {
  id: string
  email: string
  managedAuthRuntime?: 'host' | 'wsl'
  wslDistro?: string | null
  authMethod: 'subscription-oauth' | 'unknown'
  organizationUuid?: string | null
  organizationName?: string | null
  createdAt: number
  updatedAt: number
  lastAuthenticatedAt: number
}

export type ClaudeRateLimitAccountsState = {
  accounts: ClaudeManagedAccountSummary[]
  activeAccountId: string | null
  activeAccountIdsByRuntime?: ClaudeManagedAccountRuntimeSelection
}

export type ClaudeManagedAccountRuntimeSelection = {
  host: string | null
  wsl: Record<string, string | null>
}

/** All AI coding agents Orca knows how to launch. Used for the agent picker in the new-workspace
 *  flow and for the default-agent setting. Extend this union as new agents are added. */
export type TuiAgent =
  | 'claude' // Claude Code
  | 'claude-agent-teams' // Claude Code Agent Teams via Orca native panes
  | 'openclaude' // OpenClaude
  | 'codex' // OpenAI Codex
  | 'autohand' // Autohand Code CLI
  | 'opencode' // OpenCode
  | 'mimo-code'
  | 'pi' // Pi (pi.dev)
  | 'omp' // OMP (omp.sh)
  | 'gemini' // Gemini CLI
  | 'antigravity' // Google Antigravity CLI
  | 'aider' // Aider
  | 'goose' // Goose
  | 'amp' // Amp
  | 'kilo' // Kilocode
  | 'kiro' // Kiro
  | 'crush' // Charm/Crush
  | 'aug' // Augment/Auggie
  | 'cline' // Cline
  | 'codebuff' // Codebuff
  | 'command-code' // Command Code
  | 'continue' // Continue
  | 'cursor' // Cursor
  | 'droid' // Factory Droid
  | 'kimi' // Kimi
  | 'mistral-vibe' // Mistral Vibe
  | 'qwen-code' // Qwen Code
  | 'rovo' // Rovo Dev
  | 'hermes' // Hermes Agent
  | 'openclaw' // OpenClaw
  | 'copilot' // GitHub Copilot CLI
  | 'grok' // xAI Grok CLI
  | 'devin' // Devin CLI
  | 'ante' // Ante (Antigma Labs)
  | 'trae' // Trae CLI

export type TaskViewPresetId = 'all' | 'issues' | 'review' | 'my-issues' | 'my-prs' | 'prs'

/** Where the repo setup script runs when a worktree is created.
 *  - 'new-tab': open a background tab titled "Setup" and leave focus on the first tab (default).
 *  - 'split-vertical': split the initial terminal pane with a vertical divider.
 *  - 'split-horizontal': split the initial terminal pane with a horizontal divider. */
export type SetupScriptLaunchMode = 'split-vertical' | 'split-horizontal' | 'new-tab'

/** Direction used when the setup script launch mode is a split. */
export type SetupSplitDirection = 'vertical' | 'horizontal'

export type TerminalColorOverrides = {
  foreground?: string
  background?: string
  cursor?: string
  cursorAccent?: string
  selectionBackground?: string
  selectionForeground?: string
  black?: string
  red?: string
  green?: string
  yellow?: string
  blue?: string
  magenta?: string
  cyan?: string
  white?: string
  brightBlack?: string
  brightRed?: string
  brightGreen?: string
  brightYellow?: string
  brightBlue?: string
  brightMagenta?: string
  brightCyan?: string
  brightWhite?: string
  // Why: xterm.js ITheme does not expose a `bold` key, but Ghostty users
  // expect the setting to be preserved so a future renderer CSS override
  // or xterm upgrade can honour it without a migration.
  bold?: string
}

export type TerminalQuickCommandScope =
  | {
      type: 'global'
    }
  | {
      type: 'repo'
      repoId: string
    }

export type TerminalQuickCommandAction = 'terminal-command' | 'agent-prompt'

export type TerminalQuickCommandBase = {
  id: string
  label: string
  scope?: TerminalQuickCommandScope
}

export type TerminalCommandQuickCommand = TerminalQuickCommandBase & {
  action?: 'terminal-command'
  command: string
  appendEnter: boolean
}

export type TerminalAgentQuickCommand = TerminalQuickCommandBase & {
  action: 'agent-prompt'
  agent: TuiAgent
  prompt: string
}

export type TerminalQuickCommand = TerminalCommandQuickCommand | TerminalAgentQuickCommand

export type OpenInApplication = {
  id: string
  label: string
  command: string
}

export type SourceControlViewMode = 'list' | 'tree'
export type SourceControlGroupOrder = 'changes-first' | 'staged-first' | 'untracked-first'

export type LeftSidebarAppearanceMode = 'default' | 'match-terminal' | 'tinted'

/** Strategy for the prefix prepended to worktree branch names. */
export type BranchPrefixStrategy = 'git-username' | 'custom' | 'none'

export type FloatingTerminalCwdRequest = {
  path?: string
  requireTrusted?: boolean
}

/** Per-host overrides for client preferences that genuinely vary by execution
 *  host. NARROW by design: only settings whose value is meaningless to share
 *  across hosts belong here.
 *  - `displayLabel`: a client-side rename for the host shown in sidebar/pickers.
 *  - `defaultWorktreeLocation`: the host's root worktree directory; a remote
 *    SSH/runtime host has a different filesystem layout than the local Mac, so
 *    the client `workspaceDir` default cannot apply unchanged. */
export type HostSettingOverrides = {
  displayLabel?: string
  defaultWorktreeLocation?: string
}

/** Presentation mode for the experimental Agent Dashboard. */
export type AgentDashboardMode = 'in-window' | 'popout'

