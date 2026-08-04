import { app, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { UpdateCheckOptions, UpdateStatus } from '../shared/types'
import type {
  RemoteServerUpdateInstallResult,
  RemoteServerUpdaterSnapshot,
  RemoteServerUpdateSupport
} from '../shared/remote-server-update'
import { killAllPty } from './ipc/pty'
import { withUpdaterSpan } from './observability/instrumentation'
import {
  isMacInstallerReady,
  markMacQuitAndInstallInFlight,
  resetMacInstallState
} from './updater-mac-install'
import {
  armUpdateInstallExitWatchdog,
  disarmUpdateInstallExitWatchdog
} from './update-install-exit-watchdog'
import { recordUpdaterLifecycle } from './updater-lifecycle-diagnostics'
import {
  failServeUpdateHandoff,
  requestServeUpdateHandoff
} from './serve-update-handoff'

import { updaterLifecycleState as state } from './updater-lifecycle-state'
import {
  AUTO_UPDATE_RETRY_INTERVAL_MS,
  PRE_QUIT_CLEANUP_TIMEOUT_MS,
  ReleaseFeedPreflightError,
  type CheckFailureSource
} from './updater-lifecycle-foundation'
import * as internal from './updater-lifecycle-domain-registry'
import { isBenignCheckFailure } from './updater-fallback'

export async function performQuitAndInstall(): Promise<void> {
  if (state.quitAndInstallInProgress) {
    recordUpdaterLifecycle('quit_and_install_ignored', { reason: 'already-in-progress' })
    return
  }

  if (state.pendingQuitAndInstallTimer) {
    clearTimeout(state.pendingQuitAndInstallTimer)
    state.pendingQuitAndInstallTimer = null
  }

  const pendingVersion = internal.getPendingInstallVersion()
  if (internal.deferHeadlessServeInstall('install', pendingVersion)) {
    return
  }
  state.quitAndInstallInProgress = true

  markMacQuitAndInstallInFlight()

  // Set BEFORE anything else so the `activate` handler doesn't reopen the old version while ShipIt replaces the .app bundle.
  state.quittingForUpdate = true

  try {
    await withUpdaterSpan({ stage: 'install' }, async (span) => {
      span.setAttribute('updater.version', pendingVersion || 'unknown')
      span.setAttribute('updater.platform', process.platform)
      span.setAttribute(
        'updater.macosInstallerReady',
        process.platform === 'darwin' ? isMacInstallerReady() : true
      )
      recordUpdaterLifecycle('quit_and_install_started', {
        version: pendingVersion || null,
        macInstallerReady: process.platform === 'darwin' ? isMacInstallerReady() : true
      })
      span.addEvent('pre_quit_cleanup_start')
      await internal.runBeforeUpdateQuitCleanup()
      span.addEvent('pre_quit_cleanup_done')

      if (
        state.updateInstallMode === 'supervised-headless-serve' &&
        !requestServeUpdateHandoff(pendingVersion)
      ) {
        recordUpdaterLifecycle(
          'headless_serve_handoff_failed',
          { version: pendingVersion || null },
          {
            level: 'warn',
            message: 'Could not persist supervised serve update handoff'
          }
        )
        internal.sendErrorStatus(
          'Could not prepare the supervised server restart. Orca remains running.',
          true
        )
        internal.resetQuitForUpdateState()
        return
      }

      recordUpdaterLifecycle('quit_and_install_invoking_native', {
        version: pendingVersion || null
      })
      // Why: defensive — never call internal.quitAndInstall if recovery/reset already cleared the handoff.
      if (!state.quitAndInstallInProgress) {
        return
      }
      // Why: mark before the call so a sync 'error' during internal.quitAndInstall can recover; pre-native errors must not look like install failure.
      state.quitAndInstallNativeInvoked = true
      // Why: invoke before killAllPty/removing close listeners so a sync 'error' (the "no filepath" path) can recover while windows and PTYs are intact.
      const supervisorOwnsRelaunch = state.updateInstallMode === 'supervised-headless-serve'
      internal.getAutoUpdater().quitAndInstall(supervisorOwnsRelaunch, !supervisorOwnsRelaunch)
      span.addEvent('native_quit_and_install_invoked')

      // Why: internal.quitAndInstall can synchronously clear state.quitAndInstallInProgress via recovery (Win/Linux dispatchError); skip destructive prep if it already ran.
      if (!state.quitAndInstallInProgress) {
        return
      }

      killAllPty()
      span.addEvent('local_pty_kill_all')

      for (const win of BrowserWindow.getAllWindows()) {
        win.removeAllListeners('close')
      }
      span.addEvent('window_close_listeners_removed', {
        windowCount: BrowserWindow.getAllWindows().length
      })

      // Why: committed installs keep state.quittingForUpdate so dock activate can't reopen the old process; macOS without Squirrel stays uncommitted so late native errors can still recover.
      if (process.platform !== 'darwin' || isMacInstallerReady()) {
        state.updateInstallCommitted = true
        // Why: past commit the installer waits for this process to exit; a wedged async shutdown would strand the user with no app and no update (#4438).
        armUpdateInstallExitWatchdog()
      }
    })
  } catch (error) {
    failServeUpdateHandoff('Could not invoke the native updater.')
    internal.resetQuitForUpdateState()
    recordUpdaterLifecycle(
      'quit_and_install_failed',
      { errorType: error instanceof Error ? error.name : typeof error },
      {
        level: 'warn',
        message: 'Could not start update install'
      }
    )
    internal.sendErrorStatus(
      'Could not restart to install the update. Quit and reopen Orca, then try again.'
    )
  }
}

export function resetQuitForUpdateState(): void {
  state.quitAndInstallInProgress = false
  state.quittingForUpdate = false
  state.updateInstallCommitted = false
  state.quitAndInstallNativeInvoked = false
  disarmUpdateInstallExitWatchdog()
  resetMacInstallState()
}

// Why: internal.quitAndInstall failures arrive via 'error'; recover only after native invoke and before commit, else clearing state.quittingForUpdate lets dock activate reopen the old process mid-installer.
export function handleQuitAndInstallFailure(): boolean {
  if (!state.quitAndInstallInProgress || !state.quitAndInstallNativeInvoked || state.updateInstallCommitted) {
    return false
  }
  failServeUpdateHandoff('The native updater rejected the install request.')
  internal.resetQuitForUpdateState()
  recordUpdaterLifecycle('quit_and_install_failed_via_event', undefined, {
    level: 'warn',
    message: 'Update install could not start; recovered app state'
  })
  internal.sendErrorStatus('Could not restart to install the update. Quit and reopen Orca, then try again.')
  return true
}

// Why: while quit-and-install owns the process, general check/download error UI must not run.
export function isQuitAndInstallHandoffActive(): boolean {
  return state.quitAndInstallInProgress
}

export async function runBeforeUpdateQuitCleanup(): Promise<void> {
  if (!state.onBeforeQuitCleanup) {
    return
  }

  let timeout: ReturnType<typeof setTimeout> | null = null
  const cleanup = Promise.resolve()
    .then(() => state.onBeforeQuitCleanup?.())
    .catch((error) => {
      recordUpdaterLifecycle(
        'pre_quit_cleanup_failed',
        { errorType: error instanceof Error ? error.name : typeof error },
        {
          level: 'warn',
          message: 'Pre-quit cleanup failed; continuing update install'
        }
      )
    })
  const timeoutResult = new Promise<'timeout'>((resolve) => {
    timeout = setTimeout(() => resolve('timeout'), PRE_QUIT_CLEANUP_TIMEOUT_MS)
  })

  const result = await Promise.race([cleanup.then(() => 'done' as const), timeoutResult])
  if (result === 'timeout') {
    recordUpdaterLifecycle(
      'pre_quit_cleanup_timeout',
      { timeoutMs: PRE_QUIT_CLEANUP_TIMEOUT_MS },
      {
        level: 'warn',
        message: `Pre-quit cleanup exceeded ${PRE_QUIT_CLEANUP_TIMEOUT_MS}ms; continuing update install`
      }
    )
    return
  }

  if (timeout) {
    clearTimeout(timeout)
  }
}

export async function sendCheckFailureStatus(
  message: string,
  userInitiated?: boolean,
  source: CheckFailureSource = 'promise',
  sourceError?: unknown
): Promise<void> {
  if (state.activeUpdateSource === 'local') {
    internal.sendLocalBuildErrorAndRestore(message, userInitiated)
    return
  }
  if (state.isPinnedBuildActive) {
    // Why: a failed pinned jump must hand the feed back before surfacing the
    // error, or the pin blocks background checks for the process lifetime.
    internal.clearAvailableUpdateContext()
    internal.restoreReleaseUpdateSource()
    internal.sendStatus({ state: 'error', message, userInitiated })
    return
  }
  const failureKey = internal.getCheckFailureKey(message, userInitiated)
  if (
    source === 'promise' &&
    state.pendingPrereleaseFallback?.suppressedPrimaryPromiseFailureKey === failureKey
  ) {
    state.pendingPrereleaseFallback.suppressedPrimaryPromiseFailureKey = null
    internal.clearPrereleaseFallbackContextIfSettled()
    return
  }
  if (
    source === 'fallback-promise' &&
    state.pendingPrereleaseFallback?.suppressedFallbackPromiseFailureKey === failureKey
  ) {
    state.pendingPrereleaseFallback.suppressedFallbackPromiseFailureKey = null
    internal.clearPrereleaseFallbackContextIfSettled()
    return
  }

  if (
    internal.retryPrereleaseFallbackAfterMissingManifest(
      message,
      userInitiated,
      source,
      failureKey,
      sourceError
    )
  ) {
    return
  }

  if (state.pendingCheckFailureKey === failureKey && state.pendingCheckFailurePromise) {
    return state.pendingCheckFailurePromise
  }

  const handleFailure = async (): Promise<void> => {
    if (isBenignCheckFailure(message) || internal.isRetryableReleaseFeedPreflightFailure(sourceError)) {
      // Why: benign failures (incomplete latest.yml, network blips) are transient — retry, and skip persisting the timestamp (would suppress the next startup check).
      console.warn('[updater] benign check failure:', message)
      internal.clearAvailableUpdateContext()
      internal.scheduleAutomaticUpdateCheck(AUTO_UPDATE_RETRY_INTERVAL_MS)
      if (userInitiated) {
        // Why: a user click needs visible feedback (idle looks broken); distinguish incomplete releases from transport failures.
        internal.sendErrorStatus(
          internal.isStableReleaseNotReadyFailure(sourceError)
            ? "A newer release isn't available for this device yet. Check again later."
            : "Couldn't reach the update server. Try again in a few minutes.",
          true
        )
      } else {
        if (internal.isRetryableReleaseFeedPreflightFailure(sourceError)) {
          // Why: release probes can fail transiently; keep the campaign pending so the short retry can still show it.
          internal.deferPendingUpdateNudgeUntilRetry()
        }
        internal.sendStatus({ state: 'idle' })
      }
      return
    }

    internal.clearAvailableUpdateContext()
    state.persistLastUpdateCheckAt?.(Date.now())
    if (!userInitiated) {
      internal.scheduleAutomaticUpdateCheck(AUTO_UPDATE_RETRY_INTERVAL_MS)
    }
    internal.sendErrorStatus(message, userInitiated)
  }

  state.pendingCheckFailureKey = failureKey
  state.pendingCheckFailurePromise = handleFailure().finally(() => {
    if (state.pendingCheckFailureKey === failureKey) {
      state.pendingCheckFailureKey = null
      state.pendingCheckFailurePromise = null
    }
  })
  return state.pendingCheckFailurePromise
}

export function isRetryableReleaseFeedPreflightFailure(sourceError: unknown): boolean {
  return (
    sourceError instanceof ReleaseFeedPreflightError &&
    (sourceError.reason === 'release-not-ready' || sourceError.reason === 'manifest-unavailable')
  )
}

export function isStableReleaseNotReadyFailure(sourceError: unknown): boolean {
  return (
    sourceError instanceof ReleaseFeedPreflightError &&
    sourceError.reason === 'release-not-ready' &&
    sourceError.releaseChannel === 'default'
  )
}

export function getUpdateStatus(): UpdateStatus {
  return state.currentStatus
}

export function getRemoteServerUpdateSupport(): RemoteServerUpdateSupport {
  if (!app.isPackaged || is.dev) {
    return {
      installMode: state.updateInstallMode,
      automatic: false,
      reason: 'unpackaged-build'
    }
  }
  if (!state.autoUpdaterInitialized) {
    return {
      installMode: state.updateInstallMode,
      automatic: false,
      reason: 'updater-unavailable'
    }
  }
  if (state.updateInstallMode === 'unsupported-headless-serve') {
    return {
      installMode: state.updateInstallMode,
      automatic: false,
      reason: 'manual-service-update-required'
    }
  }
  return { installMode: state.updateInstallMode, automatic: true, reason: 'available' }
}

export function getRemoteServerUpdaterSnapshot(runtimeId: string): RemoteServerUpdaterSnapshot {
  return {
    appVersion: app.getVersion(),
    runtimeId,
    support: internal.getRemoteServerUpdateSupport(),
    status: internal.getUpdateStatus()
  }
}

export function assertRemoteServerUpdateAvailable(): void {
  if (!internal.getRemoteServerUpdateSupport().automatic) {
    throw new Error('remote_update_manual_required')
  }
}

export function checkForRemoteServerUpdate(
  runtimeId: string,
  options?: UpdateCheckOptions
): RemoteServerUpdaterSnapshot {
  internal.assertRemoteServerUpdateAvailable()
  internal.checkForUpdatesFromMenu(options)
  return internal.getRemoteServerUpdaterSnapshot(runtimeId)
}

export function downloadRemoteServerUpdate(runtimeId: string): RemoteServerUpdaterSnapshot {
  internal.assertRemoteServerUpdateAvailable()
  if (state.currentStatus.state !== 'available') {
    throw new Error('remote_update_not_available')
  }
  internal.downloadUpdate()
  return internal.getRemoteServerUpdaterSnapshot(runtimeId)
}

export function installRemoteServerUpdate(runtimeId: string): RemoteServerUpdateInstallResult {
  internal.assertRemoteServerUpdateAvailable()
  if (state.currentStatus.state !== 'downloaded') {
    throw new Error('remote_update_not_downloaded')
  }
  const targetVersion = state.currentStatus.version
  const result: RemoteServerUpdateInstallResult = {
    accepted: true,
    fromVersion: app.getVersion(),
    targetVersion,
    runtimeId
  }
  internal.quitAndInstall()
  return result
}
