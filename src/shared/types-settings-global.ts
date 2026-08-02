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
type ShellHydrationFailureReason = SharedTypeDefinitions.ShellHydrationFailureReason; type PathSource = SharedTypeDefinitions.PathSource; type RepoKind = SharedTypeDefinitions.RepoKind; type IssueSourcePreference = SharedTypeDefinitions.IssueSourcePreference; type ExternalWorktreeVisibility = SharedTypeDefinitions.ExternalWorktreeVisibility; type ProjectProviderIdentity = SharedTypeDefinitions.ProjectProviderIdentity; type Project = SharedTypeDefinitions.Project; type ProjectUpdateArgs = SharedTypeDefinitions.ProjectUpdateArgs; type ProjectHostSetupState = SharedTypeDefinitions.ProjectHostSetupState; type ProjectHostSetupMethod = SharedTypeDefinitions.ProjectHostSetupMethod; type RepoProjectHostSetupMethod = SharedTypeDefinitions.RepoProjectHostSetupMethod; type ProjectHostSetup = SharedTypeDefinitions.ProjectHostSetup; type ProjectHostSetupExistingFolderArgs = SharedTypeDefinitions.ProjectHostSetupExistingFolderArgs; type ProjectHostSetupCreateArgs = SharedTypeDefinitions.ProjectHostSetupCreateArgs; type ProjectHostSetupCloneArgs = SharedTypeDefinitions.ProjectHostSetupCloneArgs; type ProjectHostSetupUpdateArgs = SharedTypeDefinitions.ProjectHostSetupUpdateArgs; type ProjectHostSetupDeleteArgs = SharedTypeDefinitions.ProjectHostSetupDeleteArgs; type ProjectHostSetupResult = SharedTypeDefinitions.ProjectHostSetupResult; type ProjectHostSetupCreateResult = SharedTypeDefinitions.ProjectHostSetupCreateResult; type ProjectHostSetupUpdateResult = SharedTypeDefinitions.ProjectHostSetupUpdateResult; type ProjectHostSetupDeleteResult = SharedTypeDefinitions.ProjectHostSetupDeleteResult; type Repo = SharedTypeDefinitions.Repo; type ProjectGroupCreatedFrom = SharedTypeDefinitions.ProjectGroupCreatedFrom; type ProjectGroup = SharedTypeDefinitions.ProjectGroup; type WorkspaceScope = SharedTypeDefinitions.WorkspaceScope; type WorkspaceKey = SharedTypeDefinitions.WorkspaceKey; type FolderWorkspace = SharedTypeDefinitions.FolderWorkspace; type WorkspaceLinkedItem = SharedTypeDefinitions.WorkspaceLinkedItem; type FolderWorkspaceLinkedTask = SharedTypeDefinitions.FolderWorkspaceLinkedTask; type NestedRepoScanOptions = SharedTypeDefinitions.NestedRepoScanOptions; type NestedRepoCandidate = SharedTypeDefinitions.NestedRepoCandidate; type NestedRepoScanResult = SharedTypeDefinitions.NestedRepoScanResult; type ProjectGroupImportMode = SharedTypeDefinitions.ProjectGroupImportMode; type ProjectGroupImportProjectResult = SharedTypeDefinitions.ProjectGroupImportProjectResult; type ProjectGroupImportResult = SharedTypeDefinitions.ProjectGroupImportResult; type SetupRunPolicy = SharedTypeDefinitions.SetupRunPolicy; type SetupAgentStartupPolicy = SharedTypeDefinitions.SetupAgentStartupPolicy; type SetupDecision = SharedTypeDefinitions.SetupDecision; type HookCommandSourcePolicy = SharedTypeDefinitions.HookCommandSourcePolicy; type BaseRefDefaultResult = SharedTypeDefinitions.BaseRefDefaultResult; type BaseRefSearchResult = SharedTypeDefinitions.BaseRefSearchResult; type GitWorktreeInfo = SharedTypeDefinitions.GitWorktreeInfo; type WorktreeHeadIdentity = SharedTypeDefinitions.WorktreeHeadIdentity; type WorkspaceStatus = SharedTypeDefinitions.WorkspaceStatus; type WorkspaceStatusDefinition = SharedTypeDefinitions.WorkspaceStatusDefinition; type Worktree = SharedTypeDefinitions.Worktree; type CliWorkspaceProvenance = SharedTypeDefinitions.CliWorkspaceProvenance; type AutomationWorkspaceProvenance = SharedTypeDefinitions.AutomationWorkspaceProvenance; type AutomationWorkspaceProvenanceRequest = SharedTypeDefinitions.AutomationWorkspaceProvenanceRequest; type GitPushTarget = SharedTypeDefinitions.GitPushTarget; type GitHubPrStartPoint = SharedTypeDefinitions.GitHubPrStartPoint; type WorktreeMeta = SharedTypeDefinitions.WorktreeMeta; type WorktreeOwnership = SharedTypeDefinitions.WorktreeOwnership; type DetectedWorktreeListSource = SharedTypeDefinitions.DetectedWorktreeListSource; type DetectedWorktree = SharedTypeDefinitions.DetectedWorktree; type DetectedWorktreeListResult = SharedTypeDefinitions.DetectedWorktreeListResult; type WorktreeLineageOrigin = SharedTypeDefinitions.WorktreeLineageOrigin; type WorktreeLineageCaptureConfidence = SharedTypeDefinitions.WorktreeLineageCaptureConfidence; type WorktreeLineageCaptureSource = SharedTypeDefinitions.WorktreeLineageCaptureSource; type WorktreeLineageCapture = SharedTypeDefinitions.WorktreeLineageCapture; type WorktreeLineage = SharedTypeDefinitions.WorktreeLineage; type WorkspaceLineage = SharedTypeDefinitions.WorkspaceLineage; type WorktreeLineageWarningCode = SharedTypeDefinitions.WorktreeLineageWarningCode; type WorktreeLineageWarning = SharedTypeDefinitions.WorktreeLineageWarning; type DiffCommentSource = SharedTypeDefinitions.DiffCommentSource; type DiffReviewScope = SharedTypeDefinitions.DiffReviewScope; type MobileDiffReviewFileState = SharedTypeDefinitions.MobileDiffReviewFileState; type MobileDiffReviewState = SharedTypeDefinitions.MobileDiffReviewState; type DiffComment = SharedTypeDefinitions.DiffComment; type TabGroupSplitDirection = SharedTypeDefinitions.TabGroupSplitDirection; type TabGroupLayoutNode = SharedTypeDefinitions.TabGroupLayoutNode; type TabContentType = SharedTypeDefinitions.TabContentType; type WorkspaceVisibleTabType = SharedTypeDefinitions.WorkspaceVisibleTabType; type CtrlTabOrderMode = SharedTypeDefinitions.CtrlTabOrderMode; type Tab = SharedTypeDefinitions.Tab; type TabGroup = SharedTypeDefinitions.TabGroup; type TerminalTab = SharedTypeDefinitions.TerminalTab; type BrowserHistoryEntry = SharedTypeDefinitions.BrowserHistoryEntry; type BrowserLoadError = SharedTypeDefinitions.BrowserLoadError; type BrowserCertificateFailure = SharedTypeDefinitions.BrowserCertificateFailure; type BrowserCertificateProceedFailureReason = SharedTypeDefinitions.BrowserCertificateProceedFailureReason; type BrowserCertificateProceedResult = SharedTypeDefinitions.BrowserCertificateProceedResult; type BrowserViewportPresetId = SharedTypeDefinitions.BrowserViewportPresetId; type BrowserViewportOverride = SharedTypeDefinitions.BrowserViewportOverride; type BrowserPage = SharedTypeDefinitions.BrowserPage; type BrowserWorkspace = SharedTypeDefinitions.BrowserWorkspace; type BrowserTab = SharedTypeDefinitions.BrowserTab; type BrowserSessionProfileScope = SharedTypeDefinitions.BrowserSessionProfileScope; type BrowserSessionProfileSource = SharedTypeDefinitions.BrowserSessionProfileSource; type BrowserSessionProfile = SharedTypeDefinitions.BrowserSessionProfile; type BrowserCookieImportSummary = SharedTypeDefinitions.BrowserCookieImportSummary; type BrowserCookieImportResult = SharedTypeDefinitions.BrowserCookieImportResult; type TerminalPaneSplitDirection = SharedTypeDefinitions.TerminalPaneSplitDirection; type TerminalPaneLayoutNode = SharedTypeDefinitions.TerminalPaneLayoutNode; type TerminalLayoutSnapshot = SharedTypeDefinitions.TerminalLayoutSnapshot; type PersistedOpenFile = SharedTypeDefinitions.PersistedOpenFile; type WorkspaceSessionState = SharedTypeDefinitions.WorkspaceSessionState; type WorkspaceSessionPatch = SharedTypeDefinitions.WorkspaceSessionPatch; type PRState = SharedTypeDefinitions.PRState; type IssueState = SharedTypeDefinitions.IssueState; type CheckStatus = SharedTypeDefinitions.CheckStatus; type PRMergeableState = SharedTypeDefinitions.PRMergeableState; type PRReviewDecision = SharedTypeDefinitions.PRReviewDecision; type PRConflictSummary = SharedTypeDefinitions.PRConflictSummary; type GitHubRepositoryIdentity = SharedTypeDefinitions.GitHubRepositoryIdentity; type GitHubPRMergeMethod = SharedTypeDefinitions.GitHubPRMergeMethod; type GitHubPRMergeMethodSettings = SharedTypeDefinitions.GitHubPRMergeMethodSettings; type PRInfo = SharedTypeDefinitions.PRInfo; type PRRefreshErrorType = SharedTypeDefinitions.PRRefreshErrorType; type PRRefreshUpstreamErrorType = SharedTypeDefinitions.PRRefreshUpstreamErrorType; type PRRefreshOutcome = SharedTypeDefinitions.PRRefreshOutcome; type GitHubPRRefreshReason = SharedTypeDefinitions.GitHubPRRefreshReason; type GitHubPRRefreshEnqueueResult = SharedTypeDefinitions.GitHubPRRefreshEnqueueResult; type GitHubPRRefreshAlias = SharedTypeDefinitions.GitHubPRRefreshAlias; type GitHubPRRefreshCandidate = SharedTypeDefinitions.GitHubPRRefreshCandidate; type GitHubPRRefreshSkippedReason = SharedTypeDefinitions.GitHubPRRefreshSkippedReason; type GitHubPRRefreshEvent = SharedTypeDefinitions.GitHubPRRefreshEvent; type PRCheckDetail = SharedTypeDefinitions.PRCheckDetail; type PRCheckAnnotation = SharedTypeDefinitions.PRCheckAnnotation; type PRCheckStep = SharedTypeDefinitions.PRCheckStep; type PRCheckJob = SharedTypeDefinitions.PRCheckJob; type PRCheckRunDetails = SharedTypeDefinitions.PRCheckRunDetails; type GitHubRerunPRChecksResult = SharedTypeDefinitions.GitHubRerunPRChecksResult; type GitHubReactionContent = SharedTypeDefinitions.GitHubReactionContent; type GitHubReaction = SharedTypeDefinitions.GitHubReaction; type PRComment = SharedTypeDefinitions.PRComment; type GitHubIssueTimelineTarget = SharedTypeDefinitions.GitHubIssueTimelineTarget; type GitHubIssueTimelineItem = SharedTypeDefinitions.GitHubIssueTimelineItem; type GitHubCommentResult = SharedTypeDefinitions.GitHubCommentResult; type IssueInfo = SharedTypeDefinitions.IssueInfo; type GitHubViewer = SharedTypeDefinitions.GitHubViewer; type GitHubAssignableUser = SharedTypeDefinitions.GitHubAssignableUser; type ProviderCheckSummary = SharedTypeDefinitions.ProviderCheckSummary; type GitHubPRReviewSummary = SharedTypeDefinitions.GitHubPRReviewSummary; type GitHubPRFileViewedState = SharedTypeDefinitions.GitHubPRFileViewedState; type GitHubWorkItem = SharedTypeDefinitions.GitHubWorkItem; type GitHubPRFile = SharedTypeDefinitions.GitHubPRFile; type GitHubPRFileContents = SharedTypeDefinitions.GitHubPRFileContents; type GitHubPRReviewCommentInput = SharedTypeDefinitions.GitHubPRReviewCommentInput; type GitHubWorkItemDetails = SharedTypeDefinitions.GitHubWorkItemDetails; type LinearViewer = SharedTypeDefinitions.LinearViewer; type LinearWorkspace = SharedTypeDefinitions.LinearWorkspace; type LinearWorkspaceSelection = SharedTypeDefinitions.LinearWorkspaceSelection; type LinearWorkspaceSelector = SharedTypeDefinitions.LinearWorkspaceSelector; type LinearConcreteWorkspaceId = SharedTypeDefinitions.LinearConcreteWorkspaceId; type LinearWorkspaceError = SharedTypeDefinitions.LinearWorkspaceError; type LinearCollectionResult = SharedTypeDefinitions.LinearCollectionResult; type LinearConnectionStatus = SharedTypeDefinitions.LinearConnectionStatus; type LinearIssue = SharedTypeDefinitions.LinearIssue; type LinearProjectSummary = SharedTypeDefinitions.LinearProjectSummary; type LinearProjectStatusSummary = SharedTypeDefinitions.LinearProjectStatusSummary; type LinearProjectMemberSummary = SharedTypeDefinitions.LinearProjectMemberSummary; type LinearProjectMilestoneSummary = SharedTypeDefinitions.LinearProjectMilestoneSummary; type LinearProjectResourceSummary = SharedTypeDefinitions.LinearProjectResourceSummary; type LinearProjectUpdateSummary = SharedTypeDefinitions.LinearProjectUpdateSummary; type LinearProjectDetail = SharedTypeDefinitions.LinearProjectDetail; type LinearCustomViewModel = SharedTypeDefinitions.LinearCustomViewModel; type LinearCustomViewSummary = SharedTypeDefinitions.LinearCustomViewSummary; type LinearIssueChildSummary = SharedTypeDefinitions.LinearIssueChildSummary; type LinearComment = SharedTypeDefinitions.LinearComment; type GitHubCreateIssueFields = SharedTypeDefinitions.GitHubCreateIssueFields; type GitHubCreateIssueResult = SharedTypeDefinitions.GitHubCreateIssueResult; type GitHubIssueCloseReason = SharedTypeDefinitions.GitHubIssueCloseReason; type GitHubIssueUpdate = SharedTypeDefinitions.GitHubIssueUpdate; type GitHubPullRequestStateUpdate = SharedTypeDefinitions.GitHubPullRequestStateUpdate; type LinearIssueUpdate = SharedTypeDefinitions.LinearIssueUpdate; type ClassifiedError = SharedTypeDefinitions.ClassifiedError; type GitHubOwnerRepo = SharedTypeDefinitions.GitHubOwnerRepo; type GitHubRateLimitBucket = SharedTypeDefinitions.GitHubRateLimitBucket; type GitHubRateLimitSnapshot = SharedTypeDefinitions.GitHubRateLimitSnapshot; type GetRateLimitResult = SharedTypeDefinitions.GetRateLimitResult; type ListWorkItemsResult = SharedTypeDefinitions.ListWorkItemsResult; type LinearWorkflowState = SharedTypeDefinitions.LinearWorkflowState; type LinearLabel = SharedTypeDefinitions.LinearLabel; type LinearMember = SharedTypeDefinitions.LinearMember; type LinearTeam = SharedTypeDefinitions.LinearTeam; type OrcaHooks = SharedTypeDefinitions.OrcaHooks; type OrcaWorktreeDefaults = SharedTypeDefinitions.OrcaWorktreeDefaults; type OrcaDefaultTabTemplate = SharedTypeDefinitions.OrcaDefaultTabTemplate; type OrcaVmRecipe = SharedTypeDefinitions.OrcaVmRecipe; type OrcaVmRecipeDiagnostic = SharedTypeDefinitions.OrcaVmRecipeDiagnostic; type RepoHookSettings = SharedTypeDefinitions.RepoHookSettings; type WorktreeSetupLaunch = SharedTypeDefinitions.WorktreeSetupLaunch; type WorktreeStartupLaunch = SharedTypeDefinitions.WorktreeStartupLaunch; type WorktreeDefaultTabsLaunch = SharedTypeDefinitions.WorktreeDefaultTabsLaunch; type WorktreeCreateTimingPhase = SharedTypeDefinitions.WorktreeCreateTimingPhase; type WorktreeCreateTiming = SharedTypeDefinitions.WorktreeCreateTiming; type CreateSparseCheckoutRequest = SharedTypeDefinitions.CreateSparseCheckoutRequest; type SparsePreset = SharedTypeDefinitions.SparsePreset; type CreateWorktreeArgs = SharedTypeDefinitions.CreateWorktreeArgs; type CreateWorktreeResult = SharedTypeDefinitions.CreateWorktreeResult; type WorktreeCreateBaseFallback = SharedTypeDefinitions.WorktreeCreateBaseFallback; type PreservedWorktreeBranch = SharedTypeDefinitions.PreservedWorktreeBranch; type RemoveWorktreeResult = SharedTypeDefinitions.RemoveWorktreeResult; type ForceDeleteWorktreeBranchResult = SharedTypeDefinitions.ForceDeleteWorktreeBranchResult; type LocalBaseRefRefreshResult = SharedTypeDefinitions.LocalBaseRefRefreshResult; type LocalBaseRefUpdateSuggestion = SharedTypeDefinitions.LocalBaseRefUpdateSuggestion; type WorktreeBaseStatusKind = SharedTypeDefinitions.WorktreeBaseStatusKind; type WorktreeBaseStatusEvent = SharedTypeDefinitions.WorktreeBaseStatusEvent; type WorktreeRemoteBranchConflictEvent = SharedTypeDefinitions.WorktreeRemoteBranchConflictEvent; type ChangelogRelease = SharedTypeDefinitions.ChangelogRelease; type ChangelogData = SharedTypeDefinitions.ChangelogData; type UpdateCheckOptions = SharedTypeDefinitions.UpdateCheckOptions; type UpdateSource = SharedTypeDefinitions.UpdateSource; type UpdateStatus = SharedTypeDefinitions.UpdateStatus; type ReleaseBuildListResult = SharedTypeDefinitions.ReleaseBuildListResult; type NotificationSettings = SharedTypeDefinitions.NotificationSettings; type CodexManagedAccount = SharedTypeDefinitions.CodexManagedAccount; type CodexManagedAccountSummary = SharedTypeDefinitions.CodexManagedAccountSummary; type CodexSystemDefaultIdentity = SharedTypeDefinitions.CodexSystemDefaultIdentity; type CodexRateLimitAccountsState = SharedTypeDefinitions.CodexRateLimitAccountsState; type CodexManagedAccountRuntimeSelection = SharedTypeDefinitions.CodexManagedAccountRuntimeSelection; type ClaudeManagedAccount = SharedTypeDefinitions.ClaudeManagedAccount; type ClaudeManagedAccountSummary = SharedTypeDefinitions.ClaudeManagedAccountSummary; type ClaudeRateLimitAccountsState = SharedTypeDefinitions.ClaudeRateLimitAccountsState; type ClaudeManagedAccountRuntimeSelection = SharedTypeDefinitions.ClaudeManagedAccountRuntimeSelection; type TuiAgent = SharedTypeDefinitions.TuiAgent; type TaskViewPresetId = SharedTypeDefinitions.TaskViewPresetId; type SetupScriptLaunchMode = SharedTypeDefinitions.SetupScriptLaunchMode; type SetupSplitDirection = SharedTypeDefinitions.SetupSplitDirection; type TerminalColorOverrides = SharedTypeDefinitions.TerminalColorOverrides; type TerminalQuickCommandScope = SharedTypeDefinitions.TerminalQuickCommandScope; type TerminalQuickCommandAction = SharedTypeDefinitions.TerminalQuickCommandAction; type TerminalQuickCommandBase = SharedTypeDefinitions.TerminalQuickCommandBase; type TerminalCommandQuickCommand = SharedTypeDefinitions.TerminalCommandQuickCommand; type TerminalAgentQuickCommand = SharedTypeDefinitions.TerminalAgentQuickCommand; type TerminalQuickCommand = SharedTypeDefinitions.TerminalQuickCommand; type OpenInApplication = SharedTypeDefinitions.OpenInApplication; type SourceControlViewMode = SharedTypeDefinitions.SourceControlViewMode; type SourceControlGroupOrder = SharedTypeDefinitions.SourceControlGroupOrder; type LeftSidebarAppearanceMode = SharedTypeDefinitions.LeftSidebarAppearanceMode; type BranchPrefixStrategy = SharedTypeDefinitions.BranchPrefixStrategy; type FloatingTerminalCwdRequest = SharedTypeDefinitions.FloatingTerminalCwdRequest; type HostSettingOverrides = SharedTypeDefinitions.HostSettingOverrides; type AgentDashboardMode = SharedTypeDefinitions.AgentDashboardMode; type OrcaWorkspaceLayout = SharedTypeDefinitions.OrcaWorkspaceLayout; type CommitMessageAiModelCapability = SharedTypeDefinitions.CommitMessageAiModelCapability; type CommitMessageAiSettings = SharedTypeDefinitions.CommitMessageAiSettings; type GhosttyImportPreview = SharedTypeDefinitions.GhosttyImportPreview; type DiscoveryStatusEmitted = SharedTypeDefinitions.DiscoveryStatusEmitted; type NotificationEventSource = SharedTypeDefinitions.NotificationEventSource; type NotificationDispatchRequest = SharedTypeDefinitions.NotificationDispatchRequest; type NotificationDispatchResult = SharedTypeDefinitions.NotificationDispatchResult; type NotificationDismissResult = SharedTypeDefinitions.NotificationDismissResult; type NotificationSoundResult = SharedTypeDefinitions.NotificationSoundResult; type NotificationSoundDataResult = SharedTypeDefinitions.NotificationSoundDataResult; type NotificationSoundPathResult = SharedTypeDefinitions.NotificationSoundPathResult; type OnboardingOutcome = SharedTypeDefinitions.OnboardingOutcome; type OnboardingChecklistState = SharedTypeDefinitions.OnboardingChecklistState; type OnboardingState = SharedTypeDefinitions.OnboardingState; type NotificationPermissionStatusResult = SharedTypeDefinitions.NotificationPermissionStatusResult; type NotificationDeliveryProbeResult = SharedTypeDefinitions.NotificationDeliveryProbeResult; type WorktreeCardProperty = SharedTypeDefinitions.WorktreeCardProperty; type WorktreeCardMode = SharedTypeDefinitions.WorktreeCardMode; type AgentActivityDisplayMode = SharedTypeDefinitions.AgentActivityDisplayMode; type StatusBarItem = SharedTypeDefinitions.StatusBarItem; type FloatingTerminalTriggerLocation = SharedTypeDefinitions.FloatingTerminalTriggerLocation; type TaskResumeState = SharedTypeDefinitions.TaskResumeState; type RightSidebarTab = SharedTypeDefinitions.RightSidebarTab; type ActiveRightSidebarTab = SharedTypeDefinitions.ActiveRightSidebarTab; type RightSidebarExplorerView = SharedTypeDefinitions.RightSidebarExplorerView; type ProjectOrderBy = SharedTypeDefinitions.ProjectOrderBy; type WorkspaceHostScope = SharedTypeDefinitions.WorkspaceHostScope; type VisibleWorkspaceHostIds = SharedTypeDefinitions.VisibleWorkspaceHostIds; type WorkspaceHostOrder = SharedTypeDefinitions.WorkspaceHostOrder; type ManualRepoOrderEntry = SharedTypeDefinitions.ManualRepoOrderEntry; type TopLevelView = SharedTypeDefinitions.TopLevelView; type PersistedUIState = SharedTypeDefinitions.PersistedUIState; type CustomPet = SharedTypeDefinitions.CustomPet; type SpriteAnimation = SharedTypeDefinitions.SpriteAnimation; type PersistedTrustedOrcaHookEntry = SharedTypeDefinitions.PersistedTrustedOrcaHookEntry; type PersistedTrustedOrcaHookRepo = SharedTypeDefinitions.PersistedTrustedOrcaHookRepo; type PersistedTrustedOrcaHooks = SharedTypeDefinitions.PersistedTrustedOrcaHooks; type LegacyPaneKeyAliasEntry = SharedTypeDefinitions.LegacyPaneKeyAliasEntry; type PersistedMobileClientTabSelection = SharedTypeDefinitions.PersistedMobileClientTabSelection; type PersistedMobileClientTabSelections = SharedTypeDefinitions.PersistedMobileClientTabSelections; type PersistedState = SharedTypeDefinitions.PersistedState; type FilesystemPathFlavor = SharedTypeDefinitions.FilesystemPathFlavor; type DirEntry = SharedTypeDefinitions.DirEntry; type MarkdownDocument = SharedTypeDefinitions.MarkdownDocument; type FsChangeEvent = SharedTypeDefinitions.FsChangeEvent; type FsChangedPayload = SharedTypeDefinitions.FsChangedPayload; type GitBranchChangeEntry = SharedTypeDefinitions.GitBranchChangeEntry; type GitBranchCompareSummary = SharedTypeDefinitions.GitBranchCompareSummary; type GitBranchCompareResult = SharedTypeDefinitions.GitBranchCompareResult; type GitCommitCompareSummary = SharedTypeDefinitions.GitCommitCompareSummary; type GitCommitCompareResult = SharedTypeDefinitions.GitCommitCompareResult; type GitDiffTextResult = SharedTypeDefinitions.GitDiffTextResult; type GitDiffBinaryResult = SharedTypeDefinitions.GitDiffBinaryResult; type GitDiffResult = SharedTypeDefinitions.GitDiffResult; type SearchMatch = SharedTypeDefinitions.SearchMatch; type SearchFileResult = SharedTypeDefinitions.SearchFileResult; type SearchResult = SharedTypeDefinitions.SearchResult; type SearchOptions = SharedTypeDefinitions.SearchOptions; type StatsSummary = SharedTypeDefinitions.StatsSummary; type UsageValues = SharedTypeDefinitions.UsageValues; type ProcessMemoryMetric = SharedTypeDefinitions.ProcessMemoryMetric; type HostAvailableMemorySource = SharedTypeDefinitions.HostAvailableMemorySource; type AppMemory = SharedTypeDefinitions.AppMemory; type SessionMemory = SharedTypeDefinitions.SessionMemory; type WorktreeMemory = SharedTypeDefinitions.WorktreeMemory; type HostMemory = SharedTypeDefinitions.HostMemory; type MemorySnapshot = SharedTypeDefinitions.MemorySnapshot;

export type GlobalSettings = {
  workspaceDir: string
  /** Per-host overrides keyed by ExecutionHostId. Effective value for a
   *  host-varying setting is `host override ?? client default`. */
  hostSettingOverrides?: Partial<Record<ExecutionHostId, HostSettingOverrides>>
  nestWorkspaces: boolean
  workspaceDirHistory?: OrcaWorkspaceLayout[]
  refreshLocalBaseRefOnWorktreeCreate: boolean
  /** Set once the user dismisses the "local main is behind" suggestion toast, so
   *  the nudge to enable refreshLocalBaseRefOnWorktreeCreate never shows again. */
  localBaseRefSuggestionDismissed: boolean
  /** When enabled, Orca renames a workspace's auto-generated creature branch to
   *  a short name derived from the first prompt once work begins. Users can
   *  still turn this off from global Git settings. */
  autoRenameBranchFromWork: boolean
  /** One-shot migration guard for the default-on rollout. Existing profiles
   *  without the guard are flipped on once; later explicit opt-outs stick. */
  autoRenameBranchFromWorkDefaultedOn?: boolean
  branchPrefix: BranchPrefixStrategy
  branchPrefixCustom: string
  enableGitHubAttribution: boolean
  theme: 'system' | 'dark' | 'light'
  /** Controls the left sidebar surface without changing terminal brightness. */
  leftSidebarAppearanceMode: LeftSidebarAppearanceMode
  leftSidebarTintColor?: string
  leftSidebarTintOpacity?: number
  uiLanguage: UiLanguage
  appIcon: AppIconId
  appFontFamily: string
  editorAutoSave: boolean
  editorAutoSaveDelayMs: number
  editorMinimapEnabled: boolean
  /** Opt-in code-editor font; empty (the default) keeps following `terminalFontFamily`. */
  editorFontFamily?: string
  /** Defaults on for profiles saved before file-editor wrapping became configurable. */
  editorWordWrap?: boolean
  /** Persisted opt-out for browser spellcheck noise in rich Markdown editing surfaces. */
  richMarkdownSpellcheckEnabled?: boolean
  /** Whether local markdown review note controls and the review panel are shown. */
  markdownReviewToolsEnabled: boolean
  /** Why: mirrors terminal selection-paste muscle memory without mutating the
   *  normal system clipboard; Linux and macOS enable it by default, Windows
   *  leaves middle-click semantics unchanged unless the user opts in. */
  primarySelectionMiddleClickPaste?: boolean
  /** One-shot migration guard for turning the Linux default on for profiles
   *  that persisted the earlier off-by-default value. */
  primarySelectionMiddleClickPasteDefaultedForLinux?: boolean
  /** One-shot migration guard for widening the terminal-style default to
   *  Linux/macOS while preserving later explicit opt-outs. */
  primarySelectionMiddleClickPasteDefaultedForTerminalDefaults?: boolean
  terminalFontSize: number
  terminalFontFamily: string
  terminalFontWeight: number
  terminalLineHeight: number
  terminalScrollSensitivity: number
  terminalFastScrollSensitivity: number
  terminalTuiScrollSensitivity: number
  /** One-shot migration guard for moving inherited TUI wheel reports from 3 to 1. */
  terminalTuiScrollSensitivityDefaultedToOne?: boolean
  /** Terminal renderer policy.
   *  - 'auto': try xterm WebGL and fall back to DOM when unsupported or risky.
   *  - 'on': always try xterm WebGL.
   *  - 'off': keep terminal rendering on xterm's DOM renderer. */
  terminalGpuAcceleration: 'auto' | 'on' | 'off'
  /** Whether to enable programming-ligatures rendering via
   *  `@xterm/addon-ligatures`.
   *  - `'auto'` (default): enabled only when the configured font is known to
   *    ship ligatures (Fira Code, JetBrains Mono, Cascadia Code, etc.). This
   *    keeps the out-of-the-box experience right for users who install a
   *    ligature font without touching settings.
   *  - `'on'` / `'off'`: explicit override. Never changes when the user
   *    switches fonts, so "off" always stays off. */
  terminalLigatures: 'auto' | 'on' | 'off'
  terminalCursorStyle: 'bar' | 'block' | 'underline'
  /** One-shot migration guard for moving inherited cursor defaults to block. */
  terminalCursorStyleDefaultedToBlock?: boolean
  terminalCursorBlink: boolean
  terminalThemeDark: string
  terminalCustomThemes?: TerminalCustomTheme[]
  terminalDividerColorDark: string
  terminalUseSeparateLightTheme: boolean
  terminalThemeLight: string
  terminalDividerColorLight: string
  terminalInactivePaneOpacity: number
  terminalActivePaneOpacity: number
  terminalPaneOpacityTransitionMs: number
  terminalDividerThicknessPx: number
  terminalBackgroundOpacity?: number
  terminalColorOverrides?: TerminalColorOverrides
  terminalPaddingX?: number
  terminalPaddingY?: number
  terminalMouseHideWhileTyping?: boolean
  terminalWordSeparator?: string
  terminalCursorOpacity?: number
  terminalQuickCommands?: TerminalQuickCommand[]
  windowBackgroundBlur?: boolean
  /** Windows-only: close (X) hides to tray instead of quitting; the tray icon is always present regardless. */
  minimizeToTrayOnClose?: boolean
  /** macOS: toggles the additive menu-bar entry (Orca survives last-window close); doesn't change Dock behavior. */
  showMenuBarIcon?: boolean
  /** Windows convention: right-click pastes; macOS/Linux keep the context menu. */
  terminalRightClickToPaste: boolean
  /** One-shot guard distinguishing the old global true default from a per-platform choice. */
  terminalRightClickToPasteDefaultedForPlatform?: boolean
  /** Windows-only: COMSPEC always points to cmd.exe, so this explicit shell (default 'powershell.exe') overrides it. */
  terminalWindowsShell: string
  /** Pins the WSL distro for terminals/agent scans instead of WSL's current global default. */
  terminalWindowsWslDistro?: string | null
  /** Account/auth location; auto follows the global Windows runtime while host/wsl pin it. */
  localAccountRuntime: 'auto' | 'host' | 'wsl'
  localAccountWslDistro?: string | null
  /** One-shot guard for migrating the legacy host default to auto. */
  localAccountRuntimeDefaultedToAutoForAllUsers?: boolean
  /** Independent from the terminal shell so users can inspect Windows vs WSL agent PATH state without changing it. */
  localAgentRuntime?: 'host' | 'wsl'
  localAgentWslDistro?: string | null
  /** Why: global is only the default policy; project-level runtime preference wins. */
  localWindowsRuntimeDefault: GlobalWindowsRuntimeDefault
  /** 'auto' resolves to PowerShell 7+ when present, else falls back to inbox Windows PowerShell. */
  terminalWindowsPowerShellImplementation: 'auto' | 'powershell.exe' | 'pwsh.exe'
  terminalFocusFollowsMouse: boolean
  /** X11/gnome-terminal "copy on select": selecting text auto-copies to the clipboard; default off. */
  terminalClipboardOnSelect: boolean
  /** Enables OSC 52 clipboard writes for TUIs (tmux/Zellij/nvim, incl. over SSH); default on. Clipboard *queries* stay blocked and payload size is capped, so this is write-only exposure. */
  terminalAllowOsc52Clipboard: boolean
  /** One-shot stamp: profiles saved under the old off default get flipped on once, after which an explicit opt-out sticks. */
  terminalAllowOsc52ClipboardDefaultedOnForAllUsers?: boolean
  /** Experimental Claude Agent Teams; native panes use a tmux-compatible shim so teammate output stays on the normal PTY path. */
  claudeAgentTeamsMode?: ClaudeAgentTeamsMode
  /** Where the repo setup script runs on workspace create; defaults to a background "Setup" tab to keep the main terminal usable. */
  setupScriptLaunchMode: SetupScriptLaunchMode
  terminalScrollbackRows: number
  /** Optional app-level proxy for Electron networking and local PTYs; empty preserves system/inherited proxy env. */
  httpProxyUrl?: string
  /** Optional semicolon/comma/newline-separated bypass rules for httpProxyUrl. */
  httpProxyBypassRules?: string
  /** Why: corporate TLS-intercepting proxies can break HTTP/2 downloads; opt-in Chromium process-wide HTTP/1.1 switch. */
  electronHttp1CompatibilityMode?: boolean
  /** Opt-in in-app browsing (isolated guest surface); default keeps links opening in the system browser. */
  openLinksInApp: boolean
  /** Worktree-scoped localhost hostnames to distinguish tabs; opt-in since a non-localhost host can break apps binding cookies/sessions to localhost. */
  localhostWorktreeLabelsEnabled?: boolean
  /** Tracks the one-time first-use prompt for terminal link routing (avoid silently changing where links open). */
  openLinksInAppPreferencePrompted: boolean
  /** Opt-in: Shift+modifier click inverts openLinksInApp instead of always forcing the system browser. Off keeps the historical one-way escape hatch. */
  openLinksInAppModifierInverts?: boolean
  /** Opt-in: open new coding-agent tabs in native chat instead of the raw terminal; optional for legacy settings. */
  openAgentTabsInChatByDefault?: boolean
  /** Experimental native chat surface for Claude/Codex sessions; off by default. */
  experimentalNativeChat?: boolean
  /** Last explicit native-chat model + option selections; live panes need an applied/dispatched record before showing a value. */
  nativeChatSessionOptions?: PersistedNativeChatSessionOptions
  /** Extra launcher rows for the worktree "Open in" submenu. VS Code is always shown first. */
  openInApplications?: OpenInApplication[]
  /** Deprecated: migration/backward-compat only. Use PersistedUIState.rightSidebarOpen. */
  rightSidebarOpenByDefault: boolean
  showGitIgnoredFiles?: boolean
  /** Preferred Source Control changes layout. Per-user, not per-workspace. */
  sourceControlViewMode: SourceControlViewMode
  /** Preferred Source Control group order. Per-user, not per-workspace. */
  sourceControlGroupOrder: SourceControlGroupOrder
  /** Compare base defaults to the branch upstream instead of the repo default; affects only the compare/diff view, not the PR/rebase target. Per-user. */
  sourceControlCompareAgainstUpstream: boolean
  /** Whether to show the Orca app name in the titlebar. */
  showTitlebarAppName: boolean
  /** Hides the Tasks sidebar button (also removes it from keyboard navigation). */
  showTasksButton: boolean
  /** Only toggles the sidebar shortcut; Automations stay reachable from Settings/View menu. */
  showAutomationsButton?: boolean
  /** Only toggles the sidebar shortcut; Orca Mobile stays reachable from Settings. */
  showMobileButton?: boolean
  /** Pinned workspaces show in one sidebar location by default; opt in to also show them in their natural groups. */
  showPinnedWorktreesInGroups?: boolean
  /** How Ctrl+Tab picks the next visible tab; optional (older profiles), readers default to MRU. */
  ctrlTabOrderMode?: CtrlTabOrderMode
  /** Orca-first keeps app shortcuts from TUIs; terminal-first is opt-in to let shell/TUI bindings win. */
  terminalShortcutPolicy?: TerminalShortcutPolicy
  /** Floating Workspace: global surface for terminal/browser/markdown tabs outside repo/worktree context. */
  floatingTerminalEnabled: boolean
  /** One-shot migration flag for the floating-workspace default-on rollout; after migration an explicit off sticks. */
  floatingTerminalDefaultedForAllUsers?: boolean
  /** Start dir for new floating-workspace terminal tabs; empty or '~' = home dir. */
  floatingTerminalCwd: string
  /** Picker-approved floating-workspace dirs reauthorized across restarts; renderer text alone must not populate this. */
  floatingTerminalTrustedCwds?: string[]
  /** One-shot migration marker for legacy floating workspace cwd trust grants. */
  floatingTerminalCwdMigratedToAppWorkspace?: boolean
  /** Where the Floating Workspace toggle is shown; defaults to the floating button for discoverability. */
  floatingTerminalTriggerLocation: FloatingTerminalTriggerLocation
  /** Legacy keyboard-shortcut overrides; new writes go to ~/.orca/keybindings.json, migrated once when present. */
  keybindings?: KeybindingOverrides
  diffDefaultView: 'inline' | 'side-by-side'
  diffWordWrap: boolean
  combinedDiffFileTreeVisibleByDefault: boolean
  /** Bot-marked comment-author logins (stored lowercased); escape hatch for review bots on regular accounts that defeat provider metadata/heuristics. */
  prBotAuthorOverrides: string[]
  notifications: NotificationSettings
  /** Countdown after a Claude agent goes idle showing time left before the prompt cache expires. */
  promptCacheTimerEnabled: boolean
  /** Prompt-cache TTL (ms); only 300000 (5 min standard) or 3600000 (1 hr, extended-TTL plans). */
  promptCacheTtlMs: number
  /** Why: durable main-owned pref so Orca can prepare shared ~/.codex before the renderer hydrates. */
  codexManagedAccounts: CodexManagedAccount[]
  activeCodexManagedAccountId: string | null
  activeCodexManagedAccountIdsByRuntime?: CodexManagedAccountRuntimeSelection
  /** Why: persist only per-account auth (not a CLAUDE_CONFIG_DIR swap) so switching accounts doesn't fork Claude's shared chat/session context. */
  claudeManagedAccounts: ClaudeManagedAccount[]
  activeClaudeManagedAccountId: string | null
  activeClaudeManagedAccountIdsByRuntime?: ClaudeManagedAccountRuntimeSelection
  /** Per-worktree shell history file so ArrowUp doesn't surface other worktrees' commands. Defaults to true. */
  terminalScopeHistoryByWorktree: boolean
  /** Kill switch for hidden terminal view parking: unmount long-hidden panes while a pane-less watcher keeps PTY side effects alive. */
  terminalHiddenViewParking?: boolean
  /** Kill switch for SSH terminal parking (C1): SSH panes park like local ones; reveal restores from main's headless model, falling back to relay replay. */
  terminalSshViewParking?: boolean
  /** Kill switch for the hidden-worktree retention budget (C1): force-parks the least-recently-hidden un-parkable worktrees beyond a count budget or TTL. */
  terminalHiddenWorktreeRetentionBudget?: boolean
  /** Kill switch for main-process PTY side-effect authority; on (default) = title/bell/agent facts via pty:sideEffect channel, not renderer byte parsing. */
  terminalMainSideEffectAuthority?: boolean
  /** Kill switch for main's hidden-delivery gate (Phase 4): drops PTY bytes to hidden views after model ingestion; requires terminalMainSideEffectAuthority. */
  terminalHiddenDeliveryGate?: boolean
  /** Kill switch for main's model query responder (Phase 5); active only when both Phase-4 gates are also on. */
  terminalModelQueryAuthority?: boolean
  /** Which agent to pre-select in the new-workspace composer.
   *  - null: auto (first detected agent)
   *  - 'blank': blank terminal (no agent launched)
   *  - TuiAgent: a specific agent id */
  defaultTuiAgent: TuiAgent | 'blank' | null
  /** Agents hidden from picker/auto-launch; detection stays a raw PATH snapshot. */
  disabledTuiAgents: TuiAgent[]
  /** Master switch for the experimental plugin system. Off by default: no
   *  discovery, no panels, no plugin code paths run at all. */
  pluginSystemEnabled: boolean
  /** Qualified plugin keys (`publisher.id`) the user disabled. Discovered
   *  plugins stay listed but are not activated. */
  disabledPlugins: string[]
  /** Consent records: qualified plugin key → capability/worker-trust fingerprint.
   *  A plugin whose current fingerprint differs is pending again, so an update
   *  crossing either trust boundary re-prompts before code runs. Absent key =
   *  never consented. */
  pluginConsents: Record<string, string>
  /** Local directories loaded as dev-mode plugins (manifest hot-reload). */
  devPluginPaths: string[]
  /** One-shot guard: start Claude Agent Teams hidden for existing profiles without overriding later opt-ins. */
  claudeAgentTeamsDefaultDisabledMigrated?: boolean
  /** Why: worktree deletion is destructive (rm -rf of the working dir), so confirm by default. */
  skipDeleteWorktreeConfirm: boolean
  /** Why: closing a terminal with child processes kills foreground work; keep this skip separate from other confirmations. */
  skipCloseTerminalWithRunningProcessConfirm: boolean
  /** Why: deleting an automation also deletes its run history; keep this skip separate from worktree deletion. */
  skipDeleteAutomationConfirm: boolean
  /** Why: a Codex rate-limit reset spends a scarce credit on the live account; keep this skip separate from local confirmations. */
  skipCodexRateLimitResetConfirm: boolean
  /** Default preset in the new-workspace GitHub task view. */
  defaultTaskViewPreset: TaskViewPresetId
  /** Persisted last-used task source so Tasks reopens to the same provider instead of defaulting to GitHub. */
  defaultTaskSource: TaskProvider
  /** Persisted visible task providers; hides unused providers from Tasks chrome and sidebar shortcuts. */
  visibleTaskProviders: TaskProvider[]
  /** Why: one-shot guard to make Jira visible for existing profiles once, without re-adding after a later opt-out. */
  visibleTaskProvidersDefaultedForJira: boolean
  /** Persisted repo selection (cross-repo tasks view). null = sticky-all (includes future-added repos);
   *  string[] = frozen curated subset (ineligible ids dropped on load; empty after drop is treated as null). */
  defaultRepoSelection: string[] | null
  /** Persisted Linear team selection (tasks view). Same nullable-array pattern as
   *  defaultRepoSelection: null = sticky-all, string[] = frozen subset of team IDs. */
  defaultLinearTeamSelection: string[] | null
  /** Session cookie for OpenCode Go rate-limit fetching. Stored encrypted. */
  opencodeSessionCookie: string
  /** Optional OpenCode Go workspace ID override; when set, skips the workspaces lookup and fetches usage directly. */
  opencodeWorkspaceId: string
  /** Optional MiniMax group id. When empty, the usage fetcher extracts minimax_group_id_v2 from the cookie. */
  minimaxGroupId: string
  /** Comma-separated MiniMax model names to show in the status bar usage window. */
  minimaxUsageModels: string
  /** Extract OAuth credentials from the local Gemini CLI for rate-limit fetching. Off by default (explicit opt-in). */
  geminiCliOAuthEnabled: boolean
  /** Per-agent CLI command overrides. A missing key means use the catalog default binary name. */
  agentCmdOverrides: Partial<Record<TuiAgent, string>>
  /** Custom CODEX_HOME for Codex session-history discovery (defaults to ~/.codex).
   *  History-only: does not change which account/config/hooks Orca uses. */
  codexSessionSourceHome?: {
    /** Absolute host path; empty/undefined falls back to ~/.codex. */
    host?: string
    /** Per-WSL-distro absolute Linux path; missing distro falls back to <wslHome>/.codex. */
    wsl?: Record<string, string>
  }
  /** Per-agent default CLI arguments appended after the binary/path and before prompts. */
  agentDefaultArgs?: Partial<Record<TuiAgent, string>>
  /** Per-agent launch environment defaults used when yolo mode is exposed as env. */
  agentDefaultEnv?: Partial<Record<TuiAgent, Record<string, string>>>
  /** One-shot guard for adding yolo-mode default args to untouched agent launch profiles. */
  agentYoloDefaultsMigrated?: boolean
  /** Why: disabling must persist so startup doesn't reinstall global agent hook entries the user just removed. */
  agentStatusHooksEnabled: boolean
  /** Dismissed freshness tuples: no write authority, just suppress re-nudging the same official placement/revision. */
  dismissedSkillFreshnessNudges?: string[]
  /** Why: generated tab titles are subjective, so they stay opt-in and manual renames win. */
  tabAutoGenerateTitle: boolean
  /** Why: pinned tabs can still be closed via keyboard/native-menu; this gates that behind a confirmation. Defaults on. */
  confirmClosePinnedTab: boolean
  /** When true, Orca requests local awake assertions while hook-reported agents are working. */
  keepComputerAwakeWhileAgentsRun: boolean
  /** macOS Option key: compose layout chars (@ German, € French) vs act as Meta/Esc for readline.
   *  'auto' (default) = layout-aware via navigator.keyboard.getLayoutMap() (US → Meta, else compose);
   *  'false' = compose; 'true' = Meta on both Option keys; 'left'/'right' = only that key is Meta.
   *  See docs/terminal-option-key-layout-aware-default.md. */
  terminalMacOptionAsAlt: 'auto' | 'true' | 'false' | 'left' | 'right'
  /** One-shot migration guard for the 'auto' rollout. Old default 'true' was ambiguous (explicit vs default);
   *  on first upgrade launch, reset a persisted 'true' to 'auto' so non-US keyboards aren't broken by the stale default. */
  terminalMacOptionAsAltMigrated: boolean
  /** Whether macOS terminal input maps the physical JIS Yen (¥) key to backslash, per common terminal expectation. */
  terminalJISYenToBackslash: boolean
  experimentalMobile: boolean
  /** Why: iOS Simulator is default-on for capable macOS hosts; this is the durable off switch (hides UI, blocks CLI attach). */
  mobileEmulatorEnabled?: boolean
  /** Preferred iOS Simulator UDID for UI auto-attach and agent CLI attach. */
  mobileEmulatorDefaultDeviceUdid?: string | null
  /** Explicit Android SDK root for when auto-discovery (ANDROID_HOME / default path) fails; null (default) auto-discovers. */
  androidSdkPath?: string | null
  /** Auto-restore window (ms) for a phone-fit PTY after the last mobile subscriber leaves.
   *  `null` (default) holds phone size indefinitely; a finite value schedules restore.
   *  Clamped on read to [5_000ms, 60min]. See docs/mobile-fit-hold.md. */
  mobileAutoRestoreFitMs: number | null
  /** Preferred mobile pairing path for new QR codes. Missing/'automatic' = Anywhere (Relay + local);
   *  explicit 'local-only' = same-network only. */
  mobilePairingConnectionMode?: 'automatic' | 'local-only'
  /** Experimental: floating animated pet in the bottom-right corner. Opt-in cosmetic;
   *  off never mounts the overlay, and toggling takes effect instantly (renderer-side). */
  experimentalPet: boolean
  /** Legacy persisted key from before the sidekick -> pet rename; read only during migration, new writes use experimentalPet. */
  experimentalSidekick?: boolean
  /** Experimental: left-sidebar Agents view — threaded feed of agent completions, blocking/unread state, worktree creation. */
  experimentalActivity: boolean
  /** Experimental: pop-out Kanban dashboard for monitoring and opening agent terminals across worktrees. */
  experimentalAgentDashboardPopout?: boolean
  /** How the Agent Dashboard opens: an in-window companion board or a separate pop-out window. Defaults to in-window. */
  experimentalAgentDashboardMode?: AgentDashboardMode
  /** Includes stale quiet agents as a fourth Agent Dashboard column. */
  experimentalAgentDashboardShowIdle?: boolean
  /** One-shot migration guard for defaulting the Agents view off; later explicit opt-ins persist normally. */
  experimentalActivityDefaultedOffForAllUsers?: boolean
  /** Experimental: persistent terminal-pane attention ring for bell + agent-completion events. Opt-in while tuning signal/noise. */
  experimentalTerminalAttention: boolean
  /** Experimental: automatically sleep completed, resumable background agent terminals. */
  experimentalAgentHibernation?: boolean
  /** Milliseconds a completed agent must stay idle before hibernation can be considered. */
  agentHibernationIdleMs?: number
  /** Experimental: opt-in preview of the updated worktree-card layout and metadata behavior. */
  experimentalNewWorktreeCardStyle?: boolean
  /** Experimental: per-workspace on-demand environment recipes and setup surface. */
  experimentalEphemeralVms?: boolean
  /** Compact worktree cards: hide the metadata row when title and branch say the same thing. */
  compactWorktreeCards: boolean
  /** Legacy persisted key from the Experimental rollout; new writes use compactWorktreeCards. */
  experimentalCompactWorktreeCards?: boolean
  /** Active non-local runtime environment for client-routed RPC; null keeps local desktop behavior. */
  activeRuntimeEnvironmentId?: string | null
  /** GitHub Project mode state (pinned/recent/active project, last view per project).
   *  Optional for pre-feature profiles; the persistence merge hydrates the default. */
  githubProjects?: GitHubProjectSettings
  /** AI commit-message config (agent, model, per-model thinking, prompt suffix). Optional to avoid migrating existing profiles. */
  commitMessageAi?: CommitMessageAiSettings
  /** Source-control AI generation settings for commit messages and hosted-review drafts. */
  sourceControlAi?: SourceControlAiSettings
  /** GitLab project preferences (pinned + recent paths). Optional for pre-GitLab profiles; persistence merge fills the default. */
  gitlabProjects?: GitLabProjectSettings
  /** Anonymous product-telemetry state; optional until the one-shot Store.load() migration populates it.
   *  Holds only consent + identity, not volatile counters — those would amplify the debounced settings write. */
  telemetry?: {
    /** New users: true at install. Existing users: null until they resolve the first-launch banner. */
    optedIn: boolean | null
    /** Anonymous UUID v4. Generated on first run. Stable across launches; not surfaced in the UI. */
    installId: string
    /** Cohort marker: true for pre-existing profiles (gates the opt-in banner), false for fresh installs. */
    existedBeforeTelemetryRelease: boolean
  }
  /** One-shot cohort marker for the tab-switch keybinding swap. 'pending' =
   *  pre-existing install (seed pins old chords, then flips to 'done'); 'done' = fresh install. */
  tabSwitchKeybindingSeed?: 'pending' | 'done'
  /** Local voice/dictation config. Optional for pre-voice profiles; getDefaultSettings() hydrates defaults via the persistence merge. */
  voice?: VoiceSettings
}

