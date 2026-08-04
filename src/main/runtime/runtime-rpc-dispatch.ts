


import type { RuntimeMetadata} from '../../shared/runtime-bootstrap'

import { writeRuntimeMetadata } from './runtime-metadata'


import type { RpcRequest, RpcResponse } from './rpc/core'
import { errorResponse } from './rpc/errors'
import type { RpcMessageContext} from './rpc/transport'

import type { WebSocketTransport } from './rpc/ws-transport'

import type { WebSocket } from 'ws'



import type {
  AuthenticatedMobileSocket} from './rpc/mobile-socket-wiring'




import type {
  PairingGetEndpointsParams,
  PairingProvisionRelayParams
} from '../../shared/mobile-relay-credential-contract'




import { RuntimeRpcTransportServer } from "./runtime-rpc-transport"
import {
  MOBILE_RPC_METHOD_ALLOWLIST,
  injectDeviceScope,
  longPollClassOf,
  type LongPollClass
} from "./runtime-rpc-support"

export class RuntimeRpcDispatchServer extends RuntimeRpcTransportServer {
  protected async handleMessage(
    rawMessage: string,
    context?: RpcMessageContext
  ): Promise<RpcResponse> {
    // Why: the transport sends an empty message when a client exceeds max size, then closes the connection.
    if (!rawMessage) {
      return this.buildError('unknown', 'request_too_large', 'RPC request exceeds the maximum size')
    }

    const parsed = this.parseAndAuth(rawMessage)
    if ('error' in parsed) {
      return parsed.error
    }
    const request = parsed.request

    // Why: long-poll admission fence; short RPCs bypass the counter. See §7 risk #2.
    const longPoll = longPollClassOf(request)
    const rejection = this.admitLongPoll(longPoll)
    if (rejection) {
      return this.buildError(request.id, 'runtime_busy', rejection)
    }
    if (longPoll) {
      // Why: arm keepalive only for long-polls; short RPCs never create the setInterval. See §3.1.
      context?.startKeepalive()
    }

    try {
      return await this.dispatcher.dispatch(request, {
        signal: longPoll ? context?.signal : undefined
      })
    } finally {
      this.releaseLongPoll(longPoll)
    }
  }

  // Why: one fence for both transports — long-poll requests cannot starve short RPCs.
  // Returns the rejection message, or null once the slot is reserved.
  protected admitLongPoll(longPoll: LongPollClass | null): string | null {
    if (!longPoll) {
      return null
    }
    if (this.activeLongPolls >= this.longPollCap) {
      return 'long-poll capacity reached; retry with backoff'
    }
    this.activeLongPolls += 1
    return null
  }

  protected releaseLongPoll(longPoll: LongPollClass | null): void {
    if (!longPoll) {
      return
    }
    this.activeLongPolls = Math.max(0, this.activeLongPolls - 1)
  }

  protected parseAndAuth(rawMessage: string): { request: RpcRequest } | { error: RpcResponse } {
    let request: RpcRequest
    try {
      request = JSON.parse(rawMessage) as RpcRequest
    } catch {
      return { error: this.buildError('unknown', 'bad_request', 'Invalid JSON request') }
    }

    if (typeof request.id !== 'string' || request.id.length === 0) {
      return { error: this.buildError('unknown', 'bad_request', 'Missing request id') }
    }
    if (typeof request.method !== 'string' || request.method.length === 0) {
      return { error: this.buildError(request.id, 'bad_request', 'Missing RPC method') }
    }
    if (typeof request.authToken !== 'string' || request.authToken.length === 0) {
      return { error: this.buildError(request.id, 'unauthorized', 'Missing auth token') }
    }
    if (request.authToken !== this.authToken) {
      return { error: this.buildError(request.id, 'unauthorized', 'Invalid auth token') }
    }

    return { request }
  }

  // Why: WebSocket dispatch is streaming (multiple responses) and auths via per-device tokens, not the shared token.
  protected async handleWebSocketMessage(
    rawMessage: string,
    reply: (response: string) => void,
    sendBinary: (response: Uint8Array<ArrayBufferLike>) => boolean | void,
    wsTransport?: WebSocketTransport,
    ws?: WebSocket,
    authenticatedDeviceToken?: string | null,
    authenticatedSocket?: AuthenticatedMobileSocket
  ): Promise<void> {
    let request: RpcRequest
    try {
      request = JSON.parse(rawMessage) as RpcRequest
    } catch {
      reply(JSON.stringify(this.buildError('unknown', 'bad_request', 'Invalid JSON request')))
      return
    }

    if (typeof request.id !== 'string' || request.id.length === 0) {
      reply(JSON.stringify(this.buildError('unknown', 'bad_request', 'Missing request id')))
      return
    }
    if (typeof request.method !== 'string' || request.method.length === 0) {
      reply(JSON.stringify(this.buildError(request.id, 'bad_request', 'Missing RPC method')))
      return
    }

    const requestToken =
      typeof (request as Record<string, unknown>).deviceToken === 'string'
        ? ((request as Record<string, unknown>).deviceToken as string)
        : null
    if (authenticatedDeviceToken && requestToken && requestToken !== authenticatedDeviceToken) {
      reply(JSON.stringify(this.buildError(request.id, 'unauthorized', 'Device token mismatch')))
      return
    }
    // Why: E2EE already authenticated the channel; authorize by that bound identity, not a repeated request field.
    const token = authenticatedDeviceToken ?? requestToken
    if (!token) {
      reply(JSON.stringify(this.buildError(request.id, 'unauthorized', 'Missing device token')))
      return
    }
    const device = this.deviceRegistry?.validateToken(token)
    if (!device) {
      reply(JSON.stringify(this.buildError(request.id, 'unauthorized', 'Invalid device token')))
      return
    }
    if (device.scope === 'mobile' && !MOBILE_RPC_METHOD_ALLOWLIST.has(request.method)) {
      reply(
        JSON.stringify(
          this.buildError(
            request.id,
            'forbidden',
            `Method '${request.method}' is not available to mobile clients`
          )
        )
      )
      return
    }

    // Why: bind deviceToken to this socket so ws.on('close') knows which mobile client disconnected.
    if (wsTransport && ws) {
      wsTransport.setClientId(ws, token)
    }

    const longPoll = longPollClassOf(request)
    const rejection = this.admitLongPoll(longPoll)
    if (rejection) {
      reply(JSON.stringify(this.buildError(request.id, 'runtime_busy', rejection)))
      return
    }

    const abortRegistration = ws ? this.registerWebSocketDispatchAbort(ws) : null

    // Why: older pairings may lack scope metadata, so stamp the authenticated scope onto status.get.
    const replyForRequest =
      request.method === 'status.get'
        ? (response: string): void => reply(injectDeviceScope(response, device.scope))
        : reply

    const connectionId = ws ? this.mobileSocketWiring?.getConnectionId(ws) : undefined
    const pairingProvider = this.mobileRelayPairingProvider
    const pairingContext =
      pairingProvider && authenticatedSocket
        ? {
            getEndpoints: (params: PairingGetEndpointsParams) =>
              pairingProvider.getEndpoints(
                {
                  deviceId: authenticatedSocket.device.deviceId,
                  connectionId: authenticatedSocket.connectionId,
                  transport: authenticatedSocket.transport
                },
                params
              ),
            provisionRelay: (params: PairingProvisionRelayParams) =>
              pairingProvider.provisionRelay(
                {
                  deviceId: authenticatedSocket.device.deviceId,
                  connectionId: authenticatedSocket.connectionId,
                  transport: authenticatedSocket.transport
                },
                params
              )
          }
        : undefined
    try {
      await this.dispatcher.dispatchStreaming(request, replyForRequest, {
        connectionId,
        clientId: token,
        pairedDeviceId: device.deviceId,
        // Why: gates the mobile-only payload diet so full-screen web/desktop clients aren't truncated.
        clientKind: device.scope,
        clientCapabilities: authenticatedSocket?.clientCapabilities,
        pairing: pairingContext,
        signal: abortRegistration?.signal,
        sendBinary,
        registerBinaryStreamHandler: (streamId, handler) =>
          this.registerBinaryStreamHandler(connectionId, streamId, handler)
      })
    } finally {
      abortRegistration?.dispose()
      this.releaseLongPoll(longPoll)
    }
  }

  protected buildError(id: string, code: string, message: string): RpcResponse {
    return errorResponse(id, { runtimeId: this.runtime.getRuntimeId() }, code, message)
  }

  protected writeMetadata(): void {
    const metadata: RuntimeMetadata = {
      runtimeId: this.runtime.getRuntimeId(),
      pid: this.pid,
      transports: this.transports,
      authToken: this.authToken,
      startedAt: this.runtime.getStartedAt()
    }
    writeRuntimeMetadata(this.userDataPath, metadata)
  }

}
