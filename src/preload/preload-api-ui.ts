import { contextBridge, ipcRenderer, webFrame, webUtils, electronAPI, preloadE2EConfig, glApi, admitSshConnectionStateForAuthorityReconciliation, admitSshDetectedPorts, richMarkdownContextMenuCommandChannel, type RichMarkdownContextMenuCommandPayload, createBrowserFindSubscriptions, ORCA_APP_RESTART_ABORTED_EVENT, ORCA_APP_RESTART_STARTED_EVENT, ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, ORCA_RENDERER_UNLOAD_PREVENTED_EVENT, ORCA_INTERNAL_FILE_DRAG_TYPE, createNativeFileDropPayload, createRejectedNativeFileDropPayload, hasNativeFileDragTypes, NATIVE_FILE_DROP_MAX_PATHS, resolveNativeFileDropPath, type NativeDropResolution, type NativeFileDropPayload, type NativeFileDropPathEntry, subscribeRuntimeEnvironmentFromPreload, readRendererHeapStatistics, createUpdaterQuitAbortRelay, prepareRendererForAppRestart, nativeFileDropCallbacks, nativeFileDropListenerRegistered, updaterQuitAbortRelay, getLinuxDisplayServer, onNativeFileDrop, subscribeNativeFileDrop, cachedNotificationSound, isNotificationSoundPlaying, cleanupNotificationSoundPlayback, clearNotificationSoundPlaybackState, disposeCachedNotificationSound, resolveNativeFileDrop, startupDiagnosticsEnabled, browserFindSubscriptions } from './preload-api-runtime-context'
import type { AppIdentity, DashboardSnapshot, DashboardRevealAgentArgs, TerminalPreviewConnectResult, TerminalPreviewDataPayload, CliInstallStatus, AgentHookInstallStatus, CodexConfigSyncStatus, TerminalPaneSplitSource, TerminalTabCreateReply, ProjectExecutionRuntimeResolution, StartupCommandDelivery, AgentProviderSessionMetadata, SleepingAgentLaunchConfig, MobileRelayStatus, MobilePairingConnectionMode, MobileRelayMintFailure, VerifyAndAddRuntimeEnvironmentResult, SshMutationExpectation, SshConnectionState, SshConfigImportResult, SshTargetAddResult, SshTarget, PortForwardEntry, EnrichedDetectedPort, HostRepoCatalogSnapshot, ListReposForExecutionHostArgs, HostLineageSnapshot, ListDesktopLineageForHostArgs, PluginPanelActionOutcome, PluginPanelEntry, PluginConsentRequest, PluginChangeEvent, BaseRefSearchResult, BaseRefDefaultResult, BrowserViewportOverride, CustomPet, FsChangedPayload, FilesystemPathFlavor, GetRateLimitResult, GitHubPRRefreshCandidate, GitHubPRRefreshEvent, GitHubPRRefreshReason, GitHubAssignableUser, GitHubCommentResult, GitHubCreateIssueResult, GitHubOwnerRepo, GitHubWorkItem, JiraProjectStatusOrder, GitPushTarget, GitStagingArea, GitForkSyncExpectedUpstream, GitForkSyncResult, GitUpstreamStatus, GhosttyImportPreview, ListWorkItemsResult, LinearProjectDetail, MemorySnapshot, NotificationDismissResult, NotificationDispatchResult, NotificationDeliveryProbeResult, NotificationPermissionStatusResult, NotificationSoundDataResult, NotificationSoundPathResult, NotificationSoundResult, NestedRepoScanResult, OnboardingState, PersistedUIState, FloatingTerminalCwdRequest, MarkdownDocument, SearchResult, TuiAgent, UpdateStatus, WorktreeBaseStatusEvent, WorktreeDefaultTabsLaunch, WorktreeHeadIdentity, WorktreeRemoteBranchConflictEvent, PtyModelRestoreNeededEvent, PtyListedSession, PtyRendererDeliveryHealthReply, PtyRendererDeliveryStateReport, TerminalViewAttributes, WriteTerminalRenderDesyncEvidenceArgs, PtyMainDeliveryDiagnostics, WarpThemeImportPreview, WarpThemeImportSource, GitHistoryOptions, GitHistoryResult, ShellOpenExternalEditorRequest, ShellOpenExternalEditorResult, ShellOpenLocalPathResult, SkillDiscoveryResult, SkillDiscoveryTarget, SkillFreshnessInventory, SkillUpdateRun, SkillUpdateStartResult, RuntimeBrowserDriverState, RuntimeMobileSessionTabMove, RuntimeStatus, RuntimeSyncWindowGraphResult, RuntimeSyncWindowGraph, RuntimeTerminalCreateRequestPayload, RuntimeTerminalDriverState, RuntimeTerminalPresentation, RuntimeRpcResponse, PublicKnownRuntimeEnvironment, RemoteWorkspaceChangedEvent, RuntimeMobileMarkdownRequest, RuntimeMobileMarkdownResponse, CodexRateLimitResetResult, GrokAccountStatus, RateLimitRuntimeTarget, RateLimitState, WorkspaceSpaceScanProgress, WorkspaceCleanupScanProgress, WorkspacePortAdvertisedUrlChangedEvent, GhAuthDiagnostic, TaskSourceContext, AddIssueCommentBySlugArgs, ClearProjectItemFieldArgs, DeleteIssueCommentBySlugArgs, GetProjectViewTableArgs, GetProjectViewTableResult, GitHubProjectCommentMutationResult, GitHubProjectMutationResult, ListAccessibleProjectsArgs, ListAccessibleProjectsResult, ListAssignableUsersBySlugArgs, ListAssignableUsersBySlugResult, ListIssueTypesBySlugArgs, ListIssueTypesBySlugResult, ListLabelsBySlugArgs, ListLabelsBySlugResult, ListProjectViewsArgs, ListProjectViewsResult, ProjectWorkItemDetailsBySlugArgs, ProjectWorkItemDetailsBySlugResult, ResolveProjectRefArgs, ResolveProjectRefResult, UpdateIssueBySlugArgs, UpdateIssueCommentBySlugArgs, UpdateIssueTypeBySlugArgs, UpdatePullRequestBySlugArgs, UpdateProjectItemFieldArgs, AgentStatusClearIpcPayload, AgentStatusIpcPayload, MigrationUnsupportedPtyEntry, AgentInterruptInferenceRequest, AgentQuestionAnsweredInferenceRequest, TerminalSideEffectBatch, SpeechErrorEvent, SpeechLifecycleEvent, SpeechModelManifest, SpeechModelState, SpeechTranscriptEvent, TelemetryConsentState, PreflightRuntimeContext, RefreshAgentsResult, NativeChatAppendedPayload, NativeChatReadSessionResult, NativeChatSubscriptionFrame, PluginHostInstallResult, PluginHostInstallSource, PluginHostListEntry, PluginHostLogLine, PreloadApi, AgentKind, LaunchSource, RequestKind, AppStarSource, ExecutionHostId, Automation, AutomationCreateInput, AutomationDispatchRequest, AutomationDispatchResult, ExternalAutomationCreateInput, ExternalAutomationActionInput, ExternalAutomationManager, ExternalAutomationRunsInput, ExternalAutomationRunsPage, ExternalAutomationUpdateInput, AutomationRun, AutomationPrecheckResult, AutomationUpdateInput, KeybindingActionId, KeybindingFileSnapshot, AiVaultListArgs, AiVaultSubagentListArgs, AiVaultPrepareSessionResumeArgs, AgentType, LocalLogTailChangedPayload, LocalLogTailReadArgs, LocalLogTailReadResult, LocalLogTailWatchArgs, RuntimeEnvironmentSubscriptionHandle, HostedReviewForBranchArgs, ReadClipboardTextOptions, LocalhostWorktreeLabelResult, LocalhostWorktreeLabelRoute, CrashReportBreadcrumbData, CrashReportCopyDiagnosticsArgs, CrashReportSubmitArgs, CrashReportSubmitResult, ReactErrorBoundaryReportArgs, ReactErrorBoundaryReportResult, RendererHeapStatistics, NativeFileDropCallback } from './preload-api-runtime-context'

export function createPreloadApiUi(): Record<string, unknown> {
  return {
  ui: {
    get: () => ipcRenderer.invoke('ui:get'),
    set: (args) => ipcRenderer.invoke('ui:set', args),
    recordFeatureInteraction: (id) => ipcRenderer.invoke('ui:recordFeatureInteraction', id),
    onStateChanged: (callback: (ui: PersistedUIState) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, ui: PersistedUIState): void =>
        callback(ui)
      ipcRenderer.on('ui:stateChanged', listener)
      return () => ipcRenderer.removeListener('ui:stateChanged', listener)
    },
    onOpenSettings: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openSettings', listener)
      return () => ipcRenderer.removeListener('ui:openSettings', listener)
    },
    consumePendingOpenSettings: (): Promise<boolean> =>
      ipcRenderer.invoke('ui:consumePendingOpenSettings'),
    onOpenSetupGuide: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openSetupGuide', listener)
      return () => ipcRenderer.removeListener('ui:openSetupGuide', listener)
    },
    onOpenFeatureTour: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openFeatureTour', listener)
      return () => ipcRenderer.removeListener('ui:openFeatureTour', listener)
    },
    onOpenCrashReport: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openCrashReport', listener)
      return () => ipcRenderer.removeListener('ui:openCrashReport', listener)
    },
    onToggleLeftSidebar: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:toggleLeftSidebar', listener)
      return () => ipcRenderer.removeListener('ui:toggleLeftSidebar', listener)
    },
    onToggleRightSidebar: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:toggleRightSidebar', listener)
      return () => ipcRenderer.removeListener('ui:toggleRightSidebar', listener)
    },
    onToggleWorktreePalette: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:toggleWorktreePalette', listener)
      return () => ipcRenderer.removeListener('ui:toggleWorktreePalette', listener)
    },
    onToggleFloatingTerminal: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:toggleFloatingTerminal', listener)
      return () => ipcRenderer.removeListener('ui:toggleFloatingTerminal', listener)
    },
    onTerminalShortcutCaptured: (
      callback: (data: { actionId: KeybindingActionId }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { actionId: KeybindingActionId }
      ) => callback(data)
      ipcRenderer.on('ui:terminalShortcutCaptured', listener)
      return () => ipcRenderer.removeListener('ui:terminalShortcutCaptured', listener)
    },
    onOpenQuickOpen: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openQuickOpen', listener)
      return () => ipcRenderer.removeListener('ui:openQuickOpen', listener)
    },
    onToggleQuickCommandsMenu: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:toggleQuickCommandsMenu', listener)
      return () => ipcRenderer.removeListener('ui:toggleQuickCommandsMenu', listener)
    },
    onOpenNewWorkspace: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openNewWorkspace', listener)
      return () => ipcRenderer.removeListener('ui:openNewWorkspace', listener)
    },
    onDeleteCurrentWorkspace: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:deleteCurrentWorkspace', listener)
      return () => ipcRenderer.removeListener('ui:deleteCurrentWorkspace', listener)
    },
    onOpenWorkspaceBoard: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openWorkspaceBoard', listener)
      return () => ipcRenderer.removeListener('ui:openWorkspaceBoard', listener)
    },
    onOpenTasks: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openTasks', listener)
      return () => ipcRenderer.removeListener('ui:openTasks', listener)
    },
    onJumpToWorktreeIndex: (callback: (index: number) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, index: number) => callback(index)
      ipcRenderer.on('ui:jumpToWorktreeIndex', listener)
      return () => ipcRenderer.removeListener('ui:jumpToWorktreeIndex', listener)
    },
    onJumpToTabIndex: (callback: (index: number) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, index: number) => callback(index)
      ipcRenderer.on('ui:jumpToTabIndex', listener)
      return () => ipcRenderer.removeListener('ui:jumpToTabIndex', listener)
    },
    onWorktreeHistoryNavigate: (
      callback: (direction: 'back' | 'forward') => void
    ): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 'back' | 'forward') =>
        callback(direction)
      ipcRenderer.on('ui:worktreeHistoryNavigate', listener)
      return () => ipcRenderer.removeListener('ui:worktreeHistoryNavigate', listener)
    },
    onNewBrowserTab: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:newBrowserTab', listener)
      return () => ipcRenderer.removeListener('ui:newBrowserTab', listener)
    },
    onNewMarkdownTab: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:newMarkdownTab', listener)
      return () => ipcRenderer.removeListener('ui:newMarkdownTab', listener)
    },
    onNewSimulatorTab: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:newSimulatorTab', listener)
      return () => ipcRenderer.removeListener('ui:newSimulatorTab', listener)
    },
    onRequestTabCreate: (
      callback: (data: {
        requestId: string
        url: string
        worktreeId?: string
        sessionProfileId?: string | null
        sessionPartition?: string
        activate?: boolean
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          requestId: string
          url: string
          worktreeId?: string
          sessionProfileId?: string | null
          sessionPartition?: string
          activate?: boolean
        }
      ) => callback(data)
      ipcRenderer.on('browser:requestTabCreate', listener)
      return () => ipcRenderer.removeListener('browser:requestTabCreate', listener)
    },
    replyTabCreate: (reply: {
      requestId: string
      browserPageId?: string
      error?: string
    }): void => {
      ipcRenderer.send('browser:tabCreateReply', reply)
    },
    onRequestTabSetProfile: (
      callback: (data: {
        requestId: string
        browserPageId: string
        profileId: string
        sessionPartition?: string
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          requestId: string
          browserPageId: string
          profileId: string
          sessionPartition?: string
        }
      ) => callback(data)
      ipcRenderer.on('browser:requestTabSetProfile', listener)
      return () => ipcRenderer.removeListener('browser:requestTabSetProfile', listener)
    },
    replyTabSetProfile: (reply: { requestId: string; error?: string }): void => {
      ipcRenderer.send('browser:tabSetProfileReply', reply)
    },
    onRequestTabClose: (
      callback: (data: { requestId: string; tabId: string | null; worktreeId?: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { requestId: string; tabId: string | null; worktreeId?: string }
      ) => callback(data)
      ipcRenderer.on('browser:requestTabClose', listener)
      return () => ipcRenderer.removeListener('browser:requestTabClose', listener)
    },
    replyTabClose: (reply: { requestId: string; error?: string }): void => {
      ipcRenderer.send('browser:tabCloseReply', reply)
    },
    onNewTerminalTab: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:newTerminalTab', listener)
      return () => ipcRenderer.removeListener('ui:newTerminalTab', listener)
    },
    onFocusBrowserAddressBar: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:focusBrowserAddressBar', listener)
      return () => ipcRenderer.removeListener('ui:focusBrowserAddressBar', listener)
    },
    onFindInBrowserPage: browserFindSubscriptions.subscribe,
    onReloadBrowserPage: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:reloadBrowserPage', listener)
      return () => ipcRenderer.removeListener('ui:reloadBrowserPage', listener)
    },
    onBrowserHistoryNavigate: (callback: (direction: 'back' | 'forward') => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 'back' | 'forward'): void =>
        callback(direction)
      ipcRenderer.on('ui:browserHistoryNavigate', listener)
      return () => ipcRenderer.removeListener('ui:browserHistoryNavigate', listener)
    },
    onZoomBrowserPage: (callback: (direction: 'in' | 'out' | 'reset') => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 'in' | 'out' | 'reset') =>
        callback(direction)
      ipcRenderer.on('ui:zoomBrowserPage', listener)
      return () => ipcRenderer.removeListener('ui:zoomBrowserPage', listener)
    },
    onHardReloadBrowserPage: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:hardReloadBrowserPage', listener)
      return () => ipcRenderer.removeListener('ui:hardReloadBrowserPage', listener)
    },
    onCloseActiveTab: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:closeActiveTab', listener)
      return () => ipcRenderer.removeListener('ui:closeActiveTab', listener)
    },
    onCloseFloatingItem: (callback: (payload: { sourceId: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { sourceId: string }) =>
        callback(payload)
      ipcRenderer.on('ui:closeFloatingItem', listener)
      return () => ipcRenderer.removeListener('ui:closeFloatingItem', listener)
    },
    onSelectFloatingIndex: (callback: (payload: { index: number }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { index: number }) =>
        callback(payload)
      ipcRenderer.on('ui:selectFloatingIndex', listener)
      return () => ipcRenderer.removeListener('ui:selectFloatingIndex', listener)
    },
    onSwitchTab: (callback: (direction: 1 | -1) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 1 | -1) => callback(direction)
      ipcRenderer.on('ui:switchTab', listener)
      return () => ipcRenderer.removeListener('ui:switchTab', listener)
    },
    onSwitchTabAcrossAllTypes: (callback: (direction: 1 | -1) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 1 | -1) => callback(direction)
      ipcRenderer.on('ui:switchTabAcrossAllTypes', listener)
      return () => ipcRenderer.removeListener('ui:switchTabAcrossAllTypes', listener)
    },
    onSwitchRecentTab: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:switchRecentTab', listener)
      return () => ipcRenderer.removeListener('ui:switchRecentTab', listener)
    },
    onSwitchTerminalTab: (callback: (direction: 1 | -1) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 1 | -1) => callback(direction)
      ipcRenderer.on('ui:switchTerminalTab', listener)
      return () => ipcRenderer.removeListener('ui:switchTerminalTab', listener)
    },
    onCtrlTabKeyDown: (callback: (data: { shiftKey: boolean }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { shiftKey: boolean }) =>
        callback(data)
      ipcRenderer.on('ui:ctrlTabKeyDown', listener)
      return () => ipcRenderer.removeListener('ui:ctrlTabKeyDown', listener)
    },
    onCtrlTabKeyUp: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:ctrlTabKeyUp', listener)
      return () => ipcRenderer.removeListener('ui:ctrlTabKeyUp', listener)
    },
    onToggleStatusBar: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:toggleStatusBar', listener)
      return () => ipcRenderer.removeListener('ui:toggleStatusBar', listener)
    },
    onExportPdfRequested: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('export:requestPdf', listener)
      return () => ipcRenderer.removeListener('export:requestPdf', listener)
    },
    onAppMenuPaste: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:appMenuPaste', listener)
      return () => ipcRenderer.removeListener('ui:appMenuPaste', listener)
    },
    onEditableContextPaste: (
      callback: (data: { plainTextOnly: boolean }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { plainTextOnly: boolean }
      ): void => callback({ plainTextOnly: data?.plainTextOnly === true })
      ipcRenderer.on('ui:editableContextPaste', listener)
      return () => ipcRenderer.removeListener('ui:editableContextPaste', listener)
    },
    onDictationKeyDown: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:dictationKeyDown', listener)
      return () => ipcRenderer.removeListener('ui:dictationKeyDown', listener)
    },
    onActivateWorktree: (
      callback: (data: {
        repoId: string
        worktreeId: string
        setup?: { runnerScriptPath: string; envVars: Record<string, string> }
        startup?: { command: string; env?: Record<string, string> }
        defaultTabs?: WorktreeDefaultTabsLaunch
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          repoId: string
          worktreeId: string
          setup?: { runnerScriptPath: string; envVars: Record<string, string> }
          startup?: { command: string; env?: Record<string, string> }
          defaultTabs?: WorktreeDefaultTabsLaunch
        }
      ) => callback(data)
      ipcRenderer.on('ui:activateWorktree', listener)
      return () => ipcRenderer.removeListener('ui:activateWorktree', listener)
    },
    onCreateTerminal: (
      callback: (data: {
        requestId?: string
        worktreeId: string
        command?: string
        cwd?: string
        env?: Record<string, string>
        launchConfig?: SleepingAgentLaunchConfig
        resumeProviderSession?: AgentProviderSessionMetadata
        launchToken?: string
        launchAgent?: TuiAgent
        viewMode?: 'terminal' | 'chat'
        title?: string
        ptyId?: string
        activate?: boolean
        focus?: boolean
        presentation?: RuntimeTerminalPresentation
        surfaceOwner?: false
        tabId?: string
        leafId?: string
        splitFromLeafId?: string
        splitDirection?: 'horizontal' | 'vertical'
        splitTelemetrySource?: TerminalPaneSplitSource
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          requestId?: string
          worktreeId: string
          command?: string
          cwd?: string
          env?: Record<string, string>
          launchConfig?: SleepingAgentLaunchConfig
          resumeProviderSession?: AgentProviderSessionMetadata
          launchToken?: string
          launchAgent?: TuiAgent
          viewMode?: 'terminal' | 'chat'
          title?: string
          ptyId?: string
          activate?: boolean
          focus?: boolean
          presentation?: RuntimeTerminalPresentation
          surfaceOwner?: false
          tabId?: string
          leafId?: string
          splitFromLeafId?: string
          splitDirection?: 'horizontal' | 'vertical'
          splitTelemetrySource?: TerminalPaneSplitSource
        }
      ) => callback(data)
      ipcRenderer.on('ui:createTerminal', listener)
      return () => ipcRenderer.removeListener('ui:createTerminal', listener)
    },
    onRequestTerminalCreate: (
      callback: (data: RuntimeTerminalCreateRequestPayload) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: RuntimeTerminalCreateRequestPayload
      ) => callback(data)
      ipcRenderer.on('terminal:requestTabCreate', listener)
      return () => ipcRenderer.removeListener('terminal:requestTabCreate', listener)
    },
    onRequestTerminalTabMount: (
      callback: (data: { worktreeId: string; tabId?: string; ptyId?: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { worktreeId: string; tabId?: string; ptyId?: string }
      ) => callback(data)
      ipcRenderer.on('terminal:requestTabMount', listener)
      return () => ipcRenderer.removeListener('terminal:requestTabMount', listener)
    },
    replyTerminalCreate: (reply: TerminalTabCreateReply): void => {
      ipcRenderer.send('terminal:tabCreateReply', reply)
    },
    onSplitTerminal: (
      callback: (data: {
        tabId: string
        paneRuntimeId: number
        direction: 'horizontal' | 'vertical'
        command?: string
        telemetrySource?: TerminalPaneSplitSource
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          tabId: string
          paneRuntimeId: number
          direction: 'horizontal' | 'vertical'
          command?: string
          telemetrySource?: TerminalPaneSplitSource
        }
      ) => callback(data)
      ipcRenderer.on('ui:splitTerminal', listener)
      return () => ipcRenderer.removeListener('ui:splitTerminal', listener)
    },
    onRenameTerminal: (
      callback: (data: { tabId: string; title: string | null }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { tabId: string; title: string | null }
      ) => callback(data)
      ipcRenderer.on('ui:renameTerminal', listener)
      return () => ipcRenderer.removeListener('ui:renameTerminal', listener)
    },
    onFocusTerminal: (
      callback: (data: {
        tabId: string
        worktreeId: string
        leafId?: string | null
        ackPaneKeyOnSuccess?: string
        flashFocusedPane?: boolean
        scrollToBottomIfOutputSinceLastView?: boolean
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          tabId: string
          worktreeId: string
          leafId?: string | null
          ackPaneKeyOnSuccess?: string
          flashFocusedPane?: boolean
          scrollToBottomIfOutputSinceLastView?: boolean
        }
      ) => callback(data)
      ipcRenderer.on('ui:focusTerminal', listener)
      return () => ipcRenderer.removeListener('ui:focusTerminal', listener)
    },
    onFocusEditorTab: (
      callback: (data: { tabId: string; worktreeId: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { tabId: string; worktreeId: string }
      ) => callback(data)
      ipcRenderer.on('ui:focusEditorTab', listener)
      return () => ipcRenderer.removeListener('ui:focusEditorTab', listener)
    },
    onCloseSessionTab: (
      callback: (data: { tabId: string; worktreeId: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { tabId: string; worktreeId: string }
      ) => callback(data)
      ipcRenderer.on('ui:closeSessionTab', listener)
      return () => ipcRenderer.removeListener('ui:closeSessionTab', listener)
    },
    onMoveSessionTab: (
      callback: (data: { worktreeId: string } & RuntimeMobileSessionTabMove) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { worktreeId: string } & RuntimeMobileSessionTabMove
      ) => callback(data)
      ipcRenderer.on('ui:moveSessionTab', listener)
      return () => ipcRenderer.removeListener('ui:moveSessionTab', listener)
    },
    onOpenFileFromMobile: (
      callback: (data: {
        worktreeId: string
        filePath: string
        relativePath: string
        runtimeEnvironmentId?: string
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          worktreeId: string
          filePath: string
          relativePath: string
          runtimeEnvironmentId?: string
        }
      ) => callback(data)
      ipcRenderer.on('ui:openFileFromMobile', listener)
      return () => ipcRenderer.removeListener('ui:openFileFromMobile', listener)
    },
    onOpenDiffFromMobile: (
      callback: (data: {
        worktreeId: string
        filePath: string
        relativePath: string
        staged: boolean
        runtimeEnvironmentId?: string
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          worktreeId: string
          filePath: string
          relativePath: string
          staged: boolean
          runtimeEnvironmentId?: string
        }
      ) => callback(data)
      ipcRenderer.on('ui:openDiffFromMobile', listener)
      return () => ipcRenderer.removeListener('ui:openDiffFromMobile', listener)
    },
    onMobileMarkdownRequest: (
      callback: (request: RuntimeMobileMarkdownRequest) => void
    ): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, request: RuntimeMobileMarkdownRequest) =>
        callback(request)
      ipcRenderer.on('ui:mobileMarkdownRequest', listener)
      return () => ipcRenderer.removeListener('ui:mobileMarkdownRequest', listener)
    },
    respondMobileMarkdownRequest: (response: RuntimeMobileMarkdownResponse): void => {
      ipcRenderer.send('ui:mobileMarkdownResponse', response)
    },
    onCloseTerminal: (
      callback: (data: { tabId: string; paneRuntimeId?: number }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { tabId: string; paneRuntimeId?: number }
      ) => callback(data)
      ipcRenderer.on('ui:closeTerminal', listener)
      return () => ipcRenderer.removeListener('ui:closeTerminal', listener)
    },
    onTerminalTabCloseRequest: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        request: Parameters<typeof callback>[0]
      ) => callback(request)
      ipcRenderer.on('ui:terminalTabCloseRequest', listener)
      return () => ipcRenderer.removeListener('ui:terminalTabCloseRequest', listener)
    },
    respondTerminalTabClose: (response) => {
      ipcRenderer.send('ui:terminalTabCloseResponse', response)
    },
    onSleepWorktree: (callback: (data: { worktreeId: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { worktreeId: string }) =>
        callback(data)
      ipcRenderer.on('ui:sleepWorktree', listener)
      return () => ipcRenderer.removeListener('ui:sleepWorktree', listener)
    },
    onResumeSleepingAgents: (callback: (data: { worktreeId: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { worktreeId: string }) =>
        callback(data)
      ipcRenderer.on('ui:resumeSleepingAgents', listener)
      return () => ipcRenderer.removeListener('ui:resumeSleepingAgents', listener)
    },
    onTerminalZoom: (callback: (direction: 'in' | 'out' | 'reset') => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 'in' | 'out' | 'reset') =>
        callback(direction)
      ipcRenderer.on('terminal:zoom', listener)
      return () => ipcRenderer.removeListener('terminal:zoom', listener)
    },
    readClipboardText: (options?: ReadClipboardTextOptions): Promise<string> =>
      ipcRenderer.invoke('clipboard:readText', options),
    readSelectionClipboardText: (options?: ReadClipboardTextOptions): Promise<string> =>
      ipcRenderer.invoke('clipboard:readSelectionText', options),
    saveClipboardImageAsTempFile: (args?: {
      connectionId?: string | null
      runtimeEnvironmentId?: string | null
    }): Promise<string | null> => ipcRenderer.invoke('clipboard:saveImageAsTempFile', args),
    writeClipboardText: (text: string): Promise<void> =>
      ipcRenderer.invoke('clipboard:writeText', text),
    writeTerminalClipboardText: (text: string): Promise<void> =>
      ipcRenderer.invoke('clipboard:writeTerminalText', text),
    writeSelectionClipboardText: (text: string): Promise<void> =>
      ipcRenderer.invoke('clipboard:writeSelectionText', text),
    writeClipboardImage: (dataUrl: string): Promise<void> =>
      ipcRenderer.invoke('clipboard:writeImage', dataUrl),
    performNativePaste: (options?: { mode?: 'paste' | 'paste-and-match-style' }): void => {
      ipcRenderer.send('ui:performNativePaste', {
        mode: options?.mode === 'paste-and-match-style' ? 'paste-and-match-style' : 'paste'
      })
    },
    writeClipboardFile: (
      args:
        | {
            filePath: string
            connectionId?: string | null
          }
        | string
    ): Promise<{ ok: boolean; reason?: string }> => ipcRenderer.invoke('clipboard:writeFile', args),
    onFileDrop: (callback: (data: NativeFileDropPayload) => void): (() => void) =>
      subscribeNativeFileDrop(callback),
    getZoomLevel: (): number => webFrame.getZoomLevel(),
    setZoomLevel: (level: number): void => webFrame.setZoomLevel(level),
    syncTrafficLights: (zoomFactor: number): void =>
      ipcRenderer.send('ui:sync-traffic-lights', zoomFactor),
    // Why: one-way send so main's before-input-event can synchronously skip Cmd+B while the markdown editor is focused (TipTap bold).
    setMarkdownEditorFocused: (focused: boolean): void => {
      ipcRenderer.send('ui:setMarkdownEditorFocused', focused)
    },
    setTerminalInputFocused: (focused: boolean): void => {
      ipcRenderer.send('ui:setTerminalInputFocused', focused)
    },
    // Why: one atomic payload so main's synchronous before-input-event never sees a torn terminal=true/panel=false state.
    setFloatingFocus: (state: { panelFocused: boolean; terminalFocused: boolean }): void => {
      ipcRenderer.send('ui:setFloatingFocus', state)
    },
    setShortcutRecorderFocused: (focused: boolean): void => {
      ipcRenderer.send('ui:setShortcutRecorderFocused', focused)
    },
    onRichMarkdownContextCommand: (
      callback: (payload: RichMarkdownContextMenuCommandPayload) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: RichMarkdownContextMenuCommandPayload
      ) => callback(payload)
      ipcRenderer.on(richMarkdownContextMenuCommandChannel, listener)
      return () => ipcRenderer.removeListener(richMarkdownContextMenuCommandChannel, listener)
    },
    onFullscreenChanged: (callback: (isFullScreen: boolean) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, isFullScreen: boolean) =>
        callback(isFullScreen)
      ipcRenderer.on('window:fullscreen-changed', listener)
      return () => ipcRenderer.removeListener('window:fullscreen-changed', listener)
    },
    /** Fired when the OS resumes from sleep — a focus-preserving wake fires no renderer focus/visibility events. */
    onSystemResumed: (callback: () => void): (() => void) => {
      const listener = () => callback()
      ipcRenderer.on('system:resumed', listener)
      return () => ipcRenderer.removeListener('system:resumed', listener)
    },
    /** Desktop custom titlebar only: minimize via renderer-drawn window controls. */
    minimize: (): void => {
      ipcRenderer.send('window:minimize')
    },
    /** Desktop custom titlebar only: toggle maximize/restore via renderer-drawn controls. */
    maximize: (): void => {
      ipcRenderer.send('window:maximize')
    },
    /** Desktop custom titlebar only: read initial maximize state on mount — maximize-changed only fires on transitions. */
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    /** Desktop custom titlebar only: subscribe to maximize-state changes so the maximize button shows the right icon. */
    onMaximizeChanged: (callback: (isMaximized: boolean) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, isMaximized: boolean) =>
        callback(isMaximized)
      ipcRenderer.on('window:maximize-changed', listener)
      return () => ipcRenderer.removeListener('window:maximize-changed', listener)
    },
    /** Desktop custom titlebar only: request close via main so the BrowserWindow 'close' event
     *  (and its terminal-running guard) still fires — window.close() is unreliable in sandboxed renderers. */
    requestClose: (): void => {
      ipcRenderer.send('window:request-close')
    },
    /** Desktop custom titlebar only: pop up the app menu at the cursor — Alt-reveal replacement for the ··· button. */
    popupMenu: (): void => {
      ipcRenderer.send('menu:popup')
    },
    /** Fired by main when the user tries to close the window; renderer confirms running
     *  terminals then calls confirmWindowClose(). isQuitting (Cmd+Q / app.quit) skips that dialog. */
    onWindowCloseRequested: (callback: (data: { isQuitting: boolean }) => void): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { isQuitting: boolean; requestId?: number }
      ): void => {
        // Why: main cannot reach will-quit while a frozen renderer owns the window close handshake.
        ipcRenderer.send('window:close-request-received', data?.requestId)
        callback({ isQuitting: data?.isQuitting ?? false })
      }
      ipcRenderer.on('window:close-requested', listener)
      return () => ipcRenderer.removeListener('window:close-requested', listener)
    },
    /** Tell the main process to proceed with the window close. */
    confirmWindowClose: (): void => {
      ipcRenderer.send('window:confirm-close')
    },
    /** Report a genuine hidden→visible reveal so main can recover a stale (throttled) layout/compositor surface. */
    notifyWindowRevealed: (): void => {
      ipcRenderer.send('ui:window-revealed')
    }
  } satisfies PreloadApi['ui'],
  }
}
