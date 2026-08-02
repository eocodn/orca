import { WebSocketServer, WebSocket } from 'ws'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { WebContents } from 'electron'
import { captureScreenshot } from './cdp-screenshot'
import { buildPrintToPdfOptions, CdpPdfStreamStore } from './cdp-print-to-pdf'
import { ANTI_DETECTION_SCRIPT } from './anti-detection'
import { acquireElectronDebugger, type ElectronDebuggerLease } from './electron-debugger-lease'

import * as foundation from './cdp-ws-connection-proxy-foundation'
const { LIFECYCLE_PRIMING_TIMEOUT_MS } = foundation

import { CdpWsProxyMethods1, type CdpWsProxyMethods1Surface } from './cdp-ws-connection-proxy-stop-clear-client-state'
import { CdpWsProxyMethods2, type CdpWsProxyMethods2Surface } from './cdp-ws-connection-proxy-send-send-error'
import { CdpWsProxyMethods3, type CdpWsProxyMethods3Surface } from './cdp-ws-connection-proxy-build-target-info-detach-debugger'
import { CdpWsProxyMethods4, type CdpWsProxyMethods4Surface } from './cdp-ws-connection-proxy-handle-client-message-next-synthetic-browser-session-id'
import { CdpWsProxyMethods5, type CdpWsProxyMethods5Surface } from './cdp-ws-connection-proxy-is-active-client-navigate-with-lifecycle'
import { CdpWsProxyMethods6, type CdpWsProxyMethods6Surface } from './cdp-ws-connection-proxy-reload-with-lifecycle-forward-dom-focus'
import { CdpWsProxyMethods7, type CdpWsProxyMethods7Surface } from './cdp-ws-connection-proxy-send-dom-focus-handle-stream-read'
import { CdpWsProxyMethods8, type CdpWsProxyMethods8Surface } from './cdp-ws-connection-proxy-handle-stream-close-handle-screenshot'

export * from './cdp-ws-connection-proxy-foundation'

export class CdpWsProxy {

  // Why: holds each session's last DOM.focus params to replay right before the next
  // Input.insertText, countering the native webContents.focus() that would blur the target.
  private pendingDomFocusBySession = new Map<
    string | undefined,
    Promise<Record<string, unknown> | undefined>
  >()
  private httpServer: Server | null = null
  private wss: WebSocketServer | null = null
  private client: WebSocket | null = null
  private readonly responseSessionIdsByClient = new WeakMap<WebSocket, Map<number, string>>()
  private detachClientListeners: (() => void) | null = null
  private port = 0
  private debuggerMessageHandler: ((...args: unknown[]) => void) | null = null
  private debuggerDetachHandler: ((...args: unknown[]) => void) | null = null
  private debuggerLease: ElectronDebuggerLease | null = null
  private attached = false
  // Why: agent-browser filters events by sessionId from Target.attachToTarget.
  private clientSessionId: string | undefined = undefined
  private readonly clientSessionIds = new Set<string>()
  private readonly clientBrowserSessionIds = new Set<string>()
  private nextClientSessionOrdinal = 0
  private nextClientBrowserSessionOrdinal = 0
  private readonly pdfStreams = new CdpPdfStreamStore()


  constructor(private readonly webContents: WebContents) {}

  async start(): Promise<string> {
    await this.attachDebugger()
    return new Promise<string>((resolve, reject) => {
      this.httpServer = createServer((req, res) => this.handleHttpRequest(req, res))
      this.wss = new WebSocketServer({ server: this.httpServer })
      const failStart = (error: Error): void => {
        this.httpServer?.removeListener('error', onListenError)
        this.wss?.close()
        this.wss = null
        this.httpServer?.close()
        this.httpServer = null
        // Why: a bind failure happens after debugger attach; release it here
        // because callers cannot safely call stop() on a failed start.
        this.detachDebugger()
        reject(error)
      }
      const onListenError = (error: Error): void => {
        failStart(error)
      }
      this.wss.on('connection', (ws) => {
        this.closeClient()
        this.client = ws
        const onMessage = (data: WebSocket.RawData): void => {
          this.handleClientMessage(ws, data.toString())
        }
        const onClose = (): void => {
          detach()
          if (this.client === ws) {
            this.clearClientState()
            this.client = null
          }
        }
        const detach = (): void => {
          ws.off('message', onMessage)
          ws.off('close', onClose)
          if (this.detachClientListeners === detach) {
            this.detachClientListeners = null
          }
        }
        this.detachClientListeners = detach
        ws.on('message', onMessage)
        ws.on('close', onClose)
      })
      this.httpServer.listen(0, '127.0.0.1', () => {
        this.httpServer?.removeListener('error', onListenError)
        const addr = this.httpServer!.address()
        if (typeof addr === 'object' && addr) {
          this.port = addr.port
          resolve(`ws://127.0.0.1:${this.port}`)
        } else {
          failStart(new Error('Failed to bind proxy server'))
        }
      })
      this.httpServer.once('error', onListenError)
    })
  }
}

export interface CdpWsProxy extends CdpWsProxyMethods1Surface, CdpWsProxyMethods2Surface, CdpWsProxyMethods3Surface, CdpWsProxyMethods4Surface, CdpWsProxyMethods5Surface, CdpWsProxyMethods6Surface, CdpWsProxyMethods7Surface, CdpWsProxyMethods8Surface {}

Object.assign(CdpWsProxy.prototype, CdpWsProxyMethods1, CdpWsProxyMethods2, CdpWsProxyMethods3, CdpWsProxyMethods4, CdpWsProxyMethods5, CdpWsProxyMethods6, CdpWsProxyMethods7, CdpWsProxyMethods8)
