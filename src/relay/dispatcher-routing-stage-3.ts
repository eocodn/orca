import {
  DEFAULT_PRODUCER_QUEUE_MAX_BYTES,
  DispatcherClientWriter,
  type RelayClientSinkOptions,
  type RelayClientWrite,
  type SinkWriteSettlement
} from './dispatcher-client-writer';
import {
  type LegacyPublicationLease
} from './legacy-relay-publication-ledger';
import type {
  FrameDecoder
} from './protocol';
import {
  type JsonRpcNotification
} from './protocol';

export type {
  RelayClientSinkOptions,
  RelayClientWrite,
  SinkWriteSettlement
} from './dispatcher-client-writer';

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

import { RelayDispatcherStage2 } from './dispatcher-routing-stage-2';
export class RelayDispatcher extends RelayDispatcherStage2 {
  protected publishToClient(
    client: RelayClient,
    msg: JsonRpcNotification,
    lane: 'interactive' | 'ordinary' | 'fixed-bulk' | 'bulk',
    onSettled: (result: SinkWriteSettlement) => void = () => {}
  ): boolean {
    const bytes = this.estimateFrameBytes(msg)
    const fixedBlocked =
      lane === 'fixed-bulk' &&
      (client.writer.retainedProducerBytes > 0 || bytes > client.writer.fixedFrameCapacity)
    if (fixedBlocked || (lane !== 'fixed-bulk' && !client.writer.canEnqueueProducer(bytes))) {
      return false
    }
    const leases = this.publicationLedger.tryReserve([{ clientKey: this.clientKey(client), bytes }])
    if (!leases) {
      return false
    }
    return this.enqueueLeasedFrame(client, msg, lane, leases[0], bytes, onSettled)
  }

  protected publishBulkWhenAvailable(client: RelayClient, msg: JsonRpcNotification): Promise<void> {
    const bytes = this.estimateFrameBytes(msg)
    const lane = msg.method === 'fs.streamChunk' ? 'fixed-bulk' : 'bulk'
    if (bytes > DEFAULT_PRODUCER_QUEUE_MAX_BYTES) {
      return Promise.reject(new Error('Relay bulk frame exceeds sink producer capacity'))
    }
    if (lane === 'bulk' && bytes > client.writer.producerFrameCapacity) {
      return Promise.reject(new Error('Relay bulk frame exceeds sink frame capacity'))
    }
    return new Promise<void>((resolve, reject) => {
      let removeCapacityListener: (() => void) | null = null
      const finish = (): void => {
        removeCapacityListener?.()
        removeCapacityListener = null
      }
      const tryPublish = (): void => {
        if (this.disposed || client.closed) {
          finish()
          resolve()
          return
        }
        if (
          this.publishToClient(client, msg, lane, (result) => {
            finish()
            if (result.ok || this.disposed || client.closed) {
              resolve()
            } else {
              reject(result.error)
            }
          })
        ) {
          return
        }
        if (!removeCapacityListener) {
          removeCapacityListener = this.onLegacyPtyCapacity(tryPublish)
        }
      }
      tryPublish()
    })
  }

  protected enqueueLeasedFrame(
    client: RelayClient,
    msg: JsonRpcNotification,
    lane: 'interactive' | 'ordinary' | 'fixed-bulk' | 'bulk',
    lease: LegacyPublicationLease,
    estimatedBytes: number,
    onSettled: (result: SinkWriteSettlement) => void = () => {}
  ): boolean {
    const accepted = this.enqueueFrame(
      client,
      msg,
      lane,
      (result) => {
        lease.release()
        onSettled(result)
        this.notifyLegacyCapacityIfLow()
      },
      estimatedBytes
    )
    if (!accepted) {
      lease.release()
      this.notifyLegacyCapacityIfLow()
    }
    return accepted
  }

  protected createWriter(
    client: RelayClient,
    write: RelayClientWrite,
    sinkOptions?: RelayClientSinkOptions
  ): DispatcherClientWriter {
    const writer = new DispatcherClientWriter(write, sinkOptions, (error) => {
      this.closeClient(client, error, client !== this.primaryClient)
    })
    writer.onCapacity(() => this.notifyLegacyCapacityIfLow())
    return writer
  }

  protected closeClient(client: RelayClient, error: Error, remove: boolean): void {
    if (client.closed) {
      return
    }
    client.closed = true
    this.requestAborts.abortClient(client.id)
    client.writer.close(error)
    client.generation++
    if (remove) {
      this.clients.delete(client.id)
    }
    this.notifyClientDetached(client.id)
    this.notifyLegacyCapacity(true)
    if (!/^Relay (?:primary client invalidated|client detached)$/.test(error.message)) {
      process.stderr.write(`[relay] Client write closed: ${error.message}\n`)
    }
  }

  protected notifyLegacyCapacityIfLow(): void {
    this.notifyLegacyCapacity(false)
  }

  protected notifyLegacyCapacity(force: boolean): void {
    if (this.publicationTransactionDepth > 0) {
      this.deferredForcedLegacyCapacity ||= force
      this.deferredLegacyCapacity ||= !force
      return
    }
    if (!force && !this.publicationLedger.belowLowWater(this.activeClientKeys())) {
      return
    }
    for (const listener of this.legacyCapacityListeners) {
      listener()
    }
  }

  protected runPublicationTransaction<T>(operation: () => T): T {
    this.publicationTransactionDepth++
    try {
      return operation()
    } finally {
      this.publicationTransactionDepth--
      if (this.publicationTransactionDepth === 0) {
        const force = this.deferredForcedLegacyCapacity
        const low = this.deferredLegacyCapacity
        this.deferredForcedLegacyCapacity = false
        this.deferredLegacyCapacity = false
        if (force || low) {
          this.notifyLegacyCapacity(force)
        }
      }
    }
  }

  protected notifyClientDetached(clientId: number): void {
    for (const listener of this.clientDetachListeners) {
      try {
        listener(clientId)
      } catch (err) {
        process.stderr.write(
          `[relay] Client detach listener failed: ${err instanceof Error ? err.message : String(err)}\n`
        )
      }
    }
  }
}
