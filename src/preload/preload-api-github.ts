import { contextBridge, ipcRenderer, webFrame, webUtils, electronAPI, preloadE2EConfig, glApi, admitSshConnectionStateForAuthorityReconciliation, admitSshDetectedPorts, richMarkdownContextMenuCommandChannel, type RichMarkdownContextMenuCommandPayload, createBrowserFindSubscriptions, ORCA_APP_RESTART_ABORTED_EVENT, ORCA_APP_RESTART_STARTED_EVENT, ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, ORCA_RENDERER_UNLOAD_PREVENTED_EVENT, ORCA_INTERNAL_FILE_DRAG_TYPE, createNativeFileDropPayload, createRejectedNativeFileDropPayload, hasNativeFileDragTypes, NATIVE_FILE_DROP_MAX_PATHS, resolveNativeFileDropPath, type NativeDropResolution, type NativeFileDropPayload, type NativeFileDropPathEntry, subscribeRuntimeEnvironmentFromPreload, readRendererHeapStatistics, createUpdaterQuitAbortRelay, prepareRendererForAppRestart, nativeFileDropCallbacks, nativeFileDropListenerRegistered, updaterQuitAbortRelay, getLinuxDisplayServer, onNativeFileDrop, subscribeNativeFileDrop, resolveNativeFileDrop, startupDiagnosticsEnabled, browserFindSubscriptions } from './preload-api-runtime-context'
import type { AppIdentity, DashboardSnapshot, DashboardRevealAgentArgs, TerminalPreviewConnectResult, TerminalPreviewDataPayload, CliInstallStatus, AgentHookInstallStatus, CodexConfigSyncStatus, TerminalPaneSplitSource, TerminalTabCreateReply, ProjectExecutionRuntimeResolution, StartupCommandDelivery, AgentProviderSessionMetadata, SleepingAgentLaunchConfig, MobileRelayStatus, MobilePairingConnectionMode, MobileRelayMintFailure, VerifyAndAddRuntimeEnvironmentResult, SshMutationExpectation, SshConnectionState, SshConfigImportResult, SshTargetAddResult, SshTarget, PortForwardEntry, EnrichedDetectedPort, HostRepoCatalogSnapshot, ListReposForExecutionHostArgs, HostLineageSnapshot, ListDesktopLineageForHostArgs, PluginPanelActionOutcome, PluginPanelEntry, PluginConsentRequest, PluginChangeEvent, BaseRefSearchResult, BaseRefDefaultResult, BrowserViewportOverride, CustomPet, FsChangedPayload, FilesystemPathFlavor, GetRateLimitResult, GitHubPRRefreshCandidate, GitHubPRRefreshEvent, GitHubPRRefreshReason, GitHubAssignableUser, GitHubCommentResult, GitHubCreateIssueResult, GitHubOwnerRepo, GitHubWorkItem, JiraProjectStatusOrder, GitPushTarget, GitStagingArea, GitForkSyncExpectedUpstream, GitForkSyncResult, GitUpstreamStatus, GhosttyImportPreview, ListWorkItemsResult, LinearProjectDetail, MemorySnapshot, NotificationDismissResult, NotificationDispatchResult, NotificationDeliveryProbeResult, NotificationPermissionStatusResult, NotificationSoundDataResult, NotificationSoundPathResult, NotificationSoundResult, NestedRepoScanResult, OnboardingState, PersistedUIState, FloatingTerminalCwdRequest, MarkdownDocument, SearchResult, TuiAgent, UpdateStatus, WorktreeBaseStatusEvent, WorktreeDefaultTabsLaunch, WorktreeHeadIdentity, WorktreeRemoteBranchConflictEvent, PtyModelRestoreNeededEvent, PtyListedSession, PtyRendererDeliveryHealthReply, PtyRendererDeliveryStateReport, TerminalViewAttributes, WriteTerminalRenderDesyncEvidenceArgs, PtyMainDeliveryDiagnostics, WarpThemeImportPreview, WarpThemeImportSource, GitHistoryOptions, GitHistoryResult, ShellOpenExternalEditorRequest, ShellOpenExternalEditorResult, ShellOpenLocalPathResult, SkillDiscoveryResult, SkillDiscoveryTarget, SkillFreshnessInventory, SkillUpdateRun, SkillUpdateStartResult, RuntimeBrowserDriverState, RuntimeMobileSessionTabMove, RuntimeStatus, RuntimeSyncWindowGraphResult, RuntimeSyncWindowGraph, RuntimeTerminalCreateRequestPayload, RuntimeTerminalDriverState, RuntimeTerminalPresentation, RuntimeRpcResponse, PublicKnownRuntimeEnvironment, RemoteWorkspaceChangedEvent, RuntimeMobileMarkdownRequest, RuntimeMobileMarkdownResponse, CodexRateLimitResetResult, GrokAccountStatus, RateLimitRuntimeTarget, RateLimitState, WorkspaceSpaceScanProgress, WorkspaceCleanupScanProgress, WorkspacePortAdvertisedUrlChangedEvent, GhAuthDiagnostic, TaskSourceContext, AddIssueCommentBySlugArgs, ClearProjectItemFieldArgs, DeleteIssueCommentBySlugArgs, GetProjectViewTableArgs, GetProjectViewTableResult, GitHubProjectCommentMutationResult, GitHubProjectMutationResult, ListAccessibleProjectsArgs, ListAccessibleProjectsResult, ListAssignableUsersBySlugArgs, ListAssignableUsersBySlugResult, ListIssueTypesBySlugArgs, ListIssueTypesBySlugResult, ListLabelsBySlugArgs, ListLabelsBySlugResult, ListProjectViewsArgs, ListProjectViewsResult, ProjectWorkItemDetailsBySlugArgs, ProjectWorkItemDetailsBySlugResult, ResolveProjectRefArgs, ResolveProjectRefResult, UpdateIssueBySlugArgs, UpdateIssueCommentBySlugArgs, UpdateIssueTypeBySlugArgs, UpdatePullRequestBySlugArgs, UpdateProjectItemFieldArgs, AgentStatusClearIpcPayload, AgentStatusIpcPayload, MigrationUnsupportedPtyEntry, AgentInterruptInferenceRequest, AgentQuestionAnsweredInferenceRequest, TerminalSideEffectBatch, SpeechErrorEvent, SpeechLifecycleEvent, SpeechModelManifest, SpeechModelState, SpeechTranscriptEvent, TelemetryConsentState, PreflightRuntimeContext, RefreshAgentsResult, NativeChatAppendedPayload, NativeChatReadSessionResult, NativeChatSubscriptionFrame, PluginHostInstallResult, PluginHostInstallSource, PluginHostListEntry, PluginHostLogLine, PreloadApi, AgentKind, LaunchSource, RequestKind, AppStarSource, ExecutionHostId, Automation, AutomationCreateInput, AutomationDispatchRequest, AutomationDispatchResult, ExternalAutomationCreateInput, ExternalAutomationActionInput, ExternalAutomationManager, ExternalAutomationRunsInput, ExternalAutomationRunsPage, ExternalAutomationUpdateInput, AutomationRun, AutomationPrecheckResult, AutomationUpdateInput, KeybindingActionId, KeybindingFileSnapshot, AiVaultListArgs, AiVaultSubagentListArgs, AiVaultPrepareSessionResumeArgs, AgentType, LocalLogTailChangedPayload, LocalLogTailReadArgs, LocalLogTailReadResult, LocalLogTailWatchArgs, RuntimeEnvironmentSubscriptionHandle, HostedReviewForBranchArgs, ReadClipboardTextOptions, LocalhostWorktreeLabelResult, LocalhostWorktreeLabelRoute, CrashReportBreadcrumbData, CrashReportCopyDiagnosticsArgs, CrashReportSubmitArgs, CrashReportSubmitResult, ReactErrorBoundaryReportArgs, ReactErrorBoundaryReportResult, RendererHeapStatistics, NativeFileDropCallback } from './preload-api-runtime-context'

export function createPreloadApiGithub(): Record<string, unknown> {
  return {
  gh: {
    viewer: (): Promise<unknown> => ipcRenderer.invoke('gh:viewer'),

    repoSlug: (args: { repoPath: string; repoId?: string }): Promise<unknown> =>
      ipcRenderer.invoke('gh:repoSlug', args),

    repoUpstream: (args: { repoPath: string; repoId?: string }): Promise<unknown> =>
      ipcRenderer.invoke('gh:repoUpstream', args),

    prForBranch: (args: {
      repoPath: string
      repoId?: string
      branch: string
      linkedPRNumber?: number | null
      fallbackPRNumber?: number | null
      acceptMergedFallbackPR?: boolean
      currentHeadOid?: string | null
    }): Promise<unknown> => ipcRenderer.invoke('gh:prForBranch', args),

    refreshPRNow: (args: { candidate: GitHubPRRefreshCandidate }): Promise<unknown> =>
      ipcRenderer.invoke('gh:refreshPRNow', args),

    enqueuePRRefresh: (args: {
      candidate: GitHubPRRefreshCandidate
      reason: GitHubPRRefreshReason
      priority?: number
    }): Promise<unknown> => ipcRenderer.invoke('gh:enqueuePRRefresh', args),

    reportVisiblePRRefreshCandidates: (args: {
      candidates: GitHubPRRefreshCandidate[]
      generation: number
    }): Promise<unknown> => ipcRenderer.invoke('gh:reportVisiblePRRefreshCandidates', args),

    onPRRefreshEvent: (callback: (event: GitHubPRRefreshEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, event: GitHubPRRefreshEvent): void =>
        callback(event)
      ipcRenderer.on('gh:prRefreshEvent', listener)
      return () => ipcRenderer.removeListener('gh:prRefreshEvent', listener)
    },

    issue: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      number: number
    }): Promise<unknown> => ipcRenderer.invoke('gh:issue', args),

    workItem: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      number: number
      type?: 'issue' | 'pr'
    }): Promise<unknown> => ipcRenderer.invoke('gh:workItem', args),

    workItemByOwnerRepo: (args: {
      repoPath: string
      repoId?: string
      owner: string
      repo: string
      host?: string
      number: number
      type: 'issue' | 'pr'
    }): Promise<unknown> => ipcRenderer.invoke('gh:workItemByOwnerRepo', args),

    workItemDetails: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      number: number
      type?: 'issue' | 'pr'
    }): Promise<unknown> => ipcRenderer.invoke('gh:workItemDetails', args),

    notifyWorkItemMutated: (args: {
      repoPath: string
      repoId?: string
      type: 'issue' | 'pr'
      number: number
    }): Promise<boolean> => ipcRenderer.invoke('gh:notifyWorkItemMutated', args),

    prFileContents: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      prRepo?: GitHubOwnerRepo | null
      path: string
      oldPath?: string
      status: string
      headSha: string
      baseSha: string
    }): Promise<unknown> => ipcRenderer.invoke('gh:prFileContents', args),

    listIssues: (args: { repoPath: string; repoId?: string; limit?: number }): Promise<unknown[]> =>
      ipcRenderer.invoke('gh:listIssues', args),

    createIssue: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      title: string
      body: string
      labels?: string[]
      assignees?: string[]
    }): Promise<GitHubCreateIssueResult> => ipcRenderer.invoke('gh:createIssue', args),

    countWorkItems: (args: {
      repoPath: string
      repoId?: string
      query?: string
    }): Promise<number> => ipcRenderer.invoke('gh:countWorkItems', args),

    listWorkItems: (args: {
      repoPath: string
      repoId?: string
      limit?: number
      query?: string
      page?: number
      noCache?: boolean
    }): Promise<ListWorkItemsResult<Omit<GitHubWorkItem, 'repoId'>>> =>
      ipcRenderer.invoke('gh:listWorkItems', args),

    prChecks: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      headSha?: string
      prRepo?: GitHubOwnerRepo | null
      noCache?: boolean
    }): Promise<unknown[]> => ipcRenderer.invoke('gh:prChecks', args),

    prCheckDetails: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      checkRunId?: number
      workflowRunId?: number
      checkName?: string
      url?: string | null
      prRepo?: GitHubOwnerRepo | null
    }): Promise<unknown | null> => ipcRenderer.invoke('gh:prCheckDetails', args),

    rerunPRChecks: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      headSha?: string
      failedOnly?: boolean
      prRepo?: GitHubOwnerRepo | null
    }): Promise<{ ok: true; count: number } | { ok: false; error: string }> =>
      ipcRenderer.invoke('gh:rerunPRChecks', args),

    prComments: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      prRepo?: GitHubOwnerRepo | null
      noCache?: boolean
    }): Promise<unknown[]> => ipcRenderer.invoke('gh:prComments', args),

    resolveReviewThread: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      threadId: string
      resolve: boolean
      prRepo?: GitHubOwnerRepo | null
    }): Promise<boolean> => ipcRenderer.invoke('gh:resolveReviewThread', args),

    setPRFileViewed: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      prRepo?: GitHubOwnerRepo | null
      pullRequestId: string
      path: string
      viewed: boolean
    }): Promise<boolean> => ipcRenderer.invoke('gh:setPRFileViewed', args),

    updatePRTitle: (args: {
      repoPath: string
      repoId?: string
      prNumber: number
      title: string
      prRepo?: GitHubOwnerRepo | null
    }): Promise<boolean> => ipcRenderer.invoke('gh:updatePRTitle', args),

    mergePR: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      method?: 'merge' | 'squash' | 'rebase'
      prRepo?: GitHubOwnerRepo | null
    }): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('gh:mergePR', args),

    setPRAutoMerge: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      enabled: boolean
      method?: 'merge' | 'squash' | 'rebase'
      prRepo?: GitHubOwnerRepo | null
    }): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('gh:setPRAutoMerge', args),

    updatePRState: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      updates: { state: 'open' | 'closed' }
      prRepo?: GitHubOwnerRepo | null
    }): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('gh:updatePRState', args),

    requestPRReviewers: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      reviewers: string[]
      prRepo?: GitHubOwnerRepo | null
    }): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('gh:requestPRReviewers', args),

    removePRReviewers: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      reviewers: string[]
      prRepo?: GitHubOwnerRepo | null
    }): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('gh:removePRReviewers', args),

    updateIssue: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      number: number
      updates: unknown
    }): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('gh:updateIssue', args),

    addIssueComment: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      number: number
      body: string
      type?: 'issue' | 'pr'
      prRepo?: GitHubOwnerRepo | null
    }): Promise<GitHubCommentResult> => ipcRenderer.invoke('gh:addIssueComment', args),

    addPRReviewCommentReply: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      commentId: number
      body: string
      threadId?: string
      path?: string
      line?: number
      prRepo?: GitHubOwnerRepo | null
    }): Promise<GitHubCommentResult> => ipcRenderer.invoke('gh:addPRReviewCommentReply', args),

    addPRReviewComment: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      prRepo?: GitHubOwnerRepo | null
      commitId: string
      path: string
      line: number
      startLine?: number
      body: string
    }): Promise<GitHubCommentResult> => ipcRenderer.invoke('gh:addPRReviewComment', args),

    listLabels: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
    }): Promise<string[]> => ipcRenderer.invoke('gh:listLabels', args),

    listAssignableUsers: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
    }): Promise<GitHubAssignableUser[]> => ipcRenderer.invoke('gh:listAssignableUsers', args),

    // Why: renderer owns the work-item cache; main fires this for non-origin mutations only (origin callers updated optimistically). See src/main/ipc/github.ts.
    onWorkItemMutated: (
      callback: (payload: {
        repoPath: string
        repoId?: string
        type: 'issue' | 'pr'
        number: number
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { repoPath: string; repoId?: string; type: 'issue' | 'pr'; number: number }
      ): void => callback(payload)
      ipcRenderer.on('gh:workItemMutated', listener)
      return () => ipcRenderer.removeListener('gh:workItemMutated', listener)
    },

    checkOrcaStarred: (): Promise<boolean | null> => ipcRenderer.invoke('gh:checkOrcaStarred'),
    starOrca: (source: AppStarSource): Promise<boolean> =>
      ipcRenderer.invoke('gh:starOrca', source),

    // Why: rate_limit is exempt from rate-limit accounting; `force` still busts the 30s in-process cache after an expensive op.
    rateLimit: (args?: { force?: boolean }): Promise<GetRateLimitResult> =>
      ipcRenderer.invoke('gh:rateLimit', args),

    diagnoseAuth: (args?: { host?: string }): Promise<GhAuthDiagnostic> =>
      ipcRenderer.invoke('gh:diagnoseAuth', args),

    // ── ProjectV2 (GitHub Projects) ───────────────────────────────────
    listAccessibleProjects: (
      args?: ListAccessibleProjectsArgs
    ): Promise<ListAccessibleProjectsResult> =>
      ipcRenderer.invoke('gh:listAccessibleProjects', args),
    resolveProjectRef: (args: ResolveProjectRefArgs): Promise<ResolveProjectRefResult> =>
      ipcRenderer.invoke('gh:resolveProjectRef', args),
    listProjectViews: (args: ListProjectViewsArgs): Promise<ListProjectViewsResult> =>
      ipcRenderer.invoke('gh:listProjectViews', args),
    getProjectViewTable: (args: GetProjectViewTableArgs): Promise<GetProjectViewTableResult> =>
      ipcRenderer.invoke('gh:getProjectViewTable', args),
    projectWorkItemDetailsBySlug: (
      args: ProjectWorkItemDetailsBySlugArgs
    ): Promise<ProjectWorkItemDetailsBySlugResult> =>
      ipcRenderer.invoke('gh:projectWorkItemDetailsBySlug', args),
    updateProjectItemField: (
      args: UpdateProjectItemFieldArgs
    ): Promise<GitHubProjectMutationResult> =>
      ipcRenderer.invoke('gh:updateProjectItemField', args),
    clearProjectItemField: (
      args: ClearProjectItemFieldArgs
    ): Promise<GitHubProjectMutationResult> => ipcRenderer.invoke('gh:clearProjectItemField', args),
    updateIssueBySlug: (args: UpdateIssueBySlugArgs): Promise<GitHubProjectMutationResult> =>
      ipcRenderer.invoke('gh:updateIssueBySlug', args),
    updatePullRequestBySlug: (
      args: UpdatePullRequestBySlugArgs
    ): Promise<GitHubProjectMutationResult> =>
      ipcRenderer.invoke('gh:updatePullRequestBySlug', args),
    addIssueCommentBySlug: (
      args: AddIssueCommentBySlugArgs
    ): Promise<GitHubProjectCommentMutationResult> =>
      ipcRenderer.invoke('gh:addIssueCommentBySlug', args),
    updateIssueCommentBySlug: (
      args: UpdateIssueCommentBySlugArgs
    ): Promise<GitHubProjectMutationResult> =>
      ipcRenderer.invoke('gh:updateIssueCommentBySlug', args),
    deleteIssueCommentBySlug: (
      args: DeleteIssueCommentBySlugArgs
    ): Promise<GitHubProjectMutationResult> =>
      ipcRenderer.invoke('gh:deleteIssueCommentBySlug', args),
    listLabelsBySlug: (args: ListLabelsBySlugArgs): Promise<ListLabelsBySlugResult> =>
      ipcRenderer.invoke('gh:listLabelsBySlug', args),
    listAssignableUsersBySlug: (
      args: ListAssignableUsersBySlugArgs
    ): Promise<ListAssignableUsersBySlugResult> =>
      ipcRenderer.invoke('gh:listAssignableUsersBySlug', args),
    listIssueTypesBySlug: (args: ListIssueTypesBySlugArgs): Promise<ListIssueTypesBySlugResult> =>
      ipcRenderer.invoke('gh:listIssueTypesBySlug', args),
    updateIssueTypeBySlug: (
      args: UpdateIssueTypeBySlugArgs
    ): Promise<GitHubProjectMutationResult> => ipcRenderer.invoke('gh:updateIssueTypeBySlug', args)
  },
  hostedReview: {
    forBranch: (args: HostedReviewForBranchArgs): Promise<unknown> =>
      ipcRenderer.invoke('hostedReview:forBranch', args),
    getCreationEligibility: (args: unknown): Promise<unknown> =>
      ipcRenderer.invoke('hostedReview:getCreationEligibility', args),
    create: (args: unknown): Promise<unknown> => ipcRenderer.invoke('hostedReview:create', args)
  },

  // Why: GitLab bindings live in `./gitlab` so `gl.*` changes don't conflict on every upstream sync of this central file.
  gl: glApi,
  }
}
