
import type { MobileRelayStatus, MobilePairingConnectionMode, MobileRelayMintFailure, SshConnectionState, SshConfigImportResult, SshTargetAddResult, SshTarget, PortForwardEntry, EnrichedDetectedPort, PluginPanelActionOutcome, PluginPanelEntry, PluginConsentRequest, PluginLanguagePackRegistration, PluginChangeEvent, PluginMarketplaceGitSource, FilesystemPathFlavor, RuntimeAccessGrant, AgentStatusClearIpcPayload, AgentStatusIpcPayload, MigrationUnsupportedPtyEntry, AgentInterruptInferenceRequest, AgentQuestionAnsweredInferenceRequest, SpeechErrorEvent, SpeechLifecycleEvent, SpeechModelManifest, SpeechModelState, SpeechTranscriptEvent, PluginHostListEntry, PluginHostLogLine, PluginHostInstallSource, PluginHostInstallResult, PluginMarketplaceHostSourceState, PluginMarketplaceHostListing, PluginMarketplaceHostInstallPreview } from './preload-api-contract-types';export type PreloadApiUi = {
  ssh: {
    listTargets: () => Promise<SshTarget[]>
    // Removed-target id â last known label, for a friendly host name on workspaces still pinned to a removed target.
    listRemovedTargetLabels: () => Promise<Record<string, string>>
    addTarget: (args: { target: Omit<SshTarget, 'id'> }) => Promise<SshTargetAddResult>
    updateTarget: (args: {
      id: string
      updates: Partial<Omit<SshTarget, 'id'>>
    }) => Promise<SshTarget>
    removeTarget: (args: { id: string }) => Promise<void>
    importConfig: (args?: { reAdopt?: boolean }) => Promise<SshConfigImportResult>
    connect: (args: { targetId: string }) => Promise<SshConnectionState | null>
    disconnect: (args: { targetId: string }) => Promise<void>
    terminateSessions: (args: { targetId: string }) => Promise<void>
    resetRelay: (args: { targetId: string }) => Promise<void>
    getState: (args: { targetId: string }) => Promise<SshConnectionState | null>
    needsPassphrasePrompt: (args: { targetId: string }) => Promise<boolean>
    testConnection: (args: {
      targetId: string
    }) => Promise<{ success: boolean; error?: string; state?: SshConnectionState }>
    onStateChanged: (
      callback: (data: { targetId: string; state: SshConnectionState }) => void
    ) => () => void
    addPortForward: (args: {
      targetId: string
      localPort: number
      remoteHost: string
      remotePort: number
      label?: string
    }) => Promise<PortForwardEntry>
    updatePortForward: (args: {
      id: string
      targetId: string
      localPort: number
      remoteHost: string
      remotePort: number
      label?: string
    }) => Promise<PortForwardEntry>
    removePortForward: (args: { id: string }) => Promise<PortForwardEntry | null>
    listPortForwards: (args?: { targetId?: string }) => Promise<PortForwardEntry[]>
    listDetectedPorts: (args: { targetId: string }) => Promise<EnrichedDetectedPort[]>
    onPortForwardsChanged: (
      callback: (data: { targetId: string; forwards: PortForwardEntry[] }) => void
    ) => () => void
    onDetectedPortsChanged: (
      callback: (data: { targetId: string; ports: EnrichedDetectedPort[] }) => void
    ) => () => void
    browseDir: (args: { targetId: string; dirPath: string }) => Promise<{
      entries: { name: string; isDirectory: boolean }[]
      resolvedPath: string
      pathFlavor: FilesystemPathFlavor
    }>
    onCredentialRequest: (
      callback: (data: {
        requestId: string
        targetId: string
        kind: 'passphrase' | 'password'
        detail: string
      }) => void
    ) => () => void
    onCredentialResolved: (callback: (data: { requestId: string }) => void) => () => void
    submitCredential: (args: { requestId: string; value: string | null }) => Promise<void>
  }
  wsl: {
    isAvailable: () => Promise<boolean>
    listDistros: () => Promise<string[]>
  }
  pwsh: {
    isAvailable: () => Promise<boolean>
  }
  gitBash: {
    isAvailable: () => Promise<boolean>
  }
  plugins: {
    list: () => Promise<PluginHostListEntry[]>
    listLanguagePacks: () => Promise<PluginLanguagePackRegistration[]>
    /** Records the consent-dialog answer; approval is keyed to the plugin's
     *  current capability and trusted-worker fingerprint. */
    consent: (args: PluginConsentRequest) => Promise<PluginHostListEntry[]>
    setEnabled: (args: { pluginKey: string; enabled: boolean }) => Promise<PluginHostListEntry[]>
    /** Returns the panel's CSP-wrapped HTML, or null when the plugin or
     *  panel is missing/disabled. Rendered only inside a sandboxed iframe. */
    readPanelEntry: (args: {
      pluginKey: string
      panelId: string
    }) => Promise<PluginPanelEntry | null>
    invokeCommand: (args: {
      pluginKey: string
      commandId: string
      args?: unknown
    }) => Promise<unknown>
    /** Relays a sandboxed panel's bridge request to main, which enforces the
     *  plugin's consented capabilities before executing. */
    panelAction: (args: {
      sessionToken: string
      action: string
      params?: unknown
    }) => Promise<PluginPanelActionOutcome>
    install: (source: PluginHostInstallSource) => Promise<PluginHostInstallResult>
    listMarketplaces: () => Promise<PluginMarketplaceHostSourceState[]>
    addMarketplace: (
      source: PluginMarketplaceGitSource
    ) => Promise<PluginMarketplaceHostSourceState>
    removeMarketplace: (args: { sourceId: string }) => Promise<PluginMarketplaceHostSourceState[]>
    refreshMarketplaces: (args?: {
      sourceId?: string
    }) => Promise<PluginMarketplaceHostSourceState[]>
    listMarketplacePlugins: () => Promise<PluginMarketplaceHostListing[]>
    previewMarketplacePlugin: (args: {
      marketplaceSourceId: string
      pluginKey: string
    }) => Promise<PluginMarketplaceHostInstallPreview>
    installMarketplacePlugin: (
      preview: Pick<
        PluginMarketplaceHostInstallPreview,
        'marketplaceSourceId' | 'marketplaceCommit' | 'pluginKey' | 'resolvedCommit'
      >
    ) => Promise<PluginHostInstallResult>
    previewMarketplaceUpdate: (args: {
      pluginKey: string
    }) => Promise<PluginMarketplaceHostInstallPreview>
    rollbackMarketplacePlugin: (args: { pluginKey: string }) => Promise<PluginHostInstallResult>
    remove: (args: { pluginKey: string }) => Promise<PluginHostListEntry[]>
    getLogs: (args: { pluginKey: string }) => Promise<PluginHostLogLine[]>
    /** Re-discovers after settings edits (feature flag, dev paths). */
    refresh: () => Promise<PluginHostListEntry[]>
    /** Fires whenever installed plugins, worker states, panels, or content packs change. */
    onChanged: (callback: (event: PluginChangeEvent) => void) => () => void
  }
  agentStatus: {
    /** Listen for agent status updates forwarded from native hook receivers. */
    onSet: (callback: (data: AgentStatusIpcPayload) => void) => () => void
    /** Listen for main-process cleanup that evicted cached hook status. */
    onClear: (callback: (data: AgentStatusClearIpcPayload) => void) => () => void
    /** Return the current main-process hook cache after renderer hydration. */
    getSnapshot: () => Promise<AgentStatusIpcPayload[]>
    inferInterrupt: (request: AgentInterruptInferenceRequest) => Promise<boolean>
    /** Guarded clear for an answered AskUserQuestion wait â the CLI emits no hook at answer time, so the renderer reports the submit keystroke. */
    inferQuestionAnswered: (request: AgentQuestionAnsweredInferenceRequest) => Promise<boolean>
    /** Listen for PTYs on a legacy numeric pane key that have registry-backed UUID pane proof. */
    onMigrationUnsupported: (callback: (entry: MigrationUnsupportedPtyEntry) => void) => () => void
    onMigrationUnsupportedClear: (callback: (data: { ptyId: string }) => void) => () => void
    onLegacyWorkerTerminalRecovery: (
      callback: (data: {
        paneKey: string
        resolution: 'adopted' | 'exited' | 'rolled_back'
        ptyId?: string
      }) => void
    ) => () => void
    getMigrationUnsupportedSnapshot: () => Promise<MigrationUnsupportedPtyEntry[]>
    /** Drop a paneKey from the main-process hook cache and on-disk last-status file. Fire-and-forget. */
    drop: (paneKey: string) => void
    /** Drop every cached hook status under one terminal tab prefix. Fire-and-forget. */
    dropByTabPrefix: (tabId: string) => void
    /** Permanently retire one pane's hook authority while siblings stay live. */
    retirePaneAuthority: (paneKey: string) => void
    /** Move hook authority when a live pane is detached into another tab. */
    transferPaneAuthority: (args: {
      fromPaneKey: string
      toPaneKey: string
      ptyId?: string
    }) => void
  }
  mobile: {
    listNetworkInterfaces: () => Promise<{
      interfaces: { name: string; address: string }[]
    }>
    getPairingQR: (args?: {
      address?: string
      connectionMode?: MobilePairingConnectionMode
      rotate?: boolean
    }) => Promise<
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
          /** Mode the QR actually encodes. */
          connectionMode: MobilePairingConnectionMode
        }
    >
    getWindowsFirewallStatus: (args?: { address?: string }) => Promise<
      | { supported: false }
      | {
          supported: true
          port: number
          ruleAllowed: boolean
          blockingRuleDetected: boolean
          privateFirewallEnabled: boolean
          networkCategory: 'private' | 'public' | 'domain' | 'unknown'
          inspectionAvailable: boolean
        }
    >
    repairWindowsFirewall: () => Promise<
      { ok: true } | { ok: false; reason: 'cancelled' | 'failed' | 'unsupported' }
    >
    openWindowsNetworkSettings: () => Promise<boolean>
    getRuntimePairingUrl: (args?: { address?: string; rotate?: boolean }) => Promise<
      | { available: false }
      | {
          available: true
          pairingUrl: string
          webClientUrl: string | null
          endpoint: string
          deviceId: string
        }
    >
    listDevices: () => Promise<{
      devices: { deviceId: string; name: string; pairedAt: number; lastSeenAt: number }[]
    }>
    revokeDevice: (args: { deviceId: string }) => Promise<{ revoked: boolean }>
    listRuntimeAccessGrants: () => Promise<{ grants: RuntimeAccessGrant[] }>
    revokeRuntimeAccess: (args: { deviceId: string }) => Promise<{ revoked: boolean }>
    isWebSocketReady: () => Promise<{ ready: boolean; endpoint: string | null }>
    getRelayStatus: () => Promise<{ status: MobileRelayStatus }>
    onRelayStatusChanged: (callback: (status: MobileRelayStatus) => void) => () => void
    /** Consumes an auth-failure notification that arrived before the renderer listener mounted. */
    consumePendingUnpairedDeviceAuthFailure?: () => Promise<boolean>
    /** Fires (throttled, once per session) when an unpaired phone repeatedly fails direct-transport auth. */
    onUnpairedDeviceAuthFailure?: (callback: () => void) => () => void
  }
  speech: {
    getCatalog: () => Promise<SpeechModelManifest[]>
    getModelStates: () => Promise<SpeechModelState[]>
    getOpenAiApiKeyStatus: () => Promise<{ configured: boolean }>
    saveOpenAiApiKey: (apiKey: string) => Promise<{ configured: boolean }>
    clearOpenAiApiKey: () => Promise<{ configured: boolean }>
    downloadModel: (modelId: string) => Promise<void>
    cancelDownload: (modelId: string) => Promise<void>
    deleteModel: (modelId: string) => Promise<void>
    startDictation: (
      modelId: string,
      hotwords: string[] | undefined,
      sessionId: string
    ) => Promise<void>
    feedAudio: (samples: Float32Array, sampleRate: number, sessionId?: string) => Promise<void>
    stopDictation: (sessionId?: string) => Promise<void>
    onPartialTranscript: (callback: (data: SpeechTranscriptEvent) => void) => () => void
    onFinalTranscript: (callback: (data: SpeechTranscriptEvent) => void) => () => void
    onDownloadProgress: (
      callback: (data: { modelId: string; progress: number }) => void
    ) => () => void
    onReady: (callback: (data: SpeechLifecycleEvent) => void) => () => void
    onStopped: (callback: (data: SpeechLifecycleEvent) => void) => () => void
    onError: (callback: (data: SpeechErrorEvent) => void) => () => void
  }
}
