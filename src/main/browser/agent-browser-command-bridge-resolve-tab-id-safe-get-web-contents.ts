import { type WebContents } from 'electron'

// Why: must exceed agent-browser's internal timeouts (goto 30s, wait 60s) so the bridge never kills a command before its own timeout fires.
import * as foundation from './agent-browser-command-bridge-foundation'
type ResolvedBrowserCommandTarget = foundation.ResolvedBrowserCommandTarget

export const AgentBrowserBridgeMethods26 = {
  resolveTabIdSafe(this: any, webContentsId: number): string | null {
    const tabs = this.browserManager.getWebContentsIdByTabId()
    for (const [tabId, wcId] of tabs) {
      if (wcId === webContentsId) {
        return tabId
      }
    }
    return null
  },
  requireTargetWebContents(this: any, target: ResolvedBrowserCommandTarget): WebContents {
    const wc = this.getWebContents(target.webContentsId)
    if (!wc || wc.isDestroyed()) {
      throw this.createPageUnavailableError(`orca-tab-${target.browserPageId}`)
    }
    return wc
  },
  getWebContents(this: any, webContentsId: number): Electron.WebContents | null {
    try {
      const { webContents } = require('electron')
      const target = webContents.fromId(webContentsId)
      return target && !target.isDestroyed() ? target : null
    } catch {
      return null
    }
  }
}
export type AgentBrowserBridgeMethods26Surface = typeof AgentBrowserBridgeMethods26
