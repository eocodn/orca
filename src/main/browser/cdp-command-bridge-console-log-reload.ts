import type { BrowserConsoleResult, BrowserNetworkLogResult } from '../../shared/runtime-types'

export const CdpBridgeMethods9 = {
  consoleLog(this: any, limit = 100): BrowserConsoleResult {
    const guest = this.getActiveGuest()
    const tabId = this.resolveTabId(guest.id)
    const state = this.getOrCreateTabState(tabId)

    const entries = state.consoleLog.slice(-limit)
    return { entries, truncated: state.consoleLog.length > limit }
  },
  networkLog(this: any, limit = 100): BrowserNetworkLogResult {
    const guest = this.getActiveGuest()
    const tabId = this.resolveTabId(guest.id)
    const state = this.getOrCreateTabState(tabId)

    const entries = state.networkLog.slice(-limit)
    return { entries, truncated: state.networkLog.length > limit }
  },
  async back(this: any): Promise<{ url: string; title: string }> {
    return this.enqueueCommand(async () => {
      const guest = this.getActiveGuest()
      const sender = this.makeCdpSender(guest)
      await this.ensureDebuggerAttached(guest)

      await sender('Page.navigateToHistoryEntry', {
        entryId: await this.getPreviousHistoryEntryId(sender)
      })
      await this.waitForLoad(sender, guest)
      this.invalidateRefMap(guest.id)

      return { url: guest.getURL(), title: guest.getTitle() }
    })
  },
  async reload(this: any): Promise<{ url: string; title: string }> {
    return this.enqueueCommand(async () => {
      const guest = this.getActiveGuest()
      const sender = this.makeCdpSender(guest)
      await this.ensureDebuggerAttached(guest)

      await sender('Page.reload')
      await this.waitForLoad(sender, guest)
      this.invalidateRefMap(guest.id)

      return { url: guest.getURL(), title: guest.getTitle() }
    })
  }
}
export type CdpBridgeMethods9Surface = typeof CdpBridgeMethods9
