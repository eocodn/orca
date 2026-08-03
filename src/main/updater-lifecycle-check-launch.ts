import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { withUpdaterSpan } from './observability/instrumentation'
import {
  isMissingUpdateManifestFailure,
  isPrereleaseVersion,
} from './updater-fallback'
import {
  fetchNewerReleaseTagsWithReadiness,
  getReleaseDownloadUrl
} from './updater-prerelease-feed'
import { updaterLifecycleState as state } from './updater-lifecycle-state'

import {
  AUTO_UPDATE_CHECK_INTERVAL_MS,
  AUTO_UPDATE_RETRY_INTERVAL_MS,
  MAX_AUTO_UPDATE_RETRY_INTERVAL_MS,
  ReleaseFeedPreflightError,
  type CheckFailureSource,
  type MissingManifestPrereleaseFallbackResult,
  type UpdateCheckVariant,
  type ReleaseFeedPreflightResult
} from './updater-lifecycle-foundation'
import * as internal from './updater-lifecycle-domain-registry'


export function scheduleAutomaticUpdateCheck(delayMs: number): void {
  let effectiveDelayMs = delayMs
  // All retry-cadence callers pass exactly this constant, so keying backoff on it keeps one choke point instead of threading a flag through every schedule site.
  if (delayMs === AUTO_UPDATE_RETRY_INTERVAL_MS) {
    effectiveDelayMs = Math.min(
      AUTO_UPDATE_RETRY_INTERVAL_MS * 2 ** state.consecutiveAutomaticRetrySchedules,
      MAX_AUTO_UPDATE_RETRY_INTERVAL_MS
    )
    state.consecutiveAutomaticRetrySchedules += 1
  }
  if (state.autoUpdateCheckTimer) {
    clearTimeout(state.autoUpdateCheckTimer)
  }
  state.autoUpdateCheckTimer = setTimeout(() => {
    // Why: Orca runs for days, so keep the next background check scheduled in the main process rather than tying it to relaunches or renderer lifetime.
    if (!internal.runBackgroundUpdateCheck()) {
      // Why: a deferred check reaches no outcome handler, so re-arm here or one deferral ends automatic checks for the process lifetime.
      internal.scheduleAutomaticUpdateCheck(AUTO_UPDATE_CHECK_INTERVAL_MS)
    }
  }, effectiveDelayMs)
}

export function recordCompletedUpdateCheck(): void {
  state.consecutiveAutomaticRetrySchedules = 0
  state.persistLastUpdateCheckAt?.(Date.now())
}

export function getMissingManifestPrereleaseFallbackUserInitiated(): boolean | null {
  if (
    !state.pendingPrereleaseFallback?.retryLaunched ||
    state.pendingPrereleaseFallback.fallbackResultHandled
  ) {
    return null
  }
  return state.pendingPrereleaseFallback.userInitiated
}

export function markMissingManifestPrereleaseFallbackChecking(): void {
  if (
    !state.pendingPrereleaseFallback?.retryLaunched ||
    state.pendingPrereleaseFallback.fallbackResultHandled
  ) {
    return
  }
  state.pendingPrereleaseFallback.fallbackCheckingForUpdateSeen = true
}

export function consumeMissingManifestPrereleaseFallbackResult(): MissingManifestPrereleaseFallbackResult | null {
  if (
    !state.pendingPrereleaseFallback?.retryLaunched ||
    state.pendingPrereleaseFallback.fallbackResultHandled
  ) {
    return null
  }
  const result = { userInitiated: state.pendingPrereleaseFallback.userInitiated }
  state.pendingPrereleaseFallback.fallbackResultHandled = true
  internal.clearPrereleaseFallbackContextIfSettled()
  return result
}

export function suppressMissingManifestPrereleaseFallbackPromiseFailure(message: string): void {
  if (
    !state.pendingPrereleaseFallback?.retryLaunched ||
    state.pendingPrereleaseFallback.fallbackResultHandled
  ) {
    return
  }
  state.pendingPrereleaseFallback.suppressedFallbackPromiseFailureKey = internal.getCheckFailureKey(
    message,
    state.pendingPrereleaseFallback.userInitiated
  )
}

export function shouldSuppressMissingManifestPrereleaseFallbackEvent(
  message: string,
  error: unknown
): boolean {
  if (!state.pendingPrereleaseFallback?.retryLaunched) {
    return false
  }
  const failureKey = internal.getCheckFailureKey(message, state.pendingPrereleaseFallback.userInitiated)
  const primaryEventSuppression = state.pendingPrereleaseFallback.suppressedPrimaryEventFailure
  if (primaryEventSuppression?.failureKey === failureKey) {
    const isPrimaryPromisePair = primaryEventSuppression.error === error
    // Why: after fallback checking starts, same-message errors may be the fallback's, so message matching alone isn't safe.
    if (isPrimaryPromisePair || !state.pendingPrereleaseFallback.fallbackCheckingForUpdateSeen) {
      state.pendingPrereleaseFallback.suppressedPrimaryEventFailure = null
      internal.clearPrereleaseFallbackContextIfSettled()
      return true
    }
  }
  if (state.pendingPrereleaseFallback.suppressedFallbackEventFailureKey === failureKey) {
    state.pendingPrereleaseFallback.suppressedFallbackEventFailureKey = null
    internal.clearPrereleaseFallbackContextIfSettled()
    return true
  }
  return false
}

export function markMissingManifestPrereleaseFallbackPromiseHandled(message: string): void {
  if (
    !state.pendingPrereleaseFallback?.retryLaunched ||
    state.pendingPrereleaseFallback.fallbackResultHandled
  ) {
    return
  }
  state.pendingPrereleaseFallback.suppressedFallbackEventFailureKey = internal.getCheckFailureKey(
    message,
    state.pendingPrereleaseFallback.userInitiated
  )
}

export async function pinDefaultReleaseFeed(
  variant: UpdateCheckVariant = 'default'
): Promise<ReleaseFeedPreflightResult> {
  const autoUpdater = internal.getAutoUpdater()
  // Why: the latest/download redirect can move between check and download, so pin the concrete tag (prerelease users resolve any channel, stable only stable).
  const currentVersion = app.getVersion()
  const isPerfCheck = variant === 'perf'
  const includePrerelease =
    isPerfCheck || state.includePrereleaseActive || isPrereleaseVersion(currentVersion)
  const releaseTagsResult = await fetchNewerReleaseTagsWithReadiness(
    currentVersion,
    includePrerelease ? 2 : 1,
    {
      includePrerelease,
      ...(isPerfCheck ? { releaseFilter: 'perf' as const } : {})
    }
  )
  const newerTag = releaseTagsResult.tags[0] ?? null
  const fallbackTag = includePrerelease ? (releaseTagsResult.tags[1] ?? null) : null
  state.pendingPrereleaseFallback =
    includePrerelease && newerTag && fallbackTag
      ? {
          primaryTag: newerTag,
          fallbackTag,
          userInitiated: false,
          suppressedPrimaryPromiseFailureKey: null,
          suppressedPrimaryEventFailure: null,
          suppressedFallbackPromiseFailureKey: null,
          suppressedFallbackEventFailureKey: null,
          fallbackResultHandled: false,
          fallbackCheckingForUpdateSeen: false,
          retryLaunched: false
        }
      : null
  // Why: console.info is captured by Console.app/--enable-logging — our only field visibility into the updater.
  if (newerTag) {
    internal.clearPublishingWindowLastGoodCheck()
    const url = getReleaseDownloadUrl(newerTag)
    console.info(
      `[updater] release feed pinned: current=${currentVersion} includePrerelease=${includePrerelease} → ${url}`
    )
    autoUpdater.setFeedURL({ provider: 'generic', url })
    return 'ready'
  } else if (releaseTagsResult.state === 'not-ready') {
    internal.clearPrereleaseFallbackContext()
    if (releaseTagsResult.lastGoodTag) {
      // Why: during a publish window the newest tag is unsafe; a verified last-good concrete feed lets electron-updater emit a real result.
      const url = getReleaseDownloadUrl(releaseTagsResult.lastGoodTag)
      console.info(
        `[updater] release feed pinned to last-good: current=${currentVersion} includePrerelease=${includePrerelease} → ${url}`
      )
      state.publishingWindowLastGoodCheck = { lastGoodTag: releaseTagsResult.lastGoodTag }
      autoUpdater.setFeedURL({ provider: 'generic', url })
      return 'ready'
    }
    internal.clearPublishingWindowLastGoodCheck()
    console.info(
      `[updater] release feed deferred: current=${currentVersion} includePrerelease=${includePrerelease}; newest release assets are not ready`
    )
    throw new ReleaseFeedPreflightError(
      'release-not-ready',
      isPerfCheck ? 'perf' : includePrerelease ? 'prerelease' : 'default',
      'Latest release artifacts are not ready'
    )
  } else if (
    releaseTagsResult.state === 'unavailable' &&
    releaseTagsResult.unavailableReason === 'manifest' &&
    !includePrerelease
  ) {
    internal.clearPrereleaseFallbackContext()
    internal.clearPublishingWindowLastGoodCheck()
    throw new ReleaseFeedPreflightError(
      'manifest-unavailable',
      'default',
      'Unable to find latest version on GitHub'
    )
  } else if (isPerfCheck) {
    internal.clearPrereleaseFallbackContext()
    internal.clearPublishingWindowLastGoodCheck()
    if (releaseTagsResult.state === 'no-newer') {
      console.info(
        `[updater] perf release not found: current=${currentVersion} includePrerelease=${includePrerelease}`
      )
      return 'not-available'
    }
    throw new Error('Could not resolve perf update feed')
  } else {
    internal.clearPrereleaseFallbackContext()
    internal.clearPublishingWindowLastGoodCheck()
    const url = 'https://github.com/stablyai/orca/releases/latest/download'
    console.info(
      `[updater] release feed fallback: current=${currentVersion} includePrerelease=${includePrerelease} → ${url}`
    )
    autoUpdater.setFeedURL({ provider: 'generic', url })
    return 'ready'
  }
}

export function retryPrereleaseFallbackAfterMissingManifest(
  message: string,
  userInitiated: boolean | undefined,
  source: CheckFailureSource,
  failureKey: string,
  sourceError?: unknown
): boolean {
  if (
    !state.pendingPrereleaseFallback ||
    state.pendingPrereleaseFallback.retryLaunched ||
    !isMissingUpdateManifestFailure(message)
  ) {
    return false
  }
  const attemptId = state.activeUpdateCheckAttemptId
  if (attemptId === null) {
    return false
  }

  // Why: a published tag can briefly lack its platform manifest mid-release; walk back once to the previous feed for a normal not-available result.
  state.pendingPrereleaseFallback.retryLaunched = true
  state.pendingPrereleaseFallback.userInitiated = Boolean(userInitiated)
  state.pendingPrereleaseFallback.suppressedPrimaryPromiseFailureKey =
    source === 'event' ? failureKey : null
  state.pendingPrereleaseFallback.suppressedPrimaryEventFailure =
    source === 'promise' ? { failureKey, error: sourceError } : null
  state.pendingPrereleaseFallback.fallbackCheckingForUpdateSeen = false
  const { primaryTag, fallbackTag } = state.pendingPrereleaseFallback
  const url = getReleaseDownloadUrl(fallbackTag)
  console.info(
    `[updater] prerelease manifest missing for ${primaryTag}; retrying once against ${url}`
  )
  const autoUpdater = internal.getAutoUpdater()
  autoUpdater.setFeedURL({ provider: 'generic', url })
  state.userInitiatedCheck = Boolean(userInitiated)
  state.backgroundCheckLaunchPending = !userInitiated
  internal.armUpdateCheckStallTimer(attemptId)
  internal.markUpdateCheckLaunched(attemptId)
  void autoUpdater
    .checkForUpdates()
    .then(() => internal.handleSettledUpdateCheckPromise(attemptId))
    .catch((err) => {
      if (!internal.isActiveUpdateCheckAttempt(attemptId)) {
        return
      }
      const message = String(err?.message ?? err)
      if (userInitiated) {
        state.userInitiatedCheck = false
      } else {
        state.backgroundCheckLaunchPending = false
      }
      internal.markMissingManifestPrereleaseFallbackPromiseHandled(message)
      internal.consumeMissingManifestPrereleaseFallbackResult()
      void internal.sendCheckFailureStatus(message, userInitiated, 'fallback-promise', err)
    })
  return true
}

/** Returns false when the check was deferred instead of launched, so timer-driven callers can re-arm. */
export function runBackgroundUpdateCheck(
  nudgeId: string | null = internal.getPersistedPendingUpdateNudgeId()
): boolean {
  // Why: a pinned dev jump owns the feed until it settles; a background check
  // would repoint it mid-flight and download the wrong build.
  if (
    state.activeUpdateSource !== 'release' ||
    state.isPinnedBuildActive ||
    state.localBuildSelectionInProgress ||
    state.pinnedBuildSelectionInProgress
  ) {
    return false
  }
  if (state.backgroundCheckLaunchPending || state.currentStatus.state === 'checking') {
    return false
  }
  if (!app.isPackaged || is.dev) {
    internal.sendStatus({ state: 'not-available' })
    return false
  }
  // Why: set the nudge marker before any events arrive so later checks can't inherit a stale campaign id; persisted id keeps a nudge card dismissable after relaunch.
  state.activeUpdateNudgeId = nudgeId
  // Why: 'checking-for-update' arrives a tick later, so a second focus/resume can slip in before status flips; track launch in memory to dedupe that gap.
  state.backgroundCheckLaunchPending = true
  state.backgroundCheckPromotedToUserInitiated = false
  const attemptId = internal.beginUpdateCheckAttempt()
  // Don't send 'checking' here — the 'checking-for-update' handler does; sending from both dupes notifications (issue #35).
  const autoUpdater = internal.getAutoUpdater()
  const launch = (): Promise<unknown> | undefined => {
    if (!internal.isActiveUpdateCheckAttempt(attemptId)) {
      return undefined
    }
    internal.markUpdateCheckLaunched(attemptId)
    return autoUpdater.checkForUpdates()
  }
  const run = internal.pinDefaultReleaseFeed().then(launch)
  void Promise.resolve(run)
    .then(() => internal.handleSettledUpdateCheckPromise(attemptId))
    .catch((err) => {
      if (!internal.isActiveUpdateCheckAttempt(attemptId)) {
        return
      }
      const wasUserInitiated = internal.getSettledCheckUserInitiated()
      state.backgroundCheckLaunchPending = false
      state.backgroundCheckPromotedToUserInitiated = false
      if (wasUserInitiated) {
        state.userInitiatedCheck = false
      }
      void internal.sendCheckFailureStatus(String(err?.message ?? err), wasUserInitiated, 'promise', err)
    })
  return true
}

export function checkForUpdates(): void {
  // Why: span records only check launch (always Success), not outcome; dashboards must filter `updater.outcome === 'launched'`, not this span's success rate.
  void withUpdaterSpan({ stage: 'check' }, async (span) => {
    span.setAttribute('updater.outcome', 'launched')
    internal.runBackgroundUpdateCheck()
  })
}

export function enablePrereleaseManifestChecks(): void {
  internal.getAutoUpdater().allowPrerelease = true
}

export function enableIncludePrerelease(): void {
  if (state.includePrereleaseActive) {
    return
  }
  // Why: this flag makes electron-updater accept prerelease manifests; we keep the manifest-probed generic feed over the native GitHub provider because cancelled RCs can appear without assets.
  internal.enablePrereleaseManifestChecks()
  state.includePrereleaseActive = true
}

/** Menu-triggered check — delegates feedback to renderer toasts via userInitiated flag */
