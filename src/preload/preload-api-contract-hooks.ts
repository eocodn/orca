
import type { CreateHostedReviewResult, HostedReviewCreationEligibility, HostedReviewCreationEligibilityArgs, HostedReviewForBranchArgs, HostedReviewInfo, HostedReviewProvider, NativeFileDropPayload, BrowserFindSource, DashboardSnapshot, DashboardRevealAgentArgs, TerminalPreviewConnectResult, TerminalPreviewDataPayload, TerminalTabCloseRequest, TerminalTabCloseResponse, TerminalTabCreateReply, LocalLogTailChangedPayload, LocalLogTailReadArgs, LocalLogTailReadResult, LocalLogTailWatchArgs, ReadClipboardTextOptions, ReleaseChannel, HostQualifiedDetectedWorktreeResult, LegacyDetectedWorktreeRequest, ListDetectedWorktreesArgs, ProviderRequestId, HostRepoCatalogSnapshot, ListReposForExecutionHostArgs, HostLineageSnapshot, ListDesktopLineageForHostArgs, MobileRelayStatus, MobilePairingConnectionMode, MobileRelayMintFailure, VerifyAndAddRuntimeEnvironmentResult, SshMutationExpectation, SshConnectionState, SshConfigImportResult, SshTargetAddResult, SshTarget, PortForwardEntry, EnrichedDetectedPort, CreateLocalOrcaProfileArgs, CreateLocalOrcaProfileResult, CreateCloudLinkedOrcaProfileArgs, CreateCloudLinkedOrcaProfileResult, ConnectCurrentOrcaProfileResult, FindOrcaProfileProjectsByPathArgs, FindOrcaProfileProjectsByPathResult, OrcaProfileListResult, OrcaProfileAuthStatus, RefreshCurrentOrcaProfileAuthResult, SelectOrcaProfileOrgArgs, SelectOrcaProfileOrgResult, SignOutCurrentOrcaProfileResult, SwitchOrcaProfileArgs, SwitchOrcaProfileResult, TransferOrcaProfileProjectArgs, TransferOrcaProfileProjectResult, OrcaProfileOrgInviteRevokeArgs, OrcaProfileOrgMemberChangeRoleArgs, OrcaProfileOrgMemberInviteArgs, OrcaProfileOrgMemberMutationResult, OrcaProfileOrgMemberRemoveArgs, OrcaProfileOrgMembersListArgs, OrcaProfileOrgMembersListResult, TerminalPaneSplitSource, TaskSourceContext, LinearIssueAttributeFilter, ProjectExecutionRuntimeResolution, StartupCommandDelivery, AgentProviderSessionMetadata, SleepingAgentLaunchConfig, PluginPanelActionOutcome, PluginPanelEntry, PluginConsentRequest, PluginLanguagePackRegistration, PluginChangeEvent, PluginMarketplaceGitSource, LocalhostWorktreeLabelResult, LocalhostWorktreeLabelRoute, FolderWorkspacePathStatus, FolderWorkspacePathStatusRequest, BaseRefDefaultResult, BaseRefSearchResult, ClaudeRateLimitAccountsState, ClassifiedError, CodexRateLimitAccountsState, CreateWorktreeArgs, CreateWorktreeResult, CustomPet, DetectedWorktreeListResult, DirEntry, FilesystemPathFlavor, ForceDeleteWorktreeBranchResult, FsChangedPayload, GhosttyImportPreview, GlobalSettings, GitBranchCompareResult, GitCommitCompareResult, GitConflictOperation, GitDiffResult, GitForkSyncExpectedUpstream, GitForkSyncResult, GitPushTarget, GitStagingArea, GitStatusResult, GitUpstreamStatus, GitHubAssignableUser, GitHubCreateIssueResult, GitHubPRFile, GitHubPRFileContents, GitHubPrStartPoint, GitHubPRReviewCommentInput, GitHubCommentResult, GitHubOwnerRepo, GitHubWorkItem, GitHubWorkItemDetails, GitHubViewer, GitLabAssignableUser, GitLabAuthDiagnostic, GitLabCommentResult, GitLabDiscussionResolveResult, GitLabIssueInfo, GitLabIssueUpdate, GitLabJobTraceResult, GitLabMRInlineCommentInput, GitLabMRReviewersUpdateResult, GitLabMRUpdate, GitLabProjectRef, GitLabRetryJobResult, GitLabTodo, GitLabViewer, GitLabWorkItem, GitLabWorkItemDetails, GetGitLabRateLimitResult, ListMergeRequestsResult, MRInfo, MRListState, ListWorkItemsResult, IssueInfo, JiraComment, JiraConnectionStatus, JiraCreateField, JiraCreateIssueArgs, JiraIssue, JiraIssueFilter, JiraIssueType, JiraProjectStatusOrder, JiraIssueUpdate, JiraPriority, JiraProject, JiraSiteSelection, JiraTransition, JiraUser, JiraViewer, LinearViewer, LinearCollectionResult, LinearConnectionStatus, LinearCustomViewModel, LinearCustomViewSummary, LinearWorkspaceSelection, LinearIssue, LinearIssueUpdate, LinearComment, LinearWorkflowState, LinearLabel, LinearMember, LinearProjectDetail, LinearProjectSummary, LinearTeam, MarkdownDocument, GitHubIssueUpdate, GitHubPRRefreshCandidate, GitHubPRRefreshEnqueueResult, GitHubPRRefreshEvent, GitHubPRRefreshReason, GetRateLimitResult, NotificationDispatchRequest, NotificationDispatchResult, NotificationDeliveryProbeResult, NotificationDismissResult, NotificationPermissionStatusResult, NotificationSoundResult, OnboardingState, OrcaHooks, PersistedUIState, PRCheckDetail, PRCheckRunDetails, PRComment, PRInfo, PRRefreshOutcome, Project, ProjectUpdateArgs, Repo, ProjectGroup, ProjectHostSetup, ProjectHostSetupCreateArgs, ProjectHostSetupCreateResult, ProjectHostSetupDeleteArgs, ProjectHostSetupDeleteResult, ProjectHostSetupExistingFolderArgs, ProjectHostSetupResult, ProjectHostSetupUpdateArgs, ProjectHostSetupUpdateResult, FolderWorkspace, ProjectGroupImportResult, ProjectGroupImportMode, SparsePreset, SearchOptions, NestedRepoScanResult, SearchResult, TuiAgent, ReleaseBuildListResult, UpdateCheckOptions, UpdateStatus, Worktree, WorktreeBaseStatusEvent, WorktreeHeadIdentity, WorktreeLineage, WorkspaceLineage, WorktreeMeta, WorktreeRemoteBranchConflictEvent, RemoveWorktreeResult, WorktreeDefaultTabsLaunch, WorktreeSetupLaunch, WorktreeStartupLaunch, WorkspaceSessionPatch, WorkspaceSessionState, PtyModelRestoreNeededEvent, PtyListedSession, PtyRendererDeliveryHealthReply, PtyRendererDeliveryStateReport, TerminalViewAttributes, PtyMainDeliveryDiagnostics, WarpThemeImportPreview, WarpThemeImportSource, SetupScriptImportCandidate, GitHistoryOptions, GitHistoryResult, PublicKnownRuntimeEnvironment, EphemeralVmRecipeDoctorResult, EphemeralVmRecipeResultWarning, EphemeralVmRuntimeRecord, RuntimeAccessGrant, RuntimeRpcResponse, ExecutionHostId, FeatureInteractionId, AddIssueCommentBySlugArgs, ClearProjectItemFieldArgs, DeleteIssueCommentBySlugArgs, GetProjectViewTableArgs, GetProjectViewTableResult, GitHubProjectCommentMutationResult, GitHubProjectMutationResult, ListAccessibleProjectsArgs, ListAccessibleProjectsResult, ListAssignableUsersBySlugArgs, ListAssignableUsersBySlugResult, ListIssueTypesBySlugArgs, ListIssueTypesBySlugResult, ListLabelsBySlugArgs, ListLabelsBySlugResult, ListProjectViewsArgs, ListProjectViewsResult, ProjectWorkItemDetailsBySlugArgs, ProjectWorkItemDetailsBySlugResult, ResolveProjectRefArgs, ResolveProjectRefResult, UpdateIssueBySlugArgs, UpdateIssueCommentBySlugArgs, UpdateIssueTypeBySlugArgs, UpdatePullRequestBySlugArgs, UpdateProjectItemFieldArgs, RichMarkdownContextMenuCommandPayload, ElectronAPI, CliInstallStatus, E2EConfig, AgentHookInstallStatus, CodexConfigSyncStatus, AgentStatusClearIpcPayload, AgentStatusIpcPayload, MigrationUnsupportedPtyEntry, AgentInterruptInferenceRequest, AgentQuestionAnsweredInferenceRequest, TerminalSideEffectBatch, RuntimeBrowserDriverState, RuntimeMobileSessionTabMove, RuntimeStatus, RuntimeSyncWindowGraphResult, RuntimeSyncWindowGraph, RuntimeTerminalCreateRequestPayload, RuntimeTerminalDriverState, RuntimeTerminalPresentation, CommitMessageAgentCapability, CommitMessageModelCapability, ResolvedSourceControlAiGenerationParams, SourceControlAiSettings, ShellOpenExternalEditorRequest, ShellOpenExternalEditorResult, ShellOpenLocalPathResult, SkillDiscoveryResult, SkillDiscoveryTarget, SkillFreshnessInventory, SkillUpdateRun, SkillUpdateStartResult, CrashReportBreadcrumbData, CrashReportCopyDiagnosticsArgs, CrashReportRecord, CrashReportSubmitArgs, CrashReportSubmitResult, ReactErrorBoundaryReportArgs, ReactErrorBoundaryReportResult, RendererHeapStatistics, RuntimeMobileMarkdownRequest, RuntimeMobileMarkdownResponse, DeveloperPermissionId, DeveloperPermissionRequestResult, DeveloperPermissionState, ComputerUsePermissionId, ComputerUsePermissionResetResult, ComputerUsePermissionSetupResult, ComputerUsePermissionStatusResult, CodexRateLimitResetResult, GrokAccountStatus, RateLimitRuntimeTarget, RateLimitState, SpeechErrorEvent, SpeechLifecycleEvent, SpeechModelManifest, SpeechModelState, SpeechTranscriptEvent, WorkspaceSpaceAnalyzeResult, WorkspaceSpaceScanProgress, WorkspacePortAdvertisedUrlChangedEvent, WorkspacePortKillRequest, WorkspacePortKillResult, WorkspacePortScanRequest, WorkspacePortScanResult, GhAuthDiagnostic, TelemetryConsentState, AgentKind, LaunchSource, RequestKind, AppStarSource, RemoteWorkspaceChangedEvent, RemoteWorkspaceConnectedClient, RemoteWorkspacePatchResult, RemoteWorkspaceSnapshot, Automation, AutomationCreateInput, AutomationDispatchRequest, AutomationDispatchResult, ExternalAutomationCreateInput, ExternalAutomationActionInput, ExternalAutomationManager, ExternalAutomationRunsInput, ExternalAutomationRunsPage, ExternalAutomationUpdateInput, AutomationRun, AutomationPrecheckResult, AutomationUpdateInput, WorkspaceCleanupDismissArgs, WorkspaceCleanupLocalProcessArgs, WorkspaceCleanupLocalProcessResult, WorkspaceCleanupScanArgs, WorkspaceCleanupScanProgress, WorkspaceCleanupScanResult, KeybindingActionId, KeybindingFileSnapshot, BrowserApi, EmulatorApi, PreflightApi, PtyManagementApi, ExportApi, StatsApi, DiagnosticsStatusPayload, DiagnosticsBundlePayload, DiagnosticsUploadPayload, MemoryApi, ClaudeUsageApi, CodexUsageApi, OpenCodeUsageApi, AiVaultApi, NativeChatApi, AppApi, PluginHostListEntry, PluginHostLogLine, PluginHostInstallSource, PluginHostInstallResult, PluginMarketplaceHostSourceState, PluginMarketplaceHostListing, PluginMarketplaceHostInstallPreview, RuntimeEnvironmentSubscriptionHandle } from './preload-api-contract-types'
export type PreloadApiHooks = {
  git: {
    status: (args: {
      worktreePath: string
      connectionId?: string
      includeIgnored?: boolean
      bypassEffectiveUpstreamNegativeCache?: boolean
      reuseLineStats?: boolean
      requestToken?: string
    }) => Promise<GitStatusResult>
    cancelStatus: (args: { requestToken: string }) => Promise<void>
    submoduleStatus: (args: {
      worktreePath: string
      submodulePath: string
      connectionId?: string
      area?: GitStagingArea
    }) => Promise<GitStatusResult>
    checkIgnored: (args: {
      worktreePath: string
      paths: string[]
      connectionId?: string
    }) => Promise<string[]>
    findHugeFoldersToIgnore: (args: { worktreePath: string }) => Promise<string[]>
    appendGitignore: (args: { worktreePath: string; folderName: string }) => Promise<boolean>
    history: (
      args: { worktreePath: string; connectionId?: string } & GitHistoryOptions
    ) => Promise<GitHistoryResult>
    conflictOperation: (args: {
      worktreePath: string
      connectionId?: string
    }) => Promise<GitConflictOperation>
    abortMerge: (args: { worktreePath: string; connectionId?: string }) => Promise<void>
    abortRebase: (args: { worktreePath: string; connectionId?: string }) => Promise<void>
    diff: (args: {
      worktreePath: string
      filePath: string
      staged: boolean
      compareAgainstHead?: boolean
      connectionId?: string
    }) => Promise<GitDiffResult>
    branchCompare: (args: {
      worktreePath: string
      baseRef: string
      connectionId?: string
    }) => Promise<GitBranchCompareResult>
    commitCompare: (args: {
      worktreePath: string
      commitId: string
      connectionId?: string
    }) => Promise<GitCommitCompareResult>
    upstreamStatus: (args: {
      worktreePath: string
      connectionId?: string
      pushTarget?: GitPushTarget
    }) => Promise<GitUpstreamStatus>
    fetch: (args: {
      worktreePath: string
      connectionId?: string
      pushTarget?: GitPushTarget
    }) => Promise<void>
    syncFork: (args: {
      worktreePath: string
      connectionId?: string
      expectedUpstream: GitForkSyncExpectedUpstream
    }) => Promise<GitForkSyncResult>
    push: (args: {
      worktreePath: string
      publish?: boolean
      forceWithLease?: boolean
      connectionId?: string
      pushTarget?: GitPushTarget
    }) => Promise<void>
    pull: (args: {
      worktreePath: string
      connectionId?: string
      pushTarget?: GitPushTarget
    }) => Promise<void>
    fastForward: (args: {
      worktreePath: string
      connectionId?: string
      pushTarget?: GitPushTarget
    }) => Promise<void>
    rebaseFromBase: (args: {
      worktreePath: string
      baseRef: string
      connectionId?: string
    }) => Promise<void>
    branchDiff: (args: {
      worktreePath: string
      compare: {
        baseRef: string
        baseOid: string
        headOid: string
        mergeBase: string
      }
      filePath: string
      oldPath?: string
      connectionId?: string
    }) => Promise<GitDiffResult>
    commitDiff: (args: {
      worktreePath: string
      commitOid: string
      parentOid?: string | null
      filePath: string
      oldPath?: string
      connectionId?: string
    }) => Promise<GitDiffResult>
    commit: (args: {
      worktreePath: string
      message: string
      connectionId?: string
    }) => Promise<{ success: boolean; error?: string }>
    generateCommitMessage: (args: {
      worktreePath: string
      /** Raw (unstripped) worktree meta key; validated against worktreePath in main. */
      worktreeId?: string
      repoId?: string
      connectionId?: string
      sourceControlAiResolvedParams?: ResolvedSourceControlAiGenerationParams
      sourceControlAi?: SourceControlAiSettings
      agentCmdOverrides?: Partial<Record<TuiAgent, string>>
    }) => Promise<
      | { success: true; message: string; agentLabel?: string }
      | { success: false; error: string; canceled?: boolean }
    >
    discoverCommitMessageModels: (args: {
      agentId: string
      worktreePath?: string
      connectionId?: string
    }) => Promise<
      | {
          success: true
          capability: CommitMessageAgentCapability
          models: CommitMessageModelCapability[]
          defaultModelId: string
        }
      | { success: false; error: string }
    >
    cancelGenerateCommitMessage: (args: {
      worktreePath: string
      connectionId?: string
    }) => Promise<void>
    generatePullRequestFields: (args: {
      worktreePath: string
      /** Raw (unstripped) worktree meta key; validated against worktreePath in main. */
      worktreeId?: string
      repoId?: string
      base: string
      title: string
      body: string
      draft: boolean
      provider?: HostedReviewProvider
      useTemplate?: boolean
      connectionId?: string
      sourceControlAiResolvedParams?: ResolvedSourceControlAiGenerationParams
      sourceControlAi?: SourceControlAiSettings
      agentCmdOverrides?: Partial<Record<TuiAgent, string>>
    }) => Promise<
      | {
          success: true
          fields: { base: string; title: string; body: string; draft: boolean }
          agentLabel?: string
          branchChangedByPreparation?: boolean
        }
      | { success: false; error: string; canceled?: boolean; branchChangedByPreparation?: boolean }
    >
    cancelGeneratePullRequestFields: (args: {
      worktreePath: string
      connectionId?: string
    }) => Promise<void>
    stage: (args: {
      worktreePath: string
      filePath: string
      connectionId?: string
    }) => Promise<void>
    bulkStage: (args: {
      worktreePath: string
      filePaths: string[]
      connectionId?: string
    }) => Promise<void>
    unstage: (args: {
      worktreePath: string
      filePath: string
      connectionId?: string
    }) => Promise<void>
    bulkUnstage: (args: {
      worktreePath: string
      filePaths: string[]
      connectionId?: string
    }) => Promise<void>
    discard: (args: {
      worktreePath: string
      filePath: string
      connectionId?: string
    }) => Promise<void>
    bulkDiscard: (args: {
      worktreePath: string
      filePaths: string[]
      connectionId?: string
    }) => Promise<void>
    remoteFileUrl: (args: {
      worktreePath: string
      relativePath: string
      line: number
      connectionId?: string
    }) => Promise<string | null>
    remoteCommitUrl: (args: {
      worktreePath: string
      sha: string
      connectionId?: string
    }) => Promise<string | null>
  }
}
