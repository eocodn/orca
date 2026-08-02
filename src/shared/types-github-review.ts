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
type ShellHydrationFailureReason = SharedTypeDefinitions.ShellHydrationFailureReason; type PathSource = SharedTypeDefinitions.PathSource; type RepoKind = SharedTypeDefinitions.RepoKind; type IssueSourcePreference = SharedTypeDefinitions.IssueSourcePreference; type ExternalWorktreeVisibility = SharedTypeDefinitions.ExternalWorktreeVisibility; type ProjectProviderIdentity = SharedTypeDefinitions.ProjectProviderIdentity; type Project = SharedTypeDefinitions.Project; type ProjectUpdateArgs = SharedTypeDefinitions.ProjectUpdateArgs; type ProjectHostSetupState = SharedTypeDefinitions.ProjectHostSetupState; type ProjectHostSetupMethod = SharedTypeDefinitions.ProjectHostSetupMethod; type RepoProjectHostSetupMethod = SharedTypeDefinitions.RepoProjectHostSetupMethod; type ProjectHostSetup = SharedTypeDefinitions.ProjectHostSetup; type ProjectHostSetupExistingFolderArgs = SharedTypeDefinitions.ProjectHostSetupExistingFolderArgs; type ProjectHostSetupCreateArgs = SharedTypeDefinitions.ProjectHostSetupCreateArgs; type ProjectHostSetupCloneArgs = SharedTypeDefinitions.ProjectHostSetupCloneArgs; type ProjectHostSetupUpdateArgs = SharedTypeDefinitions.ProjectHostSetupUpdateArgs; type ProjectHostSetupDeleteArgs = SharedTypeDefinitions.ProjectHostSetupDeleteArgs; type ProjectHostSetupResult = SharedTypeDefinitions.ProjectHostSetupResult; type ProjectHostSetupCreateResult = SharedTypeDefinitions.ProjectHostSetupCreateResult; type ProjectHostSetupUpdateResult = SharedTypeDefinitions.ProjectHostSetupUpdateResult; type ProjectHostSetupDeleteResult = SharedTypeDefinitions.ProjectHostSetupDeleteResult; type Repo = SharedTypeDefinitions.Repo; type ProjectGroupCreatedFrom = SharedTypeDefinitions.ProjectGroupCreatedFrom; type ProjectGroup = SharedTypeDefinitions.ProjectGroup; type WorkspaceScope = SharedTypeDefinitions.WorkspaceScope; type WorkspaceKey = SharedTypeDefinitions.WorkspaceKey; type FolderWorkspace = SharedTypeDefinitions.FolderWorkspace; type WorkspaceLinkedItem = SharedTypeDefinitions.WorkspaceLinkedItem; type FolderWorkspaceLinkedTask = SharedTypeDefinitions.FolderWorkspaceLinkedTask; type NestedRepoScanOptions = SharedTypeDefinitions.NestedRepoScanOptions; type NestedRepoCandidate = SharedTypeDefinitions.NestedRepoCandidate; type NestedRepoScanResult = SharedTypeDefinitions.NestedRepoScanResult; type ProjectGroupImportMode = SharedTypeDefinitions.ProjectGroupImportMode; type ProjectGroupImportProjectResult = SharedTypeDefinitions.ProjectGroupImportProjectResult; type ProjectGroupImportResult = SharedTypeDefinitions.ProjectGroupImportResult; type SetupRunPolicy = SharedTypeDefinitions.SetupRunPolicy; type SetupAgentStartupPolicy = SharedTypeDefinitions.SetupAgentStartupPolicy; type SetupDecision = SharedTypeDefinitions.SetupDecision; type HookCommandSourcePolicy = SharedTypeDefinitions.HookCommandSourcePolicy; type BaseRefDefaultResult = SharedTypeDefinitions.BaseRefDefaultResult; type BaseRefSearchResult = SharedTypeDefinitions.BaseRefSearchResult; type GitWorktreeInfo = SharedTypeDefinitions.GitWorktreeInfo; type WorktreeHeadIdentity = SharedTypeDefinitions.WorktreeHeadIdentity; type WorkspaceStatus = SharedTypeDefinitions.WorkspaceStatus; type WorkspaceStatusDefinition = SharedTypeDefinitions.WorkspaceStatusDefinition; type Worktree = SharedTypeDefinitions.Worktree; type CliWorkspaceProvenance = SharedTypeDefinitions.CliWorkspaceProvenance; type AutomationWorkspaceProvenance = SharedTypeDefinitions.AutomationWorkspaceProvenance; type AutomationWorkspaceProvenanceRequest = SharedTypeDefinitions.AutomationWorkspaceProvenanceRequest; type GitPushTarget = SharedTypeDefinitions.GitPushTarget; type GitHubPrStartPoint = SharedTypeDefinitions.GitHubPrStartPoint; type WorktreeMeta = SharedTypeDefinitions.WorktreeMeta; type WorktreeOwnership = SharedTypeDefinitions.WorktreeOwnership; type DetectedWorktreeListSource = SharedTypeDefinitions.DetectedWorktreeListSource; type DetectedWorktree = SharedTypeDefinitions.DetectedWorktree; type DetectedWorktreeListResult = SharedTypeDefinitions.DetectedWorktreeListResult; type WorktreeLineageOrigin = SharedTypeDefinitions.WorktreeLineageOrigin; type WorktreeLineageCaptureConfidence = SharedTypeDefinitions.WorktreeLineageCaptureConfidence; type WorktreeLineageCaptureSource = SharedTypeDefinitions.WorktreeLineageCaptureSource; type WorktreeLineageCapture = SharedTypeDefinitions.WorktreeLineageCapture; type WorktreeLineage = SharedTypeDefinitions.WorktreeLineage; type WorkspaceLineage = SharedTypeDefinitions.WorkspaceLineage; type WorktreeLineageWarningCode = SharedTypeDefinitions.WorktreeLineageWarningCode; type WorktreeLineageWarning = SharedTypeDefinitions.WorktreeLineageWarning; type DiffCommentSource = SharedTypeDefinitions.DiffCommentSource; type DiffReviewScope = SharedTypeDefinitions.DiffReviewScope; type MobileDiffReviewFileState = SharedTypeDefinitions.MobileDiffReviewFileState; type MobileDiffReviewState = SharedTypeDefinitions.MobileDiffReviewState; type DiffComment = SharedTypeDefinitions.DiffComment; type TabGroupSplitDirection = SharedTypeDefinitions.TabGroupSplitDirection; type TabGroupLayoutNode = SharedTypeDefinitions.TabGroupLayoutNode; type TabContentType = SharedTypeDefinitions.TabContentType; type WorkspaceVisibleTabType = SharedTypeDefinitions.WorkspaceVisibleTabType; type CtrlTabOrderMode = SharedTypeDefinitions.CtrlTabOrderMode; type Tab = SharedTypeDefinitions.Tab; type TabGroup = SharedTypeDefinitions.TabGroup; type TerminalTab = SharedTypeDefinitions.TerminalTab; type BrowserHistoryEntry = SharedTypeDefinitions.BrowserHistoryEntry; type BrowserLoadError = SharedTypeDefinitions.BrowserLoadError; type BrowserCertificateFailure = SharedTypeDefinitions.BrowserCertificateFailure; type BrowserCertificateProceedFailureReason = SharedTypeDefinitions.BrowserCertificateProceedFailureReason; type BrowserCertificateProceedResult = SharedTypeDefinitions.BrowserCertificateProceedResult; type BrowserViewportPresetId = SharedTypeDefinitions.BrowserViewportPresetId; type BrowserViewportOverride = SharedTypeDefinitions.BrowserViewportOverride; type BrowserPage = SharedTypeDefinitions.BrowserPage; type BrowserWorkspace = SharedTypeDefinitions.BrowserWorkspace; type BrowserTab = SharedTypeDefinitions.BrowserTab; type BrowserSessionProfileScope = SharedTypeDefinitions.BrowserSessionProfileScope; type BrowserSessionProfileSource = SharedTypeDefinitions.BrowserSessionProfileSource; type BrowserSessionProfile = SharedTypeDefinitions.BrowserSessionProfile; type BrowserCookieImportSummary = SharedTypeDefinitions.BrowserCookieImportSummary; type BrowserCookieImportResult = SharedTypeDefinitions.BrowserCookieImportResult; type TerminalPaneSplitDirection = SharedTypeDefinitions.TerminalPaneSplitDirection; type TerminalPaneLayoutNode = SharedTypeDefinitions.TerminalPaneLayoutNode; type TerminalLayoutSnapshot = SharedTypeDefinitions.TerminalLayoutSnapshot; type PersistedOpenFile = SharedTypeDefinitions.PersistedOpenFile; type WorkspaceSessionState = SharedTypeDefinitions.WorkspaceSessionState; type WorkspaceSessionPatch = SharedTypeDefinitions.WorkspaceSessionPatch; type LinearViewer = SharedTypeDefinitions.LinearViewer; type LinearWorkspace = SharedTypeDefinitions.LinearWorkspace; type LinearWorkspaceSelection = SharedTypeDefinitions.LinearWorkspaceSelection; type LinearWorkspaceSelector = SharedTypeDefinitions.LinearWorkspaceSelector; type LinearConcreteWorkspaceId = SharedTypeDefinitions.LinearConcreteWorkspaceId; type LinearWorkspaceError = SharedTypeDefinitions.LinearWorkspaceError; type LinearCollectionResult = SharedTypeDefinitions.LinearCollectionResult; type LinearConnectionStatus = SharedTypeDefinitions.LinearConnectionStatus; type LinearIssue = SharedTypeDefinitions.LinearIssue; type LinearProjectSummary = SharedTypeDefinitions.LinearProjectSummary; type LinearProjectStatusSummary = SharedTypeDefinitions.LinearProjectStatusSummary; type LinearProjectMemberSummary = SharedTypeDefinitions.LinearProjectMemberSummary; type LinearProjectMilestoneSummary = SharedTypeDefinitions.LinearProjectMilestoneSummary; type LinearProjectResourceSummary = SharedTypeDefinitions.LinearProjectResourceSummary; type LinearProjectUpdateSummary = SharedTypeDefinitions.LinearProjectUpdateSummary; type LinearProjectDetail = SharedTypeDefinitions.LinearProjectDetail; type LinearCustomViewModel = SharedTypeDefinitions.LinearCustomViewModel; type LinearCustomViewSummary = SharedTypeDefinitions.LinearCustomViewSummary; type LinearIssueChildSummary = SharedTypeDefinitions.LinearIssueChildSummary; type LinearComment = SharedTypeDefinitions.LinearComment; type GitHubCreateIssueFields = SharedTypeDefinitions.GitHubCreateIssueFields; type GitHubCreateIssueResult = SharedTypeDefinitions.GitHubCreateIssueResult; type GitHubIssueCloseReason = SharedTypeDefinitions.GitHubIssueCloseReason; type GitHubIssueUpdate = SharedTypeDefinitions.GitHubIssueUpdate; type GitHubPullRequestStateUpdate = SharedTypeDefinitions.GitHubPullRequestStateUpdate; type LinearIssueUpdate = SharedTypeDefinitions.LinearIssueUpdate; type ClassifiedError = SharedTypeDefinitions.ClassifiedError; type GitHubOwnerRepo = SharedTypeDefinitions.GitHubOwnerRepo; type GitHubRateLimitBucket = SharedTypeDefinitions.GitHubRateLimitBucket; type GitHubRateLimitSnapshot = SharedTypeDefinitions.GitHubRateLimitSnapshot; type GetRateLimitResult = SharedTypeDefinitions.GetRateLimitResult; type ListWorkItemsResult = SharedTypeDefinitions.ListWorkItemsResult; type LinearWorkflowState = SharedTypeDefinitions.LinearWorkflowState; type LinearLabel = SharedTypeDefinitions.LinearLabel; type LinearMember = SharedTypeDefinitions.LinearMember; type LinearTeam = SharedTypeDefinitions.LinearTeam; type OrcaHooks = SharedTypeDefinitions.OrcaHooks; type OrcaWorktreeDefaults = SharedTypeDefinitions.OrcaWorktreeDefaults; type OrcaDefaultTabTemplate = SharedTypeDefinitions.OrcaDefaultTabTemplate; type OrcaVmRecipe = SharedTypeDefinitions.OrcaVmRecipe; type OrcaVmRecipeDiagnostic = SharedTypeDefinitions.OrcaVmRecipeDiagnostic; type RepoHookSettings = SharedTypeDefinitions.RepoHookSettings; type WorktreeSetupLaunch = SharedTypeDefinitions.WorktreeSetupLaunch; type WorktreeStartupLaunch = SharedTypeDefinitions.WorktreeStartupLaunch; type WorktreeDefaultTabsLaunch = SharedTypeDefinitions.WorktreeDefaultTabsLaunch; type WorktreeCreateTimingPhase = SharedTypeDefinitions.WorktreeCreateTimingPhase; type WorktreeCreateTiming = SharedTypeDefinitions.WorktreeCreateTiming; type CreateSparseCheckoutRequest = SharedTypeDefinitions.CreateSparseCheckoutRequest; type SparsePreset = SharedTypeDefinitions.SparsePreset; type CreateWorktreeArgs = SharedTypeDefinitions.CreateWorktreeArgs; type CreateWorktreeResult = SharedTypeDefinitions.CreateWorktreeResult; type WorktreeCreateBaseFallback = SharedTypeDefinitions.WorktreeCreateBaseFallback; type PreservedWorktreeBranch = SharedTypeDefinitions.PreservedWorktreeBranch; type RemoveWorktreeResult = SharedTypeDefinitions.RemoveWorktreeResult; type ForceDeleteWorktreeBranchResult = SharedTypeDefinitions.ForceDeleteWorktreeBranchResult; type LocalBaseRefRefreshResult = SharedTypeDefinitions.LocalBaseRefRefreshResult; type LocalBaseRefUpdateSuggestion = SharedTypeDefinitions.LocalBaseRefUpdateSuggestion; type WorktreeBaseStatusKind = SharedTypeDefinitions.WorktreeBaseStatusKind; type WorktreeBaseStatusEvent = SharedTypeDefinitions.WorktreeBaseStatusEvent; type WorktreeRemoteBranchConflictEvent = SharedTypeDefinitions.WorktreeRemoteBranchConflictEvent; type ChangelogRelease = SharedTypeDefinitions.ChangelogRelease; type ChangelogData = SharedTypeDefinitions.ChangelogData; type UpdateCheckOptions = SharedTypeDefinitions.UpdateCheckOptions; type UpdateSource = SharedTypeDefinitions.UpdateSource; type UpdateStatus = SharedTypeDefinitions.UpdateStatus; type ReleaseBuildListResult = SharedTypeDefinitions.ReleaseBuildListResult; type NotificationSettings = SharedTypeDefinitions.NotificationSettings; type CodexManagedAccount = SharedTypeDefinitions.CodexManagedAccount; type CodexManagedAccountSummary = SharedTypeDefinitions.CodexManagedAccountSummary; type CodexSystemDefaultIdentity = SharedTypeDefinitions.CodexSystemDefaultIdentity; type CodexRateLimitAccountsState = SharedTypeDefinitions.CodexRateLimitAccountsState; type CodexManagedAccountRuntimeSelection = SharedTypeDefinitions.CodexManagedAccountRuntimeSelection; type ClaudeManagedAccount = SharedTypeDefinitions.ClaudeManagedAccount; type ClaudeManagedAccountSummary = SharedTypeDefinitions.ClaudeManagedAccountSummary; type ClaudeRateLimitAccountsState = SharedTypeDefinitions.ClaudeRateLimitAccountsState; type ClaudeManagedAccountRuntimeSelection = SharedTypeDefinitions.ClaudeManagedAccountRuntimeSelection; type TuiAgent = SharedTypeDefinitions.TuiAgent; type TaskViewPresetId = SharedTypeDefinitions.TaskViewPresetId; type SetupScriptLaunchMode = SharedTypeDefinitions.SetupScriptLaunchMode; type SetupSplitDirection = SharedTypeDefinitions.SetupSplitDirection; type TerminalColorOverrides = SharedTypeDefinitions.TerminalColorOverrides; type TerminalQuickCommandScope = SharedTypeDefinitions.TerminalQuickCommandScope; type TerminalQuickCommandAction = SharedTypeDefinitions.TerminalQuickCommandAction; type TerminalQuickCommandBase = SharedTypeDefinitions.TerminalQuickCommandBase; type TerminalCommandQuickCommand = SharedTypeDefinitions.TerminalCommandQuickCommand; type TerminalAgentQuickCommand = SharedTypeDefinitions.TerminalAgentQuickCommand; type TerminalQuickCommand = SharedTypeDefinitions.TerminalQuickCommand; type OpenInApplication = SharedTypeDefinitions.OpenInApplication; type SourceControlViewMode = SharedTypeDefinitions.SourceControlViewMode; type SourceControlGroupOrder = SharedTypeDefinitions.SourceControlGroupOrder; type LeftSidebarAppearanceMode = SharedTypeDefinitions.LeftSidebarAppearanceMode; type BranchPrefixStrategy = SharedTypeDefinitions.BranchPrefixStrategy; type FloatingTerminalCwdRequest = SharedTypeDefinitions.FloatingTerminalCwdRequest; type HostSettingOverrides = SharedTypeDefinitions.HostSettingOverrides; type AgentDashboardMode = SharedTypeDefinitions.AgentDashboardMode; type GlobalSettings = SharedTypeDefinitions.GlobalSettings; type OrcaWorkspaceLayout = SharedTypeDefinitions.OrcaWorkspaceLayout; type CommitMessageAiModelCapability = SharedTypeDefinitions.CommitMessageAiModelCapability; type CommitMessageAiSettings = SharedTypeDefinitions.CommitMessageAiSettings; type GhosttyImportPreview = SharedTypeDefinitions.GhosttyImportPreview; type DiscoveryStatusEmitted = SharedTypeDefinitions.DiscoveryStatusEmitted; type NotificationEventSource = SharedTypeDefinitions.NotificationEventSource; type NotificationDispatchRequest = SharedTypeDefinitions.NotificationDispatchRequest; type NotificationDispatchResult = SharedTypeDefinitions.NotificationDispatchResult; type NotificationDismissResult = SharedTypeDefinitions.NotificationDismissResult; type NotificationSoundResult = SharedTypeDefinitions.NotificationSoundResult; type NotificationSoundDataResult = SharedTypeDefinitions.NotificationSoundDataResult; type NotificationSoundPathResult = SharedTypeDefinitions.NotificationSoundPathResult; type OnboardingOutcome = SharedTypeDefinitions.OnboardingOutcome; type OnboardingChecklistState = SharedTypeDefinitions.OnboardingChecklistState; type OnboardingState = SharedTypeDefinitions.OnboardingState; type NotificationPermissionStatusResult = SharedTypeDefinitions.NotificationPermissionStatusResult; type NotificationDeliveryProbeResult = SharedTypeDefinitions.NotificationDeliveryProbeResult; type WorktreeCardProperty = SharedTypeDefinitions.WorktreeCardProperty; type WorktreeCardMode = SharedTypeDefinitions.WorktreeCardMode; type AgentActivityDisplayMode = SharedTypeDefinitions.AgentActivityDisplayMode; type StatusBarItem = SharedTypeDefinitions.StatusBarItem; type FloatingTerminalTriggerLocation = SharedTypeDefinitions.FloatingTerminalTriggerLocation; type TaskResumeState = SharedTypeDefinitions.TaskResumeState; type RightSidebarTab = SharedTypeDefinitions.RightSidebarTab; type ActiveRightSidebarTab = SharedTypeDefinitions.ActiveRightSidebarTab; type RightSidebarExplorerView = SharedTypeDefinitions.RightSidebarExplorerView; type ProjectOrderBy = SharedTypeDefinitions.ProjectOrderBy; type WorkspaceHostScope = SharedTypeDefinitions.WorkspaceHostScope; type VisibleWorkspaceHostIds = SharedTypeDefinitions.VisibleWorkspaceHostIds; type WorkspaceHostOrder = SharedTypeDefinitions.WorkspaceHostOrder; type ManualRepoOrderEntry = SharedTypeDefinitions.ManualRepoOrderEntry; type TopLevelView = SharedTypeDefinitions.TopLevelView; type PersistedUIState = SharedTypeDefinitions.PersistedUIState; type CustomPet = SharedTypeDefinitions.CustomPet; type SpriteAnimation = SharedTypeDefinitions.SpriteAnimation; type PersistedTrustedOrcaHookEntry = SharedTypeDefinitions.PersistedTrustedOrcaHookEntry; type PersistedTrustedOrcaHookRepo = SharedTypeDefinitions.PersistedTrustedOrcaHookRepo; type PersistedTrustedOrcaHooks = SharedTypeDefinitions.PersistedTrustedOrcaHooks; type LegacyPaneKeyAliasEntry = SharedTypeDefinitions.LegacyPaneKeyAliasEntry; type PersistedMobileClientTabSelection = SharedTypeDefinitions.PersistedMobileClientTabSelection; type PersistedMobileClientTabSelections = SharedTypeDefinitions.PersistedMobileClientTabSelections; type PersistedState = SharedTypeDefinitions.PersistedState; type FilesystemPathFlavor = SharedTypeDefinitions.FilesystemPathFlavor; type DirEntry = SharedTypeDefinitions.DirEntry; type MarkdownDocument = SharedTypeDefinitions.MarkdownDocument; type FsChangeEvent = SharedTypeDefinitions.FsChangeEvent; type FsChangedPayload = SharedTypeDefinitions.FsChangedPayload; type GitBranchChangeEntry = SharedTypeDefinitions.GitBranchChangeEntry; type GitBranchCompareSummary = SharedTypeDefinitions.GitBranchCompareSummary; type GitBranchCompareResult = SharedTypeDefinitions.GitBranchCompareResult; type GitCommitCompareSummary = SharedTypeDefinitions.GitCommitCompareSummary; type GitCommitCompareResult = SharedTypeDefinitions.GitCommitCompareResult; type GitDiffTextResult = SharedTypeDefinitions.GitDiffTextResult; type GitDiffBinaryResult = SharedTypeDefinitions.GitDiffBinaryResult; type GitDiffResult = SharedTypeDefinitions.GitDiffResult; type SearchMatch = SharedTypeDefinitions.SearchMatch; type SearchFileResult = SharedTypeDefinitions.SearchFileResult; type SearchResult = SharedTypeDefinitions.SearchResult; type SearchOptions = SharedTypeDefinitions.SearchOptions; type StatsSummary = SharedTypeDefinitions.StatsSummary; type UsageValues = SharedTypeDefinitions.UsageValues; type ProcessMemoryMetric = SharedTypeDefinitions.ProcessMemoryMetric; type HostAvailableMemorySource = SharedTypeDefinitions.HostAvailableMemorySource; type AppMemory = SharedTypeDefinitions.AppMemory; type SessionMemory = SharedTypeDefinitions.SessionMemory; type WorktreeMemory = SharedTypeDefinitions.WorktreeMemory; type HostMemory = SharedTypeDefinitions.HostMemory; type MemorySnapshot = SharedTypeDefinitions.MemorySnapshot;

// ─── GitHub ──────────────────────────────────────────────────────────
export type PRState = 'open' | 'closed' | 'merged' | 'draft'
export type IssueState = 'open' | 'closed'
export type CheckStatus = 'pending' | 'success' | 'failure' | 'neutral'

export type PRMergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
export type PRReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED'

export type PRConflictSummary = {
  baseRef: string
  baseCommit: string
  commitsBehind: number
  files: string[]
  localMergeState?: 'clean'
}

// Why: host must survive renderer/RPC boundaries so Enterprise review actions
// cannot silently fall back to a same-named repository on github.com.
export type GitHubRepositoryIdentity = { owner: string; repo: string; host?: string }

export type GitHubPRMergeMethod = 'merge' | 'squash' | 'rebase'

export type GitHubPRMergeMethodSettings = {
  defaultMethod: GitHubPRMergeMethod
  allowedMethods: Record<GitHubPRMergeMethod, boolean>
}

export type PRInfo = {
  number: number
  title: string
  state: PRState
  url: string
  checksStatus: CheckStatus
  updatedAt: string
  mergeable: PRMergeableState
  reviewDecision?: PRReviewDecision | null
  autoMergeEnabled?: boolean
  autoMergeAllowed?: boolean | null
  mergeQueueRequired?: boolean | null
  mergeMethodSettings?: GitHubPRMergeMethodSettings
  mergeStateStatus?: string | null
  // Why: check-runs are keyed by the PR head commit, not the mutable branch name.
  // Keeping the head SHA in cached PR metadata lets the checks panel poll the
  // correct commit without re-querying GitHub or guessing from local branch refs.
  headSha?: string
  // Why: a merged branch-matched PR stays visible when the worktree head is one
  // of the PR's own commits (behind update-branch/web commits). Cache staleness
  // checks must honor that confirmation without re-querying GitHub.
  confirmedContainedHeadOid?: string
  // Why: the worktree HEAD OID this merged linked PR was confirmed to have
  // diverged from (a definite not-contained probe). Head-scoped, not a bare
  // boolean, so a PR-number-coalesced refresh broadcast cannot clear a sibling
  // worktree whose own head is still on the PR's line of work. Clearing a
  // durable linked PR requires this positive signal for that exact head, never
  // the mere absence of a containment confirmation after a rate-limit/error.
  headDivergedFromMergedPRAtOid?: string
  /** Target branch name for PR-created worktree compare-base repair. */
  baseRefName?: string
  /** PR head branch name. Lets linked-PR consumers detect that the worktree
   *  has switched to a different branch and the durable link is stale. */
  headRefName?: string
  prRepo?: GitHubRepositoryIdentity
  headRepo?: GitHubRepositoryIdentity
  conflictSummary?: PRConflictSummary
}

/**
 * Discriminates a classified GitHub PR-refresh failure. The renderer maps these
 * to stable, non-destructive empty-state copy; a `hard` subset (auth, permission,
 * repo_unavailable, gh_unavailable) means the existing-review lookup is currently
 * impossible and must hide the Create composer.
 */
export type PRRefreshErrorType =
  | 'rate_limited'
  | 'auth'
  | 'network'
  | 'permission'
  | 'repo_unavailable'
  | 'gh_unavailable'
  | 'server_error'
  | 'unknown'

// Backward-compatible name used by outage-copy consumers added on main.
export type PRRefreshUpstreamErrorType = PRRefreshErrorType

export type PRRefreshOutcome =
  | { kind: 'found'; pr: PRInfo; fetchedAt: number }
  | { kind: 'no-pr'; fetchedAt: number }
  | {
      kind: 'upstream-error'
      errorType: PRRefreshErrorType
      message: string
      fetchedAt: number
      // Unified retry schedule (see docs/reference/pr-panel-refresh-guidance.md).
      // `nextAutoRetryAt`: earliest time main expects to auto-retry this key.
      // `retryDisabledUntil`: earliest time a manual Retry / refreshPRNow is
      // accepted (rate-limit gates only, never ordinary network/auth backoff).
      nextAutoRetryAt?: number
      retryDisabledUntil?: number
    }

export type GitHubPRRefreshReason = 'visible' | 'active' | 'post-push' | 'manual' | 'swr'

export type GitHubPRRefreshEnqueueResult =
  | { kind: 'queued' }
  | { kind: 'skipped'; skippedReason: 'validation-denied' | 'validation-backoff' }
  | { kind: 'fallback' }

export type GitHubPRRefreshAlias = {
  cacheKey: string
  repoId?: string
  repoPath: string
  branch: string
  worktreeId?: string
  connectionId?: string | null
  executionHostId?: string | null
  linkedPRNumber?: number | null
  fallbackPRNumber?: number | null
  fallbackPRSource?: 'explicit' | 'pr-cache' | 'hosted-review' | null
  // Why: request-time worktree HEAD. Merged branch-matched PRs are only visible
  // for heads that belong to the PR, and refresh consumers need this snapshot to
  // clear a durable linked PR once main confirms the head diverged.
  currentHeadOid?: string | null
}

export type GitHubPRRefreshCandidate = GitHubPRRefreshAlias & {
  repoKind: RepoKind
  repoId: string
  isBare?: boolean
  isArchived?: boolean
  connectionId?: string | null
  executionHostId?: string | null
  connectionState?: 'connected' | 'disconnected' | 'unknown'
  cachedFetchedAt?: number | null
  cachedHasPR?: boolean | null
  cachedPRState?: PRState | null
  cachedChecksStatus?: CheckStatus | null
  cachedMergeable?: PRMergeableState | null
  cachedMergeStateStatus?: string | null
  localGitOptions?: { wslDistro?: string }
}

export type GitHubPRRefreshSkippedReason =
  | 'fresh'
  | 'not-git'
  | 'bare'
  | 'archived'
  | 'disconnected'
  | 'remote'
  | 'rate-limit'
  | 'capacity'

type GitHubPRRefreshEventBase = {
  sequence: number
  reason: GitHubPRRefreshReason
  aliases: GitHubPRRefreshAlias[]
  requestStartedAt?: number
}

export type GitHubPRRefreshEvent =
  | (GitHubPRRefreshEventBase & {
      outcome: PRRefreshOutcome
      status?: never
      pausedUntil?: never
      skippedReason?: never
    })
  | (GitHubPRRefreshEventBase & {
      status: 'queued' | 'in-flight'
      outcome?: never
      pausedUntil?: never
      skippedReason?: never
    })
  | (GitHubPRRefreshEventBase & {
      status: 'paused'
      pausedUntil: number
      skippedReason: 'rate-limit'
      outcome?: never
    })
  | (GitHubPRRefreshEventBase & {
      status: 'skipped'
      skippedReason: GitHubPRRefreshSkippedReason
      outcome?: never
      pausedUntil?: never
    })

export type PRCheckDetail = {
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion:
    | 'success'
    | 'failure'
    | 'cancelled'
    | 'timed_out'
    | 'neutral'
    | 'skipped'
    | 'pending'
    // Why: a check suite needing manual action (e.g. a workflow awaiting "Approve
    // and run") has no check run and is absent from statusCheckRollup, yet blocks
    // auto-merge (GitHub returns "unstable status"). Surface it as its own state.
    | 'action_required'
    | null
  url: string | null
  checkRunId?: number
  workflowRunId?: number
}

export type PRCheckAnnotation = {
  path: string | null
  startLine: number | null
  endLine: number | null
  annotationLevel: string | null
  title: string | null
  message: string
  rawDetails: string | null
}

export type PRCheckStep = {
  name: string
  status: string | null
  conclusion: string | null
  startedAt: string | null
  completedAt: string | null
}

export type PRCheckJob = {
  id: number | null
  name: string
  status: string | null
  conclusion: string | null
  startedAt: string | null
  completedAt: string | null
  url: string | null
  logTail: string | null
  steps: PRCheckStep[]
}

export type PRCheckRunDetails = {
  name: string
  status: PRCheckDetail['status'] | string | null
  conclusion: PRCheckDetail['conclusion'] | string | null
  url: string | null
  detailsUrl: string | null
  startedAt: string | null
  completedAt: string | null
  title: string | null
  summary: string | null
  text: string | null
  annotations: PRCheckAnnotation[]
  jobs: PRCheckJob[]
}

export type GitHubRerunPRChecksResult = { ok: true; count: number } | { ok: false; error: string }

export type GitHubReactionContent =
  | '+1'
  | '-1'
  | 'laugh'
  | 'confused'
  | 'heart'
  | 'hooray'
  | 'rocket'
  | 'eyes'

export type GitHubReaction = {
  content: GitHubReactionContent
  count: number
}

export type PRComment = {
  id: number
  author: string
  authorAvatarUrl: string
  body: string
  createdAt: string
  url: string
  reactions?: GitHubReaction[]
  /** File path for inline review comments (absent for top-level conversation comments). */
  path?: string
  /** GraphQL node ID of the review thread — present only for inline review comments.
   *  Used to resolve/unresolve the thread via GitHub's GraphQL API. */
  threadId?: string
  /** Whether the review thread has been resolved. Only meaningful when threadId is set. */
  isResolved?: boolean
  /** True when GitHub no longer maps the thread to the current diff. */
  isOutdated?: boolean
  /** End line of the review annotation (1-based). */
  line?: number
  /** Start line of the review annotation range (1-based). Absent for single-line comments. */
  startLine?: number
  /** True when GitHub identifies the author as a bot (REST `user.type === 'Bot'` or
   *  GraphQL `__typename === 'Bot'`). Preferred over login-string heuristics because
   *  third-party review bots (e.g. qodo-ai-reviewer, coderabbitai) don't follow a
   *  predictable naming convention. Absent when the data source can't report it
   *  (non-GitHub fallbacks via `gh pr view`). */
  isBot?: boolean
}

export type GitHubIssueTimelineTarget = {
  type: 'issue' | 'pr'
  number: number
  title: string
  url: string
  repository?: string
}

export type GitHubIssueTimelineItem = {
  id: string
  event:
    | 'assigned'
    | 'unassigned'
    | 'mentioned'
    | 'cross-referenced'
    | 'closed'
    | 'reopened'
    | 'moved_columns_in_project'
  actor: string
  actorAvatarUrl: string
  createdAt: string
  assignee?: string
  source?: GitHubIssueTimelineTarget
  closer?: GitHubIssueTimelineTarget
  stateReason?: string | null
  previousColumnName?: string | null
  columnName?: string | null
  projectName?: string | null
}

export type GitHubCommentResult = { ok: true; comment: PRComment } | { ok: false; error: string }

export type IssueInfo = {
  number: number
  title: string
  state: IssueState
  url: string
  labels: string[]
}

export type GitHubViewer = {
  login: string
  email: string | null
}

export type GitHubAssignableUser = {
  login: string
  name: string | null
  avatarUrl: string
}

export type ProviderCheckSummary = {
  state: 'success' | 'failure' | 'pending' | 'neutral' | 'none'
  total: number
  passed: number
  failed: number
  pending: number
  neutral: number
}

export type GitHubPRReviewSummary = {
  login: string
  state?: string | null
  avatarUrl?: string | null
}

export type GitHubPRFileViewedState = 'DISMISSED' | 'VIEWED' | 'UNVIEWED'

export type GitHubWorkItem = {
  id: string
  type: 'issue' | 'pr'
  number: number
  title: string
  state: 'open' | 'closed' | 'merged' | 'draft'
  url: string
  labels: string[]
  updatedAt: string
  author: string | null
  // Why: GHE user logins don't exist on github.com, so the github.com/{login}.png
  // fallback 404s. Carry the API-provided avatar_url so github.com + Enterprise
  // both render; absent on the gh-pr-view path (gh omits avatar), then the UI
  // falls back to the login URL and finally an initials placeholder. See #8784.
  authorAvatarUrl?: string
  branchName?: string
  baseRefName?: string
  // Why: PR checks are keyed by head commit; carrying this lets task rows use
  // the cached check-runs endpoint instead of one `gh pr checks` call per row.
  headSha?: string
  prRepo?: GitHubRepositoryIdentity
  additions?: number
  deletions?: number
  changedFiles?: number
  reviewDecision?: PRReviewDecision | null
  reviewRequests?: GitHubAssignableUser[]
  latestReviews?: GitHubPRReviewSummary[]
  assignees?: GitHubAssignableUser[]
  checksSummary?: ProviderCheckSummary
  mergeable?: PRMergeableState
  autoMergeEnabled?: boolean
  autoMergeAllowed?: boolean | null
  mergeQueueRequired?: boolean | null
  mergeMethodSettings?: GitHubPRMergeMethodSettings
  mergeStateStatus?: string | null
  maintainerCanModify?: boolean
  // Why: true when a PR's head lives on a fork (headRepositoryOwner !== selected repo owner).
  // The Start-from picker passes this to resolvePrBase so fork heads use
  // refs/pull/<N>/head for creation and a separate PR-head push target.
  isCrossRepository?: boolean
  /** Why: required because the cross-repo view merges items from every selected
   *  repo — the table row's repo pill and the "open in browser" fallback need
   *  to know which repo an item came from. Stamped by the renderer fetcher
   *  (`fetchWorkItems`) and by optimistic stubs on the new-issue path. */
  repoId: string
}

export type GitHubPRFile = {
  path: string
  oldPath?: string
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged'
  additions: number
  deletions: number
  /** GitHub marks files above its diff size limit as binary-like; we skip content fetches for these. */
  isBinary: boolean
  /** Modified-side line numbers that GitHub accepts for inline review comments. */
  reviewCommentLineNumbers?: number[]
  /** GitHub's per-viewer review state. DISMISSED means new changes arrived after the file was viewed. */
  viewerViewedState?: GitHubPRFileViewedState
}

export type GitHubPRFileContents = {
  original: string
  modified: string
  originalIsBinary: boolean
  modifiedIsBinary: boolean
  originalTooLarge?: boolean
  modifiedTooLarge?: boolean
}

export type GitHubPRReviewCommentInput = {
  repoPath: string
  prRepo?: GitHubRepositoryIdentity | null
  prNumber: number
  commitId: string
  path: string
  line: number
  startLine?: number
  body: string
}

export type GitHubWorkItemDetails = {
  // Why: main-process doesn't know Orca's Repo.id, so this inner item omits
  // repoId. The renderer stamps it when routing the details through the store.
  item: Omit<GitHubWorkItem, 'repoId'>
  body: string
  comments: PRComment[]
  /** Issue-only provider activity such as assignment, references, project moves, and state changes. */
  timelineItems?: GitHubIssueTimelineItem[]
  /** Only set for PRs. Head/base SHAs used by the Files tab to fetch per-file content. */
  headSha?: string
  baseSha?: string
  /** GraphQL node ID required by GitHub's file-viewed mutations. Only set for PRs. */
  pullRequestId?: string
  checks?: PRCheckDetail[]
  files?: GitHubPRFile[]
  /** Only set for PRs. True when the file fetch failed (rate limit, auth,
   *  unresolved remote) rather than the PR genuinely having no changed files. */
  filesUnavailable?: boolean
  participants?: GitHubAssignableUser[]
  /** Logins of current assignees. Only set for issues. */
  assignees?: string[]
}

