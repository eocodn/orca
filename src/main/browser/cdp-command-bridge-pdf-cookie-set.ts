import type {
  BrowserCookie,
  BrowserCookieGetResult,
  BrowserCookieSetResult,
  BrowserPdfResult,
  BrowserScreenshotResult
} from '../../shared/runtime-types'

import * as foundation from './cdp-command-bridge-foundation'
const { BrowserError } = foundation

export const CdpBridgeMethods6 = {
  async pdf(this: any): Promise<BrowserPdfResult> {
    return this.enqueueCommand(async () => {
      const guest = this.getActiveGuest()
      const sender = this.makeCdpSender(guest)
      await this.ensureDebuggerAttached(guest)

      const { data } = (await sender('Page.printToPDF', {
        printBackground: true
      })) as { data: string }

      return { data }
    })
  },
  async fullPageScreenshot(
    this: any,
    format: 'png' | 'jpeg' = 'png'
  ): Promise<BrowserScreenshotResult> {
    return this.enqueueCommand(async () => {
      const guest = this.getActiveGuest()
      const sender = this.makeCdpSender(guest)
      await this.ensureDebuggerAttached(guest)

      const metrics = (await sender('Page.getLayoutMetrics')) as {
        cssContentSize?: { width: number; height: number }
        contentSize?: { width: number; height: number }
      }
      // Why: screenshot clip uses CSS pixels; on HiDPI, device-pixel contentSize tiles duplicates, so prefer cssContentSize.
      const contentSize = metrics.cssContentSize ?? metrics.contentSize
      if (!contentSize) {
        throw new BrowserError('browser_error', 'Unable to determine full-page screenshot bounds')
      }

      const { data } = (await sender('Page.captureScreenshot', {
        format,
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width: Math.ceil(contentSize.width),
          height: Math.ceil(contentSize.height),
          scale: 1
        }
      })) as { data: string }

      return { data, format }
    })
  },
  async cookieGet(this: any, url?: string): Promise<BrowserCookieGetResult> {
    return this.enqueueCommand(async () => {
      const guest = this.getActiveGuest()
      const sender = this.makeCdpSender(guest)
      await this.ensureDebuggerAttached(guest)

      const params: Record<string, unknown> = {}
      if (url) {
        params.urls = [url]
      }
      const { cookies } = (await sender('Network.getCookies', params)) as {
        cookies: BrowserCookie[]
      }

      return { cookies }
    })
  },
  async cookieSet(
    this: any,
    cookie: {
      name: string
      value: string
      domain?: string
      path?: string
      secure?: boolean
      httpOnly?: boolean
      sameSite?: string
      expires?: number
    }
  ): Promise<BrowserCookieSetResult> {
    return this.enqueueCommand(async () => {
      const guest = this.getActiveGuest()
      const sender = this.makeCdpSender(guest)
      await this.ensureDebuggerAttached(guest)

      // Why: Network.setCookie needs a domain or url to scope the cookie; infer the domain from the current page when omitted.
      let domain = cookie.domain
      if (!domain) {
        const { result: urlResult } = (await sender('Runtime.evaluate', {
          expression: 'location.hostname',
          returnByValue: true
        })) as { result: { value: string } }
        domain = urlResult.value
      }

      const params: Record<string, unknown> = {
        name: cookie.name,
        value: cookie.value,
        domain,
        path: cookie.path ?? '/',
        secure: cookie.secure ?? false,
        httpOnly: cookie.httpOnly ?? false,
        sameSite: cookie.sameSite ?? 'Lax'
      }
      if (cookie.expires !== undefined) {
        params.expires = cookie.expires
      }

      const { success } = (await sender('Network.setCookie', params)) as { success: boolean }
      return { success }
    })
  }
}
export type CdpBridgeMethods6Surface = typeof CdpBridgeMethods6
