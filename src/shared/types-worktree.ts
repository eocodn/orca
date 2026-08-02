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
export type ShellHydrationFailureReason = SharedTypeDefinitions.ShellHydrationFailureReason; export type PathSource = SharedTypeDefinitions.PathSource; export type RepoKind = SharedTypeDefinitions.RepoKind; export type IssueSourcePreference = SharedTypeDefinitions.IssueSourcePreference; export type ExternalWorktreeVisibility = SharedTypeDefinitions.ExternalWorktreeVisibility; export type ProjectProviderIdentity = SharedTypeDefinitions.ProjectProviderIdentity; export type Project = SharedTypeDefinitions.Project; export type ProjectUpdateArgs = SharedTypeDefinitions.ProjectUpdateArgs; export type ProjectHostSetupState = SharedTypeDefinitions.ProjectHostSetupState; export type ProjectHostSetupMethod = SharedTypeDefinitions.ProjectHostSetupMethod; export type RepoProjectHostSetupMethod = SharedTypeDefinitions.RepoProjectHostSetupMethod; export type ProjectHostSetup = SharedTypeDefinitions.ProjectHostSetup; export type ProjectHostSetupExistingFolderArgs = SharedTypeDefinitions.ProjectHostSetupExistingFolderArgs; export type ProjectHostSetupCreateArgs = SharedTypeDefinitions.ProjectHostSetupCreateArgs; export type ProjectHostSetupCloneArgs = SharedTypeDefinitions.ProjectHostSetupCloneArgs; export type ProjectHostSetupUpdateArgs = SharedTypeDefinitions.ProjectHostSetupUpdateArgs; export type ProjectHostSetupDeleteArgs = SharedTypeDefinitions.ProjectHostSetupDeleteArgs; export type ProjectHostSetupResult = SharedTypeDefinitions.ProjectHostSetupResult; export type ProjectHostSetupCreateResult = SharedTypeDefinitions.ProjectHostSetupCreateResult; export type ProjectHostSetupUpdateResult = SharedTypeDefinitions.ProjectHostSetupUpdateResult; export type ProjectHostSetupDeleteResult = SharedTypeDefinitions.ProjectHostSetupDeleteResult; export type Repo = SharedTypeDefinitions.Repo; export type ProjectGroupCreatedFrom = SharedTypeDefinitions.ProjectGroupCreatedFrom; export type ProjectGroup = SharedTypeDefinitions.ProjectGroup; export type WorkspaceScope = SharedTypeDefinitions.WorkspaceScope; export type WorkspaceKey = SharedTypeDefinitions.WorkspaceKey; export type FolderWorkspace = SharedTypeDefinitions.FolderWorkspace; export type WorkspaceLinkedItem = SharedTypeDefinitions.WorkspaceLinkedItem; export type FolderWorkspaceLinkedTask = SharedTypeDefinitions.FolderWorkspaceLinkedTask; export type NestedRepoScanOptions = SharedTypeDefinitions.NestedRepoScanOptions; export type NestedRepoCandidate = SharedTypeDefinitions.NestedRepoCandidate; export type NestedRepoScanResult = SharedTypeDefinitions.NestedRepoScanResult; export type ProjectGroupImportMode = SharedTypeDefinitions.ProjectGroupImportMode; export type ProjectGroupImportProjectResult = SharedTypeDefinitions.ProjectGroupImportProjectResult; export type ProjectGroupImportResult = SharedTypeDefinitions.ProjectGroupImportResult; export type SetupRunPolicy = SharedTypeDefinitions.SetupRunPolicy; export type SetupAgentStartupPolicy = SharedTypeDefinitions.SetupAgentStartupPolicy; export type SetupDecision = SharedTypeDefinitions.SetupDecision; export type HookCommandSourcePolicy = SharedTypeDefinitions.HookCommandSourcePolicy; export type BaseRefDefaultResult = SharedTypeDefinitions.BaseRefDefaultResult; export type BaseRefSearchResult = SharedTypeDefinitions.BaseRefSearchResult; export type TabGroupSplitDirection = SharedTypeDefinitions.TabGroupSplitDirection; export type TabGroupLayoutNode = SharedTypeDefinitions.TabGroupLayoutNode; export type TabContentType = SharedTypeDefinitions.TabContentType; export type WorkspaceVisibleTabType = SharedTypeDefinitions.WorkspaceVisibleTabType; export type CtrlTabOrderMode = SharedTypeDefinitions.CtrlTabOrderMode; export type Tab = SharedTypeDefinitions.Tab; export type TabGroup = SharedTypeDefinitions.TabGroup; export type TerminalTab = SharedTypeDefinitions.TerminalTab; export type BrowserHistoryEntry = SharedTypeDefinitions.BrowserHistoryEntry; export type BrowserLoadError = SharedTypeDefinitions.BrowserLoadError; export type BrowserCertificateFailure = SharedTypeDefinitions.BrowserCertificateFailure; export type BrowserCertificateProceedFailureReason = SharedTypeDefinitions.BrowserCertificateProceedFailureReason; export type BrowserCertificateProceedResult = SharedTypeDefinitions.BrowserCertificateProceedResult; export type BrowserViewportPresetId = SharedTypeDefinitions.BrowserViewportPresetId; export type BrowserViewportOverride = SharedTypeDefinitions.BrowserViewportOverride; export type BrowserPage = SharedTypeDefinitions.BrowserPage; export type BrowserWorkspace = SharedTypeDefinitions.BrowserWorkspace; export type BrowserTab = SharedTypeDefinitions.BrowserTab; export type BrowserSessionProfileScope = SharedTypeDefinitions.BrowserSessionProfileScope; export type BrowserSessionProfileSource = SharedTypeDefinitions.BrowserSessionProfileSource; export type BrowserSessionProfile = SharedTypeDefinitions.BrowserSessionProfile; export type BrowserCookieImportSummary = SharedTypeDefinitions.BrowserCookieImportSummary; export type BrowserCookieImportResult = SharedTypeDefinitions.BrowserCookieImportResult; export type TerminalPaneSplitDirection = SharedTypeDefinitions.TerminalPaneSplitDirection; export type TerminalPaneLayoutNode = SharedTypeDefinitions.TerminalPaneLayoutNode; export type TerminalLayoutSnapshot = SharedTypeDefinitions.TerminalLayoutSnapshot; export type PersistedOpenFile = SharedTypeDefinitions.PersistedOpenFile; export type WorkspaceSessionState = SharedTypeDefinitions.WorkspaceSessionState; export type WorkspaceSessionPatch = SharedTypeDefinitions.WorkspaceSessionPatch; export type PRState = SharedTypeDefinitions.PRState; export type IssueState = SharedTypeDefinitions.IssueState; export type CheckStatus = SharedTypeDefinitions.CheckStatus; export type PRMergeableState = SharedTypeDefinitions.PRMergeableState; export type PRReviewDecision = SharedTypeDefinitions.PRReviewDecision; export type PRConflictSummary = SharedTypeDefinitions.PRConflictSummary; export type GitHubRepositoryIdentity = SharedTypeDefinitions.GitHubRepositoryIdentity; export type GitHubPRMergeMethod = SharedTypeDefinitions.GitHubPRMergeMethod; export type GitHubPRMergeMethodSettings = SharedTypeDefinitions.GitHubPRMergeMethodSettings; export type PRInfo = SharedTypeDefinitions.PRInfo; export type PRRefreshErrorType = SharedTypeDefinitions.PRRefreshErrorType; export type PRRefreshUpstreamErrorType = SharedTypeDefinitions.PRRefreshUpstreamErrorType; export type PRRefreshOutcome = SharedTypeDefinitions.PRRefreshOutcome; export type GitHubPRRefreshReason = SharedTypeDefinitions.GitHubPRRefreshReason; export type GitHubPRRefreshEnqueueResult = SharedTypeDefinitions.GitHubPRRefreshEnqueueResult; export type GitHubPRRefreshAlias = SharedTypeDefinitions.GitHubPRRefreshAlias; export type GitHubPRRefreshCandidate = SharedTypeDefinitions.GitHubPRRefreshCandidate; export type GitHubPRRefreshSkippedReason = SharedTypeDefinitions.GitHubPRRefreshSkippedReason; export type GitHubPRRefreshEvent = SharedTypeDefinitions.GitHubPRRefreshEvent; export type PRCheckDetail = SharedTypeDefinitions.PRCheckDetail; export type PRCheckAnnotation = SharedTypeDefinitions.PRCheckAnnotation; export type PRCheckStep = SharedTypeDefinitions.PRCheckStep; export type PRCheckJob = SharedTypeDefinitions.PRCheckJob; export type PRCheckRunDetails = SharedTypeDefinitions.PRCheckRunDetails; export type GitHubRerunPRChecksResult = SharedTypeDefinitions.GitHubRerunPRChecksResult; export type GitHubReactionContent = SharedTypeDefinitions.GitHubReactionContent; export type GitHubReaction = SharedTypeDefinitions.GitHubReaction; export type PRComment = SharedTypeDefinitions.PRComment; export type GitHubIssueTimelineTarget = SharedTypeDefinitions.GitHubIssueTimelineTarget; export type GitHubIssueTimelineItem = SharedTypeDefinitions.GitHubIssueTimelineItem; export type GitHubCommentResult = SharedTypeDefinitions.GitHubCommentResult; export type IssueInfo = SharedTypeDefinitions.IssueInfo; export type GitHubViewer = SharedTypeDefinitions.GitHubViewer; export type GitHubAssignableUser = SharedTypeDefinitions.GitHubAssignableUser; export type ProviderCheckSummary = SharedTypeDefinitions.ProviderCheckSummary; export type GitHubPRReviewSummary = SharedTypeDefinitions.GitHubPRReviewSummary; export type GitHubPRFileViewedState = SharedTypeDefinitions.GitHubPRFileViewedState; export type GitHubWorkItem = SharedTypeDefinitions.GitHubWorkItem; export type GitHubPRFile = SharedTypeDefinitions.GitHubPRFile; export type GitHubPRFileContents = SharedTypeDefinitions.GitHubPRFileContents; export type GitHubPRReviewCommentInput = SharedTypeDefinitions.GitHubPRReviewCommentInput; export type GitHubWorkItemDetails = SharedTypeDefinitions.GitHubWorkItemDetails; export type LinearViewer = SharedTypeDefinitions.LinearViewer; export type LinearWorkspace = SharedTypeDefinitions.LinearWorkspace; export type LinearWorkspaceSelection = SharedTypeDefinitions.LinearWorkspaceSelection; export type LinearWorkspaceSelector = SharedTypeDefinitions.LinearWorkspaceSelector; export type LinearConcreteWorkspaceId = SharedTypeDefinitions.LinearConcreteWorkspaceId; export type LinearWorkspaceError = SharedTypeDefinitions.LinearWorkspaceError; export type LinearCollectionResult = SharedTypeDefinitions.LinearCollectionResult; export type LinearConnectionStatus = SharedTypeDefinitions.LinearConnectionStatus; export type LinearIssue = SharedTypeDefinitions.LinearIssue; export type LinearProjectSummary = SharedTypeDefinitions.LinearProjectSummary; export type LinearProjectStatusSummary = SharedTypeDefinitions.LinearProjectStatusSummary; export type LinearProjectMemberSummary = SharedTypeDefinitions.LinearProjectMemberSummary; export type LinearProjectMilestoneSummary = SharedTypeDefinitions.LinearProjectMilestoneSummary; export type LinearProjectResourceSummary = SharedTypeDefinitions.LinearProjectResourceSummary; export type LinearProjectUpdateSummary = SharedTypeDefinitions.LinearProjectUpdateSummary; export type LinearProjectDetail = SharedTypeDefinitions.LinearProjectDetail; export type LinearCustomViewModel = SharedTypeDefinitions.LinearCustomViewModel; export type LinearCustomViewSummary = SharedTypeDefinitions.LinearCustomViewSummary; export type LinearIssueChildSummary = SharedTypeDefinitions.LinearIssueChildSummary; export type LinearComment = SharedTypeDefinitions.LinearComment; export type GitHubCreateIssueFields = SharedTypeDefinitions.GitHubCreateIssueFields; export type GitHubCreateIssueResult = SharedTypeDefinitions.GitHubCreateIssueResult; export type GitHubIssueCloseReason = SharedTypeDefinitions.GitHubIssueCloseReason; export type GitHubIssueUpdate = SharedTypeDefinitions.GitHubIssueUpdate; export type GitHubPullRequestStateUpdate = SharedTypeDefinitions.GitHubPullRequestStateUpdate; export type LinearIssueUpdate = SharedTypeDefinitions.LinearIssueUpdate; export type ClassifiedError = SharedTypeDefinitions.ClassifiedError; export type GitHubOwnerRepo = SharedTypeDefinitions.GitHubOwnerRepo; export type GitHubRateLimitBucket = SharedTypeDefinitions.GitHubRateLimitBucket; export type GitHubRateLimitSnapshot = SharedTypeDefinitions.GitHubRateLimitSnapshot; export type GetRateLimitResult = SharedTypeDefinitions.GetRateLimitResult; export type ListWorkItemsResult = SharedTypeDefinitions.ListWorkItemsResult; export type LinearWorkflowState = SharedTypeDefinitions.LinearWorkflowState; export type LinearLabel = SharedTypeDefinitions.LinearLabel; export type LinearMember = SharedTypeDefinitions.LinearMember; export type LinearTeam = SharedTypeDefinitions.LinearTeam; export type OrcaHooks = SharedTypeDefinitions.OrcaHooks; export type OrcaWorktreeDefaults = SharedTypeDefinitions.OrcaWorktreeDefaults; export type OrcaDefaultTabTemplate = SharedTypeDefinitions.OrcaDefaultTabTemplate; export type OrcaVmRecipe = SharedTypeDefinitions.OrcaVmRecipe; export type OrcaVmRecipeDiagnostic = SharedTypeDefinitions.OrcaVmRecipeDiagnostic; export type RepoHookSettings = SharedTypeDefinitions.RepoHookSettings; export type WorktreeSetupLaunch = SharedTypeDefinitions.WorktreeSetupLaunch; export type WorktreeStartupLaunch = SharedTypeDefinitions.WorktreeStartupLaunch; export type WorktreeDefaultTabsLaunch = SharedTypeDefinitions.WorktreeDefaultTabsLaunch; export type WorktreeCreateTimingPhase = SharedTypeDefinitions.WorktreeCreateTimingPhase; export type WorktreeCreateTiming = SharedTypeDefinitions.WorktreeCreateTiming; export type CreateSparseCheckoutRequest = SharedTypeDefinitions.CreateSparseCheckoutRequest; export type SparsePreset = SharedTypeDefinitions.SparsePreset; export type CreateWorktreeArgs = SharedTypeDefinitions.CreateWorktreeArgs; export type CreateWorktreeResult = SharedTypeDefinitions.CreateWorktreeResult; export type WorktreeCreateBaseFallback = SharedTypeDefinitions.WorktreeCreateBaseFallback; export type PreservedWorktreeBranch = SharedTypeDefinitions.PreservedWorktreeBranch; export type RemoveWorktreeResult = SharedTypeDefinitions.RemoveWorktreeResult; export type ForceDeleteWorktreeBranchResult = SharedTypeDefinitions.ForceDeleteWorktreeBranchResult; export type LocalBaseRefRefreshResult = SharedTypeDefinitions.LocalBaseRefRefreshResult; export type LocalBaseRefUpdateSuggestion = SharedTypeDefinitions.LocalBaseRefUpdateSuggestion; export type WorktreeBaseStatusKind = SharedTypeDefinitions.WorktreeBaseStatusKind; export type WorktreeBaseStatusEvent = SharedTypeDefinitions.WorktreeBaseStatusEvent; export type WorktreeRemoteBranchConflictEvent = SharedTypeDefinitions.WorktreeRemoteBranchConflictEvent; export type ChangelogRelease = SharedTypeDefinitions.ChangelogRelease; export type ChangelogData = SharedTypeDefinitions.ChangelogData; export type UpdateCheckOptions = SharedTypeDefinitions.UpdateCheckOptions; export type UpdateSource = SharedTypeDefinitions.UpdateSource; export type UpdateStatus = SharedTypeDefinitions.UpdateStatus; export type ReleaseBuildListResult = SharedTypeDefinitions.ReleaseBuildListResult; export type NotificationSettings = SharedTypeDefinitions.NotificationSettings; export type CodexManagedAccount = SharedTypeDefinitions.CodexManagedAccount; export type CodexManagedAccountSummary = SharedTypeDefinitions.CodexManagedAccountSummary; export type CodexSystemDefaultIdentity = SharedTypeDefinitions.CodexSystemDefaultIdentity; export type CodexRateLimitAccountsState = SharedTypeDefinitions.CodexRateLimitAccountsState; export type CodexManagedAccountRuntimeSelection = SharedTypeDefinitions.CodexManagedAccountRuntimeSelection; export type ClaudeManagedAccount = SharedTypeDefinitions.ClaudeManagedAccount; export type ClaudeManagedAccountSummary = SharedTypeDefinitions.ClaudeManagedAccountSummary; export type ClaudeRateLimitAccountsState = SharedTypeDefinitions.ClaudeRateLimitAccountsState; export type ClaudeManagedAccountRuntimeSelection = SharedTypeDefinitions.ClaudeManagedAccountRuntimeSelection; export type TuiAgent = SharedTypeDefinitions.TuiAgent; export type TaskViewPresetId = SharedTypeDefinitions.TaskViewPresetId; export type SetupScriptLaunchMode = SharedTypeDefinitions.SetupScriptLaunchMode; export type SetupSplitDirection = SharedTypeDefinitions.SetupSplitDirection; export type TerminalColorOverrides = SharedTypeDefinitions.TerminalColorOverrides; export type TerminalQuickCommandScope = SharedTypeDefinitions.TerminalQuickCommandScope; export type TerminalQuickCommandAction = SharedTypeDefinitions.TerminalQuickCommandAction; export type TerminalQuickCommandBase = SharedTypeDefinitions.TerminalQuickCommandBase; export type TerminalCommandQuickCommand = SharedTypeDefinitions.TerminalCommandQuickCommand; export type TerminalAgentQuickCommand = SharedTypeDefinitions.TerminalAgentQuickCommand; export type TerminalQuickCommand = SharedTypeDefinitions.TerminalQuickCommand; export type OpenInApplication = SharedTypeDefinitions.OpenInApplication; export type SourceControlViewMode = SharedTypeDefinitions.SourceControlViewMode; export type SourceControlGroupOrder = SharedTypeDefinitions.SourceControlGroupOrder; export type LeftSidebarAppearanceMode = SharedTypeDefinitions.LeftSidebarAppearanceMode; export type BranchPrefixStrategy = SharedTypeDefinitions.BranchPrefixStrategy; export type FloatingTerminalCwdRequest = SharedTypeDefinitions.FloatingTerminalCwdRequest; export type HostSettingOverrides = SharedTypeDefinitions.HostSettingOverrides; export type AgentDashboardMode = SharedTypeDefinitions.AgentDashboardMode; export type GlobalSettings = SharedTypeDefinitions.GlobalSettings; export type OrcaWorkspaceLayout = SharedTypeDefinitions.OrcaWorkspaceLayout; export type CommitMessageAiModelCapability = SharedTypeDefinitions.CommitMessageAiModelCapability; export type CommitMessageAiSettings = SharedTypeDefinitions.CommitMessageAiSettings; export type GhosttyImportPreview = SharedTypeDefinitions.GhosttyImportPreview; export type DiscoveryStatusEmitted = SharedTypeDefinitions.DiscoveryStatusEmitted; export type NotificationEventSource = SharedTypeDefinitions.NotificationEventSource; export type NotificationDispatchRequest = SharedTypeDefinitions.NotificationDispatchRequest; export type NotificationDispatchResult = SharedTypeDefinitions.NotificationDispatchResult; export type NotificationDismissResult = SharedTypeDefinitions.NotificationDismissResult; export type NotificationSoundResult = SharedTypeDefinitions.NotificationSoundResult; export type NotificationSoundDataResult = SharedTypeDefinitions.NotificationSoundDataResult; export type NotificationSoundPathResult = SharedTypeDefinitions.NotificationSoundPathResult; export type OnboardingOutcome = SharedTypeDefinitions.OnboardingOutcome; export type OnboardingChecklistState = SharedTypeDefinitions.OnboardingChecklistState; export type OnboardingState = SharedTypeDefinitions.OnboardingState; export type NotificationPermissionStatusResult = SharedTypeDefinitions.NotificationPermissionStatusResult; export type NotificationDeliveryProbeResult = SharedTypeDefinitions.NotificationDeliveryProbeResult; export type WorktreeCardProperty = SharedTypeDefinitions.WorktreeCardProperty; export type WorktreeCardMode = SharedTypeDefinitions.WorktreeCardMode; export type AgentActivityDisplayMode = SharedTypeDefinitions.AgentActivityDisplayMode; export type StatusBarItem = SharedTypeDefinitions.StatusBarItem; export type FloatingTerminalTriggerLocation = SharedTypeDefinitions.FloatingTerminalTriggerLocation; export type TaskResumeState = SharedTypeDefinitions.TaskResumeState; export type RightSidebarTab = SharedTypeDefinitions.RightSidebarTab; export type ActiveRightSidebarTab = SharedTypeDefinitions.ActiveRightSidebarTab; export type RightSidebarExplorerView = SharedTypeDefinitions.RightSidebarExplorerView; export type ProjectOrderBy = SharedTypeDefinitions.ProjectOrderBy; export type WorkspaceHostScope = SharedTypeDefinitions.WorkspaceHostScope; export type VisibleWorkspaceHostIds = SharedTypeDefinitions.VisibleWorkspaceHostIds; export type WorkspaceHostOrder = SharedTypeDefinitions.WorkspaceHostOrder; export type ManualRepoOrderEntry = SharedTypeDefinitions.ManualRepoOrderEntry; export type TopLevelView = SharedTypeDefinitions.TopLevelView; export type PersistedUIState = SharedTypeDefinitions.PersistedUIState; export type CustomPet = SharedTypeDefinitions.CustomPet; export type SpriteAnimation = SharedTypeDefinitions.SpriteAnimation; export type PersistedTrustedOrcaHookEntry = SharedTypeDefinitions.PersistedTrustedOrcaHookEntry; export type PersistedTrustedOrcaHookRepo = SharedTypeDefinitions.PersistedTrustedOrcaHookRepo; export type PersistedTrustedOrcaHooks = SharedTypeDefinitions.PersistedTrustedOrcaHooks; export type LegacyPaneKeyAliasEntry = SharedTypeDefinitions.LegacyPaneKeyAliasEntry; export type PersistedMobileClientTabSelection = SharedTypeDefinitions.PersistedMobileClientTabSelection; export type PersistedMobileClientTabSelections = SharedTypeDefinitions.PersistedMobileClientTabSelections; export type PersistedState = SharedTypeDefinitions.PersistedState; export type FilesystemPathFlavor = SharedTypeDefinitions.FilesystemPathFlavor; export type DirEntry = SharedTypeDefinitions.DirEntry; export type MarkdownDocument = SharedTypeDefinitions.MarkdownDocument; export type FsChangeEvent = SharedTypeDefinitions.FsChangeEvent; export type FsChangedPayload = SharedTypeDefinitions.FsChangedPayload; export type GitBranchChangeEntry = SharedTypeDefinitions.GitBranchChangeEntry; export type GitBranchCompareSummary = SharedTypeDefinitions.GitBranchCompareSummary; export type GitBranchCompareResult = SharedTypeDefinitions.GitBranchCompareResult; export type GitCommitCompareSummary = SharedTypeDefinitions.GitCommitCompareSummary; export type GitCommitCompareResult = SharedTypeDefinitions.GitCommitCompareResult; export type GitDiffTextResult = SharedTypeDefinitions.GitDiffTextResult; export type GitDiffBinaryResult = SharedTypeDefinitions.GitDiffBinaryResult; export type GitDiffResult = SharedTypeDefinitions.GitDiffResult; export type SearchMatch = SharedTypeDefinitions.SearchMatch; export type SearchFileResult = SharedTypeDefinitions.SearchFileResult; export type SearchResult = SharedTypeDefinitions.SearchResult; export type SearchOptions = SharedTypeDefinitions.SearchOptions; export type StatsSummary = SharedTypeDefinitions.StatsSummary; export type UsageValues = SharedTypeDefinitions.UsageValues; export type ProcessMemoryMetric = SharedTypeDefinitions.ProcessMemoryMetric; export type HostAvailableMemorySource = SharedTypeDefinitions.HostAvailableMemorySource; export type AppMemory = SharedTypeDefinitions.AppMemory; export type SessionMemory = SharedTypeDefinitions.SessionMemory; export type WorktreeMemory = SharedTypeDefinitions.WorktreeMemory; export type HostMemory = SharedTypeDefinitions.HostMemory; export type MemorySnapshot = SharedTypeDefinitions.MemorySnapshot;

// ─── Worktree (git-level) ────────────────────────────────────────────
export type GitWorktreeInfo = {
  path: string
  head: string
  branch: string
  isBare: boolean
  isSparse?: boolean
  locked?: boolean
  lockReason?: string
  /** True when Git reports the worktree as prunable (its directory is gone but
   *  the registration remains). Detected via the `prunable` porcelain field
   *  (Git ≥ 2.36) or a path-existence probe on older Git. */
  prunable?: boolean
  prunableReason?: string
  /** True for the repo's main working tree (the first entry from `git worktree list`).
   *  Linked worktrees created via `git worktree add` have this set to false. */
  isMainWorktree: boolean
}


/** Head/branch snapshot read from Git metadata files without spawning Git.
 *  Carries background-worktree freshness when status-only churn includes a
 *  real head move (external commit/amend/reset) that must not re-enter the
 *  structural `worktrees:changed` fanout. */
export type WorktreeHeadIdentity = {
  worktreePath: string
  head: string
  /** Full ref (e.g. `refs/heads/main`), or null for a detached HEAD. */
  branch: string | null
}

// ─── Worktree (app-level, enriched) ──────────────────────────────────
export type WorkspaceStatus = string

export type WorkspaceStatusDefinition = {
  id: WorkspaceStatus
  label: string
  color?: string
  icon?: string
}

export type Worktree = {
  id: string // `${repoId}::${path}`
  instanceId?: string
  repoId: string
  /** Durable project identity. Optional while legacy repo-only workspaces migrate. */
  projectId?: string
  /** Execution host that owns the workspace. Optional for pre-project-host metadata. */
  hostId?: ExecutionHostId
  /** Renderer projection of the paired runtime that transports operations to `hostId`. */
  runtimeOwnerEnvironmentId?: string
  /** Host-specific setup used to create/run this workspace. */
  projectHostSetupId?: string
  displayName: string
  comment: string
  linkedIssue: number | null
  linkedPR: number | null
  linkedLinearIssue: string | null
  linkedLinearIssueWorkspaceId?: string | null
  linkedLinearIssueOrganizationUrlKey?: string | null
  // Why: parallel slots for non-GitHub work-item references. Kept as separate
  // fields (rather than reusing linkedIssue / linkedPR with a provider
  // discriminator) so the persistence layer is unambiguous when a user
  // has remotes from several providers on the same repo, and so the
  // existing GitHub renderer code keeps reading linkedPR / linkedIssue
  // unchanged. Optional on the type so existing test fixtures and
  // persisted older worktrees that never carried these fields continue
  // to typecheck and load without migration.
  linkedGitLabMR?: number | null
  linkedGitLabIssue?: number | null
  linkedBitbucketPR?: number | null
  linkedAzureDevOpsPR?: number | null
  linkedGiteaPR?: number | null
  linkedWorkItem?: WorkspaceLinkedItem | null
  linkedTaskSourceContext?: TaskSourceContext | null
  isArchived: boolean
  isUnread: boolean
  isPinned: boolean
  sortOrder: number
  /** User-authored sidebar ordering. Higher values render earlier in Manual sort. */
  manualOrder?: number
  lastActivityAt: number
  /** Set once when Orca creates the worktree. Absent for worktrees discovered
   *  on disk or persisted before this field existed. Used by the sidebar to
   *  grant newly-created worktrees a short grace window at the top of Recent,
   *  immune to ambient PTY-bump reordering in other worktrees. */
  createdAt?: number
  /** Agent selected when Orca originally created the worktree. Used only to
   *  seed a replacement terminal if the user later reopens the worktree after
   *  closing every visible surface. */
  createdWithAgent?: TuiAgent
  /** True while an auto-named workspace is waiting for the first agent message
   *  to drive the branch/title rename. */
  pendingFirstAgentMessageRename?: boolean
  /** Holds the last auto-rename generation failure message so the sidebar can
   *  show a "rename failed" badge. null/undefined when there is no failure
   *  (never attempted, succeeded, or only a benign skip). */
  firstAgentMessageRenameError?: string | null
  sparseDirectories?: string[]
  sparseBaseRef?: string
  /** ID of the saved preset this worktree was created from, if any. Cleared
   *  when the worktree is no longer sparse on refresh. */
  sparsePresetId?: string
  /** Intended create base for stale-base probes. Persisted metadata, not UI drift state. */
  baseRef?: string
  /** Remote/branch Orca should publish review commits to when it created this worktree. */
  pushTarget?: GitPushTarget
  /** Path-derived worktree ids this worktree had before folder renames. */
  priorWorktreeIds?: string[]
  workspaceStatus?: WorkspaceStatus
  diffComments?: DiffComment[]
  mobileDiffReview?: MobileDiffReviewState
  automationProvenance?: AutomationWorkspaceProvenance
  cliProvenance?: CliWorkspaceProvenance
} & GitWorktreeInfo

/** Provenance for workspaces created through `orca worktree create`. Absent on
 *  workspaces created before this field existed and on every non-CLI create, so
 *  consumers must read "missing" as "not CLI-created". */
export type CliWorkspaceProvenance = {
  kind: 'created-by-cli'
  createdAt: number
  /** Orca terminal the CLI ran inside, when the caller had one — distinguishes
   *  an agent-issued create from one hand-typed in an external shell. */
  callerTerminalHandle?: string
  /** Agent requested via `--agent`, when one was passed. */
  startupAgent?: TuiAgent
}

export type AutomationWorkspaceProvenance = {
  kind: 'created-by-automation'
  automationId: string
  automationNameSnapshot: string
  automationRunId: string
  automationRunTitleSnapshot: string
  createdAt: number
  executionTargetType: AutomationExecutionTargetType
  executionTargetId: string
  projectId: string
  repoId?: string
  hostId?: ExecutionHostId
}

export type AutomationWorkspaceProvenanceRequest = {
  automationId: string
  automationRunId: string
  dispatchToken: string
  createRequestId: string
}

export type GitPushTarget = {
  remoteName: string
  branchName: string
  remoteUrl?: string
  /** True when Orca added this remote while preparing a fork-PR worktree. */
  remoteCreated?: boolean
}

export type GitHubPrStartPoint = {
  baseBranch: string
  /** Review target branch to use for Source Control compare after creating from a PR head SHA. */
  compareBaseRef?: string
  pushTarget?: GitPushTarget
  /** Verified PR head commit. Present when checkout can be tied to a stable SHA. */
  headSha?: string
  /** Exact local branch name to create/reuse when the PR head is a safe same-repo branch. */
  branchNameOverride?: string
  /** Fork PRs: false when "Allow edits from maintainers" is off; a push to the fork may be rejected. */
  maintainerCanModify?: boolean
}

// ─── Worktree metadata (persisted user-authored fields only) ─────────
export type WorktreeMeta = {
  /** Immutable per-workspace-instance ID used to reject stale lineage after path reuse. */
  instanceId?: string
  /** See Worktree.projectId. Persisted for project-first workspace ownership. */
  projectId?: string
  /** See Worktree.hostId. Persisted for project-first workspace ownership. */
  hostId?: ExecutionHostId
  /** See Worktree.projectHostSetupId. Persisted for project-first workspace ownership. */
  projectHostSetupId?: string
  displayName: string
  comment: string
  linkedIssue: number | null
  linkedPR: number | null
  linkedLinearIssue: string | null
  linkedLinearIssueWorkspaceId?: string | null
  linkedLinearIssueOrganizationUrlKey?: string | null
  /** Optional for backward compatibility — see Worktree.linkedGitLabMR. */
  linkedGitLabMR?: number | null
  /** Optional for backward compatibility — see Worktree.linkedGitLabIssue. */
  linkedGitLabIssue?: number | null
  /** Optional for backward compatibility — see Worktree.linkedBitbucketPR. */
  linkedBitbucketPR?: number | null
  /** Optional for backward compatibility — see Worktree.linkedAzureDevOpsPR. */
  linkedAzureDevOpsPR?: number | null
  /** Optional for backward compatibility — see Worktree.linkedGiteaPR. */
  linkedGiteaPR?: number | null
  linkedWorkItem?: WorkspaceLinkedItem | null
  linkedTaskSourceContext?: TaskSourceContext | null
  isArchived: boolean
  isUnread: boolean
  isPinned: boolean
  sortOrder: number
  /** User-authored sidebar ordering. Higher values render earlier in Manual sort. */
  manualOrder?: number
  lastActivityAt: number
  /** See {@link Worktree.createdAt}. Persisted to orca-data.json. */
  createdAt?: number
  /** See {@link Worktree.createdWithAgent}. Persisted to orca-data.json. */
  createdWithAgent?: TuiAgent
  /** See {@link Worktree.pendingFirstAgentMessageRename}. */
  pendingFirstAgentMessageRename?: boolean
  /** See {@link Worktree.firstAgentMessageRenameError}. */
  firstAgentMessageRenameError?: string | null
  sparseDirectories?: string[]
  sparseBaseRef?: string
  sparsePresetId?: string
  /** Intended create base for stale-base probes. Persisted metadata, not UI drift state. */
  baseRef?: string
  /** True when Orca checked out a pre-existing local branch that delete must not prune. */
  preserveBranchOnDelete?: boolean
  /** See {@link Worktree.pushTarget}. Persisted so refreshed worktree lists keep the target. */
  pushTarget?: GitPushTarget
  /** Explicit marker stamped when Orca creates the worktree. */
  orcaCreatedAt?: number
  orcaCreationSource?: 'desktop' | 'runtime' | 'cli' | 'ssh'
  /** Workspace layout active when Orca created the worktree. */
  orcaCreationWorkspaceLayout?: OrcaWorkspaceLayout
  /** User-assigned workspace board status for manual sidebar organization. */
  workspaceStatus?: WorkspaceStatus
  diffComments?: DiffComment[]
  /** Path-derived worktree ids this worktree had before its folder was renamed
   *  on disk (the id embeds the path). Lets the daemon's session GC and registry
   *  hydration recognize sessions minted under an old id instead of reaping
   *  them. Self-prunes when the worktree is deleted. */
  priorWorktreeIds?: string[]
  mobileDiffReview?: MobileDiffReviewState
  /** System-owned provenance for workspaces created by automation new-per-run dispatches. */
  automationProvenance?: AutomationWorkspaceProvenance
  /** System-owned provenance for workspaces created via `orca worktree create`. */
  cliProvenance?: CliWorkspaceProvenance
}

export type WorktreeOwnership = 'orca-managed' | 'external' | 'unknown-legacy' | 'agent-scratch'

export type DetectedWorktreeListSource = 'git' | 'metadata-fallback' | 'session-fallback'

export type DetectedWorktree = Worktree & {
  ownership: WorktreeOwnership
  selectedCheckout: boolean
  visible: boolean
}

export type DetectedWorktreeListResult = {
  repoId: string
  authoritative: boolean
  source: DetectedWorktreeListSource
  worktrees: DetectedWorktree[]
}

export type WorktreeLineageOrigin = 'orchestration' | 'cli' | 'manual'
export type WorktreeLineageCaptureConfidence = 'explicit' | 'inferred'
export type WorktreeLineageCaptureSource =
  | 'explicit-cli-flag'
  | 'env-workspace'
  | 'cwd-context'
  | 'terminal-context'
  | 'orchestration-context'
  | 'active-workspace'
  | 'manual-action'

export type WorktreeLineageCapture = {
  source: WorktreeLineageCaptureSource
  confidence: WorktreeLineageCaptureConfidence
}

export type WorktreeLineage = {
  worktreeId: string
  worktreeInstanceId: string
  parentWorktreeId: string
  parentWorktreeInstanceId: string
  origin: WorktreeLineageOrigin
  capture: WorktreeLineageCapture
  orchestrationRunId?: string
  taskId?: string
  coordinatorHandle?: string
  createdByTerminalHandle?: string
  createdAt: number
}

export type WorkspaceLineage = {
  childWorkspaceKey: WorkspaceKey
  childInstanceId?: string | null
  parentWorkspaceKey: WorkspaceKey
  parentInstanceId?: string | null
  origin: WorktreeLineageOrigin
  capture: WorktreeLineageCapture
  taskId?: string
  orchestrationRunId?: string
  coordinatorHandle?: string
  createdByTerminalHandle?: string
  createdAt: number
}

export type WorktreeLineageWarningCode =
  | 'LINEAGE_PARENT_CONTEXT_MISSING'
  | 'LINEAGE_PARENT_CONTEXT_CONFLICT'
  | 'LINEAGE_PARENT_INSTANCE_STALE'

export type WorktreeLineageWarning = {
  code: WorktreeLineageWarningCode
  message: string
  details?: Record<string, unknown>
}

// ─── Diff line comments ──────────────────────────────────────────────
// Why: users leave review notes on specific lines of the modified side of
// a diff so they can be handed back to an AI agent (pasted into a terminal
// or used to bootstrap a new agent session). Stored on WorktreeMeta so the
// existing persistence layer writes them to orca-data.json automatically.
export type DiffCommentSource = 'diff' | 'markdown'
export type DiffReviewScope = 'unstaged' | 'staged' | 'branch'

export type MobileDiffReviewFileState = {
  key: string
  filePath: string
  oldPath?: string
  scope: DiffReviewScope
  lastOpenedAt?: number
  lastSeenDiffIdentity?: string
  reviewedAt?: number
  reviewDiffIdentity?: string
}

export type MobileDiffReviewState = {
  version: 1
  updatedAt?: number
  completedAt?: number
  files: Record<string, MobileDiffReviewFileState>
}

export type DiffComment = {
  id: string
  worktreeId: string
  filePath: string
  /** Undefined means a legacy diff note. */
  source?: DiffCommentSource
  /** Exact text selected when creating a markdown note, when available. */
  selectedText?: string
  /** Inclusive range start. Must be <= lineNumber when present. */
  startLine?: number
  lineNumber: number
  body: string
  createdAt: number
  updatedAt?: number
  /** Set after the note has been handed to an agent. Edits clear it. */
  sentAt?: number
  scope?: DiffReviewScope
  oldPath?: string
  diffIdentity?: string
  // Reserved for future "comments on the original side" — always 'modified' in v1.
  side: 'modified'
}
