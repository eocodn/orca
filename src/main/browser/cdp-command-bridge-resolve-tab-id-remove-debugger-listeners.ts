import * as foundation from './cdp-command-bridge-foundation'
const { BrowserError } = foundation
type TabState = foundation.TabState

export const CdpBridgeMethods12 = {
  resolveTabId(this: any, webContentsId: number): string {
    for (const [tabId, wcId] of this.getRegisteredTabs()) {
      if (wcId === webContentsId) {
        return tabId
      }
    }
    throw new BrowserError('browser_debugger_detached', 'Tab is no longer registered.')
  },
  resolveTabIdSafe(this: any, webContentsId: number): string | null {
    for (const [tabId, wcId] of this.getRegisteredTabs()) {
      if (wcId === webContentsId) {
        return tabId
      }
    }
    return null
  },
  getOrCreateTabState(this: any, tabId: string): TabState {
    let state = this.tabState.get(tabId)
    if (!state) {
      state = {
        navigationId: null,
        snapshotResult: null,
        debuggerAttached: false,
        debuggerDetachListener: null,
        debuggerMessageListener: null,
        iframeSessions: new Map(),
        capturing: false,
        consoleLog: [],
        networkLog: [],
        intercepting: false,
        interceptPatterns: [],
        pausedRequests: new Map(),
        networkRequestMap: new Map()
      }
      this.tabState.set(tabId, state)
    }
    return state
  },
  removeDebuggerListeners(this: any, guest: Electron.WebContents, state: TabState): void {
    const detachListener = state.debuggerDetachListener
    const messageListener = state.debuggerMessageListener
    state.debuggerDetachListener = null
    state.debuggerMessageListener = null

    if (detachListener) {
      try {
        guest.debugger.removeListener('detach', detachListener as never)
      } catch {
        // guest may already be destroyed
      }
    }
    if (messageListener) {
      try {
        guest.debugger.removeListener('message', messageListener as never)
      } catch {
        // guest may already be destroyed
      }
    }
  }
}
export type CdpBridgeMethods12Surface = typeof CdpBridgeMethods12
