
import type { NativeFileDropPayload, BrowserFindSource, TerminalTabCloseRequest, TerminalTabCloseResponse, TerminalTabCreateReply, ReadClipboardTextOptions, VerifyAndAddRuntimeEnvironmentResult, TerminalPaneSplitSource, AgentProviderSessionMetadata, SleepingAgentLaunchConfig, PersistedUIState, TuiAgent, WorktreeDefaultTabsLaunch, WorktreeSetupLaunch, WorktreeStartupLaunch, PublicKnownRuntimeEnvironment, RuntimeRpcResponse, FeatureInteractionId, RichMarkdownContextMenuCommandPayload, RuntimeBrowserDriverState, RuntimeMobileSessionTabMove, RuntimeStatus, RuntimeSyncWindowGraphResult, RuntimeSyncWindowGraph, RuntimeTerminalCreateRequestPayload, RuntimeTerminalDriverState, RuntimeTerminalPresentation, RuntimeMobileMarkdownRequest, RuntimeMobileMarkdownResponse, CodexRateLimitResetResult, GrokAccountStatus, RateLimitRuntimeTarget, RateLimitState, KeybindingActionId, RuntimeEnvironmentSubscriptionHandle } from './preload-api-contract-types';export type PreloadApiGit = {
  ui: {
    get: () => Promise<PersistedUIState>
    set: (args: Partial<PersistedUIState>) => Promise<void>
    recordFeatureInteraction: (id: FeatureInteractionId) => Promise<PersistedUIState>
    onStateChanged: (callback: (ui: PersistedUIState) => void) => () => void
    onOpenSettings: (callback: () => void) => () => void
    /** Consumes a one-shot tray/menu-bar "open settings" intent queued before mount. */
    consumePendingOpenSettings: () => Promise<boolean>
    onOpenSetupGuide: (callback: () => void) => () => void
    onOpenFeatureTour: (callback: () => void) => () => void
    onOpenCrashReport: (callback: () => void) => () => void
    onToggleLeftSidebar: (callback: () => void) => () => void
    onToggleRightSidebar: (callback: () => void) => () => void
    onToggleWorktreePalette: (callback: () => void) => () => void
    onToggleFloatingTerminal: (callback: () => void) => () => void
    onTerminalShortcutCaptured: (
      callback: (data: { actionId: KeybindingActionId }) => void
    ) => () => void
    onOpenQuickOpen: (callback: () => void) => () => void
    onToggleQuickCommandsMenu: (callback: () => void) => () => void
    onOpenNewWorkspace: (callback: () => void) => () => void
    onDeleteCurrentWorkspace: (callback: () => void) => () => void
    onOpenWorkspaceBoard: (callback: () => void) => () => void
    onOpenTasks: (callback: () => void) => () => void
    onJumpToWorktreeIndex: (callback: (index: number) => void) => () => void
    onJumpToTabIndex: (callback: (index: number) => void) => () => void
    onWorktreeHistoryNavigate: (callback: (direction: 'back' | 'forward') => void) => () => void
    onNewBrowserTab: (callback: () => void) => () => void
    onNewMarkdownTab: (callback: () => void) => () => void
    onRequestTabCreate: (
      callback: (data: {
        requestId: string
        url: string
        worktreeId?: string
        sessionProfileId?: string | null
        sessionPartition?: string
        activate?: boolean
      }) => void
    ) => () => void
    replyTabCreate: (reply: { requestId: string; browserPageId?: string; error?: string }) => void
    onRequestTabSetProfile: (
      callback: (data: {
        requestId: string
        browserPageId: string
        profileId: string
        sessionPartition?: string
      }) => void
    ) => () => void
    replyTabSetProfile: (reply: { requestId: string; error?: string }) => void
    onRequestTabClose: (
      callback: (data: { requestId: string; tabId: string | null; worktreeId?: string }) => void
    ) => () => void
    replyTabClose: (reply: { requestId: string; error?: string }) => void
    onNewTerminalTab: (callback: () => void) => () => void
    onFocusBrowserAddressBar: (callback: () => void) => () => void
    onFindInBrowserPage: (source: BrowserFindSource, callback: () => void) => () => void
    onReloadBrowserPage: (callback: () => void) => () => void
    onBrowserHistoryNavigate: (callback: (direction: 'back' | 'forward') => void) => () => void
    onZoomBrowserPage: (callback: (direction: 'in' | 'out' | 'reset') => void) => () => void
    onHardReloadBrowserPage: (callback: () => void) => () => void
    onCloseActiveTab: (callback: () => void) => () => void
    onCloseFloatingItem: (callback: (payload: { sourceId: string }) => void) => () => void
    onSelectFloatingIndex: (callback: (payload: { index: number }) => void) => () => void
    onSwitchTab: (callback: (direction: 1 | -1) => void) => () => void
    onSwitchTabAcrossAllTypes: (callback: (direction: 1 | -1) => void) => () => void
    onSwitchRecentTab: (callback: () => void) => () => void
    onSwitchTerminalTab: (callback: (direction: 1 | -1) => void) => () => void
    onCtrlTabKeyDown: (callback: (data: { shiftKey: boolean }) => void) => () => void
    onCtrlTabKeyUp: (callback: () => void) => () => void
    onToggleStatusBar: (callback: () => void) => () => void
    onDictationKeyDown: (callback: () => void) => () => void
    onExportPdfRequested: (callback: () => void) => () => void
    onAppMenuPaste: (callback: () => void) => () => void
    onEditableContextPaste: (callback: (data: { plainTextOnly: boolean }) => void) => () => void
    onActivateWorktree: (
      callback: (data: {
        repoId: string
        worktreeId: string
        setup?: WorktreeSetupLaunch
        startup?: WorktreeStartupLaunch
        defaultTabs?: WorktreeDefaultTabsLaunch
      }) => void
    ) => () => void
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
    ) => () => void
    onRequestTerminalCreate: (
      callback: (data: RuntimeTerminalCreateRequestPayload) => void
    ) => () => void
    onRequestTerminalTabMount: (
      callback: (data: { worktreeId: string; tabId?: string; ptyId?: string }) => void
    ) => () => void
    replyTerminalCreate: (reply: TerminalTabCreateReply) => void
    onSplitTerminal: (
      callback: (data: {
        tabId: string
        paneRuntimeId: number
        direction: 'horizontal' | 'vertical'
        command?: string
        telemetrySource?: TerminalPaneSplitSource
      }) => void
    ) => () => void
    onRenameTerminal: (
      callback: (data: { tabId: string; title: string | null }) => void
    ) => () => void
    onFocusTerminal: (
      callback: (data: {
        tabId: string
        worktreeId: string
        leafId?: string | null
        ackPaneKeyOnSuccess?: string
        flashFocusedPane?: boolean
        scrollToBottomIfOutputSinceLastView?: boolean
      }) => void
    ) => () => void
    onFocusEditorTab: (
      callback: (data: { tabId: string; worktreeId: string }) => void
    ) => () => void
    onCloseSessionTab: (
      callback: (data: { tabId: string; worktreeId: string }) => void
    ) => () => void
    onMoveSessionTab: (
      callback: (data: { worktreeId: string } & RuntimeMobileSessionTabMove) => void
    ) => () => void
    onOpenFileFromMobile: (
      callback: (data: {
        worktreeId: string
        filePath: string
        relativePath: string
        runtimeEnvironmentId?: string
      }) => void
    ) => () => void
    onOpenDiffFromMobile: (
      callback: (data: {
        worktreeId: string
        filePath: string
        relativePath: string
        staged: boolean
        runtimeEnvironmentId?: string
      }) => void
    ) => () => void
    onMobileMarkdownRequest: (
      callback: (request: RuntimeMobileMarkdownRequest) => void
    ) => () => void
    respondMobileMarkdownRequest: (response: RuntimeMobileMarkdownResponse) => void
    onCloseTerminal: (
      callback: (data: { tabId: string; paneRuntimeId?: number }) => void
    ) => () => void
    onTerminalTabCloseRequest: (callback: (request: TerminalTabCloseRequest) => void) => () => void
    respondTerminalTabClose: (response: TerminalTabCloseResponse) => void
    onSleepWorktree: (callback: (data: { worktreeId: string }) => void) => () => void
    onResumeSleepingAgents: (callback: (data: { worktreeId: string }) => void) => () => void
    onTerminalZoom: (callback: (direction: 'in' | 'out' | 'reset') => void) => () => void
    onSystemResumed: (callback: () => void) => () => void
    readClipboardText: (options?: ReadClipboardTextOptions) => Promise<string>
    readSelectionClipboardText: (options?: ReadClipboardTextOptions) => Promise<string>
    saveClipboardImageAsTempFile: (args?: {
      connectionId?: string | null
      runtimeEnvironmentId?: string | null
    }) => Promise<string | null>
    writeClipboardText: (text: string) => Promise<void>
    writeTerminalClipboardText: (text: string) => Promise<void>
    writeSelectionClipboardText: (text: string) => Promise<void>
    writeClipboardImage: (dataUrl: string) => Promise<void>
    performNativePaste: (options?: { mode?: 'paste' | 'paste-and-match-style' }) => void
    writeClipboardFile: (
      args:
        | {
            filePath: string
            connectionId?: string | null
          }
        | string
    ) => Promise<{ ok: boolean; reason?: string }>
    onFileDrop: (callback: (data: NativeFileDropPayload) => void) => () => void
    getZoomLevel: () => number
    setZoomLevel: (level: number) => void
    syncTrafficLights: (zoomFactor: number) => void
    setMarkdownEditorFocused: (focused: boolean) => void
    setTerminalInputFocused: (focused: boolean) => void
    setFloatingFocus: (state: { panelFocused: boolean; terminalFocused: boolean }) => void
    setShortcutRecorderFocused: (focused: boolean) => void
    onRichMarkdownContextCommand: (
      callback: (payload: RichMarkdownContextMenuCommandPayload) => void
    ) => () => void
    onFullscreenChanged: (callback: (isFullScreen: boolean) => void) => () => void
    minimize: () => void
    maximize: () => void
    isMaximized: () => Promise<boolean>
    onMaximizeChanged: (callback: (isMaximized: boolean) => void) => () => void
    requestClose: () => void
    popupMenu: () => void
    onWindowCloseRequested: (callback: (data: { isQuitting: boolean }) => void) => () => void
    confirmWindowClose: () => void
    notifyWindowRevealed: () => void
  }
  runtime: {
    syncWindowGraph: (graph: RuntimeSyncWindowGraph) => Promise<RuntimeSyncWindowGraphResult>
    getStatus: () => Promise<RuntimeStatus>
    call: (args: { method: string; params?: unknown }) => Promise<RuntimeRpcResponse<unknown>>
    getTerminalFitOverrides: () => Promise<
      { ptyId: string; mode: 'mobile-fit' | 'remote-desktop-fit'; cols: number; rows: number }[]
    >
    getTerminalDrivers: () => Promise<
      {
        ptyId: string
        driver: RuntimeTerminalDriverState
      }[]
    >
    getBrowserDrivers: () => Promise<
      {
        browserPageId: string
        driver: RuntimeBrowserDriverState
      }[]
    >
    restoreTerminalFit: (ptyId: string) => Promise<{ restored: boolean }>
    reclaimBrowserForDesktop: (browserPageId: string) => Promise<{ reclaimed: boolean }>
    onTerminalFitOverrideChanged: (
      callback: (event: {
        ptyId: string
        mode: 'mobile-fit' | 'remote-desktop-fit' | 'desktop-fit'
        cols: number
        rows: number
      }) => void
    ) => () => void
    onTerminalDriverChanged: (
      callback: (event: { ptyId: string; driver: RuntimeTerminalDriverState }) => void
    ) => () => void
    onBrowserDriverChanged: (
      callback: (event: { browserPageId: string; driver: RuntimeBrowserDriverState }) => void
    ) => () => void
  }
  runtimeEnvironments: {
    list: () => Promise<PublicKnownRuntimeEnvironment[]>
    addFromPairingCode: (args: {
      name: string
      pairingCode: string
    }) => Promise<{ environment: PublicKnownRuntimeEnvironment }>
    verifyAndAddFromPairingCode: (args: {
      name: string
      pairingCode: string
      allowLoopback?: boolean
    }) => Promise<VerifyAndAddRuntimeEnvironmentResult>
    resolve: (args: { selector: string }) => Promise<PublicKnownRuntimeEnvironment>
    remove: (args: { selector: string }) => Promise<{ removed: PublicKnownRuntimeEnvironment }>
    disconnect: (args: {
      selector: string
    }) => Promise<{ disconnected: PublicKnownRuntimeEnvironment }>
    connect: (args: {
      selector: string
      timeoutMs?: number
    }) => Promise<RuntimeRpcResponse<RuntimeStatus>>
    getStatus: (args: {
      selector: string
      timeoutMs?: number
    }) => Promise<RuntimeRpcResponse<RuntimeStatus>>
    // Why: system resume / browser online advance pending shared-control reconnect timers only.
    retryConnectionsNow?: () => Promise<void>
    call: (args: {
      selector: string
      method: string
      params?: unknown
      timeoutMs?: number
      expectedEnvironmentPairingRevision?: number
    }) => Promise<RuntimeRpcResponse<unknown>>
    subscribe: (
      args: {
        selector: string
        method: string
        params?: unknown
        timeoutMs?: number
        expectedEnvironmentPairingRevision?: number
      },
      callbacks: {
        onResponse: (response: RuntimeRpcResponse<unknown>) => void
        onBinary?: (bytes: Uint8Array<ArrayBufferLike>) => void
        onError?: (error: { code: string; message: string }) => void
        onClose?: () => void
      }
    ) => Promise<RuntimeEnvironmentSubscriptionHandle>
  }
  rateLimits: {
    get: () => Promise<RateLimitState>
    refresh: () => Promise<RateLimitState>
    refreshCodexForTarget: (target: RateLimitRuntimeTarget) => Promise<RateLimitState>
    consumeCodexResetCredit: () => Promise<CodexRateLimitResetResult>
    refreshClaudeForTarget: (target: RateLimitRuntimeTarget) => Promise<RateLimitState>
    setPollingInterval: (ms: number) => Promise<void>
    fetchInactiveClaudeAccounts: () => Promise<void>
    fetchInactiveCodexAccounts: () => Promise<void>
    refreshMiniMax: () => Promise<RateLimitState>
    refreshGrok: () => Promise<RateLimitState>
    onUpdate: (callback: (state: RateLimitState) => void) => () => void
  }
  minimaxCredentials: {
    getStatus: () => Promise<{ configured: boolean }>
    saveCookie: (cookie: string) => Promise<{ configured: boolean }>
    clearCookie: () => Promise<{ configured: boolean }>
  }
  grokAccounts: {
    getStatus: () => Promise<GrokAccountStatus>
  }
}
