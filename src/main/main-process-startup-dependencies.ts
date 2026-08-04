export { existsSync } from 'node:fs'
export { join } from 'node:path'
export { default as os } from 'node:os'
export { app, BrowserWindow, dialog, ipcMain, nativeTheme, type Tray } from 'electron'
export { initTccPromptNotice, stopTccPromptNotice } from './macos-tcc-prompt-notice'
export { electronApp, is } from '@electron-toolkit/utils'
export {
  Store,
  initDataPath,
  getCanonicalUserDataPath,
  migrateMobilePairingDataToCanonicalUserDataPath
} from './persistence'
export { initSessionParseCachePersistence } from './ai-vault/session-parse-cache-persistence'
export { ensureActiveOrcaProfile, initOrcaProfilePaths } from './orca-profiles/profile-index-store'
export { getOrcaCloudAuthConfig } from './orca-profiles/profile-cloud-auth-config'
export { getProfileUserDataPath } from './orca-profiles/profile-storage-paths'
export { applyAppIcon } from './app-icon'
export { relaunchApp } from './app-relaunch'
export { StatsCollector, initStatsPath } from './stats/collector'
export { ClaudeUsageStore, initClaudeUsagePath } from './claude-usage/store'
export { CodexUsageStore, initCodexUsagePath } from './codex-usage/store'
export { OpenCodeUsageStore, initOpenCodeUsagePath } from './opencode-usage/store'
export {
  killAllPty,
  clearProviderPtyState,
  getPtyIdForPaneKey,
  registerPaneKeyTeardownListener,
  getLocalPtyProvider,
  getSshPtyProvider,
  registerHeadlessPtyRuntime
} from './ipc/pty'
export {
  initDaemonPtyProvider,
  disconnectDaemon,
  getDaemonProvider,
  shutdownDaemon
} from './daemon/daemon-init'
export { closeAllWatchers } from './ipc/filesystem-watcher'
export { disposeWorktreeBaseDirectoryWatchers } from './ipc/worktree-base-directory-watcher'
export { registerCoreHandlers } from './ipc/register-core-handlers'
export { initObservability, shutdownObservability } from './observability'
export { registerMobileHandlers } from './ipc/mobile'
export { initTelemetry, shutdownTelemetry, trackAppOpenedOnce, track } from './telemetry/client'
export { classifyError } from './telemetry/classify-error'
export { recordManagedHookInstallFailure } from './agent-hooks/install-telemetry'
export {
  indexPersistedPaneKeyPtyIds,
  isLocalExecutionHost,
  resolveAgentWorkspaceExecutionHostId,
  sweepRestoredSubagentsWithoutLiveAgent
} from './agent-hooks/restored-subagent-liveness-sweep'
export {
  applyAgentStatusHooksEnabled,
  isAgentStatusHooksEnabled,
  removeManagedAgentHooks
} from './agent-hooks/managed-agent-hook-controls'
export { initCohortClassifier } from './telemetry/cohort-classifier'
export { initOnboardingCohortClassifier } from './telemetry/onboarding-cohort-classifier'
export { resolveConsent } from './telemetry/consent'
export { triggerStartupNotificationRegistration } from './ipc/notifications'
export { OrcaRuntimeService, type RuntimeWorktreeLifecycleEvent } from './runtime/orca-runtime'
export { loadAgentSessionClaimSigner } from './runtime/agent-session-claim-identity'
export { callRuntimeEnvironment } from './ipc/runtime-environment-transport-routing'
export { resolveEnvironment } from '../shared/runtime-environment-store'
export { getPreferredPairingOffer } from '../shared/runtime-environments'
export { OrcaRuntimeRpcServer } from './runtime/runtime-rpc'
export {
  recordRuntimeRpcStartFailure,
  showRuntimeRpcStartupFailureDialog
} from './runtime/runtime-rpc-startup-failure'
export { ServeReadinessPublisher } from './server/serve-readiness'
export { reserveServeStdoutForReadiness } from './server/serve-stdout-boundary'
export { DesktopRelayService } from './runtime/relay/desktop-relay-service'
export type { RelayBrokerStatus } from './runtime/relay/relay-session-broker'
export { awaitRuntimeFileWatcherUnsubscribes } from './runtime/orca-runtime-files'
export { clearRuntimeMetadataIfOwned } from './runtime/runtime-metadata'
export { scheduleAllPendingHistoryTreeRemovals } from './terminal-history-deletion'
export { ensureMainI18n, setMainPluginLanguagePacks, setMainUiLanguage } from './i18n/main-i18n'
export {
  getNextDefaultOnAppearanceSettingValue,
  registerAppMenu,
  rebuildAppMenu
} from './menu/register-app-menu'
export { createGpuAccelerationAboutPanelOptions } from './menu/gpu-acceleration-about-panel'
export {
  checkForRemoteServerUpdate,
  checkForUpdatesFromMenu,
  downloadRemoteServerUpdate,
  getRemoteServerUpdaterSnapshot,
  installRemoteServerUpdate,
  isQuittingForUpdate,
  resolveUpdateInstallMode
} from './updater'
export { configureRemoteServerUpdater } from './runtime/remote-server-updater'
export type { TuiAgent, UpdateCheckOptions } from '../shared/types'
export { recordUpdaterLifecycle } from './updater-lifecycle-diagnostics'
export { installServeSupervisorDisconnectQuit } from './serve-update-handoff'
export {
  configureElectronNetworkCompatibility,
  configureDevUserDataPath,
  configureOrcaUserDataPathEnv,
  enableMainProcessGpuFeatures,
  installDevParentDisconnectQuit,
  installDevParentSignalQuit,
  installDevParentWatchdog,
  isDevParentShutdownRequested,
  patchPackagedProcessPath,
  shouldInstallManagedHooks
} from './startup/configure-process'
export {
  installUncaughtPipeErrorGuard,
  installUnhandledRejectionLogging
} from './startup/main-process-error-guards'
export { enableRendererHeapHeadroom } from './startup/renderer-heap-headroom'
export { ensureVirtualDisplayForHeadlessServe } from './startup/ensure-virtual-display'
export {
  readActiveGpuFallbackMarker,
  writeGpuFallbackMarker,
  type GpuFallbackEnvironment,
  type WindowsGpuFallbackEnvironment
} from './startup/gpu-fallback-marker'
export { applyGpuFallbackCommandLineSwitches } from './startup/gpu-fallback-switches'
export {
  DEFAULT_GPU_CRASH_FALLBACK_THRESHOLD,
  DEFAULT_GPU_CRASH_FALLBACK_WINDOW_MS,
  GpuCrashFallbackTracker,
  isGpuFallbackCrashCandidate
} from './crash-reporting/gpu-crash-fallback-decision'
export {
  promptForGpuFallbackRestart,
  type GpuFallbackRestartDecision
} from './crash-reporting/gpu-fallback-restart-prompt'
export {
  shouldSuppressDevEducation,
  suppressDevEducationForStore
} from './startup/dev-education-suppression'
export { maybeRedirectAppImageCliLaunch } from './startup/appimage-cli-redirect'
export { maybeRedirectPackagedCliEntryLaunch } from './startup/packaged-cli-entry-redirect'
export { startFirstWindowStartupServices } from './startup/first-window-startup-services'
export { createWslCliReconciliationStartupBarrier } from './startup/wsl-cli-reconciliation-startup-barrier'
export { getDevInstanceIdentity } from './startup/dev-instance-identity'
export { hydrateShellPath, mergePathSegments } from './startup/hydrate-shell-path'
export {
  acquireSingleInstanceLock,
  logSingleInstanceLockBypass,
  logSingleInstanceLockFailure,
  shouldBypassSingleInstanceLock,
  shouldSkipSingleInstanceLock
} from './startup/single-instance-lock'
export { startEventLoopStallProbe } from './startup/event-loop-stall-probe'
export { startMainThreadChurnProbe } from './diagnostics/main-thread-churn-probe'
export {
  isStartupDiagnosticsEnabled,
  logStartupDiagnostic,
  logStartupMilestone
} from './startup/startup-diagnostics'
export { ensureWindowsUserDataAclGrant } from './startup/windows-user-data-acl'
export { shouldQuitWhenAllWindowsClosed } from './startup/window-all-closed-quit-policy'
export { createServeDesktopActivationGate } from './startup/serve-desktop-activation'
export { RateLimitService } from './rate-limits/service'
export { readMiniMaxSessionCookie } from './minimax/minimax-cookie-store'
export { getInitialClaudeRateLimitTarget } from './rate-limits/claude-rate-limit-target'
export { getInitialCodexRateLimitTarget } from './rate-limits/codex-rate-limit-target'
export { createAccountRuntimeTargetSettingsSync } from './rate-limits/account-runtime-target-sync'
export {
  attachMainWindowServices,
  ensureAutoUpdaterConfigured
} from './window/attach-main-window-services'
export { createMainWindow, loadMainWindow } from './window/createMainWindow'
export { zoomDashboardPopoutIfFocused } from './window/dashboard-popout-window'
export {
  createSystemTray,
  destroySystemTray,
  setMacMenuBarIconVisible,
  setTrayAttention,
  type SystemTrayOptions
} from './tray/system-tray'
export { createMacAppActivationHandler } from './window/macos-app-activation'
export { focusExistingMainWindow } from './window/focus-existing-window'
export { notifyMainWindowBecameVisible } from './window/main-window-visibility'
export { CodexAccountService } from './codex-accounts/service'
export { CodexRuntimeHomeService } from './codex-accounts/runtime-home-service'
export { markCodexProjectTrusted } from './agent-trust-presets'
export {
  normalizeCodexRuntimeSelection,
  type CodexAccountSelectionTarget
} from './codex-accounts/runtime-selection'
export { normalizeClaudeRuntimeSelection } from './claude-accounts/runtime-selection'
export { codexHookService, setSystemCodexHomeHookSweepSuppressed } from './codex/hook-service'
export {
  ensureRealHomeCodexHookState,
  isRealHomeCodexHookLaneUsable
} from './codex/codex-real-home-hook-install'
export { setCodexTrustGrantTelemetry } from './codex/codex-trust-grant-telemetry'
export { startCodexSessionBackfillInBackground } from './codex/codex-session-backfill'
export { startCodexSessionIndexHealInBackground } from './codex/codex-session-index-heal'
export { createCodexSessionMigrationScheduler } from './codex/codex-session-migration-scheduler'
export { prepareLegacySharedCodexSessionResume } from './codex/codex-legacy-session-resume'
export { resolveHostCodexSessionSourceHome } from './codex/codex-session-source-home'
export type { CodexSessionResumePreparation } from './codex/codex-session-resume-home'
export { prepareCodexSessionResume } from './codex/codex-session-resume-preparation'
export { getOrcaManagedCodexHomePath, getSystemCodexHomePath } from './codex/codex-home-paths'
export { normalizeRuntimePathForComparison } from '../shared/cross-platform-path'
export type { AgentProviderSessionMetadata } from '../shared/agent-session-resume'
export { getDefaultWslDistro } from './wsl'
export { ClaudeAccountService } from './claude-accounts/service'
export { ClaudeRuntimeAuthService } from './claude-accounts/runtime-auth-service'
export {
  attachClaudeLivePtyPersistence,
  onLiveClaudePtysDrained,
  seedLiveClaudePtysFromPersistence
} from './claude-accounts/live-pty-gate'
export { StarNagService } from './star-nag/service'
export { agentHookServer, type AgentHookProviderSessionIdentity } from './agent-hooks/server'
export { createHookProviderSessionInvalidator } from './agent-hooks/hook-provider-session-invalidation'
export { wslHookRelayManager } from './agent-hooks/wsl-hook-relay-manager'
export { maybeAutoRenameBranchOnFirstWork } from './agent-hooks/first-work-branch-rename'
export { rememberBranchRenameFailureOutput } from './agent-hooks/branch-rename-failure-output'
export { renameWorktreeFolderOnFirstWork } from './agent-hooks/first-work-folder-rename'
export { moveWorktree } from './git/worktree'
export { setDefaultWslDistroOverride } from './git/runner'
export { getRepoIdFromWorktreeId } from '../shared/worktree-id'
export { parseWorkspaceKey } from '../shared/workspace-scope'
export { setMigrationUnsupportedPtyListener } from './agent-hooks/migration-unsupported-pty-state'
export { AgentBrowserBridge } from './browser/agent-browser-bridge'
export { browserCertificateTrustController, browserManager } from './browser/browser-manager'
export { OffscreenBrowserBackend } from './browser/offscreen-browser-backend'
export { initializeBrowserSessionsForApp } from './browser/browser-session-startup'
export { setUnreadDockBadgeCount } from './dock/unread-badge'
export { AutomationService } from './automations/service'
export { createHeadlessAutomationOutputSnapshotBuffer } from './automations/headless-dispatch'
export { buildHeadlessAutomationWorktreeCreateArgs } from './automations/headless-workspace-create'
export { AgentAwakeService } from './agent-awake-service'
export { registerSystemResumeBroadcast } from './system-resume-broadcast'
export {
  settleTeardownWithinDeadline,
  WILL_QUIT_TEARDOWN_DEADLINE_MS
} from './quit-teardown-deadline'
export { PluginService } from './plugins/plugin-service'
export { PluginKillListService } from './plugins/plugin-kill-list-service'
export { getPluginsDataDir } from './plugins/plugin-discovery'
export { PluginMarketplaceService } from './plugins/plugin-marketplace-service'
export { PluginMarketplaceInstaller } from './plugins/plugin-marketplace-installer'
export { PluginBundledBootstrapCoordinator } from './plugins/plugin-bundled-bootstrap-coordinator'
export { resolveBundledPluginRoot } from './plugins/plugin-bundled-bootstrap'
export { resolvePluginHostEntryPath } from './plugins/plugin-host-process'
export { applyPluginConsent, applyPluginEnablement } from './plugins/plugin-enablement'
export { setPluginServiceForRpc } from './runtime/rpc/methods/plugins'
export {
  normalizePluginConsents,
  normalizePluginIdList
} from '../shared/plugins/plugin-consent-state'
export {
  recordCoalescedCrashBreadcrumb,
  recordCrashBreadcrumb
} from './crash-reporting/crash-breadcrumb-store'
export { recordDurableCrashBreadcrumb } from './crash-reporting/durable-crash-breadcrumb'
export { installMainThreadHangWatchdog } from './hang-watchdog/main-thread-hang-watchdog'
export {
  consumeHangDetectionMarker,
  hangDetectionMarkerPath
} from './hang-watchdog/hang-detection-marker'
export { getMainProcessLifecycleIdentity } from './crash-reporting/main-process-lifecycle-identity'
export { CrashReportStore } from './crash-reporting/crash-report-store'
export {
  shouldRecoverRendererAfterProcessGone,
  type ExpectedTeardownScope
} from './crash-reporting/process-gone-classification'
export { recordProcessGoneCrash as recordProcessGoneCrashEvent } from './crash-reporting/process-gone-recorder'
export {
  advanceSyntheticTitleSpinnerEntries,
  type SyntheticTitleSpinnerEntry
} from './synthetic-title-spinner'
export { shouldSendSyntheticTitleFrame } from './synthetic-title-visibility'
export { shouldCopySyntheticTitleFrameToPtyData } from './synthetic-title-frame-routing'
export {
  getSyntheticAgentTitleProfile,
  shouldDriveSyntheticAgentTitleFromHook,
  type SyntheticAgentTitleProfile
} from '../shared/synthetic-agent-title'
export type { AgentStatusState } from '../shared/agent-status-types'
export { resolveTuiAgentPermissionMode } from '../shared/tui-agent-permissions'
export type { TerminalSideEffectBatch } from '../shared/terminal-side-effect-facts'
export {
  HEADLESS_RUNTIME_WINDOW_ID,
  type RuntimeDesktopWindowStatus
} from '../shared/runtime-types'
export { LocalPtyProvider } from './providers/local-pty-provider'
export { KeybindingService } from './keybindings/keybinding-service'
export { applyElectronProxySettings } from './network/proxy-settings'
export { preserveAgentAuthBeforeRestart } from './agent-auth-restart-preservation'
export { CliInstaller } from './cli/cli-installer'
export { installLinuxBareOrcaDispatcher } from './cli/linux-bare-orca-dispatcher'
export { reconcileManagedWslCliRegistrations } from './cli/wsl-cli-registration-reconciliation'
export {
  getBundledWebClientRoot,
  getServeOptions,
  installServeSignalHandlers,
  printServeReady,
  type ServeOptions
} from './main-process-serve-startup-lifecycle'
