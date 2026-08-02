import { contextBridge, ipcRenderer, webFrame, webUtils, electronAPI, preloadE2EConfig, glApi, admitSshConnectionStateForAuthorityReconciliation, admitSshDetectedPorts, richMarkdownContextMenuCommandChannel, type RichMarkdownContextMenuCommandPayload, createBrowserFindSubscriptions, ORCA_APP_RESTART_ABORTED_EVENT, ORCA_APP_RESTART_STARTED_EVENT, ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, ORCA_RENDERER_UNLOAD_PREVENTED_EVENT, ORCA_INTERNAL_FILE_DRAG_TYPE, createNativeFileDropPayload, createRejectedNativeFileDropPayload, hasNativeFileDragTypes, NATIVE_FILE_DROP_MAX_PATHS, resolveNativeFileDropPath, type NativeDropResolution, type NativeFileDropPayload, type NativeFileDropPathEntry, subscribeRuntimeEnvironmentFromPreload, readRendererHeapStatistics, createUpdaterQuitAbortRelay, prepareRendererForAppRestart, nativeFileDropCallbacks, nativeFileDropListenerRegistered, updaterQuitAbortRelay, getLinuxDisplayServer, onNativeFileDrop, subscribeNativeFileDrop, cachedNotificationSound, isNotificationSoundPlaying, cleanupNotificationSoundPlayback, clearNotificationSoundPlaybackState, disposeCachedNotificationSound, resolveNativeFileDrop, startupDiagnosticsEnabled, browserFindSubscriptions } from './preload-api-runtime-context'
import type { AppIdentity, DashboardSnapshot, DashboardRevealAgentArgs, TerminalPreviewConnectResult, TerminalPreviewDataPayload, CliInstallStatus, AgentHookInstallStatus, CodexConfigSyncStatus, TerminalPaneSplitSource, TerminalTabCreateReply, ProjectExecutionRuntimeResolution, StartupCommandDelivery, AgentProviderSessionMetadata, SleepingAgentLaunchConfig, MobileRelayStatus, MobilePairingConnectionMode, MobileRelayMintFailure, VerifyAndAddRuntimeEnvironmentResult, SshMutationExpectation, SshConnectionState, SshConfigImportResult, SshTargetAddResult, SshTarget, PortForwardEntry, EnrichedDetectedPort, HostRepoCatalogSnapshot, ListReposForExecutionHostArgs, HostLineageSnapshot, ListDesktopLineageForHostArgs, PluginPanelActionOutcome, PluginPanelEntry, PluginConsentRequest, PluginChangeEvent, BaseRefSearchResult, BaseRefDefaultResult, BrowserViewportOverride, CustomPet, FsChangedPayload, FilesystemPathFlavor, GetRateLimitResult, GitHubPRRefreshCandidate, GitHubPRRefreshEvent, GitHubPRRefreshReason, GitHubAssignableUser, GitHubCommentResult, GitHubCreateIssueResult, GitHubOwnerRepo, GitHubWorkItem, JiraProjectStatusOrder, GitPushTarget, GitStagingArea, GitForkSyncExpectedUpstream, GitForkSyncResult, GitUpstreamStatus, GhosttyImportPreview, ListWorkItemsResult, LinearProjectDetail, MemorySnapshot, NotificationDismissResult, NotificationDispatchResult, NotificationDeliveryProbeResult, NotificationPermissionStatusResult, NotificationSoundDataResult, NotificationSoundPathResult, NotificationSoundResult, NestedRepoScanResult, OnboardingState, PersistedUIState, FloatingTerminalCwdRequest, MarkdownDocument, SearchResult, TuiAgent, UpdateStatus, WorktreeBaseStatusEvent, WorktreeDefaultTabsLaunch, WorktreeHeadIdentity, WorktreeRemoteBranchConflictEvent, PtyModelRestoreNeededEvent, PtyListedSession, PtyRendererDeliveryHealthReply, PtyRendererDeliveryStateReport, TerminalViewAttributes, WriteTerminalRenderDesyncEvidenceArgs, PtyMainDeliveryDiagnostics, WarpThemeImportPreview, WarpThemeImportSource, GitHistoryOptions, GitHistoryResult, ShellOpenExternalEditorRequest, ShellOpenExternalEditorResult, ShellOpenLocalPathResult, SkillDiscoveryResult, SkillDiscoveryTarget, SkillFreshnessInventory, SkillUpdateRun, SkillUpdateStartResult, RuntimeBrowserDriverState, RuntimeMobileSessionTabMove, RuntimeStatus, RuntimeSyncWindowGraphResult, RuntimeSyncWindowGraph, RuntimeTerminalCreateRequestPayload, RuntimeTerminalDriverState, RuntimeTerminalPresentation, RuntimeRpcResponse, PublicKnownRuntimeEnvironment, RemoteWorkspaceChangedEvent, RuntimeMobileMarkdownRequest, RuntimeMobileMarkdownResponse, CodexRateLimitResetResult, GrokAccountStatus, RateLimitRuntimeTarget, RateLimitState, WorkspaceSpaceScanProgress, WorkspaceCleanupScanProgress, WorkspacePortAdvertisedUrlChangedEvent, GhAuthDiagnostic, TaskSourceContext, AddIssueCommentBySlugArgs, ClearProjectItemFieldArgs, DeleteIssueCommentBySlugArgs, GetProjectViewTableArgs, GetProjectViewTableResult, GitHubProjectCommentMutationResult, GitHubProjectMutationResult, ListAccessibleProjectsArgs, ListAccessibleProjectsResult, ListAssignableUsersBySlugArgs, ListAssignableUsersBySlugResult, ListIssueTypesBySlugArgs, ListIssueTypesBySlugResult, ListLabelsBySlugArgs, ListLabelsBySlugResult, ListProjectViewsArgs, ListProjectViewsResult, ProjectWorkItemDetailsBySlugArgs, ProjectWorkItemDetailsBySlugResult, ResolveProjectRefArgs, ResolveProjectRefResult, UpdateIssueBySlugArgs, UpdateIssueCommentBySlugArgs, UpdateIssueTypeBySlugArgs, UpdatePullRequestBySlugArgs, UpdateProjectItemFieldArgs, AgentStatusClearIpcPayload, AgentStatusIpcPayload, MigrationUnsupportedPtyEntry, AgentInterruptInferenceRequest, AgentQuestionAnsweredInferenceRequest, TerminalSideEffectBatch, SpeechErrorEvent, SpeechLifecycleEvent, SpeechModelManifest, SpeechModelState, SpeechTranscriptEvent, TelemetryConsentState, PreflightRuntimeContext, RefreshAgentsResult, NativeChatAppendedPayload, NativeChatReadSessionResult, NativeChatSubscriptionFrame, PluginHostInstallResult, PluginHostInstallSource, PluginHostListEntry, PluginHostLogLine, PreloadApi, AgentKind, LaunchSource, RequestKind, AppStarSource, ExecutionHostId, Automation, AutomationCreateInput, AutomationDispatchRequest, AutomationDispatchResult, ExternalAutomationCreateInput, ExternalAutomationActionInput, ExternalAutomationManager, ExternalAutomationRunsInput, ExternalAutomationRunsPage, ExternalAutomationUpdateInput, AutomationRun, AutomationPrecheckResult, AutomationUpdateInput, KeybindingActionId, KeybindingFileSnapshot, AiVaultListArgs, AiVaultSubagentListArgs, AiVaultPrepareSessionResumeArgs, AgentType, LocalLogTailChangedPayload, LocalLogTailReadArgs, LocalLogTailReadResult, LocalLogTailWatchArgs, RuntimeEnvironmentSubscriptionHandle, HostedReviewForBranchArgs, ReadClipboardTextOptions, LocalhostWorktreeLabelResult, LocalhostWorktreeLabelRoute, CrashReportBreadcrumbData, CrashReportCopyDiagnosticsArgs, CrashReportSubmitArgs, CrashReportSubmitResult, ReactErrorBoundaryReportArgs, ReactErrorBoundaryReportResult, RendererHeapStatistics, NativeFileDropCallback } from './preload-api-runtime-context'

export function createPreloadApiSsh(): Record<string, unknown> {
  return {
  ssh: {
    listTargets: (): Promise<SshTarget[]> => ipcRenderer.invoke('ssh:listTargets'),

    listRemovedTargetLabels: (): Promise<Record<string, string>> =>
      ipcRenderer.invoke('ssh:listRemovedTargetLabels'),

    addTarget: (args: { target: Omit<SshTarget, 'id'> }): Promise<SshTargetAddResult> =>
      ipcRenderer.invoke('ssh:addTarget', args),

    updateTarget: (args: {
      id: string
      updates: Partial<Omit<SshTarget, 'id'>>
    }): Promise<SshTarget> => ipcRenderer.invoke('ssh:updateTarget', args),

    removeTarget: (args: { id: string }): Promise<void> =>
      ipcRenderer.invoke('ssh:removeTarget', args),

    importConfig: (args?: { reAdopt?: boolean }): Promise<SshConfigImportResult> =>
      ipcRenderer.invoke('ssh:importConfig', args),

    connect: async (args: { targetId: string }): Promise<SshConnectionState | null> => {
      const state: unknown = await ipcRenderer.invoke('ssh:connect', args)
      return state ? admitSshConnectionStateForAuthorityReconciliation(state, args.targetId) : null
    },

    disconnect: (args: { targetId: string }): Promise<void> =>
      ipcRenderer.invoke('ssh:disconnect', args),

    terminateSessions: (args: { targetId: string }): Promise<void> =>
      ipcRenderer.invoke('ssh:terminateSessions', args),

    resetRelay: (args: { targetId: string }): Promise<void> =>
      ipcRenderer.invoke('ssh:resetRelay', args),

    getState: async (args: { targetId: string }): Promise<SshConnectionState | null> => {
      const state: unknown = await ipcRenderer.invoke('ssh:getState', args)
      return state ? admitSshConnectionStateForAuthorityReconciliation(state, args.targetId) : null
    },

    needsPassphrasePrompt: (args: { targetId: string }): Promise<boolean> =>
      ipcRenderer.invoke('ssh:needsPassphrasePrompt', args),

    testConnection: async (args: {
      targetId: string
    }): Promise<{ success: boolean; error?: string; state?: SshConnectionState }> => {
      const result: { success: boolean; error?: string; state?: unknown } =
        await ipcRenderer.invoke('ssh:testConnection', args)
      const state = result.state
        ? admitSshConnectionStateForAuthorityReconciliation(result.state, args.targetId)
        : null
      return { ...result, ...(state ? { state } : { state: undefined }) }
    },

    onStateChanged: (
      callback: (data: { targetId: string; state: SshConnectionState }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { targetId: string; state: unknown }
      ): void => {
        const state = admitSshConnectionStateForAuthorityReconciliation(data.state, data.targetId)
        if (state) {
          callback({ targetId: data.targetId, state })
        }
      }
      ipcRenderer.on('ssh:state-changed', listener)
      return () => ipcRenderer.removeListener('ssh:state-changed', listener)
    },

    addPortForward: (args: {
      targetId: string
      localPort: number
      remoteHost: string
      remotePort: number
      label?: string
    }): Promise<PortForwardEntry> => ipcRenderer.invoke('ssh:addPortForward', args),

    updatePortForward: (args: {
      id: string
      targetId: string
      localPort: number
      remoteHost: string
      remotePort: number
      label?: string
    }): Promise<PortForwardEntry> => ipcRenderer.invoke('ssh:updatePortForward', args),

    removePortForward: (args: { id: string }): Promise<PortForwardEntry | null> =>
      ipcRenderer.invoke('ssh:removePortForward', args),

    listPortForwards: (args?: { targetId?: string }): Promise<PortForwardEntry[]> =>
      ipcRenderer.invoke('ssh:listPortForwards', args),

    listDetectedPorts: async (args: { targetId: string }): Promise<EnrichedDetectedPort[]> =>
      admitSshDetectedPorts(await ipcRenderer.invoke('ssh:listDetectedPorts', args)),

    onPortForwardsChanged: (
      callback: (data: { targetId: string; forwards: PortForwardEntry[] }) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { targetId: string; forwards: PortForwardEntry[] }
      ) => callback(data)
      ipcRenderer.on('ssh:port-forwards-changed', handler)
      return () => ipcRenderer.removeListener('ssh:port-forwards-changed', handler)
    },

    onDetectedPortsChanged: (
      callback: (data: { targetId: string; ports: EnrichedDetectedPort[] }) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { targetId: string; ports: unknown }
      ) => callback({ targetId: data.targetId, ports: admitSshDetectedPorts(data.ports) })
      ipcRenderer.on('ssh:detected-ports-changed', handler)
      return () => ipcRenderer.removeListener('ssh:detected-ports-changed', handler)
    },

    browseDir: (args: {
      targetId: string
      dirPath: string
    }): Promise<{
      entries: { name: string; isDirectory: boolean }[]
      resolvedPath: string
      pathFlavor: FilesystemPathFlavor
    }> => ipcRenderer.invoke('ssh:browseDir', args),

    onCredentialRequest: (
      callback: (data: {
        requestId: string
        targetId: string
        kind: 'passphrase' | 'password'
        detail: string
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          requestId: string
          targetId: string
          kind: 'passphrase' | 'password'
          detail: string
        }
      ) => callback(data)
      ipcRenderer.on('ssh:credential-request', listener)
      return () => ipcRenderer.removeListener('ssh:credential-request', listener)
    },

    onCredentialResolved: (callback: (data: { requestId: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { requestId: string }) =>
        callback(data)
      ipcRenderer.on('ssh:credential-resolved', listener)
      return () => ipcRenderer.removeListener('ssh:credential-resolved', listener)
    },

    submitCredential: (args: { requestId: string; value: string | null }): Promise<void> =>
      ipcRenderer.invoke('ssh:submitCredential', args)
  },
  automations: {
    list: (): Promise<Automation[]> => ipcRenderer.invoke('automations:list'),
    listRuns: (args?: { automationId?: string }): Promise<AutomationRun[]> =>
      ipcRenderer.invoke('automations:listRuns', args),
    listExternalManagers: (): Promise<ExternalAutomationManager[]> =>
      ipcRenderer.invoke('automations:listExternalManagers'),
    listExternalRuns: (input: ExternalAutomationRunsInput): Promise<ExternalAutomationRunsPage> =>
      ipcRenderer.invoke('automations:listExternalRuns', input),
    createExternal: (input: ExternalAutomationCreateInput): Promise<void> =>
      ipcRenderer.invoke('automations:createExternal', input),
    updateExternal: (input: ExternalAutomationUpdateInput): Promise<void> =>
      ipcRenderer.invoke('automations:updateExternal', input),
    runExternalAction: (input: ExternalAutomationActionInput): Promise<void> =>
      ipcRenderer.invoke('automations:runExternalAction', input),
    create: (input: AutomationCreateInput): Promise<Automation> =>
      ipcRenderer.invoke('automations:create', input),
    update: (args: { id: string; updates: AutomationUpdateInput }): Promise<Automation> =>
      ipcRenderer.invoke('automations:update', args),
    delete: (args: { id: string }): Promise<void> => ipcRenderer.invoke('automations:delete', args),
    runNow: (args: { id: string }): Promise<AutomationRun> =>
      ipcRenderer.invoke('automations:runNow', args),
    runPrecheck: (args: {
      automationId: string
      runId: string
    }): Promise<AutomationPrecheckResult | null> =>
      ipcRenderer.invoke('automations:runPrecheck', args),
    markDispatchResult: (result: AutomationDispatchResult): Promise<AutomationRun> =>
      ipcRenderer.invoke('automations:markDispatchResult', result),
    snapshotWorkspaceName: (args: { workspaceId: string; displayName: string }): Promise<number> =>
      ipcRenderer.invoke('automations:snapshotWorkspaceName', args),
    rendererReady: (): Promise<void> => ipcRenderer.invoke('automations:rendererReady'),
    onDispatchRequested: (callback: (request: AutomationDispatchRequest) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, request: AutomationDispatchRequest) =>
        callback(request)
      ipcRenderer.on('automations:dispatchRequested', listener)
      return () => ipcRenderer.removeListener('automations:dispatchRequested', listener)
    }
  },
  e2e: {
    getConfig: () => preloadE2EConfig
  },
  mobile: {
    listNetworkInterfaces: (): Promise<{
      interfaces: { name: string; address: string }[]
    }> => ipcRenderer.invoke('mobile:listNetworkInterfaces'),

    getPairingQR: (args?: {
      address?: string
      connectionMode?: MobilePairingConnectionMode
      rotate?: boolean
    }): Promise<
      | {
          available: false
          reason?: string
          guidance?: string
          relayFailure?: MobileRelayMintFailure
        }
      | {
          available: true
          qrDataUrl: string | null
          qrError?: 'encoding_failed'
          pairingUrl: string
          endpoint: string
          deviceId: string
          connectionMode: MobilePairingConnectionMode
        }
    > => ipcRenderer.invoke('mobile:getPairingQR', args),

    getWindowsFirewallStatus: (args?: { address?: string }) =>
      ipcRenderer.invoke('mobile:getWindowsFirewallStatus', args),

    repairWindowsFirewall: () => ipcRenderer.invoke('mobile:repairWindowsFirewall'),

    openWindowsNetworkSettings: () => ipcRenderer.invoke('mobile:openWindowsNetworkSettings'),

    getRuntimePairingUrl: (args?: {
      address?: string
      rotate?: boolean
    }): Promise<
      | { available: false }
      | {
          available: true
          pairingUrl: string
          webClientUrl: string | null
          endpoint: string
          deviceId: string
        }
    > => ipcRenderer.invoke('mobile:getRuntimePairingUrl', args),

    listDevices: (): Promise<{
      devices: { deviceId: string; name: string; pairedAt: number; lastSeenAt: number }[]
    }> => ipcRenderer.invoke('mobile:listDevices'),

    revokeDevice: (args: { deviceId: string }): Promise<{ revoked: boolean }> =>
      ipcRenderer.invoke('mobile:revokeDevice', args),

    listRuntimeAccessGrants: () => ipcRenderer.invoke('mobile:listRuntimeAccessGrants'),

    revokeRuntimeAccess: (args: { deviceId: string }): Promise<{ revoked: boolean }> =>
      ipcRenderer.invoke('mobile:revokeRuntimeAccess', args),

    isWebSocketReady: (): Promise<{ ready: boolean; endpoint: string | null }> =>
      ipcRenderer.invoke('mobile:isWebSocketReady'),

    getRelayStatus: (): Promise<{ status: MobileRelayStatus }> =>
      ipcRenderer.invoke('mobile:getRelayStatus'),

    onRelayStatusChanged: (callback: (status: MobileRelayStatus) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: MobileRelayStatus) =>
        callback(status)
      ipcRenderer.on('mobile:relayStatusChanged', listener)
      return () => ipcRenderer.removeListener('mobile:relayStatusChanged', listener)
    },

    consumePendingUnpairedDeviceAuthFailure: (): Promise<boolean> =>
      ipcRenderer.invoke('mobile:consumePendingUnpairedDeviceAuthFailure'),

    /** Fires (throttled, once per session) when an unpaired phone repeatedly fails direct-transport auth. */
    onUnpairedDeviceAuthFailure: (callback: () => void): (() => void) => {
      const listener = () => callback()
      ipcRenderer.on('mobile:unpairedDeviceAuthFailure', listener)
      return () => ipcRenderer.removeListener('mobile:unpairedDeviceAuthFailure', listener)
    }
  },
  agentStatus: {
    /** Listen for agent status updates forwarded from native hook receivers. */
    onSet: (callback: (data: AgentStatusIpcPayload) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: AgentStatusIpcPayload) =>
        callback(data)
      ipcRenderer.on('agentStatus:set', listener)
      return () => ipcRenderer.removeListener('agentStatus:set', listener)
    },
    onClear: (callback: (data: AgentStatusClearIpcPayload) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: AgentStatusClearIpcPayload) =>
        callback(data)
      ipcRenderer.on('agentStatus:clear', listener)
      return () => ipcRenderer.removeListener('agentStatus:clear', listener)
    },
    /** Pull cached hook statuses after renderer hydration, so startup replays aren't lost before tabs exist. */
    getSnapshot: (): Promise<AgentStatusIpcPayload[]> =>
      ipcRenderer.invoke('agentStatus:getSnapshot'),
    inferInterrupt: (request: AgentInterruptInferenceRequest): Promise<boolean> =>
      ipcRenderer.invoke('agentStatus:inferInterrupt', request),
    inferQuestionAnswered: (request: AgentQuestionAnsweredInferenceRequest): Promise<boolean> =>
      ipcRenderer.invoke('agentStatus:inferQuestionAnswered', request),
    onMigrationUnsupported: (
      callback: (entry: MigrationUnsupportedPtyEntry) => void
    ): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, entry: MigrationUnsupportedPtyEntry) =>
        callback(entry)
      ipcRenderer.on('agentStatus:migrationUnsupported', listener)
      return () => ipcRenderer.removeListener('agentStatus:migrationUnsupported', listener)
    },
    onMigrationUnsupportedClear: (callback: (data: { ptyId: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { ptyId: string }) =>
        callback(data)
      ipcRenderer.on('agentStatus:migrationUnsupportedClear', listener)
      return () => ipcRenderer.removeListener('agentStatus:migrationUnsupportedClear', listener)
    },
    onLegacyWorkerTerminalRecovery: (
      callback: (data: {
        paneKey: string
        resolution: 'adopted' | 'exited' | 'rolled_back'
        ptyId?: string
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          paneKey: string
          resolution: 'adopted' | 'exited' | 'rolled_back'
          ptyId?: string
        }
      ) => callback(data)
      ipcRenderer.on('agentStatus:legacyWorkerTerminalRecovery', listener)
      return () => ipcRenderer.removeListener('agentStatus:legacyWorkerTerminalRecovery', listener)
    },
    getMigrationUnsupportedSnapshot: (): Promise<MigrationUnsupportedPtyEntry[]> =>
      ipcRenderer.invoke('agentStatus:getMigrationUnsupportedSnapshot'),
    /** Drop the cached hook status for a paneKey on both sides (memory + on-disk) so a relaunch can't resurrect a dismissed row. */
    drop: (paneKey: string): void => {
      ipcRenderer.send('agentStatus:drop', paneKey)
    },
    /** Drop all cached hook statuses under one terminal tab prefix; fired on explicit tab close even without a local row. */
    dropByTabPrefix: (tabId: string): void => {
      ipcRenderer.send('agentStatus:dropByTabPrefix', tabId)
    },
    retirePaneAuthority: (paneKey: string): void => {
      ipcRenderer.send('agentStatus:retirePaneAuthority', paneKey)
    },
    transferPaneAuthority: (args: {
      fromPaneKey: string
      toPaneKey: string
      ptyId?: string
    }): void => {
      ipcRenderer.send('agentStatus:transferPaneAuthority', args)
    }
  },
  }
}
