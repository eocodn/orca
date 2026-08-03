import {
  FrameDecoder,
  MessageType,
  encodeJsonRpcFrame,
  encodeKeepAliveFrame,
  parseJsonRpcMessage,
  KEEPALIVE_SEND_MS,
  type DecodedFrame,
  type JsonRpcRequest,
  type JsonRpcNotification,
  type JsonRpcResponse
} from './protocol'
import { MAX_TIMER_DELAY_MS, isSafeTimerDelayMs } from '../shared/timer-delay'
import {
  DISPATCHER_CONTROL_QUEUE_MAX_BYTES,
  DEFAULT_PRODUCER_QUEUE_MAX_BYTES,
  DispatcherClientWriter,
  type DispatcherWriterLane,
  type RelayClientSinkOptions,
  type RelayClientWrite,
  type SinkWriteSettlement
} from './dispatcher-client-writer'

export type {
  RelayClientSinkOptions,
  RelayClientWrite,
  SinkWriteSettlement
} from './dispatcher-client-writer'

export type RequestContext = {
  clientId: number
  isStale: () => boolean
  signal?: AbortSignal
  sessionIdentity?: RelayClientSessionIdentity
  onResponseSettled?: (handler: (result: SinkWriteSettlement) => void) => void
}

export type RelayClientSessionIdentity = {
  principal: string
  authenticated: boolean
  allowSessionOwner: boolean
  authenticationKind: 'unproved' | 'launch-nonce' | 'endpoint-credential'
}

export type RelayClientSourceOptions = {
  pauseReads?: () => void
  resumeReads?: () => void
}

export type MethodHandler = (
  params: Record<string, unknown>,
  context: RequestContext
) => Promise<unknown>

export type NotificationHandler = (params: Record<string, unknown>, context: RequestContext) => void

type RelayClient = {
  id: number
  decoder: FrameDecoder
  writer: DispatcherClientWriter
  bulkChain: Promise<void>
  nextOutgoingSeq: number
  highestReceivedSeq: number
  generation: number
  closed: boolean
  sessionIdentity: RelayClientSessionIdentity
}

type PendingRelayRequest = {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const RELAY_TO_CLIENT_REQUEST_TIMEOUT_MS = 30_000

import { RelayDispatcherStage1 } from './dispatcher-routing-stage-1'
export class RelayDispatcherStage2 extends RelayDispatcherStage1 {
  requestAnyClient(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number; excludeClientId?: number }
  ): Promise<unknown> {
    const candidates = Array.from(this.clients.values()).filter(
      (client) => !client.closed && client.id !== options?.excludeClientId
    )
    // Why: prefer a real socket client over the synthetic primary so requests don't forward to a dead stdout.
    const target = candidates.find((client) => client !== this.primaryClient) ?? candidates[0]
    if (!target) {
      return Promise.reject(new Error('No owning Orca client is connected to the relay'))
    }
    return this.requestClient(target.id, method, params, options)
  }

  protected requestClient(
    clientId: number,
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number }
  ): Promise<unknown> {
    const client = this.clients.get(clientId)
    if (this.disposed || !client || client.closed) {
      return Promise.reject(new Error('Relay client is not connected'))
    }
    const timeoutMs = options?.timeoutMs ?? RELAY_TO_CLIENT_REQUEST_TIMEOUT_MS
    if (!isSafeTimerDelayMs(timeoutMs)) {
      return Promise.reject(
        new Error(`Request timeout must be an integer between 0 and ${MAX_TIMER_DELAY_MS}ms`)
      )
    }
    const id = this.nextRequestId++
    const msg: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {})
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRelayRequests.delete(id)
        reject(new Error(`Request "${method}" timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pendingRelayRequests.set(id, { resolve, reject, timer })
      this.enqueueFrame(client, msg, 'control')
    })
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer)
      this.keepaliveTimer = null
    }
    for (const [id, pending] of this.pendingRelayRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Relay dispatcher disposed'))
      this.pendingRelayRequests.delete(id)
    }
    // Why: can't send responses after dispose; abort in-flight work so SSH-side scans/watchers release.
    this.requestAborts.abortAll()
    for (const client of this.clients.values()) {
      client.closed = true
      client.writer.close(new Error('Relay dispatcher disposed'))
    }
    for (const listener of Array.from(this.legacyCapacityListeners)) {
      listener()
    }
    this.legacyCapacityListeners.clear()
    for (const listener of Array.from(this.disposeListeners)) {
      listener()
    }
    this.disposeListeners.clear()
  }

  protected createClient(
    write: RelayClientWrite,
    sinkOptions?: RelayClientSinkOptions,
    sessionIdentity?: RelayClientSessionIdentity,
    sourceOptions?: RelayClientSourceOptions
  ): RelayClient {
    const id = this.nextClientId++
    const client = {
      id,
      decoder: undefined as unknown as FrameDecoder,
      writer: undefined as unknown as DispatcherClientWriter,
      bulkChain: Promise.resolve(),
      nextOutgoingSeq: 1,
      highestReceivedSeq: 0,
      generation: 0,
      closed: false,
      sessionIdentity: sessionIdentity ?? {
        principal: `unproved:${id}`,
        authenticated: false,
        allowSessionOwner: false,
        authenticationKind: 'unproved'
      }
    } satisfies RelayClient
    client.decoder = new FrameDecoder(
      (frame) => this.handleFrame(client, frame),
      (error) => this.closeClient(client, error, client !== this.primaryClient),
      { pause: sourceOptions?.pauseReads, resume: sourceOptions?.resumeReads }
    )
    client.writer = this.createWriter(client, write, sinkOptions)
    return client
  }

  protected resetClient(client: RelayClient): void {
    client.nextOutgoingSeq = 1
    client.highestReceivedSeq = 0
    client.decoder.reset()
    client.generation++
    client.closed = false
  }

  protected handleFrame(client: RelayClient, frame: DecodedFrame): void {
    if (frame.id > client.highestReceivedSeq) {
      client.highestReceivedSeq = frame.id
    }

    if (frame.type === MessageType.KeepAlive) {
      return
    }

    if (frame.type === MessageType.Regular) {
      try {
        const msg = parseJsonRpcMessage(frame.payload)
        this.handleMessage(client, msg)
      } catch (err) {
        process.stderr.write(
          `[relay] Parse error: ${err instanceof Error ? err.message : String(err)}\n`
        )
      }
    }
  }

  protected handleMessage(
    client: RelayClient,
    msg: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse
  ): void {
    if ('id' in msg && 'method' in msg) {
      void this.handleRequest(client, msg as JsonRpcRequest)
    } else if ('id' in msg && ('result' in msg || 'error' in msg)) {
      this.handleResponse(msg as JsonRpcResponse)
    } else if ('method' in msg && !('id' in msg)) {
      this.handleNotification(client, msg as JsonRpcNotification)
    }
  }

  protected handleResponse(msg: JsonRpcResponse): void {
    const pending = this.pendingRelayRequests.get(msg.id)
    if (!pending) {
      return
    }
    clearTimeout(pending.timer)
    this.pendingRelayRequests.delete(msg.id)
    if (msg.error) {
      const error = new Error(msg.error.message) as Error & { code?: number; data?: unknown }
      error.code = msg.error.code
      error.data = msg.error.data
      pending.reject(error)
      return
    }
    pending.resolve(msg.result)
  }

  protected async handleRequest(client: RelayClient, req: JsonRpcRequest): Promise<void> {
    const handler = this.requestHandlers.get(req.method)
    if (!handler) {
      this.sendResponse(client, req.id, undefined, {
        code: -32601,
        message: `Method not found: ${req.method}`
      })
      return
    }

    // Why: snapshot generation before the await to detect if the client disconnected mid-flight.
    const gen = client.generation
    const { key: abortKey, controller: abortController } = this.requestAborts.create(
      client.id,
      req.id
    )
    const responseSettledHandlers = new Set<(result: SinkWriteSettlement) => void>()
    let responseSettled = false
    const settleResponse = (result: SinkWriteSettlement): void => {
      if (responseSettled) {
        return
      }
      responseSettled = true
      for (const callback of responseSettledHandlers) {
        try {
          callback(result)
        } catch (err) {
          process.stderr.write(
            `[relay] Response settlement callback failed: ${err instanceof Error ? err.message : String(err)}\n`
          )
        }
      }
      responseSettledHandlers.clear()
      this.requestAborts.delete(abortKey)
    }
    const context: RequestContext = {
      clientId: client.id,
      isStale: () =>
        client.generation !== gen || !this.clients.has(client.id) || abortController.signal.aborted,
      signal: abortController.signal,
      sessionIdentity: client.sessionIdentity,
      onResponseSettled: (handler) => {
        if (responseSettled) {
          throw new Error('Response settlement callback registered after settlement')
        }
        responseSettledHandlers.add(handler)
      }
    }
    try {
      const result = await handler(req.params ?? {}, context)
      if (context.isStale()) {
        settleResponse({ ok: false, error: new Error('Relay request became stale') })
        return
      }
      const accepted = this.sendResponse(client, req.id, result, undefined, (settlement) => {
        settleResponse(
          context.isStale()
            ? { ok: false, error: new Error('Relay request became stale') }
            : settlement
        )
      })
      if (!accepted) {
        settleResponse({ ok: false, error: new Error('Relay response was not admitted') })
      }
    } catch (err) {
      if (context.isStale()) {
        settleResponse({ ok: false, error: new Error('Relay request became stale') })
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      const code = (err as { code?: number }).code ?? -32000
      const accepted = this.sendResponse(client, req.id, undefined, { code, message }, (result) => {
        settleResponse({
          ok: false,
          error: result.ok ? new Error(message) : result.error
        })
      })
      if (!accepted) {
        settleResponse({ ok: false, error: new Error('Relay error response was not admitted') })
      }
    }
  }

  protected handleNotification(client: RelayClient, notif: JsonRpcNotification): void {
    if (notif.method === 'rpc.cancel') {
      const id = Number((notif.params ?? {}).id)
      const controller = this.requestAborts.get(client.id, id)
      controller?.abort()
      return
    }
    const handler = this.notificationHandlers.get(notif.method)
    if (handler) {
      const gen = client.generation
      handler(notif.params ?? {}, {
        clientId: client.id,
        isStale: () => client.generation !== gen || !this.clients.has(client.id),
        sessionIdentity: client.sessionIdentity,
        onResponseSettled: () => {
          throw new Error('Notifications do not have response publication fences')
        }
      })
    }
  }

  protected sendResponse(
    client: RelayClient,
    id: number,
    result?: unknown,
    error?: { code: number; message: string; data?: unknown },
    onSettled: (result: SinkWriteSettlement) => void = () => {}
  ): boolean {
    const msg: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      ...(error ? { error } : { result: result ?? null })
    }
    const estimatedBytes = this.estimateFrameBytes(msg)
    const lane = estimatedBytes > DISPATCHER_CONTROL_QUEUE_MAX_BYTES ? 'legacy-response' : 'control'
    const accepted = this.enqueueFrame(client, msg, lane, onSettled)
    if (!accepted) {
      this.closeClient(
        client,
        new Error(
          `Relay response exceeds the bounded ${DEFAULT_PRODUCER_QUEUE_MAX_BYTES}-byte legacy lane`
        ),
        client !== this.primaryClient
      )
    }
    return accepted
  }

  protected enqueueFrame(
    client: RelayClient,
    msg: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification,
    lane: DispatcherWriterLane,
    onSettled: (result: SinkWriteSettlement) => void = () => {},
    // Why: publish paths already sized the frame; avoid a redundant encode.
    estimatedBytes?: number
  ): boolean {
    if (this.disposed || client.closed) {
      return false
    }
    const frameBytes = estimatedBytes ?? this.estimateFrameBytes(msg)
    return client.writer.enqueue(
      lane,
      () => {
        const seq = client.nextOutgoingSeq++
        return encodeJsonRpcFrame(msg, seq, client.highestReceivedSeq)
      },
      frameBytes,
      onSettled
    )
  }

  protected startKeepalive(): void {
    this.keepaliveTimer = setInterval(() => {
      if (this.disposed) {
        return
      }
      for (const client of this.clients.values()) {
        if (client.closed) {
          continue
        }
        client.writer.enqueue(
          'liveness',
          () => {
            const seq = client.nextOutgoingSeq++
            return encodeKeepAliveFrame(seq, client.highestReceivedSeq)
          },
          13
        )
      }
    }, KEEPALIVE_SEND_MS)
    // Why: unref so the keepalive interval doesn't pin the event loop and block process exit.
    this.keepaliveTimer.unref()
  }

  protected activeClients(): RelayClient[] {
    return Array.from(this.clients.values()).filter((client) => !client.closed)
  }

  protected activeClientKeys(): string[] {
    return this.activeClients().map((client) => this.clientKey(client))
  }

  protected clientKey(client: RelayClient): string {
    return `${client.id}:${client.generation}`
  }

  protected estimateFrameBytes(msg: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification): number {
    return encodeJsonRpcFrame(msg, 0, 0).length
  }

  protected tryPublishToClients(
    clients: readonly RelayClient[],
    msg: JsonRpcNotification,
    lane: 'interactive' | 'ordinary' | 'bulk'
  ): boolean {
    return this.runPublicationTransaction(() => {
      if (clients.length === 0) {
        return true
      }
      const bytes = this.estimateFrameBytes(msg)
      if (clients.some((client) => !client.writer.canEnqueueProducer(bytes))) {
        return false
      }
      const leases = this.publicationLedger.tryReserve(
        clients.map((client) => ({ clientKey: this.clientKey(client), bytes }))
      )
      if (!leases) {
        return false
      }
      for (let index = 0; index < clients.length; index++) {
        if (!this.enqueueLeasedFrame(clients[index], msg, lane, leases[index], bytes)) {
          if (this.disposed || clients[index].closed) {
            continue
          }
          for (let remaining = index; remaining < leases.length; remaining++) {
            leases[remaining].release()
          }
          return false
        }
      }
      return true
    })
  }

  protected projectToClients(
    clients: readonly RelayClient[],
    msg: JsonRpcNotification,
    lane: 'interactive' | 'ordinary'
  ): boolean {
    return this.runPublicationTransaction(() => {
      for (const client of clients) {
        if (client.closed || this.publishToClient(client, msg, lane)) {
          continue
        }
        this.closeClient(
          client,
          new Error('Relay PTY subscriber projection capacity exceeded'),
          client !== this.primaryClient
        )
      }
      return !this.disposed
    })
  }

}
