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

export const BrowserManagerMethods17 = {
  cancelPendingDownloadsForGuest(this: any, guestWebContentsId: number): void {
    const pending = this.pendingDownloadIdsByGuestId.get(guestWebContentsId)
    this.pendingDownloadIdsByGuestId.delete(guestWebContentsId)
    if (!pending?.length) {
      return
    }
    for (const downloadId of pending) {
      const download = this.downloadsById.get(downloadId)
      if (!download) {
        continue
      }
      if (download.terminalEvent) {
        this.downloadsById.delete(downloadId)
        continue
      }
      this.cancelDownloadInternal(downloadId, 'Browser page closed before download could be shown.')
      const afterCancel = this.downloadsById.get(downloadId)
      if (afterCancel?.terminalEvent && !afterCancel.browserTabId) {
        this.downloadsById.delete(downloadId)
      }
    }
  }
  getDownloadReceivedBytes(this: any, item: Electron.DownloadItem): number {
    try {
      return Math.max(0, item.getReceivedBytes())
    } catch {
      return 0
    }
  }
  flushPendingLoadFailure(this: any, browserTabId: string, guestWebContentsId: number): void {
    const pending = this.pendingLoadFailuresByGuestId.get(guestWebContentsId)
    if (!pending) {
      return
    }
    this.pendingLoadFailuresByGuestId.delete(guestWebContentsId)
    this.sendGuestLoadFailure(browserTabId, pending)
  }
  sendGuestLoadFailure(this: any,
    browserTabId: string,
    loadError: { code: number; description: string; validatedUrl: string }
  ): void {
    const renderer = this.resolveRendererForBrowserTab(browserTabId)
    if (!renderer) {
      return
    }

    // Why: redact Kagi session tokens before the renderer persists validatedUrl to disk.
    renderer.send('browser:guest-load-failed', {
      browserPageId: browserTabId,
      loadError: {
        ...loadError,
        validatedUrl: redactKagiSessionToken(loadError.validatedUrl)
      }
    })
  }
}
export type BrowserManagerMethods17Surface = typeof BrowserManagerMethods17
