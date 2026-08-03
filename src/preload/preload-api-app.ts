import { ipcRenderer, ORCA_APP_RESTART_ABORTED_EVENT, ORCA_APP_RESTART_STARTED_EVENT, prepareRendererForAppRestart, getLinuxDisplayServer, startupDiagnosticsEnabled } from './preload-api-runtime-context';import type { AppIdentity, HostRepoCatalogSnapshot, ListReposForExecutionHostArgs, HostLineageSnapshot, ListDesktopLineageForHostArgs, PluginPanelActionOutcome, PluginPanelEntry, PluginConsentRequest, PluginChangeEvent, BaseRefSearchResult, BaseRefDefaultResult, NestedRepoScanResult, FloatingTerminalCwdRequest, MarkdownDocument, WorktreeBaseStatusEvent, WorktreeHeadIdentity, WorktreeRemoteBranchConflictEvent, WriteTerminalRenderDesyncEvidenceArgs, WorkspaceSpaceScanProgress, WorkspaceCleanupScanProgress, WorkspacePortAdvertisedUrlChangedEvent, PluginHostInstallResult, PluginHostInstallSource, PluginHostListEntry, PluginHostLogLine, PreloadApi, ExecutionHostId } from './preload-api-runtime-context';export function createPreloadApiApp(): Record<string, unknown> {
  return {
  app: {
    getIdentity: (): Promise<AppIdentity> => ipcRenderer.invoke('app:getIdentity'),
    getFeatureWallAssetBaseUrl: (): Promise<string> =>
      ipcRenderer.invoke('app:getFeatureWallAssetBaseUrl'),
    relaunch: (): Promise<void> => ipcRenderer.invoke('app:relaunch'),
    restart: async (): Promise<void> => {
      await prepareRendererForAppRestart(window, {
        startedEventName: ORCA_APP_RESTART_STARTED_EVENT,
        abortedEventName: ORCA_APP_RESTART_ABORTED_EVENT
      })
      try {
        return await ipcRenderer.invoke('app:restart')
      } catch (error) {
        window.dispatchEvent(new Event(ORCA_APP_RESTART_ABORTED_EVENT))
        throw error
      }
    },
    reload: (): Promise<void> => ipcRenderer.invoke('app:reload'),
    persistBeforeUnloadSync: (
      args: Parameters<PreloadApi['app']['persistBeforeUnloadSync']>[0]
    ) => {
      const result = ipcRenderer.sendSync('app:persist-before-unload-sync', args) as {
        ok?: unknown
      }
      if (result?.ok !== true) {
        throw new Error('Failed to persist renderer state before unload.')
      }
    },
    awaitFirstWindowStartupServices: (): Promise<void> =>
      ipcRenderer.invoke('app:awaitFirstWindowStartupServices'),
    recoverLegacyWorkerTerminalsForRendererStartup: (): Promise<void> =>
      ipcRenderer.invoke('app:recoverLegacyWorkerTerminalsForRendererStartup'),
    startupDiagnostic: (event: string, details?: Record<string, unknown>): Promise<void> =>
      startupDiagnosticsEnabled
        ? ipcRenderer.invoke('app:startupDiagnostic', event, details)
        : Promise.resolve(),
    // Why: macOS input mode (or layout ID) so keyboard workarounds can tell CJK/compose layouts from US QWERTY (issue #1205); null on non-Darwin or read failure.
    getKeyboardInputSourceId: (): Promise<string | null> =>
      ipcRenderer.invoke('app:getKeyboardInputSourceId'),
    setUnreadDockBadgeCount: (count: number): Promise<void> =>
      ipcRenderer.invoke('app:setUnreadDockBadgeCount', count),
    getFloatingTerminalCwd: (args?: FloatingTerminalCwdRequest): Promise<string> =>
      ipcRenderer.invoke('app:getFloatingTerminalCwd', args),
    getFloatingMarkdownDirectory: (): Promise<string> =>
      ipcRenderer.invoke('app:getFloatingMarkdownDirectory'),
    pickFloatingMarkdownDocument: (): Promise<MarkdownDocument | null> =>
      ipcRenderer.invoke('app:pickFloatingMarkdownDocument'),
    pickFloatingWorkspaceDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke('app:pickFloatingWorkspaceDirectory'),
    writeTerminalRenderDesyncEvidence: (args: WriteTerminalRenderDesyncEvidenceArgs) =>
      ipcRenderer.invoke('terminal:writeRenderDesyncEvidence', args)
  },
  orcaProfiles: {
    list: () => ipcRenderer.invoke('orcaProfiles:list'),
    authStatus: () => ipcRenderer.invoke('orcaProfiles:authStatus'),
    createLocal: (args) => ipcRenderer.invoke('orcaProfiles:createLocal', args),
    createCloudLinked: (args) => ipcRenderer.invoke('orcaProfiles:createCloudLinked', args),
    switchProfile: (args) => ipcRenderer.invoke('orcaProfiles:switch', args),
    transferProject: (args) => ipcRenderer.invoke('orcaProfiles:transferProject', args),
    findProjectProfiles: (args) => ipcRenderer.invoke('orcaProfiles:findProjectProfiles', args),
    connectCurrent: () => ipcRenderer.invoke('orcaProfiles:connectCurrent'),
    refreshAuth: () => ipcRenderer.invoke('orcaProfiles:refreshAuth'),
    signOutCurrent: () => ipcRenderer.invoke('orcaProfiles:signOutCurrent'),
    selectOrg: (args) => ipcRenderer.invoke('orcaProfiles:selectOrg', args),
    orgMembersList: (args) => ipcRenderer.invoke('orcaProfiles:orgMembersList', args),
    orgMemberInvite: (args) => ipcRenderer.invoke('orcaProfiles:orgMemberInvite', args),
    orgInviteRevoke: (args) => ipcRenderer.invoke('orcaProfiles:orgInviteRevoke', args),
    orgMemberChangeRole: (args) => ipcRenderer.invoke('orcaProfiles:orgMemberChangeRole', args),
    orgMemberRemove: (args) => ipcRenderer.invoke('orcaProfiles:orgMemberRemove', args)
  } satisfies PreloadApi['orcaProfiles'],
  platform: {
    get: () => ({
      platform: process.platform,
      osRelease:
        (process as NodeJS.Process & { getSystemVersion?: () => string }).getSystemVersion?.() ??
        '',
      displayServer: getLinuxDisplayServer()
    })
  } satisfies PreloadApi['platform'],
  wsl: {
    isAvailable: (): Promise<boolean> => ipcRenderer.invoke('wsl:isAvailable'),
    listDistros: (): Promise<string[]> => ipcRenderer.invoke('wsl:listDistros')
  },
  pwsh: {
    isAvailable: (): Promise<boolean> => ipcRenderer.invoke('pwsh:isAvailable')
  },
  gitBash: {
    isAvailable: (): Promise<boolean> => ipcRenderer.invoke('gitBash:isAvailable')
  },
  plugins: {
    list: (): Promise<PluginHostListEntry[]> => ipcRenderer.invoke('plugins:list'),
    listLanguagePacks: () => ipcRenderer.invoke('plugins:listLanguagePacks'),
    consent: (args: PluginConsentRequest): Promise<PluginHostListEntry[]> =>
      ipcRenderer.invoke('plugins:consent', args),
    setEnabled: (args: { pluginKey: string; enabled: boolean }): Promise<PluginHostListEntry[]> =>
      ipcRenderer.invoke('plugins:setEnabled', args),
    readPanelEntry: (args: {
      pluginKey: string
      panelId: string
    }): Promise<PluginPanelEntry | null> => ipcRenderer.invoke('plugins:readPanelEntry', args),
    invokeCommand: (args: {
      pluginKey: string
      commandId: string
      args?: unknown
    }): Promise<unknown> => ipcRenderer.invoke('plugins:invokeCommand', args),
    panelAction: (args: {
      sessionToken: string
      action: string
      params?: unknown
    }): Promise<PluginPanelActionOutcome> => ipcRenderer.invoke('plugins:panelAction', args),
    install: (source: PluginHostInstallSource): Promise<PluginHostInstallResult> =>
      ipcRenderer.invoke('plugins:install', source),
    listMarketplaces: () => ipcRenderer.invoke('plugins:listMarketplaces'),
    addMarketplace: (source) => ipcRenderer.invoke('plugins:addMarketplace', source),
    removeMarketplace: (args) => ipcRenderer.invoke('plugins:removeMarketplace', args),
    refreshMarketplaces: (args = {}) => ipcRenderer.invoke('plugins:refreshMarketplaces', args),
    listMarketplacePlugins: () => ipcRenderer.invoke('plugins:listMarketplacePlugins'),
    previewMarketplacePlugin: (args) =>
      ipcRenderer.invoke('plugins:previewMarketplacePlugin', args),
    installMarketplacePlugin: (preview) =>
      ipcRenderer.invoke('plugins:installMarketplacePlugin', preview),
    previewMarketplaceUpdate: (args) =>
      ipcRenderer.invoke('plugins:previewMarketplaceUpdate', args),
    rollbackMarketplacePlugin: (args) =>
      ipcRenderer.invoke('plugins:rollbackMarketplacePlugin', args),
    remove: (args: { pluginKey: string }): Promise<PluginHostListEntry[]> =>
      ipcRenderer.invoke('plugins:remove', args),
    getLogs: (args: { pluginKey: string }): Promise<PluginHostLogLine[]> =>
      ipcRenderer.invoke('plugins:getLogs', args),
    refresh: (): Promise<PluginHostListEntry[]> => ipcRenderer.invoke('plugins:refresh'),
    onChanged: (callback): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, change: PluginChangeEvent): void =>
        callback(change)
      ipcRenderer.on('plugins:changed', listener)
      return () => {
        ipcRenderer.removeListener('plugins:changed', listener)
      }
    }
  } satisfies PreloadApi['plugins'],
  repos: {
    list: () => ipcRenderer.invoke('repos:list'),

    listForExecutionHost: (args: ListReposForExecutionHostArgs): Promise<HostRepoCatalogSnapshot> =>
      ipcRenderer.invoke('repos:listForExecutionHost', args),

    add: (args) => ipcRenderer.invoke('repos:add', args),

    addRemote: (args) => ipcRenderer.invoke('repos:addRemote', args),

    create: (args) => ipcRenderer.invoke('repos:create', args),

    isGitAvailable: (): Promise<boolean> => ipcRenderer.invoke('repos:isGitAvailable'),

    getDefaultCreateProjectParent: (): Promise<string> =>
      ipcRenderer.invoke('repos:getDefaultCreateProjectParent'),

    remove: (args) => ipcRenderer.invoke('repos:remove', args),

    removeForHost: (args) => ipcRenderer.invoke('repos:removeForHost', args),

    reorder: (args) => ipcRenderer.invoke('repos:reorder', args),

    reorderForHost: (args) => ipcRenderer.invoke('repos:reorderForHost', args),

    update: (args) => ipcRenderer.invoke('repos:update', args),

    pickFolder: () => ipcRenderer.invoke('repos:pickFolder'),

    pickFolders: () => ipcRenderer.invoke('repos:pickFolders'),

    pickDirectory: () => ipcRenderer.invoke('repos:pickDirectory'),

    clone: (args) => ipcRenderer.invoke('repos:clone', args),

    cloneRemote: (args) => ipcRenderer.invoke('repos:cloneRemote', args),

    createRemote: (args) => ipcRenderer.invoke('repos:createRemote', args),

    cloneAbort: () => ipcRenderer.invoke('repos:cloneAbort'),

    onCloneProgress: (
      callback: (data: { phase: string; percent: number }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { phase: string; percent: number }
      ) => callback(data)
      ipcRenderer.on('repos:clone-progress', listener)
      return () => ipcRenderer.removeListener('repos:clone-progress', listener)
    },

    getGitUsername: (args: { repoId: string }): Promise<string> =>
      ipcRenderer.invoke('repos:getGitUsername', args),

    getBaseRefDefault: (args: {
      repoId: string
      hostId?: ExecutionHostId
    }): Promise<BaseRefDefaultResult> => ipcRenderer.invoke('repos:getBaseRefDefault', args),

    searchBaseRefs: (args: {
      repoId: string
      query: string
      limit?: number
      hostId?: ExecutionHostId
    }): Promise<string[]> => ipcRenderer.invoke('repos:searchBaseRefs', args),

    searchBaseRefDetails: (args: {
      repoId: string
      query: string
      limit?: number
      hostId?: ExecutionHostId
    }): Promise<BaseRefSearchResult[]> => ipcRenderer.invoke('repos:searchBaseRefDetails', args),

    onChanged: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('repos:changed', listener)
      return () => ipcRenderer.removeListener('repos:changed', listener)
    }
  } satisfies PreloadApi['repos'],
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    update: (args) => ipcRenderer.invoke('projects:update', args),
    listHostSetups: () => ipcRenderer.invoke('projectHostSetups:list'),
    createHostSetup: (args) => ipcRenderer.invoke('projectHostSetups:create', args),
    setupExistingFolder: (args) =>
      ipcRenderer.invoke('projectHostSetups:setupExistingFolder', args),
    updateHostSetup: (args) => ipcRenderer.invoke('projectHostSetups:update', args),
    deleteHostSetup: (args) => ipcRenderer.invoke('projectHostSetups:delete', args)
  } satisfies PreloadApi['projects'],
  projectGroups: {
    list: () => ipcRenderer.invoke('projectGroups:list'),
    create: (args) => ipcRenderer.invoke('projectGroups:create', args),
    update: (args) => ipcRenderer.invoke('projectGroups:update', args),
    delete: (args) => ipcRenderer.invoke('projectGroups:delete', args),
    moveProject: (args) => ipcRenderer.invoke('projectGroups:moveProject', args),
    scanNested: (args) => ipcRenderer.invoke('projectGroups:scanNested', args),
    cancelNestedScan: (args) => ipcRenderer.invoke('projectGroups:cancelNestedScan', args),
    onNestedScanProgress: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { scanId: string; scan: NestedRepoScanResult }
      ) => callback(data)
      ipcRenderer.on('projectGroups:scanNestedProgress', listener)
      return () => ipcRenderer.removeListener('projectGroups:scanNestedProgress', listener)
    },
    importNested: (args) => ipcRenderer.invoke('projectGroups:importNested', args)
  } satisfies PreloadApi['projectGroups'],
  folderWorkspaces: {
    list: () => ipcRenderer.invoke('folderWorkspaces:list'),
    getPathStatus: (args) => ipcRenderer.invoke('folderWorkspaces:getPathStatus', args),
    create: (args) => ipcRenderer.invoke('folderWorkspaces:create', args),
    update: (args) => ipcRenderer.invoke('folderWorkspaces:update', args),
    delete: (args) => ipcRenderer.invoke('folderWorkspaces:delete', args)
  } satisfies PreloadApi['folderWorkspaces'],
  sparsePresets: {
    list: (args) => ipcRenderer.invoke('sparsePresets:list', args),

    save: (args) => ipcRenderer.invoke('sparsePresets:save', args),

    remove: (args) => ipcRenderer.invoke('sparsePresets:remove', args),

    onChanged: (callback: (data: { repoId: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { repoId: string }) =>
        callback(data)
      ipcRenderer.on('sparsePresets:changed', listener)
      return () => ipcRenderer.removeListener('sparsePresets:changed', listener)
    }
  } satisfies PreloadApi['sparsePresets'],
  worktrees: {
    list: (args) => ipcRenderer.invoke('worktrees:list', args),

    listDetected: (args) => ipcRenderer.invoke('worktrees:listDetected', args),

    cancelListDetected: (args) => ipcRenderer.invoke('worktrees:cancelListDetected', args),

    listAll: () => ipcRenderer.invoke('worktrees:listAll'),

    create: (args) => ipcRenderer.invoke('worktrees:create', args),

    onCreateProgress: (
      callback: (data: { creationId?: string; phase: 'fetching' | 'creating' }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { creationId?: string; phase: 'fetching' | 'creating' }
      ) => callback(data)
      ipcRenderer.on('createWorktree:progress', listener)
      return () => ipcRenderer.removeListener('createWorktree:progress', listener)
    },

    prefetchCreateBase: (args) => ipcRenderer.invoke('worktrees:prefetchCreateBase', args),

    resolvePrBase: (args) => ipcRenderer.invoke('worktrees:resolvePrBase', args),

    resolveMrBase: (args) => ipcRenderer.invoke('worktrees:resolveMrBase', args),

    remove: (args) => ipcRenderer.invoke('worktrees:remove', args),

    forgetLocal: (args) => ipcRenderer.invoke('worktrees:forgetLocal', args),

    forceDeletePreservedBranch: (args) =>
      ipcRenderer.invoke('worktrees:forceDeletePreservedBranch', args),

    updateMeta: (args) => ipcRenderer.invoke('worktrees:updateMeta', args),

    listLineage: () => ipcRenderer.invoke('worktrees:listLineage'),

    listLineageForHost: (args: ListDesktopLineageForHostArgs): Promise<HostLineageSnapshot> =>
      ipcRenderer.invoke('worktrees:listLineageForHost', args),

    updateLineage: (args) => ipcRenderer.invoke('worktrees:updateLineage', args),

    persistSortOrder: (args) => ipcRenderer.invoke('worktrees:persistSortOrder', args),

    getBranchRenameFailureOutput: (args) =>
      ipcRenderer.invoke('worktrees:getBranchRenameFailureOutput', args),

    onChanged: (
      callback: (data: {
        repoId: string
        renamed?: { oldWorktreeId: string; newWorktreeId: string }
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { repoId: string; renamed?: { oldWorktreeId: string; newWorktreeId: string } }
      ) => callback(data)
      ipcRenderer.on('worktrees:changed', listener)
      return () => ipcRenderer.removeListener('worktrees:changed', listener)
    },

    onGitStatusMetadataChanged: (callback: (data: { repoId: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { repoId: string }) =>
        callback(data)
      ipcRenderer.on('worktrees:gitStatusMetadataChanged', listener)
      return () => ipcRenderer.removeListener('worktrees:gitStatusMetadataChanged', listener)
    },

    onHeadIdentitiesChanged: (
      callback: (data: { repoId: string; identities: WorktreeHeadIdentity[] }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { repoId: string; identities: WorktreeHeadIdentity[] }
      ) => callback(data)
      ipcRenderer.on('worktrees:headIdentitiesChanged', listener)
      return () => ipcRenderer.removeListener('worktrees:headIdentitiesChanged', listener)
    },

    onBaseStatus: (callback: (data: WorktreeBaseStatusEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: WorktreeBaseStatusEvent) =>
        callback(data)
      ipcRenderer.on('worktree:baseStatus', listener)
      return () => ipcRenderer.removeListener('worktree:baseStatus', listener)
    },

    onRemoteBranchConflict: (
      callback: (data: WorktreeRemoteBranchConflictEvent) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: WorktreeRemoteBranchConflictEvent
      ) => callback(data)
      ipcRenderer.on('worktree:remoteBranchConflict', listener)
      return () => ipcRenderer.removeListener('worktree:remoteBranchConflict', listener)
    }
  } satisfies PreloadApi['worktrees'],
  workspaceCleanup: {
    scan: (args, onProgress) => {
      if (!onProgress) {
        return ipcRenderer.invoke('workspaceCleanup:scan', args)
      }
      const scanId = args?.scanId ?? crypto.randomUUID()
      const listener = (
        _event: Electron.IpcRendererEvent,
        progress: WorkspaceCleanupScanProgress
      ): void => {
        if (progress.scanId === scanId) {
          onProgress(progress)
        }
      }
      ipcRenderer.on('workspaceCleanup:scanProgress', listener)
      return ipcRenderer
        .invoke('workspaceCleanup:scan', { ...args, scanId })
        .finally(() => ipcRenderer.removeListener('workspaceCleanup:scanProgress', listener))
    },
    dismiss: (args) => ipcRenderer.invoke('workspaceCleanup:dismiss', args),
    clearDismissals: () => ipcRenderer.invoke('workspaceCleanup:clearDismissals'),
    hasKillableLocalProcesses: (args) =>
      ipcRenderer.invoke('workspaceCleanup:hasKillableLocalProcesses', args)
  } satisfies PreloadApi['workspaceCleanup'],
  workspaceSpace: {
    analyze: () => ipcRenderer.invoke('workspaceSpace:analyze'),
    cancel: () => ipcRenderer.invoke('workspaceSpace:cancel'),
    onProgress: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        progress: WorkspaceSpaceScanProgress
      ): void => callback(progress)
      ipcRenderer.on('workspaceSpace:progress', listener)
      return () => ipcRenderer.removeListener('workspaceSpace:progress', listener)
    }
  } satisfies PreloadApi['workspaceSpace'],
  workspacePorts: {
    scan: (args) => ipcRenderer.invoke('workspacePorts:scan', args),
    kill: (args) => ipcRenderer.invoke('workspacePorts:kill', args),
    onAdvertisedUrlChanged: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        event: WorkspacePortAdvertisedUrlChangedEvent
      ): void => callback(event)
      ipcRenderer.on('workspacePorts:advertised-url-changed', listener)
      return () => ipcRenderer.removeListener('workspacePorts:advertised-url-changed', listener)
    }
  } satisfies PreloadApi['workspacePorts'],
  }
}
