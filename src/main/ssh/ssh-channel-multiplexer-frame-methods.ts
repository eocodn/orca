import {
  MessageType,
  encodeJsonRpcFrame,
  encodeKeepAliveFrame,
  parseJsonRpcMessage,
  type DecodedFrame,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse
} from './relay-protocol'
import { messageLane } from './ssh-multiplexer-message-lane'
import type { MultiplexerWriteSettlement } from './ssh-multiplexer-transport-writer'
import {
  MAX_UNACKED_TIMESTAMPS,
  MAX_ORDINARY_UNACKED_TIMESTAMPS,
  type SshMultiplexerDisposeReason
} from './ssh-channel-multiplexer-foundation'

export const SshChannelMultiplexerFrameMethods = {
  dispose(this: any, reason: SshMultiplexerDisposeReason = 'shutdown'): void {
    if (this.disposed) {
      return
    }
    if (process.env.ORCA_SSH_MUX_DEBUG === '1') {
      console.warn(
        `[ssh-mux] Disposing multiplexer (reason: ${reason})`,
        new Error('dispose trace').stack
      )
    }
    this.disposed = true
    if (this.connectionHealthTimer) {
      clearInterval(this.connectionHealthTimer)
      this.connectionHealthTimer = null
    }
    const errorMessage =
      reason === 'connection_lost' ? 'SSH connection lost, reconnecting...' : 'Multiplexer disposed'
    const errorCode = reason === 'connection_lost' ? 'CONNECTION_LOST' : 'DISPOSED'
    for (const waiter of this.livenessProbeWaiters.splice(0)) {
      waiter.fail()
    }
    for (const [id, pending] of this.pendingRequests) {
      pending.cleanup()
      const err = new Error(errorMessage) as Error & { code: string }
      err.code = errorCode
      pending.reject(err)
      this.pendingRequests.delete(id)
    }
    const writerError = new Error(errorMessage) as Error & { code: string }
    writerError.code = errorCode
    this.writer.dispose(writerError)
    this.unackedTimestamps.clear()
    this.notificationHandlers.length = 0
    this.methodNotificationHandlers.clear()
    this.decoder.reset()
    this.transport.close?.()
    for (const handler of this.disposeHandlers) {
      try {
        handler(reason)
      } catch {
        // One subscriber must not prevent the remaining shutdown handlers.
      }
    }
    this.disposeHandlers.length = 0
  },
  isDisposed(this: any): boolean {
    return this.disposed
  },
  sendMessage(
    this: any,
    msg: JsonRpcMessage,
    onSettled?: (result: MultiplexerWriteSettlement) => void
  ): void {
    const seq = this.nextOutgoingSeq++
    const frame = encodeJsonRpcFrame(msg, seq, this.highestReceivedSeq)
    this.trackOutgoingTimestamp(seq, false)
    this.writer.enqueue(frame, messageLane(msg), onSettled)
  },
  sendKeepAlive(this: any): void {
    if (this.disposed) {
      return
    }
    const seq = this.nextOutgoingSeq
    const frame = encodeKeepAliveFrame(seq, this.highestReceivedSeq)
    if (!this.writer.enqueue(frame, 'liveness')) {
      return
    }
    this.nextOutgoingSeq++
    this.trackOutgoingTimestamp(seq, true)
  },
  handleFrame(this: any, frame: DecodedFrame): void {
    for (const waiter of this.livenessProbeWaiters.splice(0)) {
      waiter.succeed()
    }
    if (frame.id > this.highestReceivedSeq) {
      this.highestReceivedSeq = frame.id
    }
    const acknowledgedSeq = Math.min(frame.ack, this.nextOutgoingSeq - 1)
    if (acknowledgedSeq > this.highestAckedBySelf) {
      for (const seq of this.unackedTimestamps.keys()) {
        if (seq <= acknowledgedSeq) {
          this.unackedTimestamps.delete(seq)
        }
      }
      this.highestAckedBySelf = acknowledgedSeq
    }
    if (frame.type === MessageType.KeepAlive) {
      return
    }
    if (frame.type === MessageType.Regular) {
      try {
        this.handleMessage(parseJsonRpcMessage(frame.payload))
      } catch (err) {
        this.handleProtocolError(err)
      }
    }
  },
  handleMessage(this: any, msg: JsonRpcMessage): void {
    if ('id' in msg && ('result' in msg || 'error' in msg)) {
      this.handleResponse(msg as JsonRpcResponse)
    } else if ('id' in msg && 'method' in msg) {
      void this.handleRequest(msg as JsonRpcRequest)
    } else if ('method' in msg && !('id' in msg)) {
      this.handleNotification(msg as JsonRpcNotification)
    }
  },
  async handleRequest(this: any, msg: JsonRpcRequest): Promise<void> {
    const handler = this.requestHandlers.get(msg.method)
    if (!handler) {
      this.sendMessage({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${msg.method}` }
      })
      return
    }
    try {
      const result = await handler(msg.params ?? {})
      this.sendMessage({ jsonrpc: '2.0', id: msg.id, result: result ?? null })
    } catch (err) {
      this.sendMessage({
        jsonrpc: '2.0',
        id: msg.id,
        error: {
          code: (err as { code?: number }).code ?? -32000,
          message: err instanceof Error ? err.message : String(err)
        }
      })
    }
  },
  handleResponse(this: any, msg: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(msg.id)
    if (!pending) {
      return
    }
    pending.cleanup()
    this.pendingRequests.delete(msg.id)
    if (msg.error) {
      const err = new Error(msg.error.message)
      Object.defineProperty(err, 'code', { value: msg.error.code })
      Object.defineProperty(err, 'data', { value: msg.error.data })
      pending.reject(err)
      return
    }
    try {
      pending.beforeResolve?.(msg.result)
      pending.resolve(msg.result)
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)))
    }
  },
  handleNotification(this: any, msg: JsonRpcNotification): void {
    const params = msg.params ?? {}
    for (const handler of Array.from(
      this.notificationHandlers as Array<(method: string, params: Record<string, unknown>) => void>
    )) {
      try {
        handler(msg.method, params)
      } catch (err) {
        console.warn(
          `[ssh-mux] Notification handler failed for ${msg.method}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
    const methodHandlers = this.methodNotificationHandlers.get(msg.method)
    if (!methodHandlers || methodHandlers.size === 0) {
      return
    }
    for (const handler of Array.from(
      methodHandlers as Set<(params: Record<string, unknown>) => void>
    )) {
      try {
        handler(params)
      } catch (err) {
        console.warn(
          `[ssh-mux] Method notification handler failed for ${msg.method}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  },
  handleProtocolError(this: any, err: unknown): void {
    console.warn(`[ssh-mux] Protocol error: ${err instanceof Error ? err.message : String(err)}`)
    this.dispose('connection_lost')
  },
  trackOutgoingTimestamp(this: any, seq: number, liveness: boolean): void {
    const limit = liveness ? MAX_UNACKED_TIMESTAMPS : MAX_ORDINARY_UNACKED_TIMESTAMPS
    if (this.unackedTimestamps.size < limit) {
      this.unackedTimestamps.set(seq, Date.now())
    }
  }
}

export type SshChannelMultiplexerFrameMethodsSurface = typeof SshChannelMultiplexerFrameMethods
