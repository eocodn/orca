import { WebSocketServer, WebSocket } from 'ws'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { WebContents } from 'electron'
import { captureScreenshot } from './cdp-screenshot'
import { buildPrintToPdfOptions, CdpPdfStreamStore } from './cdp-print-to-pdf'
import { ANTI_DETECTION_SCRIPT } from './anti-detection'
import { acquireElectronDebugger, type ElectronDebuggerLease } from './electron-debugger-lease'

import * as foundation from './cdp-ws-connection-proxy-foundation'
const { LIFECYCLE_PRIMING_TIMEOUT_MS } = foundation

export const CdpWsProxyMethods2 = {
  send(this: any, payload: unknown, client = this.client): void {
    const responsePayload = client ? this.addResponseSessionId(payload, client) : payload
    if (client?.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(responsePayload))
    }
  }
  addResponseSessionId(this: any, payload: unknown, client: WebSocket): unknown {
    if (typeof payload !== 'object' || payload === null) {
      return payload
    }
    const clientId = (payload as { id?: unknown }).id
    if (typeof clientId !== 'number') {
      return payload
    }
    const responseSessionIds = this.responseSessionIdsByClient.get(client)
    const sessionId = responseSessionIds?.get(clientId)
    responseSessionIds?.delete(clientId)
    return sessionId ? { ...payload, sessionId } : payload
  }
  sendResult(this: any, clientId: number, result: unknown, client = this.client): void {
    this.send({ id: clientId, result }, client)
  }
  sendError(this: any, clientId: number, message: string, client = this.client): void {
    this.send({ id: clientId, error: { code: -32000, message } }, client)
  }
}
export type CdpWsProxyMethods2Surface = typeof CdpWsProxyMethods2
