import { WebSocket } from 'ws'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ANTI_DETECTION_SCRIPT } from './anti-detection'
import { acquireElectronDebugger } from './electron-debugger-lease'


export const CdpWsProxyMethods3 = {
  buildTargetInfo(this: any): Record<string, unknown> {
    const destroyed = this.webContents.isDestroyed()
    return {
      targetId: 'orca-proxy-target',
      type: 'page',
      title: destroyed ? '' : this.webContents.getTitle(),
      url: destroyed ? '' : this.webContents.getURL(),
      attached: true,
      canAccessOpener: false
    }
  },
  handleHttpRequest(this: any, req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? ''
    if (url === '/json/version' || url === '/json/version/') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      // Why: agent-browser reads this endpoint to identify the browser. Returning
      // "Orca/CdpWsProxy" leaks that this is an embedded automation surface, which
      // could affect downstream detection heuristics.
      // Why: process.versions.chrome contains the exact Chromium version
      // bundled with Electron, producing a realistic version string.
      const chromeVersion = process.versions.chrome ?? '134.0.0.0'
      res.end(
        JSON.stringify({
          Browser: `Chrome/${chromeVersion}`,
          'Protocol-Version': '1.3',
          webSocketDebuggerUrl: `ws://127.0.0.1:${this.port}`
        })
      )
      return
    }
    if (url === '/json' || url === '/json/' || url === '/json/list' || url === '/json/list/') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify([
          {
            ...this.buildTargetInfo(),
            id: 'orca-proxy-target',
            webSocketDebuggerUrl: `ws://127.0.0.1:${this.port}`
          }
        ])
      )
      return
    }
    res.writeHead(404)
    res.end()
  },
  async attachDebugger(this: any): Promise<void> {
    if (this.attached) {
      return
    }
    try {
      this.debuggerLease = acquireElectronDebugger(this.webContents)
    } catch {
      throw new Error('Could not attach debugger. DevTools may already be open for this tab.')
    }
    this.attached = true

    // Why: attaching the CDP debugger sets navigator.webdriver = true and
    // exposes other automation signals that Cloudflare Turnstile checks.
    // Inject before any page loads so challenges succeed.
    try {
      await this.webContents.debugger.sendCommand('Page.enable', {})
      await this.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: ANTI_DETECTION_SCRIPT
      })
    } catch {
      /* best-effort — page domain may not be ready yet */
    }

    this.debuggerMessageHandler = (_event: unknown, ...rest: unknown[]) => {
      const [method, params, sessionId] = rest as [
        string,
        Record<string, unknown>,
        string | undefined
      ]
      if (!this.client || this.client.readyState !== WebSocket.OPEN) {
        return
      }
      // Why: Electron passes empty string (not undefined) for root-session events, but
      // agent-browser filters events by the sessionId from Target.attachToTarget.
      const msg: Record<string, unknown> = { method, params }
      msg.sessionId = sessionId || this.clientSessionId
      this.client.send(JSON.stringify(msg))
    }
    this.debuggerDetachHandler = () => {
      this.attached = false
      const lease = this.debuggerLease
      this.debuggerLease = null
      lease?.release()
      this.stop()
    }
    this.webContents.debugger.on('message', this.debuggerMessageHandler as never)
    this.webContents.debugger.on('detach', this.debuggerDetachHandler as never)
  },
  detachDebugger(this: any): void {
    if (this.debuggerMessageHandler) {
      this.webContents.debugger.removeListener('message', this.debuggerMessageHandler as never)
      this.debuggerMessageHandler = null
    }
    if (this.debuggerDetachHandler) {
      this.webContents.debugger.removeListener('detach', this.debuggerDetachHandler as never)
      this.debuggerDetachHandler = null
    }
    const lease = this.debuggerLease
    this.debuggerLease = null
    lease?.release()
    this.attached = false
  }
}
export type CdpWsProxyMethods3Surface = typeof CdpWsProxyMethods3
