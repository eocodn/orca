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

export const CdpBridgeMethods15 = {
  async tryRecoverRef(this: any, sender: CdpCommandSender, entry: RefEntry): Promise<number | null> {
    try {
      const { nodes } = (await sender('Accessibility.getFullAXTree')) as {
        nodes: { role?: { value: string }; name?: { value: string }; backendDOMNodeId?: number }[]
      }
      const matches: number[] = []
      for (const node of nodes) {
        if (
          node.role?.value === entry.role &&
          node.name?.value === entry.name &&
          node.backendDOMNodeId
        ) {
          matches.push(node.backendDOMNodeId)
        }
      }

      const targetIndex = (entry.nth ?? 1) - 1
      const candidates = targetIndex < matches.length ? [matches[targetIndex], ...matches] : matches

      for (const backendNodeId of candidates) {
        try {
          await sender('DOM.describeNode', { backendNodeId })
          return backendNodeId
        } catch {
          continue
        }
      }
    } catch {
      // AX tree unavailable — can't recover
    }
    return null
  }
  async getNavigationId(this: any, sender: CdpCommandSender): Promise<string> {
    const { entries, currentIndex } = (await sender('Page.getNavigationHistory')) as {
      entries: { id: number; url: string }[]
      currentIndex: number
    }
    const current = entries[currentIndex]
    return current ? `${current.id}:${current.url}` : 'unknown'
  }
  async getPreviousHistoryEntryId(this: any, sender: CdpCommandSender): Promise<number> {
    const { entries, currentIndex } = (await sender('Page.getNavigationHistory')) as {
      entries: { id: number }[]
      currentIndex: number
    }
    if (currentIndex <= 0) {
      throw new BrowserError('browser_navigation_failed', 'No previous history entry.')
    }
    return entries[currentIndex - 1].id
  }
  async waitForLoad(this: any, sender: CdpCommandSender, guest: Electron.WebContents): Promise<void> {
    // Why: SPAs fire 'load' before async content renders, so also wait for 500ms of network idle.
    const TIMEOUT_MS = 25_000
    const IDLE_MS = 500
    const startedAt = Date.now()

    // Phase 1: wait for readyState=complete
    await new Promise<void>((resolve, reject) => {
      let settled = false
      let pollTimer: ReturnType<typeof setTimeout> | null = null

      const finish = (callback: () => void): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        if (pollTimer) {
          clearTimeout(pollTimer)
          pollTimer = null
        }
        callback()
      }

      const timeout = setTimeout(() => {
        finish(() => reject(new BrowserError('browser_timeout', 'Page load timed out.')))
      }, TIMEOUT_MS)

      const check = async (): Promise<void> => {
        if (settled) {
          return
        }
        try {
          const { result } = (await sender('Runtime.evaluate', {
            expression: 'document.readyState',
            returnByValue: true
          })) as { result: { value: string } }
          if (settled) {
            return
          }
          if (result.value === 'complete') {
            finish(resolve)
          } else {
            pollTimer = setTimeout(() => {
              pollTimer = null
              void check()
            }, 100)
          }
        } catch {
          finish(resolve)
        }
      }
      void check()
    })

    // Phase 2: wait for network idle
    const remaining = TIMEOUT_MS - (Date.now() - startedAt)
    if (remaining <= 0) {
      return
    }
    await this.waitForNetworkIdle(guest, Math.min(remaining, 5000), IDLE_MS)
  }
}
export type CdpBridgeMethods15Surface = typeof CdpBridgeMethods15
