import type {
  BrowserCaptureStartResult,
  BrowserCaptureStopResult,
  BrowserInterceptDisableResult,
  BrowserInterceptedRequest
} from '../../shared/runtime-types'

export const CdpBridgeMethods8 = {
  async interceptDisable(this: any): Promise<BrowserInterceptDisableResult> {
    return this.enqueueCommand(async () => {
      const guest = this.getActiveGuest()
      const sender = this.makeCdpSender(guest)
      await this.ensureDebuggerAttached(guest)

      const tabId = this.resolveTabId(guest.id)
      const state = this.getOrCreateTabState(tabId)

      await sender('Fetch.disable')
      state.intercepting = false
      state.interceptPatterns = []
      state.pausedRequests.clear()

      return { disabled: true }
    })
  },
  interceptList(this: any): { requests: BrowserInterceptedRequest[] } {
    const guest = this.getActiveGuest()
    const tabId = this.resolveTabId(guest.id)
    const state = this.getOrCreateTabState(tabId)
    return { requests: [...state.pausedRequests.values()] }
  },
  async captureStart(this: any): Promise<BrowserCaptureStartResult> {
    return this.enqueueCommand(async () => {
      const guest = this.getActiveGuest()
      const sender = this.makeCdpSender(guest)
      await this.ensureDebuggerAttached(guest)

      const tabId = this.resolveTabId(guest.id)
      const state = this.getOrCreateTabState(tabId)

      await sender('Runtime.enable')
      state.capturing = true
      state.consoleLog = []
      state.networkLog = []
      state.networkRequestMap.clear()

      return { capturing: true }
    })
  },
  async captureStop(this: any): Promise<BrowserCaptureStopResult> {
    return this.enqueueCommand(async () => {
      const guest = this.getActiveGuest()
      const tabId = this.resolveTabId(guest.id)
      const state = this.getOrCreateTabState(tabId)

      state.capturing = false
      state.networkRequestMap.clear()

      return { stopped: true }
    })
  }
}
export type CdpBridgeMethods8Surface = typeof CdpBridgeMethods8
