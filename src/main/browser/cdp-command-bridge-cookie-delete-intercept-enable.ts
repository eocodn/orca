import type {
  BrowserCookieDeleteResult,
  BrowserGeolocationResult,
  BrowserInterceptEnableResult,
  BrowserViewportResult
} from '../../shared/runtime-types'

export const CdpBridgeMethods7 = {
  async cookieDelete(
    this: any,
    name: string,
    domain?: string,
    url?: string
  ): Promise<BrowserCookieDeleteResult> {
    return this.enqueueCommand(async () => {
      const guest = this.getActiveGuest()
      const sender = this.makeCdpSender(guest)
      await this.ensureDebuggerAttached(guest)

      const params: Record<string, unknown> = { name }
      if (domain) {
        params.domain = domain
      }
      if (url) {
        params.url = url
      }
      // Why: Network.deleteCookies needs a domain or url; infer from the current page if neither was given.
      if (!domain && !url) {
        const { result: urlResult } = (await sender('Runtime.evaluate', {
          expression: 'location.href',
          returnByValue: true
        })) as { result: { value: string } }
        params.url = urlResult.value
      }

      await sender('Network.deleteCookies', params)
      return { deleted: true }
    })
  },
  async setViewport(
    this: any,
    width: number,
    height: number,
    deviceScaleFactor = 1,
    mobile = false
  ): Promise<BrowserViewportResult> {
    return this.enqueueCommand(async () => {
      const guest = this.getActiveGuest()
      const sender = this.makeCdpSender(guest)
      await this.ensureDebuggerAttached(guest)

      await sender('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor,
        mobile
      })
      // Why: metrics-only resize can leave the compositor surface at the old size, cropping remote screencast clients.
      await Promise.resolve(sender('Emulation.setVisibleSize', { width, height })).catch(() => {})

      return { width, height, deviceScaleFactor, mobile }
    })
  },
  async setGeolocation(
    this: any,
    latitude: number,
    longitude: number,
    accuracy = 1
  ): Promise<BrowserGeolocationResult> {
    return this.enqueueCommand(async () => {
      const guest = this.getActiveGuest()
      const sender = this.makeCdpSender(guest)
      await this.ensureDebuggerAttached(guest)

      await sender('Emulation.setGeolocationOverride', { latitude, longitude, accuracy })
      return { latitude, longitude, accuracy }
    })
  },
  async interceptEnable(
    this: any,
    patterns: string[] = ['*']
  ): Promise<BrowserInterceptEnableResult> {
    return this.enqueueCommand(async () => {
      const guest = this.getActiveGuest()
      const sender = this.makeCdpSender(guest)
      await this.ensureDebuggerAttached(guest)

      const tabId = this.resolveTabId(guest.id)
      const state = this.getOrCreateTabState(tabId)

      const requestPatterns = patterns.map((p) => ({ urlPattern: p }))
      await sender('Fetch.enable', { patterns: requestPatterns })

      state.intercepting = true
      state.interceptPatterns = patterns

      return { enabled: true, patterns }
    })
  }
}
export type CdpBridgeMethods7Surface = typeof CdpBridgeMethods7
