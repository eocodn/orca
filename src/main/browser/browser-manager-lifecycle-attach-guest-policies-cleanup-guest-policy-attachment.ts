import { randomUUID } from 'node:crypto'

import { shell, webContents } from 'electron'
import { ORCA_BROWSER_BLANK_URL } from '../../shared/constants'
import {
  normalizeBrowserNavigationUrl,
  normalizeExternalBrowserUrl,
  redactKagiSessionToken,
  toSecureCertificateEndpoint
} from '../../shared/browser-url'
import type {
  BrowserDownloadFinishedEvent,
  BrowserDownloadProgressEvent,
  BrowserDownloadRequestedEvent,
  BrowserPermissionDeniedEvent,
  BrowserPopupEvent
} from '../../shared/browser-guest-events'
import type {
  BrowserGrabCancelReason,
  BrowserGrabPayload,
  BrowserGrabRect,
  BrowserGrabResult,
  BrowserGrabScreenshot
} from '../../shared/browser-grab-types'
import { buildGuestOverlayScript } from './grab-guest-script'
import { clampGrabPayload } from './browser-grab-payload'
import { captureSelectionScreenshot as captureGrabSelectionScreenshot } from './browser-grab-screenshot'
import { BrowserGrabSessionController } from './browser-grab-session-controller'
import { browserDownloadDestinationReservations } from './browser-download-destination'
import {
  resolveRendererWebContents,
  setupGrabShortcutForwarding,
  setupGuestContextMenu,
  setupGuestMouseWheelZoomForwarding,
  setupGuestShortcutForwarding
} from './browser-guest-ui'
import { ANTI_DETECTION_SCRIPT } from './anti-detection'
import { openPopupWithOriginBar, type PopupChildWindowOptions } from './popup-origin-bar-window'
import {
  BROWSER_CLICKED_LINK_ROUTING_WORLD_ID,
  buildBrowserClickedLinkRoutingScript,
  buildBrowserIframeClickedLinkRoutingScript
} from './browser-clicked-link-routing'
import { cleanElectronUserAgent } from './browser-session-ua'
import type {
  BrowserViewportOverride,
  BrowserCertificateFailure,
  BrowserLoadError
} from '../../shared/types'
import {
  type BrowserAnnotationViewportBridgeOptions,
  BROWSER_ANNOTATION_VIEWPORT_BRIDGE_WORLD_ID,
  buildBrowserAnnotationViewportBridgeScript
} from '../../shared/browser-annotation-viewport-bridge'
import type { KeybindingOverrides } from '../../shared/keybindings'
import {
  BrowserCertificateTrustController,
  type ManagedBrowserGuestContext
} from './browser-certificate-trust-controller'

import * as foundation from './browser-manager-lifecycle-foundation'
const { AUTOMATION_VISIBILITY_ACQUIRE_TIMEOUT_MS, SAFE_POPUP_WINDOW_OPTIONS, buildMobileUserAgent, cleanupLateAutomationVisibilityToken, createNoopRestoreForTimedOutAutomationAcquire, extractChromeMajor, isAutomationVisibilityToken, isChromiumInternalErrorUrl, releaseAutomationVisibilityToken, resolveWithTimeout, safeOrigin } = foundation
type ActiveDownload = foundation.ActiveDownload
type BrowserDownloadDoneState = foundation.BrowserDownloadDoneState
type BrowserGuestRegistration = foundation.BrowserGuestRegistration
type PendingPermissionEvent = foundation.PendingPermissionEvent
type PendingPopupEvent = foundation.PendingPopupEvent
type PopupOwnerContext = foundation.PopupOwnerContext

export const BrowserManagerMethods4 = {
  attachGuestPolicies(this: any,
    guest: Electron.WebContents,
    inheritedOwnerContext: PopupOwnerContext | null = null
  ): void {
    if (this.policyAttachedGuestIds.has(guest.id)) {
      return
    }
    this.policyAttachedGuestIds.add(guest.id)
    if (inheritedOwnerContext) {
      this.popupOwnerContextByGuestId.set(guest.id, inheritedOwnerContext)
    }
    // Why: only the primary embedded browser converts new-tab clicks to Orca tabs; OAuth child windows keep native link behavior.
    const clickedLinkFrameName = inheritedOwnerContext
      ? null
      : `__orca_clicked_link_foreground_${randomUUID()}`
    if (clickedLinkFrameName) {
      this.clickedLinkFrameNameByGuestId.set(guest.id, clickedLinkFrameName)
    }
    let clickedLinkRoutingActive = Boolean(clickedLinkFrameName)

    // Why: bot detectors probe APIs that differ in Electron webviews; inject overrides each load so manual browsing passes.
    const disposeAntiDetection = this.injectAntiDetection(guest)

    // Why: disable throttling so background screenshots still get frames; else the compositor stalls and capture returns empty.
    guest.setBackgroundThrottling(false)
    const installClickedLinkRouting = (): void => {
      if (!clickedLinkRoutingActive || !clickedLinkFrameName || guest.isDestroyed()) {
        return
      }
      // Why: an isolated-world listener labels real anchor clicks without exposing the frame name to page scripts.
      void guest
        .executeJavaScriptInIsolatedWorld(
          BROWSER_CLICKED_LINK_ROUTING_WORLD_ID,
          [
            {
              // Why: mobile emulation spoofs the UA as iOS, so use the real host platform from main for modifier routing.
              code: buildBrowserClickedLinkRoutingScript(
                clickedLinkFrameName,
                process.platform === 'darwin'
              )
            }
          ],
          false
        )
        .catch(() => {})
    }
    if (clickedLinkFrameName) {
      guest.on('dom-ready', installClickedLinkRouting)
    }
    const pendingIframeRoutingInstalls = new Map<Electron.WebFrameMain, () => void>()
    const iframeFrameNameByFrame = new Map<Electron.WebFrameMain, string>()
    const iframeFrameByFrameName = new Map<string, Electron.WebFrameMain>()
    const clearIframeFrameName = (frame: Electron.WebFrameMain): void => {
      const name = iframeFrameNameByFrame.get(frame)
      if (!name) {
        return
      }
      iframeFrameNameByFrame.delete(frame)
      iframeFrameByFrameName.delete(name)
    }
    const installIframeClickedLinkRouting = (frame: Electron.WebFrameMain): void => {
      clearIframeFrameName(frame)
      if (!clickedLinkRoutingActive || frame.isDestroyed()) {
        return
      }
      const name = `__orca_clicked_link_iframe_foreground_${randomUUID()}`
      iframeFrameNameByFrame.set(frame, name)
      iframeFrameByFrameName.set(name, frame)
      // Why: child-frame tokens live in the page world, so consume after one trusted click and replace before the next.
      void frame
        .executeJavaScript(
          buildBrowserIframeClickedLinkRoutingScript(name, process.platform === 'darwin'),
          false
        )
        .catch(() => {
          if (iframeFrameNameByFrame.get(frame) === name) {
            clearIframeFrameName(frame)
          }
        })
    }
    const handleFrameCreated = (
      _event: Electron.Event,
      { frame }: Electron.FrameCreatedDetails
    ): void => {
      if (!clickedLinkFrameName || !frame || frame.parent === null) {
        return
      }
      for (const knownFrame of iframeFrameNameByFrame.keys()) {
        if (knownFrame.isDestroyed()) {
          clearIframeFrameName(knownFrame)
        }
      }
      const installAfterDomReady = (): void => {
        pendingIframeRoutingInstalls.delete(frame)
        installIframeClickedLinkRouting(frame)
      }
      pendingIframeRoutingInstalls.set(frame, installAfterDomReady)
      frame.once('dom-ready', installAfterDomReady)
    }
    if (clickedLinkFrameName) {
      guest.on('frame-created', handleFrameCreated)
    }
    const handleDidCreateWindow = (window: Electron.BrowserWindow): void => {
      // Why: popup descendants inherit the opener's owner context but must not replace its primary registration.
      this.attachGuestPolicies(window.webContents, this.resolvePopupOwnerContext(guest.id))
    }
    guest.on('did-create-window', handleDidCreateWindow)
    guest.setWindowOpenHandler(({ url, frameName }) => {
      const browserTabId = this.resolveBrowserTabIdForGuestWebContentsId(guest.id)
      const browserUrl = normalizeBrowserNavigationUrl(url)
      const externalUrl = normalizeExternalBrowserUrl(url)
      const expectedClickedLinkFrameName = this.clickedLinkFrameNameByGuestId.get(guest.id)
      const iframeFrame = frameName ? iframeFrameByFrameName.get(frameName) : undefined
      let isClickedLink = Boolean(
        expectedClickedLinkFrameName && frameName === expectedClickedLinkFrameName
      )
      if (!isClickedLink && iframeFrame) {
        isClickedLink = true
        clearIframeFrameName(iframeFrame)
        queueMicrotask(() => installIframeClickedLinkRouting(iframeFrame))
      }

      if (isClickedLink) {
        if (browserTabId && browserUrl && this.openLinkInOrcaTab(browserTabId, browserUrl)) {
          this.forwardOrQueuePopupEvent(guest.id, {
            origin: safeOrigin(browserUrl),
            action: 'opened-in-orca'
          })
        }
        // Why: a recognized gesture must never fall through to a native popup if its renderer vanished mid-click.
        return { action: 'deny' }
      }

      // Why: file URLs are fine for in-pane previews, but must not spawn native child windows targeting local paths.
      const canOpenAsChild = Boolean(externalUrl || browserUrl === ORCA_BROWSER_BLANK_URL)
      if (browserTabId && canOpenAsChild) {
        // Why: OAuth may request size/position, but content must not create deceptive or inescapable native chrome.
        return {
          action: 'allow',
          overrideBrowserWindowOptions: SAFE_POPUP_WINDOW_OPTIONS,
          // Why: default child windows lack an address bar; host in an Orca origin-bar window so the destination is verifiable.
          createWindow: (options: PopupChildWindowOptions) =>
            this.createPopupChildWindowWithOriginBar(guest, url, options)
        }
      } else if (externalUrl) {
        // Why: Kagi target=_blank popup URLs still contain the bearer token; redact before handing to the OS browser.
        void shell.openExternal(redactKagiSessionToken(externalUrl))
        this.forwardOrQueuePopupEvent(guest.id, {
          origin: safeOrigin(externalUrl),
          action: 'opened-external'
        })
      } else {
        // Why: popup URLs can carry auth redirects/one-time tokens; surface only sanitized origin metadata.
        this.forwardOrQueuePopupEvent(guest.id, {
          origin: safeOrigin(url),
          action: 'blocked'
        })
      }
      return { action: 'deny' }
    })

    const navigationGuard = (event: Electron.Event, url: string): void => {
      // Why: Turnstile loads challenge resources via blob:; blocking them trips error 600010. Allow only http(s) blobs, not opaque ones.
      if (url.startsWith('blob:https://') || url.startsWith('blob:http://')) {
        return
      }
      // Why: initial file:// attach is allowed for user-opened previews, but block later file:// redirects so remote pages can't probe the FS.
      if (url.startsWith('file:')) {
        event.preventDefault()
        return
      }
      if (!normalizeBrowserNavigationUrl(url)) {
        // Why: will-attach-webview only validates the initial src; keep enforcing the allowlist on later navs.
        event.preventDefault()
      }
    }

    const didFailLoadHandler = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean
    ): void => {
      if (!isMainFrame) {
        return
      }
      const browserPageId = this.tabIdByWebContentsId.get(guest.id)
      const certificateFailure = browserPageId
        ? this.certificateTrustController?.getFailure(browserPageId)
        : null
      if (
        certificateFailure &&
        toSecureCertificateEndpoint(validatedURL || guest.getURL()) ===
          toSecureCertificateEndpoint(certificateFailure.origin)
      ) {
        // Why: this cancellation carries the existing cert warning; don't overwrite it with ERR_ABORTED copy.
        return
      }
      if (errorCode === -3) {
        // Why: an aborted nav never committed; restore the error did-start-navigation cleared so it isn't lost.
        const clearedError = this.clearedLoadErrorsByGuestId.get(guest.id)
        if (clearedError !== undefined) {
          this.clearedLoadErrorsByGuestId.delete(guest.id)
          this.loadErrorsByGuestId.set(guest.id, clearedError)
          this.forwardOrQueueGuestLoadFailure(guest.id, clearedError)
          this.notifyBrowserGuestStateChanged(guest.id)
        }
        return
      }
      this.clearedLoadErrorsByGuestId.delete(guest.id)
      const loadError = this.buildLoadError(
        errorCode,
        errorDescription || 'This site could not be reached.',
        validatedURL || guest.getURL() || 'about:blank'
      )
      this.loadErrorsByGuestId.set(guest.id, loadError)
      this.forwardOrQueueGuestLoadFailure(guest.id, loadError)
      this.notifyBrowserGuestStateChanged(guest.id)
    }

    const didStartNavigationHandler = (
      _event: Electron.Event,
      url: string,
      _isInPlace: boolean,
      isMainFrame: boolean
    ): void => {
      if (!isMainFrame || isChromiumInternalErrorUrl(url)) {
        return
      }
      this.certificateTrustController?.onMainFrameNavigationStarted(guest.id)
      // Why: a pre-registration failure belongs only to its own nav; a replacement nav must not replay it.
      this.pendingLoadFailuresByGuestId.delete(guest.id)
      const activeError = this.loadErrorsByGuestId.get(guest.id)
      if (activeError === undefined) {
        // Why: no error to hide; drop any stale stash so a later abort can't resurrect an old failure.
        this.clearedLoadErrorsByGuestId.delete(guest.id)
        return
      }
      this.clearedLoadErrorsByGuestId.set(guest.id, activeError)
      this.loadErrorsByGuestId.delete(guest.id)
      this.notifyBrowserGuestStateChanged(guest.id)
    }

    const didNavigateHandler = (_event: Electron.Event, url: string): void => {
      // Why: a committed nav makes the did-start-navigation stash obsolete; drop it so a later ERR_ABORTED can't restore an error over it.
      this.clearedLoadErrorsByGuestId.delete(guest.id)
      this.certificateTrustController?.onMainFrameNavigationCommitted(guest.id, url)
    }

    guest.on('will-navigate', navigationGuard)
    guest.on('will-redirect', navigationGuard)
    guest.on('did-start-navigation', didStartNavigationHandler)
    guest.on('did-navigate', didNavigateHandler)
    guest.on('did-fail-load', didFailLoadHandler)
    const handleDestroyed = (): void => {
      // Why: guests can die before renderer registration, else attach-time closures leak until shutdown.
      this.cleanupGuestPolicyAttachment(guest.id)
    }
    guest.on('destroyed', handleDestroyed)

    // Why: store cleanup so unregisterGuest can drop these listeners on teardown and let the WebContents wrapper GC.
    this.policyCleanupByGuestId.set(guest.id, () => {
      disposeAntiDetection()
      try {
        guest.off('destroyed', handleDestroyed)
        guest.off('did-create-window', handleDidCreateWindow)
        if (clickedLinkFrameName) {
          clickedLinkRoutingActive = false
          guest.off('dom-ready', installClickedLinkRouting)
          guest.off('frame-created', handleFrameCreated)
          for (const [frame, install] of pendingIframeRoutingInstalls) {
            if (!frame.isDestroyed()) {
              frame.off('dom-ready', install)
            }
          }
          pendingIframeRoutingInstalls.clear()
          iframeFrameNameByFrame.clear()
          iframeFrameByFrameName.clear()
        }
      } catch {
        // guest may already be destroyed
      }
      if (!guest.isDestroyed()) {
        guest.off('will-navigate', navigationGuard)
        guest.off('will-redirect', navigationGuard)
        guest.off('did-start-navigation', didStartNavigationHandler)
        guest.off('did-navigate', didNavigateHandler)
        guest.off('did-fail-load', didFailLoadHandler)
      }
    })
  }
  createPopupChildWindowWithOriginBar(this: any,
    openerGuest: Electron.WebContents,
    targetUrl: string,
    options: PopupChildWindowOptions
  ): Electron.WebContents {
    const popup = openPopupWithOriginBar(options, targetUrl)
    // Why: Electron emits no did-create-window for createWindow children, so attach the opener's policies here.
    this.attachGuestPolicies(
      popup.contentWebContents,
      this.resolvePopupOwnerContext(openerGuest.id)
    )
    this.forwardOrQueuePopupEvent(openerGuest.id, {
      origin: safeOrigin(targetUrl),
      action: 'opened-in-orca'
    })
    // Why: match Electron's child-window lifecycle so closing the owning tab doesn't orphan session-bearing popups.
    const closePopupWithOpener = (): void => popup.close()
    openerGuest.once('destroyed', closePopupWithOpener)
    popup.onClosed(() => {
      if (!openerGuest.isDestroyed()) {
        openerGuest.off('destroyed', closePopupWithOpener)
      }
    })
    return popup.contentWebContents
  }
  retireStaleGuestWebContents(this: any, previousWebContentsId: number): void {
    // Why: after a renderer-process swap, stop the dead guest id resolving to the live page so stale callbacks don't hit the wrong session.
    this.cleanupGuestPolicyAttachment(previousWebContentsId)
    this.tabIdByWebContentsId.delete(previousWebContentsId)
  }
  cleanupGuestPolicyAttachment(this: any, guestWebContentsId: number): void {
    const isPrimaryGuest = this.tabIdByWebContentsId.has(guestWebContentsId)
    this.certificateTrustController?.onGuestRetired(guestWebContentsId)
    const policyCleanup = this.policyCleanupByGuestId.get(guestWebContentsId)
    if (policyCleanup) {
      policyCleanup()
      this.policyCleanupByGuestId.delete(guestWebContentsId)
    }
    this.policyAttachedGuestIds.delete(guestWebContentsId)
    this.clickedLinkFrameNameByGuestId.delete(guestWebContentsId)
    this.offscreenGuestIds.delete(guestWebContentsId)
    this.popupOwnerContextByGuestId.delete(guestWebContentsId)
    // Why: a popup must stop inheriting authorization the moment its owner retires, before Chromium destroys the child.
    if (isPrimaryGuest) {
      for (const [popupGuestId, owner] of this.popupOwnerContextByGuestId) {
        if (owner.rootGuestWebContentsId === guestWebContentsId) {
          this.popupOwnerContextByGuestId.delete(popupGuestId)
        }
      }
    }
    this.pendingLoadFailuresByGuestId.delete(guestWebContentsId)
    this.loadErrorsByGuestId.delete(guestWebContentsId)
    this.clearedLoadErrorsByGuestId.delete(guestWebContentsId)
    this.pendingPermissionEventsByGuestId.delete(guestWebContentsId)
    this.pendingPopupEventsByGuestId.delete(guestWebContentsId)
    this.cancelPendingDownloadsForGuest(guestWebContentsId)
  }
}
export type BrowserManagerMethods4Surface = typeof BrowserManagerMethods4
