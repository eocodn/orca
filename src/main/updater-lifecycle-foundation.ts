export type CheckFailureSource = 'event' | 'promise' | 'fallback-promise'
export type MissingManifestPrereleaseFallbackResult = { userInitiated: boolean }
export type PrimaryEventSuppression = { failureKey: string; error: unknown }
export type UpdateCheckVariant = 'default' | 'prerelease' | 'perf'
export type ReleaseFeedPreflightFailure = 'manifest-unavailable' | 'release-not-ready'
export type ReleaseFeedPreflightResult = 'ready' | 'not-available'
export type UpdateInstallMode =
  | 'interactive'
  | 'supervised-headless-serve'
  | 'unsupported-headless-serve'

export class ReleaseFeedPreflightError extends Error {
  constructor(
    readonly reason: ReleaseFeedPreflightFailure,
    readonly releaseChannel: UpdateCheckVariant,
    message: string
  ) {
    super(message)
    this.name = 'ReleaseFeedPreflightError'
  }
}

export const AUTO_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
export const AUTO_UPDATE_RETRY_INTERVAL_MS = 60 * 60 * 1000
export const MAX_AUTO_UPDATE_RETRY_INTERVAL_MS = 6 * 60 * 60 * 1000
export const NUDGE_POLL_INTERVAL_MS = 30 * 60 * 1000
export const NUDGE_ACTIVATION_COOLDOWN_MS = 5 * 60 * 1000
export const QUIT_AND_INSTALL_DELAY_MS = 100
export const PRE_QUIT_CLEANUP_TIMEOUT_MS = 2_500
export const UPDATE_CHECK_SILENT_SETTLE_DELAY_MS = 1_000
export const UPDATE_CHECK_STALL_TIMEOUT_MS = 45_000
