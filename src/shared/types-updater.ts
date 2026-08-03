import type { ReleaseBuild, ReleaseChannel } from './release-channel'

// ─── Updater ─────────────────────────────────────────────────────────

// Why: the release object sent to the renderer omits `version` (redundant
// with the top-level UpdateStatus.version) to keep one source of truth.
export type ChangelogRelease = {
  title: string
  description: string
  mediaUrl?: string
  releaseNotesUrl: string
}

export type ChangelogData = {
  release: ChangelogRelease
  releasesBehind: number | null
}

export type UpdateCheckOptions = {
  includePrerelease?: boolean
  includePerfPrerelease?: boolean
  localBuild?: boolean
  /** Dev channel switching; `targetTag` pins an exact build, including older ones. */
  channel?: ReleaseChannel
  targetTag?: string
}

export type UpdateSource = 'local' | 'hourly'

export type UpdateStatus = (
  | { state: 'idle' }
  | { state: 'checking'; userInitiated?: boolean }
  | {
      state: 'available'
      version: string
      activeNudgeId?: string
      // Why: releaseUrl is not currently populated by the update-available handler
      // (it always sends undefined). Kept on the type for the Settings page's
      // release-notes link fallback and for potential future use if the main
      // process starts extracting release URLs from electron-updater metadata.
      releaseUrl?: string
      // Why: changelog is always explicitly set by the main process — null means
      // the fetch failed or the version wasn't in the JSON (simple mode), and a
      // populated object means rich mode. Using `| null` (not `?`) avoids a
      // three-state ambiguity (undefined vs null vs present) and makes exhaustive
      // checks straightforward.
      changelog: ChangelogData | null
    }
  | { state: 'not-available'; userInitiated?: boolean }
  | { state: 'downloading'; percent: number; version: string; activeNudgeId?: string }
  | { state: 'downloaded'; version: string; releaseUrl?: string; activeNudgeId?: string }
  | { state: 'error'; message: string; userInitiated?: boolean; activeNudgeId?: string }
) & { source?: UpdateSource }

export type ReleaseBuildListResult =
  | { ok: true; channel: ReleaseChannel; builds: ReleaseBuild[] }
  | { ok: false; channel: ReleaseChannel; message: string }
