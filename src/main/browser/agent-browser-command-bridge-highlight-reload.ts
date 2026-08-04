import { BrowserError } from './cdp-bridge'
import type { BrowserBackResult, BrowserReloadResult } from '../../shared/runtime-types'

// Why: must exceed agent-browser's internal timeouts (goto 30s, wait 60s) so the bridge never kills a command before its own timeout fires.

export const AgentBrowserBridgeMethods12 = {
  async highlight(
    this: any,
    selector: string,
    worktreeId?: string,
    browserPageId?: string
  ): Promise<unknown> {
    return this.enqueueTargetedCommand(worktreeId, browserPageId, async (sessionName) => {
      return await this.execAgentBrowser(sessionName, ['highlight', selector])
    })
  },
  async back(this: any, worktreeId?: string, browserPageId?: string): Promise<BrowserBackResult> {
    return this.enqueueTargetedCommand(worktreeId, browserPageId, async (sessionName) => {
      return (await this.execAgentBrowser(sessionName, ['back'])) as BrowserBackResult
    })
  },
  async forward(
    this: any,
    worktreeId?: string,
    browserPageId?: string
  ): Promise<BrowserBackResult> {
    return this.enqueueTargetedCommand(worktreeId, browserPageId, async (sessionName) => {
      return (await this.execAgentBrowser(sessionName, ['forward'])) as BrowserBackResult
    })
  },
  async reload(
    this: any,
    worktreeId?: string,
    browserPageId?: string
  ): Promise<BrowserReloadResult> {
    // Why: reload can trigger an Electron process swap that destroys the session mid-command — reload via webContents directly instead.
    return this.enqueueTargetedCommand(worktreeId, browserPageId, async (_sessionName, target) => {
      const wc = this.getWebContents(target.webContentsId)
      if (!wc) {
        throw new BrowserError('browser_no_tab', 'Tab is no longer available')
      }
      wc.reload()
      await new Promise<void>((resolve) => {
        let settled = false
        let fallbackTimer: ReturnType<typeof setTimeout> | null = null

        const finish = (): void => {
          if (settled) {
            return
          }
          settled = true
          wc.removeListener('did-finish-load', onFinish)
          wc.removeListener('did-fail-load', onFail)
          if (fallbackTimer) {
            clearTimeout(fallbackTimer)
            fallbackTimer = null
          }
          resolve()
        }
        const onFinish = (): void => finish()
        const onFail = (): void => finish()

        wc.on('did-finish-load', onFinish)
        wc.on('did-fail-load', onFail)
        // Why: clear the fallback timer on load; otherwise each reload leaks the webContents + listeners until the 10s timeout.
        fallbackTimer = setTimeout(finish, 10_000)
        if (typeof fallbackTimer.unref === 'function') {
          fallbackTimer.unref()
        }
      })
      return { url: wc.getURL(), title: wc.getTitle() }
    })
  }
}
export type AgentBrowserBridgeMethods12Surface = typeof AgentBrowserBridgeMethods12
