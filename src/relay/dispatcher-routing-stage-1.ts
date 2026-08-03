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
import { ClientRequestAborts } from './client-request-aborts'
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
import {
  LegacyRelayPublicationLedger,
  type LegacyPublicationLease
} from './legacy-relay-publication-ledger'

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

import { RelayDispatcher } from './dispatcher-routing-stage-state'
export class RelayDispatcherStage1 extends RelayDispatcher {
  setWrite(write: RelayClientWrite, sinkOptions?: RelayClientSinkOptions): void {
    this.requestAborts.abortClient(this.primaryClient.id)
    this.primaryClient.closed = true
    this.primaryClient.writer.close(new Error('Relay primary sink replaced'))
    this.resetClient(this.primaryClient)
    this.primaryClient.writer = this.createWriter(this.primaryClient, write, sinkOptions)
  }

  // Why: mark in-flight requests stale on disconnect so a late pty.spawn/fs.watch can't create unowned remote state.
  invalidateClient(): void {
    this.closeClient(this.primaryClient, new Error('Relay primary client invalidated'), false)
  }

  // Why: seq numbers and request ids are per SSH channel, so each attached client needs independent protocol state.
  attachClient(
    write: RelayClientWrite,
    sinkOptions?: RelayClientSinkOptions,
    sessionIdentity?: RelayClientSessionIdentity,
    sourceOptions?: RelayClientSourceOptions
  ): number {
    const client = this.createClient(write, sinkOptions, sessionIdentity, sourceOptions)
    this.clients.set(client.id, client)
    return client.id
  }

  detachClient(clientId: number): void {
    const client = this.clients.get(clientId)
    if (!client || client === this.primaryClient) {
      return
    }
    this.closeClient(client, new Error('Relay client detached'), true)
  }

  feedClient(clientId: number, data: Buffer): void {
    const client = this.clients.get(clientId)
    if (!client) {
      return
    }
    this.feedForClient(client, data)
  }

  onRequest(method: string, handler: MethodHandler): void {
    this.requestHandlers.set(method, handler)
  }

  onNotification(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler)
  }

  onClientDetached(listener: (clientId: number) => void): () => void {
    this.clientDetachListeners.add(listener)
    return () => this.clientDetachListeners.delete(listener)
  }

  onDisposed(listener: () => void): () => void {
    this.disposeListeners.add(listener)
    return () => this.disposeListeners.delete(listener)
  }

  onLegacyPtyCapacity(listener: () => void): () => void {
    this.legacyCapacityListeners.add(listener)
    return () => this.legacyCapacityListeners.delete(listener)
  }

  get legacyRetentionBelowLowWater(): boolean {
    return this.publicationLedger.belowLowWater(this.activeClientKeys())
  }

  writePrimaryBytes(data: Buffer, lane: 'control' | 'ordinary' = 'control'): boolean {
    if (this.disposed || this.primaryClient.closed) {
      return false
    }
    return this.primaryClient.writer.enqueue(lane, () => data, data.length)
  }

  maxLegacyPtyDataChars(
    params: Record<string, unknown>,
    data: string,
    limit = data.length
  ): number {
    const clients = this.activeClients()
    const max = Math.min(data.length, limit)
    if (clients.length === 0) {
      return max
    }
    if (!(max > 0)) {
      return 0
    }
    const fitsAll = (bytes: number): boolean =>
      clients.every((client) => bytes <= client.writer.producerFrameCapacity)
    const sizeFrame = (chunk: string): number =>
      this.estimateFrameBytes({
        jsonrpc: '2.0',
        method: 'pty.data',
        params: { ...params, data: chunk }
      })
    // Fast path: the whole chunk usually fits — one encode instead of log2(n).
    if (fitsAll(sizeFrame(data.slice(0, max)))) {
      return max
    }
    // Exact per-step size: only the escaped data string varies; its quotes are in baseBytes.
    const baseBytes = sizeFrame('')
    const bytesFor = (chars: number): number =>
      baseBytes + Buffer.byteLength(JSON.stringify(data.slice(0, chars))) - 2
    let low = 0
    let high = max
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (fitsAll(bytesFor(mid))) {
        low = mid
      } else {
        high = mid - 1
      }
    }
    return low
  }

  tryNotifyPtyData(
    params: Record<string, unknown>,
    options: { interactive?: boolean } = {}
  ): boolean {
    if (this.disposed) {
      return false
    }
    const msg: JsonRpcNotification = {
      jsonrpc: '2.0',
      method: 'pty.data',
      params
    }
    return this.tryPublishToClients(
      this.activeClients(),
      msg,
      options.interactive ? 'interactive' : 'ordinary'
    )
  }

  tryNotifyPtyDataToMatchingClients(
    matchesClient: (clientId: number) => boolean,
    params: Record<string, unknown>,
    options: { interactive?: boolean } = {}
  ): boolean {
    if (this.disposed) {
      return false
    }
    return this.tryPublishToClients(
      this.activeClients().filter((client) => matchesClient(client.id)),
      { jsonrpc: '2.0', method: 'pty.data', params },
      options.interactive ? 'interactive' : 'ordinary'
    )
  }

  projectPtyDataToMatchingClients(
    matchesClient: (clientId: number) => boolean,
    params: Record<string, unknown>,
    options: { interactive?: boolean } = {}
  ): boolean {
    if (this.disposed) {
      return false
    }
    return this.projectToClients(
      this.activeClients().filter((client) => matchesClient(client.id)),
      { jsonrpc: '2.0', method: 'pty.data', params },
      options.interactive ? 'interactive' : 'ordinary'
    )
  }

  tryNotifyPtyDataToClient(
    clientId: number,
    params: Record<string, unknown>,
    onSettled: (result: SinkWriteSettlement) => void
  ): boolean {
    if (this.disposed) {
      onSettled({ ok: false, error: new Error('Relay dispatcher is disposed') })
      return false
    }
    const client = this.clients.get(clientId)
    if (!client || client.closed) {
      onSettled({ ok: false, error: new Error('Relay client is not connected') })
      return false
    }
    return this.publishToClient(
      client,
      { jsonrpc: '2.0', method: 'pty.data', params },
      'ordinary',
      onSettled
    )
  }

  tryNotifyPtyExit(params: Record<string, unknown>): boolean {
    if (this.disposed) {
      return false
    }
    return this.tryPublishToClients(
      this.activeClients(),
      {
        jsonrpc: '2.0',
        method: 'pty.exit',
        params
      },
      'ordinary'
    )
  }

  tryNotifyPtyExitToMatchingClients(
    matchesClient: (clientId: number) => boolean,
    params: Record<string, unknown>
  ): boolean {
    if (this.disposed) {
      return false
    }
    return this.tryPublishToClients(
      this.activeClients().filter((client) => matchesClient(client.id)),
      { jsonrpc: '2.0', method: 'pty.exit', params },
      'ordinary'
    )
  }

  projectPtyExitToMatchingClients(
    matchesClient: (clientId: number) => boolean,
    params: Record<string, unknown>
  ): boolean {
    if (this.disposed) {
      return false
    }
    return this.projectToClients(
      this.activeClients().filter((client) => matchesClient(client.id)),
      { jsonrpc: '2.0', method: 'pty.exit', params },
      'ordinary'
    )
  }

  tryNotifyPtyExitToClient(
    clientId: number,
    params: Record<string, unknown>,
    onSettled: (result: SinkWriteSettlement) => void
  ): boolean {
    if (this.disposed) {
      onSettled({ ok: false, error: new Error('Relay dispatcher is disposed') })
      return false
    }
    const client = this.clients.get(clientId)
    if (!client || client.closed) {
      onSettled({ ok: false, error: new Error('Relay client is not connected') })
      return false
    }
    return this.publishToClient(
      client,
      { jsonrpc: '2.0', method: 'pty.exit', params },
      'ordinary',
      onSettled
    )
  }

  producerDataBudget(
    method: string,
    paramsWithoutData: Record<string, unknown>,
    clientId?: number
  ): number {
    const targets =
      clientId === undefined
        ? this.activeClients()
        : [this.clients.get(clientId)].filter((client): client is RelayClient => !!client)
    if (targets.length === 0) {
      return Number.MAX_SAFE_INTEGER
    }
    const emptyFrameBytes = this.estimateFrameBytes({
      jsonrpc: '2.0',
      method,
      params: { ...paramsWithoutData, data: '' }
    })
    return Math.max(
      0,
      Math.min(...targets.map((client) => client.writer.producerFrameCapacity - emptyFrameBytes))
    )
  }

  feed(data: Buffer): void {
    this.feedForClient(this.primaryClient, data)
  }

  protected feedForClient(client: RelayClient, data: Buffer): void {
    if (this.disposed) {
      return
    }
    try {
      client.decoder.feed(data)
    } catch (err) {
      process.stderr.write(
        `[relay] Protocol error: ${err instanceof Error ? err.message : String(err)}\n`
      )
    }
  }

  notify(method: string, params?: Record<string, unknown>): void {
    if (this.disposed) {
      return
    }
    const msg: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {})
    }
    this.runPublicationTransaction(() => {
      for (const client of this.clients.values()) {
        if (client.closed) {
          continue
        }
        if (method === 'pty.replay') {
          this.enqueueFrame(client, msg, 'control')
          continue
        }
        if (!this.publishToClient(client, msg, 'ordinary')) {
          this.closeClient(
            client,
            new Error('Relay ordinary publication capacity exceeded'),
            client !== this.primaryClient
          )
        }
      }
    })
  }

  notifyClient(clientId: number, method: string, params?: Record<string, unknown>): void {
    this.tryNotifyClient(clientId, method, params)
  }

  tryNotifyClient(
    clientId: number,
    method: string,
    params?: Record<string, unknown>,
    onSettled: (result: SinkWriteSettlement) => void = () => {}
  ): boolean {
    if (this.disposed) {
      onSettled({ ok: false, error: new Error('Relay dispatcher is disposed') })
      return false
    }
    const client = this.clients.get(clientId)
    if (!client || client.closed) {
      onSettled({ ok: false, error: new Error('Relay client is not connected') })
      return false
    }
    return this.enqueueFrame(
      client,
      {
        jsonrpc: '2.0',
        method,
        ...(params !== undefined ? { params } : {})
      },
      'control',
      onSettled
    )
  }

  notifyControl(method: string, params?: Record<string, unknown>): void {
    if (this.disposed) {
      return
    }
    const msg: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {})
    }
    for (const client of this.activeClients()) {
      if (!this.enqueueFrame(client, msg, 'control')) {
        this.closeClient(
          client,
          new Error('Relay control publication capacity exceeded'),
          client !== this.primaryClient
        )
      }
    }
  }

  /**
   * Bulk-lane notification: sends are serialized per client and the promise
   * resolves only after the sink accepted the frame (backpressure), so bulk
   * producers await between frames and never starve interactive frames.
   * With `clientId`, targets only that client — broadcasting would let one slow secondary stall everyone.
   */
  notifyBulk(
    method: string,
    params?: Record<string, unknown>,
    opts?: { clientId?: number }
  ): Promise<void> {
    if (this.disposed) {
      return Promise.resolve()
    }
    const msg: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {})
    }
    const targets =
      opts?.clientId !== undefined
        ? [this.clients.get(opts.clientId)].filter((c): c is RelayClient => c !== undefined)
        : Array.from(this.clients.values())
    const waits: Promise<void>[] = []
    for (const client of targets) {
      if (client.closed) {
        continue
      }
      const step = client.bulkChain.then(() => this.publishBulkWhenAvailable(client, msg))
      client.bulkChain = step.catch(() => {})
      waits.push(step)
    }
    if (waits.length === 0) {
      return Promise.resolve()
    }
    return Promise.all(waits).then(() => {})
  }

  requestPrimary(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number }
  ) {
    return this.requestClient(this.primaryClient.id, method, params, options)
  }

}
