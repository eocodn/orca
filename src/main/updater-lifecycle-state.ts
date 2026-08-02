import type { BrowserWindow } from 'electron'
import type { UpdateStatus } from '../shared/types'
import type { LocalBuildFeed } from './local-builds/local-build-feed-server'
import type { ElectronAutoUpdater } from './electron-updater-loader'
import type { ReleaseChannel } from '../shared/release-channel'
import type { UpdateInstallMode, UpdateCheckVariant, PrimaryEventSuppression } from './updater-lifecycle-foundation'

export class UpdaterLifecycleState {
  mainWindowRef: BrowserWindow | null = null
  currentStatus: UpdateStatus = { state: 'idle' }
  userInitiatedCheck = false
  onBeforeQuitCleanup: (() => void | Promise<void>) | null = null
  autoUpdaterInitialized = false
  // Why: modifier-clicking "Check for Updates" targets prerelease manifests; the feed still pins a concrete tag so cancelled prereleases without manifests are skipped.
  includePrereleaseActive = false
  availableVersion: string | null = null
  availableReleaseUrl: string | null = null
  pendingCheckFailureKey: string | null = null
  pendingCheckFailurePromise: Promise<void> | null = null
  autoUpdateCheckTimer: ReturnType<typeof setTimeout> | null = null
  nudgeCheckTimer: ReturnType<typeof setTimeout> | null = null
  pendingQuitAndInstallTimer: ReturnType<typeof setTimeout> | null = null
  quitAndInstallInProgress = false
  updateInstallMode: UpdateInstallMode = 'interactive'
  lastInstallDeferralVersion = { download: null as string | null, install: null as string | null }
  // Why: once install has committed, late 'error' events must not clear quittingForUpdate — that would re-enable dock activate mid-installer.
  updateInstallCommitted = false
  // Why: recovery must only run after the native quitAndInstall call; pre-native errors must not clear quittingForUpdate or look like install recovery.
  quitAndInstallNativeInvoked = false
  persistLastUpdateCheckAt: ((timestamp: number) => void) | null = null
  _getLastUpdateCheckAt: (() => number | null) | null = null
  backgroundCheckLaunchPending = false
  // Why: a promoted background check can emit an error event before its promise catch runs; keep the promotion attached to that launch.
  backgroundCheckPromotedToUserInitiated = false
  updateCheckStallTimer: ReturnType<typeof setTimeout> | null = null
  updateCheckSilentSettleTimer: ReturnType<typeof setTimeout> | null = null
  updateCheckAttemptSequence = 0
  activeUpdateCheckAttemptId: number | null = null
  activeUpdateCheckLaunchAttemptId: number | null = null
  activeUpdateCheckEventAttemptId: number | null = null
  updateAvailableEventPendingAttemptId: number | null = null
  pendingUserInitiatedCheckAfterInFlight: UpdateCheckVariant | null = null
  activeUpdateNudgeId: string | null = null
  awaitingNudgeCheckOutcome = false
  nudgeCheckInFlight = false
  lastNudgeCheckAt = 0
  publishingWindowLastGoodCheck: { lastGoodTag: string } | null = null
  pendingPrereleaseFallback: {
    primaryTag: string
    fallbackTag: string
    // Why: primary promise cleanup can run after fallback starts; fallback events need this attempt-scoped state, not the mutable global.
    userInitiated: boolean
    suppressedPrimaryPromiseFailureKey: string | null
    suppressedPrimaryEventFailure: PrimaryEventSuppression | null
    suppressedFallbackPromiseFailureKey: string | null
    suppressedFallbackEventFailureKey: string | null
    fallbackResultHandled: boolean
    fallbackCheckingForUpdateSeen: boolean
    retryLaunched: boolean
  } | null = null

  _getPendingUpdateNudgeId: (() => string | null) | null = null
  _getDismissedUpdateNudgeId: (() => string | null) | null = null
  _setPendingUpdateNudgeId: ((id: string | null) => void) | null = null
  _setDismissedUpdateNudgeId: ((id: string | null) => void) | null = null
  // Why: guards against duplicate download() calls while an accepted request transitions status to 'downloading'.
  downloadInFlight = false
  /** Guards the macOS `activate` handler from reopening the old version while ShipIt replaces the .app bundle. */
  quittingForUpdate = false
  autoUpdater: ElectronAutoUpdater | null = null
  activeUpdateSource: 'release' | 'local' | 'hourly' = 'release'
  activeLocalBuildFeed: LocalBuildFeed | null = null
  localBuildSelectionInProgress = false
  // Why: a dev channel/tag jump may target an older build, so it needs allowDowngrade
  // like local builds — but off a real release feed, not a loopback server.
  pinnedBuildSelectionInProgress = false
  // Why: a pinned jump to a stable/rc tag keeps the 'release' source but is still a
  // deliberate downgrade, so newer-only gates must yield to it too.
  isPinnedBuildActive = false
  getReleaseChannelOverride: (() => ReleaseChannel | null) | null = null


  consecutiveAutomaticRetrySchedules = 0
}

export const updaterLifecycleState = new UpdaterLifecycleState()
