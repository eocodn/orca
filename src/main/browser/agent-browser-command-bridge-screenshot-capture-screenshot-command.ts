import { existsSync, readFileSync } from 'node:fs'
import { BrowserError } from './cdp-bridge'
import type { BrowserScreenshotResult } from '../../shared/runtime-types'

// Why: must exceed agent-browser's internal timeouts (goto 30s, wait 60s) so the bridge never kills a command before its own timeout fires.

export const AgentBrowserBridgeMethods13 = {
  async screenshot(
    this: any,
    format?: string,
    worktreeId?: string,
    browserPageId?: string
  ): Promise<BrowserScreenshotResult> {
    // Why: agent-browser writes the screenshot to a temp file and returns its path; read it and return base64.
    return this.enqueueTargetedCommand(
      worktreeId,
      browserPageId,
      async (sessionName) => {
        return this.captureScreenshotCommand(sessionName, ['screenshot'], 300, format)
      },
      { ensureVisible: false }
    )
  },
  async fullPageScreenshot(
    this: any,
    format?: string,
    worktreeId?: string,
    browserPageId?: string
  ): Promise<BrowserScreenshotResult> {
    return this.enqueueTargetedCommand(
      worktreeId,
      browserPageId,
      async (sessionName, target) => {
        return this.captureFullPageScreenshotCommand(
          sessionName,
          target.webContentsId,
          500,
          format === 'jpeg' ? 'jpeg' : 'png'
        )
      },
      { ensureVisible: false }
    )
  },
  readScreenshotFromResult(this: any, raw: unknown, format?: string): BrowserScreenshotResult {
    const parsed = raw as { path?: string } | undefined
    if (!parsed?.path) {
      throw new BrowserError('browser_error', 'Screenshot returned no file path')
    }
    if (!existsSync(parsed.path)) {
      throw new BrowserError('browser_error', `Screenshot file not found: ${parsed.path}`)
    }
    const data = readFileSync(parsed.path).toString('base64')
    return { data, format: format === 'jpeg' ? 'jpeg' : 'png' } as BrowserScreenshotResult
  },
  async captureScreenshotCommand(
    this: any,
    sessionName: string,
    commandArgs: string[],
    settleMs: number,
    format?: string
  ): Promise<BrowserScreenshotResult> {
    return this.withSerializedScreenshotAccess(async () => {
      const session = this.sessions.get(sessionName)
      const restore = session
        ? await this.browserManager.acquireAutomationVisibility(session.webContentsId)
        : () => {}
      try {
        // Why: let the compositor settle to a painted frame after the lease, inside the screenshot lock so another tab can't change lease state first.
        await new Promise((r) => setTimeout(r, settleMs))
        const raw = await this.execAgentBrowser(sessionName, commandArgs)
        return this.readScreenshotFromResult(raw, format)
      } finally {
        restore()
      }
    })
  }
}
export type AgentBrowserBridgeMethods13Surface = typeof AgentBrowserBridgeMethods13
