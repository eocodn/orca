import { WebSocketServer, WebSocket } from 'ws'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { WebContents } from 'electron'
import { captureScreenshot } from './cdp-screenshot'
import { buildPrintToPdfOptions, CdpPdfStreamStore } from './cdp-print-to-pdf'
import { ANTI_DETECTION_SCRIPT } from './anti-detection'
import { acquireElectronDebugger, type ElectronDebuggerLease } from './electron-debugger-lease'

import * as foundation from './cdp-ws-connection-proxy-foundation'
const { LIFECYCLE_PRIMING_TIMEOUT_MS } = foundation

export const CdpWsProxyMethods8 = {
  handleStreamClose(this: any,
    client: WebSocket,
    clientId: number,
    params: Record<string, unknown>
  ): void {
    this.pdfStreams.close(params)
    this.sendResult(clientId, {}, client)
  }
  handleScreenshot(this: any,
    client: WebSocket,
    clientId: number,
    params?: Record<string, unknown>
  ): void {
    captureScreenshot(
      this.webContents,
      params,
      (result) => this.sendResult(clientId, result, client),
      (message) => this.sendError(clientId, message, client)
    )
  }
}
export type CdpWsProxyMethods8Surface = typeof CdpWsProxyMethods8
