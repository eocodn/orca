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

export const CdpBridgeMethods16 = {
  waitForNetworkIdle(this: any,
    guest: Electron.WebContents,
    timeoutMs: number,
    idleMs: number
  ): Promise<void> {
    return new Promise((resolve) => {
      let pending = 0
      let settled = false
      let idleTimer: ReturnType<typeof setTimeout> | null = null
      const overallTimeout = setTimeout(done, timeoutMs)

      function done(): void {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(overallTimeout)
        if (idleTimer) {
          clearTimeout(idleTimer)
        }
        guest.debugger.removeListener('message', onMessage)
        resolve()
      }

      function checkIdle(): void {
        if (pending <= 0) {
          if (idleTimer) {
            clearTimeout(idleTimer)
          }
          idleTimer = setTimeout(done, idleMs)
        }
      }

      function onMessage(_event: unknown, method: string): void {
        if (method === 'Network.requestWillBeSent') {
          pending++
          if (idleTimer) {
            clearTimeout(idleTimer)
            idleTimer = null
          }
        } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
          pending = Math.max(0, pending - 1)
          checkIdle()
        }
      }

      guest.debugger.on('message', onMessage)
      checkIdle()
    })
  }
  invalidateRefMap(this: any, webContentsId: number): void {
    const tabId = this.resolveTabIdSafe(webContentsId)
    if (tabId) {
      const state = this.tabState.get(tabId)
      if (state) {
        state.snapshotResult = null
        state.navigationId = null
      }
    }
  }
  async enqueueCommand<T>(this: any, execute: () => Promise<T>): Promise<T> {
    const guest = this.getActiveGuest()
    const tabId = this.resolveTabId(guest.id)

    return new Promise<T>((resolve, reject) => {
      let queue = this.commandQueues.get(tabId)
      if (!queue) {
        queue = []
        this.commandQueues.set(tabId, queue)
      }
      queue.push({
        execute: execute as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject
      })
      this.processQueue(tabId)
    })
  }
  async processQueue(this: any, tabId: string): Promise<void> {
    if (this.processingQueues.has(tabId)) {
      return
    }
    this.processingQueues.add(tabId)

    const queue = this.commandQueues.get(tabId)
    while (queue && queue.length > 0) {
      const cmd = queue.shift()!
      try {
        const result = await cmd.execute()
        cmd.resolve(result)
      } catch (error) {
        cmd.reject(error)
      }
    }

    this.processingQueues.delete(tabId)
  }
}
export type CdpBridgeMethods16Surface = typeof CdpBridgeMethods16
