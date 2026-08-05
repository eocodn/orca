import * as startupDeps from './main-process-startup-dependencies'
import { startupState } from './main-process-startup-state'
import { openMainWindow } from './main-process-window-startup-lifecycle'
import { maybeApplyGpuFallbackForThisLaunch } from './main-process-crash-lifecycle'

let handleMacAppActivation: ReturnType<typeof startupDeps.createMacAppActivationHandler> | null =
  null

export function updateGpuAccelerationAboutPanel(): void {
  startupDeps.app.setAboutPanelOptions(
    startupDeps.createGpuAccelerationAboutPanelOptions({
      appName: startupDeps.app.name,
      appVersion: startupDeps.app.getVersion(),
      platform: process.platform,
      gpuFallbackActive: startupState.gpuFallbackActiveThisLaunch,
      gpuFeatureStatus: startupState.gpuFeatureStatus
    })
  )
}

export function initializeMainProcessConfiguration(): void {
  startupState.devAgentHookEndpointNamespace = startupState.devInstanceIdentity.isDev
    ? startupState.devInstanceIdentity.appUserModelId
    : undefined
  startupDeps.app.on('gpu-info-update', () => {
    startupState.gpuFeatureStatus = startupDeps.app.getGPUFeatureStatus()
    if (startupDeps.app.isReady()) {
      updateGpuAccelerationAboutPanel()
    }
  })
  if (startupState.isServeMode) {
    startupDeps.reserveServeStdoutForReadiness()
  }
  startupState.desktopActivationGate = startupDeps.createServeDesktopActivationGate({
    initialState: startupState.isServeMode ? 'initializing' : 'ready',
    activateWindow: () => {
      // Why: an updater replacement must not resurrect the old app bundle.
      if (!startupDeps.isQuittingForUpdate()) {
        focusExistingWindow()
      }
    },
    onBlocked: (reason) => console.error(`[serve] Desktop activation blocked: ${reason}`)
  })
  // Why: on Windows a CLI launch that lost ELECTRON_RUN_AS_NODE would boot the GUI and exit silently; redirect to node mode before the lock gate below.
  const packagedCliEntryRedirect = startupDeps.maybeRedirectPackagedCliEntryLaunch({
    isPackaged: startupDeps.app.isPackaged,
    resourcesPath: process.resourcesPath,
    execPath: process.execPath
  })
  if (packagedCliEntryRedirect.redirected) {
    startupDeps.app.exit(packagedCliEntryRedirect.status)
  }
  const appImageCliRedirect = startupDeps.maybeRedirectAppImageCliLaunch({
    isPackaged: startupDeps.app.isPackaged,
    resourcesPath: process.resourcesPath,
    execPath: process.execPath
  })
  if (appImageCliRedirect.redirected) {
    startupDeps.app.exit(appImageCliRedirect.status)
  }

  // Kill switch for the first-work on-disk folder rename; the renderer reconciles the id change (migrateWorktreeIdentity) so it isn't mistaken for a deletion.
  startupDeps.installUncaughtPipeErrorGuard()
  // Why (issue #9441): without this, one rejected background promise during startup restore kills main silently (exit 1, no crash report).
  startupDeps.installUnhandledRejectionLogging()
  // Why: expose the app version via process.env so main and the forked daemon can set TERM_PROGRAM_VERSION without importing electron.
  process.env.ORCA_APP_VERSION = startupDeps.app.getVersion()
  startupDeps.configureRemoteServerUpdater({
    getSnapshot: startupDeps.getRemoteServerUpdaterSnapshot,
    check: startupDeps.checkForRemoteServerUpdate,
    download: startupDeps.downloadRemoteServerUpdate,
    install: startupDeps.installRemoteServerUpdate
  })
  startupDeps.patchPackagedProcessPath()
  // Why: the sync seed above covers early IPC (homebrew/nix); the async login-shell probe below (packaged only) then adds the user's rc PATH.
  if (startupDeps.app.isPackaged && process.platform !== 'win32') {
    void startupDeps.hydrateShellPath().then((result) => {
      if (result.ok) {
        startupDeps.mergePathSegments(result.segments)
      }
    })
  }
  startupDeps.configureDevUserDataPath(startupDeps.is.dev)
  startupDeps.configureOrcaUserDataPathEnv()
  startupDeps.installServeSupervisorDisconnectQuit(startupState.isServeMode)

  startupState.startupDiagnosticsEnabled = startupDeps.isStartupDiagnosticsEnabled()
  if (startupState.startupDiagnosticsEnabled) {
    startupDeps.logStartupDiagnostic('before-single-instance-lock', {
      version: startupDeps.app.getVersion(),
      packaged: startupDeps.app.isPackaged,
      platform: process.platform,
      osRelease: startupDeps.os.release(),
      userData: startupDeps.app.getPath('userData'),
      e2eUserData: Boolean(process.env.ORCA_E2E_USER_DATA_DIR)
    })
    startupDeps.startEventLoopStallProbe()
  }
  // Self-gated on ORCA_MAIN_THREAD_DIAGNOSTICS; runs the whole session to catch steady-state churn (issue #7576).
  startupDeps.startMainThreadChurnProbe()

  function focusExistingWindow(): void {
    startupDeps.focusExistingMainWindow({
      app: startupDeps.app,
      getWindow: () => startupState.mainWindow,
      openWindow: openMainWindow,
      warn: console.warn
    })
  }

  function requestDesktopActivation(): void {
    startupState.desktopActivationGate?.requestActivation()
  }

  handleMacAppActivation = startupDeps.createMacAppActivationHandler({
    getWindow: () => startupState.mainWindow,
    requestActivation: requestDesktopActivation
  })

  // Why: acquire AFTER configureDevUserDataPath — Electron derives lock identity from `userData`, so dev/packaged lock in separate namespaces.
  // Why skip in dev: parallel `pnpm dev` from multiple worktrees would make the second exit silently; packaged keeps the lock (corruption PR #1326 / #1312).
  const bypassSingleInstanceLock = startupDeps.shouldBypassSingleInstanceLock({
    isDev: startupDeps.is.dev,
    isServeMode: startupState.isServeMode
  })
  const skipSingleInstanceLock = startupDeps.shouldSkipSingleInstanceLock({
    isDev: startupDeps.is.dev,
    isServeMode: startupState.isServeMode
  })
  if (bypassSingleInstanceLock) {
    // Why: diagnostic escape hatch for macOS builds where Electron reports a false lock loss before any app logs exist.
    startupDeps.logSingleInstanceLockBypass()
  }
  const hasSingleInstanceLock = skipSingleInstanceLock
    ? true
    : bypassSingleInstanceLock
      ? true
      : startupDeps.acquireSingleInstanceLock(startupDeps.app, requestDesktopActivation)
  if (startupState.startupDiagnosticsEnabled) {
    startupDeps.logStartupDiagnostic('single-instance-lock-result', {
      acquired: hasSingleInstanceLock,
      bypassed: bypassSingleInstanceLock,
      skippedForDev: skipSingleInstanceLock
    })
  }
  if (!hasSingleInstanceLock) {
    // Why: a false-negative lock loss otherwise looks like a silent crash on packaged macOS; `open --stderr` can capture this line.
    startupDeps.logSingleInstanceLockFailure()
    startupDeps.app.quit()
  }

  // Why: when another process holds the lock we've already quit; skip file-writing side effects so this transient process never touches userData.
  if (hasSingleInstanceLock) {
    // Why: couple to dev-parent only for electron-vite desktop runs; `orca serve`'s parent (CLI shim/background shell) isn't the intended server lifetime.
    const shouldCoupleToDevParent = startupDeps.is.dev && !startupState.isServeMode
    startupDeps.installDevParentDisconnectQuit(shouldCoupleToDevParent)
    startupDeps.installDevParentWatchdog(shouldCoupleToDevParent)
    startupDeps.installDevParentSignalQuit(shouldCoupleToDevParent)
    // Why: run after configureDevUserDataPath but before app.setName('Orca') (whenReady), which changes the resolved path on case-sensitive filesystems.
    startupDeps.initDataPath()
    startupDeps.initOrcaProfilePaths()
    // Why: same timing as initDataPath — capture userData before app.setName changes it. See persistence.ts:20-28.
    startupDeps.initStatsPath()
    startupState.crashReports = startupDeps.CrashReportStore.fromUserData()
    startupDeps.recordCrashBreadcrumb('app_started', {
      packaged: startupDeps.app.isPackaged,
      platform: process.platform,
      ...startupDeps.getMainProcessLifecycleIdentity()
    })
    startupDeps.configureElectronNetworkCompatibility()
    startupDeps.enableRendererHeapHeadroom()
    maybeApplyGpuFallbackForThisLaunch()
    if (!startupState.gpuFallbackActiveThisLaunch) {
      startupDeps.enableMainProcessGpuFeatures()
    }
    // Why: headless serve's offscreen BrowserWindows need an X display (Xvfb) on Linux; the result gates whether the offscreen backend is installed.
    startupState.headlessBrowserDisplayAvailable = startupDeps.ensureVirtualDisplayForHeadlessServe(
      {
        isServeMode: startupState.isServeMode
      }
    )
  }

  startupDeps.ipcMain.handle('app:awaitFirstWindowStartupServices', async () => {
    await Promise.all([
      startupState.firstWindowStartupServicesReady,
      startupState.managedWslCliStartupBarrierReady
    ])
  })

  // Why: the renderer pulls this once its ui:openSettings listener attaches, so a Settings request queued before mount isn't lost.
  startupDeps.ipcMain.handle('ui:consumePendingOpenSettings', (event) =>
    startupState.pendingOpenSettings.matches(event.sender.id, { consume: true })
  )

  startupDeps.ipcMain.handle(
    'app:startupDiagnostic',
    (_event, event: string, details?: Record<string, unknown>) => {
      if (!startupState.startupDiagnosticsEnabled || !event.startsWith('renderer-')) {
        return
      }
      startupDeps.logStartupMilestone(event, details && typeof details === 'object' ? details : {})
    }
  )
}

export function getHandleMacAppActivation() {
  if (!handleMacAppActivation) {
    throw new Error('Main-process activation handler is not initialized')
  }
  return handleMacAppActivation
}

export function getDesktopWindowStatus(): startupDeps.RuntimeDesktopWindowStatus {
  const activationState = startupState.desktopActivationGate?.getState()
  return activationState === 'ready' ? 'openable' : (activationState ?? 'initializing')
}

export function settleServeDesktopActivation(): void {
  if (startupDeps.getLocalPtyProvider() instanceof startupDeps.LocalPtyProvider) {
    startupState.desktopActivationGate?.markBlocked('persistent PTY provider unavailable')
    return
  }
  startupState.desktopActivationGate?.markReady()
}
