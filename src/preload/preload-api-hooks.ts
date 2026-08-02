import { contextBridge, ipcRenderer, webFrame, webUtils, electronAPI, preloadE2EConfig, glApi, admitSshConnectionStateForAuthorityReconciliation, admitSshDetectedPorts, richMarkdownContextMenuCommandChannel, type RichMarkdownContextMenuCommandPayload, createBrowserFindSubscriptions, ORCA_APP_RESTART_ABORTED_EVENT, ORCA_APP_RESTART_STARTED_EVENT, ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, ORCA_RENDERER_UNLOAD_PREVENTED_EVENT, ORCA_INTERNAL_FILE_DRAG_TYPE, createNativeFileDropPayload, createRejectedNativeFileDropPayload, hasNativeFileDragTypes, NATIVE_FILE_DROP_MAX_PATHS, resolveNativeFileDropPath, type NativeDropResolution, type NativeFileDropPayload, type NativeFileDropPathEntry, subscribeRuntimeEnvironmentFromPreload, readRendererHeapStatistics, createUpdaterQuitAbortRelay, prepareRendererForAppRestart, nativeFileDropCallbacks, nativeFileDropListenerRegistered, updaterQuitAbortRelay, getLinuxDisplayServer, onNativeFileDrop, subscribeNativeFileDrop, cachedNotificationSound, isNotificationSoundPlaying, cleanupNotificationSoundPlayback, clearNotificationSoundPlaybackState, disposeCachedNotificationSound, resolveNativeFileDrop, startupDiagnosticsEnabled, browserFindSubscriptions } from './preload-api-runtime-context'
import type { AppIdentity, DashboardSnapshot, DashboardRevealAgentArgs, TerminalPreviewConnectResult, TerminalPreviewDataPayload, CliInstallStatus, AgentHookInstallStatus, CodexConfigSyncStatus, TerminalPaneSplitSource, TerminalTabCreateReply, ProjectExecutionRuntimeResolution, StartupCommandDelivery, AgentProviderSessionMetadata, SleepingAgentLaunchConfig, MobileRelayStatus, MobilePairingConnectionMode, MobileRelayMintFailure, VerifyAndAddRuntimeEnvironmentResult, SshMutationExpectation, SshConnectionState, SshConfigImportResult, SshTargetAddResult, SshTarget, PortForwardEntry, EnrichedDetectedPort, HostRepoCatalogSnapshot, ListReposForExecutionHostArgs, HostLineageSnapshot, ListDesktopLineageForHostArgs, PluginPanelActionOutcome, PluginPanelEntry, PluginConsentRequest, PluginChangeEvent, BaseRefSearchResult, BaseRefDefaultResult, BrowserViewportOverride, CustomPet, FsChangedPayload, FilesystemPathFlavor, GetRateLimitResult, GitHubPRRefreshCandidate, GitHubPRRefreshEvent, GitHubPRRefreshReason, GitHubAssignableUser, GitHubCommentResult, GitHubCreateIssueResult, GitHubOwnerRepo, GitHubWorkItem, JiraProjectStatusOrder, GitPushTarget, GitStagingArea, GitForkSyncExpectedUpstream, GitForkSyncResult, GitUpstreamStatus, GhosttyImportPreview, ListWorkItemsResult, LinearProjectDetail, MemorySnapshot, NotificationDismissResult, NotificationDispatchResult, NotificationDeliveryProbeResult, NotificationPermissionStatusResult, NotificationSoundDataResult, NotificationSoundPathResult, NotificationSoundResult, NestedRepoScanResult, OnboardingState, PersistedUIState, FloatingTerminalCwdRequest, MarkdownDocument, SearchResult, TuiAgent, UpdateStatus, WorktreeBaseStatusEvent, WorktreeDefaultTabsLaunch, WorktreeHeadIdentity, WorktreeRemoteBranchConflictEvent, PtyModelRestoreNeededEvent, PtyListedSession, PtyRendererDeliveryHealthReply, PtyRendererDeliveryStateReport, TerminalViewAttributes, WriteTerminalRenderDesyncEvidenceArgs, PtyMainDeliveryDiagnostics, WarpThemeImportPreview, WarpThemeImportSource, GitHistoryOptions, GitHistoryResult, ShellOpenExternalEditorRequest, ShellOpenExternalEditorResult, ShellOpenLocalPathResult, SkillDiscoveryResult, SkillDiscoveryTarget, SkillFreshnessInventory, SkillUpdateRun, SkillUpdateStartResult, RuntimeBrowserDriverState, RuntimeMobileSessionTabMove, RuntimeStatus, RuntimeSyncWindowGraphResult, RuntimeSyncWindowGraph, RuntimeTerminalCreateRequestPayload, RuntimeTerminalDriverState, RuntimeTerminalPresentation, RuntimeRpcResponse, PublicKnownRuntimeEnvironment, RemoteWorkspaceChangedEvent, RuntimeMobileMarkdownRequest, RuntimeMobileMarkdownResponse, CodexRateLimitResetResult, GrokAccountStatus, RateLimitRuntimeTarget, RateLimitState, WorkspaceSpaceScanProgress, WorkspaceCleanupScanProgress, WorkspacePortAdvertisedUrlChangedEvent, GhAuthDiagnostic, TaskSourceContext, AddIssueCommentBySlugArgs, ClearProjectItemFieldArgs, DeleteIssueCommentBySlugArgs, GetProjectViewTableArgs, GetProjectViewTableResult, GitHubProjectCommentMutationResult, GitHubProjectMutationResult, ListAccessibleProjectsArgs, ListAccessibleProjectsResult, ListAssignableUsersBySlugArgs, ListAssignableUsersBySlugResult, ListIssueTypesBySlugArgs, ListIssueTypesBySlugResult, ListLabelsBySlugArgs, ListLabelsBySlugResult, ListProjectViewsArgs, ListProjectViewsResult, ProjectWorkItemDetailsBySlugArgs, ProjectWorkItemDetailsBySlugResult, ResolveProjectRefArgs, ResolveProjectRefResult, UpdateIssueBySlugArgs, UpdateIssueCommentBySlugArgs, UpdateIssueTypeBySlugArgs, UpdatePullRequestBySlugArgs, UpdateProjectItemFieldArgs, AgentStatusClearIpcPayload, AgentStatusIpcPayload, MigrationUnsupportedPtyEntry, AgentInterruptInferenceRequest, AgentQuestionAnsweredInferenceRequest, TerminalSideEffectBatch, SpeechErrorEvent, SpeechLifecycleEvent, SpeechModelManifest, SpeechModelState, SpeechTranscriptEvent, TelemetryConsentState, PreflightRuntimeContext, RefreshAgentsResult, NativeChatAppendedPayload, NativeChatReadSessionResult, NativeChatSubscriptionFrame, PluginHostInstallResult, PluginHostInstallSource, PluginHostListEntry, PluginHostLogLine, PreloadApi, AgentKind, LaunchSource, RequestKind, AppStarSource, ExecutionHostId, Automation, AutomationCreateInput, AutomationDispatchRequest, AutomationDispatchResult, ExternalAutomationCreateInput, ExternalAutomationActionInput, ExternalAutomationManager, ExternalAutomationRunsInput, ExternalAutomationRunsPage, ExternalAutomationUpdateInput, AutomationRun, AutomationPrecheckResult, AutomationUpdateInput, KeybindingActionId, KeybindingFileSnapshot, AiVaultListArgs, AiVaultSubagentListArgs, AiVaultPrepareSessionResumeArgs, AgentType, LocalLogTailChangedPayload, LocalLogTailReadArgs, LocalLogTailReadResult, LocalLogTailWatchArgs, RuntimeEnvironmentSubscriptionHandle, HostedReviewForBranchArgs, ReadClipboardTextOptions, LocalhostWorktreeLabelResult, LocalhostWorktreeLabelRoute, CrashReportBreadcrumbData, CrashReportCopyDiagnosticsArgs, CrashReportSubmitArgs, CrashReportSubmitResult, ReactErrorBoundaryReportArgs, ReactErrorBoundaryReportResult, RendererHeapStatistics, NativeFileDropCallback } from './preload-api-runtime-context'

export function createPreloadApiHooks(): Record<string, unknown> {
  return {
  hooks: {
    check: (args: {
      repoId: string
      hostId?: ExecutionHostId
    }): Promise<{
      status?: 'ok' | 'error'
      hasHooks: boolean
      hooks: unknown
      mayNeedUpdate: boolean
    }> => ipcRenderer.invoke('hooks:check', args),

    inspectSetupScriptImports: (args: {
      repoId: string
      hostId?: ExecutionHostId
    }): Promise<unknown[]> => ipcRenderer.invoke('hooks:inspectSetupScriptImports', args),

    createIssueCommandRunner: (args: {
      repoId: string
      worktreePath: string
      command: string
    }): Promise<{ runnerScriptPath: string; envVars: Record<string, string> }> =>
      ipcRenderer.invoke('hooks:createIssueCommandRunner', args),

    readIssueCommand: (args: {
      repoId: string
      hostId?: ExecutionHostId
    }): Promise<{
      status?: 'ok' | 'error'
      localContent: string | null
      sharedContent: string | null
      effectiveContent: string | null
      localFilePath: string
      source: 'local' | 'shared' | 'none'
    }> => ipcRenderer.invoke('hooks:readIssueCommand', args),

    writeIssueCommand: (args: {
      repoId: string
      content: string
      hostId?: ExecutionHostId
    }): Promise<void> => ipcRenderer.invoke('hooks:writeIssueCommand', args)
  },
  ephemeralVm: {
    listRecipes: (args) => ipcRenderer.invoke('ephemeralVm:listRecipes', args),
    listRecipeCatalog: () => ipcRenderer.invoke('ephemeralVm:listRecipeCatalog'),
    doctor: (args) => ipcRenderer.invoke('ephemeralVm:doctor', args),
    provision: (args) => ipcRenderer.invoke('ephemeralVm:provision', args),
    cancelProvision: (args) => ipcRenderer.invoke('ephemeralVm:cancelProvision', args),
    onProvisionEvent: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        event: { provisionId: string; stream: 'stdout' | 'stderr'; chunk: string }
      ): void => callback(event)
      ipcRenderer.on('ephemeralVm:provisionEvent', listener)
      return () => ipcRenderer.removeListener('ephemeralVm:provisionEvent', listener)
    },
    listRuntimes: () => ipcRenderer.invoke('ephemeralVm:listRuntimes'),
    attachWorkspace: (args) => ipcRenderer.invoke('ephemeralVm:attachWorkspace', args),
    suspendWorkspace: (args) => ipcRenderer.invoke('ephemeralVm:suspendWorkspace', args),
    resumeWorkspace: (args) => ipcRenderer.invoke('ephemeralVm:resumeWorkspace', args),
    cleanup: (args) => ipcRenderer.invoke('ephemeralVm:cleanup', args),
    getCleanupCommand: (args) => ipcRenderer.invoke('ephemeralVm:getCleanupCommand', args)
  } satisfies PreloadApi['ephemeralVm'],
  cache: {
    getGitHub: () => ipcRenderer.invoke('cache:getGitHub'),
    setGitHub: (args) => ipcRenderer.invoke('cache:setGitHub', args)
  } satisfies PreloadApi['cache'],
  session: {
    // hostId is optional; main defaults it to 'local' so existing omitting call sites keep the local session partition.
    get: (hostId) => ipcRenderer.invoke('session:get', hostId),
    set: (args, hostId) => ipcRenderer.invoke('session:set', args, hostId),
    patch: (args, hostId) => ipcRenderer.invoke('session:patch', args, hostId),
    flush: () => ipcRenderer.invoke('session:flush'),
    readTerminalScrollback: (args) =>
      ipcRenderer.sendSync('session:read-terminal-scrollback-sync', args),
    /** Synchronous session save for beforeunload — blocks until flushed to disk. */
    setSync: (args, hostId) => {
      ipcRenderer.sendSync('session:set-sync', args, hostId)
    }
  } satisfies PreloadApi['session'],
  remoteWorkspace: {
    get: (args) => ipcRenderer.invoke('remoteWorkspace:get', args),
    setForConnectedTargets: (args) =>
      ipcRenderer.invoke('remoteWorkspace:setForConnectedTargets', args),
    listEnabledConnectedTargets: () =>
      ipcRenderer.invoke('remoteWorkspace:listEnabledConnectedTargets'),
    listConnectedClients: (args) =>
      ipcRenderer.invoke('remoteWorkspace:listConnectedClients', args),
    clientId: () => ipcRenderer.invoke('remoteWorkspace:clientId'),
    onChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, data: RemoteWorkspaceChangedEvent) =>
        callback(data)
      ipcRenderer.on('remoteWorkspace:changed', listener)
      return () => ipcRenderer.removeListener('remoteWorkspace:changed', listener)
    }
  } satisfies PreloadApi['remoteWorkspace'],
  updater: {
    getStatus: () => ipcRenderer.invoke('updater:getStatus'),
    getVersion: () => ipcRenderer.invoke('updater:getVersion'),
    check: (options) => ipcRenderer.invoke('updater:check', options),
    download: () => ipcRenderer.invoke('updater:download'),
    dismissNudge: () => ipcRenderer.invoke('updater:dismissNudge'),
    dismissAvailableUpdate: () => ipcRenderer.invoke('updater:dismissAvailableUpdate'),
    listBuilds: (channel) => ipcRenderer.invoke('updater:listBuilds', channel),
    quitAndInstall: async (): Promise<void> => {
      await prepareRendererForAppRestart(window, {
        startedEventName: ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT,
        abortedEventName: ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT
      })
      updaterQuitAbortRelay.markPrepared()
      try {
        return await ipcRenderer.invoke('updater:quitAndInstall')
      } catch (error) {
        updaterQuitAbortRelay.abort()
        throw error
      }
    },
    onStatus: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => callback(status)
      ipcRenderer.on('updater:status', listener)
      return () => ipcRenderer.removeListener('updater:status', listener)
    },
    onClearDismissal: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('updater:clearDismissal', listener)
      return () => ipcRenderer.removeListener('updater:clearDismissal', listener)
    }
  } satisfies PreloadApi['updater'],
  notebook: {
    runPythonCell: (args: {
      filePath: string
      code: string
      preamble?: string
      connectionId?: string | null
    }): Promise<{ stdout: string; stderr: string; exitCode: number | null; error?: string }> =>
      ipcRenderer.invoke('notebook:runPythonCell', args)
  },
  fs: {
    readDir: (args: {
      dirPath: string
      connectionId?: string
    }): Promise<{ name: string; isDirectory: boolean; isSymlink: boolean }[]> =>
      ipcRenderer.invoke('fs:readDir', args),
    readFile: (args: {
      filePath: string
      connectionId?: string
      includeLocalLogMetadata?: boolean
    }): Promise<{
      content: string
      isBinary: boolean
      isImage?: boolean
      mimeType?: string
      fileIdentity?: string
    }> => ipcRenderer.invoke('fs:readFile', args),
    readLocalLogTail: (args: LocalLogTailReadArgs): Promise<LocalLogTailReadResult> =>
      ipcRenderer.invoke('fs:readLocalLogTail', args),
    startLocalLogTail: (args: LocalLogTailWatchArgs): Promise<void> =>
      ipcRenderer.invoke('fs:startLocalLogTail', args),
    stopLocalLogTail: (args: { subscriptionId: string }): Promise<void> =>
      ipcRenderer.invoke('fs:stopLocalLogTail', args),
    onLocalLogTailChanged: (
      callback: (payload: LocalLogTailChangedPayload) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: LocalLogTailChangedPayload
      ): void => callback(payload)
      ipcRenderer.on('fs:localLogTailChanged', listener)
      return () => ipcRenderer.removeListener('fs:localLogTailChanged', listener)
    },
    downloadFile: (args: {
      filePath: string
      connectionId: string
    }): Promise<{ canceled: true } | { canceled: false; destinationPath: string }> =>
      ipcRenderer.invoke('fs:downloadFile', args),
    downloadFolder: (args: {
      dirPath: string
      connectionId: string
    }): Promise<{ canceled: true } | { canceled: false; destinationPath: string }> =>
      ipcRenderer.invoke('fs:downloadFolder', args),
    saveDownloadedFile: (args: {
      suggestedName: string
      content: string
      encoding: 'utf8' | 'base64'
    }): Promise<{ canceled: true } | { canceled: false; destinationPath: string }> =>
      ipcRenderer.invoke('fs:saveDownloadedFile', args),
    startDownloadedFile: (args: {
      suggestedName: string
    }): Promise<
      { canceled: true } | { canceled: false; transferId: string; destinationPath: string }
    > => ipcRenderer.invoke('fs:startDownloadedFile', args),
    appendDownloadedFileChunk: (args: {
      transferId: string
      contentBase64: string
    }): Promise<{ ok: true }> => ipcRenderer.invoke('fs:appendDownloadedFileChunk', args),
    finishDownloadedFile: (args: {
      transferId: string
    }): Promise<{ canceled: false; destinationPath: string }> =>
      ipcRenderer.invoke('fs:finishDownloadedFile', args),
    cancelDownloadedFile: (args: { transferId: string }): Promise<{ ok: true }> =>
      ipcRenderer.invoke('fs:cancelDownloadedFile', args),
    listMarkdownDocuments: (args: {
      rootPath: string
      connectionId?: string
    }): Promise<{ filePath: string; relativePath: string; basename: string; name: string }[]> =>
      ipcRenderer.invoke('fs:listMarkdownDocuments', args),
    writeFile: (
      args: {
        filePath: string
        content: string
        connectionId?: string
      } & SshMutationExpectation
    ): Promise<void> => ipcRenderer.invoke('fs:writeFile', args),
    createFile: (
      args: { filePath: string; connectionId?: string } & SshMutationExpectation
    ): Promise<void> => ipcRenderer.invoke('fs:createFile', args),
    createDir: (
      args: { dirPath: string; connectionId?: string } & SshMutationExpectation
    ): Promise<void> => ipcRenderer.invoke('fs:createDir', args),
    rename: (
      args: { oldPath: string; newPath: string; connectionId?: string } & SshMutationExpectation
    ): Promise<void> => ipcRenderer.invoke('fs:rename', args),
    copy: (
      args: {
        sourcePath: string
        destinationPath: string
        connectionId?: string
      } & SshMutationExpectation
    ): Promise<void> => ipcRenderer.invoke('fs:copy', args),
    deletePath: (
      args: {
        targetPath: string
        connectionId?: string
        recursive?: boolean
      } & SshMutationExpectation
    ): Promise<void> => ipcRenderer.invoke('fs:deletePath', args),
    authorizeExternalPath: (args: { targetPath: string }): Promise<void> =>
      ipcRenderer.invoke('fs:authorizeExternalPath', args),
    stat: (args: {
      filePath: string
      connectionId?: string
    }): Promise<{ size: number; isDirectory: boolean; mtime: number }> =>
      ipcRenderer.invoke('fs:stat', args),
    pathExists: (args: { filePath: string; connectionId?: string }): Promise<boolean> =>
      ipcRenderer.invoke('fs:pathExists', args),
    listFiles: (args: {
      rootPath: string
      connectionId?: string
      excludePaths?: string[]
      requestToken?: string
    }): Promise<string[]> => ipcRenderer.invoke('fs:listFiles', args),
    cancelListFiles: (args: { requestToken: string }): Promise<void> =>
      ipcRenderer.invoke('fs:cancelListFiles', args),
    search: (args: {
      query: string
      rootPath: string
      caseSensitive?: boolean
      wholeWord?: boolean
      useRegex?: boolean
      includePattern?: string
      excludePattern?: string
      maxResults?: number
      connectionId?: string
    }): Promise<SearchResult> => ipcRenderer.invoke('fs:search', args),
    importExternalPaths: (
      args: {
        sourcePaths: string[]
        destDir: string
        connectionId?: string
        ensureDir?: boolean
      } & SshMutationExpectation
    ): Promise<{
      results: (
        | {
            sourcePath: string
            status: 'imported'
            destPath: string
            kind: 'file' | 'directory'
            renamed: boolean
          }
        | {
            sourcePath: string
            status: 'skipped'
            reason: 'missing' | 'symlink' | 'permission-denied' | 'unsupported'
          }
        | {
            sourcePath: string
            status: 'failed'
            reason: string
          }
      )[]
    }> => ipcRenderer.invoke('fs:importExternalPaths', args),
    stageExternalPathsForRuntimeUpload: (args: {
      sourcePaths: string[]
    }): Promise<{
      sources: (
        | {
            sourcePath: string
            status: 'staged'
            name: string
            kind: 'file' | 'directory'
            entries: (
              | { relativePath: string; kind: 'directory' }
              | { relativePath: string; kind: 'file'; contentBase64: string }
            )[]
          }
        | {
            sourcePath: string
            status: 'skipped'
            reason: 'missing' | 'symlink' | 'permission-denied' | 'unsupported'
          }
        | {
            sourcePath: string
            status: 'failed'
            reason: string
          }
      )[]
    }> => ipcRenderer.invoke('fs:stageExternalPathsForRuntimeUpload', args),
    resolveDroppedPathsForAgent: (
      args: {
        paths: string[]
        worktreePath: string
        connectionId?: string
      } & SshMutationExpectation
    ): Promise<{
      resolvedPaths: string[]
      skipped: {
        sourcePath: string
        reason: 'missing' | 'symlink' | 'permission-denied' | 'unsupported'
      }[]
      failed: { sourcePath: string; reason: string }[]
    }> => ipcRenderer.invoke('fs:resolveDroppedPathsForAgent', args),
    watchWorktree: (args: { worktreePath: string; connectionId?: string }): Promise<void> =>
      ipcRenderer.invoke('fs:watchWorktree', args),
    unwatchWorktree: (args: { worktreePath: string; connectionId?: string }): Promise<void> =>
      ipcRenderer.invoke('fs:unwatchWorktree', args),
    onFsChanged: (callback: (payload: FsChangedPayload) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: FsChangedPayload) =>
        callback(payload)
      ipcRenderer.on('fs:changed', listener)
      return () => ipcRenderer.removeListener('fs:changed', listener)
    }
  },
  }
}
