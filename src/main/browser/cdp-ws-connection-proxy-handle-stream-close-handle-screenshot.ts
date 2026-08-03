import { WebSocket } from 'ws'
import { captureScreenshot } from './cdp-screenshot'


export const CdpWsProxyMethods8 = {
  handleStreamClose(this: any,
    client: WebSocket,
    clientId: number,
    params: Record<string, unknown>
  ): void {
    this.pdfStreams.close(params)
    this.sendResult(clientId, {}, client)
  },
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
