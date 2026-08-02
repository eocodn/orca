
import type { CreateHostedReviewResult, HostedReviewCreationEligibility, HostedReviewCreationEligibilityArgs, HostedReviewForBranchArgs, HostedReviewInfo, HostedReviewProvider, NativeFileDropPayload, BrowserFindSource, DashboardSnapshot, DashboardRevealAgentArgs, TerminalPreviewConnectResult, TerminalPreviewDataPayload, TerminalTabCloseRequest, TerminalTabCloseResponse, TerminalTabCreateReply, LocalLogTailChangedPayload, LocalLogTailReadArgs, LocalLogTailReadResult, LocalLogTailWatchArgs, ReadClipboardTextOptions, ReleaseChannel, HostQualifiedDetectedWorktreeResult, LegacyDetectedWorktreeRequest, ListDetectedWorktreesArgs, ProviderRequestId, HostRepoCatalogSnapshot, ListReposForExecutionHostArgs, HostLineageSnapshot, ListDesktopLineageForHostArgs, MobileRelayStatus, MobilePairingConnectionMode, MobileRelayMintFailure, VerifyAndAddRuntimeEnvironmentResult, SshMutationExpectation, SshConnectionState, SshConfigImportResult, SshTargetAddResult, SshTarget, PortForwardEntry, EnrichedDetectedPort, CreateLocalOrcaProfileArgs, CreateLocalOrcaProfileResult, CreateCloudLinkedOrcaProfileArgs, CreateCloudLinkedOrcaProfileResult, ConnectCurrentOrcaProfileResult, FindOrcaProfileProjectsByPathArgs, FindOrcaProfileProjectsByPathResult, OrcaProfileListResult, OrcaProfileAuthStatus, RefreshCurrentOrcaProfileAuthResult, SelectOrcaProfileOrgArgs, SelectOrcaProfileOrgResult, SignOutCurrentOrcaProfileResult, SwitchOrcaProfileArgs, SwitchOrcaProfileResult, TransferOrcaProfileProjectArgs, TransferOrcaProfileProjectResult, OrcaProfileOrgInviteRevokeArgs, OrcaProfileOrgMemberChangeRoleArgs, OrcaProfileOrgMemberInviteArgs, OrcaProfileOrgMemberMutationResult, OrcaProfileOrgMemberRemoveArgs, OrcaProfileOrgMembersListArgs, OrcaProfileOrgMembersListResult, TerminalPaneSplitSource, TaskSourceContext, LinearIssueAttributeFilter, ProjectExecutionRuntimeResolution, StartupCommandDelivery, AgentProviderSessionMetadata, SleepingAgentLaunchConfig, PluginPanelActionOutcome, PluginPanelEntry, PluginConsentRequest, PluginLanguagePackRegistration, PluginChangeEvent, PluginMarketplaceGitSource, LocalhostWorktreeLabelResult, LocalhostWorktreeLabelRoute, FolderWorkspacePathStatus, FolderWorkspacePathStatusRequest, BaseRefDefaultResult, BaseRefSearchResult, ClaudeRateLimitAccountsState, ClassifiedError, CodexRateLimitAccountsState, CreateWorktreeArgs, CreateWorktreeResult, CustomPet, DetectedWorktreeListResult, DirEntry, FilesystemPathFlavor, ForceDeleteWorktreeBranchResult, FsChangedPayload, GhosttyImportPreview, GlobalSettings, GitBranchCompareResult, GitCommitCompareResult, GitConflictOperation, GitDiffResult, GitForkSyncExpectedUpstream, GitForkSyncResult, GitPushTarget, GitStagingArea, GitStatusResult, GitUpstreamStatus, GitHubAssignableUser, GitHubCreateIssueResult, GitHubPRFile, GitHubPRFileContents, GitHubPrStartPoint, GitHubPRReviewCommentInput, GitHubCommentResult, GitHubOwnerRepo, GitHubWorkItem, GitHubWorkItemDetails, GitHubViewer, GitLabAssignableUser, GitLabAuthDiagnostic, GitLabCommentResult, GitLabDiscussionResolveResult, GitLabIssueInfo, GitLabIssueUpdate, GitLabJobTraceResult, GitLabMRInlineCommentInput, GitLabMRReviewersUpdateResult, GitLabMRUpdate, GitLabProjectRef, GitLabRetryJobResult, GitLabTodo, GitLabViewer, GitLabWorkItem, GitLabWorkItemDetails, GetGitLabRateLimitResult, ListMergeRequestsResult, MRInfo, MRListState, ListWorkItemsResult, IssueInfo, JiraComment, JiraConnectionStatus, JiraCreateField, JiraCreateIssueArgs, JiraIssue, JiraIssueFilter, JiraIssueType, JiraProjectStatusOrder, JiraIssueUpdate, JiraPriority, JiraProject, JiraSiteSelection, JiraTransition, JiraUser, JiraViewer, LinearViewer, LinearCollectionResult, LinearConnectionStatus, LinearCustomViewModel, LinearCustomViewSummary, LinearWorkspaceSelection, LinearIssue, LinearIssueUpdate, LinearComment, LinearWorkflowState, LinearLabel, LinearMember, LinearProjectDetail, LinearProjectSummary, LinearTeam, MarkdownDocument, GitHubIssueUpdate, GitHubPRRefreshCandidate, GitHubPRRefreshEnqueueResult, GitHubPRRefreshEvent, GitHubPRRefreshReason, GetRateLimitResult, NotificationDispatchRequest, NotificationDispatchResult, NotificationDeliveryProbeResult, NotificationDismissResult, NotificationPermissionStatusResult, NotificationSoundResult, OnboardingState, OrcaHooks, PersistedUIState, PRCheckDetail, PRCheckRunDetails, PRComment, PRInfo, PRRefreshOutcome, Project, ProjectUpdateArgs, Repo, ProjectGroup, ProjectHostSetup, ProjectHostSetupCreateArgs, ProjectHostSetupCreateResult, ProjectHostSetupDeleteArgs, ProjectHostSetupDeleteResult, ProjectHostSetupExistingFolderArgs, ProjectHostSetupResult, ProjectHostSetupUpdateArgs, ProjectHostSetupUpdateResult, FolderWorkspace, ProjectGroupImportResult, ProjectGroupImportMode, SparsePreset, SearchOptions, NestedRepoScanResult, SearchResult, TuiAgent, ReleaseBuildListResult, UpdateCheckOptions, UpdateStatus, Worktree, WorktreeBaseStatusEvent, WorktreeHeadIdentity, WorktreeLineage, WorkspaceLineage, WorktreeMeta, WorktreeRemoteBranchConflictEvent, RemoveWorktreeResult, WorktreeDefaultTabsLaunch, WorktreeSetupLaunch, WorktreeStartupLaunch, WorkspaceSessionPatch, WorkspaceSessionState, PtyModelRestoreNeededEvent, PtyListedSession, PtyRendererDeliveryHealthReply, PtyRendererDeliveryStateReport, TerminalViewAttributes, PtyMainDeliveryDiagnostics, WarpThemeImportPreview, WarpThemeImportSource, SetupScriptImportCandidate, GitHistoryOptions, GitHistoryResult, PublicKnownRuntimeEnvironment, EphemeralVmRecipeDoctorResult, EphemeralVmRecipeResultWarning, EphemeralVmRuntimeRecord, RuntimeAccessGrant, RuntimeRpcResponse, ExecutionHostId, FeatureInteractionId, AddIssueCommentBySlugArgs, ClearProjectItemFieldArgs, DeleteIssueCommentBySlugArgs, GetProjectViewTableArgs, GetProjectViewTableResult, GitHubProjectCommentMutationResult, GitHubProjectMutationResult, ListAccessibleProjectsArgs, ListAccessibleProjectsResult, ListAssignableUsersBySlugArgs, ListAssignableUsersBySlugResult, ListIssueTypesBySlugArgs, ListIssueTypesBySlugResult, ListLabelsBySlugArgs, ListLabelsBySlugResult, ListProjectViewsArgs, ListProjectViewsResult, ProjectWorkItemDetailsBySlugArgs, ProjectWorkItemDetailsBySlugResult, ResolveProjectRefArgs, ResolveProjectRefResult, UpdateIssueBySlugArgs, UpdateIssueCommentBySlugArgs, UpdateIssueTypeBySlugArgs, UpdatePullRequestBySlugArgs, UpdateProjectItemFieldArgs, RichMarkdownContextMenuCommandPayload, ElectronAPI, CliInstallStatus, E2EConfig, AgentHookInstallStatus, CodexConfigSyncStatus, AgentStatusClearIpcPayload, AgentStatusIpcPayload, MigrationUnsupportedPtyEntry, AgentInterruptInferenceRequest, AgentQuestionAnsweredInferenceRequest, TerminalSideEffectBatch, RuntimeBrowserDriverState, RuntimeMobileSessionTabMove, RuntimeStatus, RuntimeSyncWindowGraphResult, RuntimeSyncWindowGraph, RuntimeTerminalCreateRequestPayload, RuntimeTerminalDriverState, RuntimeTerminalPresentation, CommitMessageAgentCapability, CommitMessageModelCapability, ResolvedSourceControlAiGenerationParams, SourceControlAiSettings, ShellOpenExternalEditorRequest, ShellOpenExternalEditorResult, ShellOpenLocalPathResult, SkillDiscoveryResult, SkillDiscoveryTarget, SkillFreshnessInventory, SkillUpdateRun, SkillUpdateStartResult, CrashReportBreadcrumbData, CrashReportCopyDiagnosticsArgs, CrashReportRecord, CrashReportSubmitArgs, CrashReportSubmitResult, ReactErrorBoundaryReportArgs, ReactErrorBoundaryReportResult, RendererHeapStatistics, RuntimeMobileMarkdownRequest, RuntimeMobileMarkdownResponse, DeveloperPermissionId, DeveloperPermissionRequestResult, DeveloperPermissionState, ComputerUsePermissionId, ComputerUsePermissionResetResult, ComputerUsePermissionSetupResult, ComputerUsePermissionStatusResult, CodexRateLimitResetResult, GrokAccountStatus, RateLimitRuntimeTarget, RateLimitState, SpeechErrorEvent, SpeechLifecycleEvent, SpeechModelManifest, SpeechModelState, SpeechTranscriptEvent, WorkspaceSpaceAnalyzeResult, WorkspaceSpaceScanProgress, WorkspacePortAdvertisedUrlChangedEvent, WorkspacePortKillRequest, WorkspacePortKillResult, WorkspacePortScanRequest, WorkspacePortScanResult, GhAuthDiagnostic, TelemetryConsentState, AgentKind, LaunchSource, RequestKind, AppStarSource, RemoteWorkspaceChangedEvent, RemoteWorkspaceConnectedClient, RemoteWorkspacePatchResult, RemoteWorkspaceSnapshot, Automation, AutomationCreateInput, AutomationDispatchRequest, AutomationDispatchResult, ExternalAutomationCreateInput, ExternalAutomationActionInput, ExternalAutomationManager, ExternalAutomationRunsInput, ExternalAutomationRunsPage, ExternalAutomationUpdateInput, AutomationRun, AutomationPrecheckResult, AutomationUpdateInput, WorkspaceCleanupDismissArgs, WorkspaceCleanupLocalProcessArgs, WorkspaceCleanupLocalProcessResult, WorkspaceCleanupScanArgs, WorkspaceCleanupScanProgress, WorkspaceCleanupScanResult, KeybindingActionId, KeybindingFileSnapshot, BrowserApi, EmulatorApi, PreflightApi, PtyManagementApi, ExportApi, StatsApi, DiagnosticsStatusPayload, DiagnosticsBundlePayload, DiagnosticsUploadPayload, MemoryApi, ClaudeUsageApi, CodexUsageApi, OpenCodeUsageApi, AiVaultApi, NativeChatApi, AppApi, PluginHostListEntry, PluginHostLogLine, PluginHostInstallSource, PluginHostInstallResult, PluginMarketplaceHostSourceState, PluginMarketplaceHostListing, PluginMarketplaceHostInstallPreview, RuntimeEnvironmentSubscriptionHandle } from './preload-api-contract-types'
export type PreloadApiPty = {
  pty: {
    spawn: (opts: {
      cols: number
      rows: number
      cwd?: string
      cwdFallback?: 'worktree'
      env?: Record<string, string>
      envToDelete?: string[]
      command?: string
      launchConfig?: SleepingAgentLaunchConfig
      resumeProviderSession?: AgentProviderSessionMetadata
      launchToken?: string
      launchAgent?: TuiAgent
      startupCommandDelivery?: StartupCommandDelivery
      connectionId?: string | null
      worktreeId?: string
      sessionId?: string
      // Why: lets a single tab open in a different shell than the user's default.
      shellOverride?: string
      projectRuntime?: ProjectExecutionRuntimeResolution
      terminalColorQueryReplies?: { foreground?: string; background?: string }
      // Why: mark the PTY hidden before its first byte so the delivery gate owns spawn-time queries (terminal-query-authority.md §races).
      initiallyHidden?: boolean
      // Why: main sync-flushes the (worktreeId,tabId,leafId→ptyId) binding before pty:spawn returns to close a SIGKILL race (INVESTIGATION.md).
      tabId?: string
      leafId?: string
      // Why: main fires `agent_started` only on spawn success, so launch metadata rides this field (telemetry-plan.md §Agent launch semantics).
      telemetry?: { agent_kind: AgentKind; launch_source: LaunchSource; request_kind: RequestKind }
    }) => Promise<{
      id: string
      launchAgent?: TuiAgent
      launchConfig?: SleepingAgentLaunchConfig
      snapshot?: string
      snapshotCols?: number
      snapshotRows?: number
      isReattach?: boolean
      isAlternateScreen?: boolean
      replay?: string
      sessionExpired?: boolean
      coldRestore?: { scrollback: string; cwd: string; cols?: number; rows?: number }
      startupCwdFallback?: { kind: 'worktree'; cwd: string }
      agentResumeUnavailable?: true
    }>
    write: (id: string, data: string) => void
    writeAccepted: (id: string, data: string) => Promise<boolean>
    onWriteUnavailable?: (callback: (payload: { id: string }) => void) => () => void
    resize: (id: string, cols: number, rows: number) => void
    claimViewport: (id: string, cols: number, rows: number) => void
    reportGeometry: (id: string, cols: number, rows: number) => void
    signal: (id: string, signal: string) => void
    clearBuffer: (id: string) => void
    kill: (id: string, opts?: { keepHistory?: boolean }) => Promise<void>
    ackColdRestore: (id: string) => void
    ackData: (id: string, charCount: number, processedChars?: number) => void
    onDeliveryResyncRequest: (callback: (payload: { requestId: number }) => void) => () => void
    respondDeliveryResync: (payload: {
      requestId: number
      processedCharsByPty: Record<string, number>
    }) => void
    /** Renderer-initiated delivery health/heal lane over invoke — reaches main
     *  even when every main→renderer push channel is dead (field wedge). */
    reportRendererDeliveryState: (
      report: PtyRendererDeliveryStateReport
    ) => Promise<PtyRendererDeliveryHealthReply>
    /** Live pty:data listener count on the preload emitter (sync) — heal-time
     *  discriminator between a detached listener and a dead channel. */
    getPtyDataListenerCount: () => number
    /** One-shot signal that this page's pty:data dispatcher is registered, so
     *  main can release sends held during the load/reload boot window. */
    rendererDispatcherReady: () => void
    setActiveRendererPty: (id: string, active: boolean) => void
    setRendererPtyVisible: (id: string, visible: boolean) => void
    /** Hidden-delivery gate (Phase 4): hidden=true lets main drop renderer
     *  byte delivery after model ingestion; reveal restores from snapshots. */
    setHiddenRendererPty: (id: string, hidden: boolean) => void
    /** Ref-counted-on-the-renderer delivery-interest signal that suppresses
     *  the hidden-delivery gate while any raw-byte consumer is registered. */
    setPtyDeliveryInterest: (id: string, interested: boolean) => void
    /** View-attribute bridge (Phase 5 slice 2): app-global composed terminal
     *  appearance push backing main's hidden-PTY OSC/DSR color replies. */
    publishTerminalViewAttributes: (attributes: TerminalViewAttributes) => void
    hasChildProcesses: (id: string) => Promise<boolean>
    getForegroundProcess: (id: string) => Promise<string | null>
    inspectProcess: (id: string) => Promise<{
      foregroundProcess: string | null
      hasChildProcesses: boolean
      unavailable?: true
    }>
    confirmForegroundProcess: (id: string) => Promise<string | null>
    getCwd: (id: string) => Promise<string>
    getSize: (id: string) => Promise<{ cols: number; rows: number } | null>
    listSessions: () => Promise<PtyListedSession[]>
    getAuthoritativeBufferSnapshotCapabilities?: (
      ids: string[]
    ) => { id: string; authoritative: boolean | null }[]
    hasPty: (id: string) => Promise<boolean | null>
    getMainBufferSnapshot: (
      id: string,
      opts?: { scrollbackRows?: number }
    ) => Promise<{
      data: string
      cols: number
      rows: number
      cwd?: string | null
      seq?: number
      /** Start of main's pending renderer-delivery queue at snapshot time
       *  (equals `seq` when empty) — bounds the renderer's post-restore
       *  duplicate window. */
      pendingDeliveryStartSeq?: number
      source?: 'headless' | 'renderer'
      alternateScreen?: boolean
      /** Authoritative normal buffer paired with an alternate-screen frame. */
      scrollbackAnsi?: string
      /** Trailing incomplete escape the emulator ingested; the restorer must
       *  write it after its post-replay resets, last before live chunks. */
      pendingEscapeTailAnsi?: string
    } | null>
    getRendererDeliveryDebugSnapshot: () => Promise<{
      pendingPtyCount: number
      pendingChars: number
      maxPendingCharsByPty: number
      rendererInFlightPtyCount: number
      rendererInFlightChars: number
      maxRendererInFlightCharsByPty: number
      activeRendererPtyCount: number
      flushScheduled: boolean
      peakPendingChars: number
      peakMaxPendingCharsByPty: number
      peakRendererInFlightChars: number
      peakMaxRendererInFlightCharsByPty: number
      ackGatedFlushSkipCount: number
      hiddenDeliveryGatedPtyCount: number
      hiddenDeliveryGatedVisiblePtyCount: number
      hiddenDeliveryGatedActivePtyCount: number
      deliveryInterestPtyCount: number
      hiddenDeliveryDroppedChars: number
      hiddenDeliveryDroppedChunks: number
      pendingDroppedChars: number
      diagnostics: PtyMainDeliveryDiagnostics
      rendererLifecycleResetCount: number
      lastLifecycleResetClearedChars: number
      rendererPtyDispatcherReady: boolean
      rendererDispatcherReadyForcedCount: number
    }>
    resetRendererDeliveryDebug: () => Promise<void>
    onData: (
      callback: (data: {
        id: string
        data: string
        seq?: number
        rawLength?: number
        transformed?: boolean
        background?: boolean
        droppedOutput?: boolean
      }) => void
    ) => () => void
    onReplay: (callback: (data: { id: string; data: string }) => void) => () => void
    /** Out-of-band main→renderer signal that renderer-bound bytes were
     *  dropped (hidden-delivery gate / pending cap); the pane restores from
     *  the model snapshot. Never delivered in-band on pty:data. */
    onModelRestoreNeeded: (callback: (event: PtyModelRestoreNeededEvent) => void) => () => void
    /** Batched derived side-effect facts for PTYs whose bytes transit local
     *  main. */
    onSideEffect: (callback: (batch: TerminalSideEffectBatch) => void) => () => void
    /** Title-only replay snapshot for (re)attach; attention facts never replay. */
    getSideEffectSnapshot: (id: string) => Promise<TerminalSideEffectBatch | null>
    onExit: (
      callback: (data: { id: string; code: number; preserveRendererBinding?: boolean }) => void
    ) => () => void
    onSpawned: (callback: (data: { id: string }) => void) => () => void
    onSerializeBufferRequest: (
      callback: (data: {
        requestId: string
        ptyId: string
        opts?: { scrollbackRows?: number; altScreenForcesZeroRows?: boolean }
      }) => void
    ) => () => void
    onClearBufferRequest: (callback: (data: { ptyId: string }) => void) => () => void
    sendSerializedBuffer: (
      requestId: string,
      snapshot: {
        data: string
        cols: number
        rows: number
        seq?: number
        lastTitle?: string
      } | null
    ) => void
    declarePendingPaneSerializer: (paneKey: string) => Promise<number>
    settlePaneSerializer: (paneKey: string, gen: number) => Promise<void>
    clearPendingPaneSerializer: (paneKey: string, gen: number) => Promise<void>
    reportRendererSerializerReady?: (ptyId: string) => Promise<void>
    management: PtyManagementApi
  }
  feedback: {
    submit: (args: {
      feedback: string
      submitAnonymously?: boolean
      githubLogin: string | null
      githubEmail: string | null
      images?: { contentType: string; data: Uint8Array }[]
    }) => Promise<
      { ok: true; imagesDelivered?: boolean } | { ok: false; status: number | null; error: string }
    >
  }
  crashReports: {
    getLatestPending: () => Promise<CrashReportRecord | null>
    getLatestReport: () => Promise<CrashReportRecord | null>
    dismiss: (args: { reportId: string }) => Promise<CrashReportRecord | null>
    recordRendererError: (
      args: ReactErrorBoundaryReportArgs
    ) => Promise<ReactErrorBoundaryReportResult>
    recordBreadcrumb: (args: { name: string; data?: CrashReportBreadcrumbData }) => void
    submit: (args: CrashReportSubmitArgs) => Promise<CrashReportSubmitResult>
    copyLatestDiagnostics: (
      args?: CrashReportCopyDiagnosticsArgs
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    /** Exact V8/Blink heap sizes; null when the runtime withholds them. */
    readHeapStatistics: () => RendererHeapStatistics | null
  }
  export: ExportApi
}
