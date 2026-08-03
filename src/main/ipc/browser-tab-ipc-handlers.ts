// Browser IPC handlers and tab lifecycle implementation.
import { BrowserWindow, ipcMain, webContents } from 'electron'
import { browserCertificateTrustController, browserManager } from '../browser/browser-manager'
import type { AgentBrowserBridge } from '../browser/agent-browser-bridge'
import { browserSessionRegistry } from '../browser/browser-session-registry'
import {
  pickCookieFile,
  importCookiesFromFile,
  detectInstalledBrowsers,
  selectBrowserProfile,
  importCookiesFromBrowser
} from '../browser/browser-cookie-import'
import type {
  BrowserSetGrabModeArgs,
  BrowserSetGrabModeResult,
  BrowserAwaitGrabSelectionArgs,
  BrowserGrabResult,
  BrowserCancelGrabArgs,
  BrowserCaptureSelectionScreenshotArgs,
  BrowserCaptureSelectionScreenshotResult,
  BrowserExtractHoverArgs,
  BrowserExtractHoverResult
} from '../../shared/browser-grab-types'
import type {
  BrowserCookieImportResult,
  BrowserCertificateProceedResult,
  BrowserSessionProfile,
  BrowserSessionProfileScope,
  BrowserViewportOverride
} from '../../shared/types'
import {
  isValidBrowserAnnotationViewportBridgeMarkers,
  isValidBrowserAnnotationViewportBridgeToken,
  type BrowserSetAnnotationViewportBridgeArgs
} from '../../shared/browser-annotation-viewport-bridge'

import { trustedBrowserRendererWebContentsId, agentBrowserBridgeRef, pendingTabRegistrations, pendingWorktreeTabRegistrations, pendingAnyTabRegistrations, grabModeIntentByPageId, grabModeOperationByPageId, GRAB_REGISTRATION_WAIT_MS, waitForRegistrationSet, resolvePendingRegistrations, isLiveBrowserWebContentsId, hasRegisteredTabForWorktree, waitForTabRegistration, waitForNextTabRegistration, queueGrabModeOperation, waitForWorktreeTabRegistration, waitForAnyTabRegistration, setTrustedBrowserRendererWebContentsId, setAgentBrowserBridgeRef, isTrustedBrowserRenderer } from './browser-ipc-foundation'

export function registerBrowserTabHandlers(): void {
  ipcMain.removeHandler('browser:registerGuest')

  ipcMain.removeHandler('browser:unregisterGuest')

  ipcMain.removeHandler('browser:openDevTools')

  ipcMain.removeHandler('browser:setViewportOverride')

  ipcMain.removeHandler('browser:setAnnotationViewportBridge')

  ipcMain.removeHandler('browser:acceptDownload')

  ipcMain.removeHandler('browser:cancelDownload')

  ipcMain.removeHandler('browser:activeTabChanged')

  ipcMain.removeHandler('browser:proceedCertificate')

  ipcMain.handle(
      'browser:registerGuest',
      (
        event,
        args: {
          browserPageId: string
          workspaceId: string
          worktreeId: string
          sessionProfileId?: string | null
          webContentsId: number
        }
      ) => {
        if (!isTrustedBrowserRenderer(event.sender)) {
          return false
        }
        // Why: when Chromium swaps a guest's renderer process (navigation,
        // crash recovery), the renderer re-registers the same browserPageId
        // with a new webContentsId. The bridge must destroy the old session's
        // proxy (its webContents is gone) and let the next command recreate it.
        const previousWcId = browserManager.getGuestWebContentsId(args.browserPageId)
        const registered = browserManager.registerGuest({
          ...args,
          rendererWebContentsId: event.sender.id
        })
        if (!registered) {
          return false
        }
        if (agentBrowserBridgeRef && previousWcId !== null && previousWcId !== args.webContentsId) {
          agentBrowserBridgeRef.onProcessSwap(args.browserPageId, args.webContentsId, previousWcId)
        }
        const pendingResolves = pendingTabRegistrations.get(args.browserPageId)
        pendingTabRegistrations.delete(args.browserPageId)
        resolvePendingRegistrations(pendingResolves)
        const pendingWorktreeResolves = pendingWorktreeTabRegistrations.get(args.worktreeId)
        pendingWorktreeTabRegistrations.delete(args.worktreeId)
        resolvePendingRegistrations(pendingWorktreeResolves)
        const pendingAnyResolves = new Set(pendingAnyTabRegistrations)
        pendingAnyTabRegistrations.clear()
        resolvePendingRegistrations(pendingAnyResolves)
        return true
      }
    )

  ipcMain.handle('browser:unregisterGuest', (event, args: { browserPageId: string }) => {
      if (!isTrustedBrowserRenderer(event.sender)) {
        return false
      }
      // Why: notify bridge before unregistering so it can destroy the session
      // process and proxy. Must happen before unregisterGuest clears the mapping.
      const wcId = browserManager.getGuestWebContentsId(args.browserPageId)
      if (wcId !== null && agentBrowserBridgeRef) {
        agentBrowserBridgeRef.onTabClosed(wcId)
      }
      browserManager.unregisterGuest(args.browserPageId)
      grabModeIntentByPageId.delete(args.browserPageId)
      // Why: don't let a reused browserPageId queue behind the destroyed guest's pending chain.
      grabModeOperationByPageId.delete(args.browserPageId)
      return true
    })

  ipcMain.handle(
      'browser:proceedCertificate',
      (
        event,
        args: { browserPageId?: unknown; challengeId?: unknown }
      ): BrowserCertificateProceedResult => {
        if (
          !isTrustedBrowserRenderer(event.sender) ||
          typeof args?.browserPageId !== 'string' ||
          typeof args.challengeId !== 'string'
        ) {
          return { ok: false, reason: 'missing' }
        }
        return browserCertificateTrustController.proceed(args.browserPageId, args.challengeId)
      }
    )
  
    // Why: keeps the bridge's active tab in sync with the renderer's UI state.
    // Without this, a user switching tabs in the UI would leave the agent operating
    // on the previous tab, which is confusing.

  ipcMain.handle('browser:activeTabChanged', (event, args: { browserPageId: string }) => {
      if (!isTrustedBrowserRenderer(event.sender)) {
        return false
      }
      if (!agentBrowserBridgeRef) {
        return false
      }
      const wcId = browserManager.getGuestWebContentsId(args.browserPageId)
      if (wcId !== null) {
        // Why: renderer tab changes are scoped to a worktree. If we only update
        // the global active guest, later worktree-scoped commands can still
        // resolve to the previously active page inside that worktree.
        agentBrowserBridgeRef.onTabChanged(
          wcId,
          browserManager.getWorktreeIdForTab(args.browserPageId)
        )
      }
      return true
    })

  ipcMain.handle('browser:openDevTools', (event, args: { browserPageId: string }) => {
      if (!isTrustedBrowserRenderer(event.sender)) {
        return false
      }
      return browserManager.openDevTools(args.browserPageId)
    })

  ipcMain.handle(
      'browser:setViewportOverride',
      (
        event,
        args: {
          browserPageId: string
          override: BrowserViewportOverride | null
        }
      ) => {
        if (!isTrustedBrowserRenderer(event.sender)) {
          return false
        }
        // Why: CDP misbehaves on non-finite/negative metrics (NaN/Infinity can
        // wedge Emulation.setDeviceMetricsOverride and leave the page in a
        // broken state). Validate at the main-process trust boundary so a buggy
        // or compromised renderer cannot corrupt CDP state.
        if (args.override !== null) {
          const { width, height, deviceScaleFactor, mobile } = args.override
          const isFinitePositive = (n: unknown): n is number =>
            typeof n === 'number' && Number.isFinite(n) && n > 0
          if (!isFinitePositive(width) || width < 1 || width > 10000) {
            return false
          }
          if (!isFinitePositive(height) || height < 1 || height > 10000) {
            return false
          }
          if (
            !isFinitePositive(deviceScaleFactor) ||
            deviceScaleFactor < 0.1 ||
            deviceScaleFactor > 5
          ) {
            return false
          }
          if (typeof mobile !== 'boolean') {
            return false
          }
        }
        return browserManager.setViewportOverride(args.browserPageId, args.override)
      }
    )

  ipcMain.handle(
      'browser:setAnnotationViewportBridge',
      (event, args: BrowserSetAnnotationViewportBridgeArgs): Promise<boolean> | boolean => {
        if (!isTrustedBrowserRenderer(event.sender)) {
          return false
        }
        if (
          typeof args?.browserPageId !== 'string' ||
          typeof args.enabled !== 'boolean' ||
          typeof args.emitViewport !== 'boolean' ||
          !isValidBrowserAnnotationViewportBridgeMarkers(args.markers) ||
          !isValidBrowserAnnotationViewportBridgeToken(args.token)
        ) {
          return false
        }
        return browserManager.setAnnotationViewportBridge(args.browserPageId, {
          enabled: args.enabled,
          emitViewport: args.emitViewport,
          markers: args.markers,
          token: args.token
        })
      }
    )

  ipcMain.handle('browser:cancelDownload', (event, args: { downloadId: string }) => {
      if (!isTrustedBrowserRenderer(event.sender)) {
        return false
      }
      return browserManager.cancelDownload({
        downloadId: args.downloadId,
        senderWebContentsId: event.sender.id
      })
    })
  
    // --- Browser Context Grab IPC ---
}
