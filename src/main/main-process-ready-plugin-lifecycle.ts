import * as startupDeps from './main-process-startup-dependencies'
import { startupState } from './main-process-startup-state'

function emitPluginWorktreeLifecycle(
  event: startupDeps.RuntimeWorktreeLifecycleEvent
): void {
  startupState.pluginService?.emitEvent(
    event.kind === 'created' ? 'worktree.created' : 'worktree.removed',
    event.kind === 'created'
      ? { worktreeId: event.worktreeId, path: event.path, branch: event.branch }
      : { worktreeId: event.worktreeId, path: event.path }
  )
}

export async function initializeReadyPlugins(): Promise<void> {
  const pluginSystemStartupStartedAt = performance.now()
  startupState.pluginKillListService = new startupDeps.PluginKillListService({
    pluginsDataDir: startupDeps.getPluginsDataDir(startupDeps.app.getPath('userData'))
  })
  await startupState.pluginKillListService.initialize()
  startupState.pluginMarketplaceService = new startupDeps.PluginMarketplaceService({
    pluginsDataDir: startupDeps.getPluginsDataDir(startupDeps.app.getPath('userData')),
    getKillListEntry: (pluginKey) => startupState.pluginKillListService?.find(pluginKey) ?? null
  })
  const requestOfficialMarketplaceSeed = (): void => {
    if (startupState.store?.getSettings().pluginSystemEnabled !== true) {
      return
    }
    void startupState.pluginMarketplaceService?.seedOfficialSource().catch((error) => {
      console.warn('[plugins] failed to configure the official marketplace:', error)
    })
  }
  startupState.pluginMarketplaceInstaller = new startupDeps.PluginMarketplaceInstaller({
    marketplace: startupState.pluginMarketplaceService,
    userDataPath: startupDeps.app.getPath('userData'),
    hostVersion: startupDeps.app.getVersion(),
    blockedPluginReason: (pluginKey) => startupState.pluginKillListService?.reason(pluginKey) ?? null
  })
  startupState.pluginService = new startupDeps.PluginService({
    userDataPath: startupDeps.app.getPath('userData'),
    hostVersion: startupDeps.app.getVersion(),
    // Feature flag: with the setting off, discovery returns nothing and no
    // plugin code path runs at all.
    isPluginSystemEnabled: () => startupState.store?.getSettings().pluginSystemEnabled === true,
    getDisabledPlugins: () => startupDeps.normalizePluginIdList(startupState.store?.getSettings().disabledPlugins),
    getPluginConsents: () => startupDeps.normalizePluginConsents(startupState.store?.getSettings().pluginConsents),
    getDevPluginPaths: () => startupDeps.normalizePluginIdList(startupState.store?.getSettings().devPluginPaths),
    getKeybindings: () => startupState.keybindings?.getOverrides() ?? {},
    getPluginKillListEntry: (pluginKey) => startupState.pluginKillListService?.find(pluginKey) ?? null,
    hostEntryPath: startupDeps.resolvePluginHostEntryPath(startupDeps.app.getAppPath(), startupDeps.app.isPackaged)
  })
  const bundledPluginBootstrap = new startupDeps.PluginBundledBootstrapCoordinator({
    root: startupDeps.resolveBundledPluginRoot({
      isPackaged: startupDeps.app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: startupDeps.app.getAppPath()
    }),
    userDataPath: startupDeps.app.getPath('userData'),
    hostVersion: startupDeps.app.getVersion(),
    isEnabled: () => startupState.store?.getSettings().pluginSystemEnabled === true,
    blockedPluginReason: (pluginKey) => startupState.pluginKillListService?.reason(pluginKey) ?? null,
    refreshPlugins: () => startupState.pluginService?.refresh() ?? Promise.resolve()
  })
  const requestBundledPluginBootstrap = (): void => {
    void bundledPluginBootstrap
      .request()
      .then((result) => {
        for (const failure of result?.errors ?? []) {
          console.warn(`[plugins] failed to publish bundled ${failure.pluginKey}:`, failure.error)
        }
      })
      .catch((error) => {
        console.warn('[plugins] failed to bootstrap bundled plugins:', error)
      })
  }
  startupState.pluginKillListService.onChanged(() => {
    void startupState.pluginService?.reconcileActivationState().catch((error) => {
      console.warn('[plugins] failed to apply plugin safety-list refresh:', error)
    })
  })
  startupState.store.onSettingsChanged((updates) => {
    if (updates.pluginSystemEnabled === true) {
      requestBundledPluginBootstrap()
      requestOfficialMarketplaceSeed()
    }
    if (startupDeps.app.isPackaged && updates.pluginSystemEnabled === true) {
      void startupState.pluginKillListService?.refresh().catch((error) => {
        console.warn('[plugins] failed to refresh plugin safety list; using cached state:', error)
      })
    }
  })
  // Why: headless `orca serve` clients reach plugins through the runtime RPC
  // methods, which resolve the service via this module-level setter. Consent
  // over RPC uses the same hash-keyed write path as the desktop dialog.
  startupDeps.setPluginServiceForRpc(startupState.pluginService, {
    applyConsent: (request) =>
      startupDeps.applyPluginConsent({
        store: startupState.store!,
        pluginService: startupState.pluginService!,
        ...request
      }),
    applyEnablement: (pluginKey, enabled) =>
      startupDeps.applyPluginEnablement({
        store: startupState.store!,
        pluginService: startupState.pluginService!,
        pluginKey,
        enabled
      })
  })
  // Lazy kernel: initialize() only discovers manifests — no worker forks, no
  // panel reads. Zero plugin code runs before an explicit trigger.
  void startupState.pluginService
    .initialize()
    .then(() => {
      startupDeps.logStartupMilestone('plugin-system-initialized', {
        durationMs: Number((performance.now() - pluginSystemStartupStartedAt).toFixed(2)),
        installedPlugins: startupState.pluginService?.getDiscovered().length ?? 0
      })
    })
    .catch((error) => {
      console.warn('[plugins] failed to initialize plugin service:', error)
    })
  if (startupDeps.app.isPackaged && startupState.store?.getSettings().pluginSystemEnabled === true) {
    void startupState.pluginKillListService.refresh().catch((error) => {
      console.warn('[plugins] failed to refresh plugin safety list; using cached state:', error)
    })
  }
  startupState.pluginService.onChanged((event) => {
    if (
      event.contentPacksChanged &&
      startupDeps.setMainPluginLanguagePacks(startupState.pluginService?.contentPacks.languagePacks.list() ?? [])
    ) {
      void startupDeps.setMainUiLanguage(startupState.store!.getSettings().uiLanguage).then(() => startupDeps.rebuildAppMenu())
    }
    for (const window of startupDeps.BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('plugins:changed', event)
      }
    }
  })
  requestBundledPluginBootstrap()
  requestOfficialMarketplaceSeed()
  // v0 plugin event seams: agent status (hook pipeline tap) + worktree
  // lifecycle (runtime tap). Server-side filtered per plugin subscription.
  startupDeps.agentHookServer.subscribeEnrichedStatus((enriched) => {
    startupState.pluginService?.emitEvent('agent.status.changed', {
      worktreeId: enriched.worktreeId ?? null,
      paneKey: enriched.paneKey,
      state: enriched.payload.state,
      receivedAt: enriched.receivedAt
    })
  })
  startupState.runtime!.onWorktreeLifecycle((event) => {
    emitPluginWorktreeLifecycle(event)
  })
  startupState.starNag = new startupDeps.StarNagService(startupState.store, startupState.stats)
  startupState.starNag.start()
  startupState.starNag.registerIpcHandlers()
  startupState.runtime!.setAgentBrowserBridge(
    new startupDeps.AgentBrowserBridge(startupDeps.browserManager, {
      onTabsChanged: (worktreeId) => startupState.runtime!.notifyMobileSessionTabsChanged(worktreeId)
    })
  )

  // Emulator bridge (serve-sim). macOS-only feature (gated in CLI/runtime); always ship like agent-browser.
  // Why: externally started serve-sim processes must stay independent — only Orca-managed/attached helpers belong to a workspace.
  const emulatorBridge = new startupDeps.EmulatorBridge()
  startupState.runtime!.setEmulatorBridge(emulatorBridge)
  startupDeps.nativeTheme.themeSource = startupState.store.getSettings().theme ?? 'system'
  if (startupState.codexRuntimeHome.isHostSystemDefaultRealHomeSelected()) {
    // Why: establish capability before managed-hook reconciliation so an
    // incapable host re-arms and completes the legacy real-home sweep now.
    startupDeps.ensureRealHomeCodexHookState({
      hooksEnabled: startupDeps.isAgentStatusHooksEnabled(startupState.store.getSettings()),
      userDataPath: startupDeps.app.getPath('userData')
    })
  }
  if (startupDeps.shouldInstallManagedHooks(startupDeps.is.dev)) {
    // Why: check the persisted off switch before any auto-install so removed hooks don't silently reappear on launch.
    if (startupDeps.isAgentStatusHooksEnabled(startupState.store.getSettings())) {
      const managedHookStore = startupState.store
      void startupDeps.applyAgentStatusHooksEnabled(true, managedHookStore.getSettings(), {
        shouldHydrateShellPath: startupDeps.app.isPackaged && process.platform !== 'win32',
        onInstallError: startupDeps.recordManagedHookInstallFailure,
        shouldContinue: (agent) => {
          const settings = managedHookStore.getSettings()
          return startupDeps.isAgentStatusHooksEnabled(settings) && !settings.disabledTuiAgents.includes(agent)
        }
      }).catch((error) => {
        console.warn('[agent-hooks] failed to reconcile managed hooks on startup:', error)
      })
    } else {
      startupDeps.removeManagedAgentHooks()
    }
  }
}
