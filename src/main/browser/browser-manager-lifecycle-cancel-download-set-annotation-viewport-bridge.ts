
import { webContents } from 'electron'
import type {
  BrowserViewportOverride,
} from '../../shared/types'
import {
  type BrowserAnnotationViewportBridgeOptions,
} from '../../shared/browser-annotation-viewport-bridge'


export const BrowserManagerMethods9 = {
  cancelDownload(this: any, args: { downloadId: string; senderWebContentsId: number }): boolean {
    const download = this.downloadsById.get(args.downloadId)
    if (!download || download.rendererWebContentsId !== args.senderWebContentsId) {
      return false
    }
    this.cancelDownloadInternal(args.downloadId, 'Canceled.')
    return true
  },
  async openDevTools(this: any, browserTabId: string): Promise<boolean> {
    const webContentsId = this.webContentsIdByTabId.get(browserTabId)
    if (!webContentsId) {
      return false
    }
    const guest = webContents.fromId(webContentsId)
    if (!guest || guest.isDestroyed()) {
      // Why: a stale guest must clear every per-tab registry entry, not just the WebContents maps.
      this.unregisterGuest(browserTabId)
      return false
    }
    guest.openDevTools({ mode: 'detach' })
    return true
  },
  async setViewportOverride(this: any,
    browserTabId: string,
    override: BrowserViewportOverride | null
  ): Promise<boolean> {
    // Why: chain per-tab so rapid toggles don't interleave CDP commands and the last-requested override wins.
    const prev = this.viewportOpsByTabId.get(browserTabId) ?? Promise.resolve()
    const next = prev
      .catch(() => {})
      .then(() => this.doSetViewportOverrideImpl(browserTabId, override))
    this.viewportOpsByTabId.set(browserTabId, next)
    try {
      return await next
    } finally {
      // Why: only clear if we're still the tail; a later call may have replaced the entry, and deleting would break serialization.
      if (this.viewportOpsByTabId.get(browserTabId) === next) {
        this.viewportOpsByTabId.delete(browserTabId)
      }
    }
  },
  async setAnnotationViewportBridge(this: any,
    browserTabId: string,
    options: BrowserAnnotationViewportBridgeOptions
  ): Promise<boolean> {
    const prev = this.annotationViewportBridgeOpsByTabId.get(browserTabId) ?? Promise.resolve()
    const next = prev
      .catch(() => {})
      .then(() => this.doSetAnnotationViewportBridgeImpl(browserTabId, options))
    this.annotationViewportBridgeOpsByTabId.set(browserTabId, next)
    try {
      return await next
    } finally {
      if (this.annotationViewportBridgeOpsByTabId.get(browserTabId) === next) {
        this.annotationViewportBridgeOpsByTabId.delete(browserTabId)
      }
    }
  }
}
export type BrowserManagerMethods9Surface = typeof BrowserManagerMethods9
