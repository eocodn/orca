
import { webContents } from 'electron'
import { browserDownloadDestinationReservations } from './browser-download-destination'

import * as foundation from './browser-manager-lifecycle-foundation'
type BrowserGuestRegistration = foundation.BrowserGuestRegistration

export const BrowserManagerMethods5 = {
  registerGuest(this: any, {
    browserPageId,
    browserTabId: legacyBrowserTabId,
    workspaceId,
    worktreeId,
    sessionProfileId,
    webContentsId,
    rendererWebContentsId
  }: BrowserGuestRegistration): boolean {
    const browserTabId = browserPageId ?? legacyBrowserTabId
    if (!browserTabId) {
      return false
    }
    // Why: on guest-surface swap, cancel any grab bound to the old guest's listeners so it doesn't strand on a stale webContents.
    this.cancelGrabOp(browserTabId, 'evicted')

    const previousCleanup = this.contextMenuCleanupByTabId.get(browserTabId)
    if (previousCleanup) {
      previousCleanup()
      this.contextMenuCleanupByTabId.delete(browserTabId)
    }

    const guest = webContents.fromId(webContentsId)
    if (!guest || guest.isDestroyed()) {
      return false
    }

    // Why: don't trust the renderer-sent id blindly — a compromised renderer could pass the main window's id; only accept webview guests.
    if (guest.getType() !== 'webview') {
      return false
    }
    if (!this.policyAttachedGuestIds.has(webContentsId)) {
      // Why: only trust guests that passed attach-time policy install, or a renderer could point us at an arbitrary webview.
      return false
    }

    const previousWebContentsId = this.webContentsIdByTabId.get(browserTabId)
    if (previousWebContentsId !== undefined && previousWebContentsId !== webContentsId) {
      this.retireStaleGuestWebContents(previousWebContentsId)
    }
    this.webContentsIdByTabId.set(browserTabId, webContentsId)
    this.tabIdByWebContentsId.set(webContentsId, browserTabId)
    if (workspaceId) {
      this.workspaceIdByPageId.set(browserTabId, workspaceId)
    }
    this.sessionProfileIdByPageId.set(browserTabId, sessionProfileId ?? null)
    this.rendererWebContentsIdByTabId.set(browserTabId, rendererWebContentsId)
    if (worktreeId) {
      this.worktreeIdByTabId.set(browserTabId, worktreeId)
    }
    this.certificateTrustController?.onGuestRegistered(webContentsId, browserTabId)

    this.setupContextMenu(browserTabId, guest)
    this.setupGrabShortcut(browserTabId, guest)
    this.setupShortcutForwarding(browserTabId, guest)
    this.setupMouseWheelZoomForwarding(browserTabId, guest)
    this.flushPendingLoadFailure(browserTabId, webContentsId)
    this.flushPendingPermissionEvents(browserTabId, webContentsId)
    this.flushPendingPopupEvents(browserTabId, webContentsId)
    this.flushPendingDownloadRequests(browserTabId, webContentsId)
    return true
  },
  unregisterGuest(this: any, browserTabId: string): void {
    // Why: teardown mid-grab must cancel it so the renderer gets a signal, not a dangling Promise.
    this.cancelGrabOp(browserTabId, 'evicted')

    // Why: remove attachGuestPolicies listeners so their guest-WebContents closures don't block GC.
    const guestWebContentsId = this.webContentsIdByTabId.get(browserTabId)
    if (guestWebContentsId !== undefined) {
      this.cleanupGuestPolicyAttachment(guestWebContentsId)
    }

    const cleanup = this.contextMenuCleanupByTabId.get(browserTabId)
    if (cleanup) {
      cleanup()
      this.contextMenuCleanupByTabId.delete(browserTabId)
    }
    const shortcutCleanup = this.grabShortcutCleanupByTabId.get(browserTabId)
    if (shortcutCleanup) {
      shortcutCleanup()
      this.grabShortcutCleanupByTabId.delete(browserTabId)
    }
    const fwdCleanup = this.shortcutForwardingCleanupByTabId.get(browserTabId)
    if (fwdCleanup) {
      fwdCleanup()
      this.shortcutForwardingCleanupByTabId.delete(browserTabId)
    }
    const mouseWheelZoomCleanup = this.mouseWheelZoomCleanupByTabId.get(browserTabId)
    if (mouseWheelZoomCleanup) {
      mouseWheelZoomCleanup()
      this.mouseWheelZoomCleanupByTabId.delete(browserTabId)
    }
    // Why: downloads are per-tab chrome; closing the tab must cancel active writes, not orphan them.
    for (const [downloadId, download] of this.downloadsById.entries()) {
      if (download.browserTabId === browserTabId && !download.terminalEvent) {
        this.cancelDownloadInternal(downloadId, 'Tab closed before download completed.')
      }
    }
    const wcId = this.webContentsIdByTabId.get(browserTabId)
    if (wcId !== undefined) {
      this.tabIdByWebContentsId.delete(wcId)
    }
    this.webContentsIdByTabId.delete(browserTabId)
    this.rendererWebContentsIdByTabId.delete(browserTabId)
    this.workspaceIdByPageId.delete(browserTabId)
    this.sessionProfileIdByPageId.delete(browserTabId)
    this.worktreeIdByTabId.delete(browserTabId)
    // Why: drop the viewport-op chain so the Map doesn't retain a promise keyed to a destroyed guest.
    this.viewportOpsByTabId.delete(browserTabId)
    this.annotationViewportBridgeOpsByTabId.delete(browserTabId)
  },
  registerOffscreenGuest(this: any, {
    browserPageId,
    worktreeId,
    sessionProfileId,
    webContentsId
  }: {
    browserPageId: string
    worktreeId?: string
    sessionProfileId?: string | null
    webContentsId: number
  }): void {
    const guest = webContents.fromId(webContentsId)
    if (!guest || guest.isDestroyed()) {
      return
    }
    // Why: offscreen pages have no renderer webview listeners, so main owns their load-failure lifecycle.
    this.offscreenGuestIds.add(webContentsId)
    this.attachGuestPolicies(guest)
    const previousWebContentsId = this.webContentsIdByTabId.get(browserPageId)
    if (previousWebContentsId !== undefined && previousWebContentsId !== webContentsId) {
      this.retireStaleGuestWebContents(previousWebContentsId)
    }
    this.webContentsIdByTabId.set(browserPageId, webContentsId)
    this.tabIdByWebContentsId.set(webContentsId, browserPageId)
    this.sessionProfileIdByPageId.set(browserPageId, sessionProfileId ?? null)
    if (worktreeId) {
      this.worktreeIdByTabId.set(browserPageId, worktreeId)
    }
    this.certificateTrustController?.onGuestRegistered(webContentsId, browserPageId)
  },
  unregisterAll(this: any): void {
    // Cancel all active grab ops before tearing down registrations
    this.grabSessionController.cancelAll('evicted')
    for (const downloadId of this.downloadsById.keys()) {
      this.cancelDownloadInternal(downloadId, 'Orca is shutting down.')
    }
    browserDownloadDestinationReservations.clear()
    for (const browserTabId of this.webContentsIdByTabId.keys()) {
      this.unregisterGuest(browserTabId)
    }
    this.policyAttachedGuestIds.clear()
    this.offscreenGuestIds.clear()
    // Why: unregisterGuest skips guests that were policy-attached but never registered; invoke their cleanup closures here.
    for (const cleanup of this.policyCleanupByGuestId.values()) {
      cleanup()
    }
    this.policyCleanupByGuestId.clear()
    this.clickedLinkFrameNameByGuestId.clear()
    this.tabIdByWebContentsId.clear()
    this.popupOwnerContextByGuestId.clear()
    this.worktreeIdByTabId.clear()
    this.sessionProfileIdByPageId.clear()
    this.pendingLoadFailuresByGuestId.clear()
    this.loadErrorsByGuestId.clear()
    this.clearedLoadErrorsByGuestId.clear()
    this.pendingPermissionEventsByGuestId.clear()
    this.pendingPopupEventsByGuestId.clear()
    this.pendingDownloadIdsByGuestId.clear()
    this.mouseWheelZoomCleanupByTabId.clear()
    this.annotationViewportBridgeOpsByTabId.clear()
  }
}
export type BrowserManagerMethods5Surface = typeof BrowserManagerMethods5
