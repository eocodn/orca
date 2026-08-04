import { webContents } from 'electron'
import type {
  BrowserEvalResult,
  BrowserScreenshotResult,
  BrowserTabInfo,
  BrowserTabListResult,
  BrowserTabSwitchResult
} from '../../shared/runtime-types'

import * as foundation from './cdp-command-bridge-foundation'
const { BrowserError } = foundation

export const CdpBridgeMethods10 = {
  async screenshot(this: any, format: 'png' | 'jpeg' = 'png'): Promise<BrowserScreenshotResult> {
    return this.enqueueCommand(async () => {
      const guest = this.getActiveGuest()
      const sender = this.makeCdpSender(guest)
      await this.ensureDebuggerAttached(guest)

      const { data } = (await sender('Page.captureScreenshot', {
        format
      })) as { data: string }

      return { data, format }
    })
  },
  async evaluate(this: any, expression: string): Promise<BrowserEvalResult> {
    return this.enqueueCommand(async () => {
      const guest = this.getActiveGuest()
      const sender = this.makeCdpSender(guest)
      await this.ensureDebuggerAttached(guest)

      const { result, exceptionDetails } = (await sender('Runtime.evaluate', {
        expression,
        returnByValue: true
      })) as {
        result: { value?: unknown; type: string; description?: string }
        exceptionDetails?: { text: string; exception?: { description?: string } }
      }

      if (exceptionDetails) {
        throw new BrowserError(
          'browser_eval_error',
          exceptionDetails.exception?.description ?? exceptionDetails.text
        )
      }

      const valueStr =
        result.value !== undefined ? String(result.value) : (result.description ?? '')
      // Why: include origin to match agent-browser's BrowserEvalResult shape across both bridges.
      const { result: urlResult } = (await sender('Runtime.evaluate', {
        expression: 'location.origin',
        returnByValue: true
      })) as { result: { value: string } }
      return {
        result: valueStr,
        origin: urlResult.value
      }
    })
  },
  tabList(this: any): BrowserTabListResult {
    const tabs: BrowserTabInfo[] = []
    let index = 0

    for (const [tabId, wcId] of this.getRegisteredTabs()) {
      const guest = webContents.fromId(wcId)
      if (!guest || guest.isDestroyed()) {
        continue
      }
      tabs.push({
        browserPageId: tabId,
        index,
        url: guest.getURL(),
        title: guest.getTitle(),
        active: wcId === this.activeWebContentsId
      })
      index++
    }

    return { tabs }
  },
  async tabSwitch(this: any, index: number): Promise<BrowserTabSwitchResult> {
    // Why: filter to live tabs so indices match tabList(), skipping destroyed-but-uncleaned entries.
    const liveEntries = [...this.getRegisteredTabs()].filter(([_, wcId]) => {
      const guest = webContents.fromId(wcId)
      return guest && !guest.isDestroyed()
    })
    if (index < 0 || index >= liveEntries.length) {
      throw new BrowserError(
        'browser_tab_not_found',
        `Tab index ${index} is out of range. ${liveEntries.length} tab(s) open.`
      )
    }

    const [tabId, wcId] = liveEntries[index]
    if (this.activeWebContentsId !== null) {
      this.invalidateRefMap(this.activeWebContentsId)
    }
    this.activeWebContentsId = wcId

    return { switched: index, browserPageId: tabId }
  }
}
export type CdpBridgeMethods10Surface = typeof CdpBridgeMethods10
