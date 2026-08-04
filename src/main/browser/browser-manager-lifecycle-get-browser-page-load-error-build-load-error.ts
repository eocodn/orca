import { webContents } from 'electron'
import { redactKagiSessionToken } from '../../shared/browser-url'
import type { BrowserCertificateFailure, BrowserLoadError } from '../../shared/types'
import type { ManagedBrowserGuestContext } from './browser-certificate-trust-controller'

export const BrowserManagerMethods7 = {
  getBrowserPageLoadError(this: any, browserPageId: string): BrowserLoadError | null {
    const webContentsId = this.webContentsIdByTabId.get(browserPageId)
    return webContentsId === undefined
      ? null
      : (this.loadErrorsByGuestId.get(webContentsId) ?? null)
  },
  getBrowserPageCertificateFailure(
    this: any,
    browserPageId: string
  ): BrowserCertificateFailure | null {
    return this.certificateTrustController?.getFailure(browserPageId) ?? null
  },
  getManagedBrowserGuestContext(
    this: any,
    webContentsId: number
  ): ManagedBrowserGuestContext | null {
    if (this.popupOwnerContextByGuestId.has(webContentsId)) {
      return null
    }
    const browserPageId = this.tabIdByWebContentsId.get(webContentsId) ?? null
    const offscreen = this.offscreenGuestIds.has(webContentsId)
    if (!offscreen && !this.policyAttachedGuestIds.has(webContentsId)) {
      return null
    }
    if (!offscreen) {
      const guest = webContents.fromId(webContentsId)
      if (!guest || guest.isDestroyed() || guest.getType() !== 'webview') {
        return null
      }
    }
    return {
      browserPageId,
      worktreeId: browserPageId ? (this.worktreeIdByTabId.get(browserPageId) ?? null) : null,
      sessionProfileId: browserPageId
        ? (this.sessionProfileIdByPageId.get(browserPageId) ?? null)
        : null,
      owner: offscreen ? 'offscreen' : 'desktop-webview'
    }
  },
  buildLoadError(this: any, code: number, description: string, rawUrl: string): BrowserLoadError {
    return {
      code,
      description,
      validatedUrl: redactKagiSessionToken(rawUrl)
    }
  }
}
export type BrowserManagerMethods7Surface = typeof BrowserManagerMethods7
