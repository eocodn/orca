import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { useAppStore } from '../store'
import { Card } from './ui/card'
import { Button } from './ui/button'
import { Progress } from './ui/progress'
import { ChevronRight, Minus, Network, RotateCw, ShieldAlert, X } from 'lucide-react'
import type { ChangelogData } from '../../../shared/types'
import {
  isWindowsSignatureCheckUnavailableFailure,
  isWindowsSignatureMismatchFailure
} from '../../../shared/updater-windows-signature-check'
import { translate } from '@/i18n/i18n'
import {
  DownloadingContent,
  ErrorCardContent,
  ReadyToInstallContent,
  RichCardContent,
  SimpleCardContent
} from './update-card-content'
import { UpdateCardCompactContent } from './update-card-compact-content'

import { isAnimatedGif, isHttp2ProtocolError, releaseUrlForVersion, type ErrorCardModel } from './update-card-model'
// ── Main component ──────────────────────────────────────────────────

export function UpdateCard() {
  const status = useAppStore((s) => s.updateStatus)
  const storeChangelog = useAppStore((s) => s.updateChangelog)
  const updateUserInitiatedCycle = useAppStore((s) => s.updateUserInitiatedCycle)
  const dismissedVersion = useAppStore((s) => s.dismissedUpdateVersion)
  const dismissUpdate = useAppStore((s) => s.dismissUpdate)
  const collapsed = useAppStore((s) => s.updateCardCollapsed)
  const setCollapsed = useAppStore((s) => s.setUpdateCardCollapsed)
  const reassuranceSeen = useAppStore((s) => s.updateReassuranceSeen)
  const markReassuranceSeen = useAppStore((s) => s.markUpdateReassuranceSeen)
  const hasStartedDownload = useRef(false)
  const dismissAnimationTimerRef = useRef<number | null>(null)
  const collapseAnimationTimerRef = useRef<number | null>(null)
  const [mediaFailed, setMediaFailed] = useState(false)
  const [mediaLoaded, setMediaLoaded] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const [compatibilityRelaunching, setCompatibilityRelaunching] = useState(false)
  const [compatibilitySetupError, setCompatibilitySetupError] = useState<string | null>(null)
  // Why: the dismiss gate keeps error cards visible, so a separate local flag tracks the error card's own X close.
  const [errorDismissed, setErrorDismissed] = useState(false)
  // Why: local flag (not store) for the transient "up to date" auto-dismiss — no other component needs it.
  const [autoDismissed, setAutoDismissed] = useState(false)
  // Tracks card exit so the fade-out animation plays before unmount.
  const [exiting, setExiting] = useState(false)
  const changelog: ChangelogData | null = storeChangelog
  const isLocalBuild = status.source === 'local'

  // Why: the 'error' variant carries no version, but the card needs it for the fallback URL and dismiss; cache from states that have it.
  const versionRef = useRef<string | null>(null)
  if ('version' in status && status.version) {
    versionRef.current = status.version
  } else if (
    status.state === 'checking' ||
    status.state === 'idle' ||
    status.state === 'not-available'
  ) {
    // Why: clear the cached version so a later check failure can't link/dismiss against an unrelated older release.
    versionRef.current = null
  }

  // Why: reset component-local state on a new version so stale flags (media load, hasStartedDownload) don't leak forward.
  const prevVersionRef = useRef<string | null>(null)
  if (status.state === 'available' && status.version !== prevVersionRef.current) {
    prevVersionRef.current = status.version
    hasStartedDownload.current = false
    setMediaFailed(false)
    setMediaLoaded(false)
    setInstallError(null)
  }

  // Why: reset per-cycle flags when a new status arrives so the card shows again next check cycle.
  const prevStateRef = useRef(status.state)
  if (status.state !== prevStateRef.current) {
    prevStateRef.current = status.state
    if (autoDismissed) {
      setAutoDismissed(false)
    }
    if (exiting) {
      setExiting(false)
    }
    if (errorDismissed) {
      setErrorDismissed(false)
    }
  }

  const shouldAutoDismissLatest =
    status.state === 'not-available' && 'userInitiated' in status && Boolean(status.userInitiated)

  // Auto-dismiss "You're on the latest version" after 3s; timer resets if status changes first.
  useEffect(() => {
    if (!shouldAutoDismissLatest) {
      return
    }
    const timer = setTimeout(() => setAutoDismissed(true), 3000)
    return () => clearTimeout(timer)
  }, [shouldAutoDismissLatest])

  // Why: quitAndInstall must run in an effect, not render — StrictMode's double render would fire it twice.
  // Gated on hasStartedDownload so Settings-initiated downloads don't auto-restart (user expects "Restart" there).
  useEffect(() => {
    if (status.state === 'downloaded' && hasStartedDownload.current) {
      void window.api.updater.quitAndInstall().catch((error) => {
        setInstallError(String((error as Error)?.message ?? error))
      })
    }
  }, [status.state])

  // ── Prefers-reduced-motion ──────────────────────────────────────────
  const prefersReducedMotion = usePrefersReducedMotion()

  const clearAnimationTimers = useCallback(() => {
    if (dismissAnimationTimerRef.current !== null) {
      window.clearTimeout(dismissAnimationTimerRef.current)
      dismissAnimationTimerRef.current = null
    }
    if (collapseAnimationTimerRef.current !== null) {
      window.clearTimeout(collapseAnimationTimerRef.current)
      collapseAnimationTimerRef.current = null
    }
  }, [])

  const cardRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node !== null) {
        return
      }
      // Why: cancel exit timers when the card surface unmounts so stale callbacks don't fire.
      clearAnimationTimers()
    },
    [clearAnimationTimers]
  )

  // ── Visibility gates ──────────────────────────────────────────────

  const isUserInitiated = 'userInitiated' in status && status.userInitiated
  const cachedVersion = versionRef.current
  const shouldShowDetailedErrorCard =
    status.state === 'error' && (hasStartedDownload.current || cachedVersion !== null)

  // Compact transient states: only show for user-initiated checks.
  if (status.state === 'checking' && !isUserInitiated) {
    return null
  }
  if (status.state === 'not-available' && !isUserInitiated) {
    return null
  }
  if (status.state === 'not-available' && autoDismissed) {
    return null
  }

  // Background states that never show the card.
  if (status.state === 'idle') {
    return null
  }

  // Error: show for user-initiated failures or failures tied to a cached version; background failures stay silent.
  if (status.state === 'error' && !shouldShowDetailedErrorCard && !isUserInitiated) {
    return null
  }

  // Why: the dismiss gate below keeps error cards visible, so an explicit X on the error card needs this gate to hide it.
  if (status.state === 'error' && errorDismissed) {
    return null
  }

  // Dismiss gate: hide previously-dismissed versions for passive states, keep in-progress/error visible, and bypass for user-initiated checks.
  if (versionRef.current && dismissedVersion === versionRef.current && !updateUserInitiatedCycle) {
    if (status.state !== 'downloading' && status.state !== 'error') {
      return null
    }
  }

  if (
    collapsed &&
    (status.state === 'downloading' || status.state === 'downloaded' || status.state === 'error')
  ) {
    return null
  }

  // ── Shared helpers ────────────────────────────────────────────────

  const isRichMode = changelog?.release != null

  const handleUpdate = () => {
    hasStartedDownload.current = true
    // Why: clicking Update implies the user isn't worried about interruption, so retire the reassurance tip.
    if (!reassuranceSeen) {
      markReassuranceSeen()
    }
    void window.api.updater.download()
  }

  // Why: the 'error' variant has no version field, so dismiss needs an explicit version override.
  const handleClose = () => {
    // Why: dismissUpdate clears the store manual-check bypass so the dismiss gate re-engages after closing.
    if (status.state === 'error') {
      setErrorDismissed(true)
      if (cachedVersion) {
        dismissUpdate(cachedVersion)
      }
      return
    }
    dismissUpdate()
  }

  const handleInstallRetry = () => {
    void window.api.updater.quitAndInstall().catch((error) => {
      setInstallError(String((error as Error)?.message ?? error))
    })
  }

  const handleEnableHttp1Compatibility = () => {
    setCompatibilityRelaunching(true)
    setCompatibilitySetupError(null)
    void window.api.settings
      .set({ electronHttp1CompatibilityMode: true })
      .then(() => window.api.app.relaunch())
      .catch((error) => {
        const message = String((error as Error)?.message ?? error)
        console.error('[updates] failed to enable HTTP/1.1 compatibility:', error)
        setCompatibilitySetupError(`Could not enable compatibility mode. ${message}`)
        setCompatibilityRelaunching(false)
      })
  }

  // Why: order matters — the wrong-publisher security-stop must beat the "check couldn't run" case so integrity failures aren't softened to "try again".
  const isHttp2UpdateError = status.state === 'error' && isHttp2ProtocolError(status.message)
  const isSignatureMismatchError =
    status.state === 'error' && isWindowsSignatureMismatchFailure(status.message)
  const isSignatureCheckBlockedError =
    status.state === 'error' && isWindowsSignatureCheckUnavailableFailure(status.message)
  const errorCard: ErrorCardModel | null =
    status.state === 'error'
      ? isLocalBuild
        ? {
            title: cachedVersion
              ? translate('auto.components.UpdateCard.8cf17b10af', 'Local Build Error')
              : translate('auto.components.UpdateCard.a4650b0dc4', 'Could Not Use Local Build'),
            summary: cachedVersion
              ? translate(
                  'auto.components.UpdateCard.b1e390250d',
                  'Could not complete the local build switch.'
                )
              : translate(
                  'auto.components.UpdateCard.d29740d175',
                  'The selected build could not be used.'
                ),
            detail: status.message,
            primaryAction: {
              label: translate('auto.components.UpdateCard.37d45c9ec1', 'Choose Another Build'),
              onClick: () => {
                void window.api.updater.check({ localBuild: true })
              }
            }
          }
        : isHttp2UpdateError
          ? {
              variant: 'http1Compatibility',
              title: translate('auto.components.UpdateCard.1339b82cee', 'HTTP/2 Download Blocked'),
              summary: 'Orca can retry through HTTP/1.1 compatibility mode.',
              explainer: translate(
                'auto.components.UpdateCard.90559b14e3',
                'This turns on a process-wide Electron networking switch after restart. Use it for corporate VPNs or proxies that reject HTTP/2 update downloads.'
              ),
              detail: compatibilitySetupError ?? status.message,
              releaseUrl: releaseUrlForVersion(cachedVersion),
              primaryAction: {
                label: translate('auto.components.UpdateCard.933c6fdf5b', 'Enable & Restart'),
                pendingLabel: 'Restarting...',
                isPending: compatibilityRelaunching,
                onClick: handleEnableHttp1Compatibility
              }
            }
          : isSignatureMismatchError
            ? {
                // Security stop: installer signed by the wrong publisher — no retry, only a verified-download path.
                variant: 'security',
                title: translate(
                  'auto.components.UpdateCard.5b309b19f3',
                  "Update Wasn't Installed"
                ),
                summary: translate(
                  'auto.components.UpdateCard.092f09fc14',
                  "The installer's publisher doesn't match Orca, so we stopped the update. Don't install this download; check official releases for a corrected version."
                ),
                detail: status.message,
                // Why: linking the rejected version would let users bypass the publisher check by re-running it.
                releaseUrl: releaseUrlForVersion(null),
                manualLabel: translate(
                  'auto.components.UpdateCard.c9ff9b9ec2',
                  'Check official releases'
                )
              }
            : isSignatureCheckBlockedError
              ? {
                  title: translate(
                    'auto.components.UpdateCard.e944c2de43',
                    'Update Verification Blocked'
                  ),
                  summary: translate(
                    'auto.components.UpdateCard.a05992a26b',
                    "The signature check couldn't run — usually because antivirus software blocked it. Retry the download, or get the installer from our official releases."
                  ),
                  detail: status.message,
                  releaseUrl: releaseUrlForVersion(cachedVersion),
                  primaryAction: {
                    label: translate('auto.components.UpdateCard.48565a32bc', 'Retry Download'),
                    onClick: handleUpdate
                  }
                }
              : {
                  // Why: title is scoped to the failed operation so check-time (GitHub-side) failures don't read as an Orca bug.
                  title: cachedVersion ? 'Update Error' : 'Update Check Failed',
                  summary: cachedVersion
                    ? 'Could not complete the update.'
                    : 'Could not check for updates.',
                  detail: status.message,
                  releaseUrl: releaseUrlForVersion(cachedVersion),
                  // Why: check-time failures are often transient, so offer a Re-check instead of forcing manual download.
                  primaryAction: cachedVersion
                    ? {
                        label: translate('auto.components.UpdateCard.48565a32bc', 'Retry Download'),
                        onClick: handleUpdate
                      }
                    : {
                        label: translate('auto.components.UpdateCard.6b0085010d', 'Re-check'),
                        onClick: () => {
                          void window.api.updater.check({ includePrerelease: false })
                        }
                      }
                }
      : installError
        ? {
            title: translate('auto.components.UpdateCard.4cf109845a', 'Update Error'),
            summary: 'Could not restart to install the update.',
            detail: installError,
            releaseUrl: releaseUrlForVersion(cachedVersion),
            primaryAction: {
              label: translate('auto.components.UpdateCard.2c2d3e03ca', 'Try Again'),
              onClick: handleInstallRetry
            }
          }
        : null

  const handleDismissWithAnimation = () => {
    if (prefersReducedMotion) {
      handleClose()
      return
    }
    setExiting(true)
    if (dismissAnimationTimerRef.current !== null) {
      window.clearTimeout(dismissAnimationTimerRef.current)
    }
    dismissAnimationTimerRef.current = window.setTimeout(() => {
      dismissAnimationTimerRef.current = null
      handleClose()
    }, 150)
  }

  // Why: dismissing an active download would orphan it, so long-running phases minimize to the status bar.
  const handleCollapseWithAnimation = () => {
    if (prefersReducedMotion) {
      setCollapsed(true)
      return
    }
    setExiting(true)
    if (collapseAnimationTimerRef.current !== null) {
      window.clearTimeout(collapseAnimationTimerRef.current)
    }
    collapseAnimationTimerRef.current = window.setTimeout(() => {
      collapseAnimationTimerRef.current = null
      setCollapsed(true)
      setExiting(false)
    }, 150)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') {
      return
    }
    e.preventDefault()
    if (
      status.state === 'downloading' ||
      status.state === 'downloaded' ||
      status.state === 'error'
    ) {
      handleCollapseWithAnimation()
    } else {
      handleDismissWithAnimation()
    }
  }

  // ── Dynamic aria-label ────────────────────────────────────────────

  const ariaLabel =
    status.state === 'checking'
      ? 'Checking for updates'
      : status.state === 'not-available'
        ? "You're on the latest version"
        : status.state === 'available'
          ? 'Update available'
          : status.state === 'downloading'
            ? 'Downloading update'
            : status.state === 'downloaded'
              ? 'Update ready to install'
              : status.state === 'error'
                ? 'Update error'
                : 'Update status'

  // ── Card wrapper ──────────────────────────────────────────────────

  const animationClass = prefersReducedMotion
    ? ''
    : exiting
      ? 'animate-update-card-exit'
      : 'animate-update-card-enter'

  const cardContent = (() => {
    // ── Compact transient states (user-initiated check feedback) ──────

    if (status.state === 'checking') {
      return (
          <UpdateCardCompactContent
          icon="spinner"
          text={translate('auto.components.UpdateCard.ba5ffc949c', 'Checking for updates...')}
        />
      )
    }

    if (status.state === 'not-available') {
      return (
        <UpdateCardCompactContent
          icon="check"
          text={translate('auto.components.UpdateCard.ea2a41adbe', "You're on the latest version.")}
        />
      )
    }

    // ── Error states ─────────────────────────────────────────────────

    if (errorCard) {
      return (
        <ErrorCardContent
          title={errorCard.title}
          summary={errorCard.summary}
          explainer={errorCard.explainer}
          detail={errorCard.detail}
          releaseUrl={errorCard.releaseUrl}
          manualLabel={errorCard.manualLabel}
          variant={errorCard.variant}
          primaryAction={errorCard.primaryAction}
          onClose={handleCollapseWithAnimation}
        />
      )
    }

    // ── Downloaded state ─────────────────────────────────────────────

    if (status.state === 'downloaded') {
      if (hasStartedDownload.current) {
        return (
          <div className="p-4">
            <p className="text-sm">
              {translate('auto.components.UpdateCard.09a55c39b5', 'Installing...')}
            </p>
          </div>
        )
      }
      // Settings-initiated download — show "Ready to install"
      return (
        <ReadyToInstallContent
          version={status.version}
          onRestart={handleInstallRetry}
          onClose={handleCollapseWithAnimation}
        />
      )
    }

    // ── Downloading state ────────────────────────────────────────────

    if (status.state === 'downloading') {
      return (
        <DownloadingContent
          version={status.version}
          percent={status.percent}
          changelog={changelog}
          prefersReducedMotion={prefersReducedMotion}
          mediaFailed={mediaFailed}
          mediaLoaded={mediaLoaded}
          onMediaError={() => setMediaFailed(true)}
          onMediaLoad={() => setMediaLoaded(true)}
          onCollapse={handleCollapseWithAnimation}
          showReleaseNotes={!isLocalBuild}
        />
      )
    }

    // ── Available state ──────────────────────────────────────────────

    if (status.state !== 'available') {
      return null
    }

    const releaseUrl = isLocalBuild
      ? undefined
      : (('releaseUrl' in status ? status.releaseUrl : undefined) ??
        releaseUrlForVersion(status.version))

    if (isRichMode && changelog) {
      return (
        <RichCardContent
          release={changelog.release}
          releasesBehind={changelog.releasesBehind}
          prefersReducedMotion={prefersReducedMotion}
          mediaFailed={mediaFailed}
          mediaLoaded={mediaLoaded}
          onMediaError={() => setMediaFailed(true)}
          onMediaLoad={() => setMediaLoaded(true)}
          onUpdate={handleUpdate}
          onClose={handleDismissWithAnimation}
        />
      )
    }

    return (
      <SimpleCardContent
        version={status.version}
        releaseUrl={releaseUrl}
        onUpdate={handleUpdate}
        onClose={handleDismissWithAnimation}
      />
    )
  })()

  // One-time reassurance tip that updating won't kill running terminals; persisted once seen.
  const showReassurance =
    !reassuranceSeen && (status.state === 'available' || status.state === 'downloading')

  return (
    <div
      ref={cardRootRef}
      className="fixed bottom-10 right-4 z-40 w-[360px] max-w-[calc(100vw-32px)] flex flex-col gap-2
      max-[480px]:left-4 max-[480px]:right-4 max-[480px]:w-auto"
    >
      {showReassurance && (
        <Card className={`py-0 gap-0 ${animationClass}`}>
          <div className="flex items-center gap-3 p-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.UpdateCard.b1d867f4fb',
                  "Your terminal sessions won't be interrupted during the update."
                )}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={markReassuranceSeen}
              aria-label={translate('auto.components.UpdateCard.7274ef6e59', 'Dismiss tip')}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </Card>
      )}
      <Card
        role="complementary"
        aria-label={ariaLabel}
        aria-live="polite"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`py-0 gap-0 ${animationClass}`}
      >
        {cardContent}
      </Card>
    </div>
  )
}
