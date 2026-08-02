import { WebSocketServer, WebSocket } from 'ws'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { WebContents } from 'electron'
import { captureScreenshot } from './cdp-screenshot'
import { buildPrintToPdfOptions, CdpPdfStreamStore } from './cdp-print-to-pdf'
import { ANTI_DETECTION_SCRIPT } from './anti-detection'
import { acquireElectronDebugger, type ElectronDebuggerLease } from './electron-debugger-lease'

import * as foundation from './cdp-ws-connection-proxy-foundation'
const { LIFECYCLE_PRIMING_TIMEOUT_MS } = foundation

export const CdpWsProxyMethods1 = {
  async stop(this: any): Promise<void> {
    this.detachDebugger()
    this.closeClient()
    if (this.wss) {
      this.wss.close()
      this.wss = null
    }
    if (this.httpServer) {
      this.httpServer.close()
      this.httpServer = null
    }
  }
  getPort(this: any): number {
    return this.port
  }
  closeClient(this: any): void {
    const client = this.client
    this.detachClientListeners?.()
    this.detachClientListeners = null
    this.client = null
    this.clearClientState()
    if (client) {
      this.responseSessionIdsByClient.delete(client)
    }
    client?.close()
  }
  clearClientState(this: any): void {
    // Why: session and focus state belongs to one websocket and must not cross client replacement.
    this.pendingDomFocusBySession.clear()
    this.pdfStreams.clear()
    this.clientSessionId = undefined
    this.clientSessionIds.clear()
    this.clientBrowserSessionIds.clear()
    this.nextClientSessionOrdinal = 0
    this.nextClientBrowserSessionOrdinal = 0
  }
}
export type CdpWsProxyMethods1Surface = typeof CdpWsProxyMethods1
