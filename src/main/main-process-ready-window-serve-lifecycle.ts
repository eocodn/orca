import * as startupDeps from './main-process-startup-dependencies'
import { markExpectedRendererReload, startupState } from './main-process-startup-state'
import { getHandleMacAppActivation, settleServeDesktopActivation } from './main-process-process-configuration'
import { openMainWindow, openSettingsFromSystemMenu, runUserInitiatedUpdateCheck, sendOpenSetupGuide, sendOpenCrashReport, sendOpenFeatureTour } from './main-process-window-startup-lifecycle'
import { startTerminalRuntimeStartupServices, prepareCodexRuntimeHomeForLaunch, prepareCodexSessionResumeForLaunch } from './main-process-runtime-startup-preparation'
import { recordProcessGoneCrash, handleGpuChildCrash } from './main-process-crash-lifecycle'

export async function initializeReadyWindowAndServe(): Promise<void> {
  const store = startupState.store
  const runtime = startupState.runtime
  if (!store || !runtime) {
    throw new Error('Main process services must be initialized before the ready lifecycle')
  }

  startupDeps.app.on('child-process-gone', (_event, details) => {
    recordProcessGoneCrash('child', details.type, details.reason, details.exitCode ?? null, {
      name: details.name,
      serviceName: details.serviceName,
      type: details.type
    })
    if (
      startupDeps.isGpuFallbackCrashCandidate({
        platform: process.platform,
        processType: details.type,
        reason: details.reason
      })
    ) {
      void handleGpuChildCrash(details.reason, details.exitCode ?? null)
    }
  })

  startupDeps.logStartupMilestone('services-initialized')
  await startupDeps.ensureMainI18n()
  await startupDeps.setMainUiLanguage(store.getSettings().uiLanguage)
  startupDeps.logStartupMilestone('i18n-ready')

  startupDeps.registerAppMenu({
    appMenuLabel: startupState.devInstanceIdentity.name,
    onCheckForUpdates: (options) => runUserInitiatedUpdateCheck(options),
    onBeforeReload: ({ ignoreCache, webContentsId }) => {
      if (startupState.mainWindow?.webContents.id === webContentsId) {
        markExpectedRendererReload(webContentsId)
      }
      startupDeps.recordCrashBreadcrumb('manual_reload_requested', { ignoreCache })
    },
    onOpenSettings: openSettingsFromSystemMenu,
    onOpenSetupGuide: (targetWindow) => {
      startupDeps.recordCrashBreadcrumb('setup_guide_opened')
      const targetBrowserWindow = targetWindow instanceof startupDeps.BrowserWindow ? targetWindow : null
      sendOpenSetupGuide(targetBrowserWindow)
    },
    onOpenCrashReport: (targetWindow) => {
      startupDeps.recordCrashBreadcrumb('crash_report_opened')
      const targetBrowserWindow = targetWindow instanceof startupDeps.BrowserWindow ? targetWindow : null
      sendOpenCrashReport(targetBrowserWindow)
    },
    onOpenFeatureTour: (targetWindow) => {
      startupDeps.recordCrashBreadcrumb('feature_tour_opened')
      // Why: use the invoking BrowserWindow so hidden/E2E and multi-window flows route to the right renderer, not global focus.
      const targetBrowserWindow = targetWindow instanceof startupDeps.BrowserWindow ? targetWindow : null
      sendOpenFeatureTour(targetBrowserWindow)
    },
    // Why: menu zoom must act on the window the user is looking at — routing to
    // the main window while the dashboard pop-out is focused zooms behind it.
    onZoomIn: () => {
      if (!startupDeps.zoomDashboardPopoutIfFocused('in')) {
        startupState.mainWindow?.webContents.send('terminal:zoom', 'in')
      }
    },
    onZoomOut: () => {
      if (!startupDeps.zoomDashboardPopoutIfFocused('out')) {
        startupState.mainWindow?.webContents.send('terminal:zoom', 'out')
      }
    },
    onZoomReset: () => {
      if (!startupDeps.zoomDashboardPopoutIfFocused('reset')) {
        startupState.mainWindow?.webContents.send('terminal:zoom', 'reset')
      }
    },
    onToggleLeftSidebar: () => {
      startupState.mainWindow?.webContents.send('ui:toggleLeftSidebar')
    },
    onToggleRightSidebar: () => {
      startupState.mainWindow?.webContents.send('ui:toggleRightSidebar')
    },
    onToggleAppearance: (key) => {
      if (key === 'statusBarVisible') {
        // Why: status bar visibility lives in persisted UI state (not settings) and the renderer owns the toggle — forward the event, let it flip + store.
        startupState.mainWindow?.webContents.send('ui:toggleStatusBar')
        return
      }
      const current = store.getSettings()
      // Why: these appearance settings are default-on, so a missing persisted value must toggle from visible -> hidden.
      const next = startupDeps.getNextDefaultOnAppearanceSettingValue(current[key])
      store.updateSettings({ [key]: next }, { notifyListeners: true })
      startupDeps.rebuildAppMenu()
    },
    getAppearanceState: () => {
      const settings = startupState.store?.getSettings()
      const ui = startupState.store?.getUI()
      return {
        showTasksButton: settings?.showTasksButton !== false,
        showMobileButton: settings?.showMobileButton !== false,
        showTitlebarAppName: settings?.showTitlebarAppName !== false,
        statusBarVisible: ui?.statusBarVisible !== false
      }
    },
    getKeybindings: () => startupState.keybindings?.getOverrides()
  })
  // Why: parallel E2E Electron instances would race the fixed port (EADDRINUSE); port 0 gives each a random OS-assigned port.
  const isE2E = Boolean(process.env.ORCA_E2E_USER_DATA_DIR)
  const requestedE2EWsPort = process.env.ORCA_E2E_RUNTIME_WS_PORT
  const e2eWsPort = requestedE2EWsPort === undefined ? 0 : Number(requestedE2EWsPort)
  if (isE2E && (!Number.isInteger(e2eWsPort) || e2eWsPort < 0 || e2eWsPort > 65_535)) {
    throw new Error(`Invalid ORCA_E2E_RUNTIME_WS_PORT value: ${requestedE2EWsPort}`)
  }
  // Why: pin dev to 6769 so `pnpm dev` doesn't race packaged Orca on 6768 and fall back to a random port, breaking deterministic mobile pairing/repro (STA-1511).
  const devWsPort = startupDeps.is.dev && !isE2E ? 6769 : undefined
  let serveOptions: startupDeps.ServeOptions | null = null
  try {
    serveOptions = startupState.isServeMode ? startupDeps.getServeOptions() : null
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    startupDeps.app.exit(1)
    return
  }
  // Why: existing installs may have pairing creds under the late app.getPath('userData'); copy them forward before switching to the canonical path.
  startupDeps.migrateMobilePairingDataToCanonicalUserDataPath(startupDeps.app.getPath('userData'))
  const runtimeRpc = new startupDeps.OrcaRuntimeRpcServer({
    runtime,
    // Why: mobile pairing needs the stable pre-setName() path (getCanonicalUserDataPath), not a late app.getPath('userData') that drops paired devices across restarts.
    userDataPath: startupDeps.getCanonicalUserDataPath(),
    enableWebSocket: true,
    ...(isE2E ? { wsPort: e2eWsPort } : {}),
    ...(devWsPort !== undefined ? { wsPort: devWsPort } : {}),
    ...(serveOptions?.wsPort !== undefined
      ? {
          wsPort: serveOptions.wsPort,
          // Why: only explicit `orca serve --port` overrides a stale STA-1511 fallback (issue #8535); default/dev stay fallback-first for pairing stability.
          preferPinnedWsPort: true
        }
      : {}),
    webClientRoot: startupDeps.getBundledWebClientRoot()
  })
  startupState.runtimeRpc = runtimeRpc
  startupDeps.registerMobileHandlers(runtimeRpc, {
    getRelayStatus: () => startupState.desktopRelayStatus,
    consumePendingUnpairedDeviceAuthFailure: (webContentsId) => {
      if (
        !startupState.mainWindow ||
        startupState.mainWindow.isDestroyed() ||
        startupState.mainWindow.webContents.id !== webContentsId ||
        !startupState.pendingUnpairedDeviceAuthFailure
      ) {
        return false
      }
      startupState.pendingUnpairedDeviceAuthFailure = false
      return true
    }
  })
  // Why: repeated direct auth failures otherwise look like a client that never connects; point users to re-pairing.
  runtimeRpc.setOnUnpairedDeviceAuthFailure(() => {
    // Why: runtime startup races renderer mount; retain the one-shot until the listener consumes it.
    startupState.pendingUnpairedDeviceAuthFailure = true
    if (startupState.mainWindow && !startupState.mainWindow.isDestroyed()) {
      startupState.mainWindow.webContents.send('mobile:unpairedDeviceAuthFailure')
    }
  })

  startTerminalRuntimeStartupServices()
  startupDeps.app.on('activate', getHandleMacAppActivation())

  if (serveOptions) {
    // Why: give managed WSL launchers a brief chance to migrate before headless PTYs go live, without slow repairs withholding all RPC readiness.
    startupDeps.logStartupMilestone('wsl-cli-barrier-start')
    await startupState.managedWslCliStartupBarrierReady
    startupDeps.logStartupMilestone('wsl-cli-barrier-resolved', {
      reconciliation: startupState.managedWslCliReconciliationStatus
    })
    // Why: headless PTYs must not start on the fallback provider, then get swept when an activated renderer registers desktop lifecycle handlers.
    await startupState.localPtyStartupReady
    startupDeps.registerHeadlessPtyRuntime(
      runtime,
      prepareCodexRuntimeHomeForLaunch,
      () => store.getSettings(),
      (target) => startupState.claudeRuntimeAuth!.prepareForClaudeLaunch(target),
      store,
      prepareCodexSessionResumeForLaunch
    )
    // Why: headless servers can't mount <webview> panes; use offscreen WebContents, gated on a real display so browser.headless.v1 stays honest.
    if (startupState.headlessBrowserDisplayAvailable) {
      runtime.setOffscreenBrowserBackend(new startupDeps.OffscreenBrowserBackend(startupDeps.browserManager))
    }
    // Why: headless servers have no renderer graph publisher; publish an explicit empty graph so status clients see a ready server.
    runtime.syncWindowGraph(startupDeps.HEADLESS_RUNTIME_WINDOW_ID, { tabs: [], leaves: [] })
    await runtimeRpc.start().catch((error) => {
      console.error('[runtime] Failed to start headless RPC transport:', error)
      throw error
    })
    settleServeDesktopActivation()
    startupDeps.installServeSignalHandlers()
    // Why: headless serve has no renderer to run the normal cli:install flow; do it here for macOS/Linux only (Windows-excluded: install() only mutates registry PATH, not child terminals).
    if (process.platform === 'darwin' || process.platform === 'linux') {
      try {
        // Why: serve is headless — a fallback osascript admin prompt would hang it; skip elevation since ~/.local/bin needs none.
        const cliStatus = await new startupDeps.CliInstaller({
          privilegedRunner: async () => {
            throw new Error('serve CLI auto-install must not request administrator privileges')
          }
        }).install()
        console.log(
          `[serve] orca CLI install: ${cliStatus.state}${cliStatus.commandPath ? ` (${cliStatus.commandPath})` : ''}`
        )
      } catch (error) {
        console.warn(
          '[serve] orca CLI install skipped:',
          error instanceof Error ? error.message : String(error)
        )
      }
    }
    // Why: Linux CLI installs as `orca-ide`, but the Claude Team launcher invokes bare `orca`; drop a ~/.local/bin dispatcher (ahead of /usr/bin) so it resolves. Best-effort.
    if (process.platform === 'linux' && startupDeps.app.isPackaged && process.resourcesPath) {
      try {
        const dispatcher = await startupDeps.installLinuxBareOrcaDispatcher({
          resourcesPath: process.resourcesPath
        })
        console.log(
          `[serve] bare orca dispatcher ${dispatcher.state}: ${dispatcher.dispatcherPath}` +
            `${dispatcher.target ? ` -> ${dispatcher.target}` : ''}`
        )
      } catch (error) {
        console.warn(
          '[serve] bare orca dispatcher install skipped:',
          error instanceof Error ? error.message : String(error)
        )
      }
    }
    // Why: serve deletes worktrees too, and the history GC that normally drains delete tombstones is
    // armed from the main window — without this, a quit mid-removal leaks the tree until a desktop launch.
    startupDeps.scheduleAllPendingHistoryTreeRemovals()
    await startupDeps.printServeReady(serveOptions, {
      runtime,
      runtimeRpc,
      readinessPublisher: startupState.serveReadinessPublisher,
      managedWslCliReconciliationStatus: startupState.managedWslCliReconciliationStatus
    })
    return
  }

  // Why: window and RPC startup run in parallel; registerPtyHandlers gates PTY spawns so RPC binds without racing the daemon provider swap.
  const [win, runtimeRpcStartResult] = await Promise.all([
    Promise.resolve(openMainWindow()),
    runtimeRpc.start().then(
      () => ({ ok: true as const }),
      (error: unknown) => {
        startupDeps.recordRuntimeRpcStartFailure(error)
        return { ok: false as const, error }
      }
    )
  ])
  if (!runtimeRpcStartResult.ok) {
    void startupDeps.showRuntimeRpcStartupFailureDialog(win, runtimeRpcStartResult.error)
  }

  const cloudAuth = startupDeps.getOrcaCloudAuthConfig()
  if (cloudAuth.configured) {
    try {
      const relayService = new startupDeps.DesktopRelayService({
        authConfig: cloudAuth.config,
        userDataPath: startupDeps.getProfileUserDataPath(),
        appVersion: startupDeps.app.getVersion(),
        runtimeRpc,
        onStatus: (status) => {
          startupState.desktopRelayStatus = status
          startupState.mainWindow?.webContents.send('mobile:relayStatusChanged', status)
        }
      })
      startupState.desktopRelayService = relayService
      runtimeRpc.setMobileRelayPairingProvider({
        createPairingRelay: (relayDeviceId) => relayService.createPairingRelay(relayDeviceId),
        onDeviceRevokeQueued: (item) => relayService.onDeviceRevokeQueued(item),
        onDemandStateChanged: () => relayService.demandStateChanged(),
        getEndpoints: (context, params) => relayService.getEndpoints(context, params),
        provisionRelay: (context, params) => relayService.provisionRelay(context, params)
      })
      relayService.start()
    } catch (error) {
      console.warn(
        '[relay] Desktop relay startup unavailable:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  // Why: macOS notification permission dialog must fire after the window is shown, else it's hidden behind the maximized window.
  win.once('show', () => {
    // Why: store can be null if init failed earlier; bail rather than throw inside an Electron event listener.
    if (!startupState.store) {
      return
    }
    const onboarding = startupState.store.getOnboarding()
    if (onboarding.closedAt !== null) {
      startupDeps.triggerStartupNotificationRegistration(startupState.store)
    }
  })
}
