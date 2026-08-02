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

export const BrowserManagerMethods11 = {
  async setGrabMode(this: any,
    browserTabId: string,
    enabled: boolean,
    guest: Electron.WebContents
  ): Promise<boolean> {
    if (!enabled) {
      const hadActiveGrabOp = this.hasActiveGrabOp(browserTabId)
      this.cancelGrabOp(browserTabId, 'user')
      if (hadActiveGrabOp) {
        return true
      }
      try {
        await guest.executeJavaScript(buildGuestOverlayScript('teardown'))
        return true
      } catch {
        return false
      }
    }
    // Why: inject the overlay runtime eagerly on arm so the hover UI appears instantly; re-injection is idempotent/safe.
    try {
      await guest.executeJavaScript(buildGuestOverlayScript('arm'))
      return true
    } catch {
      return false
    }
  }
  awaitGrabSelection(this: any,
    browserTabId: string,
    opId: string,
    guest: Electron.WebContents
  ): Promise<BrowserGrabResult> {
    return this.grabSessionController.awaitGrabSelection(browserTabId, opId, guest)
  }
  cancelGrabOp(this: any, browserTabId: string, reason: BrowserGrabCancelReason): void {
    this.grabSessionController.cancelGrabOp(browserTabId, reason)
  }
  async captureSelectionScreenshot(this: any,
    _browserTabId: string,
    rect: BrowserGrabRect,
    guest: Electron.WebContents
  ): Promise<BrowserGrabScreenshot | null> {
    return captureGrabSelectionScreenshot(rect, guest)
  }
}
export type BrowserManagerMethods11Surface = typeof BrowserManagerMethods11
