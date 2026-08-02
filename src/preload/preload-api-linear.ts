import { contextBridge, ipcRenderer, webFrame, webUtils, electronAPI, preloadE2EConfig, glApi, admitSshConnectionStateForAuthorityReconciliation, admitSshDetectedPorts, richMarkdownContextMenuCommandChannel, type RichMarkdownContextMenuCommandPayload, createBrowserFindSubscriptions, ORCA_APP_RESTART_ABORTED_EVENT, ORCA_APP_RESTART_STARTED_EVENT, ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, ORCA_RENDERER_UNLOAD_PREVENTED_EVENT, ORCA_INTERNAL_FILE_DRAG_TYPE, createNativeFileDropPayload, createRejectedNativeFileDropPayload, hasNativeFileDragTypes, NATIVE_FILE_DROP_MAX_PATHS, resolveNativeFileDropPath, type NativeDropResolution, type NativeFileDropPayload, type NativeFileDropPathEntry, subscribeRuntimeEnvironmentFromPreload, readRendererHeapStatistics, createUpdaterQuitAbortRelay, prepareRendererForAppRestart, nativeFileDropCallbacks, nativeFileDropListenerRegistered, updaterQuitAbortRelay, getLinuxDisplayServer, onNativeFileDrop, subscribeNativeFileDrop, resolveNativeFileDrop, startupDiagnosticsEnabled, browserFindSubscriptions } from './preload-api-runtime-context'
import type { AppIdentity, DashboardSnapshot, DashboardRevealAgentArgs, TerminalPreviewConnectResult, TerminalPreviewDataPayload, CliInstallStatus, AgentHookInstallStatus, CodexConfigSyncStatus, TerminalPaneSplitSource, TerminalTabCreateReply, ProjectExecutionRuntimeResolution, StartupCommandDelivery, AgentProviderSessionMetadata, SleepingAgentLaunchConfig, MobileRelayStatus, MobilePairingConnectionMode, MobileRelayMintFailure, VerifyAndAddRuntimeEnvironmentResult, SshMutationExpectation, SshConnectionState, SshConfigImportResult, SshTargetAddResult, SshTarget, PortForwardEntry, EnrichedDetectedPort, HostRepoCatalogSnapshot, ListReposForExecutionHostArgs, HostLineageSnapshot, ListDesktopLineageForHostArgs, PluginPanelActionOutcome, PluginPanelEntry, PluginConsentRequest, PluginChangeEvent, BaseRefSearchResult, BaseRefDefaultResult, BrowserViewportOverride, CustomPet, FsChangedPayload, FilesystemPathFlavor, GetRateLimitResult, GitHubPRRefreshCandidate, GitHubPRRefreshEvent, GitHubPRRefreshReason, GitHubAssignableUser, GitHubCommentResult, GitHubCreateIssueResult, GitHubOwnerRepo, GitHubWorkItem, JiraProjectStatusOrder, GitPushTarget, GitStagingArea, GitForkSyncExpectedUpstream, GitForkSyncResult, GitUpstreamStatus, GhosttyImportPreview, ListWorkItemsResult, LinearProjectDetail, MemorySnapshot, NotificationDismissResult, NotificationDispatchResult, NotificationDeliveryProbeResult, NotificationPermissionStatusResult, NotificationSoundDataResult, NotificationSoundPathResult, NotificationSoundResult, NestedRepoScanResult, OnboardingState, PersistedUIState, FloatingTerminalCwdRequest, MarkdownDocument, SearchResult, TuiAgent, UpdateStatus, WorktreeBaseStatusEvent, WorktreeDefaultTabsLaunch, WorktreeHeadIdentity, WorktreeRemoteBranchConflictEvent, PtyModelRestoreNeededEvent, PtyListedSession, PtyRendererDeliveryHealthReply, PtyRendererDeliveryStateReport, TerminalViewAttributes, WriteTerminalRenderDesyncEvidenceArgs, PtyMainDeliveryDiagnostics, WarpThemeImportPreview, WarpThemeImportSource, GitHistoryOptions, GitHistoryResult, ShellOpenExternalEditorRequest, ShellOpenExternalEditorResult, ShellOpenLocalPathResult, SkillDiscoveryResult, SkillDiscoveryTarget, SkillFreshnessInventory, SkillUpdateRun, SkillUpdateStartResult, RuntimeBrowserDriverState, RuntimeMobileSessionTabMove, RuntimeStatus, RuntimeSyncWindowGraphResult, RuntimeSyncWindowGraph, RuntimeTerminalCreateRequestPayload, RuntimeTerminalDriverState, RuntimeTerminalPresentation, RuntimeRpcResponse, PublicKnownRuntimeEnvironment, RemoteWorkspaceChangedEvent, RuntimeMobileMarkdownRequest, RuntimeMobileMarkdownResponse, CodexRateLimitResetResult, GrokAccountStatus, RateLimitRuntimeTarget, RateLimitState, WorkspaceSpaceScanProgress, WorkspaceCleanupScanProgress, WorkspacePortAdvertisedUrlChangedEvent, GhAuthDiagnostic, TaskSourceContext, AddIssueCommentBySlugArgs, ClearProjectItemFieldArgs, DeleteIssueCommentBySlugArgs, GetProjectViewTableArgs, GetProjectViewTableResult, GitHubProjectCommentMutationResult, GitHubProjectMutationResult, ListAccessibleProjectsArgs, ListAccessibleProjectsResult, ListAssignableUsersBySlugArgs, ListAssignableUsersBySlugResult, ListIssueTypesBySlugArgs, ListIssueTypesBySlugResult, ListLabelsBySlugArgs, ListLabelsBySlugResult, ListProjectViewsArgs, ListProjectViewsResult, ProjectWorkItemDetailsBySlugArgs, ProjectWorkItemDetailsBySlugResult, ResolveProjectRefArgs, ResolveProjectRefResult, UpdateIssueBySlugArgs, UpdateIssueCommentBySlugArgs, UpdateIssueTypeBySlugArgs, UpdatePullRequestBySlugArgs, UpdateProjectItemFieldArgs, AgentStatusClearIpcPayload, AgentStatusIpcPayload, MigrationUnsupportedPtyEntry, AgentInterruptInferenceRequest, AgentQuestionAnsweredInferenceRequest, TerminalSideEffectBatch, SpeechErrorEvent, SpeechLifecycleEvent, SpeechModelManifest, SpeechModelState, SpeechTranscriptEvent, TelemetryConsentState, PreflightRuntimeContext, RefreshAgentsResult, NativeChatAppendedPayload, NativeChatReadSessionResult, NativeChatSubscriptionFrame, PluginHostInstallResult, PluginHostInstallSource, PluginHostListEntry, PluginHostLogLine, PreloadApi, AgentKind, LaunchSource, RequestKind, AppStarSource, ExecutionHostId, Automation, AutomationCreateInput, AutomationDispatchRequest, AutomationDispatchResult, ExternalAutomationCreateInput, ExternalAutomationActionInput, ExternalAutomationManager, ExternalAutomationRunsInput, ExternalAutomationRunsPage, ExternalAutomationUpdateInput, AutomationRun, AutomationPrecheckResult, AutomationUpdateInput, KeybindingActionId, KeybindingFileSnapshot, AiVaultListArgs, AiVaultSubagentListArgs, AiVaultPrepareSessionResumeArgs, AgentType, LocalLogTailChangedPayload, LocalLogTailReadArgs, LocalLogTailReadResult, LocalLogTailWatchArgs, RuntimeEnvironmentSubscriptionHandle, HostedReviewForBranchArgs, ReadClipboardTextOptions, LocalhostWorktreeLabelResult, LocalhostWorktreeLabelRoute, CrashReportBreadcrumbData, CrashReportCopyDiagnosticsArgs, CrashReportSubmitArgs, CrashReportSubmitResult, ReactErrorBoundaryReportArgs, ReactErrorBoundaryReportResult, RendererHeapStatistics, NativeFileDropCallback } from './preload-api-runtime-context'

export function createPreloadApiLinear(): Record<string, unknown> {
  return {
  linear: {
    connect: (args: {
      apiKey: string
    }): Promise<{ ok: true; viewer: unknown } | { ok: false; error: string }> =>
      ipcRenderer.invoke('linear:connect', args),

    disconnect: (args?: { workspaceId?: string }): Promise<void> =>
      ipcRenderer.invoke('linear:disconnect', args),

    selectWorkspace: (args: { workspaceId: string }): Promise<unknown> =>
      ipcRenderer.invoke('linear:selectWorkspace', args),

    status: (): Promise<unknown> => ipcRenderer.invoke('linear:status'),

    testConnection: (args?: {
      workspaceId?: string
    }): Promise<{ ok: true; viewer: unknown } | { ok: false; error: string }> =>
      ipcRenderer.invoke('linear:testConnection', args),

    searchIssues: (args: {
      query: string
      limit?: number
      workspaceId?: string
    }): Promise<unknown[]> => ipcRenderer.invoke('linear:searchIssues', args),

    listIssues: (args?: {
      filter?: 'assigned' | 'created' | 'all' | 'completed'
      limit?: number
      workspaceId?: string
      attributeFilter?: unknown
    }): Promise<unknown> => ipcRenderer.invoke('linear:listIssues', args),

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
    }): Promise<
      | { ok: true; id: string; identifier: string; title: string; url: string }
      | { ok: false; error: string }
    > => ipcRenderer.invoke('linear:createIssue', args),

    getIssue: (args: { id: string; workspaceId?: string }): Promise<unknown> =>
      ipcRenderer.invoke('linear:getIssue', args),

    updateIssue: (args: {
      id: string
      updates: unknown
      workspaceId?: string
    }): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('linear:updateIssue', args),

    addIssueComment: (args: {
      issueId: string
      body: string
      workspaceId?: string
    }): Promise<{ ok: true; id: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('linear:addIssueComment', args),

    issueComments: (args: { issueId: string; workspaceId?: string }): Promise<unknown[]> =>
      ipcRenderer.invoke('linear:issueComments', args),

    listTeams: (args?: { workspaceId?: string }): Promise<unknown[]> =>
      ipcRenderer.invoke('linear:listTeams', args),

    listProjects: (args?: {
      query?: string
      limit?: number
      workspaceId?: string
      force?: boolean
    }): Promise<unknown> => ipcRenderer.invoke('linear:listProjects', args),

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
    }): Promise<{ ok: true; project: LinearProjectDetail } | { ok: false; error: string }> =>
      ipcRenderer.invoke('linear:createProject', args),

    getProject: (args: { id: string; workspaceId: string; force?: boolean }): Promise<unknown> =>
      ipcRenderer.invoke('linear:getProject', args),

    listProjectIssues: (args: {
      projectId: string
      limit?: number
      workspaceId: string
      force?: boolean
    }): Promise<unknown> => ipcRenderer.invoke('linear:listProjectIssues', args),

    listCustomViews: (args: {
      model: string
      limit?: number
      workspaceId?: string
      force?: boolean
    }): Promise<unknown> => ipcRenderer.invoke('linear:listCustomViews', args),

    getCustomView: (args: {
      viewId: string
      model: string
      workspaceId: string
      force?: boolean
    }): Promise<unknown> => ipcRenderer.invoke('linear:getCustomView', args),

    listCustomViewIssues: (args: {
      viewId: string
      limit?: number
      workspaceId: string
      force?: boolean
    }): Promise<unknown> => ipcRenderer.invoke('linear:listCustomViewIssues', args),

    listCustomViewProjects: (args: {
      viewId: string
      limit?: number
      workspaceId: string
      force?: boolean
    }): Promise<unknown> => ipcRenderer.invoke('linear:listCustomViewProjects', args),

    teamStates: (args: { teamId: string; workspaceId?: string }): Promise<unknown[]> =>
      ipcRenderer.invoke('linear:teamStates', args),

    teamLabels: (args: { teamId: string; workspaceId?: string }): Promise<unknown[]> =>
      ipcRenderer.invoke('linear:teamLabels', args),

    teamMembers: (args: { teamId: string; workspaceId?: string }): Promise<unknown[]> =>
      ipcRenderer.invoke('linear:teamMembers', args)
  },
  jira: {
    connect: (args: {
      siteUrl: string
      email: string
      apiToken: string
      authType?: 'cloud' | 'server'
    }): Promise<{ ok: true; viewer: unknown } | { ok: false; error: string }> =>
      ipcRenderer.invoke('jira:connect', args),

    disconnect: (args?: { siteId?: string }): Promise<void> =>
      ipcRenderer.invoke('jira:disconnect', args),

    selectSite: (args: { siteId: string }): Promise<unknown> =>
      ipcRenderer.invoke('jira:selectSite', args),

    status: (): Promise<unknown> => ipcRenderer.invoke('jira:status'),

    readStatus: (): Promise<unknown> => ipcRenderer.invoke('jira:readStatus'),

    testConnection: (args?: {
      siteId?: string
    }): Promise<{ ok: true; viewer: unknown } | { ok: false; error: string }> =>
      ipcRenderer.invoke('jira:testConnection', args),

    searchIssues: (args: {
      jql: string
      limit?: number
      siteId?: string
      requestId?: string
    }): Promise<unknown[]> => ipcRenderer.invoke('jira:searchIssues', args),
    cancelSearchIssues: (args: { requestId: string }): Promise<void> =>
      ipcRenderer.invoke('jira:cancelSearchIssues', args),

    listIssues: (args?: {
      filter?: 'assigned' | 'reported' | 'all' | 'done'
      limit?: number
      siteId?: string
    }): Promise<unknown[]> => ipcRenderer.invoke('jira:listIssues', args),

    getIssue: (args: { key: string; siteId?: string }): Promise<unknown> =>
      ipcRenderer.invoke('jira:getIssue', args),

    lookupIssueSummary: (args: {
      key: string
      siteId: string
      requestId?: string
    }): Promise<unknown> => ipcRenderer.invoke('jira:lookupIssueSummary', args),
    cancelIssueSummary: (args: { requestId: string }): Promise<void> =>
      ipcRenderer.invoke('jira:cancelIssueSummary', args),

    createIssue: (args: {
      siteId?: string
      projectId: string
      issueTypeId: string
      title: string
      description?: string
      customFields?: Record<string, unknown>
    }): Promise<
      { ok: true; id: string; key: string; url: string } | { ok: false; error: string }
    > => ipcRenderer.invoke('jira:createIssue', args),

    updateIssue: (args: {
      key: string
      updates: unknown
      siteId?: string
    }): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('jira:updateIssue', args),

    addIssueComment: (args: {
      key: string
      body: string
      siteId?: string
    }): Promise<{ ok: true; id: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('jira:addIssueComment', args),

    issueComments: (args: { key: string; siteId?: string }): Promise<unknown[]> =>
      ipcRenderer.invoke('jira:issueComments', args),

    listProjects: (args?: { siteId?: string }): Promise<unknown[]> =>
      ipcRenderer.invoke('jira:listProjects', args),

    listIssueTypes: (args: { projectIdOrKey: string; siteId?: string }): Promise<unknown[]> =>
      ipcRenderer.invoke('jira:listIssueTypes', args),

    listCreateFields: (args: {
      projectIdOrKey: string
      issueTypeId: string
      siteId?: string
    }): Promise<unknown[]> => ipcRenderer.invoke('jira:listCreateFields', args),

    listPriorities: (args?: { siteId?: string }): Promise<unknown[]> =>
      ipcRenderer.invoke('jira:listPriorities', args),

    listAssignableUsers: (args: {
      key: string
      query?: string
      siteId?: string
    }): Promise<unknown[]> => ipcRenderer.invoke('jira:listAssignableUsers', args),

    listTransitions: (args: { key: string; siteId?: string }): Promise<unknown[]> =>
      ipcRenderer.invoke('jira:listTransitions', args),
    getProjectStatusOrder: (args: {
      projectKey: string
      siteId?: string
    }): Promise<JiraProjectStatusOrder> => ipcRenderer.invoke('jira:getProjectStatusOrder', args)
  },
  starNag: {
    onShow: (
      callback: (payload?: { mode?: 'gh' | 'web'; surface?: 'card' | 'toast' }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload?: { mode?: 'gh' | 'web'; surface?: 'card' | 'toast' }
      ): void => callback(payload)
      ipcRenderer.on('star-nag:show', listener)
      return () => ipcRenderer.removeListener('star-nag:show', listener)
    },
    onHide: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('star-nag:hide', listener)
      return () => ipcRenderer.removeListener('star-nag:hide', listener)
    },
    dismiss: (): Promise<void> => ipcRenderer.invoke('star-nag:dismiss'),
    later: (): Promise<void> => ipcRenderer.invoke('star-nag:later'),
    complete: (): Promise<void> => ipcRenderer.invoke('star-nag:complete'),
    disable: (): Promise<void> => ipcRenderer.invoke('star-nag:disable'),
    openWeb: (): Promise<void> => ipcRenderer.invoke('star-nag:openWeb'),
    starOrca: (): Promise<boolean> => ipcRenderer.invoke('star-nag:starOrca'),
    forceShow: (): Promise<void> => ipcRenderer.invoke('star-nag:forceShow'),
    agentValueMoment: (): Promise<
      { status: 'ready'; mode: 'gh' | 'web' } | { status: 'skipped' }
    > => ipcRenderer.invoke('star-nag:agentValueMoment'),
    showAgentValueMoment: (): Promise<void> => ipcRenderer.invoke('star-nag:showAgentValueMoment'),
    onboardingCompleted: (): Promise<void> => ipcRenderer.invoke('star-nag:onboardingCompleted')
  },

  // Why: deliberately loose — main's validator (src/main/telemetry/validator.ts) is the single enforcement point; call sites use the typed wrappers in src/renderer/src/lib/telemetry.ts.
  telemetryTrack: (name: string, props: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('telemetry:track', name, props),
  telemetrySetOptIn: (optedIn: boolean): Promise<void> =>
    ipcRenderer.invoke('telemetry:setOptIn', optedIn),
  telemetryAcknowledgeBanner: (): Promise<void> =>
    ipcRenderer.invoke('telemetry:acknowledgeBanner'),
  telemetryGetConsentState: (): Promise<TelemetryConsentState> =>
    ipcRenderer.invoke('telemetry:getConsentState'),

  // Why: bridges are deliberately loose — main type-narrows this untrusted renderer input (see telemetry-error-tracking.md).
  diagnostics: {
    getStatus: (): Promise<unknown> => ipcRenderer.invoke('diagnostics:getStatus'),
    collectBundle: (lookbackMinutes?: number): Promise<unknown> =>
      ipcRenderer.invoke('diagnostics:collectBundle', lookbackMinutes),
    openBundlePreview: (bundleSubmissionId: string): Promise<void> =>
      ipcRenderer.invoke('diagnostics:openBundlePreview', bundleSubmissionId),
    discardBundlePreview: (bundleSubmissionId: string): Promise<void> =>
      ipcRenderer.invoke('diagnostics:discardBundlePreview', bundleSubmissionId),
    uploadBundle: (bundleSubmissionId: string): Promise<unknown> =>
      ipcRenderer.invoke('diagnostics:uploadBundle', bundleSubmissionId),
    deleteBundle: (ticketId: string): Promise<void> =>
      ipcRenderer.invoke('diagnostics:deleteBundle', ticketId)
  },
  settings: {
    get: (): Promise<unknown> => ipcRenderer.invoke('settings:get'),

    // Why: blocking read for the few startup decisions (terminal side-effect authority) that can't wait for async hydration. Call sparingly.
    getSync: (): unknown => ipcRenderer.sendSync('settings:get-sync'),

    set: (args: Record<string, unknown>): Promise<unknown> =>
      ipcRenderer.invoke('settings:set', args),

    setActiveRuntimeEnvironmentPreference: (args: {
      environmentId: string | null
    }): Promise<unknown> =>
      ipcRenderer.invoke('settings:set-active-runtime-environment-preference', args),

    updatePRBotAuthorOverride: (args: { author: string; isBot: boolean }): Promise<unknown> =>
      ipcRenderer.invoke('settings:update-pr-bot-author-override', args),

    listFonts: (): Promise<string[]> => ipcRenderer.invoke('settings:listFonts'),

    previewGhosttyImport: (): Promise<GhosttyImportPreview> =>
      ipcRenderer.invoke('settings:previewGhosttyImport'),

    previewWarpThemeImport: (source: WarpThemeImportSource): Promise<WarpThemeImportPreview> =>
      ipcRenderer.invoke('settings:previewWarpThemeImport', source),

    onChanged: (callback: (updates: Record<string, unknown>) => void): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        updates: Record<string, unknown>
      ): void => callback(updates)
      ipcRenderer.on('settings:changed', listener)
      return () => ipcRenderer.removeListener('settings:changed', listener)
    }
  },
  localhostWorktreeLabels: {
    register: (args: LocalhostWorktreeLabelRoute): Promise<LocalhostWorktreeLabelResult> =>
      ipcRenderer.invoke('localhostWorktreeLabels:register', args)
  } satisfies PreloadApi['localhostWorktreeLabels'],
  keybindings: {
    get: (): Promise<KeybindingFileSnapshot> => ipcRenderer.invoke('keybindings:get'),
    ensureFile: (): Promise<KeybindingFileSnapshot> => ipcRenderer.invoke('keybindings:ensureFile'),
    setAction: (args: {
      actionId: KeybindingActionId
      bindings: string[] | null
    }): Promise<KeybindingFileSnapshot> => ipcRenderer.invoke('keybindings:setAction', args),
    reload: (): Promise<KeybindingFileSnapshot> => ipcRenderer.invoke('keybindings:reload'),
    openFile: (): Promise<KeybindingFileSnapshot> => ipcRenderer.invoke('keybindings:openFile'),
    revealFile: (): Promise<KeybindingFileSnapshot> => ipcRenderer.invoke('keybindings:revealFile'),
    onChanged: (callback: (snapshot: KeybindingFileSnapshot) => void): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        snapshot: KeybindingFileSnapshot
      ): void => callback(snapshot)
      ipcRenderer.on('keybindings:changed', listener)
      return () => ipcRenderer.removeListener('keybindings:changed', listener)
    }
  },
  codexAccounts: {
    list: (): Promise<unknown> => ipcRenderer.invoke('codexAccounts:list'),
    add: (args?: { runtime?: 'host' | 'wsl'; wslDistro?: string | null }): Promise<unknown> =>
      ipcRenderer.invoke('codexAccounts:add', args),
    reauthenticate: (args: { accountId: string }): Promise<unknown> =>
      ipcRenderer.invoke('codexAccounts:reauthenticate', args),
    remove: (args: { accountId: string }): Promise<unknown> =>
      ipcRenderer.invoke('codexAccounts:remove', args),
    select: (args: {
      accountId: string | null
      runtime?: 'host' | 'wsl'
      wslDistro?: string | null
    }): Promise<unknown> => ipcRenderer.invoke('codexAccounts:select', args),
    listStalePanes: (args: {
      ptyIds: string[]
    }): Promise<
      { ptyId: string; launchAccountId: string | null; activeAccountId: string | null }[]
    > => ipcRenderer.invoke('codexAccounts:listStalePanes', args),
    listRecordedPaneLanes: (args: { ptyIds: string[] }): Promise<Record<string, string>> =>
      ipcRenderer.invoke('codexAccounts:listRecordedPaneLanes', args),
    forgetStalePanes: (args: { ptyIds: string[] }): Promise<void> =>
      ipcRenderer.invoke('codexAccounts:forgetStalePanes', args)
  },
  claudeAccounts: {
    list: (): Promise<unknown> => ipcRenderer.invoke('claudeAccounts:list'),
    add: (args?: { runtime?: 'host' | 'wsl'; wslDistro?: string | null }): Promise<unknown> =>
      ipcRenderer.invoke('claudeAccounts:add', args),
    cancelPendingLogin: (): Promise<boolean> =>
      ipcRenderer.invoke('claudeAccounts:cancelPendingLogin'),
    reauthenticate: (args: { accountId: string }): Promise<unknown> =>
      ipcRenderer.invoke('claudeAccounts:reauthenticate', args),
    remove: (args: { accountId: string }): Promise<unknown> =>
      ipcRenderer.invoke('claudeAccounts:remove', args),
    select: (args: {
      accountId: string | null
      runtime?: 'host' | 'wsl'
      wslDistro?: string | null
    }): Promise<unknown> => ipcRenderer.invoke('claudeAccounts:select', args)
  },
  cli: {
    getInstallStatus: (): Promise<CliInstallStatus> => ipcRenderer.invoke('cli:getInstallStatus'),
    install: (): Promise<CliInstallStatus> => ipcRenderer.invoke('cli:install'),
    remove: (): Promise<CliInstallStatus> => ipcRenderer.invoke('cli:remove'),
    getWslInstallStatus: (args?: { distro?: string | null }): Promise<CliInstallStatus> =>
      ipcRenderer.invoke('cli:getWslInstallStatus', args),
    installWsl: (args?: { distro?: string | null }): Promise<CliInstallStatus> =>
      ipcRenderer.invoke('cli:installWsl', args),
    removeWsl: (args?: { distro?: string | null }): Promise<CliInstallStatus> =>
      ipcRenderer.invoke('cli:removeWsl', args)
  },
  codexConfigSync: {
    status: (): Promise<CodexConfigSyncStatus> => ipcRenderer.invoke('codexConfigSync:status')
  },
  }
}
