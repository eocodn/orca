import { app, BrowserWindow, powerMonitor } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { UpdateCheckOptions, UpdateStatus } from '../shared/types'
import type {
  RemoteServerUpdateInstallResult,
  RemoteServerUpdaterSnapshot,
  RemoteServerUpdateSupport
} from '../shared/remote-server-update'
import { isWindowsSignatureCheckUnavailableFailure } from '../shared/updater-windows-signature-check'
import { killAllPty } from './ipc/pty'
import { withUpdaterSpan } from './observability/instrumentation'
import { loadElectronAutoUpdater, type ElectronAutoUpdater } from './electron-updater-loader'
import { writeMainThreadDiagnosticMarker } from './diagnostics/main-thread-churn-probe'
import {
  beginMacUpdateDownload,
  deferMacQuitUntilInstallerReady,
  isMacInstallerReady,
  markMacQuitAndInstallInFlight,
  resetMacInstallState
} from './updater-mac-install'
import {
  armUpdateInstallExitWatchdog,
  disarmUpdateInstallExitWatchdog
} from './update-install-exit-watchdog'
import { registerAutoUpdaterHandlers } from './updater-events'
import { recordUpdaterLifecycle } from './updater-lifecycle-diagnostics'
import {
  compareVersions,
  isBenignCheckFailure,
  isMissingUpdateManifestFailure,
  isPrereleaseVersion,
  statusesEqual
} from './updater-fallback'
import {
  fetchNewerReleaseTagsWithReadiness,
  getReleaseDownloadUrl
} from './updater-prerelease-feed'
import { fetchNudge, shouldApplyNudge } from './updater-nudge'
import {
  failServeUpdateHandoff,
  getServeUpdateHandoffFailure,
  hasServeUpdateSupervisor,
  requestServeUpdateHandoff
} from './serve-update-handoff'
import type { LocalBuildFeed } from './local-builds/local-build-feed-server'
import { listReleaseBuilds, resolveTargetBuild } from './updater-release-builds'
import {
  isChannelSupportedOnPlatform,
  type ReleaseBuild,
  type ReleaseChannel
} from '../shared/release-channel'

import { updaterLifecycleState as state } from './updater-lifecycle-state'
import {
  AUTO_UPDATE_CHECK_INTERVAL_MS,
  AUTO_UPDATE_RETRY_INTERVAL_MS,
  MAX_AUTO_UPDATE_RETRY_INTERVAL_MS,
  NUDGE_POLL_INTERVAL_MS,
  NUDGE_ACTIVATION_COOLDOWN_MS,
  QUIT_AND_INSTALL_DELAY_MS,
  PRE_QUIT_CLEANUP_TIMEOUT_MS,
  UPDATE_CHECK_SILENT_SETTLE_DELAY_MS,
  UPDATE_CHECK_STALL_TIMEOUT_MS,
  ReleaseFeedPreflightError,
  type CheckFailureSource,
  type MissingManifestPrereleaseFallbackResult,
  type PrimaryEventSuppression,
  type UpdateCheckVariant,
  type ReleaseFeedPreflightFailure,
  type ReleaseFeedPreflightResult,
  type UpdateInstallMode
} from './updater-lifecycle-foundation'
import * as internal from './updater-lifecycle-domain-registry'

export function checkForUpdatesFromMenu(options?: UpdateCheckOptions): void {
  if (!app.isPackaged || is.dev) {
    internal.sendStatus({ state: 'not-available', userInitiated: true })
    return
  }
  if (options?.localBuild) {
    void internal.checkForLocalBuildFromMenu()
    return
  }
  if (options?.targetTag && options.channel) {
    void internal.checkForPinnedBuild(options.channel, options.targetTag)
    return
  }
  if (state.localBuildSelectionInProgress || state.pinnedBuildSelectionInProgress) {
    return
  }
  if (
    state.activeUpdateSource !== 'release' &&
    (state.currentStatus.state === 'checking' || state.currentStatus.state === 'downloading')
  ) {
    return
  }
  internal.restoreReleaseUpdateSource()

  const checkVariant = internal.getUpdateCheckVariant(options)
  if (checkVariant === 'prerelease') {
    internal.clearPrereleaseFallbackContext()
    internal.enableIncludePrerelease()
  } else if (checkVariant === 'perf') {
    internal.clearPrereleaseFallbackContext()
    // Why: perf checks need prerelease manifests now, but must not opt future default/background checks into the RC channel.
    internal.enablePrereleaseManifestChecks()
  }

  const checkAlreadyInFlight = state.backgroundCheckLaunchPending || state.currentStatus.state === 'checking'
  state.userInitiatedCheck = true
  // Why: manual checks are nudge-independent; clear the marker so a later dismiss can't consume the campaign by accident.
  state.activeUpdateNudgeId = null
  // Why: respond visibly before feed pinning/updater events; duplicate broadcasts are suppressed by status equality below.
  internal.sendStatus({ state: 'checking', userInitiated: true })
  if (checkAlreadyInFlight) {
    state.backgroundCheckPromotedToUserInitiated = true
    internal.rearmActiveUpdateCheckStallTimer()
    if (checkVariant !== 'default') {
      // Why: in-flight check may have pinned the stable feed; queue a fresh modifier check to avoid a stale-channel result.
      state.pendingUserInitiatedCheckAfterInFlight = checkVariant
    }
    return
  }

  const attemptId = internal.beginUpdateCheckAttempt()
  const autoUpdater = internal.getAutoUpdater()
  const launch = (): Promise<unknown> | undefined => {
    if (!internal.isActiveUpdateCheckAttempt(attemptId)) {
      return undefined
    }
    internal.markUpdateCheckLaunched(attemptId)
    return autoUpdater.checkForUpdates()
  }
  const run = internal.pinDefaultReleaseFeed(checkVariant).then((preflightResult) => {
    if (preflightResult === 'not-available') {
      if (!internal.isActiveUpdateCheckAttempt(attemptId)) {
        return false
      }
      state.userInitiatedCheck = false
      internal.finishActiveUpdateCheckAttempt()
      internal.recordCompletedUpdateCheck()
      internal.sendStatus({ state: 'not-available', userInitiated: true })
      return false
    }
    return launch()
  })
  void Promise.resolve(run)
    .then((launchResult) => {
      if (launchResult === false) {
        return
      }
      internal.handleSettledUpdateCheckPromise(attemptId)
    })
    .catch((err) => {
      if (!internal.isActiveUpdateCheckAttempt(attemptId)) {
        return
      }
      state.userInitiatedCheck = false
      void internal.sendCheckFailureStatus(String(err?.message ?? err), true, 'promise', err)
    })
}

export async function checkForLocalBuildFromMenu(): Promise<void> {
  if (process.platform !== 'darwin') {
    internal.sendLocalBuildErrorAndRestore(
      'Local build switching is currently available only on macOS.',
      true
    )
    return
  }
  if (state.currentStatus.state === 'checking' || state.currentStatus.state === 'downloading') {
    return
  }
  if (state.localBuildSelectionInProgress) {
    return
  }
  state.localBuildSelectionInProgress = true
  try {
    const [{ chooseLocalBuild }, { startLocalBuildFeed }] = await Promise.all([
      import('./local-builds/local-build-switch'),
      import('./local-builds/local-build-feed-server')
    ])
    const candidate = await chooseLocalBuild(state.mainWindowRef)
    if (!candidate) {
      return
    }
    internal.closeLocalBuildFeed()
    const feed = await startLocalBuildFeed(candidate)
    state.activeLocalBuildFeed = feed
    state.activeUpdateSource = 'local'
    internal.clearPrereleaseFallbackContext()
    internal.clearPublishingWindowLastGoodCheck()
    internal.clearAvailableUpdateContext()
    state.activeUpdateNudgeId = null
    state.userInitiatedCheck = true
    internal.sendStatus({ state: 'checking', userInitiated: true })

    const updater = internal.getAutoUpdater()
    updater.allowDowngrade = true
    updater.disableDifferentialDownload = true
    updater.setFeedURL({ provider: 'generic', url: feed.url })
    const attemptId = internal.beginUpdateCheckAttempt()
    internal.markUpdateCheckLaunched(attemptId)
    await updater.checkForUpdates()
    internal.handleSettledUpdateCheckPromise(attemptId)
  } catch (error) {
    state.userInitiatedCheck = false
    internal.sendLocalBuildErrorAndRestore(String((error as Error)?.message ?? error), true)
  } finally {
    state.localBuildSelectionInProgress = false
  }
}

export async function listAvailableReleaseBuilds(channel: ReleaseChannel): Promise<ReleaseBuild[]> {
  return listReleaseBuilds(channel)
}

/**
 * Pins the updater at one exact release tag and checks it, so a dev can move to
 * any published build on any channel — including an older one.
 *
 * Unlike a routine check this sets `allowDowngrade`, because "jump to yesterday's
 * hourly" is a downgrade by semver. The pin is torn down as soon as the attempt
 * settles so ordinary background checks never inherit it.
 */
export async function checkForPinnedBuild(channel: ReleaseChannel, tag: string): Promise<void> {
  if (!app.isPackaged || is.dev) {
    internal.sendStatus({ state: 'not-available', userInitiated: true })
    return
  }
  // Why here as well as in the picker: the renderer disables the option, but IPC
  // is reachable regardless, and there is no artifact to install off-macOS.
  if (!isChannelSupportedOnPlatform(channel, process.platform)) {
    internal.sendStatus({
      state: 'error',
      message: 'Hourly builds are produced only for macOS.',
      userInitiated: true
    })
    return
  }
  if (state.currentStatus.state === 'checking' || state.currentStatus.state === 'downloading') {
    return
  }
  if (state.localBuildSelectionInProgress || state.pinnedBuildSelectionInProgress) {
    return
  }
  state.pinnedBuildSelectionInProgress = true
  try {
    const target = resolveTargetBuild(channel, tag)
    if (compareVersions(target.version, app.getVersion()) === 0) {
      internal.sendStatus({ state: 'not-available', userInitiated: true })
      return
    }
    internal.closeLocalBuildFeed()
    state.activeUpdateSource = channel === 'hourly' ? 'hourly' : 'release'
    state.isPinnedBuildActive = true
    internal.clearPrereleaseFallbackContext()
    internal.clearPublishingWindowLastGoodCheck()
    internal.clearAvailableUpdateContext()
    state.activeUpdateNudgeId = null
    state.userInitiatedCheck = true
    internal.sendStatus({ state: 'checking', userInitiated: true })

    const updater = internal.getAutoUpdater()
    // Why: an intentional jump to an older tag must not be filtered out as "not newer".
    updater.allowDowngrade = true
    updater.disableDifferentialDownload = true
    updater.allowPrerelease = true
    console.info(`[updater] pinned to ${channel} build ${target.tag} → ${target.feedUrl}`)
    updater.setFeedURL({ provider: 'generic', url: target.feedUrl })
    state.availableReleaseUrl = target.feedUrl
    const attemptId = internal.beginUpdateCheckAttempt()
    internal.markUpdateCheckLaunched(attemptId)
    await updater.checkForUpdates()
    internal.handleSettledUpdateCheckPromise(attemptId)
  } catch (error) {
    state.userInitiatedCheck = false
    internal.clearAvailableUpdateContext()
    internal.restoreReleaseUpdateSource()
    internal.sendStatus({
      state: 'error',
      message: String((error as Error)?.message ?? error),
      userInitiated: true
    })
  } finally {
    state.pinnedBuildSelectionInProgress = false
  }
}

export function isQuittingForUpdate(): boolean {
  return state.quittingForUpdate
}

export function quitAndInstall(): void {
  if (
    state.localBuildSelectionInProgress ||
    state.pinnedBuildSelectionInProgress ||
    state.pendingQuitAndInstallTimer ||
    state.quitAndInstallInProgress
  ) {
    return
  }

  if (internal.deferHeadlessServeInstall('install', internal.getPendingInstallVersion())) {
    return
  }

  if (
    deferMacQuitUntilInstallerReady(
      state.currentStatus,
      internal.hasInstallableDownloadedVersion(),
      internal.getPendingInstallVersion,
      internal.sendStatus
    )
  ) {
    return
  }

  // Why: defer the quit a tick so the renderer can flush dismissals/state before windows start closing.
  state.pendingQuitAndInstallTimer = setTimeout(() => {
    void internal.performQuitAndInstall()
  }, QUIT_AND_INSTALL_DELAY_MS)
}

export async function checkForUpdateNudge(): Promise<void> {
  if (!app.isPackaged || is.dev) {
    return
  }
  if (state.nudgeCheckInFlight) {
    return
  }

  const now = Date.now()
  if (now - state.lastNudgeCheckAt < NUDGE_ACTIVATION_COOLDOWN_MS) {
    return
  }
  state.lastNudgeCheckAt = now

  state.nudgeCheckInFlight = true
  try {
    const nudge = await fetchNudge()
    if (!nudge) {
      return
    }

    if (state.currentStatus.state === 'checking' || state.currentStatus.state === 'downloading') {
      return
    }

    const appVersion = app.getVersion()
    const pendingUpdateNudgeId = state._getPendingUpdateNudgeId?.() ?? null
    const dismissedUpdateNudgeId = state._getDismissedUpdateNudgeId?.() ?? null

    if (
      shouldApplyNudge({
        nudge,
        appVersion,
        pendingUpdateNudgeId,
        dismissedUpdateNudgeId
      })
    ) {
      state.awaitingNudgeCheckOutcome = true
      state._setPendingUpdateNudgeId?.(nudge.id)
      state.mainWindowRef?.webContents.send('updater:clearDismissal')
      internal.runBackgroundUpdateCheck(nudge.id)
    }
  } finally {
    state.nudgeCheckInFlight = false
  }
}

export function scheduleUpdateNudgeCheck(): void {
  if (state.nudgeCheckTimer) {
    clearTimeout(state.nudgeCheckTimer)
  }
  state.nudgeCheckTimer = setTimeout(() => {
    void internal.checkForUpdateNudge()
    internal.scheduleUpdateNudgeCheck()
  }, NUDGE_POLL_INTERVAL_MS)
}

export function dismissNudge(): void {
  const pendingId = state.activeUpdateNudgeId ?? state._getPendingUpdateNudgeId?.() ?? null
  if (pendingId) {
    state._setDismissedUpdateNudgeId?.(pendingId)
    internal.clearPendingUpdateNudge()
  }
}

/**
 * The user closed an offered update without taking it. For a local build or a
 * pinned dev jump that ends the session: nothing will consume that feed now, so
 * release checks must stop being deferred.
 */
export function dismissAvailableUpdate(): void {
  if (state.activeUpdateSource === 'release' && !state.isPinnedBuildActive) {
    return
  }
  if (state.localBuildSelectionInProgress || state.pinnedBuildSelectionInProgress) {
    return
  }
  // Why: only an un-acted 'available' card is abandoned — 'downloading'/'downloaded' still need the pinned feed and allowDowngrade.
  if (state.currentStatus.state !== 'available') {
    return
  }
  internal.clearAvailableUpdateContext()
  internal.restoreReleaseUpdateSource()
  // Why: leaving the card's 'available' status behind would let a retry download the local version off the restored release feed.
  internal.sendStatus({ state: 'idle' })
}
