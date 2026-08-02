import type * as ApiExternal from "./api-types-external"
import type * as ApiFacade from "./api-types"
type CreateHostedReviewArgs = ApiExternal.CreateHostedReviewArgs; type CreateHostedReviewResult = ApiExternal.CreateHostedReviewResult; type HostedReviewCreationEligibility = ApiExternal.HostedReviewCreationEligibility; type HostedReviewCreationEligibilityArgs = ApiExternal.HostedReviewCreationEligibilityArgs; type HostedReviewForBranchArgs = ApiExternal.HostedReviewForBranchArgs; type HostedReviewInfo = ApiExternal.HostedReviewInfo; type HostedReviewProvider = ApiExternal.HostedReviewProvider; type NativeFileDropPayload = ApiExternal.NativeFileDropPayload; type BrowserFindSource = ApiExternal.BrowserFindSource; type DashboardSnapshot = ApiExternal.DashboardSnapshot; type DashboardRevealAgentArgs = ApiExternal.DashboardRevealAgentArgs; type TerminalPreviewConnectResult = ApiExternal.TerminalPreviewConnectResult; type TerminalPreviewDataPayload = ApiExternal.TerminalPreviewDataPayload; type TerminalTabCloseRequest = ApiExternal.TerminalTabCloseRequest; type TerminalTabCloseResponse = ApiExternal.TerminalTabCloseResponse; type TerminalTabCreateReply = ApiExternal.TerminalTabCreateReply; type LocalLogTailChangedPayload = ApiExternal.LocalLogTailChangedPayload; type LocalLogTailReadArgs = ApiExternal.LocalLogTailReadArgs; type LocalLogTailReadResult = ApiExternal.LocalLogTailReadResult; type LocalLogTailWatchArgs = ApiExternal.LocalLogTailWatchArgs; type ReadClipboardTextOptions = ApiExternal.ReadClipboardTextOptions; type ReleaseChannel = ApiExternal.ReleaseChannel; type HostQualifiedDetectedWorktreeResult = ApiExternal.HostQualifiedDetectedWorktreeResult; type LegacyDetectedWorktreeRequest = ApiExternal.LegacyDetectedWorktreeRequest; type ListDetectedWorktreesArgs = ApiExternal.ListDetectedWorktreesArgs; type ProviderRequestId = ApiExternal.ProviderRequestId; type HostRepoCatalogSnapshot = ApiExternal.HostRepoCatalogSnapshot; type ListReposForExecutionHostArgs = ApiExternal.ListReposForExecutionHostArgs; type HostLineageSnapshot = ApiExternal.HostLineageSnapshot; type ListDesktopLineageForHostArgs = ApiExternal.ListDesktopLineageForHostArgs; type MobileRelayStatus = ApiExternal.MobileRelayStatus; type MobilePairingConnectionMode = ApiExternal.MobilePairingConnectionMode; type MobileRelayMintFailure = ApiExternal.MobileRelayMintFailure; type VerifyAndAddRuntimeEnvironmentResult = ApiExternal.VerifyAndAddRuntimeEnvironmentResult; type SshMutationExpectation = ApiExternal.SshMutationExpectation; type SshConnectionState = ApiExternal.SshConnectionState; type SshConfigImportResult = ApiExternal.SshConfigImportResult; type SshTargetAddResult = ApiExternal.SshTargetAddResult; type SshTarget = ApiExternal.SshTarget; type PortForwardEntry = ApiExternal.PortForwardEntry; type EnrichedDetectedPort = ApiExternal.EnrichedDetectedPort; type CreateLocalOrcaProfileArgs = ApiExternal.CreateLocalOrcaProfileArgs; type CreateLocalOrcaProfileResult = ApiExternal.CreateLocalOrcaProfileResult; type CreateCloudLinkedOrcaProfileArgs = ApiExternal.CreateCloudLinkedOrcaProfileArgs; type CreateCloudLinkedOrcaProfileResult = ApiExternal.CreateCloudLinkedOrcaProfileResult; type ConnectCurrentOrcaProfileResult = ApiExternal.ConnectCurrentOrcaProfileResult; type FindOrcaProfileProjectsByPathArgs = ApiExternal.FindOrcaProfileProjectsByPathArgs; type FindOrcaProfileProjectsByPathResult = ApiExternal.FindOrcaProfileProjectsByPathResult; type OrcaProfileListResult = ApiExternal.OrcaProfileListResult; type OrcaProfileAuthStatus = ApiExternal.OrcaProfileAuthStatus; type RefreshCurrentOrcaProfileAuthResult = ApiExternal.RefreshCurrentOrcaProfileAuthResult; type SelectOrcaProfileOrgArgs = ApiExternal.SelectOrcaProfileOrgArgs; type SelectOrcaProfileOrgResult = ApiExternal.SelectOrcaProfileOrgResult; type SignOutCurrentOrcaProfileResult = ApiExternal.SignOutCurrentOrcaProfileResult; type SwitchOrcaProfileArgs = ApiExternal.SwitchOrcaProfileArgs; type SwitchOrcaProfileResult = ApiExternal.SwitchOrcaProfileResult; type TransferOrcaProfileProjectArgs = ApiExternal.TransferOrcaProfileProjectArgs; type TransferOrcaProfileProjectResult = ApiExternal.TransferOrcaProfileProjectResult; type OrcaProfileOrgInviteRevokeArgs = ApiExternal.OrcaProfileOrgInviteRevokeArgs; type OrcaProfileOrgMemberChangeRoleArgs = ApiExternal.OrcaProfileOrgMemberChangeRoleArgs; type OrcaProfileOrgMemberInviteArgs = ApiExternal.OrcaProfileOrgMemberInviteArgs; type OrcaProfileOrgMemberMutationResult = ApiExternal.OrcaProfileOrgMemberMutationResult; type OrcaProfileOrgMemberRemoveArgs = ApiExternal.OrcaProfileOrgMemberRemoveArgs; type OrcaProfileOrgMembersListArgs = ApiExternal.OrcaProfileOrgMembersListArgs; type OrcaProfileOrgMembersListResult = ApiExternal.OrcaProfileOrgMembersListResult; type TerminalPaneSplitSource = ApiExternal.TerminalPaneSplitSource; type TaskSourceContext = ApiExternal.TaskSourceContext; type LinearIssueAttributeFilter = ApiExternal.LinearIssueAttributeFilter; type ProjectExecutionRuntimeResolution = ApiExternal.ProjectExecutionRuntimeResolution; type StartupCommandDelivery = ApiExternal.StartupCommandDelivery; type AgentProviderSessionMetadata = ApiExternal.AgentProviderSessionMetadata; type SleepingAgentLaunchConfig = ApiExternal.SleepingAgentLaunchConfig; type PluginPanelActionOutcome = ApiExternal.PluginPanelActionOutcome; type PluginPanelEntry = ApiExternal.PluginPanelEntry; type PluginConsentRequest = ApiExternal.PluginConsentRequest; type PluginLanguagePackRegistration = ApiExternal.PluginLanguagePackRegistration; type PluginChangeEvent = ApiExternal.PluginChangeEvent; type PluginMarketplaceGitSource = ApiExternal.PluginMarketplaceGitSource; type LocalhostWorktreeLabelResult = ApiExternal.LocalhostWorktreeLabelResult; type LocalhostWorktreeLabelRoute = ApiExternal.LocalhostWorktreeLabelRoute; type FolderWorkspacePathStatus = ApiExternal.FolderWorkspacePathStatus; type FolderWorkspacePathStatusRequest = ApiExternal.FolderWorkspacePathStatusRequest; type BaseRefDefaultResult = ApiExternal.BaseRefDefaultResult; type BaseRefSearchResult = ApiExternal.BaseRefSearchResult; type ClaudeRateLimitAccountsState = ApiExternal.ClaudeRateLimitAccountsState; type ClassifiedError = ApiExternal.ClassifiedError; type CodexRateLimitAccountsState = ApiExternal.CodexRateLimitAccountsState; type CreateWorktreeArgs = ApiExternal.CreateWorktreeArgs; type CreateWorktreeResult = ApiExternal.CreateWorktreeResult; type CustomPet = ApiExternal.CustomPet; type DetectedWorktreeListResult = ApiExternal.DetectedWorktreeListResult; type DirEntry = ApiExternal.DirEntry; type FilesystemPathFlavor = ApiExternal.FilesystemPathFlavor; type ForceDeleteWorktreeBranchResult = ApiExternal.ForceDeleteWorktreeBranchResult; type FsChangedPayload = ApiExternal.FsChangedPayload; type GhosttyImportPreview = ApiExternal.GhosttyImportPreview; type GlobalSettings = ApiExternal.GlobalSettings; type GitBranchCompareResult = ApiExternal.GitBranchCompareResult; type GitCommitCompareResult = ApiExternal.GitCommitCompareResult; type GitConflictOperation = ApiExternal.GitConflictOperation; type GitDiffResult = ApiExternal.GitDiffResult; type GitForkSyncExpectedUpstream = ApiExternal.GitForkSyncExpectedUpstream; type GitForkSyncResult = ApiExternal.GitForkSyncResult; type GitPushTarget = ApiExternal.GitPushTarget; type GitStagingArea = ApiExternal.GitStagingArea; type GitStatusResult = ApiExternal.GitStatusResult; type GitUpstreamStatus = ApiExternal.GitUpstreamStatus; type GitHubAssignableUser = ApiExternal.GitHubAssignableUser; type GitHubCreateIssueResult = ApiExternal.GitHubCreateIssueResult; type GitHubPRFile = ApiExternal.GitHubPRFile; type GitHubPRFileContents = ApiExternal.GitHubPRFileContents; type GitHubPrStartPoint = ApiExternal.GitHubPrStartPoint; type GitHubPRReviewCommentInput = ApiExternal.GitHubPRReviewCommentInput; type GitHubCommentResult = ApiExternal.GitHubCommentResult; type GitHubOwnerRepo = ApiExternal.GitHubOwnerRepo; type GitHubWorkItem = ApiExternal.GitHubWorkItem; type GitHubWorkItemDetails = ApiExternal.GitHubWorkItemDetails; type GitHubViewer = ApiExternal.GitHubViewer; type GitLabAssignableUser = ApiExternal.GitLabAssignableUser; type GitLabAuthDiagnostic = ApiExternal.GitLabAuthDiagnostic; type GitLabCommentResult = ApiExternal.GitLabCommentResult; type GitLabDiscussionResolveResult = ApiExternal.GitLabDiscussionResolveResult; type GitLabIssueInfo = ApiExternal.GitLabIssueInfo; type GitLabIssueUpdate = ApiExternal.GitLabIssueUpdate; type GitLabJobTraceResult = ApiExternal.GitLabJobTraceResult; type GitLabMRInlineCommentInput = ApiExternal.GitLabMRInlineCommentInput; type GitLabMRReviewersUpdateResult = ApiExternal.GitLabMRReviewersUpdateResult; type GitLabMRUpdate = ApiExternal.GitLabMRUpdate; type GitLabProjectRef = ApiExternal.GitLabProjectRef; type GitLabRetryJobResult = ApiExternal.GitLabRetryJobResult; type GitLabTodo = ApiExternal.GitLabTodo; type GitLabViewer = ApiExternal.GitLabViewer; type GitLabWorkItem = ApiExternal.GitLabWorkItem; type GitLabWorkItemDetails = ApiExternal.GitLabWorkItemDetails; type GetGitLabRateLimitResult = ApiExternal.GetGitLabRateLimitResult; type ListMergeRequestsResult = ApiExternal.ListMergeRequestsResult; type MRInfo = ApiExternal.MRInfo; type MRListState = ApiExternal.MRListState; type ListWorkItemsResult = ApiExternal.ListWorkItemsResult; type IssueInfo = ApiExternal.IssueInfo; type JiraComment = ApiExternal.JiraComment; type JiraConnectionStatus = ApiExternal.JiraConnectionStatus; type JiraCreateField = ApiExternal.JiraCreateField; type JiraCreateIssueArgs = ApiExternal.JiraCreateIssueArgs; type JiraIssue = ApiExternal.JiraIssue; type JiraIssueFilter = ApiExternal.JiraIssueFilter; type JiraIssueType = ApiExternal.JiraIssueType; type JiraProjectStatusOrder = ApiExternal.JiraProjectStatusOrder; type JiraIssueUpdate = ApiExternal.JiraIssueUpdate; type JiraPriority = ApiExternal.JiraPriority; type JiraProject = ApiExternal.JiraProject; type JiraSiteSelection = ApiExternal.JiraSiteSelection; type JiraTransition = ApiExternal.JiraTransition; type JiraUser = ApiExternal.JiraUser; type JiraViewer = ApiExternal.JiraViewer; type LinearViewer = ApiExternal.LinearViewer; type LinearCollectionResult = ApiExternal.LinearCollectionResult; type LinearConnectionStatus = ApiExternal.LinearConnectionStatus; type LinearCustomViewModel = ApiExternal.LinearCustomViewModel; type LinearCustomViewSummary = ApiExternal.LinearCustomViewSummary; type LinearWorkspaceSelection = ApiExternal.LinearWorkspaceSelection; type LinearIssue = ApiExternal.LinearIssue; type LinearIssueUpdate = ApiExternal.LinearIssueUpdate; type LinearComment = ApiExternal.LinearComment; type LinearWorkflowState = ApiExternal.LinearWorkflowState; type LinearLabel = ApiExternal.LinearLabel; type LinearMember = ApiExternal.LinearMember; type LinearProjectDetail = ApiExternal.LinearProjectDetail; type LinearProjectSummary = ApiExternal.LinearProjectSummary; type LinearTeam = ApiExternal.LinearTeam; type MarkdownDocument = ApiExternal.MarkdownDocument; type GitHubIssueUpdate = ApiExternal.GitHubIssueUpdate; type GitHubPRRefreshCandidate = ApiExternal.GitHubPRRefreshCandidate; type GitHubPRRefreshEnqueueResult = ApiExternal.GitHubPRRefreshEnqueueResult; type GitHubPRRefreshEvent = ApiExternal.GitHubPRRefreshEvent; type GitHubPRRefreshReason = ApiExternal.GitHubPRRefreshReason; type GetRateLimitResult = ApiExternal.GetRateLimitResult; type NotificationDispatchRequest = ApiExternal.NotificationDispatchRequest; type NotificationDispatchResult = ApiExternal.NotificationDispatchResult; type NotificationDeliveryProbeResult = ApiExternal.NotificationDeliveryProbeResult; type NotificationDismissResult = ApiExternal.NotificationDismissResult; type NotificationPermissionStatusResult = ApiExternal.NotificationPermissionStatusResult; type NotificationSoundResult = ApiExternal.NotificationSoundResult; type OnboardingState = ApiExternal.OnboardingState; type OrcaHooks = ApiExternal.OrcaHooks; type PersistedUIState = ApiExternal.PersistedUIState; type PRCheckDetail = ApiExternal.PRCheckDetail; type PRCheckRunDetails = ApiExternal.PRCheckRunDetails; type PRComment = ApiExternal.PRComment; type PRInfo = ApiExternal.PRInfo; type PRRefreshOutcome = ApiExternal.PRRefreshOutcome; type Project = ApiExternal.Project; type ProjectUpdateArgs = ApiExternal.ProjectUpdateArgs; type Repo = ApiExternal.Repo; type ProjectGroup = ApiExternal.ProjectGroup; type ProjectHostSetup = ApiExternal.ProjectHostSetup; type ProjectHostSetupCreateArgs = ApiExternal.ProjectHostSetupCreateArgs; type ProjectHostSetupCreateResult = ApiExternal.ProjectHostSetupCreateResult; type ProjectHostSetupDeleteArgs = ApiExternal.ProjectHostSetupDeleteArgs; type ProjectHostSetupDeleteResult = ApiExternal.ProjectHostSetupDeleteResult; type ProjectHostSetupExistingFolderArgs = ApiExternal.ProjectHostSetupExistingFolderArgs; type ProjectHostSetupResult = ApiExternal.ProjectHostSetupResult; type ProjectHostSetupUpdateArgs = ApiExternal.ProjectHostSetupUpdateArgs; type ProjectHostSetupUpdateResult = ApiExternal.ProjectHostSetupUpdateResult; type FolderWorkspace = ApiExternal.FolderWorkspace; type ProjectGroupImportResult = ApiExternal.ProjectGroupImportResult; type ProjectGroupImportMode = ApiExternal.ProjectGroupImportMode; type SparsePreset = ApiExternal.SparsePreset; type SearchOptions = ApiExternal.SearchOptions; type NestedRepoScanResult = ApiExternal.NestedRepoScanResult; type SearchResult = ApiExternal.SearchResult; type TuiAgent = ApiExternal.TuiAgent; type ReleaseBuildListResult = ApiExternal.ReleaseBuildListResult; type UpdateCheckOptions = ApiExternal.UpdateCheckOptions; type UpdateStatus = ApiExternal.UpdateStatus; type Worktree = ApiExternal.Worktree; type WorktreeBaseStatusEvent = ApiExternal.WorktreeBaseStatusEvent; type WorktreeHeadIdentity = ApiExternal.WorktreeHeadIdentity; type WorktreeLineage = ApiExternal.WorktreeLineage; type WorkspaceLineage = ApiExternal.WorkspaceLineage; type WorktreeMeta = ApiExternal.WorktreeMeta; type WorktreeRemoteBranchConflictEvent = ApiExternal.WorktreeRemoteBranchConflictEvent; type RemoveWorktreeResult = ApiExternal.RemoveWorktreeResult; type WorktreeDefaultTabsLaunch = ApiExternal.WorktreeDefaultTabsLaunch; type WorktreeSetupLaunch = ApiExternal.WorktreeSetupLaunch; type WorktreeStartupLaunch = ApiExternal.WorktreeStartupLaunch; type WorkspaceSessionPatch = ApiExternal.WorkspaceSessionPatch; type WorkspaceSessionState = ApiExternal.WorkspaceSessionState; type PtyModelRestoreNeededEvent = ApiExternal.PtyModelRestoreNeededEvent; type PtyListedSession = ApiExternal.PtyListedSession; type PtyRendererDeliveryHealthReply = ApiExternal.PtyRendererDeliveryHealthReply; type PtyRendererDeliveryStateReport = ApiExternal.PtyRendererDeliveryStateReport; type TerminalViewAttributes = ApiExternal.TerminalViewAttributes; type PtyMainDeliveryDiagnostics = ApiExternal.PtyMainDeliveryDiagnostics; type WarpThemeImportPreview = ApiExternal.WarpThemeImportPreview; type WarpThemeImportSource = ApiExternal.WarpThemeImportSource; type SetupScriptImportCandidate = ApiExternal.SetupScriptImportCandidate; type GitHistoryOptions = ApiExternal.GitHistoryOptions; type GitHistoryResult = ApiExternal.GitHistoryResult; type PublicKnownRuntimeEnvironment = ApiExternal.PublicKnownRuntimeEnvironment; type EphemeralVmRecipeDoctorResult = ApiExternal.EphemeralVmRecipeDoctorResult; type EphemeralVmRecipeResultWarning = ApiExternal.EphemeralVmRecipeResultWarning; type EphemeralVmRuntimeRecord = ApiExternal.EphemeralVmRuntimeRecord; type RuntimeAccessGrant = ApiExternal.RuntimeAccessGrant; type RuntimeRpcResponse = ApiExternal.RuntimeRpcResponse; type ExecutionHostId = ApiExternal.ExecutionHostId; type FeatureInteractionId = ApiExternal.FeatureInteractionId; type AddIssueCommentBySlugArgs = ApiExternal.AddIssueCommentBySlugArgs; type ClearProjectItemFieldArgs = ApiExternal.ClearProjectItemFieldArgs; type DeleteIssueCommentBySlugArgs = ApiExternal.DeleteIssueCommentBySlugArgs; type GetProjectViewTableArgs = ApiExternal.GetProjectViewTableArgs; type GetProjectViewTableResult = ApiExternal.GetProjectViewTableResult; type GitHubProjectCommentMutationResult = ApiExternal.GitHubProjectCommentMutationResult; type GitHubProjectMutationResult = ApiExternal.GitHubProjectMutationResult; type ListAccessibleProjectsArgs = ApiExternal.ListAccessibleProjectsArgs; type ListAccessibleProjectsResult = ApiExternal.ListAccessibleProjectsResult; type ListAssignableUsersBySlugArgs = ApiExternal.ListAssignableUsersBySlugArgs; type ListAssignableUsersBySlugResult = ApiExternal.ListAssignableUsersBySlugResult; type ListIssueTypesBySlugArgs = ApiExternal.ListIssueTypesBySlugArgs; type ListIssueTypesBySlugResult = ApiExternal.ListIssueTypesBySlugResult; type ListLabelsBySlugArgs = ApiExternal.ListLabelsBySlugArgs; type ListLabelsBySlugResult = ApiExternal.ListLabelsBySlugResult; type ListProjectViewsArgs = ApiExternal.ListProjectViewsArgs; type ListProjectViewsResult = ApiExternal.ListProjectViewsResult; type ProjectWorkItemDetailsBySlugArgs = ApiExternal.ProjectWorkItemDetailsBySlugArgs; type ProjectWorkItemDetailsBySlugResult = ApiExternal.ProjectWorkItemDetailsBySlugResult; type ResolveProjectRefArgs = ApiExternal.ResolveProjectRefArgs; type ResolveProjectRefResult = ApiExternal.ResolveProjectRefResult; type UpdateIssueBySlugArgs = ApiExternal.UpdateIssueBySlugArgs; type UpdateIssueCommentBySlugArgs = ApiExternal.UpdateIssueCommentBySlugArgs; type UpdateIssueTypeBySlugArgs = ApiExternal.UpdateIssueTypeBySlugArgs; type UpdatePullRequestBySlugArgs = ApiExternal.UpdatePullRequestBySlugArgs; type UpdateProjectItemFieldArgs = ApiExternal.UpdateProjectItemFieldArgs; type RichMarkdownContextMenuCommandPayload = ApiExternal.RichMarkdownContextMenuCommandPayload; type ElectronAPI = ApiExternal.ElectronAPI; type CliInstallStatus = ApiExternal.CliInstallStatus; type E2EConfig = ApiExternal.E2EConfig; type AgentHookInstallStatus = ApiExternal.AgentHookInstallStatus; type CodexConfigSyncStatus = ApiExternal.CodexConfigSyncStatus; type AgentStatusClearIpcPayload = ApiExternal.AgentStatusClearIpcPayload; type AgentStatusIpcPayload = ApiExternal.AgentStatusIpcPayload; type MigrationUnsupportedPtyEntry = ApiExternal.MigrationUnsupportedPtyEntry; type AgentInterruptInferenceRequest = ApiExternal.AgentInterruptInferenceRequest; type AgentQuestionAnsweredInferenceRequest = ApiExternal.AgentQuestionAnsweredInferenceRequest; type TerminalSideEffectBatch = ApiExternal.TerminalSideEffectBatch; type RuntimeBrowserDriverState = ApiExternal.RuntimeBrowserDriverState; type RuntimeMobileSessionTabMove = ApiExternal.RuntimeMobileSessionTabMove; type RuntimeStatus = ApiExternal.RuntimeStatus; type RuntimeSyncWindowGraphResult = ApiExternal.RuntimeSyncWindowGraphResult; type RuntimeSyncWindowGraph = ApiExternal.RuntimeSyncWindowGraph; type RuntimeTerminalCreateRequestPayload = ApiExternal.RuntimeTerminalCreateRequestPayload; type RuntimeTerminalDriverState = ApiExternal.RuntimeTerminalDriverState; type RuntimeTerminalPresentation = ApiExternal.RuntimeTerminalPresentation; type CommitMessageAgentCapability = ApiExternal.CommitMessageAgentCapability; type CommitMessageModelCapability = ApiExternal.CommitMessageModelCapability; type ResolvedSourceControlAiGenerationParams = ApiExternal.ResolvedSourceControlAiGenerationParams; type SourceControlAiSettings = ApiExternal.SourceControlAiSettings; type ShellOpenExternalEditorRequest = ApiExternal.ShellOpenExternalEditorRequest; type ShellOpenExternalEditorResult = ApiExternal.ShellOpenExternalEditorResult; type ShellOpenLocalPathResult = ApiExternal.ShellOpenLocalPathResult; type SkillDiscoveryResult = ApiExternal.SkillDiscoveryResult; type SkillDiscoveryTarget = ApiExternal.SkillDiscoveryTarget; type SkillFreshnessInventory = ApiExternal.SkillFreshnessInventory; type SkillUpdateRun = ApiExternal.SkillUpdateRun; type SkillUpdateStartResult = ApiExternal.SkillUpdateStartResult; type CrashReportBreadcrumbData = ApiExternal.CrashReportBreadcrumbData; type CrashReportCopyDiagnosticsArgs = ApiExternal.CrashReportCopyDiagnosticsArgs; type CrashReportRecord = ApiExternal.CrashReportRecord; type CrashReportSubmitArgs = ApiExternal.CrashReportSubmitArgs; type CrashReportSubmitResult = ApiExternal.CrashReportSubmitResult; type ReactErrorBoundaryReportArgs = ApiExternal.ReactErrorBoundaryReportArgs; type ReactErrorBoundaryReportResult = ApiExternal.ReactErrorBoundaryReportResult; type RendererHeapStatistics = ApiExternal.RendererHeapStatistics; type RuntimeMobileMarkdownRequest = ApiExternal.RuntimeMobileMarkdownRequest; type RuntimeMobileMarkdownResponse = ApiExternal.RuntimeMobileMarkdownResponse; type DeveloperPermissionId = ApiExternal.DeveloperPermissionId; type DeveloperPermissionRequestResult = ApiExternal.DeveloperPermissionRequestResult; type DeveloperPermissionState = ApiExternal.DeveloperPermissionState; type ComputerUsePermissionId = ApiExternal.ComputerUsePermissionId; type ComputerUsePermissionResetResult = ApiExternal.ComputerUsePermissionResetResult; type ComputerUsePermissionSetupResult = ApiExternal.ComputerUsePermissionSetupResult; type ComputerUsePermissionStatusResult = ApiExternal.ComputerUsePermissionStatusResult; type CodexRateLimitResetResult = ApiExternal.CodexRateLimitResetResult; type GrokAccountStatus = ApiExternal.GrokAccountStatus; type RateLimitRuntimeTarget = ApiExternal.RateLimitRuntimeTarget; type RateLimitState = ApiExternal.RateLimitState; type SpeechErrorEvent = ApiExternal.SpeechErrorEvent; type SpeechLifecycleEvent = ApiExternal.SpeechLifecycleEvent; type SpeechModelManifest = ApiExternal.SpeechModelManifest; type SpeechModelState = ApiExternal.SpeechModelState; type SpeechTranscriptEvent = ApiExternal.SpeechTranscriptEvent; type WorkspaceSpaceAnalyzeResult = ApiExternal.WorkspaceSpaceAnalyzeResult; type WorkspaceSpaceScanProgress = ApiExternal.WorkspaceSpaceScanProgress; type WorkspacePortAdvertisedUrlChangedEvent = ApiExternal.WorkspacePortAdvertisedUrlChangedEvent; type WorkspacePortKillRequest = ApiExternal.WorkspacePortKillRequest; type WorkspacePortKillResult = ApiExternal.WorkspacePortKillResult; type WorkspacePortScanRequest = ApiExternal.WorkspacePortScanRequest; type WorkspacePortScanResult = ApiExternal.WorkspacePortScanResult; type GhAuthDiagnostic = ApiExternal.GhAuthDiagnostic; type TelemetryConsentState = ApiExternal.TelemetryConsentState; type AgentKind = ApiExternal.AgentKind; type LaunchSource = ApiExternal.LaunchSource; type RequestKind = ApiExternal.RequestKind; type AppStarSource = ApiExternal.AppStarSource; type RemoteWorkspaceChangedEvent = ApiExternal.RemoteWorkspaceChangedEvent; type RemoteWorkspaceConnectedClient = ApiExternal.RemoteWorkspaceConnectedClient; type RemoteWorkspacePatchResult = ApiExternal.RemoteWorkspacePatchResult; type RemoteWorkspaceSnapshot = ApiExternal.RemoteWorkspaceSnapshot; type Automation = ApiExternal.Automation; type AutomationCreateInput = ApiExternal.AutomationCreateInput; type AutomationDispatchRequest = ApiExternal.AutomationDispatchRequest; type AutomationDispatchResult = ApiExternal.AutomationDispatchResult; type ExternalAutomationCreateInput = ApiExternal.ExternalAutomationCreateInput; type ExternalAutomationActionInput = ApiExternal.ExternalAutomationActionInput; type ExternalAutomationManager = ApiExternal.ExternalAutomationManager; type ExternalAutomationRunsInput = ApiExternal.ExternalAutomationRunsInput; type ExternalAutomationRunsPage = ApiExternal.ExternalAutomationRunsPage; type ExternalAutomationUpdateInput = ApiExternal.ExternalAutomationUpdateInput; type AutomationRun = ApiExternal.AutomationRun; type AutomationPrecheckResult = ApiExternal.AutomationPrecheckResult; type AutomationUpdateInput = ApiExternal.AutomationUpdateInput; type WorkspaceCleanupDismissArgs = ApiExternal.WorkspaceCleanupDismissArgs; type WorkspaceCleanupLocalProcessArgs = ApiExternal.WorkspaceCleanupLocalProcessArgs; type WorkspaceCleanupLocalProcessResult = ApiExternal.WorkspaceCleanupLocalProcessResult; type WorkspaceCleanupScanArgs = ApiExternal.WorkspaceCleanupScanArgs; type WorkspaceCleanupScanProgress = ApiExternal.WorkspaceCleanupScanProgress; type WorkspaceCleanupScanResult = ApiExternal.WorkspaceCleanupScanResult; type KeybindingActionId = ApiExternal.KeybindingActionId; type KeybindingFileSnapshot = ApiExternal.KeybindingFileSnapshot; type BrowserApi = ApiFacade.BrowserApi; type EmulatorApi = ApiFacade.EmulatorApi; type PreflightApi = ApiFacade.PreflightApi; type PtyManagementApi = ApiFacade.PtyManagementApi; type ExportApi = ApiFacade.ExportApi; type StatsApi = ApiFacade.StatsApi; type DiagnosticsStatusPayload = ApiFacade.DiagnosticsStatusPayload; type DiagnosticsBundlePayload = ApiFacade.DiagnosticsBundlePayload; type DiagnosticsUploadPayload = ApiFacade.DiagnosticsUploadPayload; type MemoryApi = ApiFacade.MemoryApi; type ClaudeUsageApi = ApiFacade.ClaudeUsageApi; type CodexUsageApi = ApiFacade.CodexUsageApi; type OpenCodeUsageApi = ApiFacade.OpenCodeUsageApi; type AiVaultApi = ApiFacade.AiVaultApi; type NativeChatApi = ApiFacade.NativeChatApi; type AppApi = ApiFacade.AppApi; type PluginHostListEntry = ApiFacade.PluginHostListEntry; type PluginHostLogLine = ApiFacade.PluginHostLogLine; type PluginHostInstallSource = ApiFacade.PluginHostInstallSource; type PluginHostInstallResult = ApiFacade.PluginHostInstallResult; type PluginMarketplaceHostSourceState = ApiFacade.PluginMarketplaceHostSourceState; type PluginMarketplaceHostListing = ApiFacade.PluginMarketplaceHostListing; type PluginMarketplaceHostInstallPreview = ApiFacade.PluginMarketplaceHostInstallPreview; type RuntimeEnvironmentSubscriptionHandle = ApiFacade.RuntimeEnvironmentSubscriptionHandle;

import type { CreateHostedReviewResult, HostedReviewCreationEligibility, HostedReviewCreationEligibilityArgs, HostedReviewForBranchArgs, HostedReviewInfo, HostedReviewProvider, NativeFileDropPayload, BrowserFindSource, DashboardSnapshot, DashboardRevealAgentArgs, TerminalPreviewConnectResult, TerminalPreviewDataPayload, TerminalTabCloseRequest, TerminalTabCloseResponse, TerminalTabCreateReply, LocalLogTailChangedPayload, LocalLogTailReadArgs, LocalLogTailReadResult, LocalLogTailWatchArgs, ReadClipboardTextOptions, ReleaseChannel, HostQualifiedDetectedWorktreeResult, LegacyDetectedWorktreeRequest, ListDetectedWorktreesArgs, ProviderRequestId, HostRepoCatalogSnapshot, ListReposForExecutionHostArgs, HostLineageSnapshot, ListDesktopLineageForHostArgs, MobileRelayStatus, MobilePairingConnectionMode, MobileRelayMintFailure, VerifyAndAddRuntimeEnvironmentResult, SshMutationExpectation, SshConnectionState, SshConfigImportResult, SshTargetAddResult, SshTarget, PortForwardEntry, EnrichedDetectedPort, CreateLocalOrcaProfileArgs, CreateLocalOrcaProfileResult, CreateCloudLinkedOrcaProfileArgs, CreateCloudLinkedOrcaProfileResult, ConnectCurrentOrcaProfileResult, FindOrcaProfileProjectsByPathArgs, FindOrcaProfileProjectsByPathResult, OrcaProfileListResult, OrcaProfileAuthStatus, RefreshCurrentOrcaProfileAuthResult, SelectOrcaProfileOrgArgs, SelectOrcaProfileOrgResult, SignOutCurrentOrcaProfileResult, SwitchOrcaProfileArgs, SwitchOrcaProfileResult, TransferOrcaProfileProjectArgs, TransferOrcaProfileProjectResult, OrcaProfileOrgInviteRevokeArgs, OrcaProfileOrgMemberChangeRoleArgs, OrcaProfileOrgMemberInviteArgs, OrcaProfileOrgMemberMutationResult, OrcaProfileOrgMemberRemoveArgs, OrcaProfileOrgMembersListArgs, OrcaProfileOrgMembersListResult, TerminalPaneSplitSource, TaskSourceContext, LinearIssueAttributeFilter, ProjectExecutionRuntimeResolution, StartupCommandDelivery, AgentProviderSessionMetadata, SleepingAgentLaunchConfig, PluginPanelActionOutcome, PluginPanelEntry, PluginConsentRequest, PluginLanguagePackRegistration, PluginChangeEvent, PluginMarketplaceGitSource, LocalhostWorktreeLabelResult, LocalhostWorktreeLabelRoute, FolderWorkspacePathStatus, FolderWorkspacePathStatusRequest, BaseRefDefaultResult, BaseRefSearchResult, ClaudeRateLimitAccountsState, ClassifiedError, CodexRateLimitAccountsState, CreateWorktreeArgs, CreateWorktreeResult, CustomPet, DetectedWorktreeListResult, DirEntry, FilesystemPathFlavor, ForceDeleteWorktreeBranchResult, FsChangedPayload, GhosttyImportPreview, GlobalSettings, GitBranchCompareResult, GitCommitCompareResult, GitConflictOperation, GitDiffResult, GitForkSyncExpectedUpstream, GitForkSyncResult, GitPushTarget, GitStagingArea, GitStatusResult, GitUpstreamStatus, GitHubAssignableUser, GitHubCreateIssueResult, GitHubPRFile, GitHubPRFileContents, GitHubPrStartPoint, GitHubPRReviewCommentInput, GitHubCommentResult, GitHubOwnerRepo, GitHubWorkItem, GitHubWorkItemDetails, GitHubViewer, GitLabAssignableUser, GitLabAuthDiagnostic, GitLabCommentResult, GitLabDiscussionResolveResult, GitLabIssueInfo, GitLabIssueUpdate, GitLabJobTraceResult, GitLabMRInlineCommentInput, GitLabMRReviewersUpdateResult, GitLabMRUpdate, GitLabProjectRef, GitLabRetryJobResult, GitLabTodo, GitLabViewer, GitLabWorkItem, GitLabWorkItemDetails, GetGitLabRateLimitResult, ListMergeRequestsResult, MRInfo, MRListState, ListWorkItemsResult, IssueInfo, JiraComment, JiraConnectionStatus, JiraCreateField, JiraCreateIssueArgs, JiraIssue, JiraIssueFilter, JiraIssueType, JiraProjectStatusOrder, JiraIssueUpdate, JiraPriority, JiraProject, JiraSiteSelection, JiraTransition, JiraUser, JiraViewer, LinearViewer, LinearCollectionResult, LinearConnectionStatus, LinearCustomViewModel, LinearCustomViewSummary, LinearWorkspaceSelection, LinearIssue, LinearIssueUpdate, LinearComment, LinearWorkflowState, LinearLabel, LinearMember, LinearProjectDetail, LinearProjectSummary, LinearTeam, MarkdownDocument, GitHubIssueUpdate, GitHubPRRefreshCandidate, GitHubPRRefreshEnqueueResult, GitHubPRRefreshEvent, GitHubPRRefreshReason, GetRateLimitResult, NotificationDispatchRequest, NotificationDispatchResult, NotificationDeliveryProbeResult, NotificationDismissResult, NotificationPermissionStatusResult, NotificationSoundResult, OnboardingState, OrcaHooks, PersistedUIState, PRCheckDetail, PRCheckRunDetails, PRComment, PRInfo, PRRefreshOutcome, Project, ProjectUpdateArgs, Repo, ProjectGroup, ProjectHostSetup, ProjectHostSetupCreateArgs, ProjectHostSetupCreateResult, ProjectHostSetupDeleteArgs, ProjectHostSetupDeleteResult, ProjectHostSetupExistingFolderArgs, ProjectHostSetupResult, ProjectHostSetupUpdateArgs, ProjectHostSetupUpdateResult, FolderWorkspace, ProjectGroupImportResult, ProjectGroupImportMode, SparsePreset, SearchOptions, NestedRepoScanResult, SearchResult, TuiAgent, ReleaseBuildListResult, UpdateCheckOptions, UpdateStatus, Worktree, WorktreeBaseStatusEvent, WorktreeHeadIdentity, WorktreeLineage, WorkspaceLineage, WorktreeMeta, WorktreeRemoteBranchConflictEvent, RemoveWorktreeResult, WorktreeDefaultTabsLaunch, WorktreeSetupLaunch, WorktreeStartupLaunch, WorkspaceSessionPatch, WorkspaceSessionState, PtyModelRestoreNeededEvent, PtyListedSession, PtyRendererDeliveryHealthReply, PtyRendererDeliveryStateReport, TerminalViewAttributes, PtyMainDeliveryDiagnostics, WarpThemeImportPreview, WarpThemeImportSource, SetupScriptImportCandidate, GitHistoryOptions, GitHistoryResult, PublicKnownRuntimeEnvironment, EphemeralVmRecipeDoctorResult, EphemeralVmRecipeResultWarning, EphemeralVmRuntimeRecord, RuntimeAccessGrant, RuntimeRpcResponse, ExecutionHostId, FeatureInteractionId, AddIssueCommentBySlugArgs, ClearProjectItemFieldArgs, DeleteIssueCommentBySlugArgs, GetProjectViewTableArgs, GetProjectViewTableResult, GitHubProjectCommentMutationResult, GitHubProjectMutationResult, ListAccessibleProjectsArgs, ListAccessibleProjectsResult, ListAssignableUsersBySlugArgs, ListAssignableUsersBySlugResult, ListIssueTypesBySlugArgs, ListIssueTypesBySlugResult, ListLabelsBySlugArgs, ListLabelsBySlugResult, ListProjectViewsArgs, ListProjectViewsResult, ProjectWorkItemDetailsBySlugArgs, ProjectWorkItemDetailsBySlugResult, ResolveProjectRefArgs, ResolveProjectRefResult, UpdateIssueBySlugArgs, UpdateIssueCommentBySlugArgs, UpdateIssueTypeBySlugArgs, UpdatePullRequestBySlugArgs, UpdateProjectItemFieldArgs, RichMarkdownContextMenuCommandPayload, ElectronAPI, CliInstallStatus, E2EConfig, AgentHookInstallStatus, CodexConfigSyncStatus, AgentStatusClearIpcPayload, AgentStatusIpcPayload, MigrationUnsupportedPtyEntry, AgentInterruptInferenceRequest, AgentQuestionAnsweredInferenceRequest, TerminalSideEffectBatch, RuntimeBrowserDriverState, RuntimeMobileSessionTabMove, RuntimeStatus, RuntimeSyncWindowGraphResult, RuntimeSyncWindowGraph, RuntimeTerminalCreateRequestPayload, RuntimeTerminalDriverState, RuntimeTerminalPresentation, CommitMessageAgentCapability, CommitMessageModelCapability, ResolvedSourceControlAiGenerationParams, SourceControlAiSettings, ShellOpenExternalEditorRequest, ShellOpenExternalEditorResult, ShellOpenLocalPathResult, SkillDiscoveryResult, SkillDiscoveryTarget, SkillFreshnessInventory, SkillUpdateRun, SkillUpdateStartResult, CrashReportBreadcrumbData, CrashReportCopyDiagnosticsArgs, CrashReportRecord, CrashReportSubmitArgs, CrashReportSubmitResult, ReactErrorBoundaryReportArgs, ReactErrorBoundaryReportResult, RendererHeapStatistics, RuntimeMobileMarkdownRequest, RuntimeMobileMarkdownResponse, DeveloperPermissionId, DeveloperPermissionRequestResult, DeveloperPermissionState, ComputerUsePermissionId, ComputerUsePermissionResetResult, ComputerUsePermissionSetupResult, ComputerUsePermissionStatusResult, CodexRateLimitResetResult, GrokAccountStatus, RateLimitRuntimeTarget, RateLimitState, SpeechErrorEvent, SpeechLifecycleEvent, SpeechModelManifest, SpeechModelState, SpeechTranscriptEvent, WorkspaceSpaceAnalyzeResult, WorkspaceSpaceScanProgress, WorkspacePortAdvertisedUrlChangedEvent, WorkspacePortKillRequest, WorkspacePortKillResult, WorkspacePortScanRequest, WorkspacePortScanResult, GhAuthDiagnostic, TelemetryConsentState, AgentKind, LaunchSource, RequestKind, AppStarSource, RemoteWorkspaceChangedEvent, RemoteWorkspaceConnectedClient, RemoteWorkspacePatchResult, RemoteWorkspaceSnapshot, Automation, AutomationCreateInput, AutomationDispatchRequest, AutomationDispatchResult, ExternalAutomationCreateInput, ExternalAutomationActionInput, ExternalAutomationManager, ExternalAutomationRunsInput, ExternalAutomationRunsPage, ExternalAutomationUpdateInput, AutomationRun, AutomationPrecheckResult, AutomationUpdateInput, WorkspaceCleanupDismissArgs, WorkspaceCleanupLocalProcessArgs, WorkspaceCleanupLocalProcessResult, WorkspaceCleanupScanArgs, WorkspaceCleanupScanProgress, WorkspaceCleanupScanResult, KeybindingActionId, KeybindingFileSnapshot, BrowserApi, EmulatorApi, PreflightApi, PtyManagementApi, ExportApi, StatsApi, DiagnosticsStatusPayload, DiagnosticsBundlePayload, DiagnosticsUploadPayload, MemoryApi, ClaudeUsageApi, CodexUsageApi, OpenCodeUsageApi, AiVaultApi, NativeChatApi, AppApi, PluginHostListEntry, PluginHostLogLine, PluginHostInstallSource, PluginHostInstallResult, PluginMarketplaceHostSourceState, PluginMarketplaceHostListing, PluginMarketplaceHostInstallPreview, RuntimeEnvironmentSubscriptionHandle } from './preload-api-contract-types'
export type PreloadApiLinear = {
  gl: {
    viewer: () => Promise<GitLabViewer | null>
    diagnoseAuth: () => Promise<GitLabAuthDiagnostic>
    rateLimit: (args?: {
      force?: boolean
      host?: string | null
    }) => Promise<GetGitLabRateLimitResult>
    projectSlug: (args: GitLabRepoSelectorArgs) => Promise<GitLabProjectRef | null>
    mrForBranch: (
      args: GitLabRepoSelectorArgs & {
        branch: string
        linkedMRIid?: number | null
      }
    ) => Promise<MRInfo | null>
    mr: (args: GitLabRepoSelectorArgs & { iid: number }) => Promise<MRInfo | null>
    listMRs: (
      args: GitLabRepoSelectorArgs & {
        state?: MRListState
        page?: number
        perPage?: number
        query?: string
      }
    ) => Promise<ListMergeRequestsResult>
    /** Combined MR + issue list filtered by state. Issues are skipped
     *  when state is 'merged' (issues don't merge). */
    listWorkItems: (
      args: GitLabRepoSelectorArgs & {
        state?: MRListState
        page?: number
        perPage?: number
        query?: string
      }
    ) => Promise<ListMergeRequestsResult>
    issue: (args: GitLabRepoSelectorArgs & { number: number }) => Promise<GitLabIssueInfo | null>
    listIssues: (
      args: GitLabRepoSelectorArgs & {
        state?: 'opened' | 'closed' | 'all'
        assignee?: string
        limit?: number
      }
    ) => Promise<{ items: GitLabWorkItem[]; error?: ClassifiedError }>
    createIssue: (
      args: GitLabRepoSelectorArgs & {
        title: string
        body: string
      }
    ) => Promise<{ ok: true; number: number; url: string } | { ok: false; error: string }>
    updateIssue: (
      args: GitLabRepoSelectorArgs & {
        number: number
        updates: GitLabIssueUpdate
      }
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    addIssueComment: (
      args: GitLabRepoSelectorArgs & {
        number: number
        body: string
      }
    ) => Promise<GitLabCommentResult>
    listLabels: (args: GitLabRepoSelectorArgs) => Promise<string[]>
    listAssignableUsers: (args: GitLabRepoSelectorArgs) => Promise<GitLabAssignableUser[]>
    /** Cross-project user-scoped todos (gitlab.com/dashboard/todos). */
    todos: (args: GitLabRepoSelectorArgs) => Promise<GitLabTodo[]>
    /** Aggregated dialog payload — body + discussions + pipeline jobs. */
    workItemDetails: (
      args: GitLabRepoSelectorArgs & {
        iid: number
        type: 'issue' | 'mr'
      }
    ) => Promise<GitLabWorkItemDetails | null>
    closeMR: (
      args: GitLabRepoSelectorArgs & {
        iid: number
      }
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    reopenMR: (
      args: GitLabRepoSelectorArgs & {
        iid: number
      }
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    mergeMR: (
      args: GitLabRepoSelectorArgs & {
        iid: number
        method?: 'merge' | 'squash' | 'rebase'
      }
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    updateMR: (
      args: GitLabRepoSelectorArgs & {
        iid: number
        updates: GitLabMRUpdate
      }
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    updateMRReviewers: (
      args: GitLabRepoSelectorArgs & {
        iid: number
        reviewerIds: number[]
        projectRef?: GitLabProjectRef | null
      }
    ) => Promise<GitLabMRReviewersUpdateResult>
    addMRComment: (
      args: GitLabRepoSelectorArgs & {
        iid: number
        body: string
      }
    ) => Promise<GitLabCommentResult>
    addMRInlineComment: (
      args: GitLabRepoSelectorArgs & {
        iid: number
        input: GitLabMRInlineCommentInput
        projectRef?: GitLabProjectRef | null
      }
    ) => Promise<GitLabCommentResult>
    resolveMRDiscussion: (
      args: GitLabRepoSelectorArgs & {
        iid: number
        discussionId: string
        resolved: boolean
      }
    ) => Promise<GitLabDiscussionResolveResult>
    jobTrace: (
      args: GitLabRepoSelectorArgs & {
        jobId: number
        projectRef?: GitLabProjectRef | null
      }
    ) => Promise<GitLabJobTraceResult>
    retryJob: (
      args: GitLabRepoSelectorArgs & {
        jobId: number
        projectRef?: GitLabProjectRef | null
      }
    ) => Promise<GitLabRetryJobResult>
    workItemByPath: (
      args: GitLabRepoSelectorArgs & {
        host: string
        path: string
        iid: number
        type: 'issue' | 'mr'
      }
    ) => Promise<Omit<GitLabWorkItem, 'repoId'> | null>
  }
  linear: {
    connect: (args: {
      apiKey: string
    }) => Promise<{ ok: true; viewer: LinearViewer } | { ok: false; error: string }>
    disconnect: (args?: { workspaceId?: string }) => Promise<void>
    selectWorkspace: (args: {
      workspaceId: LinearWorkspaceSelection
    }) => Promise<LinearConnectionStatus>
    status: () => Promise<LinearConnectionStatus>
    testConnection: (args?: {
      workspaceId?: string
    }) => Promise<{ ok: true; viewer: LinearViewer } | { ok: false; error: string }>
    searchIssues: (args: {
      query: string
      limit?: number
      workspaceId?: LinearWorkspaceSelection
    }) => Promise<LinearIssue[]>
    listIssues: (args?: {
      filter?: 'assigned' | 'created' | 'all' | 'completed'
      limit?: number
      workspaceId?: LinearWorkspaceSelection
      attributeFilter?: LinearIssueAttributeFilter
    }) => Promise<LinearCollectionResult<LinearIssue>>
    createIssue: (args: {
      teamId: string
      title: string
      description?: string
      workspaceId?: string
      parentIssueId?: string
      projectId?: string | null
      stateId?: string
      priority?: number
      assigneeId?: string | null
      labelIds?: string[]
    }) => Promise<
      | { ok: true; id: string; identifier: string; title: string; url: string }
      | { ok: false; error: string }
    >
    getIssue: (args: { id: string; workspaceId?: string }) => Promise<LinearIssue | null>
    updateIssue: (args: {
      id: string
      updates: LinearIssueUpdate
      workspaceId?: string
    }) => Promise<{ ok: true } | { ok: false; error: string }>
    addIssueComment: (args: {
      issueId: string
      body: string
      workspaceId?: string
    }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
    issueComments: (args: { issueId: string; workspaceId?: string }) => Promise<LinearComment[]>
    listTeams: (args?: { workspaceId?: LinearWorkspaceSelection }) => Promise<LinearTeam[]>
    listProjects: (args?: {
      query?: string
      limit?: number
      workspaceId?: LinearWorkspaceSelection
      force?: boolean
    }) => Promise<LinearCollectionResult<LinearProjectSummary>>
    createProject: (args: {
      name: string
      description?: string
      content?: string
      teamIds: string[]
      workspaceId?: string
      leadId?: string | null
      memberIds?: string[]
      labelIds?: string[]
      priority?: number
      startDate?: string
      targetDate?: string
    }) => Promise<{ ok: true; project: LinearProjectDetail } | { ok: false; error: string }>
    getProject: (args: {
      id: string
      workspaceId: string
      force?: boolean
    }) => Promise<LinearProjectDetail | null>
    listProjectIssues: (args: {
      projectId: string
      limit?: number
      workspaceId: string
      force?: boolean
    }) => Promise<LinearCollectionResult<LinearIssue>>
    listCustomViews: (args: {
      model: LinearCustomViewModel
      limit?: number
      workspaceId?: LinearWorkspaceSelection
      force?: boolean
    }) => Promise<LinearCollectionResult<LinearCustomViewSummary>>
    getCustomView: (args: {
      viewId: string
      model: LinearCustomViewModel
      workspaceId: string
      force?: boolean
    }) => Promise<LinearCustomViewSummary | null>
    listCustomViewIssues: (args: {
      viewId: string
      limit?: number
      workspaceId: string
      force?: boolean
    }) => Promise<LinearCollectionResult<LinearIssue>>
    listCustomViewProjects: (args: {
      viewId: string
      limit?: number
      workspaceId: string
      force?: boolean
    }) => Promise<LinearCollectionResult<LinearProjectSummary>>
    teamStates: (args: { teamId: string; workspaceId?: string }) => Promise<LinearWorkflowState[]>
    teamLabels: (args: { teamId: string; workspaceId?: string }) => Promise<LinearLabel[]>
    teamMembers: (args: { teamId: string; workspaceId?: string }) => Promise<LinearMember[]>
  }
  jira: {
    connect: (args: {
      siteUrl: string
      email: string
      apiToken: string
      authType?: 'cloud' | 'server'
    }) => Promise<{ ok: true; viewer: JiraViewer } | { ok: false; error: string }>
    disconnect: (args?: { siteId?: string }) => Promise<void>
    selectSite: (args: { siteId: JiraSiteSelection }) => Promise<JiraConnectionStatus>
    status: () => Promise<JiraConnectionStatus>
    readStatus: () => Promise<JiraConnectionStatus>
    testConnection: (args?: {
      siteId?: string
    }) => Promise<{ ok: true; viewer: JiraViewer } | { ok: false; error: string }>
    searchIssues: (args: {
      jql: string
      limit?: number
      siteId?: JiraSiteSelection
      requestId?: string
    }) => Promise<JiraIssue[]>
    cancelSearchIssues: (args: { requestId: string }) => Promise<void>
    listIssues: (args?: {
      filter?: JiraIssueFilter
      limit?: number
      siteId?: JiraSiteSelection
    }) => Promise<JiraIssue[]>
    getIssue: (args: { key: string; siteId?: string }) => Promise<JiraIssue | null>
    lookupIssueSummary: (args: {
      key: string
      siteId: string
      requestId?: string
    }) => Promise<JiraIssue | null>
    cancelIssueSummary: (args: { requestId: string }) => Promise<void>
    createIssue: (
      args: JiraCreateIssueArgs
    ) => Promise<{ ok: true; id: string; key: string; url: string } | { ok: false; error: string }>
    updateIssue: (args: {
      key: string
      updates: JiraIssueUpdate
      siteId?: string
    }) => Promise<{ ok: true } | { ok: false; error: string }>
    addIssueComment: (args: {
      key: string
      body: string
      siteId?: string
    }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
    issueComments: (args: { key: string; siteId?: string }) => Promise<JiraComment[]>
    listProjects: (args?: { siteId?: JiraSiteSelection }) => Promise<JiraProject[]>
    listIssueTypes: (args: { projectIdOrKey: string; siteId?: string }) => Promise<JiraIssueType[]>
    listCreateFields: (args: {
      projectIdOrKey: string
      issueTypeId: string
      siteId?: string
    }) => Promise<JiraCreateField[]>
    listPriorities: (args?: { siteId?: string }) => Promise<JiraPriority[]>
    listAssignableUsers: (args: {
      key: string
      query?: string
      siteId?: string
    }) => Promise<JiraUser[]>
    listTransitions: (args: { key: string; siteId?: string }) => Promise<JiraTransition[]>
    getProjectStatusOrder: (args: {
      projectKey: string
      siteId?: string
    }) => Promise<JiraProjectStatusOrder>
  }
  starNag: {
    onShow: (
      callback: (payload?: { mode?: 'gh' | 'web'; surface?: 'card' | 'toast' }) => void
    ) => () => void
    onHide: (callback: () => void) => () => void
    dismiss: () => Promise<void>
    later: () => Promise<void>
    complete: () => Promise<void>
    disable: () => Promise<void>
    openWeb: () => Promise<void>
    starOrca: () => Promise<boolean>
    forceShow: () => Promise<void>
    agentValueMoment: () => Promise<{ status: 'ready'; mode: 'gh' | 'web' } | { status: 'skipped' }>
    showAgentValueMoment: () => Promise<void>
    onboardingCompleted: () => Promise<void>
  }
  /** Fire-and-forget track. Loose IPC typing on purpose — the main-side validator enforces;
   *  renderer sites should import `track<N>()` from lib/telemetry.ts, not reach here. */
  telemetryTrack: (name: string, props: Record<string, unknown>) => Promise<void>
  /** Flip the persisted opt-in preference. Subject to a per-session
   *  consent-mutation rate limit on the main side (≤5/session). */
  telemetrySetOptIn: (optedIn: boolean) => Promise<void>
  /** Diagnostic file controls (telemetry-error-tracking.md §User controls). Main does the FS/network
   *  work and retains upload payloads so the renderer can't read or substitute arbitrary bytes. */
  diagnostics: {
    getStatus: () => Promise<DiagnosticsStatusPayload>
    collectBundle: (lookbackMinutes?: number) => Promise<DiagnosticsBundlePayload>
    openBundlePreview: (bundleSubmissionId: string) => Promise<void>
    discardBundlePreview: (bundleSubmissionId: string) => Promise<void>
    uploadBundle: (bundleSubmissionId: string) => Promise<DiagnosticsUploadPayload>
    deleteBundle: (ticketId: string) => Promise<void>
  }
  /** Read-only effective consent state (+ reason if disabled) — env vars are main-side state the renderer can't read directly. */
  telemetryGetConsentState: () => Promise<TelemetryConsentState>
  /** Banner ✕ — persist `optedIn = true` silently. Separate channel from `telemetrySetOptIn`,
   *  whose `via` derivation would wrongly fire `telemetry_opted_in`. Same per-session rate limit. */
  telemetryAcknowledgeBanner: () => Promise<void>
}
