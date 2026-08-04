import { webContents } from 'electron'
import type { BrowserLoadError } from '../../shared/types'
import type { KeybindingOverrides } from '../../shared/keybindings'
import { BrowserGrabSessionController } from './browser-grab-session-controller'
import { BrowserCertificateTrustController } from './browser-certificate-trust-controller'

import type {
  ActiveDownload,
  PendingPermissionEvent,
  PendingPopupEvent,
  PopupOwnerContext
} from './browser-manager-lifecycle-foundation'

import {
  BrowserManagerMethods1,
  type BrowserManagerMethods1Surface
} from './browser-manager-lifecycle-set-dictation-shortcut-forwarding-predicate-install-certificate-request-guard'
import {
  BrowserManagerMethods2,
  type BrowserManagerMethods2Surface
} from './browser-manager-lifecycle-remove-certificate-request-guard-resolve-browser-tab-id-for-guest-web-contents-id'
import {
  BrowserManagerMethods3,
  type BrowserManagerMethods3Surface
} from './browser-manager-lifecycle-resolve-popup-owner-context-acquire-automation-visibility'
import {
  BrowserManagerMethods4,
  type BrowserManagerMethods4Surface
} from './browser-manager-lifecycle-attach-guest-policies-cleanup-guest-policy-attachment'
import {
  BrowserManagerMethods5,
  type BrowserManagerMethods5Surface
} from './browser-manager-lifecycle-register-guest-unregister-all'
import {
  BrowserManagerMethods6,
  type BrowserManagerMethods6Surface
} from './browser-manager-lifecycle-get-guest-web-contents-id-get-session-profile-id-for-tab'
import {
  BrowserManagerMethods7,
  type BrowserManagerMethods7Surface
} from './browser-manager-lifecycle-get-browser-page-load-error-build-load-error'
import {
  BrowserManagerMethods8,
  type BrowserManagerMethods8Surface
} from './browser-manager-lifecycle-notify-certificate-failure-changed-handle-guest-will-download'
import {
  BrowserManagerMethods9,
  type BrowserManagerMethods9Surface
} from './browser-manager-lifecycle-cancel-download-set-annotation-viewport-bridge'
import {
  BrowserManagerMethods10,
  type BrowserManagerMethods10Surface
} from './browser-manager-lifecycle-do-set-annotation-viewport-bridge-impl-has-active-grab-op'
import {
  BrowserManagerMethods11,
  type BrowserManagerMethods11Surface
} from './browser-manager-lifecycle-set-grab-mode-capture-selection-screenshot'
import {
  BrowserManagerMethods12,
  type BrowserManagerMethods12Surface
} from './browser-manager-lifecycle-extract-hover-payload-setup-shortcut-forwarding'
import {
  BrowserManagerMethods13,
  type BrowserManagerMethods13Surface
} from './browser-manager-lifecycle-setup-mouse-wheel-zoom-forwarding-flush-pending-permission-events'
import {
  BrowserManagerMethods14,
  type BrowserManagerMethods14Surface
} from './browser-manager-lifecycle-send-permission-denied-send-popup-event'
import {
  BrowserManagerMethods15,
  type BrowserManagerMethods15Surface
} from './browser-manager-lifecycle-bind-download-to-tab-send-download-started'
import {
  BrowserManagerMethods16,
  type BrowserManagerMethods16Surface
} from './browser-manager-lifecycle-send-download-progress-finish-download-internal'
import {
  BrowserManagerMethods17,
  type BrowserManagerMethods17Surface
} from './browser-manager-lifecycle-cancel-pending-downloads-for-guest-send-guest-load-failure'
import {
  BrowserManagerMethods18,
  type BrowserManagerMethods18Surface
} from './browser-manager-lifecycle-open-link-in-orca-tab-open-link-in-orca-tab'

export * from './browser-manager-lifecycle-foundation'

export class BrowserManager {
  private settingsResolver:
    | (() => {
        keybindings?: KeybindingOverrides
      })
    | null = null
  private readonly webContentsIdByTabId = new Map<string, number>()
  // Why: reverse map gives O(1) guest→tab lookups on every mouse/load/permission/popup event.
  private readonly tabIdByWebContentsId = new Map<number, string>()
  private readonly popupOwnerContextByGuestId = new Map<number, PopupOwnerContext>()
  // Why: guests are keyed by page id but renderer visibility by workspace id; bridge the mismatch to activate the right tab before capture.
  private readonly workspaceIdByPageId = new Map<string, string>()
  private readonly sessionProfileIdByPageId = new Map<string, string | null>()
  private readonly rendererWebContentsIdByTabId = new Map<string, number>()
  // Why: serialize per-tab setViewportOverride so rapid toggles don't interleave CDP commands and leave emulation in a wrong state.
  private readonly viewportOpsByTabId = new Map<string, Promise<unknown>>()
  private readonly contextMenuCleanupByTabId = new Map<string, () => void>()
  private readonly grabShortcutCleanupByTabId = new Map<string, () => void>()
  private readonly shortcutForwardingCleanupByTabId = new Map<string, () => void>()
  private readonly mouseWheelZoomCleanupByTabId = new Map<string, () => void>()
  private readonly annotationViewportBridgeOpsByTabId = new Map<string, Promise<unknown>>()
  private readonly worktreeIdByTabId = new Map<string, string>()
  private readonly policyAttachedGuestIds = new Set<number>()
  private readonly offscreenGuestIds = new Set<number>()
  private readonly policyCleanupByGuestId = new Map<number, () => void>()
  private readonly clickedLinkFrameNameByGuestId = new Map<number, string>()
  private readonly loadErrorsByGuestId = new Map<number, BrowserLoadError>()
  // Why: did-start-navigation hides the overlay optimistically; stash the cleared error so did-fail-load(-3) can restore an aborted nav.
  private readonly clearedLoadErrorsByGuestId = new Map<number, BrowserLoadError>()
  private browserGuestStateChangedListener: ((worktreeId: string) => void) | null = null
  private certificateTrustController: BrowserCertificateTrustController | null = null
  private shouldForwardDictationShortcut: (() => boolean) | null = null
  private readonly pendingLoadFailuresByGuestId = new Map<
    number,
    { code: number; description: string; validatedUrl: string }
  >()
  private readonly pendingPermissionEventsByGuestId = new Map<number, PendingPermissionEvent[]>()
  private readonly pendingPopupEventsByGuestId = new Map<number, PendingPopupEvent[]>()
  private readonly pendingDownloadIdsByGuestId = new Map<number, string[]>()
  private readonly downloadsById = new Map<string, ActiveDownload>()
  private readonly grabSessionController = new BrowserGrabSessionController()

  constructor() {
    void [
      this.settingsResolver,
      this.webContentsIdByTabId,
      this.tabIdByWebContentsId,
      this.popupOwnerContextByGuestId,
      this.workspaceIdByPageId,
      this.sessionProfileIdByPageId,
      this.rendererWebContentsIdByTabId,
      this.viewportOpsByTabId,
      this.contextMenuCleanupByTabId,
      this.grabShortcutCleanupByTabId,
      this.shortcutForwardingCleanupByTabId,
      this.mouseWheelZoomCleanupByTabId,
      this.annotationViewportBridgeOpsByTabId,
      this.worktreeIdByTabId,
      this.policyAttachedGuestIds,
      this.offscreenGuestIds,
      this.policyCleanupByGuestId,
      this.clickedLinkFrameNameByGuestId,
      this.loadErrorsByGuestId,
      this.clearedLoadErrorsByGuestId,
      this.browserGuestStateChangedListener,
      this.certificateTrustController,
      this.shouldForwardDictationShortcut,
      this.pendingLoadFailuresByGuestId,
      this.pendingPermissionEventsByGuestId,
      this.pendingPopupEventsByGuestId,
      this.pendingDownloadIdsByGuestId,
      this.downloadsById,
      this.grabSessionController
    ]
  }
}

export interface BrowserManager extends BrowserManagerMethods1Surface, BrowserManagerMethods2Surface, BrowserManagerMethods3Surface, BrowserManagerMethods4Surface, BrowserManagerMethods5Surface, BrowserManagerMethods6Surface, BrowserManagerMethods7Surface, BrowserManagerMethods8Surface, BrowserManagerMethods9Surface, BrowserManagerMethods10Surface, BrowserManagerMethods11Surface, BrowserManagerMethods12Surface, BrowserManagerMethods13Surface, BrowserManagerMethods14Surface, BrowserManagerMethods15Surface, BrowserManagerMethods16Surface, BrowserManagerMethods17Surface, BrowserManagerMethods18Surface {}

Object.assign(
  BrowserManager.prototype,
  BrowserManagerMethods1,
  BrowserManagerMethods2,
  BrowserManagerMethods3,
  BrowserManagerMethods4,
  BrowserManagerMethods5,
  BrowserManagerMethods6,
  BrowserManagerMethods7,
  BrowserManagerMethods8,
  BrowserManagerMethods9,
  BrowserManagerMethods10,
  BrowserManagerMethods11,
  BrowserManagerMethods12,
  BrowserManagerMethods13,
  BrowserManagerMethods14,
  BrowserManagerMethods15,
  BrowserManagerMethods16,
  BrowserManagerMethods17,
  BrowserManagerMethods18
)

export const browserManager = new BrowserManager()
export const browserCertificateTrustController = new BrowserCertificateTrustController({
  resolveManagedGuestContext: (webContentsId) =>
    browserManager.getManagedBrowserGuestContext(webContentsId),
  resolveWebContentsIdForPage: (browserPageId) =>
    browserManager.getGuestWebContentsId(browserPageId),
  resolveWebContents: (webContentsId) => webContents.fromId(webContentsId) ?? null,
  onFailureChanged: (webContentsId, failure, navigationUrl) =>
    browserManager.notifyCertificateFailureChanged(webContentsId, failure, navigationUrl)
})
browserManager.setCertificateTrustController(browserCertificateTrustController)
