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

export const CdpBridgeMethods11 = {
  onTabClosed(this: any, webContentsId: number): void {
    if (this.activeWebContentsId === webContentsId) {
      this.activeWebContentsId = null
    }
    const tabId = this.resolveTabIdSafe(webContentsId)
    if (tabId) {
      const state = this.tabState.get(tabId)
      const guest = webContents.fromId(webContentsId)
      if (state && guest) {
        this.removeDebuggerListeners(guest, state)
      }
      this.tabState.delete(tabId)
      this.commandQueues.delete(tabId)
    }
  }
  onTabChanged(this: any, webContentsId: number): void {
    this.activeWebContentsId = webContentsId
  }
  getActiveGuest(this: any): Electron.WebContents {
    if (this.activeWebContentsId !== null) {
      const guest = webContents.fromId(this.activeWebContentsId)
      if (guest && !guest.isDestroyed()) {
        return guest
      }
      // Why: webContentsId goes stale after a process swap; fall through to auto-select since the tab may have a new id.
      this.activeWebContentsId = null
    }

    const tabs = [...this.getRegisteredTabs()]
    if (tabs.length === 0) {
      throw new BrowserError(
        'browser_no_tab',
        'No browser tab is open. Use the Orca UI to open a browser tab first.'
      )
    }
    if (tabs.length === 1) {
      this.activeWebContentsId = tabs[0][1]
    } else {
      throw new BrowserError(
        'browser_no_tab',
        "Multiple browser tabs are open. Run 'orca tab list' and 'orca tab switch --index <n>' to select one."
      )
    }

    const guest = webContents.fromId(this.activeWebContentsId!)
    if (!guest || guest.isDestroyed()) {
      this.activeWebContentsId = null
      throw new BrowserError(
        'browser_debugger_detached',
        "The active browser tab was closed. Run 'orca tab list' to find remaining tabs."
      )
    }
    return guest
  }
  getRegisteredTabs(this: any): Map<string, number> {
    // Why: reach into BrowserManager's private tab map since it exposes no public listTabs().
    return (this.browserManager as unknown as { webContentsIdByTabId: Map<string, number> })
      .webContentsIdByTabId
  }
}
export type CdpBridgeMethods11Surface = typeof CdpBridgeMethods11
