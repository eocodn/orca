import { app, BrowserWindow, powerMonitor } from 'electron'
import { is } from '@electron-toolkit/utils'
import { beginMacUpdateDownload } from './updater-mac-install'
import { registerAutoUpdaterHandlers } from './updater-events'
import { recordUpdaterLifecycle } from './updater-lifecycle-diagnostics'
import { getServeUpdateHandoffFailure } from './serve-update-handoff'
import type { ReleaseChannel } from '../shared/release-channel'

import { updaterLifecycleState as state } from './updater-lifecycle-state'
import {
  type UpdateInstallMode
} from './updater-lifecycle-foundation'
import * as internal from './updater-lifecycle-domain-registry'

export function setupAutoUpdater(
  mainWindow: BrowserWindow,
  opts?: {
    getLastUpdateCheckAt?: () => number | null
    onBeforeQuit?: () => void | Promise<void>
    setLastUpdateCheckAt?: (timestamp: number) => void
    getPendingUpdateNudgeId?: () => string | null
    getDismissedUpdateNudgeId?: () => string | null
    setPendingUpdateNudgeId?: (id: string | null) => void
    setDismissedUpdateNudgeId?: (id: string | null) => void
    getReleaseChannelOverride?: () => ReleaseChannel | null
    installMode?: UpdateInstallMode
  }
): void {
  state.mainWindowRef = mainWindow
  state.onBeforeQuitCleanup = opts?.onBeforeQuit ?? null
  state.persistLastUpdateCheckAt = opts?.setLastUpdateCheckAt ?? null
  state._getLastUpdateCheckAt = opts?.getLastUpdateCheckAt ?? null
  state._getPendingUpdateNudgeId = opts?.getPendingUpdateNudgeId ?? null
  state._getDismissedUpdateNudgeId = opts?.getDismissedUpdateNudgeId ?? null
  state._setPendingUpdateNudgeId = opts?.setPendingUpdateNudgeId ?? null
  state._setDismissedUpdateNudgeId = opts?.setDismissedUpdateNudgeId ?? null
  state.getReleaseChannelOverride = opts?.getReleaseChannelOverride ?? null
  state.updateInstallMode = opts?.installMode ?? 'interactive'
  state.lastInstallDeferralVersion = { download: null, install: null }

  const serveHandoffFailure = getServeUpdateHandoffFailure()
  if (serveHandoffFailure) {
    recordUpdaterLifecycle(
      'headless_serve_handoff_failed',
      { reason: serveHandoffFailure },
      { level: 'warn', message: 'Supervised serve update did not complete' }
    )
    internal.sendErrorStatus(`The server update did not complete: ${serveHandoffFailure}`, true)
  }

  if (!app.isPackaged && !is.dev) {
    return
  }
  if (is.dev) {
    return
  }

  const autoUpdater = internal.getAutoUpdater()
  autoUpdater.autoDownload = false
  if (state.activeUpdateSource === 'release') {
    autoUpdater.allowDowngrade = false
    autoUpdater.disableDifferentialDownload = false
  }
  // Why: supervised serve installs require an explicit handoff; ordinary service quits must never install implicitly.
  autoUpdater.autoInstallOnAppQuit = state.updateInstallMode === 'interactive'
  // Why: MacUpdater ignores internal.quitAndInstall arguments; the surviving CLI supervisor must be the only serve relaunch owner.
  autoUpdater.autoRunAppAfterInstall = state.updateInstallMode === 'interactive'

  // Why: our only on-machine window into electron-updater; otherwise an unexpected update-not-available or failed fetch is invisible.
  autoUpdater.logger = {
    info: (m: unknown) => console.info('[autoUpdater]', m),
    warn: (m: unknown) => console.warn('[autoUpdater]', m),
    error: (m: unknown) => console.error('[autoUpdater]', m),
    debug: (m: unknown) => console.debug('[autoUpdater]', m)
  } as never

  // Security: never re-add a verifyUpdateCodeSignature override — a no-op disables electron-updater's built-in Authenticode check and accepts any installer.

  // Why: generic provider avoids the native GitHub provider's RC-channel filtering; per-check repinning to a concrete /releases/download/<tag>/ URL avoids /latest redirect drift between check and download.
  if (state.activeUpdateSource === 'release') {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: 'https://github.com/stablyai/orca/releases/latest/download'
    })
  }

  if (state.autoUpdaterInitialized) {
    return
  }
  state.autoUpdaterInitialized = true

  registerAutoUpdaterHandlers({
    autoUpdater,
    clearAvailableUpdateContext: internal.clearAvailableUpdateContext,
    consumeMissingManifestPrereleaseFallbackResult: internal.consumeMissingManifestPrereleaseFallbackResult,
    getMissingManifestPrereleaseFallbackUserInitiated: internal.getMissingManifestPrereleaseFallbackUserInitiated,
    getPublishingWindowLastGoodCheck: internal.getPublishingWindowLastGoodCheck,
    getActiveUpdateCheckEventAttemptId: internal.getActiveUpdateCheckEventAttemptId,
    getCurrentStatus: () => state.currentStatus,
    getKnownReleaseUrl: internal.getKnownReleaseUrl,
    getPendingInstallVersion: internal.getPendingInstallVersion,
    getUserInitiatedCheck: () => state.userInitiatedCheck,
    handleQuitAndInstallFailure: internal.handleQuitAndInstallFailure,
    isQuitAndInstallHandoffActive: internal.isQuitAndInstallHandoffActive,
    hasInstallableDownloadedVersion: internal.hasInstallableDownloadedVersion,
    isLocalBuildCheck: () => state.activeUpdateSource === 'local',
    // Why: pinned jumps are deliberate, so update-available/-downloaded must not
    // reject them for being older than the running version.
    isPinnedBuildCheck: () => state.isPinnedBuildActive,
    shouldHandleUpdaterErrorEvent: internal.shouldHandleUpdaterErrorEvent,
    performQuitAndInstall: internal.performQuitAndInstall,
    clearUpdateAvailableEventPending: internal.clearUpdateAvailableEventPending,
    isActiveUpdateCheckAttempt: internal.isActiveUpdateCheckAttempt,
    markUpdateCheckEventAttempt: internal.markUpdateCheckEventAttempt,
    markUpdateAvailableEventPending: internal.markUpdateAvailableEventPending,
    sendCheckFailureStatus: internal.sendCheckFailureStatus,
    sendErrorStatus: internal.sendErrorStatus,
    markMissingManifestPrereleaseFallbackChecking: internal.markMissingManifestPrereleaseFallbackChecking,
    shouldDeferMacQuitForInstall: () => state.updateInstallMode === 'interactive',
    shouldSuppressMissingManifestPrereleaseFallbackEvent: internal.shouldSuppressMissingManifestPrereleaseFallbackEvent,
    suppressMissingManifestPrereleaseFallbackPromiseFailure: internal.suppressMissingManifestPrereleaseFallbackPromiseFailure,
    recordCompletedUpdateCheck: internal.recordCompletedUpdateCheck,
    restoreReleaseUpdateSource: internal.restoreReleaseUpdateSource,
    sendStatus: internal.sendStatus,
    scheduleAutomaticUpdateCheck: internal.scheduleAutomaticUpdateCheck,
    clearBackgroundCheckLaunchPending: internal.clearBackgroundCheckLaunchPending,
    setAvailableReleaseUrl: (releaseUrl) => {
      state.availableReleaseUrl = releaseUrl
    },
    setAvailableVersion: (version) => {
      state.availableVersion = version
    },
    setUserInitiatedCheck: (value) => {
      state.userInitiatedCheck = value
    }
  })

  void internal.checkForUpdateNudge()
  internal.scheduleUpdateNudgeCheck()

  const checkDailyOnWake = () => {
    void internal.checkForUpdateNudge()
    if (
      state.backgroundCheckLaunchPending ||
      state.currentStatus.state === 'checking' ||
      state.currentStatus.state === 'downloading'
    ) {
      return
    }
    const lastCheck = state._getLastUpdateCheckAt?.() ?? null
    const msSince = lastCheck === null ? Number.POSITIVE_INFINITY : Date.now() - lastCheck
    if (msSince >= AUTO_UPDATE_CHECK_INTERVAL_MS) {
      internal.runBackgroundUpdateCheck()
      internal.scheduleAutomaticUpdateCheck(AUTO_UPDATE_CHECK_INTERVAL_MS)
    }
  }

  powerMonitor.on('resume', checkDailyOnWake)
  app.on('browser-window-focus', checkDailyOnWake)

  const lastUpdateCheckAt = opts?.getLastUpdateCheckAt?.() ?? null
  const msSinceLastCheck =
    lastUpdateCheckAt === null ? Number.POSITIVE_INFINITY : Date.now() - lastUpdateCheckAt

  if (msSinceLastCheck >= AUTO_UPDATE_CHECK_INTERVAL_MS) {
    internal.runBackgroundUpdateCheck()
    internal.scheduleAutomaticUpdateCheck(AUTO_UPDATE_CHECK_INTERVAL_MS)
  } else {
    internal.scheduleAutomaticUpdateCheck(AUTO_UPDATE_CHECK_INTERVAL_MS - msSinceLastCheck)
  }
}

export function downloadUpdate(): void {
  if (state.localBuildSelectionInProgress || state.pinnedBuildSelectionInProgress || state.downloadInFlight) {
    return
  }
  // Why: allow retry from 'error' (state.availableVersion stays cached) so the error card's Retry Download button works.
  const canStart =
    state.currentStatus.state === 'available' ||
    (state.currentStatus.state === 'error' && internal.hasInstallableDownloadedVersion())
  if (!canStart) {
    return
  }
  const version = state.currentStatus.state === 'available' ? state.currentStatus.version : state.availableVersion
  if (!version) {
    return
  }
  if (internal.deferHeadlessServeInstall('download', version)) {
    return
  }
  state.downloadInFlight = true
  const localBuildDownload = state.activeUpdateSource === 'local'
  beginMacUpdateDownload()
  // Why: setup can take seconds before progress emits; surface acceptance now so the action never looks inert.
  internal.sendStatus({ state: 'downloading', percent: 0, version })
  internal.getAutoUpdater()
    .downloadUpdate()
    .catch((err) => {
      state.downloadInFlight = false
      const message = String(err?.message ?? err)
      if (localBuildDownload) {
        internal.sendLocalBuildErrorAndRestore(message)
      } else {
        internal.sendErrorStatus(message)
      }
    })
}
