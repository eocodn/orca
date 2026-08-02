import { contextBridge, ipcRenderer, webFrame, webUtils, electronAPI, preloadE2EConfig, glApi, admitSshConnectionStateForAuthorityReconciliation, admitSshDetectedPorts, richMarkdownContextMenuCommandChannel, type RichMarkdownContextMenuCommandPayload, createBrowserFindSubscriptions, ORCA_APP_RESTART_ABORTED_EVENT, ORCA_APP_RESTART_STARTED_EVENT, ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, ORCA_RENDERER_UNLOAD_PREVENTED_EVENT, ORCA_INTERNAL_FILE_DRAG_TYPE, createNativeFileDropPayload, createRejectedNativeFileDropPayload, hasNativeFileDragTypes, NATIVE_FILE_DROP_MAX_PATHS, resolveNativeFileDropPath, type NativeDropResolution, type NativeFileDropPayload, type NativeFileDropPathEntry, subscribeRuntimeEnvironmentFromPreload, readRendererHeapStatistics, createUpdaterQuitAbortRelay, prepareRendererForAppRestart, nativeFileDropCallbacks, nativeFileDropListenerRegistered, updaterQuitAbortRelay, getLinuxDisplayServer, onNativeFileDrop, subscribeNativeFileDrop, cachedNotificationSound, isNotificationSoundPlaying, cleanupNotificationSoundPlayback, clearNotificationSoundPlaybackState, disposeCachedNotificationSound, resolveNativeFileDrop, startupDiagnosticsEnabled, browserFindSubscriptions } from './preload-api-runtime-context'
import type { AppIdentity, DashboardSnapshot, DashboardRevealAgentArgs, TerminalPreviewConnectResult, TerminalPreviewDataPayload, CliInstallStatus, AgentHookInstallStatus, CodexConfigSyncStatus, TerminalPaneSplitSource, TerminalTabCreateReply, ProjectExecutionRuntimeResolution, StartupCommandDelivery, AgentProviderSessionMetadata, SleepingAgentLaunchConfig, MobileRelayStatus, MobilePairingConnectionMode, MobileRelayMintFailure, VerifyAndAddRuntimeEnvironmentResult, SshMutationExpectation, SshConnectionState, SshConfigImportResult, SshTargetAddResult, SshTarget, PortForwardEntry, EnrichedDetectedPort, HostRepoCatalogSnapshot, ListReposForExecutionHostArgs, HostLineageSnapshot, ListDesktopLineageForHostArgs, PluginPanelActionOutcome, PluginPanelEntry, PluginConsentRequest, PluginChangeEvent, BaseRefSearchResult, BaseRefDefaultResult, BrowserViewportOverride, CustomPet, FsChangedPayload, FilesystemPathFlavor, GetRateLimitResult, GitHubPRRefreshCandidate, GitHubPRRefreshEvent, GitHubPRRefreshReason, GitHubAssignableUser, GitHubCommentResult, GitHubCreateIssueResult, GitHubOwnerRepo, GitHubWorkItem, JiraProjectStatusOrder, GitPushTarget, GitStagingArea, GitForkSyncExpectedUpstream, GitForkSyncResult, GitUpstreamStatus, GhosttyImportPreview, ListWorkItemsResult, LinearProjectDetail, MemorySnapshot, NotificationDismissResult, NotificationDispatchResult, NotificationDeliveryProbeResult, NotificationPermissionStatusResult, NotificationSoundDataResult, NotificationSoundPathResult, NotificationSoundResult, NestedRepoScanResult, OnboardingState, PersistedUIState, FloatingTerminalCwdRequest, MarkdownDocument, SearchResult, TuiAgent, UpdateStatus, WorktreeBaseStatusEvent, WorktreeDefaultTabsLaunch, WorktreeHeadIdentity, WorktreeRemoteBranchConflictEvent, PtyModelRestoreNeededEvent, PtyListedSession, PtyRendererDeliveryHealthReply, PtyRendererDeliveryStateReport, TerminalViewAttributes, WriteTerminalRenderDesyncEvidenceArgs, PtyMainDeliveryDiagnostics, WarpThemeImportPreview, WarpThemeImportSource, GitHistoryOptions, GitHistoryResult, ShellOpenExternalEditorRequest, ShellOpenExternalEditorResult, ShellOpenLocalPathResult, SkillDiscoveryResult, SkillDiscoveryTarget, SkillFreshnessInventory, SkillUpdateRun, SkillUpdateStartResult, RuntimeBrowserDriverState, RuntimeMobileSessionTabMove, RuntimeStatus, RuntimeSyncWindowGraphResult, RuntimeSyncWindowGraph, RuntimeTerminalCreateRequestPayload, RuntimeTerminalDriverState, RuntimeTerminalPresentation, RuntimeRpcResponse, PublicKnownRuntimeEnvironment, RemoteWorkspaceChangedEvent, RuntimeMobileMarkdownRequest, RuntimeMobileMarkdownResponse, CodexRateLimitResetResult, GrokAccountStatus, RateLimitRuntimeTarget, RateLimitState, WorkspaceSpaceScanProgress, WorkspaceCleanupScanProgress, WorkspacePortAdvertisedUrlChangedEvent, GhAuthDiagnostic, TaskSourceContext, AddIssueCommentBySlugArgs, ClearProjectItemFieldArgs, DeleteIssueCommentBySlugArgs, GetProjectViewTableArgs, GetProjectViewTableResult, GitHubProjectCommentMutationResult, GitHubProjectMutationResult, ListAccessibleProjectsArgs, ListAccessibleProjectsResult, ListAssignableUsersBySlugArgs, ListAssignableUsersBySlugResult, ListIssueTypesBySlugArgs, ListIssueTypesBySlugResult, ListLabelsBySlugArgs, ListLabelsBySlugResult, ListProjectViewsArgs, ListProjectViewsResult, ProjectWorkItemDetailsBySlugArgs, ProjectWorkItemDetailsBySlugResult, ResolveProjectRefArgs, ResolveProjectRefResult, UpdateIssueBySlugArgs, UpdateIssueCommentBySlugArgs, UpdateIssueTypeBySlugArgs, UpdatePullRequestBySlugArgs, UpdateProjectItemFieldArgs, AgentStatusClearIpcPayload, AgentStatusIpcPayload, MigrationUnsupportedPtyEntry, AgentInterruptInferenceRequest, AgentQuestionAnsweredInferenceRequest, TerminalSideEffectBatch, SpeechErrorEvent, SpeechLifecycleEvent, SpeechModelManifest, SpeechModelState, SpeechTranscriptEvent, TelemetryConsentState, PreflightRuntimeContext, RefreshAgentsResult, NativeChatAppendedPayload, NativeChatReadSessionResult, NativeChatSubscriptionFrame, PluginHostInstallResult, PluginHostInstallSource, PluginHostListEntry, PluginHostLogLine, PreloadApi, AgentKind, LaunchSource, RequestKind, AppStarSource, ExecutionHostId, Automation, AutomationCreateInput, AutomationDispatchRequest, AutomationDispatchResult, ExternalAutomationCreateInput, ExternalAutomationActionInput, ExternalAutomationManager, ExternalAutomationRunsInput, ExternalAutomationRunsPage, ExternalAutomationUpdateInput, AutomationRun, AutomationPrecheckResult, AutomationUpdateInput, KeybindingActionId, KeybindingFileSnapshot, AiVaultListArgs, AiVaultSubagentListArgs, AiVaultPrepareSessionResumeArgs, AgentType, LocalLogTailChangedPayload, LocalLogTailReadArgs, LocalLogTailReadResult, LocalLogTailWatchArgs, RuntimeEnvironmentSubscriptionHandle, HostedReviewForBranchArgs, ReadClipboardTextOptions, LocalhostWorktreeLabelResult, LocalhostWorktreeLabelRoute, CrashReportBreadcrumbData, CrashReportCopyDiagnosticsArgs, CrashReportSubmitArgs, CrashReportSubmitResult, ReactErrorBoundaryReportArgs, ReactErrorBoundaryReportResult, RendererHeapStatistics, NativeFileDropCallback } from './preload-api-runtime-context'

export function createPreloadApiGit(): Record<string, unknown> {
  return {
  git: {
    status: (args: {
      worktreePath: string
      connectionId?: string
      includeIgnored?: boolean
      bypassEffectiveUpstreamNegativeCache?: boolean
      reuseLineStats?: boolean
      requestToken?: string
    }): Promise<unknown> => ipcRenderer.invoke('git:status', args),
    cancelStatus: (args: { requestToken: string }): Promise<void> =>
      ipcRenderer.invoke('git:cancelStatus', args),
    submoduleStatus: (args: {
      worktreePath: string
      submodulePath: string
      connectionId?: string
      area?: GitStagingArea
    }): Promise<unknown> => ipcRenderer.invoke('git:submoduleStatus', args),
    checkIgnored: (args: {
      worktreePath: string
      paths: string[]
      connectionId?: string
    }): Promise<string[]> => ipcRenderer.invoke('git:checkIgnored', args),
    findHugeFoldersToIgnore: (args: { worktreePath: string }): Promise<string[]> =>
      ipcRenderer.invoke('git:findHugeFoldersToIgnore', args),
    appendGitignore: (args: { worktreePath: string; folderName: string }): Promise<boolean> =>
      ipcRenderer.invoke('git:appendGitignore', args),
    history: (
      args: { worktreePath: string; connectionId?: string } & GitHistoryOptions
    ): Promise<GitHistoryResult> => ipcRenderer.invoke('git:history', args),
    conflictOperation: (args: { worktreePath: string; connectionId?: string }): Promise<unknown> =>
      ipcRenderer.invoke('git:conflictOperation', args),
    abortMerge: (args: { worktreePath: string; connectionId?: string }): Promise<void> =>
      ipcRenderer.invoke('git:abortMerge', args),
    abortRebase: (args: { worktreePath: string; connectionId?: string }): Promise<void> =>
      ipcRenderer.invoke('git:abortRebase', args),
    diff: (args: {
      worktreePath: string
      filePath: string
      staged: boolean
      compareAgainstHead?: boolean
      connectionId?: string
    }): Promise<unknown> => ipcRenderer.invoke('git:diff', args),
    branchCompare: (args: {
      worktreePath: string
      baseRef: string
      connectionId?: string
    }): Promise<unknown> => ipcRenderer.invoke('git:branchCompare', args),
    commitCompare: (args: {
      worktreePath: string
      commitId: string
      connectionId?: string
    }): Promise<unknown> => ipcRenderer.invoke('git:commitCompare', args),
    upstreamStatus: (args: {
      worktreePath: string
      connectionId?: string
      pushTarget?: GitPushTarget
    }): Promise<GitUpstreamStatus> => ipcRenderer.invoke('git:upstreamStatus', args),
    fetch: (args: {
      worktreePath: string
      connectionId?: string
      pushTarget?: GitPushTarget
    }): Promise<void> => ipcRenderer.invoke('git:fetch', args),
    syncFork: (args: {
      worktreePath: string
      connectionId?: string
      expectedUpstream: GitForkSyncExpectedUpstream
    }): Promise<GitForkSyncResult> => ipcRenderer.invoke('git:syncFork', args),
    push: (args: {
      worktreePath: string
      publish?: boolean
      forceWithLease?: boolean
      connectionId?: string
      pushTarget?: unknown
    }): Promise<void> => ipcRenderer.invoke('git:push', args),
    pull: (args: {
      worktreePath: string
      connectionId?: string
      pushTarget?: GitPushTarget
    }): Promise<void> => ipcRenderer.invoke('git:pull', args),
    fastForward: (args: {
      worktreePath: string
      connectionId?: string
      pushTarget?: GitPushTarget
    }): Promise<void> => ipcRenderer.invoke('git:fastForward', args),
    rebaseFromBase: (args: {
      worktreePath: string
      baseRef: string
      connectionId?: string
    }): Promise<void> => ipcRenderer.invoke('git:rebaseFromBase', args),
    branchDiff: (args: {
      worktreePath: string
      compare: { baseRef: string; baseOid: string; headOid: string; mergeBase: string }
      filePath: string
      oldPath?: string
      connectionId?: string
    }): Promise<unknown> => ipcRenderer.invoke('git:branchDiff', args),
    commitDiff: (args: {
      worktreePath: string
      commitOid: string
      parentOid?: string | null
      filePath: string
      oldPath?: string
      connectionId?: string
    }): Promise<unknown> => ipcRenderer.invoke('git:commitDiff', args),
    commit: (args: {
      worktreePath: string
      message: string
      connectionId?: string
    }): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('git:commit', args),
    generateCommitMessage: (args: {
      worktreePath: string
      worktreeId?: string
      repoId?: string
      connectionId?: string
      sourceControlAiResolvedParams?: unknown
      sourceControlAi?: unknown
      agentCmdOverrides?: Record<string, string>
    }): Promise<unknown> => ipcRenderer.invoke('git:generateCommitMessage', args),
    discoverCommitMessageModels: (args: {
      agentId: string
      worktreePath?: string
      connectionId?: string
    }): Promise<unknown> => ipcRenderer.invoke('git:discoverCommitMessageModels', args),
    cancelGenerateCommitMessage: (args: {
      worktreePath: string
      connectionId?: string
    }): Promise<void> => ipcRenderer.invoke('git:cancelGenerateCommitMessage', args),
    generatePullRequestFields: (args: {
      worktreePath: string
      worktreeId?: string
      repoId?: string
      base: string
      title: string
      body: string
      draft: boolean
      provider?: unknown
      useTemplate?: boolean
      connectionId?: string
      sourceControlAiResolvedParams?: unknown
      sourceControlAi?: unknown
      agentCmdOverrides?: Record<string, string>
    }): Promise<unknown> => ipcRenderer.invoke('git:generatePullRequestFields', args),
    cancelGeneratePullRequestFields: (args: {
      worktreePath: string
      connectionId?: string
    }): Promise<void> => ipcRenderer.invoke('git:cancelGeneratePullRequestFields', args),
    stage: (args: {
      worktreePath: string
      filePath: string
      connectionId?: string
    }): Promise<void> => ipcRenderer.invoke('git:stage', args),
    bulkStage: (args: {
      worktreePath: string
      filePaths: string[]
      connectionId?: string
    }): Promise<void> => ipcRenderer.invoke('git:bulkStage', args),
    unstage: (args: {
      worktreePath: string
      filePath: string
      connectionId?: string
    }): Promise<void> => ipcRenderer.invoke('git:unstage', args),
    bulkUnstage: (args: {
      worktreePath: string
      filePaths: string[]
      connectionId?: string
    }): Promise<void> => ipcRenderer.invoke('git:bulkUnstage', args),
    discard: (args: {
      worktreePath: string
      filePath: string
      connectionId?: string
    }): Promise<void> => ipcRenderer.invoke('git:discard', args),
    bulkDiscard: (args: {
      worktreePath: string
      filePaths: string[]
      connectionId?: string
    }): Promise<void> => ipcRenderer.invoke('git:bulkDiscard', args),
    remoteFileUrl: (args: {
      worktreePath: string
      relativePath: string
      line: number
      connectionId?: string
    }): Promise<string | null> => ipcRenderer.invoke('git:remoteFileUrl', args),
    remoteCommitUrl: (args: {
      worktreePath: string
      sha: string
      connectionId?: string
    }): Promise<string | null> => ipcRenderer.invoke('git:remoteCommitUrl', args)
  },
  }
}
