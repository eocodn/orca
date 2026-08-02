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
type ShellHydrationFailureReason = SharedTypeDefinitions.ShellHydrationFailureReason; type PathSource = SharedTypeDefinitions.PathSource; type RepoKind = SharedTypeDefinitions.RepoKind; type IssueSourcePreference = SharedTypeDefinitions.IssueSourcePreference; type ExternalWorktreeVisibility = SharedTypeDefinitions.ExternalWorktreeVisibility; type ProjectProviderIdentity = SharedTypeDefinitions.ProjectProviderIdentity; type Project = SharedTypeDefinitions.Project; type ProjectUpdateArgs = SharedTypeDefinitions.ProjectUpdateArgs; type ProjectHostSetupState = SharedTypeDefinitions.ProjectHostSetupState; type ProjectHostSetupMethod = SharedTypeDefinitions.ProjectHostSetupMethod; type RepoProjectHostSetupMethod = SharedTypeDefinitions.RepoProjectHostSetupMethod; type ProjectHostSetup = SharedTypeDefinitions.ProjectHostSetup; type ProjectHostSetupExistingFolderArgs = SharedTypeDefinitions.ProjectHostSetupExistingFolderArgs; type ProjectHostSetupCreateArgs = SharedTypeDefinitions.ProjectHostSetupCreateArgs; type ProjectHostSetupCloneArgs = SharedTypeDefinitions.ProjectHostSetupCloneArgs; type ProjectHostSetupUpdateArgs = SharedTypeDefinitions.ProjectHostSetupUpdateArgs; type ProjectHostSetupDeleteArgs = SharedTypeDefinitions.ProjectHostSetupDeleteArgs; type ProjectHostSetupResult = SharedTypeDefinitions.ProjectHostSetupResult; type ProjectHostSetupCreateResult = SharedTypeDefinitions.ProjectHostSetupCreateResult; type ProjectHostSetupUpdateResult = SharedTypeDefinitions.ProjectHostSetupUpdateResult; type ProjectHostSetupDeleteResult = SharedTypeDefinitions.ProjectHostSetupDeleteResult; type Repo = SharedTypeDefinitions.Repo; type ProjectGroupCreatedFrom = SharedTypeDefinitions.ProjectGroupCreatedFrom; type ProjectGroup = SharedTypeDefinitions.ProjectGroup; type WorkspaceScope = SharedTypeDefinitions.WorkspaceScope; type WorkspaceKey = SharedTypeDefinitions.WorkspaceKey; type FolderWorkspace = SharedTypeDefinitions.FolderWorkspace; type WorkspaceLinkedItem = SharedTypeDefinitions.WorkspaceLinkedItem; type FolderWorkspaceLinkedTask = SharedTypeDefinitions.FolderWorkspaceLinkedTask; type NestedRepoScanOptions = SharedTypeDefinitions.NestedRepoScanOptions; type NestedRepoCandidate = SharedTypeDefinitions.NestedRepoCandidate; type NestedRepoScanResult = SharedTypeDefinitions.NestedRepoScanResult; type ProjectGroupImportMode = SharedTypeDefinitions.ProjectGroupImportMode; type ProjectGroupImportProjectResult = SharedTypeDefinitions.ProjectGroupImportProjectResult; type ProjectGroupImportResult = SharedTypeDefinitions.ProjectGroupImportResult; type SetupRunPolicy = SharedTypeDefinitions.SetupRunPolicy; type SetupAgentStartupPolicy = SharedTypeDefinitions.SetupAgentStartupPolicy; type SetupDecision = SharedTypeDefinitions.SetupDecision; type HookCommandSourcePolicy = SharedTypeDefinitions.HookCommandSourcePolicy; type BaseRefDefaultResult = SharedTypeDefinitions.BaseRefDefaultResult; type BaseRefSearchResult = SharedTypeDefinitions.BaseRefSearchResult; type TabGroupSplitDirection = SharedTypeDefinitions.TabGroupSplitDirection; type TabGroupLayoutNode = SharedTypeDefinitions.TabGroupLayoutNode; type TabContentType = SharedTypeDefinitions.TabContentType; type WorkspaceVisibleTabType = SharedTypeDefinitions.WorkspaceVisibleTabType; type CtrlTabOrderMode = SharedTypeDefinitions.CtrlTabOrderMode; type Tab = SharedTypeDefinitions.Tab; type TabGroup = SharedTypeDefinitions.TabGroup; type TerminalTab = SharedTypeDefinitions.TerminalTab; type BrowserHistoryEntry = SharedTypeDefinitions.BrowserHistoryEntry; type BrowserLoadError = SharedTypeDefinitions.BrowserLoadError; type BrowserCertificateFailure = SharedTypeDefinitions.BrowserCertificateFailure; type BrowserCertificateProceedFailureReason = SharedTypeDefinitions.BrowserCertificateProceedFailureReason; type BrowserCertificateProceedResult = SharedTypeDefinitions.BrowserCertificateProceedResult; type BrowserViewportPresetId = SharedTypeDefinitions.BrowserViewportPresetId; type BrowserViewportOverride = SharedTypeDefinitions.BrowserViewportOverride; type BrowserPage = SharedTypeDefinitions.BrowserPage; type BrowserWorkspace = SharedTypeDefinitions.BrowserWorkspace; type BrowserTab = SharedTypeDefinitions.BrowserTab; type BrowserSessionProfileScope = SharedTypeDefinitions.BrowserSessionProfileScope; type BrowserSessionProfileSource = SharedTypeDefinitions.BrowserSessionProfileSource; type BrowserSessionProfile = SharedTypeDefinitions.BrowserSessionProfile; type BrowserCookieImportSummary = SharedTypeDefinitions.BrowserCookieImportSummary; type BrowserCookieImportResult = SharedTypeDefinitions.BrowserCookieImportResult; type TerminalPaneSplitDirection = SharedTypeDefinitions.TerminalPaneSplitDirection; type TerminalPaneLayoutNode = SharedTypeDefinitions.TerminalPaneLayoutNode; type TerminalLayoutSnapshot = SharedTypeDefinitions.TerminalLayoutSnapshot; type PersistedOpenFile = SharedTypeDefinitions.PersistedOpenFile; type WorkspaceSessionState = SharedTypeDefinitions.WorkspaceSessionState; type WorkspaceSessionPatch = SharedTypeDefinitions.WorkspaceSessionPatch; type PRState = SharedTypeDefinitions.PRState; type IssueState = SharedTypeDefinitions.IssueState; type CheckStatus = SharedTypeDefinitions.CheckStatus; type PRMergeableState = SharedTypeDefinitions.PRMergeableState; type PRReviewDecision = SharedTypeDefinitions.PRReviewDecision; type PRConflictSummary = SharedTypeDefinitions.PRConflictSummary; type GitHubRepositoryIdentity = SharedTypeDefinitions.GitHubRepositoryIdentity; type GitHubPRMergeMethod = SharedTypeDefinitions.GitHubPRMergeMethod; type GitHubPRMergeMethodSettings = SharedTypeDefinitions.GitHubPRMergeMethodSettings; type PRInfo = SharedTypeDefinitions.PRInfo; type PRRefreshErrorType = SharedTypeDefinitions.PRRefreshErrorType; type PRRefreshUpstreamErrorType = SharedTypeDefinitions.PRRefreshUpstreamErrorType; type PRRefreshOutcome = SharedTypeDefinitions.PRRefreshOutcome; type GitHubPRRefreshReason = SharedTypeDefinitions.GitHubPRRefreshReason; type GitHubPRRefreshEnqueueResult = SharedTypeDefinitions.GitHubPRRefreshEnqueueResult; type GitHubPRRefreshAlias = SharedTypeDefinitions.GitHubPRRefreshAlias; type GitHubPRRefreshCandidate = SharedTypeDefinitions.GitHubPRRefreshCandidate; type GitHubPRRefreshSkippedReason = SharedTypeDefinitions.GitHubPRRefreshSkippedReason; type GitHubPRRefreshEvent = SharedTypeDefinitions.GitHubPRRefreshEvent; type PRCheckDetail = SharedTypeDefinitions.PRCheckDetail; type PRCheckAnnotation = SharedTypeDefinitions.PRCheckAnnotation; type PRCheckStep = SharedTypeDefinitions.PRCheckStep; type PRCheckJob = SharedTypeDefinitions.PRCheckJob; type PRCheckRunDetails = SharedTypeDefinitions.PRCheckRunDetails; type GitHubRerunPRChecksResult = SharedTypeDefinitions.GitHubRerunPRChecksResult; type GitHubReactionContent = SharedTypeDefinitions.GitHubReactionContent; type GitHubReaction = SharedTypeDefinitions.GitHubReaction; type PRComment = SharedTypeDefinitions.PRComment; type GitHubIssueTimelineTarget = SharedTypeDefinitions.GitHubIssueTimelineTarget; type GitHubIssueTimelineItem = SharedTypeDefinitions.GitHubIssueTimelineItem; type GitHubCommentResult = SharedTypeDefinitions.GitHubCommentResult; type IssueInfo = SharedTypeDefinitions.IssueInfo; type GitHubViewer = SharedTypeDefinitions.GitHubViewer; type GitHubAssignableUser = SharedTypeDefinitions.GitHubAssignableUser; type ProviderCheckSummary = SharedTypeDefinitions.ProviderCheckSummary; type GitHubPRReviewSummary = SharedTypeDefinitions.GitHubPRReviewSummary; type GitHubPRFileViewedState = SharedTypeDefinitions.GitHubPRFileViewedState; type GitHubWorkItem = SharedTypeDefinitions.GitHubWorkItem; type GitHubPRFile = SharedTypeDefinitions.GitHubPRFile; type GitHubPRFileContents = SharedTypeDefinitions.GitHubPRFileContents; type GitHubPRReviewCommentInput = SharedTypeDefinitions.GitHubPRReviewCommentInput; type GitHubWorkItemDetails = SharedTypeDefinitions.GitHubWorkItemDetails; type LinearViewer = SharedTypeDefinitions.LinearViewer; type LinearWorkspace = SharedTypeDefinitions.LinearWorkspace; type LinearWorkspaceSelection = SharedTypeDefinitions.LinearWorkspaceSelection; type LinearWorkspaceSelector = SharedTypeDefinitions.LinearWorkspaceSelector; type LinearConcreteWorkspaceId = SharedTypeDefinitions.LinearConcreteWorkspaceId; type LinearWorkspaceError = SharedTypeDefinitions.LinearWorkspaceError; type LinearCollectionResult = SharedTypeDefinitions.LinearCollectionResult; type LinearConnectionStatus = SharedTypeDefinitions.LinearConnectionStatus; type LinearIssue = SharedTypeDefinitions.LinearIssue; type LinearProjectSummary = SharedTypeDefinitions.LinearProjectSummary; type LinearProjectStatusSummary = SharedTypeDefinitions.LinearProjectStatusSummary; type LinearProjectMemberSummary = SharedTypeDefinitions.LinearProjectMemberSummary; type LinearProjectMilestoneSummary = SharedTypeDefinitions.LinearProjectMilestoneSummary; type LinearProjectResourceSummary = SharedTypeDefinitions.LinearProjectResourceSummary; type LinearProjectUpdateSummary = SharedTypeDefinitions.LinearProjectUpdateSummary; type LinearProjectDetail = SharedTypeDefinitions.LinearProjectDetail; type LinearCustomViewModel = SharedTypeDefinitions.LinearCustomViewModel; type LinearCustomViewSummary = SharedTypeDefinitions.LinearCustomViewSummary; type LinearIssueChildSummary = SharedTypeDefinitions.LinearIssueChildSummary; type LinearComment = SharedTypeDefinitions.LinearComment; type GitHubCreateIssueFields = SharedTypeDefinitions.GitHubCreateIssueFields; type GitHubCreateIssueResult = SharedTypeDefinitions.GitHubCreateIssueResult; type GitHubIssueCloseReason = SharedTypeDefinitions.GitHubIssueCloseReason; type GitHubIssueUpdate = SharedTypeDefinitions.GitHubIssueUpdate; type GitHubPullRequestStateUpdate = SharedTypeDefinitions.GitHubPullRequestStateUpdate; type LinearIssueUpdate = SharedTypeDefinitions.LinearIssueUpdate; type ClassifiedError = SharedTypeDefinitions.ClassifiedError; type GitHubOwnerRepo = SharedTypeDefinitions.GitHubOwnerRepo; type GitHubRateLimitBucket = SharedTypeDefinitions.GitHubRateLimitBucket; type GitHubRateLimitSnapshot = SharedTypeDefinitions.GitHubRateLimitSnapshot; type GetRateLimitResult = SharedTypeDefinitions.GetRateLimitResult; type ListWorkItemsResult = SharedTypeDefinitions.ListWorkItemsResult; type LinearWorkflowState = SharedTypeDefinitions.LinearWorkflowState; type LinearLabel = SharedTypeDefinitions.LinearLabel; type LinearMember = SharedTypeDefinitions.LinearMember; type LinearTeam = SharedTypeDefinitions.LinearTeam; type OrcaHooks = SharedTypeDefinitions.OrcaHooks; type OrcaWorktreeDefaults = SharedTypeDefinitions.OrcaWorktreeDefaults; type OrcaDefaultTabTemplate = SharedTypeDefinitions.OrcaDefaultTabTemplate; type OrcaVmRecipe = SharedTypeDefinitions.OrcaVmRecipe; type OrcaVmRecipeDiagnostic = SharedTypeDefinitions.OrcaVmRecipeDiagnostic; type RepoHookSettings = SharedTypeDefinitions.RepoHookSettings; type WorktreeSetupLaunch = SharedTypeDefinitions.WorktreeSetupLaunch; type WorktreeStartupLaunch = SharedTypeDefinitions.WorktreeStartupLaunch; type WorktreeDefaultTabsLaunch = SharedTypeDefinitions.WorktreeDefaultTabsLaunch; type WorktreeCreateTimingPhase = SharedTypeDefinitions.WorktreeCreateTimingPhase; type WorktreeCreateTiming = SharedTypeDefinitions.WorktreeCreateTiming; type CreateSparseCheckoutRequest = SharedTypeDefinitions.CreateSparseCheckoutRequest; type SparsePreset = SharedTypeDefinitions.SparsePreset; type CreateWorktreeArgs = SharedTypeDefinitions.CreateWorktreeArgs; type CreateWorktreeResult = SharedTypeDefinitions.CreateWorktreeResult; type WorktreeCreateBaseFallback = SharedTypeDefinitions.WorktreeCreateBaseFallback; type PreservedWorktreeBranch = SharedTypeDefinitions.PreservedWorktreeBranch; type RemoveWorktreeResult = SharedTypeDefinitions.RemoveWorktreeResult; type ForceDeleteWorktreeBranchResult = SharedTypeDefinitions.ForceDeleteWorktreeBranchResult; type LocalBaseRefRefreshResult = SharedTypeDefinitions.LocalBaseRefRefreshResult; type LocalBaseRefUpdateSuggestion = SharedTypeDefinitions.LocalBaseRefUpdateSuggestion; type WorktreeBaseStatusKind = SharedTypeDefinitions.WorktreeBaseStatusKind; type WorktreeBaseStatusEvent = SharedTypeDefinitions.WorktreeBaseStatusEvent; type WorktreeRemoteBranchConflictEvent = SharedTypeDefinitions.WorktreeRemoteBranchConflictEvent; type ChangelogRelease = SharedTypeDefinitions.ChangelogRelease; type ChangelogData = SharedTypeDefinitions.ChangelogData; type UpdateCheckOptions = SharedTypeDefinitions.UpdateCheckOptions; type UpdateSource = SharedTypeDefinitions.UpdateSource; type UpdateStatus = SharedTypeDefinitions.UpdateStatus; type ReleaseBuildListResult = SharedTypeDefinitions.ReleaseBuildListResult; type NotificationSettings = SharedTypeDefinitions.NotificationSettings; type CodexManagedAccount = SharedTypeDefinitions.CodexManagedAccount; type CodexManagedAccountSummary = SharedTypeDefinitions.CodexManagedAccountSummary; type CodexSystemDefaultIdentity = SharedTypeDefinitions.CodexSystemDefaultIdentity; type CodexRateLimitAccountsState = SharedTypeDefinitions.CodexRateLimitAccountsState; type CodexManagedAccountRuntimeSelection = SharedTypeDefinitions.CodexManagedAccountRuntimeSelection; type ClaudeManagedAccount = SharedTypeDefinitions.ClaudeManagedAccount; type ClaudeManagedAccountSummary = SharedTypeDefinitions.ClaudeManagedAccountSummary; type ClaudeRateLimitAccountsState = SharedTypeDefinitions.ClaudeRateLimitAccountsState; type ClaudeManagedAccountRuntimeSelection = SharedTypeDefinitions.ClaudeManagedAccountRuntimeSelection; type TuiAgent = SharedTypeDefinitions.TuiAgent; type TaskViewPresetId = SharedTypeDefinitions.TaskViewPresetId; type SetupScriptLaunchMode = SharedTypeDefinitions.SetupScriptLaunchMode; type SetupSplitDirection = SharedTypeDefinitions.SetupSplitDirection; type TerminalColorOverrides = SharedTypeDefinitions.TerminalColorOverrides; type TerminalQuickCommandScope = SharedTypeDefinitions.TerminalQuickCommandScope; type TerminalQuickCommandAction = SharedTypeDefinitions.TerminalQuickCommandAction; type TerminalQuickCommandBase = SharedTypeDefinitions.TerminalQuickCommandBase; type TerminalCommandQuickCommand = SharedTypeDefinitions.TerminalCommandQuickCommand; type TerminalAgentQuickCommand = SharedTypeDefinitions.TerminalAgentQuickCommand; type TerminalQuickCommand = SharedTypeDefinitions.TerminalQuickCommand; type OpenInApplication = SharedTypeDefinitions.OpenInApplication; type SourceControlViewMode = SharedTypeDefinitions.SourceControlViewMode; type SourceControlGroupOrder = SharedTypeDefinitions.SourceControlGroupOrder; type LeftSidebarAppearanceMode = SharedTypeDefinitions.LeftSidebarAppearanceMode; type BranchPrefixStrategy = SharedTypeDefinitions.BranchPrefixStrategy; type FloatingTerminalCwdRequest = SharedTypeDefinitions.FloatingTerminalCwdRequest; type HostSettingOverrides = SharedTypeDefinitions.HostSettingOverrides; type AgentDashboardMode = SharedTypeDefinitions.AgentDashboardMode; type GlobalSettings = SharedTypeDefinitions.GlobalSettings; type OrcaWorkspaceLayout = SharedTypeDefinitions.OrcaWorkspaceLayout; type CommitMessageAiModelCapability = SharedTypeDefinitions.CommitMessageAiModelCapability; type CommitMessageAiSettings = SharedTypeDefinitions.CommitMessageAiSettings; type GhosttyImportPreview = SharedTypeDefinitions.GhosttyImportPreview; type DiscoveryStatusEmitted = SharedTypeDefinitions.DiscoveryStatusEmitted; type NotificationEventSource = SharedTypeDefinitions.NotificationEventSource; type NotificationDispatchRequest = SharedTypeDefinitions.NotificationDispatchRequest; type NotificationDispatchResult = SharedTypeDefinitions.NotificationDispatchResult; type NotificationDismissResult = SharedTypeDefinitions.NotificationDismissResult; type NotificationSoundResult = SharedTypeDefinitions.NotificationSoundResult; type NotificationSoundDataResult = SharedTypeDefinitions.NotificationSoundDataResult; type NotificationSoundPathResult = SharedTypeDefinitions.NotificationSoundPathResult; type OnboardingOutcome = SharedTypeDefinitions.OnboardingOutcome; type OnboardingChecklistState = SharedTypeDefinitions.OnboardingChecklistState; type OnboardingState = SharedTypeDefinitions.OnboardingState; type NotificationPermissionStatusResult = SharedTypeDefinitions.NotificationPermissionStatusResult; type NotificationDeliveryProbeResult = SharedTypeDefinitions.NotificationDeliveryProbeResult; type WorktreeCardProperty = SharedTypeDefinitions.WorktreeCardProperty; type WorktreeCardMode = SharedTypeDefinitions.WorktreeCardMode; type AgentActivityDisplayMode = SharedTypeDefinitions.AgentActivityDisplayMode; type StatusBarItem = SharedTypeDefinitions.StatusBarItem; type FloatingTerminalTriggerLocation = SharedTypeDefinitions.FloatingTerminalTriggerLocation; type TaskResumeState = SharedTypeDefinitions.TaskResumeState; type RightSidebarTab = SharedTypeDefinitions.RightSidebarTab; type ActiveRightSidebarTab = SharedTypeDefinitions.ActiveRightSidebarTab; type RightSidebarExplorerView = SharedTypeDefinitions.RightSidebarExplorerView; type ProjectOrderBy = SharedTypeDefinitions.ProjectOrderBy; type WorkspaceHostScope = SharedTypeDefinitions.WorkspaceHostScope; type VisibleWorkspaceHostIds = SharedTypeDefinitions.VisibleWorkspaceHostIds; type WorkspaceHostOrder = SharedTypeDefinitions.WorkspaceHostOrder; type ManualRepoOrderEntry = SharedTypeDefinitions.ManualRepoOrderEntry; type TopLevelView = SharedTypeDefinitions.TopLevelView; type PersistedUIState = SharedTypeDefinitions.PersistedUIState; type CustomPet = SharedTypeDefinitions.CustomPet; type SpriteAnimation = SharedTypeDefinitions.SpriteAnimation; type PersistedTrustedOrcaHookEntry = SharedTypeDefinitions.PersistedTrustedOrcaHookEntry; type PersistedTrustedOrcaHookRepo = SharedTypeDefinitions.PersistedTrustedOrcaHookRepo; type PersistedTrustedOrcaHooks = SharedTypeDefinitions.PersistedTrustedOrcaHooks; type LegacyPaneKeyAliasEntry = SharedTypeDefinitions.LegacyPaneKeyAliasEntry; type PersistedMobileClientTabSelection = SharedTypeDefinitions.PersistedMobileClientTabSelection; type PersistedMobileClientTabSelections = SharedTypeDefinitions.PersistedMobileClientTabSelections; type PersistedState = SharedTypeDefinitions.PersistedState; type FilesystemPathFlavor = SharedTypeDefinitions.FilesystemPathFlavor; type DirEntry = SharedTypeDefinitions.DirEntry; type MarkdownDocument = SharedTypeDefinitions.MarkdownDocument; type FsChangeEvent = SharedTypeDefinitions.FsChangeEvent; type FsChangedPayload = SharedTypeDefinitions.FsChangedPayload; type GitBranchChangeEntry = SharedTypeDefinitions.GitBranchChangeEntry; type GitBranchCompareSummary = SharedTypeDefinitions.GitBranchCompareSummary; type GitBranchCompareResult = SharedTypeDefinitions.GitBranchCompareResult; type GitCommitCompareSummary = SharedTypeDefinitions.GitCommitCompareSummary; type GitCommitCompareResult = SharedTypeDefinitions.GitCommitCompareResult; type GitDiffTextResult = SharedTypeDefinitions.GitDiffTextResult; type GitDiffBinaryResult = SharedTypeDefinitions.GitDiffBinaryResult; type GitDiffResult = SharedTypeDefinitions.GitDiffResult; type SearchMatch = SharedTypeDefinitions.SearchMatch; type SearchFileResult = SharedTypeDefinitions.SearchFileResult; type SearchResult = SharedTypeDefinitions.SearchResult; type SearchOptions = SharedTypeDefinitions.SearchOptions; type StatsSummary = SharedTypeDefinitions.StatsSummary; type UsageValues = SharedTypeDefinitions.UsageValues; type ProcessMemoryMetric = SharedTypeDefinitions.ProcessMemoryMetric; type HostAvailableMemorySource = SharedTypeDefinitions.HostAvailableMemorySource; type AppMemory = SharedTypeDefinitions.AppMemory; type SessionMemory = SharedTypeDefinitions.SessionMemory; type WorktreeMemory = SharedTypeDefinitions.WorktreeMemory; type HostMemory = SharedTypeDefinitions.HostMemory; type MemorySnapshot = SharedTypeDefinitions.MemorySnapshot;

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

