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
  // Why: run before ClaudeRuntimeAuthService's constructor sync — a surviving daemon Claude CLI holds the single-use refresh token; early refresh rotates it out mid-session.
  startupDeps.attachClaudeLivePtyPersistence(startupState.store)
  // Why: while a live claude defers the managed OAuth refresh, usage shows
  // "Waiting for Claude session"; refetch when the last live PTY exits so the
  // error clears immediately instead of after the failure backoff.
  startupDeps.onLiveClaudePtysDrained(() => {
    void startupState.rateLimits?.refreshAfterClaudeLivePtysDrained()
  })
  const persistedClaudePtyIds = startupState.store.getClaudeLivePtySessionIds()
  startupDeps.seedLiveClaudePtysFromPersistence(persistedClaudePtyIds)
  if (persistedClaudePtyIds.length > 0) {
    console.log(
      `[claude-live-pty] Seeded ${persistedClaudePtyIds.length} persisted Claude session id(s) into the refresh gate`
    )
  }
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
  // Why: start from empty — disk-hydrated status rows are UI continuity only; only this runtime's hook events keep the computer awake.
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
  startupDeps.initTelemetry(startupState.store)
  // Why: the breadcrumb alone never leaves the machine — it rides crash reports, and a hang is not
  // a crash (the app is force-quit, so no report is ever generated). Without this the incidence
  // number the watchdog exists to produce would sit unread on the user's disk. Must run after
  // initTelemetry: track() drops silently until the client and store are wired.
  if (hangDetection) {
    startupDeps.track('main_thread_hang_detected', {
      unresponsive_ms: Math.round(hangDetection.unresponsiveMs),
      self_recovered: hangDetection.selfRecovered
    })
  }
  // Why: the trust-grant module is bundled into plain-node CLI entries where
  // the telemetry client cannot load, so the tracker is injected here instead
  // of imported there.
  startupDeps.setCodexTrustGrantTelemetry(
    ({ outcome, hostKind, lane, reason, errorClass, verifyClass }) => {
      startupDeps.track('codex_trust_grant', {
        outcome,
        host_kind: hostKind,
        lane,
        ...(reason !== undefined ? { fallback_reason: reason } : {}),
        ...(errorClass !== undefined ? { error_class: errorClass } : {}),
        ...(verifyClass !== undefined ? { verify_class: verifyClass } : {})
      })
    }
  )
  // Why: the error-tracking lane (telemetry-error-tracking.md) is its own
  // composition root — independent of product telemetry — and must
  // initialize before any IPC handler / runtime span is created so the
  // tracer's active sink is populated at the moment the first span fires.
  // Honors DO_NOT_TRACK / ORCA_TELEMETRY_DISABLED / ORCA_DIAGNOSTICS_DISABLED
  // / CI internally; those gates do not need to be re-checked here.
  startupDeps.initObservability()
  startupDeps.recordDurableCrashBreadcrumb('main_process_lifecycle_started', {
    packaged: startupDeps.app.isPackaged,
    platform: process.platform
  })
  // Why: cohort-classifier reads repo count synchronously at every emit, so hydrate it here — before any IPC handler or window can trigger track().
  startupDeps.initCohortClassifier(startupState.store)
  startupDeps.initOnboardingCohortClassifier(startupState.store)
  startupState.stats = new startupDeps.StatsCollector()
  startupState.claudeUsage = new startupDeps.ClaudeUsageStore(startupState.store)
  startupState.codexUsage = new startupDeps.CodexUsageStore(startupState.store)
  startupState.openCodeUsage = new startupDeps.OpenCodeUsageStore(startupState.store)
  startupState.rateLimits = new startupDeps.RateLimitService()
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
  const codexSessionMigration = startupDeps.createCodexSessionMigrationScheduler({
    isEligible: () => startupState.codexRuntimeHome?.isHostSystemDefaultRealHome() === true,
    isQuitting: () => startupState.isQuitting,
    resolveSystemCodexHomePathOverride: () =>
      startupDeps.resolveHostCodexSessionSourceHome(startupState.store!.getSettings()),
    startBackfill: startupDeps.startCodexSessionBackfillInBackground,
    startIndexHeal: startupDeps.startCodexSessionIndexHealInBackground
  })
  startupState.codexAccounts = new startupDeps.CodexAccountService(
    startupState.store,
    startupState.rateLimits,
    startupState.codexRuntimeHome,
    {
      onHostSystemDefaultSelected: codexSessionMigration.requestRun
    }
  )
  // Why: one-time per-host backfill makes historical Orca-managed Codex
  // sessions visible to the user's own resume picker and app history (#4444,
  // #8612). Deferred so startup and first PTY spawns never compete with the
  // sessions tree walk.
  codexSessionMigration.scheduleInitialRun()
  startupState.claudeRuntimeAuth = new startupDeps.ClaudeRuntimeAuthService(startupState.store)
  startupState.claudeAccounts = new startupDeps.ClaudeAccountService(
    startupState.store,
    startupState.rateLimits,
    startupState.claudeRuntimeAuth
  )
  startupState.rateLimits.setCodexHomePathResolver((target) =>
    startupState.codexRuntimeHome!.prepareForRateLimitFetch(target)
  )
  startupState.rateLimits.setCodexFetchTarget(
    startupDeps.getInitialCodexRateLimitTarget(startupState.store.getSettings())
  )
  startupState.rateLimits.setClaudeFetchTarget(
    startupDeps.getInitialClaudeRateLimitTarget(startupState.store.getSettings())
  )
  const syncAccountRuntimeTargets = startupDeps.createAccountRuntimeTargetSettingsSync(
    startupState.rateLimits,
    startupState.store.getSettings()
  )
  startupState.store.onSettingsChanged((updates, settings) => {
    // Why: auto is a live policy; retarget only providers whose settings-derived runtime changed.
    void syncAccountRuntimeTargets(updates, settings).catch((error) =>
      console.warn('[rate-limits] Failed to apply account runtime target:', error)
    )
  })
  startupState.rateLimits.setClaudeAuthPreparationResolver((target) =>
    startupState.claudeRuntimeAuth!.prepareForRateLimitFetch(target)
  )
  // Why: live Claude sessions stream usage windows through their statusLine command; feeding them here avoids OAuth usage-endpoint polling (and its 429s).
  startupDeps.agentHookServer.setClaudeStatusLineListener((event) => {
    startupState.rateLimits?.ingestLiveClaudeRateLimits(event)
  })
  startupState.rateLimits.setOpenCodeGoConfigResolver(() => {
    const settings = startupState.store!.getSettings()
    return {
      sessionCookie: settings.opencodeSessionCookie,
      workspaceIdOverride: settings.opencodeWorkspaceId
    }
  })
  startupState.rateLimits.setMiniMaxConfigResolver(() => {
    const settings = startupState.store!.getSettings()
    return {
      sessionCookie: startupDeps.readMiniMaxSessionCookie() ?? '',
      groupId: settings.minimaxGroupId,
      models: settings.minimaxUsageModels
    }
  })
  startupState.rateLimits.setGeminiCliOAuthEnabledResolver(
    () => startupState.store!.getSettings().geminiCliOAuthEnabled
  )
  startupState.rateLimits.setNetworkProxySettingsResolver(() => startupState.store!.getSettings())
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
  startupState.rateLimits.setInactiveClaudeAccountsResolver(() => {
    const settings = startupState.store!.getSettings()
    const activeIds = new Set(
      [
        startupDeps.normalizeClaudeRuntimeSelection(settings).host,
        ...Object.values(startupDeps.normalizeClaudeRuntimeSelection(settings).wsl)
      ].filter(Boolean)
    )
    return settings.claudeManagedAccounts
      .filter((account) => !activeIds.has(account.id))
      .map((account) => ({
        id: account.id,
        managedAuthPath: account.managedAuthPath,
        managedAuthRuntime: account.managedAuthRuntime,
        wslDistro: account.wslDistro,
        wslLinuxAuthPath: account.wslLinuxAuthPath
      }))
  })
  startupState.rateLimits.setInactiveCodexAccountsResolver(() => {
    const settings = startupState.store!.getSettings()
    const activeIds = new Set(
      [
        startupDeps.normalizeCodexRuntimeSelection(settings).host,
        ...Object.values(startupDeps.normalizeCodexRuntimeSelection(settings).wsl)
      ].filter(Boolean)
    )
    return settings.codexManagedAccounts
      .filter((account) => !activeIds.has(account.id))
      .map((account) => ({ id: account.id, managedHomePath: account.managedHomePath }))
  })
  const runtimeService = new startupDeps.OrcaRuntimeService(
    startupState.store,
    startupState.stats,
    {
      agentSessionClaimSigner: startupDeps.loadAgentSessionClaimSigner(
        startupDeps.getProfileUserDataPath(),
        startupDeps.getProfileUserDataPath()
      ),
      // Why: resolve the PTY provider lazily — a daemon swap happens later, so an eager reference would freeze the pre-daemon provider (design §4.3).
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
      // by — Pi publishes identity that way and would otherwise be unreachable.
      getAgentProviderSessionSnapshot: () => startupDeps.agentHookServer.getStatusSnapshot(),
      getAgentProviderSessionRowsForPane: (paneKey) =>
        startupDeps.agentHookServer.getStatusSnapshotForPane(paneKey),
      retireAgentHookCompatibilityAuthority: (paneKey) =>
        startupDeps.agentHookServer.retirePaneAuthority(paneKey),
      canRecoverPersistentLocalPtys: () => startupDeps.getDaemonProvider() !== null,
      // Why: source codex-home here (runs in window AND serve) so aiVault.listSessions includes managed-Codex sessions; registerCoreHandlers is window-only.
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
      buildAgentHookPtyEnv: () =>
        startupDeps.isAgentStatusHooksEnabled(startupState.store?.getSettings())
          ? startupDeps.agentHookServer.buildPtyEnv()
          : {},
    }
  )
  startupState.runtime = runtimeService
  publishProviderSessionChanges(startupDeps.agentHookServer.getProviderSessionIdentities())
  startupDeps.browserManager.setBrowserGuestStateChangedListener((worktreeId) => {
    runtimeService.notifyMobileSessionTabsChanged(worktreeId)
  })
  startupState.automations = new startupDeps.AutomationService(startupState.store, {
    claudeUsage: startupState.claudeUsage,
    codexUsage: startupState.codexUsage,
    // Why: desktop clients mirror remote-host automations, but only a server process should execute remote_host_service-owned schedules.
    allowRemoteHostScheduling: startupState.isServeMode,
    headlessDispatcher: startupState.isServeMode
      ? async ({ automation, run, target }) => {
          const terminalSnapshotLimit = 2_000
          let terminalHandle: string
          let terminalSessionId: string | null = null
          let terminalPaneKey: string | null = null
          let terminalPtyId: string | null = null
          let workspaceId: string
          let workspaceDisplayName: string | null = null

          if (automation.workspaceMode === 'new_per_run') {
            const created = await runtimeService.createManagedWorktree({
              ...startupDeps.buildHeadlessAutomationWorktreeCreateArgs({
                automation,
                run,
                repo: target.repo
              })
            })
            terminalHandle = created.startupTerminal?.handle ?? ''
            terminalSessionId = created.startupTerminal?.tabId ?? null
            terminalPaneKey = created.startupTerminal?.paneKey ?? null
            terminalPtyId = created.startupTerminal?.ptyId ?? null
            workspaceId = created.worktree.id
            workspaceDisplayName = created.worktree.displayName ?? null
            if (!terminalHandle) {
              throw new Error(
                created.warning ||
                  'Automation workspace was created, but no agent terminal started.'
              )
            }
          } else {
            if (!automation.workspaceId) {
              throw new Error('The target workspace is no longer available.')
            }
            const terminal = await runtimeService.launchAgentTerminal(
              `id:${automation.workspaceId}`,
              {
                agent: automation.agentId,
                prompt: automation.prompt,
                title: run.title
              }
            )
            terminalHandle = terminal.handle
            terminalSessionId = terminal.tabId ?? null
            terminalPaneKey = terminal.paneKey ?? null
            terminalPtyId = terminal.ptyId ?? null
            workspaceId = terminal.worktreeId
            const worktree = await runtimeService.showManagedWorktree(`id:${workspaceId}`)
            workspaceDisplayName = worktree.displayName ?? null
          }

          const completion = (async () => {
            const wait = await runtimeService.waitForTerminal(terminalHandle, {
              condition: 'tui-idle'
            })
            const read = await runtimeService.readTerminal(terminalHandle, {
              limit: terminalSnapshotLimit
            })
            const snapshotBuffer = startupDeps.createHeadlessAutomationOutputSnapshotBuffer()
            snapshotBuffer.append(read.tail.join('\n'))
            if (wait.satisfied) {
              return {
                status: 'completed' as const,
                outputSnapshot: snapshotBuffer.snapshot(),
                error: null
              }
            }
            return {
              status: 'dispatch_failed' as const,
              outputSnapshot: snapshotBuffer.snapshot(),
              error: wait.blockedReason
                ? `Automation agent is blocked: ${wait.blockedReason}.`
                : 'Automation agent did not report completion.'
            }
          })()

          return {
            workspaceId,
            workspaceDisplayName,
            terminalSessionId,
            terminalPaneKey,
            terminalPtyId,
            completion
          }
        }
      : undefined
  })
  runtimeService.setAutomationService(startupState.automations)
  runtimeService.setAccountServices({
    claudeAccounts: startupState.claudeAccounts,
    codexAccounts: startupState.codexAccounts,
    rateLimits: startupState.rateLimits
  })
  runtimeService.setCommitMessageAgentEnvironmentResolvers({
    // Why: Codex hooks/auth live in Orca's managed runtime home even for the default path, so every launch must resolve CODEX_HOME via runtime-home.
    prepareForCodexLaunch: prepareCodexRuntimeHomeForLaunch,
    prepareForClaudeLaunch: (target) =>
      startupState.claudeRuntimeAuth!.prepareForClaudeLaunch(target)
  })
}
