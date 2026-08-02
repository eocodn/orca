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
type ShellHydrationFailureReason = SharedTypeDefinitions.ShellHydrationFailureReason; type PathSource = SharedTypeDefinitions.PathSource; type RepoKind = SharedTypeDefinitions.RepoKind; type IssueSourcePreference = SharedTypeDefinitions.IssueSourcePreference; type ExternalWorktreeVisibility = SharedTypeDefinitions.ExternalWorktreeVisibility; type ProjectProviderIdentity = SharedTypeDefinitions.ProjectProviderIdentity; type Project = SharedTypeDefinitions.Project; type ProjectUpdateArgs = SharedTypeDefinitions.ProjectUpdateArgs; type ProjectHostSetupState = SharedTypeDefinitions.ProjectHostSetupState; type ProjectHostSetupMethod = SharedTypeDefinitions.ProjectHostSetupMethod; type RepoProjectHostSetupMethod = SharedTypeDefinitions.RepoProjectHostSetupMethod; type ProjectHostSetup = SharedTypeDefinitions.ProjectHostSetup; type ProjectHostSetupExistingFolderArgs = SharedTypeDefinitions.ProjectHostSetupExistingFolderArgs; type ProjectHostSetupCreateArgs = SharedTypeDefinitions.ProjectHostSetupCreateArgs; type ProjectHostSetupCloneArgs = SharedTypeDefinitions.ProjectHostSetupCloneArgs; type ProjectHostSetupUpdateArgs = SharedTypeDefinitions.ProjectHostSetupUpdateArgs; type ProjectHostSetupDeleteArgs = SharedTypeDefinitions.ProjectHostSetupDeleteArgs; type ProjectHostSetupResult = SharedTypeDefinitions.ProjectHostSetupResult; type ProjectHostSetupCreateResult = SharedTypeDefinitions.ProjectHostSetupCreateResult; type ProjectHostSetupUpdateResult = SharedTypeDefinitions.ProjectHostSetupUpdateResult; type ProjectHostSetupDeleteResult = SharedTypeDefinitions.ProjectHostSetupDeleteResult; type Repo = SharedTypeDefinitions.Repo; type ProjectGroupCreatedFrom = SharedTypeDefinitions.ProjectGroupCreatedFrom; type ProjectGroup = SharedTypeDefinitions.ProjectGroup; type WorkspaceScope = SharedTypeDefinitions.WorkspaceScope; type WorkspaceKey = SharedTypeDefinitions.WorkspaceKey; type FolderWorkspace = SharedTypeDefinitions.FolderWorkspace; type WorkspaceLinkedItem = SharedTypeDefinitions.WorkspaceLinkedItem; type FolderWorkspaceLinkedTask = SharedTypeDefinitions.FolderWorkspaceLinkedTask; type NestedRepoScanOptions = SharedTypeDefinitions.NestedRepoScanOptions; type NestedRepoCandidate = SharedTypeDefinitions.NestedRepoCandidate; type NestedRepoScanResult = SharedTypeDefinitions.NestedRepoScanResult; type ProjectGroupImportMode = SharedTypeDefinitions.ProjectGroupImportMode; type ProjectGroupImportProjectResult = SharedTypeDefinitions.ProjectGroupImportProjectResult; type ProjectGroupImportResult = SharedTypeDefinitions.ProjectGroupImportResult; type SetupRunPolicy = SharedTypeDefinitions.SetupRunPolicy; type SetupAgentStartupPolicy = SharedTypeDefinitions.SetupAgentStartupPolicy; type SetupDecision = SharedTypeDefinitions.SetupDecision; type HookCommandSourcePolicy = SharedTypeDefinitions.HookCommandSourcePolicy; type BaseRefDefaultResult = SharedTypeDefinitions.BaseRefDefaultResult; type BaseRefSearchResult = SharedTypeDefinitions.BaseRefSearchResult; type GitWorktreeInfo = SharedTypeDefinitions.GitWorktreeInfo; type WorktreeHeadIdentity = SharedTypeDefinitions.WorktreeHeadIdentity; type WorkspaceStatus = SharedTypeDefinitions.WorkspaceStatus; type WorkspaceStatusDefinition = SharedTypeDefinitions.WorkspaceStatusDefinition; type Worktree = SharedTypeDefinitions.Worktree; type CliWorkspaceProvenance = SharedTypeDefinitions.CliWorkspaceProvenance; type AutomationWorkspaceProvenance = SharedTypeDefinitions.AutomationWorkspaceProvenance; type AutomationWorkspaceProvenanceRequest = SharedTypeDefinitions.AutomationWorkspaceProvenanceRequest; type GitPushTarget = SharedTypeDefinitions.GitPushTarget; type GitHubPrStartPoint = SharedTypeDefinitions.GitHubPrStartPoint; type WorktreeMeta = SharedTypeDefinitions.WorktreeMeta; type WorktreeOwnership = SharedTypeDefinitions.WorktreeOwnership; type DetectedWorktreeListSource = SharedTypeDefinitions.DetectedWorktreeListSource; type DetectedWorktree = SharedTypeDefinitions.DetectedWorktree; type DetectedWorktreeListResult = SharedTypeDefinitions.DetectedWorktreeListResult; type WorktreeLineageOrigin = SharedTypeDefinitions.WorktreeLineageOrigin; type WorktreeLineageCaptureConfidence = SharedTypeDefinitions.WorktreeLineageCaptureConfidence; type WorktreeLineageCaptureSource = SharedTypeDefinitions.WorktreeLineageCaptureSource; type WorktreeLineageCapture = SharedTypeDefinitions.WorktreeLineageCapture; type WorktreeLineage = SharedTypeDefinitions.WorktreeLineage; type WorkspaceLineage = SharedTypeDefinitions.WorkspaceLineage; type WorktreeLineageWarningCode = SharedTypeDefinitions.WorktreeLineageWarningCode; type WorktreeLineageWarning = SharedTypeDefinitions.WorktreeLineageWarning; type DiffCommentSource = SharedTypeDefinitions.DiffCommentSource; type DiffReviewScope = SharedTypeDefinitions.DiffReviewScope; type MobileDiffReviewFileState = SharedTypeDefinitions.MobileDiffReviewFileState; type MobileDiffReviewState = SharedTypeDefinitions.MobileDiffReviewState; type DiffComment = SharedTypeDefinitions.DiffComment; type TabGroupSplitDirection = SharedTypeDefinitions.TabGroupSplitDirection; type TabGroupLayoutNode = SharedTypeDefinitions.TabGroupLayoutNode; type TabContentType = SharedTypeDefinitions.TabContentType; type WorkspaceVisibleTabType = SharedTypeDefinitions.WorkspaceVisibleTabType; type CtrlTabOrderMode = SharedTypeDefinitions.CtrlTabOrderMode; type Tab = SharedTypeDefinitions.Tab; type TabGroup = SharedTypeDefinitions.TabGroup; type TerminalTab = SharedTypeDefinitions.TerminalTab; type BrowserHistoryEntry = SharedTypeDefinitions.BrowserHistoryEntry; type BrowserLoadError = SharedTypeDefinitions.BrowserLoadError; type BrowserCertificateFailure = SharedTypeDefinitions.BrowserCertificateFailure; type BrowserCertificateProceedFailureReason = SharedTypeDefinitions.BrowserCertificateProceedFailureReason; type BrowserCertificateProceedResult = SharedTypeDefinitions.BrowserCertificateProceedResult; type BrowserViewportPresetId = SharedTypeDefinitions.BrowserViewportPresetId; type BrowserViewportOverride = SharedTypeDefinitions.BrowserViewportOverride; type BrowserPage = SharedTypeDefinitions.BrowserPage; type BrowserWorkspace = SharedTypeDefinitions.BrowserWorkspace; type BrowserTab = SharedTypeDefinitions.BrowserTab; type BrowserSessionProfileScope = SharedTypeDefinitions.BrowserSessionProfileScope; type BrowserSessionProfileSource = SharedTypeDefinitions.BrowserSessionProfileSource; type BrowserSessionProfile = SharedTypeDefinitions.BrowserSessionProfile; type BrowserCookieImportSummary = SharedTypeDefinitions.BrowserCookieImportSummary; type BrowserCookieImportResult = SharedTypeDefinitions.BrowserCookieImportResult; type TerminalPaneSplitDirection = SharedTypeDefinitions.TerminalPaneSplitDirection; type TerminalPaneLayoutNode = SharedTypeDefinitions.TerminalPaneLayoutNode; type TerminalLayoutSnapshot = SharedTypeDefinitions.TerminalLayoutSnapshot; type PersistedOpenFile = SharedTypeDefinitions.PersistedOpenFile; type WorkspaceSessionState = SharedTypeDefinitions.WorkspaceSessionState; type WorkspaceSessionPatch = SharedTypeDefinitions.WorkspaceSessionPatch; type PRState = SharedTypeDefinitions.PRState; type IssueState = SharedTypeDefinitions.IssueState; type CheckStatus = SharedTypeDefinitions.CheckStatus; type PRMergeableState = SharedTypeDefinitions.PRMergeableState; type PRReviewDecision = SharedTypeDefinitions.PRReviewDecision; type PRConflictSummary = SharedTypeDefinitions.PRConflictSummary; type GitHubRepositoryIdentity = SharedTypeDefinitions.GitHubRepositoryIdentity; type GitHubPRMergeMethod = SharedTypeDefinitions.GitHubPRMergeMethod; type GitHubPRMergeMethodSettings = SharedTypeDefinitions.GitHubPRMergeMethodSettings; type PRInfo = SharedTypeDefinitions.PRInfo; type PRRefreshErrorType = SharedTypeDefinitions.PRRefreshErrorType; type PRRefreshUpstreamErrorType = SharedTypeDefinitions.PRRefreshUpstreamErrorType; type PRRefreshOutcome = SharedTypeDefinitions.PRRefreshOutcome; type GitHubPRRefreshReason = SharedTypeDefinitions.GitHubPRRefreshReason; type GitHubPRRefreshEnqueueResult = SharedTypeDefinitions.GitHubPRRefreshEnqueueResult; type GitHubPRRefreshAlias = SharedTypeDefinitions.GitHubPRRefreshAlias; type GitHubPRRefreshCandidate = SharedTypeDefinitions.GitHubPRRefreshCandidate; type GitHubPRRefreshSkippedReason = SharedTypeDefinitions.GitHubPRRefreshSkippedReason; type GitHubPRRefreshEvent = SharedTypeDefinitions.GitHubPRRefreshEvent; type PRCheckDetail = SharedTypeDefinitions.PRCheckDetail; type PRCheckAnnotation = SharedTypeDefinitions.PRCheckAnnotation; type PRCheckStep = SharedTypeDefinitions.PRCheckStep; type PRCheckJob = SharedTypeDefinitions.PRCheckJob; type PRCheckRunDetails = SharedTypeDefinitions.PRCheckRunDetails; type GitHubRerunPRChecksResult = SharedTypeDefinitions.GitHubRerunPRChecksResult; type GitHubReactionContent = SharedTypeDefinitions.GitHubReactionContent; type GitHubReaction = SharedTypeDefinitions.GitHubReaction; type PRComment = SharedTypeDefinitions.PRComment; type GitHubIssueTimelineTarget = SharedTypeDefinitions.GitHubIssueTimelineTarget; type GitHubIssueTimelineItem = SharedTypeDefinitions.GitHubIssueTimelineItem; type GitHubCommentResult = SharedTypeDefinitions.GitHubCommentResult; type IssueInfo = SharedTypeDefinitions.IssueInfo; type GitHubViewer = SharedTypeDefinitions.GitHubViewer; type GitHubAssignableUser = SharedTypeDefinitions.GitHubAssignableUser; type ProviderCheckSummary = SharedTypeDefinitions.ProviderCheckSummary; type GitHubPRReviewSummary = SharedTypeDefinitions.GitHubPRReviewSummary; type GitHubPRFileViewedState = SharedTypeDefinitions.GitHubPRFileViewedState; type GitHubWorkItem = SharedTypeDefinitions.GitHubWorkItem; type GitHubPRFile = SharedTypeDefinitions.GitHubPRFile; type GitHubPRFileContents = SharedTypeDefinitions.GitHubPRFileContents; type GitHubPRReviewCommentInput = SharedTypeDefinitions.GitHubPRReviewCommentInput; type GitHubWorkItemDetails = SharedTypeDefinitions.GitHubWorkItemDetails; type OrcaHooks = SharedTypeDefinitions.OrcaHooks; type OrcaWorktreeDefaults = SharedTypeDefinitions.OrcaWorktreeDefaults; type OrcaDefaultTabTemplate = SharedTypeDefinitions.OrcaDefaultTabTemplate; type OrcaVmRecipe = SharedTypeDefinitions.OrcaVmRecipe; type OrcaVmRecipeDiagnostic = SharedTypeDefinitions.OrcaVmRecipeDiagnostic; type RepoHookSettings = SharedTypeDefinitions.RepoHookSettings; type WorktreeSetupLaunch = SharedTypeDefinitions.WorktreeSetupLaunch; type WorktreeStartupLaunch = SharedTypeDefinitions.WorktreeStartupLaunch; type WorktreeDefaultTabsLaunch = SharedTypeDefinitions.WorktreeDefaultTabsLaunch; type WorktreeCreateTimingPhase = SharedTypeDefinitions.WorktreeCreateTimingPhase; type WorktreeCreateTiming = SharedTypeDefinitions.WorktreeCreateTiming; type CreateSparseCheckoutRequest = SharedTypeDefinitions.CreateSparseCheckoutRequest; type SparsePreset = SharedTypeDefinitions.SparsePreset; type CreateWorktreeArgs = SharedTypeDefinitions.CreateWorktreeArgs; type CreateWorktreeResult = SharedTypeDefinitions.CreateWorktreeResult; type WorktreeCreateBaseFallback = SharedTypeDefinitions.WorktreeCreateBaseFallback; type PreservedWorktreeBranch = SharedTypeDefinitions.PreservedWorktreeBranch; type RemoveWorktreeResult = SharedTypeDefinitions.RemoveWorktreeResult; type ForceDeleteWorktreeBranchResult = SharedTypeDefinitions.ForceDeleteWorktreeBranchResult; type LocalBaseRefRefreshResult = SharedTypeDefinitions.LocalBaseRefRefreshResult; type LocalBaseRefUpdateSuggestion = SharedTypeDefinitions.LocalBaseRefUpdateSuggestion; type WorktreeBaseStatusKind = SharedTypeDefinitions.WorktreeBaseStatusKind; type WorktreeBaseStatusEvent = SharedTypeDefinitions.WorktreeBaseStatusEvent; type WorktreeRemoteBranchConflictEvent = SharedTypeDefinitions.WorktreeRemoteBranchConflictEvent; type ChangelogRelease = SharedTypeDefinitions.ChangelogRelease; type ChangelogData = SharedTypeDefinitions.ChangelogData; type UpdateCheckOptions = SharedTypeDefinitions.UpdateCheckOptions; type UpdateSource = SharedTypeDefinitions.UpdateSource; type UpdateStatus = SharedTypeDefinitions.UpdateStatus; type ReleaseBuildListResult = SharedTypeDefinitions.ReleaseBuildListResult; type NotificationSettings = SharedTypeDefinitions.NotificationSettings; type CodexManagedAccount = SharedTypeDefinitions.CodexManagedAccount; type CodexManagedAccountSummary = SharedTypeDefinitions.CodexManagedAccountSummary; type CodexSystemDefaultIdentity = SharedTypeDefinitions.CodexSystemDefaultIdentity; type CodexRateLimitAccountsState = SharedTypeDefinitions.CodexRateLimitAccountsState; type CodexManagedAccountRuntimeSelection = SharedTypeDefinitions.CodexManagedAccountRuntimeSelection; type ClaudeManagedAccount = SharedTypeDefinitions.ClaudeManagedAccount; type ClaudeManagedAccountSummary = SharedTypeDefinitions.ClaudeManagedAccountSummary; type ClaudeRateLimitAccountsState = SharedTypeDefinitions.ClaudeRateLimitAccountsState; type ClaudeManagedAccountRuntimeSelection = SharedTypeDefinitions.ClaudeManagedAccountRuntimeSelection; type TuiAgent = SharedTypeDefinitions.TuiAgent; type TaskViewPresetId = SharedTypeDefinitions.TaskViewPresetId; type SetupScriptLaunchMode = SharedTypeDefinitions.SetupScriptLaunchMode; type SetupSplitDirection = SharedTypeDefinitions.SetupSplitDirection; type TerminalColorOverrides = SharedTypeDefinitions.TerminalColorOverrides; type TerminalQuickCommandScope = SharedTypeDefinitions.TerminalQuickCommandScope; type TerminalQuickCommandAction = SharedTypeDefinitions.TerminalQuickCommandAction; type TerminalQuickCommandBase = SharedTypeDefinitions.TerminalQuickCommandBase; type TerminalCommandQuickCommand = SharedTypeDefinitions.TerminalCommandQuickCommand; type TerminalAgentQuickCommand = SharedTypeDefinitions.TerminalAgentQuickCommand; type TerminalQuickCommand = SharedTypeDefinitions.TerminalQuickCommand; type OpenInApplication = SharedTypeDefinitions.OpenInApplication; type SourceControlViewMode = SharedTypeDefinitions.SourceControlViewMode; type SourceControlGroupOrder = SharedTypeDefinitions.SourceControlGroupOrder; type LeftSidebarAppearanceMode = SharedTypeDefinitions.LeftSidebarAppearanceMode; type BranchPrefixStrategy = SharedTypeDefinitions.BranchPrefixStrategy; type FloatingTerminalCwdRequest = SharedTypeDefinitions.FloatingTerminalCwdRequest; type HostSettingOverrides = SharedTypeDefinitions.HostSettingOverrides; type AgentDashboardMode = SharedTypeDefinitions.AgentDashboardMode; type GlobalSettings = SharedTypeDefinitions.GlobalSettings; type OrcaWorkspaceLayout = SharedTypeDefinitions.OrcaWorkspaceLayout; type CommitMessageAiModelCapability = SharedTypeDefinitions.CommitMessageAiModelCapability; type CommitMessageAiSettings = SharedTypeDefinitions.CommitMessageAiSettings; type GhosttyImportPreview = SharedTypeDefinitions.GhosttyImportPreview; type DiscoveryStatusEmitted = SharedTypeDefinitions.DiscoveryStatusEmitted; type NotificationEventSource = SharedTypeDefinitions.NotificationEventSource; type NotificationDispatchRequest = SharedTypeDefinitions.NotificationDispatchRequest; type NotificationDispatchResult = SharedTypeDefinitions.NotificationDispatchResult; type NotificationDismissResult = SharedTypeDefinitions.NotificationDismissResult; type NotificationSoundResult = SharedTypeDefinitions.NotificationSoundResult; type NotificationSoundDataResult = SharedTypeDefinitions.NotificationSoundDataResult; type NotificationSoundPathResult = SharedTypeDefinitions.NotificationSoundPathResult; type OnboardingOutcome = SharedTypeDefinitions.OnboardingOutcome; type OnboardingChecklistState = SharedTypeDefinitions.OnboardingChecklistState; type OnboardingState = SharedTypeDefinitions.OnboardingState; type NotificationPermissionStatusResult = SharedTypeDefinitions.NotificationPermissionStatusResult; type NotificationDeliveryProbeResult = SharedTypeDefinitions.NotificationDeliveryProbeResult; type WorktreeCardProperty = SharedTypeDefinitions.WorktreeCardProperty; type WorktreeCardMode = SharedTypeDefinitions.WorktreeCardMode; type AgentActivityDisplayMode = SharedTypeDefinitions.AgentActivityDisplayMode; type StatusBarItem = SharedTypeDefinitions.StatusBarItem; type FloatingTerminalTriggerLocation = SharedTypeDefinitions.FloatingTerminalTriggerLocation; type TaskResumeState = SharedTypeDefinitions.TaskResumeState; type RightSidebarTab = SharedTypeDefinitions.RightSidebarTab; type ActiveRightSidebarTab = SharedTypeDefinitions.ActiveRightSidebarTab; type RightSidebarExplorerView = SharedTypeDefinitions.RightSidebarExplorerView; type ProjectOrderBy = SharedTypeDefinitions.ProjectOrderBy; type WorkspaceHostScope = SharedTypeDefinitions.WorkspaceHostScope; type VisibleWorkspaceHostIds = SharedTypeDefinitions.VisibleWorkspaceHostIds; type WorkspaceHostOrder = SharedTypeDefinitions.WorkspaceHostOrder; type ManualRepoOrderEntry = SharedTypeDefinitions.ManualRepoOrderEntry; type TopLevelView = SharedTypeDefinitions.TopLevelView; type PersistedUIState = SharedTypeDefinitions.PersistedUIState; type CustomPet = SharedTypeDefinitions.CustomPet; type SpriteAnimation = SharedTypeDefinitions.SpriteAnimation; type PersistedTrustedOrcaHookEntry = SharedTypeDefinitions.PersistedTrustedOrcaHookEntry; type PersistedTrustedOrcaHookRepo = SharedTypeDefinitions.PersistedTrustedOrcaHookRepo; type PersistedTrustedOrcaHooks = SharedTypeDefinitions.PersistedTrustedOrcaHooks; type LegacyPaneKeyAliasEntry = SharedTypeDefinitions.LegacyPaneKeyAliasEntry; type PersistedMobileClientTabSelection = SharedTypeDefinitions.PersistedMobileClientTabSelection; type PersistedMobileClientTabSelections = SharedTypeDefinitions.PersistedMobileClientTabSelections; type PersistedState = SharedTypeDefinitions.PersistedState; type FilesystemPathFlavor = SharedTypeDefinitions.FilesystemPathFlavor; type DirEntry = SharedTypeDefinitions.DirEntry; type MarkdownDocument = SharedTypeDefinitions.MarkdownDocument; type FsChangeEvent = SharedTypeDefinitions.FsChangeEvent; type FsChangedPayload = SharedTypeDefinitions.FsChangedPayload; type GitBranchChangeEntry = SharedTypeDefinitions.GitBranchChangeEntry; type GitBranchCompareSummary = SharedTypeDefinitions.GitBranchCompareSummary; type GitBranchCompareResult = SharedTypeDefinitions.GitBranchCompareResult; type GitCommitCompareSummary = SharedTypeDefinitions.GitCommitCompareSummary; type GitCommitCompareResult = SharedTypeDefinitions.GitCommitCompareResult; type GitDiffTextResult = SharedTypeDefinitions.GitDiffTextResult; type GitDiffBinaryResult = SharedTypeDefinitions.GitDiffBinaryResult; type GitDiffResult = SharedTypeDefinitions.GitDiffResult; type SearchMatch = SharedTypeDefinitions.SearchMatch; type SearchFileResult = SharedTypeDefinitions.SearchFileResult; type SearchResult = SharedTypeDefinitions.SearchResult; type SearchOptions = SharedTypeDefinitions.SearchOptions; type StatsSummary = SharedTypeDefinitions.StatsSummary; type UsageValues = SharedTypeDefinitions.UsageValues; type ProcessMemoryMetric = SharedTypeDefinitions.ProcessMemoryMetric; type HostAvailableMemorySource = SharedTypeDefinitions.HostAvailableMemorySource; type AppMemory = SharedTypeDefinitions.AppMemory; type SessionMemory = SharedTypeDefinitions.SessionMemory; type WorktreeMemory = SharedTypeDefinitions.WorktreeMemory; type HostMemory = SharedTypeDefinitions.HostMemory; type MemorySnapshot = SharedTypeDefinitions.MemorySnapshot;

// ─── Linear ─────────────────────────────────────────────────────────
export type LinearViewer = {
  displayName: string
  email: string | null
  organizationId?: string
  organizationName: string
  organizationUrlKey?: string
}

export type LinearWorkspace = LinearViewer & {
  id: string
  organizationId: string
  isLegacy?: true
  credentialRevision?: number
}

export type LinearWorkspaceSelection = string | 'all'
export type LinearWorkspaceSelector = LinearWorkspaceSelection | undefined
export type LinearConcreteWorkspaceId = string

export type LinearWorkspaceError = {
  workspaceId: string
  workspaceName?: string
  type: 'auth' | 'rate_limited' | 'network' | 'unknown'
  message: string
}

export type LinearCollectionResult<T> = {
  items: T[]
  errors?: LinearWorkspaceError[]
  hasMore?: boolean
}

export type LinearConnectionStatus = {
  connected: boolean
  viewer: LinearViewer | null
  workspaces?: LinearWorkspace[]
  activeWorkspaceId?: string | null
  selectedWorkspaceId?: LinearWorkspaceSelection | null
  // Set when a stored token file exists but could not be decrypted, so the
  // UI can explain reads failing while the connection still looks saved.
  credentialError?: string
}

export type LinearIssue = {
  id: string
  workspaceId?: string
  workspaceName?: string
  identifier: string
  title: string
  branchName?: string
  description?: string
  url: string
  state: {
    name: string
    type: string
    color: string
  }
  team: {
    id: string
    name: string
    key: string
  }
  project?: LinearProjectSummary
  subIssues?: LinearIssueChildSummary[]
  labels: string[]
  labelIds: string[]
  assignee?: {
    id: string
    displayName: string
    avatarUrl?: string
  }
  estimate?: number | null
  priority: number
  dueDate?: string | null
  updatedAt: string
}

export type LinearProjectSummary = {
  id: string
  slugId?: string
  workspaceId?: string
  workspaceName?: string
  name: string
  url?: string
  color?: string
  icon?: string
  description?: string
  content?: string
  status?: LinearProjectStatusSummary
  health?: string | null
  priority?: number | null
  priorityLabel?: string | null
  lead?: LinearProjectMemberSummary
  members?: LinearProjectMemberSummary[]
  teams?: {
    id: string
    name: string
    key?: string
  }[]
  labels?: {
    id: string
    name: string
    color?: string
  }[]
  startDate?: string | null
  targetDate?: string | null
  createdAt?: string
  updatedAt?: string
  completedAt?: string | null
  canceledAt?: string | null
  startedAt?: string | null
  progress?: number | null
  scope?: number | null
  issueCount?: number
  completedIssueCount?: number
}

export type LinearProjectStatusSummary = {
  id: string
  name: string
  type?: string
  color?: string
}

export type LinearProjectMemberSummary = {
  id: string
  displayName: string
  avatarUrl?: string
}

export type LinearProjectMilestoneSummary = {
  id: string
  name: string
  status?: string
  targetDate?: string | null
  progress?: number | null
}

export type LinearProjectResourceSummary = {
  id: string
  title: string
  url: string
  type?: string
}

export type LinearProjectUpdateSummary = {
  id: string
  body?: string
  health?: string | null
  url?: string
  createdAt?: string
  updatedAt?: string
  user?: LinearProjectMemberSummary
}

export type LinearProjectDetail = LinearProjectSummary & {
  milestones?: LinearProjectMilestoneSummary[]
  resources?: LinearProjectResourceSummary[]
  latestUpdate?: LinearProjectUpdateSummary
}

export type LinearCustomViewModel = 'issue' | 'project'

export type LinearCustomViewSummary = {
  id: string
  workspaceId?: string
  workspaceName?: string
  name: string
  description?: string
  model: LinearCustomViewModel
  url?: string
  color?: string
  icon?: string
  shared?: boolean
  team?: {
    id: string
    name?: string
    key?: string
  }
  owner?: LinearProjectMemberSummary
  creator?: LinearProjectMemberSummary
  createdAt?: string
  updatedAt?: string
}

export type LinearIssueChildSummary = {
  id: string
  identifier: string
  title: string
  url: string
}

export type LinearComment = {
  id: string
  body: string
  createdAt: string
  user?: {
    displayName: string
    avatarUrl?: string
  }
}

// ─── Issue Mutations ────────────────────────────────────────────────

export type GitHubCreateIssueFields = {
  labels?: string[]
  assignees?: string[]
}

export type GitHubCreateIssueResult =
  | { ok: true; number: number; url: string; bodySaveWarning?: string }
  | { ok: false; error: string }

export type GitHubIssueCloseReason = 'completed' | 'not_planned' | 'duplicate'

export type GitHubIssueUpdate = {
  state?: 'open' | 'closed'
  stateReason?: GitHubIssueCloseReason
  duplicateOf?: number
  title?: string
  // Why: body writes use the REST issue endpoint instead of `gh issue edit`
  // because that command does not consistently cover every body-edit case the
  // dialog needs.
  body?: string
  addLabels?: string[]
  removeLabels?: string[]
  addAssignees?: string[]
  removeAssignees?: string[]
}

export type GitHubPullRequestStateUpdate = {
  state: 'open' | 'closed'
}

export type LinearIssueUpdate = {
  stateId?: string
  title?: string
  description?: string
  assigneeId?: string | null
  estimate?: number | null
  priority?: number
  dueDate?: string | null
  labelIds?: string[]
  projectId?: string | null
  parentId?: string | null
}

export type ClassifiedError = {
  type:
    | 'permission_denied'
    | 'not_found'
    | 'issues_disabled'
    | 'validation_error'
    | 'rate_limited'
    | 'network_error'
    | 'unknown'
  message: string
}

// Why: declared here as a shared shape so IPC return envelopes and renderer
// slices can reference the same structural type without importing from main.
// Aliased as `OwnerRepo` in `src/main/github/gh-utils.ts` so main call sites
// can continue using the short local name.
export type GitHubOwnerRepo = GitHubRepositoryIdentity

// Why: GitLab-specific types live in `./gitlab-types` so they can grow
// independently from the central types file (which is touched by every
// upstream feature). Re-exported here so existing call sites
// (`from '../shared/types'`) keep working without changes.
export type {
  GitLabAssignableUser,
  GitLabAuthDiagnostic,
  GitLabCommentResult,
  GitLabDiscussionResolveResult,
  GitLabIssueInfo,
  GitLabIssueState,
  GitLabIssueUpdate,
  GitLabJobTraceResult,
  GitLabRateLimitBucket,
  GitLabRateLimitSnapshot,
  GitLabMRApprovalRule,
  GitLabMRApprovalState,
  GitLabMRFile,
  GitLabMRInlineCommentInput,
  GitLabMRReviewersUpdateResult,
  GitLabMRUpdate,
  GitLabPagedResult,
  GitLabPipelineJob,
  GitLabProjectRef,
  GitLabProjectSettings,
  GitLabRetryJobResult,
  GitLabReaction,
  GitLabTodo,
  GitLabTodoTargetType,
  GitLabViewer,
  GitLabWorkItem,
  GitLabWorkItemDetails,
  GetGitLabRateLimitResult,
  ListMergeRequestsResult,
  MRCheckDetail,
  MRComment,
  MRInfo,
  MRListState,
  MRMergeableState,
  MRState
} from './gitlab-types'

export type {
  JiraAuthType,
  JiraComment,
  JiraConnectArgs,
  JiraConnectionStatus,
  JiraCreateField,
  JiraCreateFieldAllowedValue,
  JiraCreateIssueArgs,
  JiraCreateIssueResult,
  JiraIssue,
  JiraIssueFilter,
  JiraIssueType,
  JiraIssueUpdate,
  JiraMutationResult,
  JiraPriority,
  JiraProject,
  JiraProjectStatusOrder,
  JiraSite,
  JiraSiteSelection,
  JiraStatus,
  JiraTransition,
  JiraUser,
  JiraViewer
} from './jira-types'

/**
 * GitHub API rate-limit buckets surfaced in the TaskPage header so users can
 * see remaining budget before they hit the wall. `core` = REST (5000/hr),
 * `search` = Search API (30/min — hit by countWorkItems), `graphql` =
 * GraphQL (5000 points/hr — hit by project-view + discovery). All three are
 * the buckets this app actually stresses; other buckets (e.g. code_search)
 * are not surfaced because we don't touch them.
 */
export type GitHubRateLimitBucket = {
  remaining: number
  limit: number
  /** Unix epoch seconds when the window resets. */
  resetAt: number
}

export type GitHubRateLimitSnapshot = {
  core: GitHubRateLimitBucket
  search: GitHubRateLimitBucket
  graphql: GitHubRateLimitBucket
  /** Unix epoch ms the snapshot was produced (for "fetched Xs ago" copy). */
  fetchedAt: number
}

export type GetRateLimitResult =
  | { ok: true; snapshot: GitHubRateLimitSnapshot }
  | { ok: false; error: string }

/**
 * Envelope for `gh:listWorkItems`. Carries resolved issue/PR sources so the
 * renderer can render the "Issues from owner/repo" indicator without an
 * extra IPC round-trip, and per-source classified errors so the UI can show
 * a retryable banner when (e.g.) a private upstream 403s.
 *
 * Why piggyback instead of adding `gh:resolveWorkItemSources`: the renderer
 * already round-trips this endpoint on every Tasks refresh, and the source
 * data is a 2-field-per-side metadata add — cheaper than another IPC call.
 *
 * Invariant: `items` always contains whatever succeeded; `errors.issues` indicates
 * the issues-side fetch failed, but any PR-side items that succeeded are still
 * present in `items`. Consumers should render `items` alongside the error banner.
 */
export type ListWorkItemsResult<T> = {
  items: T[]
  sources: {
    issues: GitHubOwnerRepo | null
    prs: GitHubOwnerRepo | null
    /** Raw `origin` remote resolved for this repo, independent of the
     *  user's preference. Required-nullable so the renderer can compare raw
     *  remote candidates without inferring origin from the effective PR
     *  source. */
    originCandidate: GitHubOwnerRepo | null
    /** Raw `upstream` remote resolved for this repo, independent of the
     *  user's preference. Present so the renderer's issue-source selector
     *  can always decide whether to render (upstream exists & differs from
     *  origin) and show both slugs in its tooltips, even when the user has
     *  picked 'origin' and `sources.issues` has collapsed onto origin. */
    upstreamCandidate: GitHubOwnerRepo | null
  }
  errors?: {
    issues?: ClassifiedError
  }
  /** True when the user's per-repo preference was `'upstream'` but no upstream
   *  remote is configured, so the resolver fell back to origin. Renderer uses
   *  this to surface a one-time-per-session toast. Omitted when absent so
   *  existing consumers and test fixtures don't care about it.
   *  Typed as `?: true` (not `?: boolean`) to encode the invariant "present
   *  iff fell-back" — an explicit `false` write would be a bug, so make it a
   *  compile error. */
  issueSourceFellBack?: true
}

export type LinearWorkflowState = {
  id: string
  name: string
  type: string
  color: string
  position: number
}

export type LinearLabel = {
  id: string
  name: string
  color: string
}

export type LinearMember = {
  id: string
  displayName: string
  name?: string
  email?: string
  avatarUrl?: string
}

export type LinearTeam = {
  id: string
  workspaceId?: string
  workspaceName?: string
  name: string
  key: string
  url?: string
}

