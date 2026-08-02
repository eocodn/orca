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

export const CdpBridgeMethods9 = {
  consoleLog(this: any, limit = 100): BrowserConsoleResult {
    const guest = this.getActiveGuest()
    const tabId = this.resolveTabId(guest.id)
    const state = this.getOrCreateTabState(tabId)

    const entries = state.consoleLog.slice(-limit)
    return { entries, truncated: state.consoleLog.length > limit }
  }
  networkLog(this: any, limit = 100): BrowserNetworkLogResult {
    const guest = this.getActiveGuest()
    const tabId = this.resolveTabId(guest.id)
    const state = this.getOrCreateTabState(tabId)

    const entries = state.networkLog.slice(-limit)
    return { entries, truncated: state.networkLog.length > limit }
  }
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
  }
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
