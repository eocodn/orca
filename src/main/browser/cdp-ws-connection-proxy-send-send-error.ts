import { WebSocket } from 'ws'

export const CdpWsProxyMethods2 = {
  send(this: any, payload: unknown, client = this.client): void {
    const responsePayload = client ? this.addResponseSessionId(payload, client) : payload
    if (client?.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(responsePayload))
    }
  },
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
  },
  sendResult(this: any, clientId: number, result: unknown, client = this.client): void {
    this.send({ id: clientId, result }, client)
  },
  sendError(this: any, clientId: number, message: string, client = this.client): void {
    this.send({ id: clientId, error: { code: -32000, message } }, client)
  }
}
export type CdpWsProxyMethods2Surface = typeof CdpWsProxyMethods2
