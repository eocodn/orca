import type { WebSocket } from 'ws'
import { buildPrintToPdfOptions } from './cdp-print-to-pdf'

export const CdpWsProxyMethods7 = {
  async sendDomFocus(
    this: any,
    client: WebSocket,
    clientId: number,
    params: Record<string, unknown>,
    effectiveSessionId?: string
  ): Promise<Record<string, unknown> | undefined> {
    if (this.webContents.isDestroyed()) {
      this.sendError(clientId, 'Browser tab is no longer available', client)
      return undefined
    }
    try {
      const result = await this.sendDebuggerCommand('DOM.focus', params, effectiveSessionId)
      this.sendResult(clientId, result, client)
      return { ...params }
    } catch (err) {
      this.sendError(clientId, err instanceof Error ? err.message : String(err), client)
      return undefined
    }
  },
  async forwardInsertText(
    this: any,
    client: WebSocket,
    clientId: number,
    params: Record<string, unknown>,
    effectiveSessionId?: string
  ): Promise<void> {
    const pendingFocus = this.pendingDomFocusBySession.get(effectiveSessionId)
    this.pendingDomFocusBySession.delete(effectiveSessionId)
    const pendingFocusParams = pendingFocus ? await pendingFocus : undefined
    // Why: the client can disconnect while DOM.focus is in flight; don't replay its
    // focus or forward its insert into the live page once it is no longer active.
    if (!this.isActiveClient(client)) {
      return
    }
    if (pendingFocusParams) {
      if (this.webContents.isDestroyed()) {
        this.sendError(clientId, 'Browser tab is no longer available', client)
        return
      }
      try {
        await this.sendDebuggerCommand('DOM.focus', pendingFocusParams, effectiveSessionId)
      } catch (err) {
        this.sendError(clientId, err instanceof Error ? err.message : String(err), client)
        return
      }
      // Why: the replay DOM.focus also awaited a round-trip; bail if the client vanished
      // during it so its insert never lands in the live page.
      if (!this.isActiveClient(client)) {
        return
      }
    }
    this.forwardCommand(client, clientId, 'Input.insertText', params, effectiveSessionId)
  },
  async handlePrintToPdf(
    this: any,
    client: WebSocket,
    clientId: number,
    params: Record<string, unknown>
  ): Promise<void> {
    if (this.webContents.isDestroyed()) {
      this.sendError(clientId, 'Browser tab is no longer available', client)
      return
    }
    try {
      const pdf = await this.webContents.printToPDF(buildPrintToPdfOptions(params))
      // Why: printToPDF can resolve after the client disconnected (or was
      // replaced). Bail before registering a stream so its buffer isn't
      // orphaned in pdfStreams past the disconnect's clear() until the TTL.
      if (!this.isActiveClient(client)) {
        return
      }
      const buffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf)
      if (params.transferMode === 'ReturnAsStream') {
        const handle = this.pdfStreams.create(buffer)
        this.sendResult(clientId, { data: '', stream: handle }, client)
        return
      }
      this.sendResult(clientId, { data: buffer.toString('base64') }, client)
    } catch (err) {
      this.sendError(clientId, err instanceof Error ? err.message : String(err), client)
    }
  },
  handleStreamRead(
    this: any,
    client: WebSocket,
    clientId: number,
    params: Record<string, unknown>
  ): void {
    const chunk = this.pdfStreams.read(params)
    if (!chunk) {
      this.sendError(clientId, 'Invalid stream handle', client)
      return
    }
    this.sendResult(clientId, { base64Encoded: true, data: chunk.data, eof: chunk.eof }, client)
  }
}
export type CdpWsProxyMethods7Surface = typeof CdpWsProxyMethods7
