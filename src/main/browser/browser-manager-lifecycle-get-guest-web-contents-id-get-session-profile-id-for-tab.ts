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

export const BrowserManagerMethods6 = {
  getGuestWebContentsId(this: any, browserTabId: string): number | null {
    return this.webContentsIdByTabId.get(browserTabId) ?? null
  }
  getWebContentsIdByTabId(this: any): Map<string, number> {
    return this.webContentsIdByTabId
  }
  getWorktreeIdForTab(this: any, browserTabId: string): string | undefined {
    return this.worktreeIdByTabId.get(browserTabId)
  }
  getSessionProfileIdForTab(this: any, browserTabId: string): string | null {
    return this.sessionProfileIdByPageId.get(browserTabId) ?? null
  }
}
export type BrowserManagerMethods6Surface = typeof BrowserManagerMethods6
