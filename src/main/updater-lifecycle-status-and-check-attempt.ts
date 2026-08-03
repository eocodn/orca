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

export function getAutoUpdater(): ElectronAutoUpdater {
  if (!state.autoUpdater) {
    state.autoUpdater = loadElectronAutoUpdater()
  }
  return state.autoUpdater
}

export function clearAvailableUpdateContext(): void {
  state.availableVersion = null
  state.availableReleaseUrl = null
}

export function closeLocalBuildFeed(): void {
  const feed = state.activeLocalBuildFeed
  state.activeLocalBuildFeed = null
  if (feed) {
    void feed.close()
  }
}

export function restoreReleaseUpdateSource(): void {
  internal.closeLocalBuildFeed()
  state.activeUpdateSource = 'release'
  state.isPinnedBuildActive = false
  if (state.autoUpdater) {
    state.autoUpdater.allowDowngrade = false
    state.autoUpdater.disableDifferentialDownload = false
    // Why: a pinned jump forces allowPrerelease on; leaving it set would opt
    // every later background check into the RC channel behind the user's back.
    state.autoUpdater.allowPrerelease = state.includePrereleaseActive
  }
}

export function sendLocalBuildErrorAndRestore(message: string, userInitiated?: boolean): void {
  internal.clearAvailableUpdateContext()
  if (
    state.currentStatus.state !== 'error' ||
    state.currentStatus.message !== message ||
    state.currentStatus.userInitiated !== userInitiated ||
    state.currentStatus.source !== 'local'
  ) {
    internal.sendStatus({ state: 'error', message, userInitiated, source: 'local' })
  }
  internal.restoreReleaseUpdateSource()
}

export function clearPrereleaseFallbackContext(): void {
  state.pendingPrereleaseFallback = null
}

export function clearPendingUpdateNudge(): void {
  state.activeUpdateNudgeId = null
  state.awaitingNudgeCheckOutcome = false
  state._setPendingUpdateNudgeId?.(null)
}

export function deferPendingUpdateNudgeUntilRetry(): void {
  state.activeUpdateNudgeId = null
  state.awaitingNudgeCheckOutcome = false
}

export function clearPublishingWindowLastGoodCheck(): void {
  state.publishingWindowLastGoodCheck = null
}

export function getPublishingWindowLastGoodCheck(): { lastGoodTag: string } | null {
  return state.publishingWindowLastGoodCheck
}

export function getPersistedPendingUpdateNudgeId(): string | null {
  return state._getPendingUpdateNudgeId?.() ?? null
}

export function decorateStatusWithActiveNudge(status: UpdateStatus): UpdateStatus {
  // Why: only actionable/error states carry the nudge marker so the renderer knows a dismiss should ack the campaign; cycle-boundary states never need it.
  if (!state.activeUpdateNudgeId) {
    return status
  }
  if (status.state === 'idle' || status.state === 'checking' || status.state === 'not-available') {
    return status
  }
  return { ...status, activeNudgeId: state.activeUpdateNudgeId }
}

export function sendStatus(status: UpdateStatus): void {
  const pendingUserInitiatedCheckVariant = state.pendingUserInitiatedCheckAfterInFlight
  const shouldLaunchPendingUserInitiatedCheck =
    pendingUserInitiatedCheckVariant !== null &&
    (status.state === 'idle' ||
      status.state === 'not-available' ||
      status.state === 'available' ||
      status.state === 'error')
  const shouldPreserveNudgeForPublishingWindow =
    state.publishingWindowLastGoodCheck !== null &&
    (status.state === 'idle' ||
      status.state === 'not-available' ||
      status.state === 'available' ||
      status.state === 'error')
  if (state.awaitingNudgeCheckOutcome) {
    if (status.state === 'available') {
      if (shouldPreserveNudgeForPublishingWindow) {
        // Why: a last-good available update is only a temporary fallback; dismissing it must not consume the newest-release nudge campaign.
        internal.deferPendingUpdateNudgeUntilRetry()
      } else {
        state.awaitingNudgeCheckOutcome = false
      }
    } else if (
      status.state === 'idle' ||
      status.state === 'not-available' ||
      status.state === 'error'
    ) {
      if (shouldPreserveNudgeForPublishingWindow) {
        // Why: last-good checks can say "not available" while the campaign's newest release is still publishing.
        internal.deferPendingUpdateNudgeUntilRetry()
      } else {
        // Why: on no-update, mark the campaign dismissed so a nudge covering already-up-to-date users doesn't re-fire every 30-min poll.
        if (state.activeUpdateNudgeId) {
          state._setDismissedUpdateNudgeId?.(state.activeUpdateNudgeId)
        }
        internal.clearPendingUpdateNudge()
      }
    }
  }

  const sourcedStatus: UpdateStatus =
    state.activeUpdateSource === 'release' ? status : { ...status, source: state.activeUpdateSource }
  const decoratedStatus = internal.decorateStatusWithActiveNudge(sourcedStatus)

  if (internal.isUpdateCheckResultState(status.state)) {
    internal.finishActiveUpdateCheckAttempt()
  }

  if (
    status.state === 'idle' ||
    status.state === 'not-available' ||
    status.state === 'available' ||
    status.state === 'error'
  ) {
    internal.clearPublishingWindowLastGoodCheck()
  }

  // Why: reset the in-flight guard once status moves past the window where duplicate download() calls are possible.
  if (
    decoratedStatus.state === 'downloading' ||
    decoratedStatus.state === 'error' ||
    decoratedStatus.state === 'idle'
  ) {
    state.downloadInFlight = false
  }
  if (shouldLaunchPendingUserInitiatedCheck) {
    internal.launchPendingUserInitiatedCheckAfterInFlight(pendingUserInitiatedCheckVariant)
    return
  }
  if (statusesEqual(state.currentStatus, decoratedStatus)) {
    return
  }
  state.currentStatus = decoratedStatus
  state.mainWindowRef?.webContents.send('updater:status', decoratedStatus)
}

export function getOptionsForUpdateCheckVariant(variant: UpdateCheckVariant): UpdateCheckOptions {
  switch (variant) {
    case 'perf':
      return { includePrerelease: true, includePerfPrerelease: true }
    case 'prerelease':
      return { includePrerelease: true }
    case 'default':
      return { includePrerelease: false }
  }
}

export function getUpdateCheckVariant(options?: UpdateCheckOptions): UpdateCheckVariant {
  if (options?.includePerfPrerelease) {
    return 'perf'
  }
  if (options?.includePrerelease) {
    return 'prerelease'
  }
  // Why: a persisted 'rc' override makes every routine check follow the RC series
  // without the user re-holding shift; 'hourly' needs an explicit tag, so it is
  // not a routine-check variant.
  if (state.getReleaseChannelOverride?.() === 'rc') {
    return 'prerelease'
  }
  return 'default'
}

export function launchPendingUserInitiatedCheckAfterInFlight(variant: UpdateCheckVariant): void {
  state.pendingUserInitiatedCheckAfterInFlight = null
  setTimeout(() => {
    // Why: defer one tick after electron-updater clears its in-flight promise so the queued modifier check starts fresh instead of deduping into the stable one.
    if (state.currentStatus.state === 'checking') {
      state.currentStatus = { state: 'idle' }
    }
    internal.checkForUpdatesFromMenu(internal.getOptionsForUpdateCheckVariant(variant))
  }, 0)
}

export function clearBackgroundCheckLaunchPending(): void {
  state.backgroundCheckLaunchPending = false
}

export function clearUpdateCheckStallTimer(): void {
  if (!state.updateCheckStallTimer) {
    return
  }
  clearTimeout(state.updateCheckStallTimer)
  state.updateCheckStallTimer = null
}

export function clearUpdateCheckSilentSettleTimer(): void {
  if (!state.updateCheckSilentSettleTimer) {
    return
  }
  clearTimeout(state.updateCheckSilentSettleTimer)
  state.updateCheckSilentSettleTimer = null
}

export function clearUpdateCheckTimers(): void {
  internal.clearUpdateCheckStallTimer()
  internal.clearUpdateCheckSilentSettleTimer()
}

export function finishActiveUpdateCheckAttempt(): void {
  state.activeUpdateCheckAttemptId = null
  state.activeUpdateCheckLaunchAttemptId = null
  state.activeUpdateCheckEventAttemptId = null
  internal.clearUpdateCheckTimers()
}

export function getActiveUpdateCheckEventAttemptId(): number | null {
  if (state.activeUpdateCheckAttemptId === null) {
    return null
  }
  if (state.activeUpdateCheckEventAttemptId !== state.activeUpdateCheckAttemptId) {
    return null
  }
  return state.activeUpdateCheckAttemptId
}

export function isActiveUpdateCheckAttempt(attemptId: number): boolean {
  return state.activeUpdateCheckAttemptId === attemptId
}

export function markUpdateCheckEventAttempt(): boolean {
  if (state.activeUpdateCheckAttemptId === null) {
    return false
  }
  if (state.activeUpdateCheckLaunchAttemptId !== state.activeUpdateCheckAttemptId) {
    return false
  }
  state.activeUpdateCheckEventAttemptId = state.activeUpdateCheckAttemptId
  return true
}

export function markUpdateCheckLaunched(attemptId: number): void {
  if (!internal.isActiveUpdateCheckAttempt(attemptId)) {
    return
  }
  state.activeUpdateCheckLaunchAttemptId = attemptId
}

export function markUpdateAvailableEventPending(attemptId: number | null): void {
  state.updateAvailableEventPendingAttemptId = attemptId
}

export function clearUpdateAvailableEventPending(attemptId: number | null): void {
  if (state.updateAvailableEventPendingAttemptId !== attemptId) {
    return
  }
  state.updateAvailableEventPendingAttemptId = null
}

export function armUpdateCheckStallTimer(attemptId: number): void {
  internal.clearUpdateCheckStallTimer()
  state.updateCheckStallTimer = setTimeout(() => {
    state.updateCheckStallTimer = null
    if (!internal.isActiveUpdateCheckAttempt(attemptId)) {
      return
    }
    const wasUserInitiated = internal.getSettledCheckUserInitiated()
    if (state.currentStatus.state === 'checking') {
      internal.finishActiveUpdateCheckAttempt()
      state.backgroundCheckLaunchPending = false
      state.backgroundCheckPromotedToUserInitiated = false
      state.userInitiatedCheck = false
      void internal.sendCheckFailureStatus(
        'Update check timed out. Try again in a few minutes.',
        wasUserInitiated,
        'promise'
      )
      return
    }
    if (state.backgroundCheckLaunchPending) {
      internal.finishActiveUpdateCheckAttempt()
      state.backgroundCheckLaunchPending = false
      state.backgroundCheckPromotedToUserInitiated = false
      state.userInitiatedCheck = false
      internal.scheduleAutomaticUpdateCheck(AUTO_UPDATE_RETRY_INTERVAL_MS)
    }
  }, UPDATE_CHECK_STALL_TIMEOUT_MS)
}

export function beginUpdateCheckAttempt(): number {
  internal.finishActiveUpdateCheckAttempt()
  state.updateAvailableEventPendingAttemptId = null
  state.updateCheckAttemptSequence += 1
  state.activeUpdateCheckAttemptId = state.updateCheckAttemptSequence
  internal.armUpdateCheckStallTimer(state.activeUpdateCheckAttemptId)
  // Why: issue #7576 warnings recurred at retry cadence; timestamp each attempt to confirm or rule out the updater.
  writeMainThreadDiagnosticMarker('updater-check-attempt')
  return state.activeUpdateCheckAttemptId
}

export function rearmActiveUpdateCheckStallTimer(): void {
  if (state.activeUpdateCheckAttemptId === null) {
    return
  }
  internal.armUpdateCheckStallTimer(state.activeUpdateCheckAttemptId)
}

export function getSettledCheckUserInitiated(): boolean | undefined {
  return state.userInitiatedCheck || state.backgroundCheckPromotedToUserInitiated || undefined
}

export function isUpdateCheckResultState(state: UpdateStatus['state']): boolean {
  return (
    state === 'idle' ||
    state === 'not-available' ||
    state === 'available' ||
    state === 'error' ||
    state === 'downloading' ||
    state === 'downloaded'
  )
}

export function consumeSilentCheckShortRetryReason(): boolean {
  if (state.publishingWindowLastGoodCheck !== null) {
    return true
  }
  return internal.consumeMissingManifestPrereleaseFallbackResult() !== null
}

export function completeSilentUpdateCheck(userInitiated: boolean | undefined): boolean {
  const shouldRetrySoon = internal.consumeSilentCheckShortRetryReason()
  internal.clearAvailableUpdateContext()
  if (shouldRetrySoon) {
    // Why: a silent result against a temporary last-good feed is still a release transition, so it must not suppress the short publish retry.
    internal.scheduleAutomaticUpdateCheck(AUTO_UPDATE_RETRY_INTERVAL_MS)
    return true
  }
  internal.recordCompletedUpdateCheck()
  if (!userInitiated) {
    internal.scheduleAutomaticUpdateCheck(AUTO_UPDATE_CHECK_INTERVAL_MS)
  }
  return false
}

export function settleSilentUpdateCheck(attemptId: number, userInitiated: boolean | undefined): void {
  if (!internal.isActiveUpdateCheckAttempt(attemptId)) {
    return
  }
  if (state.updateAvailableEventPendingAttemptId === attemptId) {
    return
  }
  if (state.currentStatus.state !== 'checking') {
    if (state.backgroundCheckLaunchPending) {
      internal.finishActiveUpdateCheckAttempt()
      internal.clearBackgroundCheckLaunchPending()
      state.backgroundCheckPromotedToUserInitiated = false
      state.userInitiatedCheck = false
      const shouldRetrySoon = internal.completeSilentUpdateCheck(userInitiated)
      if (state.awaitingNudgeCheckOutcome) {
        if (shouldRetrySoon) {
          internal.deferPendingUpdateNudgeUntilRetry()
          return
        }
        internal.sendStatus({ state: 'not-available', userInitiated })
      }
    }
    return
  }
  internal.finishActiveUpdateCheckAttempt()
  internal.clearBackgroundCheckLaunchPending()
  state.backgroundCheckPromotedToUserInitiated = false
  state.userInitiatedCheck = false
  internal.completeSilentUpdateCheck(userInitiated)
  internal.sendStatus({ state: 'not-available', userInitiated })
}

export function handleSettledUpdateCheckPromise(attemptId: number): void {
  if (!internal.isActiveUpdateCheckAttempt(attemptId)) {
    return
  }
  internal.clearUpdateCheckSilentSettleTimer()
  // Why: electron-updater can resolve before the terminal event arrives; grace-period it, then unstick checks that resolved without one.
  state.updateCheckSilentSettleTimer = setTimeout(() => {
    state.updateCheckSilentSettleTimer = null
    internal.settleSilentUpdateCheck(attemptId, internal.getSettledCheckUserInitiated())
  }, UPDATE_CHECK_SILENT_SETTLE_DELAY_MS)
}

export function shouldHandleUpdaterErrorEvent(): boolean {
  if (internal.getActiveUpdateCheckEventAttemptId() !== null) {
    return true
  }
  // Why: electron-updater emits check errors globally; once a check settles, only active download/install flows should consume them.
  return (
    state.downloadInFlight ||
    state.currentStatus.state === 'downloading' ||
    state.currentStatus.state === 'downloaded'
  )
}

export function sendErrorStatus(message: string, userInitiated?: boolean): void {
  if (
    state.currentStatus.state === 'error' &&
    state.currentStatus.message === message &&
    state.currentStatus.userInitiated === userInitiated
  ) {
    return
  }
  // Why: count AV/EDR-blocked Windows signature checks in the field to size the affected cohort before bigger updater changes.
  if (isWindowsSignatureCheckUnavailableFailure(message)) {
    recordUpdaterLifecycle('windows_signature_check_blocked', undefined, {
      level: 'warn',
      message: 'Windows update signature check could not run'
    })
  }
  internal.sendStatus({ state: 'error', message, userInitiated })
}

export function getKnownReleaseUrl(): string | undefined {
  return state.availableReleaseUrl ?? undefined
}

export function hasInstallableDownloadedVersion(): boolean {
  return (
    state.availableVersion !== null &&
    // Why: local builds and pinned dev jumps may intentionally move backwards.
    (state.activeUpdateSource !== 'release' ||
      state.isPinnedBuildActive ||
      compareVersions(state.availableVersion, app.getVersion()) > 0)
  )
}

export function getPendingInstallVersion(): string {
  if (state.availableVersion) {
    return state.availableVersion
  }
  if (state.currentStatus.state === 'downloading' || state.currentStatus.state === 'downloaded') {
    return state.currentStatus.version
  }
  return ''
}

export function deferHeadlessServeInstall(phase: 'download' | 'install', version: string): boolean {
  if (state.updateInstallMode !== 'unsupported-headless-serve') {
    return false
  }
  const diagnosticVersion = version || 'unknown'
  if (state.lastInstallDeferralVersion[phase] !== diagnosticVersion) {
    state.lastInstallDeferralVersion[phase] = diagnosticVersion
    recordUpdaterLifecycle(
      'headless_serve_install_deferred',
      { phase, version: version || null },
      {
        level: 'warn',
        message: 'Update install deferred while hosting orca serve'
      }
    )
  }
  internal.sendErrorStatus(
    'This orca serve process was not started by an update-capable supervisor. Keep it running and update Orca through its service manager.',
    true
  )
  return true
}

export function resolveUpdateInstallMode(isServeMode: boolean): UpdateInstallMode {
  if (!isServeMode) {
    return 'interactive'
  }
  return hasServeUpdateSupervisor() ? 'supervised-headless-serve' : 'unsupported-headless-serve'
}

export function getCheckFailureKey(message: string, userInitiated?: boolean): string {
  return `${userInitiated ? 'user' : 'auto'}:${message}`
}

export function clearPrereleaseFallbackContextIfSettled(): void {
  if (
    state.pendingPrereleaseFallback?.fallbackResultHandled &&
    !state.pendingPrereleaseFallback.suppressedPrimaryPromiseFailureKey &&
    !state.pendingPrereleaseFallback.suppressedPrimaryEventFailure &&
    !state.pendingPrereleaseFallback.suppressedFallbackPromiseFailureKey &&
    !state.pendingPrereleaseFallback.suppressedFallbackEventFailureKey
  ) {
    internal.clearPrereleaseFallbackContext()
  }
}
