import { useId, useState } from 'react'
import type { ChangelogData } from '../../../shared/types'
import { Button } from './ui/button'
import { Progress } from './ui/progress'
import { AlertCircle, ChevronRight, Loader2, Minus, Network, RotateCw, ShieldAlert, X } from 'lucide-react'
import { translate } from '@/i18n/i18n'

function releaseUrlForVersion(version: string | null): string {
  return version
    ? `https://github.com/stablyai/orca/releases/tag/v${version}`
    : 'https://github.com/stablyai/orca/releases'
}

function isAnimatedGif(url: string | undefined): boolean {
  return typeof url === 'string' && url.toLowerCase().endsWith('.gif')
}

// ── Rich card content ────────────────────────────────────────────────

export function RichCardContent({
  release,
  releasesBehind,
  prefersReducedMotion,
  mediaFailed,
  mediaLoaded,
  onMediaError,
  onMediaLoad,
  onUpdate,
  onClose
}: {
  release: NonNullable<ChangelogData['release']>
  releasesBehind: number | null
  prefersReducedMotion: boolean
  mediaFailed: boolean
  mediaLoaded: boolean
  onMediaError: () => void
  onMediaLoad: () => void
  onUpdate: () => void
  onClose: () => void
}) {
  const showMedia =
    release.mediaUrl &&
    !mediaFailed &&
    // Why: GIFs can't be reliably paused cross-browser, so hide them entirely under reduced-motion.
    !(prefersReducedMotion && isAnimatedGif(release.mediaUrl))

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {translate('auto.components.UpdateCard.f58b5c57a6', 'New:')} {release.title}
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 min-w-[44px] min-h-[44px] -m-2"
          onClick={onClose}
          aria-label={translate('auto.components.UpdateCard.318d3b4bc7', 'Dismiss update')}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {showMedia && (
        <div className="relative overflow-hidden rounded-md">
          {!mediaLoaded && (
            // Shimmer placeholder while image loads
            <div
              className="w-full bg-muted/50 animate-pulse rounded-md"
              style={{ aspectRatio: '16/9' }}
            />
          )}
          <img
            src={release.mediaUrl}
            alt=""
            className={`w-full rounded-md ${mediaLoaded ? '' : 'absolute inset-0'}`}
            style={!mediaLoaded ? { visibility: 'hidden' } : undefined}
            onError={onMediaError}
            onLoad={onMediaLoad}
          />
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {release.description}
        {releasesBehind !== null && releasesBehind > 1 && (
          <>
            {' '}
            <button
              className="text-xs text-muted-foreground/70 underline hover:text-foreground inline"
              onClick={() => void window.api.shell.openUrl(release.releaseNotesUrl)}
            >
              +{releasesBehind - 1}{' '}
              {translate('auto.components.UpdateCard.ccd8b0a793', 'more since your last update')}
            </button>
          </>
        )}
      </p>

      <button
        className="text-xs text-muted-foreground underline hover:text-foreground self-start"
        onClick={() => void window.api.shell.openUrl(release.releaseNotesUrl)}
      >
        {translate('auto.components.UpdateCard.aad383aecc', 'Read the full release notes')}
      </button>

      <Button variant="default" size="sm" onClick={onUpdate} className="w-full cursor-pointer">
        {translate('auto.components.UpdateCard.ec8fe71cfc', 'Update')}
      </Button>
    </div>
  )
}

// ── Simple card content ──────────────────────────────────────────────

export function SimpleCardContent({
  version,
  releaseUrl,
  onUpdate,
  onClose
}: {
  version: string
  releaseUrl?: string
  onUpdate: () => void
  onClose: () => void
}) {
  return (
    <div className="flex flex-col gap-2.5 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {translate('auto.components.UpdateCard.9abc59f814', 'Update Available')}
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 min-w-[44px] min-h-[44px] -m-2"
          onClick={onClose}
          aria-label={translate('auto.components.UpdateCard.318d3b4bc7', 'Dismiss update')}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        {translate('auto.components.UpdateCard.05ad78a6d1', 'Orca v{{value0}} is ready.', {
          value0: version
        })}
      </p>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {translate('auto.components.UpdateCard.fdd4a364fa', "Sessions won't be interrupted.")}
      </p>

      {releaseUrl && (
        <button
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground self-start"
          onClick={() => void window.api.shell.openUrl(releaseUrl)}
        >
          {translate('auto.components.UpdateCard.44324ef542', 'Release notes')}
        </button>
      )}

      <Button
        variant="default"
        size="sm"
        onClick={onUpdate}
        className="mt-0.5 w-full cursor-pointer"
      >
        {translate('auto.components.UpdateCard.ec8fe71cfc', 'Update')}
      </Button>
    </div>
  )
}

// ── Downloading content ──────────────────────────────────────────────

export function DownloadingContent({
  version,
  percent,
  changelog,
  prefersReducedMotion,
  mediaFailed,
  mediaLoaded,
  onMediaError,
  onMediaLoad,
  onCollapse,
  showReleaseNotes
}: {
  version: string
  percent: number
  changelog: ChangelogData | null
  prefersReducedMotion: boolean
  mediaFailed: boolean
  mediaLoaded: boolean
  onMediaError: () => void
  onMediaLoad: () => void
  onCollapse: () => void
  showReleaseNotes: boolean
}) {
  const release = changelog?.release
  const showMedia =
    release?.mediaUrl && !mediaFailed && !(prefersReducedMotion && isAnimatedGif(release.mediaUrl))

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        {release ? (
          <h3 className="text-sm font-semibold">
            {translate('auto.components.UpdateCard.f58b5c57a6', 'New:')} {release.title}
          </h3>
        ) : (
          <h3 className="text-sm font-semibold">
            {translate('auto.components.UpdateCard.558842597d', 'Downloading Update')}
          </h3>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 min-w-[44px] min-h-[44px] -m-2"
          onClick={onCollapse}
          aria-label={translate('auto.components.UpdateCard.8acbdd3961', 'Minimize to status bar')}
        >
          <Minus className="size-3.5" />
        </Button>
      </div>

      {showMedia && release?.mediaUrl && (
        <div className="relative overflow-hidden rounded-md">
          {!mediaLoaded && (
            <div
              className="w-full bg-muted/50 animate-pulse rounded-md"
              style={{ aspectRatio: '16/9' }}
            />
          )}
          <img
            src={release.mediaUrl}
            alt=""
            className={`w-full rounded-md ${mediaLoaded ? '' : 'absolute inset-0'}`}
            style={!mediaLoaded ? { visibility: 'hidden' } : undefined}
            onError={onMediaError}
            onLoad={onMediaLoad}
          />
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {release
          ? release.description
          : translate('auto.components.UpdateCard.93794ea932', 'Orca v{{value0}} is downloading.', {
              value0: version
            })}
      </p>

      {showReleaseNotes && (
        <button
          className="text-xs text-muted-foreground underline hover:text-foreground self-start"
          onClick={() =>
            void window.api.shell.openUrl(
              release ? release.releaseNotesUrl : releaseUrlForVersion(version)
            )
          }
        >
          {release
            ? translate('auto.components.UpdateCard.aad383aecc', 'Read the full release notes')
            : translate('auto.components.UpdateCard.44324ef542', 'Release notes')}
        </button>
      )}

      <div className="flex flex-col gap-2 mt-1">
        <Progress value={percent} className="h-1.5" />
        <p className="text-xs text-muted-foreground">
          {translate('auto.components.UpdateCard.6e45bfa2e0', 'Downloading...')} {percent}%
        </p>
      </div>
    </div>
  )
}

// ── Error card content ───────────────────────────────────────────────

export function ErrorCardContent({
  variant = 'default',
  title,
  summary,
  explainer,
  detail,
  releaseUrl,
  manualLabel,
  primaryAction,
  onClose
}: {
  variant?: 'default' | 'http1Compatibility' | 'security'
  title: string
  summary: string
  explainer?: string
  detail?: string
  releaseUrl?: string
  manualLabel?: string
  primaryAction?: {
    label: string
    pendingLabel?: string
    isPending?: boolean
    onClick: () => void
  }
  onClose: () => void
}) {
  // Why: raw error starts collapsed so the card leads with the plain summary, not a stack dump.
  const [showDetails, setShowDetails] = useState(false)
  const detailId = useId()
  const isCompatibility = variant === 'http1Compatibility'
  const isSecurity = variant === 'security'
  const Icon = isCompatibility ? Network : isSecurity ? ShieldAlert : AlertCircle
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/50 ${
            isSecurity
              ? 'border-destructive/30 text-destructive'
              : 'border-border text-muted-foreground'
          }`}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{summary}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 min-w-[44px] min-h-[44px] -m-2"
          onClick={onClose}
          aria-label={translate('auto.components.UpdateCard.8acbdd3961', 'Minimize to status bar')}
        >
          <Minus className="size-3.5" />
        </Button>
      </div>

      {explainer ? (
        <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2">
          <p className="text-xs leading-relaxed text-muted-foreground">{explainer}</p>
        </div>
      ) : null}

      {/* Caret disclosure that reveals the raw error while the plain summary stays the lead. */}
      {detail ? (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="-ml-2 self-start text-muted-foreground hover:text-foreground"
            onClick={() => setShowDetails((prev) => !prev)}
            aria-expanded={showDetails}
            aria-controls={detailId}
          >
            <ChevronRight
              className={`size-3.5 transition-transform motion-reduce:transition-none ${showDetails ? 'rotate-90' : ''}`}
            />
            {showDetails
              ? translate('auto.components.UpdateCard.5194358929', 'Hide details')
              : translate('auto.components.UpdateCard.8bc9e17d8f', 'Show details')}
          </Button>
          {showDetails ? (
            <div id={detailId} className="rounded-md bg-muted/40 px-3 py-2">
              <p className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">
                {translate('auto.components.UpdateCard.3553a8672f', 'Last error')}
              </p>
              <p className="scrollbar-sleek max-h-20 overflow-auto break-words font-mono text-xs leading-relaxed text-muted-foreground">
                {detail}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-2">
        {primaryAction && (
          <Button
            variant="default"
            size="sm"
            onClick={primaryAction.onClick}
            disabled={primaryAction.isPending}
            className="flex-1 gap-1.5"
          >
            {primaryAction.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : isCompatibility ? (
              <RotateCw className="size-3.5" />
            ) : null}
            {primaryAction.isPending && primaryAction.pendingLabel
              ? primaryAction.pendingLabel
              : primaryAction.label}
          </Button>
        )}
        {releaseUrl && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void window.api.shell.openUrl(releaseUrl)}
            className="flex-1"
          >
            {manualLabel ?? translate('auto.components.UpdateCard.47126bcf57', 'Download Manually')}
          </Button>
        )}
      </div>
    </div>
  )
}

// ── Ready to install content ─────────────────────────────────────────

export function ReadyToInstallContent({
  version,
  onRestart,
  onClose
}: {
  version: string
  onRestart: () => void
  onClose: () => void
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {translate('auto.components.UpdateCard.17412483da', 'Ready to Install')}
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 min-w-[44px] min-h-[44px] -m-2"
          onClick={onClose}
          aria-label={translate('auto.components.UpdateCard.8acbdd3961', 'Minimize to status bar')}
        >
          <Minus className="size-3.5" />
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        {translate(
          'auto.components.UpdateCard.6714206e5a',
          "Orca v{{value0}} is downloaded. Restart when you're ready.",
          { value0: version }
        )}
      </p>

      <Button variant="default" size="sm" onClick={onRestart} className="w-full">
        {translate('auto.components.UpdateCard.68b235d264', 'Restart to Update')}
      </Button>
    </div>
  )
}

