import { contextBridge, ipcRenderer, webFrame, webUtils, electronAPI, preloadE2EConfig, glApi, admitSshConnectionStateForAuthorityReconciliation, admitSshDetectedPorts, richMarkdownContextMenuCommandChannel, type RichMarkdownContextMenuCommandPayload, createBrowserFindSubscriptions, ORCA_APP_RESTART_ABORTED_EVENT, ORCA_APP_RESTART_STARTED_EVENT, ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, ORCA_RENDERER_UNLOAD_PREVENTED_EVENT, ORCA_INTERNAL_FILE_DRAG_TYPE, createNativeFileDropPayload, createRejectedNativeFileDropPayload, hasNativeFileDragTypes, NATIVE_FILE_DROP_MAX_PATHS, resolveNativeFileDropPath, type NativeDropResolution, type NativeFileDropPayload, type NativeFileDropPathEntry, subscribeRuntimeEnvironmentFromPreload, readRendererHeapStatistics, createUpdaterQuitAbortRelay, prepareRendererForAppRestart, nativeFileDropCallbacks, nativeFileDropListenerRegistered, updaterQuitAbortRelay, getLinuxDisplayServer, onNativeFileDrop, subscribeNativeFileDrop, resolveNativeFileDrop, startupDiagnosticsEnabled, browserFindSubscriptions } from './preload-api-runtime-context'
import type { AppIdentity, DashboardSnapshot, DashboardRevealAgentArgs, TerminalPreviewConnectResult, TerminalPreviewDataPayload, CliInstallStatus, AgentHookInstallStatus, CodexConfigSyncStatus, TerminalPaneSplitSource, TerminalTabCreateReply, ProjectExecutionRuntimeResolution, StartupCommandDelivery, AgentProviderSessionMetadata, SleepingAgentLaunchConfig, MobileRelayStatus, MobilePairingConnectionMode, MobileRelayMintFailure, VerifyAndAddRuntimeEnvironmentResult, SshMutationExpectation, SshConnectionState, SshConfigImportResult, SshTargetAddResult, SshTarget, PortForwardEntry, EnrichedDetectedPort, HostRepoCatalogSnapshot, ListReposForExecutionHostArgs, HostLineageSnapshot, ListDesktopLineageForHostArgs, PluginPanelActionOutcome, PluginPanelEntry, PluginConsentRequest, PluginChangeEvent, BaseRefSearchResult, BaseRefDefaultResult, BrowserViewportOverride, CustomPet, FsChangedPayload, FilesystemPathFlavor, GetRateLimitResult, GitHubPRRefreshCandidate, GitHubPRRefreshEvent, GitHubPRRefreshReason, GitHubAssignableUser, GitHubCommentResult, GitHubCreateIssueResult, GitHubOwnerRepo, GitHubWorkItem, JiraProjectStatusOrder, GitPushTarget, GitStagingArea, GitForkSyncExpectedUpstream, GitForkSyncResult, GitUpstreamStatus, GhosttyImportPreview, ListWorkItemsResult, LinearProjectDetail, MemorySnapshot, NotificationDismissResult, NotificationDispatchResult, NotificationDeliveryProbeResult, NotificationPermissionStatusResult, NotificationSoundDataResult, NotificationSoundPathResult, NotificationSoundResult, NestedRepoScanResult, OnboardingState, PersistedUIState, FloatingTerminalCwdRequest, MarkdownDocument, SearchResult, TuiAgent, UpdateStatus, WorktreeBaseStatusEvent, WorktreeDefaultTabsLaunch, WorktreeHeadIdentity, WorktreeRemoteBranchConflictEvent, PtyModelRestoreNeededEvent, PtyListedSession, PtyRendererDeliveryHealthReply, PtyRendererDeliveryStateReport, TerminalViewAttributes, WriteTerminalRenderDesyncEvidenceArgs, PtyMainDeliveryDiagnostics, WarpThemeImportPreview, WarpThemeImportSource, GitHistoryOptions, GitHistoryResult, ShellOpenExternalEditorRequest, ShellOpenExternalEditorResult, ShellOpenLocalPathResult, SkillDiscoveryResult, SkillDiscoveryTarget, SkillFreshnessInventory, SkillUpdateRun, SkillUpdateStartResult, RuntimeBrowserDriverState, RuntimeMobileSessionTabMove, RuntimeStatus, RuntimeSyncWindowGraphResult, RuntimeSyncWindowGraph, RuntimeTerminalCreateRequestPayload, RuntimeTerminalDriverState, RuntimeTerminalPresentation, RuntimeRpcResponse, PublicKnownRuntimeEnvironment, RemoteWorkspaceChangedEvent, RuntimeMobileMarkdownRequest, RuntimeMobileMarkdownResponse, CodexRateLimitResetResult, GrokAccountStatus, RateLimitRuntimeTarget, RateLimitState, WorkspaceSpaceScanProgress, WorkspaceCleanupScanProgress, WorkspacePortAdvertisedUrlChangedEvent, GhAuthDiagnostic, TaskSourceContext, AddIssueCommentBySlugArgs, ClearProjectItemFieldArgs, DeleteIssueCommentBySlugArgs, GetProjectViewTableArgs, GetProjectViewTableResult, GitHubProjectCommentMutationResult, GitHubProjectMutationResult, ListAccessibleProjectsArgs, ListAccessibleProjectsResult, ListAssignableUsersBySlugArgs, ListAssignableUsersBySlugResult, ListIssueTypesBySlugArgs, ListIssueTypesBySlugResult, ListLabelsBySlugArgs, ListLabelsBySlugResult, ListProjectViewsArgs, ListProjectViewsResult, ProjectWorkItemDetailsBySlugArgs, ProjectWorkItemDetailsBySlugResult, ResolveProjectRefArgs, ResolveProjectRefResult, UpdateIssueBySlugArgs, UpdateIssueCommentBySlugArgs, UpdateIssueTypeBySlugArgs, UpdatePullRequestBySlugArgs, UpdateProjectItemFieldArgs, AgentStatusClearIpcPayload, AgentStatusIpcPayload, MigrationUnsupportedPtyEntry, AgentInterruptInferenceRequest, AgentQuestionAnsweredInferenceRequest, TerminalSideEffectBatch, SpeechErrorEvent, SpeechLifecycleEvent, SpeechModelManifest, SpeechModelState, SpeechTranscriptEvent, TelemetryConsentState, PreflightRuntimeContext, RefreshAgentsResult, NativeChatAppendedPayload, NativeChatReadSessionResult, NativeChatSubscriptionFrame, PluginHostInstallResult, PluginHostInstallSource, PluginHostListEntry, PluginHostLogLine, PreloadApi, AgentKind, LaunchSource, RequestKind, AppStarSource, ExecutionHostId, Automation, AutomationCreateInput, AutomationDispatchRequest, AutomationDispatchResult, ExternalAutomationCreateInput, ExternalAutomationActionInput, ExternalAutomationManager, ExternalAutomationRunsInput, ExternalAutomationRunsPage, ExternalAutomationUpdateInput, AutomationRun, AutomationPrecheckResult, AutomationUpdateInput, KeybindingActionId, KeybindingFileSnapshot, AiVaultListArgs, AiVaultSubagentListArgs, AiVaultPrepareSessionResumeArgs, AgentType, LocalLogTailChangedPayload, LocalLogTailReadArgs, LocalLogTailReadResult, LocalLogTailWatchArgs, RuntimeEnvironmentSubscriptionHandle, HostedReviewForBranchArgs, ReadClipboardTextOptions, LocalhostWorktreeLabelResult, LocalhostWorktreeLabelRoute, CrashReportBreadcrumbData, CrashReportCopyDiagnosticsArgs, CrashReportSubmitArgs, CrashReportSubmitResult, ReactErrorBoundaryReportArgs, ReactErrorBoundaryReportResult, RendererHeapStatistics, NativeFileDropCallback } from './preload-api-runtime-context'

export function createPreloadApiSpeech(): Record<string, unknown> {
  return {
  speech: {
    getCatalog: (): Promise<SpeechModelManifest[]> => ipcRenderer.invoke('speech:getCatalog'),
    getModelStates: (): Promise<SpeechModelState[]> => ipcRenderer.invoke('speech:getModelStates'),
    getOpenAiApiKeyStatus: (): Promise<{ configured: boolean }> =>
      ipcRenderer.invoke('speech:getOpenAiApiKeyStatus'),
    saveOpenAiApiKey: (apiKey: string): Promise<{ configured: boolean }> =>
      ipcRenderer.invoke('speech:saveOpenAiApiKey', apiKey),
    clearOpenAiApiKey: (): Promise<{ configured: boolean }> =>
      ipcRenderer.invoke('speech:clearOpenAiApiKey'),
    downloadModel: (modelId: string): Promise<void> =>
      ipcRenderer.invoke('speech:downloadModel', modelId),
    cancelDownload: (modelId: string): Promise<void> =>
      ipcRenderer.invoke('speech:cancelDownload', modelId),
    deleteModel: (modelId: string): Promise<void> =>
      ipcRenderer.invoke('speech:deleteModel', modelId),
    startDictation: (
      modelId: string,
      hotwords: string[] | undefined,
      sessionId: string
    ): Promise<void> => ipcRenderer.invoke('speech:startDictation', modelId, hotwords, sessionId),
    feedAudio: (samples: Float32Array, sampleRate: number, sessionId = 'desktop'): Promise<void> =>
      // Why: Float32Array is zeroed crossing the contextBridge/IPC boundary; wrap in a Buffer to preserve bytes.
      ipcRenderer.invoke(
        'speech:feedAudio',
        Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength),
        sampleRate,
        sessionId
      ),
    stopDictation: (sessionId = 'desktop'): Promise<void> =>
      ipcRenderer.invoke('speech:stopDictation', sessionId),

    onPartialTranscript: (callback: (data: SpeechTranscriptEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: SpeechTranscriptEvent): void =>
        callback(data)
      ipcRenderer.on('speech:partial', listener)
      return () => ipcRenderer.removeListener('speech:partial', listener)
    },
    onFinalTranscript: (callback: (data: SpeechTranscriptEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: SpeechTranscriptEvent): void =>
        callback(data)
      ipcRenderer.on('speech:final', listener)
      return () => ipcRenderer.removeListener('speech:final', listener)
    },
    onDownloadProgress: (
      callback: (data: { modelId: string; progress: number }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { modelId: string; progress: number }
      ): void => callback(data)
      ipcRenderer.on('speech:downloadProgress', listener)
      return () => ipcRenderer.removeListener('speech:downloadProgress', listener)
    },
    onReady: (callback: (data: SpeechLifecycleEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: SpeechLifecycleEvent): void =>
        callback(data)
      ipcRenderer.on('speech:ready', listener)
      return () => ipcRenderer.removeListener('speech:ready', listener)
    },
    onStopped: (callback: (data: SpeechLifecycleEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: SpeechLifecycleEvent): void =>
        callback(data)
      ipcRenderer.on('speech:stopped', listener)
      return () => ipcRenderer.removeListener('speech:stopped', listener)
    },
    onError: (callback: (data: SpeechErrorEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: SpeechErrorEvent): void =>
        callback(data)
      ipcRenderer.on('speech:error', listener)
      return () => ipcRenderer.removeListener('speech:error', listener)
    }
  }
  }
}
