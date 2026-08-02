import type * as ApiExternal from "./api-types-external"
import type * as ApiFacade from "./api-types"
type CreateHostedReviewArgs = ApiExternal.CreateHostedReviewArgs; type CreateHostedReviewResult = ApiExternal.CreateHostedReviewResult; type HostedReviewCreationEligibility = ApiExternal.HostedReviewCreationEligibility; type HostedReviewCreationEligibilityArgs = ApiExternal.HostedReviewCreationEligibilityArgs; type HostedReviewForBranchArgs = ApiExternal.HostedReviewForBranchArgs; type HostedReviewInfo = ApiExternal.HostedReviewInfo; type HostedReviewProvider = ApiExternal.HostedReviewProvider; type NativeFileDropPayload = ApiExternal.NativeFileDropPayload; type BrowserFindSource = ApiExternal.BrowserFindSource; type DashboardSnapshot = ApiExternal.DashboardSnapshot; type DashboardRevealAgentArgs = ApiExternal.DashboardRevealAgentArgs; type TerminalPreviewConnectResult = ApiExternal.TerminalPreviewConnectResult; type TerminalPreviewDataPayload = ApiExternal.TerminalPreviewDataPayload; type TerminalTabCloseRequest = ApiExternal.TerminalTabCloseRequest; type TerminalTabCloseResponse = ApiExternal.TerminalTabCloseResponse; type TerminalTabCreateReply = ApiExternal.TerminalTabCreateReply; type LocalLogTailChangedPayload = ApiExternal.LocalLogTailChangedPayload; type LocalLogTailReadArgs = ApiExternal.LocalLogTailReadArgs; type LocalLogTailReadResult = ApiExternal.LocalLogTailReadResult; type LocalLogTailWatchArgs = ApiExternal.LocalLogTailWatchArgs; type ReadClipboardTextOptions = ApiExternal.ReadClipboardTextOptions; type ReleaseChannel = ApiExternal.ReleaseChannel; type HostQualifiedDetectedWorktreeResult = ApiExternal.HostQualifiedDetectedWorktreeResult; type LegacyDetectedWorktreeRequest = ApiExternal.LegacyDetectedWorktreeRequest; type ListDetectedWorktreesArgs = ApiExternal.ListDetectedWorktreesArgs; type ProviderRequestId = ApiExternal.ProviderRequestId; type HostRepoCatalogSnapshot = ApiExternal.HostRepoCatalogSnapshot; type ListReposForExecutionHostArgs = ApiExternal.ListReposForExecutionHostArgs; type HostLineageSnapshot = ApiExternal.HostLineageSnapshot; type ListDesktopLineageForHostArgs = ApiExternal.ListDesktopLineageForHostArgs; type MobileRelayStatus = ApiExternal.MobileRelayStatus; type MobilePairingConnectionMode = ApiExternal.MobilePairingConnectionMode; type MobileRelayMintFailure = ApiExternal.MobileRelayMintFailure; type VerifyAndAddRuntimeEnvironmentResult = ApiExternal.VerifyAndAddRuntimeEnvironmentResult; type SshMutationExpectation = ApiExternal.SshMutationExpectation; type SshConnectionState = ApiExternal.SshConnectionState; type SshConfigImportResult = ApiExternal.SshConfigImportResult; type SshTargetAddResult = ApiExternal.SshTargetAddResult; type SshTarget = ApiExternal.SshTarget; type PortForwardEntry = ApiExternal.PortForwardEntry; type EnrichedDetectedPort = ApiExternal.EnrichedDetectedPort; type CreateLocalOrcaProfileArgs = ApiExternal.CreateLocalOrcaProfileArgs; type CreateLocalOrcaProfileResult = ApiExternal.CreateLocalOrcaProfileResult; type CreateCloudLinkedOrcaProfileArgs = ApiExternal.CreateCloudLinkedOrcaProfileArgs; type CreateCloudLinkedOrcaProfileResult = ApiExternal.CreateCloudLinkedOrcaProfileResult; type ConnectCurrentOrcaProfileResult = ApiExternal.ConnectCurrentOrcaProfileResult; type FindOrcaProfileProjectsByPathArgs = ApiExternal.FindOrcaProfileProjectsByPathArgs; type FindOrcaProfileProjectsByPathResult = ApiExternal.FindOrcaProfileProjectsByPathResult; type OrcaProfileListResult = ApiExternal.OrcaProfileListResult; type OrcaProfileAuthStatus = ApiExternal.OrcaProfileAuthStatus; type RefreshCurrentOrcaProfileAuthResult = ApiExternal.RefreshCurrentOrcaProfileAuthResult; type SelectOrcaProfileOrgArgs = ApiExternal.SelectOrcaProfileOrgArgs; type SelectOrcaProfileOrgResult = ApiExternal.SelectOrcaProfileOrgResult; type SignOutCurrentOrcaProfileResult = ApiExternal.SignOutCurrentOrcaProfileResult; type SwitchOrcaProfileArgs = ApiExternal.SwitchOrcaProfileArgs; type SwitchOrcaProfileResult = ApiExternal.SwitchOrcaProfileResult; type TransferOrcaProfileProjectArgs = ApiExternal.TransferOrcaProfileProjectArgs; type TransferOrcaProfileProjectResult = ApiExternal.TransferOrcaProfileProjectResult; type OrcaProfileOrgInviteRevokeArgs = ApiExternal.OrcaProfileOrgInviteRevokeArgs; type OrcaProfileOrgMemberChangeRoleArgs = ApiExternal.OrcaProfileOrgMemberChangeRoleArgs; type OrcaProfileOrgMemberInviteArgs = ApiExternal.OrcaProfileOrgMemberInviteArgs; type OrcaProfileOrgMemberMutationResult = ApiExternal.OrcaProfileOrgMemberMutationResult; type OrcaProfileOrgMemberRemoveArgs = ApiExternal.OrcaProfileOrgMemberRemoveArgs; type OrcaProfileOrgMembersListArgs = ApiExternal.OrcaProfileOrgMembersListArgs; type OrcaProfileOrgMembersListResult = ApiExternal.OrcaProfileOrgMembersListResult; type TerminalPaneSplitSource = ApiExternal.TerminalPaneSplitSource; type TaskSourceContext = ApiExternal.TaskSourceContext; type LinearIssueAttributeFilter = ApiExternal.LinearIssueAttributeFilter; type ProjectExecutionRuntimeResolution = ApiExternal.ProjectExecutionRuntimeResolution; type StartupCommandDelivery = ApiExternal.StartupCommandDelivery; type AgentProviderSessionMetadata = ApiExternal.AgentProviderSessionMetadata; type SleepingAgentLaunchConfig = ApiExternal.SleepingAgentLaunchConfig; type PluginPanelActionOutcome = ApiExternal.PluginPanelActionOutcome; type PluginPanelEntry = ApiExternal.PluginPanelEntry; type PluginConsentRequest = ApiExternal.PluginConsentRequest; type PluginLanguagePackRegistration = ApiExternal.PluginLanguagePackRegistration; type PluginChangeEvent = ApiExternal.PluginChangeEvent; type PluginMarketplaceGitSource = ApiExternal.PluginMarketplaceGitSource; type LocalhostWorktreeLabelResult = ApiExternal.LocalhostWorktreeLabelResult; type LocalhostWorktreeLabelRoute = ApiExternal.LocalhostWorktreeLabelRoute; type FolderWorkspacePathStatus = ApiExternal.FolderWorkspacePathStatus; type FolderWorkspacePathStatusRequest = ApiExternal.FolderWorkspacePathStatusRequest; type BaseRefDefaultResult = ApiExternal.BaseRefDefaultResult; type BaseRefSearchResult = ApiExternal.BaseRefSearchResult; type ClaudeRateLimitAccountsState = ApiExternal.ClaudeRateLimitAccountsState; type ClassifiedError = ApiExternal.ClassifiedError; type CodexRateLimitAccountsState = ApiExternal.CodexRateLimitAccountsState; type CreateWorktreeArgs = ApiExternal.CreateWorktreeArgs; type CreateWorktreeResult = ApiExternal.CreateWorktreeResult; type CustomPet = ApiExternal.CustomPet; type DetectedWorktreeListResult = ApiExternal.DetectedWorktreeListResult; type DirEntry = ApiExternal.DirEntry; type FilesystemPathFlavor = ApiExternal.FilesystemPathFlavor; type ForceDeleteWorktreeBranchResult = ApiExternal.ForceDeleteWorktreeBranchResult; type FsChangedPayload = ApiExternal.FsChangedPayload; type GhosttyImportPreview = ApiExternal.GhosttyImportPreview; type GlobalSettings = ApiExternal.GlobalSettings; type GitBranchCompareResult = ApiExternal.GitBranchCompareResult; type GitCommitCompareResult = ApiExternal.GitCommitCompareResult; type GitConflictOperation = ApiExternal.GitConflictOperation; type GitDiffResult = ApiExternal.GitDiffResult; type GitForkSyncExpectedUpstream = ApiExternal.GitForkSyncExpectedUpstream; type GitForkSyncResult = ApiExternal.GitForkSyncResult; type GitPushTarget = ApiExternal.GitPushTarget; type GitStagingArea = ApiExternal.GitStagingArea; type GitStatusResult = ApiExternal.GitStatusResult; type GitUpstreamStatus = ApiExternal.GitUpstreamStatus; type GitHubAssignableUser = ApiExternal.GitHubAssignableUser; type GitHubCreateIssueResult = ApiExternal.GitHubCreateIssueResult; type GitHubPRFile = ApiExternal.GitHubPRFile; type GitHubPRFileContents = ApiExternal.GitHubPRFileContents; type GitHubPrStartPoint = ApiExternal.GitHubPrStartPoint; type GitHubPRReviewCommentInput = ApiExternal.GitHubPRReviewCommentInput; type GitHubCommentResult = ApiExternal.GitHubCommentResult; type GitHubOwnerRepo = ApiExternal.GitHubOwnerRepo; type GitHubWorkItem = ApiExternal.GitHubWorkItem; type GitHubWorkItemDetails = ApiExternal.GitHubWorkItemDetails; type GitHubViewer = ApiExternal.GitHubViewer; type GitLabAssignableUser = ApiExternal.GitLabAssignableUser; type GitLabAuthDiagnostic = ApiExternal.GitLabAuthDiagnostic; type GitLabCommentResult = ApiExternal.GitLabCommentResult; type GitLabDiscussionResolveResult = ApiExternal.GitLabDiscussionResolveResult; type GitLabIssueInfo = ApiExternal.GitLabIssueInfo; type GitLabIssueUpdate = ApiExternal.GitLabIssueUpdate; type GitLabJobTraceResult = ApiExternal.GitLabJobTraceResult; type GitLabMRInlineCommentInput = ApiExternal.GitLabMRInlineCommentInput; type GitLabMRReviewersUpdateResult = ApiExternal.GitLabMRReviewersUpdateResult; type GitLabMRUpdate = ApiExternal.GitLabMRUpdate; type GitLabProjectRef = ApiExternal.GitLabProjectRef; type GitLabRetryJobResult = ApiExternal.GitLabRetryJobResult; type GitLabTodo = ApiExternal.GitLabTodo; type GitLabViewer = ApiExternal.GitLabViewer; type GitLabWorkItem = ApiExternal.GitLabWorkItem; type GitLabWorkItemDetails = ApiExternal.GitLabWorkItemDetails; type GetGitLabRateLimitResult = ApiExternal.GetGitLabRateLimitResult; type ListMergeRequestsResult = ApiExternal.ListMergeRequestsResult; type MRInfo = ApiExternal.MRInfo; type MRListState = ApiExternal.MRListState; type ListWorkItemsResult = ApiExternal.ListWorkItemsResult; type IssueInfo = ApiExternal.IssueInfo; type JiraComment = ApiExternal.JiraComment; type JiraConnectionStatus = ApiExternal.JiraConnectionStatus; type JiraCreateField = ApiExternal.JiraCreateField; type JiraCreateIssueArgs = ApiExternal.JiraCreateIssueArgs; type JiraIssue = ApiExternal.JiraIssue; type JiraIssueFilter = ApiExternal.JiraIssueFilter; type JiraIssueType = ApiExternal.JiraIssueType; type JiraProjectStatusOrder = ApiExternal.JiraProjectStatusOrder; type JiraIssueUpdate = ApiExternal.JiraIssueUpdate; type JiraPriority = ApiExternal.JiraPriority; type JiraProject = ApiExternal.JiraProject; type JiraSiteSelection = ApiExternal.JiraSiteSelection; type JiraTransition = ApiExternal.JiraTransition; type JiraUser = ApiExternal.JiraUser; type JiraViewer = ApiExternal.JiraViewer; type LinearViewer = ApiExternal.LinearViewer; type LinearCollectionResult = ApiExternal.LinearCollectionResult; type LinearConnectionStatus = ApiExternal.LinearConnectionStatus; type LinearCustomViewModel = ApiExternal.LinearCustomViewModel; type LinearCustomViewSummary = ApiExternal.LinearCustomViewSummary; type LinearWorkspaceSelection = ApiExternal.LinearWorkspaceSelection; type LinearIssue = ApiExternal.LinearIssue; type LinearIssueUpdate = ApiExternal.LinearIssueUpdate; type LinearComment = ApiExternal.LinearComment; type LinearWorkflowState = ApiExternal.LinearWorkflowState; type LinearLabel = ApiExternal.LinearLabel; type LinearMember = ApiExternal.LinearMember; type LinearProjectDetail = ApiExternal.LinearProjectDetail; type LinearProjectSummary = ApiExternal.LinearProjectSummary; type LinearTeam = ApiExternal.LinearTeam; type MarkdownDocument = ApiExternal.MarkdownDocument; type GitHubIssueUpdate = ApiExternal.GitHubIssueUpdate; type GitHubPRRefreshCandidate = ApiExternal.GitHubPRRefreshCandidate; type GitHubPRRefreshEnqueueResult = ApiExternal.GitHubPRRefreshEnqueueResult; type GitHubPRRefreshEvent = ApiExternal.GitHubPRRefreshEvent; type GitHubPRRefreshReason = ApiExternal.GitHubPRRefreshReason; type GetRateLimitResult = ApiExternal.GetRateLimitResult; type NotificationDispatchRequest = ApiExternal.NotificationDispatchRequest; type NotificationDispatchResult = ApiExternal.NotificationDispatchResult; type NotificationDeliveryProbeResult = ApiExternal.NotificationDeliveryProbeResult; type NotificationDismissResult = ApiExternal.NotificationDismissResult; type NotificationPermissionStatusResult = ApiExternal.NotificationPermissionStatusResult; type NotificationSoundResult = ApiExternal.NotificationSoundResult; type OnboardingState = ApiExternal.OnboardingState; type OrcaHooks = ApiExternal.OrcaHooks; type PersistedUIState = ApiExternal.PersistedUIState; type PRCheckDetail = ApiExternal.PRCheckDetail; type PRCheckRunDetails = ApiExternal.PRCheckRunDetails; type PRComment = ApiExternal.PRComment; type PRInfo = ApiExternal.PRInfo; type PRRefreshOutcome = ApiExternal.PRRefreshOutcome; type Project = ApiExternal.Project; type ProjectUpdateArgs = ApiExternal.ProjectUpdateArgs; type Repo = ApiExternal.Repo; type ProjectGroup = ApiExternal.ProjectGroup; type ProjectHostSetup = ApiExternal.ProjectHostSetup; type ProjectHostSetupCreateArgs = ApiExternal.ProjectHostSetupCreateArgs; type ProjectHostSetupCreateResult = ApiExternal.ProjectHostSetupCreateResult; type ProjectHostSetupDeleteArgs = ApiExternal.ProjectHostSetupDeleteArgs; type ProjectHostSetupDeleteResult = ApiExternal.ProjectHostSetupDeleteResult; type ProjectHostSetupExistingFolderArgs = ApiExternal.ProjectHostSetupExistingFolderArgs; type ProjectHostSetupResult = ApiExternal.ProjectHostSetupResult; type ProjectHostSetupUpdateArgs = ApiExternal.ProjectHostSetupUpdateArgs; type ProjectHostSetupUpdateResult = ApiExternal.ProjectHostSetupUpdateResult; type FolderWorkspace = ApiExternal.FolderWorkspace; type ProjectGroupImportResult = ApiExternal.ProjectGroupImportResult; type ProjectGroupImportMode = ApiExternal.ProjectGroupImportMode; type SparsePreset = ApiExternal.SparsePreset; type SearchOptions = ApiExternal.SearchOptions; type NestedRepoScanResult = ApiExternal.NestedRepoScanResult; type SearchResult = ApiExternal.SearchResult; type TuiAgent = ApiExternal.TuiAgent; type ReleaseBuildListResult = ApiExternal.ReleaseBuildListResult; type UpdateCheckOptions = ApiExternal.UpdateCheckOptions; type UpdateStatus = ApiExternal.UpdateStatus; type Worktree = ApiExternal.Worktree; type WorktreeBaseStatusEvent = ApiExternal.WorktreeBaseStatusEvent; type WorktreeHeadIdentity = ApiExternal.WorktreeHeadIdentity; type WorktreeLineage = ApiExternal.WorktreeLineage; type WorkspaceLineage = ApiExternal.WorkspaceLineage; type WorktreeMeta = ApiExternal.WorktreeMeta; type WorktreeRemoteBranchConflictEvent = ApiExternal.WorktreeRemoteBranchConflictEvent; type RemoveWorktreeResult = ApiExternal.RemoveWorktreeResult; type WorktreeDefaultTabsLaunch = ApiExternal.WorktreeDefaultTabsLaunch; type WorktreeSetupLaunch = ApiExternal.WorktreeSetupLaunch; type WorktreeStartupLaunch = ApiExternal.WorktreeStartupLaunch; type WorkspaceSessionPatch = ApiExternal.WorkspaceSessionPatch; type WorkspaceSessionState = ApiExternal.WorkspaceSessionState; type PtyModelRestoreNeededEvent = ApiExternal.PtyModelRestoreNeededEvent; type PtyListedSession = ApiExternal.PtyListedSession; type PtyRendererDeliveryHealthReply = ApiExternal.PtyRendererDeliveryHealthReply; type PtyRendererDeliveryStateReport = ApiExternal.PtyRendererDeliveryStateReport; type TerminalViewAttributes = ApiExternal.TerminalViewAttributes; type PtyMainDeliveryDiagnostics = ApiExternal.PtyMainDeliveryDiagnostics; type WarpThemeImportPreview = ApiExternal.WarpThemeImportPreview; type WarpThemeImportSource = ApiExternal.WarpThemeImportSource; type SetupScriptImportCandidate = ApiExternal.SetupScriptImportCandidate; type GitHistoryOptions = ApiExternal.GitHistoryOptions; type GitHistoryResult = ApiExternal.GitHistoryResult; type PublicKnownRuntimeEnvironment = ApiExternal.PublicKnownRuntimeEnvironment; type EphemeralVmRecipeDoctorResult = ApiExternal.EphemeralVmRecipeDoctorResult; type EphemeralVmRecipeResultWarning = ApiExternal.EphemeralVmRecipeResultWarning; type EphemeralVmRuntimeRecord = ApiExternal.EphemeralVmRuntimeRecord; type RuntimeAccessGrant = ApiExternal.RuntimeAccessGrant; type RuntimeRpcResponse = ApiExternal.RuntimeRpcResponse; type ExecutionHostId = ApiExternal.ExecutionHostId; type FeatureInteractionId = ApiExternal.FeatureInteractionId; type AddIssueCommentBySlugArgs = ApiExternal.AddIssueCommentBySlugArgs; type ClearProjectItemFieldArgs = ApiExternal.ClearProjectItemFieldArgs; type DeleteIssueCommentBySlugArgs = ApiExternal.DeleteIssueCommentBySlugArgs; type GetProjectViewTableArgs = ApiExternal.GetProjectViewTableArgs; type GetProjectViewTableResult = ApiExternal.GetProjectViewTableResult; type GitHubProjectCommentMutationResult = ApiExternal.GitHubProjectCommentMutationResult; type GitHubProjectMutationResult = ApiExternal.GitHubProjectMutationResult; type ListAccessibleProjectsArgs = ApiExternal.ListAccessibleProjectsArgs; type ListAccessibleProjectsResult = ApiExternal.ListAccessibleProjectsResult; type ListAssignableUsersBySlugArgs = ApiExternal.ListAssignableUsersBySlugArgs; type ListAssignableUsersBySlugResult = ApiExternal.ListAssignableUsersBySlugResult; type ListIssueTypesBySlugArgs = ApiExternal.ListIssueTypesBySlugArgs; type ListIssueTypesBySlugResult = ApiExternal.ListIssueTypesBySlugResult; type ListLabelsBySlugArgs = ApiExternal.ListLabelsBySlugArgs; type ListLabelsBySlugResult = ApiExternal.ListLabelsBySlugResult; type ListProjectViewsArgs = ApiExternal.ListProjectViewsArgs; type ListProjectViewsResult = ApiExternal.ListProjectViewsResult; type ProjectWorkItemDetailsBySlugArgs = ApiExternal.ProjectWorkItemDetailsBySlugArgs; type ProjectWorkItemDetailsBySlugResult = ApiExternal.ProjectWorkItemDetailsBySlugResult; type ResolveProjectRefArgs = ApiExternal.ResolveProjectRefArgs; type ResolveProjectRefResult = ApiExternal.ResolveProjectRefResult; type UpdateIssueBySlugArgs = ApiExternal.UpdateIssueBySlugArgs; type UpdateIssueCommentBySlugArgs = ApiExternal.UpdateIssueCommentBySlugArgs; type UpdateIssueTypeBySlugArgs = ApiExternal.UpdateIssueTypeBySlugArgs; type UpdatePullRequestBySlugArgs = ApiExternal.UpdatePullRequestBySlugArgs; type UpdateProjectItemFieldArgs = ApiExternal.UpdateProjectItemFieldArgs; type RichMarkdownContextMenuCommandPayload = ApiExternal.RichMarkdownContextMenuCommandPayload; type ElectronAPI = ApiExternal.ElectronAPI; type CliInstallStatus = ApiExternal.CliInstallStatus; type E2EConfig = ApiExternal.E2EConfig; type AgentHookInstallStatus = ApiExternal.AgentHookInstallStatus; type CodexConfigSyncStatus = ApiExternal.CodexConfigSyncStatus; type AgentStatusClearIpcPayload = ApiExternal.AgentStatusClearIpcPayload; type AgentStatusIpcPayload = ApiExternal.AgentStatusIpcPayload; type MigrationUnsupportedPtyEntry = ApiExternal.MigrationUnsupportedPtyEntry; type AgentInterruptInferenceRequest = ApiExternal.AgentInterruptInferenceRequest; type AgentQuestionAnsweredInferenceRequest = ApiExternal.AgentQuestionAnsweredInferenceRequest; type TerminalSideEffectBatch = ApiExternal.TerminalSideEffectBatch; type RuntimeBrowserDriverState = ApiExternal.RuntimeBrowserDriverState; type RuntimeMobileSessionTabMove = ApiExternal.RuntimeMobileSessionTabMove; type RuntimeStatus = ApiExternal.RuntimeStatus; type RuntimeSyncWindowGraphResult = ApiExternal.RuntimeSyncWindowGraphResult; type RuntimeSyncWindowGraph = ApiExternal.RuntimeSyncWindowGraph; type RuntimeTerminalCreateRequestPayload = ApiExternal.RuntimeTerminalCreateRequestPayload; type RuntimeTerminalDriverState = ApiExternal.RuntimeTerminalDriverState; type RuntimeTerminalPresentation = ApiExternal.RuntimeTerminalPresentation; type CommitMessageAgentCapability = ApiExternal.CommitMessageAgentCapability; type CommitMessageModelCapability = ApiExternal.CommitMessageModelCapability; type ResolvedSourceControlAiGenerationParams = ApiExternal.ResolvedSourceControlAiGenerationParams; type SourceControlAiSettings = ApiExternal.SourceControlAiSettings; type ShellOpenExternalEditorRequest = ApiExternal.ShellOpenExternalEditorRequest; type ShellOpenExternalEditorResult = ApiExternal.ShellOpenExternalEditorResult; type ShellOpenLocalPathResult = ApiExternal.ShellOpenLocalPathResult; type SkillDiscoveryResult = ApiExternal.SkillDiscoveryResult; type SkillDiscoveryTarget = ApiExternal.SkillDiscoveryTarget; type SkillFreshnessInventory = ApiExternal.SkillFreshnessInventory; type SkillUpdateRun = ApiExternal.SkillUpdateRun; type SkillUpdateStartResult = ApiExternal.SkillUpdateStartResult; type CrashReportBreadcrumbData = ApiExternal.CrashReportBreadcrumbData; type CrashReportCopyDiagnosticsArgs = ApiExternal.CrashReportCopyDiagnosticsArgs; type CrashReportRecord = ApiExternal.CrashReportRecord; type CrashReportSubmitArgs = ApiExternal.CrashReportSubmitArgs; type CrashReportSubmitResult = ApiExternal.CrashReportSubmitResult; type ReactErrorBoundaryReportArgs = ApiExternal.ReactErrorBoundaryReportArgs; type ReactErrorBoundaryReportResult = ApiExternal.ReactErrorBoundaryReportResult; type RendererHeapStatistics = ApiExternal.RendererHeapStatistics; type RuntimeMobileMarkdownRequest = ApiExternal.RuntimeMobileMarkdownRequest; type RuntimeMobileMarkdownResponse = ApiExternal.RuntimeMobileMarkdownResponse; type DeveloperPermissionId = ApiExternal.DeveloperPermissionId; type DeveloperPermissionRequestResult = ApiExternal.DeveloperPermissionRequestResult; type DeveloperPermissionState = ApiExternal.DeveloperPermissionState; type ComputerUsePermissionId = ApiExternal.ComputerUsePermissionId; type ComputerUsePermissionResetResult = ApiExternal.ComputerUsePermissionResetResult; type ComputerUsePermissionSetupResult = ApiExternal.ComputerUsePermissionSetupResult; type ComputerUsePermissionStatusResult = ApiExternal.ComputerUsePermissionStatusResult; type CodexRateLimitResetResult = ApiExternal.CodexRateLimitResetResult; type GrokAccountStatus = ApiExternal.GrokAccountStatus; type RateLimitRuntimeTarget = ApiExternal.RateLimitRuntimeTarget; type RateLimitState = ApiExternal.RateLimitState; type SpeechErrorEvent = ApiExternal.SpeechErrorEvent; type SpeechLifecycleEvent = ApiExternal.SpeechLifecycleEvent; type SpeechModelManifest = ApiExternal.SpeechModelManifest; type SpeechModelState = ApiExternal.SpeechModelState; type SpeechTranscriptEvent = ApiExternal.SpeechTranscriptEvent; type WorkspaceSpaceAnalyzeResult = ApiExternal.WorkspaceSpaceAnalyzeResult; type WorkspaceSpaceScanProgress = ApiExternal.WorkspaceSpaceScanProgress; type WorkspacePortAdvertisedUrlChangedEvent = ApiExternal.WorkspacePortAdvertisedUrlChangedEvent; type WorkspacePortKillRequest = ApiExternal.WorkspacePortKillRequest; type WorkspacePortKillResult = ApiExternal.WorkspacePortKillResult; type WorkspacePortScanRequest = ApiExternal.WorkspacePortScanRequest; type WorkspacePortScanResult = ApiExternal.WorkspacePortScanResult; type GhAuthDiagnostic = ApiExternal.GhAuthDiagnostic; type TelemetryConsentState = ApiExternal.TelemetryConsentState; type AgentKind = ApiExternal.AgentKind; type LaunchSource = ApiExternal.LaunchSource; type RequestKind = ApiExternal.RequestKind; type AppStarSource = ApiExternal.AppStarSource; type RemoteWorkspaceChangedEvent = ApiExternal.RemoteWorkspaceChangedEvent; type RemoteWorkspaceConnectedClient = ApiExternal.RemoteWorkspaceConnectedClient; type RemoteWorkspacePatchResult = ApiExternal.RemoteWorkspacePatchResult; type RemoteWorkspaceSnapshot = ApiExternal.RemoteWorkspaceSnapshot; type Automation = ApiExternal.Automation; type AutomationCreateInput = ApiExternal.AutomationCreateInput; type AutomationDispatchRequest = ApiExternal.AutomationDispatchRequest; type AutomationDispatchResult = ApiExternal.AutomationDispatchResult; type ExternalAutomationCreateInput = ApiExternal.ExternalAutomationCreateInput; type ExternalAutomationActionInput = ApiExternal.ExternalAutomationActionInput; type ExternalAutomationManager = ApiExternal.ExternalAutomationManager; type ExternalAutomationRunsInput = ApiExternal.ExternalAutomationRunsInput; type ExternalAutomationRunsPage = ApiExternal.ExternalAutomationRunsPage; type ExternalAutomationUpdateInput = ApiExternal.ExternalAutomationUpdateInput; type AutomationRun = ApiExternal.AutomationRun; type AutomationPrecheckResult = ApiExternal.AutomationPrecheckResult; type AutomationUpdateInput = ApiExternal.AutomationUpdateInput; type WorkspaceCleanupDismissArgs = ApiExternal.WorkspaceCleanupDismissArgs; type WorkspaceCleanupLocalProcessArgs = ApiExternal.WorkspaceCleanupLocalProcessArgs; type WorkspaceCleanupLocalProcessResult = ApiExternal.WorkspaceCleanupLocalProcessResult; type WorkspaceCleanupScanArgs = ApiExternal.WorkspaceCleanupScanArgs; type WorkspaceCleanupScanProgress = ApiExternal.WorkspaceCleanupScanProgress; type WorkspaceCleanupScanResult = ApiExternal.WorkspaceCleanupScanResult; type KeybindingActionId = ApiExternal.KeybindingActionId; type KeybindingFileSnapshot = ApiExternal.KeybindingFileSnapshot; type BrowserApi = ApiFacade.BrowserApi; type EmulatorApi = ApiFacade.EmulatorApi; type PreflightApi = ApiFacade.PreflightApi; type PtyManagementApi = ApiFacade.PtyManagementApi; type ExportApi = ApiFacade.ExportApi; type StatsApi = ApiFacade.StatsApi; type DiagnosticsStatusPayload = ApiFacade.DiagnosticsStatusPayload; type DiagnosticsBundlePayload = ApiFacade.DiagnosticsBundlePayload; type DiagnosticsUploadPayload = ApiFacade.DiagnosticsUploadPayload; type MemoryApi = ApiFacade.MemoryApi; type ClaudeUsageApi = ApiFacade.ClaudeUsageApi; type CodexUsageApi = ApiFacade.CodexUsageApi; type OpenCodeUsageApi = ApiFacade.OpenCodeUsageApi; type AiVaultApi = ApiFacade.AiVaultApi; type NativeChatApi = ApiFacade.NativeChatApi; type AppApi = ApiFacade.AppApi; type PluginHostListEntry = ApiFacade.PluginHostListEntry; type PluginHostLogLine = ApiFacade.PluginHostLogLine; type PluginHostInstallSource = ApiFacade.PluginHostInstallSource; type PluginHostInstallResult = ApiFacade.PluginHostInstallResult; type PluginMarketplaceHostSourceState = ApiFacade.PluginMarketplaceHostSourceState; type PluginMarketplaceHostListing = ApiFacade.PluginMarketplaceHostListing; type PluginMarketplaceHostInstallPreview = ApiFacade.PluginMarketplaceHostInstallPreview; type RuntimeEnvironmentSubscriptionHandle = ApiFacade.RuntimeEnvironmentSubscriptionHandle;

import type { CreateHostedReviewResult, HostedReviewCreationEligibility, HostedReviewCreationEligibilityArgs, HostedReviewForBranchArgs, HostedReviewInfo, HostedReviewProvider, NativeFileDropPayload, BrowserFindSource, DashboardSnapshot, DashboardRevealAgentArgs, TerminalPreviewConnectResult, TerminalPreviewDataPayload, TerminalTabCloseRequest, TerminalTabCloseResponse, TerminalTabCreateReply, LocalLogTailChangedPayload, LocalLogTailReadArgs, LocalLogTailReadResult, LocalLogTailWatchArgs, ReadClipboardTextOptions, ReleaseChannel, HostQualifiedDetectedWorktreeResult, LegacyDetectedWorktreeRequest, ListDetectedWorktreesArgs, ProviderRequestId, HostRepoCatalogSnapshot, ListReposForExecutionHostArgs, HostLineageSnapshot, ListDesktopLineageForHostArgs, MobileRelayStatus, MobilePairingConnectionMode, MobileRelayMintFailure, VerifyAndAddRuntimeEnvironmentResult, SshMutationExpectation, SshConnectionState, SshConfigImportResult, SshTargetAddResult, SshTarget, PortForwardEntry, EnrichedDetectedPort, CreateLocalOrcaProfileArgs, CreateLocalOrcaProfileResult, CreateCloudLinkedOrcaProfileArgs, CreateCloudLinkedOrcaProfileResult, ConnectCurrentOrcaProfileResult, FindOrcaProfileProjectsByPathArgs, FindOrcaProfileProjectsByPathResult, OrcaProfileListResult, OrcaProfileAuthStatus, RefreshCurrentOrcaProfileAuthResult, SelectOrcaProfileOrgArgs, SelectOrcaProfileOrgResult, SignOutCurrentOrcaProfileResult, SwitchOrcaProfileArgs, SwitchOrcaProfileResult, TransferOrcaProfileProjectArgs, TransferOrcaProfileProjectResult, OrcaProfileOrgInviteRevokeArgs, OrcaProfileOrgMemberChangeRoleArgs, OrcaProfileOrgMemberInviteArgs, OrcaProfileOrgMemberMutationResult, OrcaProfileOrgMemberRemoveArgs, OrcaProfileOrgMembersListArgs, OrcaProfileOrgMembersListResult, TerminalPaneSplitSource, TaskSourceContext, LinearIssueAttributeFilter, ProjectExecutionRuntimeResolution, StartupCommandDelivery, AgentProviderSessionMetadata, SleepingAgentLaunchConfig, PluginPanelActionOutcome, PluginPanelEntry, PluginConsentRequest, PluginLanguagePackRegistration, PluginChangeEvent, PluginMarketplaceGitSource, LocalhostWorktreeLabelResult, LocalhostWorktreeLabelRoute, FolderWorkspacePathStatus, FolderWorkspacePathStatusRequest, BaseRefDefaultResult, BaseRefSearchResult, ClaudeRateLimitAccountsState, ClassifiedError, CodexRateLimitAccountsState, CreateWorktreeArgs, CreateWorktreeResult, CustomPet, DetectedWorktreeListResult, DirEntry, FilesystemPathFlavor, ForceDeleteWorktreeBranchResult, FsChangedPayload, GhosttyImportPreview, GlobalSettings, GitBranchCompareResult, GitCommitCompareResult, GitConflictOperation, GitDiffResult, GitForkSyncExpectedUpstream, GitForkSyncResult, GitPushTarget, GitStagingArea, GitStatusResult, GitUpstreamStatus, GitHubAssignableUser, GitHubCreateIssueResult, GitHubPRFile, GitHubPRFileContents, GitHubPrStartPoint, GitHubPRReviewCommentInput, GitHubCommentResult, GitHubOwnerRepo, GitHubWorkItem, GitHubWorkItemDetails, GitHubViewer, GitLabAssignableUser, GitLabAuthDiagnostic, GitLabCommentResult, GitLabDiscussionResolveResult, GitLabIssueInfo, GitLabIssueUpdate, GitLabJobTraceResult, GitLabMRInlineCommentInput, GitLabMRReviewersUpdateResult, GitLabMRUpdate, GitLabProjectRef, GitLabRetryJobResult, GitLabTodo, GitLabViewer, GitLabWorkItem, GitLabWorkItemDetails, GetGitLabRateLimitResult, ListMergeRequestsResult, MRInfo, MRListState, ListWorkItemsResult, IssueInfo, JiraComment, JiraConnectionStatus, JiraCreateField, JiraCreateIssueArgs, JiraIssue, JiraIssueFilter, JiraIssueType, JiraProjectStatusOrder, JiraIssueUpdate, JiraPriority, JiraProject, JiraSiteSelection, JiraTransition, JiraUser, JiraViewer, LinearViewer, LinearCollectionResult, LinearConnectionStatus, LinearCustomViewModel, LinearCustomViewSummary, LinearWorkspaceSelection, LinearIssue, LinearIssueUpdate, LinearComment, LinearWorkflowState, LinearLabel, LinearMember, LinearProjectDetail, LinearProjectSummary, LinearTeam, MarkdownDocument, GitHubIssueUpdate, GitHubPRRefreshCandidate, GitHubPRRefreshEnqueueResult, GitHubPRRefreshEvent, GitHubPRRefreshReason, GetRateLimitResult, NotificationDispatchRequest, NotificationDispatchResult, NotificationDeliveryProbeResult, NotificationDismissResult, NotificationPermissionStatusResult, NotificationSoundResult, OnboardingState, OrcaHooks, PersistedUIState, PRCheckDetail, PRCheckRunDetails, PRComment, PRInfo, PRRefreshOutcome, Project, ProjectUpdateArgs, Repo, ProjectGroup, ProjectHostSetup, ProjectHostSetupCreateArgs, ProjectHostSetupCreateResult, ProjectHostSetupDeleteArgs, ProjectHostSetupDeleteResult, ProjectHostSetupExistingFolderArgs, ProjectHostSetupResult, ProjectHostSetupUpdateArgs, ProjectHostSetupUpdateResult, FolderWorkspace, ProjectGroupImportResult, ProjectGroupImportMode, SparsePreset, SearchOptions, NestedRepoScanResult, SearchResult, TuiAgent, ReleaseBuildListResult, UpdateCheckOptions, UpdateStatus, Worktree, WorktreeBaseStatusEvent, WorktreeHeadIdentity, WorktreeLineage, WorkspaceLineage, WorktreeMeta, WorktreeRemoteBranchConflictEvent, RemoveWorktreeResult, WorktreeDefaultTabsLaunch, WorktreeSetupLaunch, WorktreeStartupLaunch, WorkspaceSessionPatch, WorkspaceSessionState, PtyModelRestoreNeededEvent, PtyListedSession, PtyRendererDeliveryHealthReply, PtyRendererDeliveryStateReport, TerminalViewAttributes, PtyMainDeliveryDiagnostics, WarpThemeImportPreview, WarpThemeImportSource, SetupScriptImportCandidate, GitHistoryOptions, GitHistoryResult, PublicKnownRuntimeEnvironment, EphemeralVmRecipeDoctorResult, EphemeralVmRecipeResultWarning, EphemeralVmRuntimeRecord, RuntimeAccessGrant, RuntimeRpcResponse, ExecutionHostId, FeatureInteractionId, AddIssueCommentBySlugArgs, ClearProjectItemFieldArgs, DeleteIssueCommentBySlugArgs, GetProjectViewTableArgs, GetProjectViewTableResult, GitHubProjectCommentMutationResult, GitHubProjectMutationResult, ListAccessibleProjectsArgs, ListAccessibleProjectsResult, ListAssignableUsersBySlugArgs, ListAssignableUsersBySlugResult, ListIssueTypesBySlugArgs, ListIssueTypesBySlugResult, ListLabelsBySlugArgs, ListLabelsBySlugResult, ListProjectViewsArgs, ListProjectViewsResult, ProjectWorkItemDetailsBySlugArgs, ProjectWorkItemDetailsBySlugResult, ResolveProjectRefArgs, ResolveProjectRefResult, UpdateIssueBySlugArgs, UpdateIssueCommentBySlugArgs, UpdateIssueTypeBySlugArgs, UpdatePullRequestBySlugArgs, UpdateProjectItemFieldArgs, RichMarkdownContextMenuCommandPayload, ElectronAPI, CliInstallStatus, E2EConfig, AgentHookInstallStatus, CodexConfigSyncStatus, AgentStatusClearIpcPayload, AgentStatusIpcPayload, MigrationUnsupportedPtyEntry, AgentInterruptInferenceRequest, AgentQuestionAnsweredInferenceRequest, TerminalSideEffectBatch, RuntimeBrowserDriverState, RuntimeMobileSessionTabMove, RuntimeStatus, RuntimeSyncWindowGraphResult, RuntimeSyncWindowGraph, RuntimeTerminalCreateRequestPayload, RuntimeTerminalDriverState, RuntimeTerminalPresentation, CommitMessageAgentCapability, CommitMessageModelCapability, ResolvedSourceControlAiGenerationParams, SourceControlAiSettings, ShellOpenExternalEditorRequest, ShellOpenExternalEditorResult, ShellOpenLocalPathResult, SkillDiscoveryResult, SkillDiscoveryTarget, SkillFreshnessInventory, SkillUpdateRun, SkillUpdateStartResult, CrashReportBreadcrumbData, CrashReportCopyDiagnosticsArgs, CrashReportRecord, CrashReportSubmitArgs, CrashReportSubmitResult, ReactErrorBoundaryReportArgs, ReactErrorBoundaryReportResult, RendererHeapStatistics, RuntimeMobileMarkdownRequest, RuntimeMobileMarkdownResponse, DeveloperPermissionId, DeveloperPermissionRequestResult, DeveloperPermissionState, ComputerUsePermissionId, ComputerUsePermissionResetResult, ComputerUsePermissionSetupResult, ComputerUsePermissionStatusResult, CodexRateLimitResetResult, GrokAccountStatus, RateLimitRuntimeTarget, RateLimitState, SpeechErrorEvent, SpeechLifecycleEvent, SpeechModelManifest, SpeechModelState, SpeechTranscriptEvent, WorkspaceSpaceAnalyzeResult, WorkspaceSpaceScanProgress, WorkspacePortAdvertisedUrlChangedEvent, WorkspacePortKillRequest, WorkspacePortKillResult, WorkspacePortScanRequest, WorkspacePortScanResult, GhAuthDiagnostic, TelemetryConsentState, AgentKind, LaunchSource, RequestKind, AppStarSource, RemoteWorkspaceChangedEvent, RemoteWorkspaceConnectedClient, RemoteWorkspacePatchResult, RemoteWorkspaceSnapshot, Automation, AutomationCreateInput, AutomationDispatchRequest, AutomationDispatchResult, ExternalAutomationCreateInput, ExternalAutomationActionInput, ExternalAutomationManager, ExternalAutomationRunsInput, ExternalAutomationRunsPage, ExternalAutomationUpdateInput, AutomationRun, AutomationPrecheckResult, AutomationUpdateInput, WorkspaceCleanupDismissArgs, WorkspaceCleanupLocalProcessArgs, WorkspaceCleanupLocalProcessResult, WorkspaceCleanupScanArgs, WorkspaceCleanupScanProgress, WorkspaceCleanupScanResult, KeybindingActionId, KeybindingFileSnapshot, BrowserApi, EmulatorApi, PreflightApi, PtyManagementApi, ExportApi, StatsApi, DiagnosticsStatusPayload, DiagnosticsBundlePayload, DiagnosticsUploadPayload, MemoryApi, ClaudeUsageApi, CodexUsageApi, OpenCodeUsageApi, AiVaultApi, NativeChatApi, AppApi, PluginHostListEntry, PluginHostLogLine, PluginHostInstallSource, PluginHostInstallResult, PluginMarketplaceHostSourceState, PluginMarketplaceHostListing, PluginMarketplaceHostInstallPreview, RuntimeEnvironmentSubscriptionHandle } from './preload-api-contract-types'
export type PreloadApiAgentHooks = {
  settings: {
    get: () => Promise<GlobalSettings>
    /** Synchronous persisted-settings read for startup decisions that can't wait for async hydration. Blocking IPC — call sparingly. */
    getSync: () => GlobalSettings | null
    set: (args: Partial<GlobalSettings>) => Promise<GlobalSettings>
    setActiveRuntimeEnvironmentPreference: (args: {
      environmentId: string | null
    }) => Promise<GlobalSettings>
    updatePRBotAuthorOverride: (args: { author: string; isBot: boolean }) => Promise<GlobalSettings>
    listFonts: () => Promise<string[]>
    previewGhosttyImport: () => Promise<GhosttyImportPreview>
    previewWarpThemeImport: (source: WarpThemeImportSource) => Promise<WarpThemeImportPreview>
    /** Subscribe to out-of-band settings updates (e.g. View > Appearance toggles) to stay in sync with main. */
    onChanged: (callback: (updates: Partial<GlobalSettings>) => void) => () => void
  }
  localhostWorktreeLabels: {
    register: (args: LocalhostWorktreeLabelRoute) => Promise<LocalhostWorktreeLabelResult>
  }
  keybindings: {
    get: () => Promise<KeybindingFileSnapshot>
    ensureFile: () => Promise<KeybindingFileSnapshot>
    setAction: (args: {
      actionId: KeybindingActionId
      bindings: string[] | null
    }) => Promise<KeybindingFileSnapshot>
    reload: () => Promise<KeybindingFileSnapshot>
    openFile: () => Promise<KeybindingFileSnapshot>
    revealFile: () => Promise<KeybindingFileSnapshot>
    onChanged: (callback: (snapshot: KeybindingFileSnapshot) => void) => () => void
  }
  codexAccounts: {
    list: () => Promise<CodexRateLimitAccountsState>
    add: (args?: {
      runtime?: 'host' | 'wsl'
      wslDistro?: string | null
    }) => Promise<CodexRateLimitAccountsState>
    reauthenticate: (args: { accountId: string }) => Promise<CodexRateLimitAccountsState>
    remove: (args: { accountId: string }) => Promise<CodexRateLimitAccountsState>
    select: (args: {
      accountId: string | null
      runtime?: 'host' | 'wsl'
      wslDistro?: string | null
    }) => Promise<CodexRateLimitAccountsState>
    /** Live PTYs whose baked CODEX_HOME still points at a deselected account. */
    listStalePanes: (args: {
      ptyIds: string[]
    }) => Promise<
      { ptyId: string; launchAccountId: string | null; activeAccountId: string | null }[]
    >
    /** The selection lane each PTY launched from, keyed by pty id; unrecorded panes are absent. */
    listRecordedPaneLanes: (args: { ptyIds: string[] }) => Promise<Record<string, string>>
    /** Drops launch records so a dismissed prompt stays dismissed across restarts. */
    forgetStalePanes: (args: { ptyIds: string[] }) => Promise<void>
  }
  claudeAccounts: {
    list: () => Promise<ClaudeRateLimitAccountsState>
    add: (args?: {
      runtime?: 'host' | 'wsl'
      wslDistro?: string | null
    }) => Promise<ClaudeRateLimitAccountsState>
    cancelPendingLogin: () => Promise<boolean>
    reauthenticate: (args: { accountId: string }) => Promise<ClaudeRateLimitAccountsState>
    remove: (args: { accountId: string }) => Promise<ClaudeRateLimitAccountsState>
    select: (args: {
      accountId: string | null
      runtime?: 'host' | 'wsl'
      wslDistro?: string | null
    }) => Promise<ClaudeRateLimitAccountsState>
  }
  cli: {
    getInstallStatus: () => Promise<CliInstallStatus>
    install: () => Promise<CliInstallStatus>
    remove: () => Promise<CliInstallStatus>
    getWslInstallStatus: (args?: { distro?: string | null }) => Promise<CliInstallStatus>
    installWsl: (args?: { distro?: string | null }) => Promise<CliInstallStatus>
    removeWsl: (args?: { distro?: string | null }) => Promise<CliInstallStatus>
  }
  codexConfigSync: {
    status: () => Promise<CodexConfigSyncStatus>
  }
  agentHooks: {
    claudeStatus: () => Promise<AgentHookInstallStatus>
    openClaudeStatus: () => Promise<AgentHookInstallStatus>
    codexStatus: () => Promise<AgentHookInstallStatus>
    geminiStatus: () => Promise<AgentHookInstallStatus>
    antigravityStatus: () => Promise<AgentHookInstallStatus>
    ampStatus: () => Promise<AgentHookInstallStatus>
    cursorStatus: () => Promise<AgentHookInstallStatus>
    droidStatus: () => Promise<AgentHookInstallStatus>
    commandCodeStatus: () => Promise<AgentHookInstallStatus>
    grokStatus: () => Promise<AgentHookInstallStatus>
    copilotStatus: () => Promise<AgentHookInstallStatus>
    hermesStatus: () => Promise<AgentHookInstallStatus>
    devinStatus: () => Promise<AgentHookInstallStatus>
  }
  agentTrust: {
    markTrusted: (args: {
      preset: 'cursor' | 'copilot' | 'codex'
      workspacePath: string
      connectionId?: string
    }) => Promise<void>
  }
  preflight: PreflightApi
  notifications: {
    dispatch: (args: NotificationDispatchRequest) => Promise<NotificationDispatchResult>
    dismiss: (ids: string[]) => Promise<NotificationDismissResult>
    openSystemSettings: () => Promise<void>
    getPermissionStatus: () => Promise<NotificationPermissionStatusResult>
    probeDelivery: (args?: { force?: boolean }) => Promise<NotificationDeliveryProbeResult>
    playSound: (options?: { force?: boolean; volume?: number }) => Promise<NotificationSoundResult>
  }
  onboarding: {
    get: () => Promise<OnboardingState>
    // Why: main merges the checklist field-by-field, so a partial checklist is fine.
    update: (
      updates: Partial<Omit<OnboardingState, 'checklist'>> & {
        checklist?: Partial<OnboardingState['checklist']>
      }
    ) => Promise<OnboardingState>
  }
  dashboard: {
    openPopout: () => Promise<void>
    publishSnapshot: (snapshot: DashboardSnapshot) => Promise<void>
    getPopoutOpen: () => Promise<boolean>
    onPopoutOpenChanged: (callback: (open: boolean) => void) => () => void
    onSnapshotRequested: (callback: () => void) => () => void
    onRevealAgent: (callback: (args: DashboardRevealAgentArgs) => void) => () => void
    onAckAgent: (callback: (paneKey: string) => void) => () => void
    requestSnapshot: () => Promise<void>
    onSnapshot: (callback: (snapshot: DashboardSnapshot) => void) => () => void
    revealAgent: (args: DashboardRevealAgentArgs) => Promise<void>
    ackAgent: (paneKey: string) => Promise<void>
  }
  terminalPreview: {
    connect: (
      ptyId: string,
      opts?: { scrollbackRows?: number }
    ) => Promise<TerminalPreviewConnectResult>
    input: (ptyId: string, data: string) => Promise<boolean>
    /** Claim the PTY grid for the preview dialog; resolves to the size actually in effect. */
    fit: (
      ptyId: string,
      cols: number,
      rows: number
    ) => Promise<{ cols: number; rows: number } | null>
    ack: (ptyId: string, bytes: number) => Promise<void>
    unsubscribe: (ptyId: string) => Promise<void>
    onData: (callback: (payload: TerminalPreviewDataPayload) => void) => () => void
  }
  macosTccPrompts: {
    /** Fires once macOS has raised its Nth consent dialog naming Orca (#9756). */
    onThreshold: (callback: (payload: { promptCount: number }) => void) => () => void
    consumePending: () => Promise<{ claimId: number; promptCount: number } | null>
    acknowledgePending: (claimId: number) => Promise<void>
    releasePending: (claimId: number) => Promise<void>
    dismiss: () => Promise<void>
  }
  developerPermissions: {
    getStatus: () => Promise<DeveloperPermissionState[]>
    request: (args: { id: DeveloperPermissionId }) => Promise<DeveloperPermissionRequestResult>
    openSettings: (args: { id: DeveloperPermissionId }) => Promise<void>
  }
  computerUsePermissions: {
    getStatus: () => Promise<ComputerUsePermissionStatusResult>
    openSetup: (args?: {
      id?: ComputerUsePermissionId
    }) => Promise<ComputerUsePermissionSetupResult>
    reset: () => Promise<ComputerUsePermissionResetResult>
  }
  shell: {
    openPath: (path: string) => Promise<void>
    openInFileManager: (path: string) => Promise<ShellOpenLocalPathResult>
    openInExternalEditor: (
      request: ShellOpenExternalEditorRequest
    ) => Promise<ShellOpenExternalEditorResult>
    openUrl: (url: string) => Promise<void>
    openFilePath: (path: string) => Promise<boolean>
    openFileUri: (uri: string) => Promise<void>
    pathExists: (path: string) => Promise<boolean>
    pickAttachment: () => Promise<string | null>
    pickImage: () => Promise<string | null>
    pickRepoIconImage: () => Promise<{ dataUrl: string; fileName: string } | null>
    pickAudio: () => Promise<string | null>
    pickDirectory: (args: { defaultPath?: string }) => Promise<string | null>
    copyFile: (args: { srcPath: string; destPath: string }) => Promise<void>
  }
  skills: {
    discover: (target?: SkillDiscoveryTarget) => Promise<SkillDiscoveryResult>
    freshnessInventory: () => Promise<SkillFreshnessInventory>
    startUpdateRun: (names: string[]) => Promise<SkillUpdateStartResult>
    cancelUpdateRun: () => Promise<void>
    acknowledgeUpdateRun: () => Promise<void>
    getUpdateRun: () => Promise<SkillUpdateRun>
    onUpdateRun: (callback: (run: SkillUpdateRun) => void) => () => void
  }
  pet: {
    import: () => Promise<CustomPet | null>
    importPetBundle: () => Promise<CustomPet | null>
    read: (id: string, fileName: string, kind?: 'image' | 'bundle') => Promise<ArrayBuffer | null>
    delete: (id: string, fileName: string, kind?: 'image' | 'bundle') => Promise<void>
  }
  browser: BrowserApi
  emulator: EmulatorApi
  hooks: {
    check: (args: { repoId: string; hostId?: ExecutionHostId }) => Promise<{
      status?: 'ok' | 'error'
      hasHooks: boolean
      hooks: OrcaHooks | null
      mayNeedUpdate: boolean
    }>
    inspectSetupScriptImports: (args: {
      repoId: string
      hostId?: ExecutionHostId
    }) => Promise<SetupScriptImportCandidate[]>
    createIssueCommandRunner: (args: {
      repoId: string
      worktreePath: string
      command: string
    }) => Promise<WorktreeSetupLaunch>
    readIssueCommand: (args: { repoId: string; hostId?: ExecutionHostId }) => Promise<{
      status?: 'ok' | 'error'
      localContent: string | null
      sharedContent: string | null
      effectiveContent: string | null
      localFilePath: string
      source: 'local' | 'shared' | 'none'
    }>
    writeIssueCommand: (args: {
      repoId: string
      content: string
      hostId?: ExecutionHostId
    }) => Promise<void>
  }
  ephemeralVm: {
    listRecipes: (args: { repoId: string }) => Promise<{
      status: 'ok' | 'error'
      repoPath: string | null
      recipes: OrcaHooks['environmentRecipes']
      diagnostics: NonNullable<OrcaHooks['environmentRecipeDiagnostics']>
      message?: string
    }>
    listRecipeCatalog: () => Promise<
      {
        repoId: string
        repoName: string
        repoPath: string
        recipes: NonNullable<OrcaHooks['environmentRecipes']>
        diagnostics: NonNullable<OrcaHooks['environmentRecipeDiagnostics']>
      }[]
    >
    doctor: (args: { repoId: string; recipeId: string }) => Promise<EphemeralVmRecipeDoctorResult>
    provision: (args: {
      repoId: string
      recipeId: string
      workspaceName?: string
      projectId?: string
      workspaceId?: string
      provisionId?: string
    }) => Promise<
      | {
          ok: true
          connectionType: 'orca-server'
          runtime: EphemeralVmRuntimeRecord
          environment: PublicKnownRuntimeEnvironment
          stderr: string
          warnings: EphemeralVmRecipeResultWarning[]
        }
      | {
          ok: true
          connectionType: 'ssh'
          runtime: EphemeralVmRuntimeRecord
          sshTargetId: string
          stderr: string
          warnings: EphemeralVmRecipeResultWarning[]
        }
      | { ok: false; error: string; stderr: string; stdout: string }
    >
    cancelProvision: (args: { provisionId: string }) => Promise<{ cancelled: boolean }>
    onProvisionEvent: (
      callback: (event: { provisionId: string; stream: 'stdout' | 'stderr'; chunk: string }) => void
    ) => () => void
    listRuntimes: () => Promise<EphemeralVmRuntimeRecord[]>
    attachWorkspace: (args: {
      runtimeId: string
      workspaceId: string
    }) => Promise<EphemeralVmRuntimeRecord>
    suspendWorkspace: (args: { workspaceId: string }) => Promise<EphemeralVmRuntimeRecord | null>
    resumeWorkspace: (args: { workspaceId: string }) => Promise<EphemeralVmRuntimeRecord | null>
    cleanup: (args: { runtimeId: string }) => Promise<EphemeralVmRuntimeRecord>
    getCleanupCommand: (args: { runtimeId: string }) => Promise<{
      runtimeId: string
      command: string | null
      payloadJson: string
      cleanupDisabled: boolean
      message?: string
    }>
  }
  cache: {
    getGitHub: () => Promise<{
      pr: Record<string, { data: PRInfo | null; fetchedAt: number }>
      issue: Record<string, { data: IssueInfo | null; fetchedAt: number }>
    }>
    setGitHub: (args: {
      cache: {
        pr: Record<string, { data: PRInfo | null; fetchedAt: number }>
        issue: Record<string, { data: IssueInfo | null; fetchedAt: number }>
      }
    }) => Promise<void>
  }
  session: {
    // hostId defaults to the 'local' partition on main, so omitting it stays backward-compatible.
    get: (hostId?: ExecutionHostId) => Promise<WorkspaceSessionState>
    set: (args: WorkspaceSessionState, hostId?: ExecutionHostId) => Promise<void>
    patch: (args: WorkspaceSessionPatch, hostId?: ExecutionHostId) => Promise<void>
    flush: () => Promise<void>
    readTerminalScrollback: (args: { ref: string }) => string | null
    setSync: (args: WorkspaceSessionState, hostId?: ExecutionHostId) => void
  }
  remoteWorkspace: {
    get: (args: { targetId: string }) => Promise<RemoteWorkspaceSnapshot | null>
    setForConnectedTargets: (args: {
      session?: WorkspaceSessionState
      hydratedTargetIds?: string[]
    }) => Promise<{ targetId: string; result: RemoteWorkspacePatchResult }[]>
    listEnabledConnectedTargets: () => Promise<string[]>
    listConnectedClients: (args?: {
      targetIds?: string[]
    }) => Promise<{ targetId: string; clients: RemoteWorkspaceConnectedClient[] }[]>
    clientId: () => Promise<string>
    onChanged: (callback: (event: RemoteWorkspaceChangedEvent) => void) => () => void
  }
  updater: {
    getVersion: () => Promise<string>
    getStatus: () => Promise<UpdateStatus>
    check: (options?: UpdateCheckOptions) => Promise<void>
    download: () => Promise<void>
    quitAndInstall: () => Promise<void>
    dismissNudge: () => Promise<void>
    dismissAvailableUpdate: () => Promise<void>
    listBuilds: (channel: ReleaseChannel) => Promise<ReleaseBuildListResult>
    onStatus: (callback: (status: UpdateStatus) => void) => () => void
    onClearDismissal: (callback: () => void) => () => void
  }
  notebook: {
    runPythonCell: (args: {
      filePath: string
      code: string
      preamble?: string
      connectionId?: string | null
    }) => Promise<{ stdout: string; stderr: string; exitCode: number | null; error?: string }>
  }
  stats: StatsApi
  memory: MemoryApi
  claudeUsage: ClaudeUsageApi
  codexUsage: CodexUsageApi
  openCodeUsage: OpenCodeUsageApi
  aiVault: AiVaultApi
  nativeChat: NativeChatApi
}
