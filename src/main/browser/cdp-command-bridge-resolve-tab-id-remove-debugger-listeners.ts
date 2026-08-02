import { webContents } from 'electron'
import type {
  BrowserCaptureStartResult,
  BrowserCaptureStopResult,
  BrowserCheckResult,
  BrowserClearResult,
  BrowserClickResult,
  BrowserConsoleEntry,
  BrowserConsoleResult,
  BrowserCookie,
  BrowserCookieDeleteResult,
  BrowserCookieGetResult,
  BrowserCookieSetResult,
  BrowserDragResult,
  BrowserEvalResult,
  BrowserFillResult,
  BrowserFocusResult,
  BrowserGeolocationResult,
  BrowserGotoResult,
  BrowserHoverResult,
  BrowserInterceptDisableResult,
  BrowserInterceptEnableResult,
  BrowserInterceptedRequest,
  BrowserKeypressResult,
  BrowserNetworkEntry,
  BrowserNetworkLogResult,
  BrowserPdfResult,
  BrowserScreenshotResult,
  BrowserScrollResult,
  BrowserSelectAllResult,
  BrowserSelectResult,
  BrowserSnapshotResult,
  BrowserTabInfo,
  BrowserTabListResult,
  BrowserTabSwitchResult,
  BrowserTypeResult,
  BrowserUploadResult,
  BrowserViewportResult,
  BrowserWaitResult
} from '../../shared/runtime-types'
import {
  buildSnapshot,
  type CdpCommandSender,
  type RefEntry,
  type SnapshotResult
} from './snapshot-engine'
import { insertTextThroughCdp } from './browser-text-insertion'
import type { BrowserManager } from './browser-manager'
import { ANTI_DETECTION_SCRIPT } from './anti-detection'

import * as foundation from './cdp-command-bridge-foundation'
const { BrowserError, CAPTURE_LOG_LIMIT } = foundation
type QueuedCommand = foundation.QueuedCommand
type TabState = foundation.TabState

export const CdpBridgeMethods12 = {
  resolveTabId(this: any, webContentsId: number): string {
    for (const [tabId, wcId] of this.getRegisteredTabs()) {
      if (wcId === webContentsId) {
        return tabId
      }
    }
    throw new BrowserError('browser_debugger_detached', 'Tab is no longer registered.')
  }
  resolveTabIdSafe(this: any, webContentsId: number): string | null {
    for (const [tabId, wcId] of this.getRegisteredTabs()) {
      if (wcId === webContentsId) {
        return tabId
      }
    }
    return null
  }
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
  }
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
