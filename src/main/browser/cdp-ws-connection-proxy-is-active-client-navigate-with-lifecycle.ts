import { WebSocketServer, WebSocket } from 'ws'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { WebContents } from 'electron'
import { captureScreenshot } from './cdp-screenshot'
import { buildPrintToPdfOptions, CdpPdfStreamStore } from './cdp-print-to-pdf'
import { ANTI_DETECTION_SCRIPT } from './anti-detection'
import { acquireElectronDebugger, type ElectronDebuggerLease } from './electron-debugger-lease'

import * as foundation from './cdp-ws-connection-proxy-foundation'
const { LIFECYCLE_PRIMING_TIMEOUT_MS } = foundation

export const CdpWsProxyMethods5 = {
  isActiveClient(this: any, client: WebSocket): boolean {
    return this.client === client && client.readyState === WebSocket.OPEN
  }
  sendDebuggerCommand(this: any,
    method: string,
    params: Record<string, unknown>,
    sessionId?: string
  ): Promise<unknown> {
    const command = sessionId
      ? this.webContents.debugger.sendCommand(method, params, sessionId)
      : this.webContents.debugger.sendCommand(method, params)
    return Promise.resolve(command)
  }
  forwardCommand(this: any,
    client: WebSocket,
    clientId: number,
    method: string,
    params: Record<string, unknown>,
    msgSessionId?: string
  ): void {
    if (this.webContents.isDestroyed()) {
      this.sendError(clientId, 'Browser tab is no longer available', client)
      return
    }
    const sessionId = this.resolveDebuggerSessionId(msgSessionId)
    try {
      this.sendDebuggerCommand(method, params, sessionId)
        .then((result) => {
          this.sendResult(clientId, result, client)
        })
        .catch((err: Error) => {
          this.sendError(clientId, err.message, client)
        })
    } catch (err) {
      this.sendError(clientId, err instanceof Error ? err.message : String(err), client)
    }
  }
  async navigateWithLifecycle(this: any,
    client: WebSocket,
    clientId: number,
    params: Record<string, unknown>,
    msgSessionId?: string
  ): Promise<void> {
    await this.primePageLifecycle(this.resolveDebuggerSessionId(msgSessionId))
    if (!this.isActiveClient(client)) {
      return
    }
    this.forwardCommand(client, clientId, 'Page.navigate', params, msgSessionId)
  }
}
export type CdpWsProxyMethods5Surface = typeof CdpWsProxyMethods5
