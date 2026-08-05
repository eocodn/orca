import * as startupDeps from './main-process-startup-dependencies'
import { startupState } from './main-process-startup-state'
import {
  updateGpuAccelerationAboutPanel,
  getDesktopWindowStatus
} from './main-process-process-configuration'
import { syncMacMenuBarIcon } from './main-process-window-startup-lifecycle'
import { prepareCodexRuntimeHomeForLaunch } from './main-process-runtime-startup-preparation'

export async function initializeReadyFoundation(): Promise<void> {
  startupDeps.logStartupMilestone('app-ready')
  startupDeps.installMainThreadHangWatchdog({
    userDataPath: startupDeps.getCanonicalUserDataPath()
  })
  const hangDetection = startupDeps.consumeHangDetectionMarker(
    startupDeps.hangDetectionMarkerPath(startupDeps.getCanonicalUserDataPath())
  )
  if (hangDetection) {
    startupDeps.recordDurableCrashBreadcrumb('main_thread_hang_detected', {
      unresponsiveMs: hangDetection.unresponsiveMs,
      previousPid: hangDetection.parentPid,
      selfRecovered: hangDetection.selfRecovered
    })
  }
  // Why: install certificate decisions before any webview or headless window issues its first TLS request.
  startupDeps.app.on(
    'certificate-error',
    (event, webContents, url, error, certificate, callback, isMainFrame) => {
      startupDeps.browserCertificateTrustController.handleCertificateError({
        event,
        webContents,
        url,
        error,
        certificate,
        callback,
        isMainFrame
      })
    }
  )
  startupDeps.electronApp.setAppUserModelId(startupState.devInstanceIdentity.appUserModelId)
  // Why: setName drives the macOS safeStorage Keychain item name; use the stable appName (not per-branch `name`) so dev branches share one key and don't re-prompt.
  startupDeps.app.setName(startupState.devInstanceIdentity.appName)
  updateGpuAccelerationAboutPanel()

  // Why: managed WSL launchers live outside the Windows app bundle, so keep their launcher/bridge contract synced across app updates.
  startupState.managedWslCliReconciliationStatus = 'pending'
  startupState.managedWslCliReconciliationReady = startupDeps
    .reconcileManagedWslCliRegistrations({
      isPackaged: startupDeps.app.isPackaged,
      userDataPath: startupDeps.getCanonicalUserDataPath(),
      appVersion: startupDeps.app.getVersion()
    })
    .then((results) => {
      for (const result of results) {
        if (result.outcome === 'failed') {
          console.warn(
            `[wsl-cli] ${result.distro} managed registration reconciliation failed: ${result.error}`
          )
        } else if (result.outcome === 'repaired') {
          console.log(`[wsl-cli] Repaired managed registration in ${result.distro}.`)
        }
      }
      startupState.managedWslCliReconciliationStatus = 'settled'
    })
    .catch((error) => {
      startupState.managedWslCliReconciliationStatus = 'failed'
      console.warn(
        '[wsl-cli] Managed registration reconciliation discovery failed:',
        error instanceof Error ? error.message : String(error)
      )
    })
  startupState.managedWslCliStartupBarrierReady =
    startupDeps.createWslCliReconciliationStartupBarrier(
      startupState.managedWslCliReconciliationReady
    )

  const activeOrcaProfile = startupDeps.ensureActiveOrcaProfile()
  startupState.store = new startupDeps.Store({ dataFile: activeOrcaProfile.dataFile })
  startupDeps.wslHookRelayManager.setManagedHookSettingsResolver(
    () => startupState.store?.getSettings() ?? null
  )
  startupDeps.logStartupMilestone('store-loaded')
  // Why: apply initial fallback WSL distro from store settings for global git/CLI calls.
  startupDeps.setDefaultWslDistroOverride(
    startupState.store.getSettings().terminalWindowsWslDistro ?? null
  )
  startupState.store.onSettingsChanged((updates, settings) => {
    if ('terminalWindowsWslDistro' in updates) {
      // Why: synchronize fallback WSL distro updates to runner.
      startupDeps.setDefaultWslDistroOverride(settings.terminalWindowsWslDistro ?? null)
    }
    if ('showMenuBarIcon' in updates) {
      // Why: Store is the mutation authority for all settings writes, so every macOS toggle updates the native item live.
      syncMacMenuBarIcon(settings.showMenuBarIcon !== false)
    }
  })
  startupDeps.applyAppIcon(startupState.store.getSettings().appIcon)
  if (startupDeps.shouldSuppressDevEducation({ isDev: startupDeps.is.dev })) {
    startupDeps.suppressDevEducationForStore(startupState.store)
  }
  try {
    // Why: Dock/Launchpad launches don't inherit shell proxy env vars, so apply the persisted proxy before any app-owned network fetchers run.
    await startupDeps.applyElectronProxySettings(startupState.store.getSettings())
  } catch {
    console.warn('[proxy] Failed to apply network proxy settings')
  }
  // Why: browser sessions serve desktop webviews and runtime profile commands, so init at app startup rather than via a renderer IPC path.
  startupDeps.initializeBrowserSessionsForApp({
    orcaProfileId: activeOrcaProfile.profile.id,
    profileDirectory: activeOrcaProfile.profileDirectory
  })
  startupState.unsubscribeSystemResumeBroadcast = startupDeps.registerSystemResumeBroadcast()
  startupState.agentAwakeService = new startupDeps.AgentAwakeService()
  startupState.agentAwakeService.setEnabled(
    startupState.store.getSettings().keepComputerAwakeWhileAgentsRun
  )
  // Why: start from empty â disk-hydrated status rows are UI continuity only; only this runtime's hook events keep the computer awake.
  startupState.agentAwakeService.setStatuses([])
  const collectChangedProviderSessionWorktrees = startupDeps.createHookProviderSessionInvalidator()
  const publishProviderSessionChanges = (
    identities: startupDeps.AgentHookProviderSessionIdentity[]
  ): void => {
    const ownedIdentities = identities.map((identity) => ({
      ...identity,
      worktreeId:
        identity.worktreeId ??
        startupState.runtime?.getTerminalWorktreeIdForPaneKey(identity.paneKey) ??
        undefined
    }))
    for (const worktreeId of collectChangedProviderSessionWorktrees(ownedIdentities)) {
      startupState.runtime?.notifyMobileSessionTabsChanged(worktreeId)
    }
  }
  const unsubscribeStatusChanges = startupDeps.agentHookServer.subscribeStatusChanges(
    (statuses) => {
      startupState.agentAwakeService?.setStatuses(statuses)
    }
  )
  const unsubscribeProviderSessionChanges =
    startupDeps.agentHookServer.subscribeProviderSessionChanges((sessions) => {
      // Healthy session.tabs streams need a push when transcript identity changes.
      publishProviderSessionChanges(sessions)
    })
  startupState.unsubscribeAgentAwakeStatusChanges = () => {
    unsubscribeStatusChanges()
    unsubscribeProviderSessionChanges()
  }
  // Why: telemetry must init before any IPC handler/renderer can call track(); it's a no-op in dev and while TELEMETRY_ENABLED is false, so it's safe early.
  // Why: the breadcrumb alone never leaves the machine â it rides crash reports, and a hang is not
  // a crash (the app is force-quit, so no report is ever generated). Without this the incidence
  // number the watchdog exists to produce would sit unread on the user's disk. Must run after
  // Why: the trust-grant module is bundled into plain-node CLI entries where
  // the telemetry client cannot load, so the tracker is injected here instead
  // of imported there.
  // Why: the error-tracking lane (telemetry-error-tracking.md) is its own
  // composition root â independent of product telemetry â and must
  // initialize before any IPC handler / runtime span is created so the
  // tracer's active sink is populated at the moment the first span fires.
  // Honors DO_NOT_TRACK / ORCA_TELEMETRY_DISABLED / ORCA_DIAGNOSTICS_DISABLED
  // / CI internally; those gates do not need to be re-checked here.
  startupDeps.initObservability()
  startupDeps.recordDurableCrashBreadcrumb('main_process_lifecycle_started', {
    packaged: startupDeps.app.isPackaged,
    platform: process.platform
  })
  // Why: cohort-classifier reads repo count synchronously at every emit, so hydrate it here â before any IPC handler or window can trigger track().
  startupState.stats = new startupDeps.StatsCollector()
  startupState.codexRuntimeHome = new startupDeps.CodexRuntimeHomeService(startupState.store)
  // Why: an incapable trust-grant host must fall back to the managed home for
  // every consumer (PTY env, rate limits, commit messages) in one place.
  startupState.codexRuntimeHome.setRealHomeLaneGate(() =>
    startupDeps.isRealHomeCodexHookLaneUsable()
  )
  // Why: while the real-home lane owns ~/.codex/hooks.json, the legacy
  // system-home sweep inside managed installs would delete the entry the
  // real-home installer just appended. Flag OFF, hooks off, or an incapable
  // trust lane re-arms the sweep so downgrade, opt-out, and rollback converge.
  startupDeps.setSystemCodexHomeHookSweepSuppressed(
    () =>
      startupState.codexRuntimeHome !== null &&
      startupState.codexRuntimeHome.isHostSystemDefaultRealHome() &&
      startupDeps.isAgentStatusHooksEnabled(startupState.store?.getSettings())
  )
  startupState.claudeRuntimeAuth = new startupDeps.ClaudeRuntimeAuthService(startupState.store)
  startupState.keybindings = new startupDeps.KeybindingService({
    homePath: startupDeps.app.getPath('home'),
    getLegacyOverrides: () => startupState.store!.getSettings().keybindings,
    legacyTabSwitchSeed: {
      isPending: () => startupState.store!.getSettings().tabSwitchKeybindingSeed === 'pending',
      markSeeded: () => {
        startupState.store!.updateSettings({ tabSwitchKeybindingSeed: 'done' })
      }
    }
  })
  startupDeps.browserManager.setSettingsResolver(() => ({
    keybindings: startupState.keybindings?.getOverrides()
  }))
  const runtimeService = new startupDeps.OrcaRuntimeService(
    startupState.store,
    startupState.stats,
    {
      agentSessionClaimSigner: startupDeps.loadAgentSessionClaimSigner(
        startupDeps.getProfileUserDataPath(),
        startupDeps.getProfileUserDataPath()
      ),
      // Why: resolve the PTY provider lazily â a daemon swap happens later, so an eager reference would freeze the pre-daemon provider (design Â§4.3).
      getLocalProvider: () => startupDeps.getLocalPtyProvider(),
      // Why: SSH relay providers register after construction and may reconnect, so destructive cleanup must resolve the current generation.
      getSshProvider: (connectionId) => startupDeps.getSshPtyProvider(connectionId),
      onPtyStopped: startupDeps.clearProviderPtyState,
      onTerminalAgentStatus: (event) => {
        startupDeps.agentHookServer.ingestTerminalStatus(event)
      },
      // Why: serve can be promoted in place, so wire the listener from startup; runtime enables desktop-only scanners only for a ready renderer.
      onTerminalSideEffects: (batch: startupDeps.TerminalSideEffectBatch) => {
        if (startupState.mainWindow && !startupState.mainWindow.isDestroyed()) {
          startupState.mainWindow.webContents.send('pty:sideEffect', batch)
        }
      },
      getDesktopWindowStatus: getDesktopWindowStatus,
      // Why: worktree.ps pulls hook-reported agent status (same source as the desktop sidebar) at query time so mobile shows the same agents.
      getAgentStatusSnapshot: () =>
        startupDeps.agentHookServer
          .getStatusSnapshot()
          .filter((entry) => entry.providerSessionOnly !== true),
      // Why: the filter above hides resume-identity rows from the live-agent views, but
      // those rows carry the provider session mobile native chat addresses transcripts
      // by â Pi publishes identity that way and would otherwise be unreachable.
      getAgentProviderSessionSnapshot: () => startupDeps.agentHookServer.getStatusSnapshot(),
      getAgentProviderSessionRowsForPane: (paneKey) =>
        startupDeps.agentHookServer.getStatusSnapshotForPane(paneKey),
      retireAgentHookCompatibilityAuthority: (paneKey) =>
        startupDeps.agentHookServer.retirePaneAuthority(paneKey),
      canRecoverPersistentLocalPtys: () => startupDeps.getDaemonProvider() !== null,
      buildAgentHookPtyEnv: () =>
        startupDeps.isAgentStatusHooksEnabled(startupState.store?.getSettings())
          ? startupDeps.agentHookServer.buildPtyEnv()
          : {}
    }
  )
  startupState.runtime = runtimeService
  publishProviderSessionChanges(startupDeps.agentHookServer.getProviderSessionIdentities())
  startupDeps.browserManager.setBrowserGuestStateChangedListener((worktreeId) => {
    runtimeService.notifyMobileSessionTabsChanged(worktreeId)
  })
  runtimeService.setCommitMessageAgentEnvironmentResolvers({
    // Why: Codex hooks/auth live in Orca's managed runtime home even for the default path, so every launch must resolve CODEX_HOME via runtime-home.
    prepareForCodexLaunch: prepareCodexRuntimeHomeForLaunch,
    prepareForClaudeLaunch: (target) =>
      startupState.claudeRuntimeAuth!.prepareForClaudeLaunch(target)
  })
}
