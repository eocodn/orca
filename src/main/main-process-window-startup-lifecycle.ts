import * as startupDeps from './main-process-startup-dependencies'
import {
  startupState,
  clearExpectedRendererReload,
  isRecoveryReloadInFlight,
  markExpectedRendererReload,
  markRecoveryReloadInFlight,
  getExpectedTeardownScope,
  recordAgentStateCrashBreadcrumb
} from './main-process-startup-state'
import { maybeAutoRenameBranchOnFirstWorkFromHook } from './main-process-first-work-rename-startup'
import {
  prepareCodexRuntimeHomeForLaunch,
  prepareCodexSessionResumeForLaunch
} from './main-process-runtime-startup-preparation'
import {
  presentRendererRecoveryPrompt,
  recordProcessGoneCrash
} from './main-process-crash-lifecycle'
import {
  driveSyntheticTitleFromHook,
  shouldSuppressCodexAutoApprovalSyntheticTitleFromHook,
  stopAllSyntheticTitleSpinners,
  resumeSyntheticTitleSpinnerTimer,
  stopSyntheticTitleSpinnerTimer
} from './main-process-synthetic-title-lifecycle'

function emitPluginWorktreeLifecycle(event: startupDeps.RuntimeWorktreeLifecycleEvent): void {
  startupState.pluginService?.emitEvent(
    event.kind === 'created' ? 'worktree.created' : 'worktree.removed',
    event.kind === 'created'
      ? { worktreeId: event.worktreeId, path: event.path, branch: event.branch }
      : { worktreeId: event.worktreeId, path: event.path }
  )
}

// Why: restore the window the close handler may have hidden to tray, or reopen it (dock-reactivation style) if fully torn down.
export function showMainWindowFromTray(): void {
  if (startupState.mainWindow && !startupState.mainWindow.isDestroyed()) {
    if (startupState.mainWindow.isMinimized()) {
      startupState.mainWindow.restore()
    }
    startupState.mainWindow.show()
    startupState.mainWindow.focus()
    return
  }
  if (!startupDeps.isQuittingForUpdate()) {
    openMainWindow()
  }
}

export function openSettingsFromSystemMenu(): void {
  showMainWindowFromTray()
  const targetWindow =
    startupState.mainWindow && !startupState.mainWindow.isDestroyed()
      ? startupState.mainWindow
      : null
  if (!targetWindow) {
    return
  }
  startupDeps.recordCrashBreadcrumb('settings_opened')

  // Why: no signal proves the renderer listener is attached â push, and also leave a one-shot intent the unmounted renderer pulls at mount.
  targetWindow.webContents.send('ui:openSettings')
  // Why: untimed â any TTL can be outrun by a slow cold start; id-scoping + consume-on-read still prevent leaking to a later renderer.
  startupState.pendingOpenSettings.mark(targetWindow.webContents.id, Number.POSITIVE_INFINITY)
}

export function quitFromSystemTray(): void {
  if (startupState.mainWindow && !startupState.mainWindow.isDestroyed()) {
    // Why: a hidden session may veto shutdown with a save/discard prompt, so make the window visible.
    showMainWindowFromTray()
  }
  // Why: set the quit latch before app.quit() so the 'close' handler tears down instead of re-hiding to tray.
  startupState.isQuitting = true
  startupDeps.app.quit()
}

// Why: menu/tray are clickable before anything else configures the updater.
export function runUserInitiatedUpdateCheck(options?: startupDeps.UpdateCheckOptions): void {
  startupDeps.ensureAutoUpdaterConfigured()
  startupDeps.checkForUpdatesFromMenu(options)
}

export function getSystemTrayOptions(): startupDeps.SystemTrayOptions | null {
  if (!startupState.store) {
    return null
  }
  return {
    appIcon: startupState.store.getSettings().appIcon,
    isDevInstance: startupState.devInstanceIdentity.isDev,
    devInstanceLabel: startupState.devInstanceIdentity.devLabel,
    onOpen: showMainWindowFromTray,
    onOpenSettings: openSettingsFromSystemMenu,
    onCheckForUpdates: () => {
      // Why: updater status renders in the main window, so a bare check would complete invisibly.
      showMainWindowFromTray()
      runUserInitiatedUpdateCheck()
    },
    onQuit: quitFromSystemTray
  }
}

export function syncMacMenuBarIcon(showMenuBarIcon: boolean): startupDeps.Tray | null {
  if (process.platform !== 'darwin' || startupState.isServeMode) {
    return null
  }
  const options = getSystemTrayOptions()
  return options ? startupDeps.setMacMenuBarIconVisible(showMenuBarIcon, options) : null
}

export function openMainWindow(): startupDeps.BrowserWindow {
  startupDeps.logStartupMilestone('open-main-window-start')
  if (!startupState.store) {
    throw new Error('Store must be initialized before opening the main window')
  }
  if (!startupState.runtime) {
    throw new Error('Runtime must be initialized before opening the main window')
  }
  if (!startupState.stats) {
    throw new Error('Stats must be initialized before opening the main window')
  }
  if (!startupState.claudeUsage) {
    throw new Error('Claude usage store must be initialized before opening the main window')
  }
  if (!startupState.codexUsage) {
    throw new Error('Codex usage store must be initialized before opening the main window')
  }
  if (!startupState.openCodeUsage) {
    throw new Error('OpenCode usage store must be initialized before opening the main window')
  }
  if (!startupState.rateLimits) {
    throw new Error('Rate limit service must be initialized before opening the main window')
  }
  if (!startupState.codexAccounts) {
    throw new Error('Codex account service must be initialized before opening the main window')
  }
  if (!startupState.codexRuntimeHome) {
    throw new Error('Codex runtime home service must be initialized before opening the main window')
  }
  if (!startupState.claudeAccounts) {
    throw new Error('Claude account service must be initialized before opening the main window')
  }
  if (!startupState.claudeRuntimeAuth) {
    throw new Error(
      'Claude runtime auth service must be initialized before opening the main window'
    )
  }
  if (!startupState.keybindings) {
    throw new Error('Keybinding service must be initialized before opening the main window')
  }

  // Why: Chromium's BrowserWindow ctor resets userData to a Protected DACL, breaking writes; re-grant ACEs (marker-gated to avoid a ~60s startup stall).
  if (process.platform === 'win32') {
    startupDeps.logStartupMilestone('acl-grant-start')
    startupDeps.ensureWindowsUserDataAclGrant(startupDeps.app.getPath('userData'), {
      onDone: (result) => {
        startupDeps.logStartupMilestone('acl-grant-done', { mode: result.mode })
        if (result.mode === 'failed') {
          console.warn('[win32-acl] userData ACL grant failed:', result.reason)
        }
      }
    })
  }

  const window = startupDeps.createMainWindow(startupState.store, {
    getIsQuitting: () => startupState.isQuitting,
    onQuitAborted: () => {
      startupState.isQuitting = false
      clearExpectedRendererReload()
    },
    onRendererProcessGone: (details, webContentsId) => {
      recordProcessGoneCrash(
        'renderer',
        'renderer',
        details.reason,
        details.exitCode ?? null,
        {
          processType: 'renderer'
        },
        webContentsId
      )
    },
    shouldRecoverRenderer: (details, webContentsId) =>
      startupDeps.shouldRecoverRendererAfterProcessGone({
        reason: details.reason,
        expectedTeardown: getExpectedTeardownScope(webContentsId)
      }),
    onRendererRecoveryExhausted: ({ details, recentRecoveryCount }) => {
      startupDeps.recordDurableCrashBreadcrumb('renderer_recovery_circuit_breaker_open', {
        reason: details.reason,
        exitCode: details.exitCode ?? null,
        recentRecoveryCount
      })
      void presentRendererRecoveryPrompt(recentRecoveryCount)
    },
    deferLoad: true,
    title: startupState.devInstanceIdentity.name,
    getKeybindings: () => startupState.keybindings?.getOverrides(),
    onBeforeReload: ({ ignoreCache, webContentsId }) => {
      if (startupState.mainWindow?.webContents.id === webContentsId) {
        markExpectedRendererReload(webContentsId)
      }
      startupDeps.recordCrashBreadcrumb('manual_reload_requested', { ignoreCache })
    },
    // Why: the recovery reload re-fires did-finish-load; flag it so the local-PTY orphan sweep skips that reload (#5787).
    onBeforeRecoveryReload: (webContentsId) => {
      markRecoveryReloadInFlight(webContentsId)
      startupDeps.recordDurableCrashBreadcrumb('renderer_recovery_reload')
    }
  })
  startupDeps.recordCrashBreadcrumb('main_window_created')
  startupDeps.logStartupMilestone('window-created')
  // Why: Windows Tray construction can block synchronously on Shell_NotifyIcon, so both platforms defer creation to after first paint.
  let trayCreated = false
  const createSystemTrayDeferred = (): void => {
    if (trayCreated || window.isDestroyed() || startupState.isQuitting || !startupState.store) {
      return
    }
    trayCreated = true
    if (process.platform === 'darwin') {
      // Why: route through syncMacMenuBarIcon so startup and the live toggle share one serve-mode/visibility policy.
      if (syncMacMenuBarIcon(startupState.store.getSettings().showMenuBarIcon !== false)) {
        startupDeps.logStartupMilestone('tray-created')
      }
      return
    }
    const options = getSystemTrayOptions()
    if (options && startupDeps.createSystemTray(options)) {
      startupDeps.logStartupMilestone('tray-created')
    }
  }
  window.once('ready-to-show', () => {
    startupDeps.logStartupMilestone('ready-to-show')
    setImmediate(createSystemTrayDeferred)
  })
  const trayCreateFallback = setTimeout(createSystemTrayDeferred, startupState.trayCreateFallbackMs)
  trayCreateFallback.unref?.()

  // Why: telemetry-plan.md anchors default-on app_opened to the first main-window load; this path fires only once consent is already enabled.
  const rendererWebContentsId = window.webContents.id
  const onFirstWindowLoad = (): void => {
    clearExpectedRendererReload(rendererWebContentsId)
    startupDeps.recordCrashBreadcrumb('main_window_loaded')
    startupDeps.logStartupMilestone('did-finish-load')
    if (!startupState.store) {
      return
    }
    const consent = startupDeps.resolveConsent(startupState.store.getSettings())
    if (consent.effective !== 'enabled') {
      return
    }
    startupDeps.trackAppOpenedOnce()
  }
  window.webContents.on('did-finish-load', onFirstWindowLoad)

  startupDeps.registerCoreHandlers(
    startupState.store,
    startupState.runtime,
    startupState.stats,
    startupState.claudeUsage,
    startupState.codexUsage,
    startupState.openCodeUsage,
    startupState.codexAccounts,
    startupState.claudeAccounts,
    startupState.rateLimits,
    rendererWebContentsId,
    {
      prepareForCodexLaunch: prepareCodexRuntimeHomeForLaunch,
      prepareForClaudeLaunch: (target) =>
        startupState.claudeRuntimeAuth!.prepareForClaudeLaunch(target)
    },
    startupState.agentAwakeService ?? undefined,
    startupState.crashReports ?? undefined,
    startupState.keybindings,
    {
      getAdditionalAiVaultCodexHomePaths: () =>
        startupState.codexRuntimeHome
          ? startupState.codexRuntimeHome.getHostCodexHomePathsForSessionDiscovery()
          : [],
      prepareAiVaultSessionResume: (args) =>
        startupDeps.prepareLegacySharedCodexSessionResume(args, {
          isHostSystemDefaultRealHome: () =>
            startupState.codexRuntimeHome?.isHostSystemDefaultRealHome() === true,
          getSelectedHostAccountCodexHomePath: () =>
            startupState.codexRuntimeHome?.getSelectedHostAccountCodexHomePath() ?? null,
          systemCodexHomePath: startupDeps.resolveHostCodexSessionSourceHome(
            startupState.store!.getSettings()
          )
        }),
      onBeforeRelaunch: async () => {
        startupState.isQuitting = true
        startupState.desktopRelayService?.fenceAndCloseNow()
        await startupDeps.preserveAgentAuthBeforeRestart({
          codexRuntimeHome: startupState.codexRuntimeHome,
          claudeRuntimeAuth: startupState.claudeRuntimeAuth,
          store: startupState.store
        })
      },
      onOrcaProfileAuthMutation: () => startupState.desktopRelayService?.authMutated(),
      onBeforeOrcaProfileSignOut: () => startupState.desktopRelayService?.fenceAndCloseNow()
    },
    startupState.pluginService ?? undefined
  )
  startupDeps.attachMainWindowServices(
    window,
    startupState.store,
    startupState.runtime,
    prepareCodexRuntimeHomeForLaunch,
    (target) => startupState.claudeRuntimeAuth!.prepareForClaudeLaunch(target),
    {
      prepareCodexSessionResume: prepareCodexSessionResumeForLaunch,
      awaitLocalPtyStartup: () => startupState.localPtyStartupReady,
      awaitLocalPtyProviderStartup: () => startupState.localPtyProviderStartupReady,
      onBeforeRendererReload: ({ ignoreCache, webContentsId }) => {
        if (window.webContents.id === webContentsId) {
          markExpectedRendererReload(webContentsId)
        }
        startupDeps.recordCrashBreadcrumb('renderer_reload_requested', { ignoreCache })
      },
      // Why: let the PTY layer skip its orphan sweep on the recovery reload that re-fires did-finish-load, so live local sessions survive (#5787).
      isRecoveryReloadInFlight,
      onBeforeUpdateQuit: () =>
        startupDeps.preserveAgentAuthBeforeRestart({
          codexRuntimeHome: startupState.codexRuntimeHome,
          claudeRuntimeAuth: startupState.claudeRuntimeAuth,
          store: startupState.store
        }),
      updateInstallMode: startupDeps.resolveUpdateInstallMode(startupState.isServeMode),
      onWorktreeLifecycle: emitPluginWorktreeLifecycle
    }
  )
  // Why: attach the durable renderer pull now, but launch the diagnostic process after first paint.
  startupDeps.initTccPromptNotice(window, { deferWatchUntilReadyToShow: true })
  startupState.rateLimits.attach(window)
  // Why: quota probes spawn CLIs and hit network, so don't fetch immediately and compete with first paint; show/focus listeners refresh later.
  startupState.rateLimits.start({ fetchImmediately: false })
  window.on('closed', () => {
    if (startupState.mainWindow === window) {
      startupState.mainWindow = null
    }
    clearExpectedRendererReload(rendererWebContentsId)
    // Why: detach the hook listener on close so the server never fires into destroyed webContents before reopen, and replay runs only on deliberate recreations.
    startupDeps.agentHookServer.setListener(null)
    startupDeps.agentHookServer.setPaneStatusClearListener(null)
    startupDeps.setMigrationUnsupportedPtyListener(null)
    // Why: stop the spinner timer here â it would fire into destroyed webContents, and per-pane teardown may never run for restored-but-untorn panes.
    stopAllSyntheticTitleSpinners()
  })
  startupState.mainWindow = window
  window.on('show', resumeSyntheticTitleSpinnerTimer)
  window.on('restore', resumeSyntheticTitleSpinnerTimer)
  window.on('hide', stopSyntheticTitleSpinnerTimer)
  window.on('minimize', stopSyntheticTitleSpinnerTimer)
  // Why: visibility-gated pollers (SSH port scanner) park while hidden and resume on this signal; re-wired per window since dock re-activation recreates it.
  window.on('show', startupDeps.notifyMainWindowBecameVisible)
  window.on('restore', startupDeps.notifyMainWindowBecameVisible)
  // Why: user is back on show/restore, so clear the tray attention dot set while hidden (see notifications.ts).
  window.on('show', () => startupDeps.setTrayAttention(false))
  window.on('restore', () => startupDeps.setTrayAttention(false))
  startupDeps.agentHookServer.setListener(
    ({
      paneKey,
      tabId,
      worktreeId,
      connectionId,
      payload,
      receivedAt,
      stateStartedAt,
      launchToken,
      providerSession,
      providerSessionOnly,
      promptInteractionKey,
      isReplay
    }) => {
      if (startupState.mainWindow?.isDestroyed()) {
        return
      }
      if (providerSessionOnly) {
        // Why: session_start just refreshes durable resume identity while Pi is idle; forward it without titles, telemetry, or status UI.
        startupState.mainWindow?.webContents.send('agentStatus:set', {
          ...payload,
          paneKey,
          ...(launchToken ? { launchToken } : {}),
          tabId,
          worktreeId,
          connectionId,
          receivedAt,
          stateStartedAt,
          ...(providerSession ? { providerSession } : {}),
          providerSessionOnly: true
        })
        return
      }
      maybeAutoRenameBranchOnFirstWorkFromHook({ paneKey, tabId, worktreeId, payload, isReplay })
      const terminalHandle = startupState.runtime?.getAgentStatusTerminalHandleForPaneKey(paneKey)
      startupState.mainWindow?.webContents.send('agentStatus:set', {
        ...payload,
        paneKey,
        ...(launchToken ? { launchToken } : {}),
        ...(terminalHandle ? { terminalHandle } : {}),
        tabId,
        worktreeId,
        connectionId,
        receivedAt,
        stateStartedAt,
        ...(providerSession ? { providerSession } : {}),
        ...(promptInteractionKey ? { promptInteractionKey } : {})
      })
      recordAgentStateCrashBreadcrumb(payload.agentType ?? 'unknown', payload.state)
      // Why: native OSC titles miss some idle/permission frames, so inject hook-derived ones to keep the renderer title tracker in sync.
      const profile = startupDeps.getSyntheticAgentTitleProfile(payload.agentType)
      const suppressSyntheticCodexAutoApprovalTitle =
        payload.agentType === 'codex' &&
        (payload.state === 'waiting' || payload.state === 'blocked')
          ? shouldSuppressCodexAutoApprovalSyntheticTitleFromHook({
              agentType: payload.agentType,
              state: payload.state,
              launchConfig: startupState.runtime?.getAgentStatusLaunchConfigForPaneKey(paneKey, {
                launchToken
              })
            })
          : false
      if (
        profile &&
        startupDeps.shouldDriveSyntheticAgentTitleFromHook(payload.agentType, payload.state) &&
        !suppressSyntheticCodexAutoApprovalTitle
      ) {
        driveSyntheticTitleFromHook(paneKey, payload.state, profile)
      }
    }
  )
  startupDeps.agentHookServer.setPaneStatusClearListener((clear) => {
    if (startupState.mainWindow?.isDestroyed()) {
      return
    }
    startupState.mainWindow?.webContents.send('agentStatus:clear', clear)
  })
  startupDeps.setMigrationUnsupportedPtyListener((event) => {
    if (startupState.mainWindow?.isDestroyed()) {
      return
    }
    if (event.type === 'set') {
      startupState.mainWindow?.webContents.send('agentStatus:migrationUnsupported', event.entry)
    } else {
      startupState.mainWindow?.webContents.send('agentStatus:migrationUnsupportedClear', {
        ptyId: event.ptyId
      })
    }
  })
  startupDeps.logStartupMilestone('load-start')
  startupDeps.loadMainWindow(window)
  return window
}

export function sendOpenFeatureTour(targetWindow?: startupDeps.BrowserWindow | null): void {
  const webContents =
    targetWindow && !targetWindow.isDestroyed()
      ? targetWindow.webContents
      : startupState.mainWindow?.webContents
  webContents?.send('ui:openFeatureTour')
}

export function sendOpenSetupGuide(targetWindow?: startupDeps.BrowserWindow | null): void {
  const webContents =
    targetWindow && !targetWindow.isDestroyed()
      ? targetWindow.webContents
      : startupState.mainWindow?.webContents
  webContents?.send('ui:openSetupGuide')
}

export function sendOpenCrashReport(targetWindow?: startupDeps.BrowserWindow | null): void {
  const webContents =
    targetWindow && !targetWindow.isDestroyed()
      ? targetWindow.webContents
      : startupState.mainWindow?.webContents
  webContents?.send('ui:openCrashReport')
}

// Why: on renderer crash-loop the breaker stops auto-reloading and the window goes blank, so a main-process dialog is the only retry/quit surface.
