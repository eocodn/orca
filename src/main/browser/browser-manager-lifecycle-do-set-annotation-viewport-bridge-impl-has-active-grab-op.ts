import { webContents } from 'electron'
import { cleanElectronUserAgent } from './browser-session-ua'
import type { BrowserViewportOverride } from '../../shared/types'
import {
  type BrowserAnnotationViewportBridgeOptions,
  BROWSER_ANNOTATION_VIEWPORT_BRIDGE_WORLD_ID,
  buildBrowserAnnotationViewportBridgeScript
} from '../../shared/browser-annotation-viewport-bridge'

import * as foundation from './browser-manager-lifecycle-foundation'
const { buildMobileUserAgent, extractChromeMajor } = foundation

export const BrowserManagerMethods10 = {
  async doSetAnnotationViewportBridgeImpl(
    this: any,
    browserTabId: string,
    options: BrowserAnnotationViewportBridgeOptions
  ): Promise<boolean> {
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

    try {
      // Why: run the scroll bridge in an isolated world so page scripts can't read the per-tab token or tamper with it.
      await guest.executeJavaScriptInIsolatedWorld(
        BROWSER_ANNOTATION_VIEWPORT_BRIDGE_WORLD_ID,
        [{ code: buildBrowserAnnotationViewportBridgeScript(options) }],
        false
      )
      return true
    } catch {
      return false
    }
  },
  async doSetViewportOverrideImpl(
    this: any,
    browserTabId: string,
    override: BrowserViewportOverride | null
  ): Promise<boolean> {
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

    try {
      if (!guest.debugger.isAttached()) {
        guest.debugger.attach('1.3')
      }
    } catch (err) {
      // Why: attach throws if DevTools is open on the guest; log context so this failure mode is diagnosable.
      console.warn('[browser-manager] setViewportOverride: failed to attach debugger', {
        browserTabId,
        webContentsId,
        error: err instanceof Error ? err.message : String(err)
      })
      return false
    }

    const dbg = guest.debugger
    try {
      if (override) {
        await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
          width: override.width,
          height: override.height,
          deviceScaleFactor: override.deviceScaleFactor,
          mobile: override.mobile
        })
        await dbg.sendCommand('Emulation.setTouchEmulationEnabled', {
          enabled: override.mobile,
          maxTouchPoints: override.mobile ? 5 : 0
        })
        if (override.mobile) {
          const chromeMajor = extractChromeMajor(cleanElectronUserAgent(guest.getUserAgent()))
          // Why: userAgentMetadata must accompany the mobile UA so client hints match, or bot-detection flags the desktop-hint leak.
          await dbg.sendCommand('Emulation.setUserAgentOverride', {
            userAgent: buildMobileUserAgent(chromeMajor),
            userAgentMetadata: {
              brands: [
                { brand: 'Google Chrome', version: chromeMajor },
                { brand: 'Chromium', version: chromeMajor },
                { brand: 'Not/A)Brand', version: '24' }
              ],
              fullVersionList: [
                { brand: 'Google Chrome', version: `${chromeMajor}.0.0.0` },
                { brand: 'Chromium', version: `${chromeMajor}.0.0.0` },
                { brand: 'Not/A)Brand', version: '24.0.0.0' }
              ],
              fullVersion: `${chromeMajor}.0.0.0`,
              platform: 'iOS',
              platformVersion: '17.0',
              architecture: '',
              model: 'iPhone',
              mobile: true
            }
          })
        } else {
          // Why: desktop presets still need the clean (non-Electron) UA so Cloudflare/Turnstile don't flag the session.
          await dbg.sendCommand('Emulation.setUserAgentOverride', {
            userAgent: cleanElectronUserAgent(guest.getUserAgent())
          })
        }
      } else {
        await dbg.sendCommand('Emulation.clearDeviceMetricsOverride', {})
        await dbg.sendCommand('Emulation.setTouchEmulationEnabled', {
          enabled: false,
          maxTouchPoints: 0
        })
        // Why: passing an empty string restores the session default UA.
        await dbg.sendCommand('Emulation.setUserAgentOverride', { userAgent: '' })
      }
      return true
    } catch {
      return false
    }
  },
  getAuthorizedGuest(
    this: any,
    browserTabId: string,
    senderWebContentsId: number
  ): Electron.WebContents | null {
    const registeredRenderer = this.rendererWebContentsIdByTabId.get(browserTabId)
    if (registeredRenderer == null || registeredRenderer !== senderWebContentsId) {
      return null
    }
    const guestId = this.webContentsIdByTabId.get(browserTabId)
    if (guestId == null) {
      return null
    }
    const guest = webContents.fromId(guestId)
    if (!guest || guest.isDestroyed()) {
      // Why: a stale guest must clear every per-tab registry entry, not just the WebContents maps.
      this.unregisterGuest(browserTabId)
      return null
    }
    return guest
  },
  hasActiveGrabOp(this: any, browserTabId: string): boolean {
    return this.grabSessionController.hasActiveGrabOp(browserTabId)
  }
}
export type BrowserManagerMethods10Surface = typeof BrowserManagerMethods10
