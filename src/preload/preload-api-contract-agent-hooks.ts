
import type { DashboardSnapshot, DashboardRevealAgentArgs, TerminalPreviewConnectResult, TerminalPreviewDataPayload, ReleaseChannel, LocalhostWorktreeLabelResult, LocalhostWorktreeLabelRoute, ClaudeRateLimitAccountsState, CodexRateLimitAccountsState, CustomPet, GhosttyImportPreview, GlobalSettings, IssueInfo, NotificationDispatchRequest, NotificationDispatchResult, NotificationDeliveryProbeResult, NotificationDismissResult, NotificationPermissionStatusResult, NotificationSoundResult, OnboardingState, OrcaHooks, PRInfo, ReleaseBuildListResult, UpdateCheckOptions, UpdateStatus, WorktreeSetupLaunch, WorkspaceSessionPatch, WorkspaceSessionState, WarpThemeImportPreview, WarpThemeImportSource, SetupScriptImportCandidate, PublicKnownRuntimeEnvironment, EphemeralVmRecipeDoctorResult, EphemeralVmRecipeResultWarning, EphemeralVmRuntimeRecord, ExecutionHostId, CliInstallStatus, AgentHookInstallStatus, CodexConfigSyncStatus, ShellOpenExternalEditorRequest, ShellOpenExternalEditorResult, ShellOpenLocalPathResult, SkillDiscoveryResult, SkillDiscoveryTarget, SkillFreshnessInventory, SkillUpdateRun, SkillUpdateStartResult, DeveloperPermissionId, DeveloperPermissionRequestResult, DeveloperPermissionState, ComputerUsePermissionId, ComputerUsePermissionResetResult, ComputerUsePermissionSetupResult, ComputerUsePermissionStatusResult, RemoteWorkspaceChangedEvent, RemoteWorkspaceConnectedClient, RemoteWorkspacePatchResult, RemoteWorkspaceSnapshot, KeybindingActionId, KeybindingFileSnapshot, BrowserApi, PreflightApi, StatsApi, MemoryApi, ClaudeUsageApi, CodexUsageApi, OpenCodeUsageApi, AiVaultApi, NativeChatApi } from './preload-api-contract-types';export type PreloadApiAgentHooks = {
  settings: {
    get: () => Promise<GlobalSettings>
    /** Synchronous persisted-settings read for startup decisions that can't wait for async hydration. Blocking IPC — call sparingly. */
    getSync: () => GlobalSettings | null
    set: (args: Partial<GlobalSettings>) => Promise<GlobalSettings>
    setActiveRuntimeEnvironmentPreference: (args: {
      environmentId: string | null
    }) => Promise<GlobalSettings>
    updatePRBotAuthorOverride: (args: { author: string; isBot: boolean }) => Promise<GlobalSettings>
    listFonts: () => Promise<string[]>
    previewGhosttyImport: () => Promise<GhosttyImportPreview>
    previewWarpThemeImport: (source: WarpThemeImportSource) => Promise<WarpThemeImportPreview>
    /** Subscribe to out-of-band settings updates (e.g. View > Appearance toggles) to stay in sync with main. */
    onChanged: (callback: (updates: Partial<GlobalSettings>) => void) => () => void
  }
  localhostWorktreeLabels: {
    register: (args: LocalhostWorktreeLabelRoute) => Promise<LocalhostWorktreeLabelResult>
  }
  keybindings: {
    get: () => Promise<KeybindingFileSnapshot>
    ensureFile: () => Promise<KeybindingFileSnapshot>
    setAction: (args: {
      actionId: KeybindingActionId
      bindings: string[] | null
    }) => Promise<KeybindingFileSnapshot>
    reload: () => Promise<KeybindingFileSnapshot>
    openFile: () => Promise<KeybindingFileSnapshot>
    revealFile: () => Promise<KeybindingFileSnapshot>
    onChanged: (callback: (snapshot: KeybindingFileSnapshot) => void) => () => void
  }
  codexAccounts: {
    list: () => Promise<CodexRateLimitAccountsState>
    add: (args?: {
      runtime?: 'host' | 'wsl'
      wslDistro?: string | null
    }) => Promise<CodexRateLimitAccountsState>
    reauthenticate: (args: { accountId: string }) => Promise<CodexRateLimitAccountsState>
    remove: (args: { accountId: string }) => Promise<CodexRateLimitAccountsState>
    select: (args: {
      accountId: string | null
      runtime?: 'host' | 'wsl'
      wslDistro?: string | null
    }) => Promise<CodexRateLimitAccountsState>
    /** Live PTYs whose baked CODEX_HOME still points at a deselected account. */
    listStalePanes: (args: {
      ptyIds: string[]
    }) => Promise<
      { ptyId: string; launchAccountId: string | null; activeAccountId: string | null }[]
    >
    /** The selection lane each PTY launched from, keyed by pty id; unrecorded panes are absent. */
    listRecordedPaneLanes: (args: { ptyIds: string[] }) => Promise<Record<string, string>>
    /** Drops launch records so a dismissed prompt stays dismissed across restarts. */
    forgetStalePanes: (args: { ptyIds: string[] }) => Promise<void>
  }
  claudeAccounts: {
    list: () => Promise<ClaudeRateLimitAccountsState>
    add: (args?: {
      runtime?: 'host' | 'wsl'
      wslDistro?: string | null
    }) => Promise<ClaudeRateLimitAccountsState>
    cancelPendingLogin: () => Promise<boolean>
    reauthenticate: (args: { accountId: string }) => Promise<ClaudeRateLimitAccountsState>
    remove: (args: { accountId: string }) => Promise<ClaudeRateLimitAccountsState>
    select: (args: {
      accountId: string | null
      runtime?: 'host' | 'wsl'
      wslDistro?: string | null
    }) => Promise<ClaudeRateLimitAccountsState>
  }
  cli: {
    getInstallStatus: () => Promise<CliInstallStatus>
    install: () => Promise<CliInstallStatus>
    remove: () => Promise<CliInstallStatus>
    getWslInstallStatus: (args?: { distro?: string | null }) => Promise<CliInstallStatus>
    installWsl: (args?: { distro?: string | null }) => Promise<CliInstallStatus>
    removeWsl: (args?: { distro?: string | null }) => Promise<CliInstallStatus>
  }
  codexConfigSync: {
    status: () => Promise<CodexConfigSyncStatus>
  }
  agentHooks: {
    claudeStatus: () => Promise<AgentHookInstallStatus>
    openClaudeStatus: () => Promise<AgentHookInstallStatus>
    codexStatus: () => Promise<AgentHookInstallStatus>
    geminiStatus: () => Promise<AgentHookInstallStatus>
    antigravityStatus: () => Promise<AgentHookInstallStatus>
    ampStatus: () => Promise<AgentHookInstallStatus>
    cursorStatus: () => Promise<AgentHookInstallStatus>
    droidStatus: () => Promise<AgentHookInstallStatus>
    commandCodeStatus: () => Promise<AgentHookInstallStatus>
    grokStatus: () => Promise<AgentHookInstallStatus>
    copilotStatus: () => Promise<AgentHookInstallStatus>
    hermesStatus: () => Promise<AgentHookInstallStatus>
    devinStatus: () => Promise<AgentHookInstallStatus>
  }
  agentTrust: {
    markTrusted: (args: {
      preset: 'cursor' | 'copilot' | 'codex'
      workspacePath: string
      connectionId?: string
    }) => Promise<void>
  }
  preflight: PreflightApi
  notifications: {
    dispatch: (args: NotificationDispatchRequest) => Promise<NotificationDispatchResult>
    dismiss: (ids: string[]) => Promise<NotificationDismissResult>
    openSystemSettings: () => Promise<void>
    getPermissionStatus: () => Promise<NotificationPermissionStatusResult>
    probeDelivery: (args?: { force?: boolean }) => Promise<NotificationDeliveryProbeResult>
    playSound: (options?: { force?: boolean; volume?: number }) => Promise<NotificationSoundResult>
  }
  onboarding: {
    get: () => Promise<OnboardingState>
    // Why: main merges the checklist field-by-field, so a partial checklist is fine.
    update: (
      updates: Partial<Omit<OnboardingState, 'checklist'>> & {
        checklist?: Partial<OnboardingState['checklist']>
      }
    ) => Promise<OnboardingState>
  }
  dashboard: {
    openPopout: () => Promise<void>
    publishSnapshot: (snapshot: DashboardSnapshot) => Promise<void>
    getPopoutOpen: () => Promise<boolean>
    onPopoutOpenChanged: (callback: (open: boolean) => void) => () => void
    onSnapshotRequested: (callback: () => void) => () => void
    onRevealAgent: (callback: (args: DashboardRevealAgentArgs) => void) => () => void
    onAckAgent: (callback: (paneKey: string) => void) => () => void
    requestSnapshot: () => Promise<void>
    onSnapshot: (callback: (snapshot: DashboardSnapshot) => void) => () => void
    revealAgent: (args: DashboardRevealAgentArgs) => Promise<void>
    ackAgent: (paneKey: string) => Promise<void>
  }
  terminalPreview: {
    connect: (
      ptyId: string,
      opts?: { scrollbackRows?: number }
    ) => Promise<TerminalPreviewConnectResult>
    input: (ptyId: string, data: string) => Promise<boolean>
    /** Claim the PTY grid for the preview dialog; resolves to the size actually in effect. */
    fit: (
      ptyId: string,
      cols: number,
      rows: number
    ) => Promise<{ cols: number; rows: number } | null>
    ack: (ptyId: string, bytes: number) => Promise<void>
    unsubscribe: (ptyId: string) => Promise<void>
    onData: (callback: (payload: TerminalPreviewDataPayload) => void) => () => void
  }
  macosTccPrompts: {
    /** Fires once macOS has raised its Nth consent dialog naming Orca (#9756). */
    onThreshold: (callback: (payload: { promptCount: number }) => void) => () => void
    consumePending: () => Promise<{ claimId: number; promptCount: number } | null>
    acknowledgePending: (claimId: number) => Promise<void>
    releasePending: (claimId: number) => Promise<void>
    dismiss: () => Promise<void>
  }
  developerPermissions: {
    getStatus: () => Promise<DeveloperPermissionState[]>
    request: (args: { id: DeveloperPermissionId }) => Promise<DeveloperPermissionRequestResult>
    openSettings: (args: { id: DeveloperPermissionId }) => Promise<void>
  }
  computerUsePermissions: {
    getStatus: () => Promise<ComputerUsePermissionStatusResult>
    openSetup: (args?: {
      id?: ComputerUsePermissionId
    }) => Promise<ComputerUsePermissionSetupResult>
    reset: () => Promise<ComputerUsePermissionResetResult>
  }
  shell: {
    openPath: (path: string) => Promise<void>
    openInFileManager: (path: string) => Promise<ShellOpenLocalPathResult>
    openInExternalEditor: (
      request: ShellOpenExternalEditorRequest
    ) => Promise<ShellOpenExternalEditorResult>
    openUrl: (url: string) => Promise<void>
    openFilePath: (path: string) => Promise<boolean>
    openFileUri: (uri: string) => Promise<void>
    pathExists: (path: string) => Promise<boolean>
    pickAttachment: () => Promise<string | null>
    pickImage: () => Promise<string | null>
    pickRepoIconImage: () => Promise<{ dataUrl: string; fileName: string } | null>
    pickAudio: () => Promise<string | null>
    pickDirectory: (args: { defaultPath?: string }) => Promise<string | null>
    copyFile: (args: { srcPath: string; destPath: string }) => Promise<void>
  }
  skills: {
    discover: (target?: SkillDiscoveryTarget) => Promise<SkillDiscoveryResult>
    freshnessInventory: () => Promise<SkillFreshnessInventory>
    startUpdateRun: (names: string[]) => Promise<SkillUpdateStartResult>
    cancelUpdateRun: () => Promise<void>
    acknowledgeUpdateRun: () => Promise<void>
    getUpdateRun: () => Promise<SkillUpdateRun>
    onUpdateRun: (callback: (run: SkillUpdateRun) => void) => () => void
  }
  pet: {
    import: () => Promise<CustomPet | null>
    importPetBundle: () => Promise<CustomPet | null>
    read: (id: string, fileName: string, kind?: 'image' | 'bundle') => Promise<ArrayBuffer | null>
    delete: (id: string, fileName: string, kind?: 'image' | 'bundle') => Promise<void>
  }
  browser: BrowserApi
  hooks: {
    check: (args: { repoId: string; hostId?: ExecutionHostId }) => Promise<{
      status?: 'ok' | 'error'
      hasHooks: boolean
      hooks: OrcaHooks | null
      mayNeedUpdate: boolean
    }>
    inspectSetupScriptImports: (args: {
      repoId: string
      hostId?: ExecutionHostId
    }) => Promise<SetupScriptImportCandidate[]>
    createIssueCommandRunner: (args: {
      repoId: string
      worktreePath: string
      command: string
    }) => Promise<WorktreeSetupLaunch>
    readIssueCommand: (args: { repoId: string; hostId?: ExecutionHostId }) => Promise<{
      status?: 'ok' | 'error'
      localContent: string | null
      sharedContent: string | null
      effectiveContent: string | null
      localFilePath: string
      source: 'local' | 'shared' | 'none'
    }>
    writeIssueCommand: (args: {
      repoId: string
      content: string
      hostId?: ExecutionHostId
    }) => Promise<void>
  }
  ephemeralVm: {
    listRecipes: (args: { repoId: string }) => Promise<{
      status: 'ok' | 'error'
      repoPath: string | null
      recipes: OrcaHooks['environmentRecipes']
      diagnostics: NonNullable<OrcaHooks['environmentRecipeDiagnostics']>
      message?: string
    }>
    listRecipeCatalog: () => Promise<
      {
        repoId: string
        repoName: string
        repoPath: string
        recipes: NonNullable<OrcaHooks['environmentRecipes']>
        diagnostics: NonNullable<OrcaHooks['environmentRecipeDiagnostics']>
      }[]
    >
    doctor: (args: { repoId: string; recipeId: string }) => Promise<EphemeralVmRecipeDoctorResult>
    provision: (args: {
      repoId: string
      recipeId: string
      workspaceName?: string
      projectId?: string
      workspaceId?: string
      provisionId?: string
    }) => Promise<
      | {
          ok: true
          connectionType: 'orca-server'
          runtime: EphemeralVmRuntimeRecord
          environment: PublicKnownRuntimeEnvironment
          stderr: string
          warnings: EphemeralVmRecipeResultWarning[]
        }
      | {
          ok: true
          connectionType: 'ssh'
          runtime: EphemeralVmRuntimeRecord
          sshTargetId: string
          stderr: string
          warnings: EphemeralVmRecipeResultWarning[]
        }
      | { ok: false; error: string; stderr: string; stdout: string }
    >
    cancelProvision: (args: { provisionId: string }) => Promise<{ cancelled: boolean }>
    onProvisionEvent: (
      callback: (event: { provisionId: string; stream: 'stdout' | 'stderr'; chunk: string }) => void
    ) => () => void
    listRuntimes: () => Promise<EphemeralVmRuntimeRecord[]>
    attachWorkspace: (args: {
      runtimeId: string
      workspaceId: string
    }) => Promise<EphemeralVmRuntimeRecord>
    suspendWorkspace: (args: { workspaceId: string }) => Promise<EphemeralVmRuntimeRecord | null>
    resumeWorkspace: (args: { workspaceId: string }) => Promise<EphemeralVmRuntimeRecord | null>
    cleanup: (args: { runtimeId: string }) => Promise<EphemeralVmRuntimeRecord>
    getCleanupCommand: (args: { runtimeId: string }) => Promise<{
      runtimeId: string
      command: string | null
      payloadJson: string
      cleanupDisabled: boolean
      message?: string
    }>
  }
  cache: {
    getGitHub: () => Promise<{
      pr: Record<string, { data: PRInfo | null; fetchedAt: number }>
      issue: Record<string, { data: IssueInfo | null; fetchedAt: number }>
    }>
    setGitHub: (args: {
      cache: {
        pr: Record<string, { data: PRInfo | null; fetchedAt: number }>
        issue: Record<string, { data: IssueInfo | null; fetchedAt: number }>
      }
    }) => Promise<void>
  }
  session: {
    // hostId defaults to the 'local' partition on main, so omitting it stays backward-compatible.
    get: (hostId?: ExecutionHostId) => Promise<WorkspaceSessionState>
    set: (args: WorkspaceSessionState, hostId?: ExecutionHostId) => Promise<void>
    patch: (args: WorkspaceSessionPatch, hostId?: ExecutionHostId) => Promise<void>
    flush: () => Promise<void>
    readTerminalScrollback: (args: { ref: string }) => string | null
    setSync: (args: WorkspaceSessionState, hostId?: ExecutionHostId) => void
  }
  remoteWorkspace: {
    get: (args: { targetId: string }) => Promise<RemoteWorkspaceSnapshot | null>
    setForConnectedTargets: (args: {
      session?: WorkspaceSessionState
      hydratedTargetIds?: string[]
    }) => Promise<{ targetId: string; result: RemoteWorkspacePatchResult }[]>
    listEnabledConnectedTargets: () => Promise<string[]>
    listConnectedClients: (args?: {
      targetIds?: string[]
    }) => Promise<{ targetId: string; clients: RemoteWorkspaceConnectedClient[] }[]>
    clientId: () => Promise<string>
    onChanged: (callback: (event: RemoteWorkspaceChangedEvent) => void) => () => void
  }
  updater: {
    getVersion: () => Promise<string>
    getStatus: () => Promise<UpdateStatus>
    check: (options?: UpdateCheckOptions) => Promise<void>
    download: () => Promise<void>
    quitAndInstall: () => Promise<void>
    dismissNudge: () => Promise<void>
    dismissAvailableUpdate: () => Promise<void>
    listBuilds: (channel: ReleaseChannel) => Promise<ReleaseBuildListResult>
    onStatus: (callback: (status: UpdateStatus) => void) => () => void
    onClearDismissal: (callback: () => void) => () => void
  }
  notebook: {
    runPythonCell: (args: {
      filePath: string
      code: string
      preamble?: string
      connectionId?: string | null
    }) => Promise<{ stdout: string; stderr: string; exitCode: number | null; error?: string }>
  }
  stats: StatsApi
  memory: MemoryApi
  claudeUsage: ClaudeUsageApi
  codexUsage: CodexUsageApi
  openCodeUsage: OpenCodeUsageApi
  aiVault: AiVaultApi
  nativeChat: NativeChatApi
}
