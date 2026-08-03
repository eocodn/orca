import { type Socket } from 'node:net'
import { StringDecoder } from 'node:string_decoder'
import { encodeNdjson, createNdjsonParser } from './ndjson'
import {
  NOTIFY_PREFIX,
  TerminalAttachCanceledError,
  type DaemonRequest
} from './types'
import { DaemonServerFoundation } from './daemon-server-foundation'

import { type ConnectedClient, type PendingPtySpawnPreparation } from './daemon-server-foundation'

export class DaemonServerPhase1 extends DaemonServerFoundation {
  protected setupControlSocket(socket: Socket, clientId: string): void {
    // Why: decode as a UTF-8 stream so emoji/Unicode split across chunks isn't corrupted.
    const decoder = new StringDecoder('utf8')
    const parser = createNdjsonParser(
      (msg) => this.handleRequest(socket, clientId, msg as DaemonRequest),
      () => {} // Ignore parse errors
    )

    // Remove the initial data listener and replace with the RPC parser
    socket.removeAllListeners('data')
    socket.on('data', (chunk) => parser.feed(decoder.write(chunk)))

    socket.on('close', () => {
      const client = this.clients.get(clientId)
      if (client?.controlSocket !== socket) {
        return
      }
      // Why: a client that disconnects mid-preflight would otherwise still create
      // its daemon PTY, orphaning a durable, unattached session — cancel its preps (F4).
      this.cancelPendingPtySpawnPreparationsForClient(clientId)
      this.historySeedTransfers.clearOwner(clientId)
      const wasFullyAuthenticated = client.authenticatedPairEstablished
      this.streamDataBatcher.clear(clientId)
      client.streamSocket?.destroy()
      this.clients.delete(clientId)
      this.recordFullyAuthenticatedDisconnect(wasFullyAuthenticated)
      this.reevaluateIdleShutdown()
    })
  }

  protected recordFullyAuthenticatedDisconnect(wasFullyAuthenticated: boolean): void {
    if (
      !wasFullyAuthenticated ||
      [...this.clients.values()].some((remaining) => remaining.authenticatedPairEstablished) ||
      this.idleShutdownState !== 'running'
    ) {
      return
    }
    // Why: once the last full client is gone, incomplete transports may block retirement but never erase it.
    this.retirementRequested = true
  }

  protected setupStreamSocket(socket: Socket, client: ConnectedClient): void {
    const previous = client.streamSocket
    socket.removeAllListeners('data')
    client.streamSocket = socket
    // Why: 'drain' is the wake-up for the batcher's shallow-gate held bulk.
    socket.on('drain', () => {
      this.streamDataBatcher.flush(client.clientId)
    })

    const cleanup = (): void => {
      socket.removeListener('close', cleanup)
      socket.removeListener('error', cleanup)
      if (this.clients.get(client.clientId) !== client || client.streamSocket !== socket) {
        return
      }
      // Why: a preflight that outlives its output channel would create an unattached daemon PTY.
      this.cancelPendingPtySpawnPreparationsForClient(client.clientId)
      this.streamDataBatcher.clear(client.clientId)
      client.streamSocket = null
    }

    socket.on('close', cleanup)
    socket.on('error', cleanup)

    if (previous && previous !== socket) {
      // Why: replacing a stream socket must not leave the old channel alive and untracked.
      previous.destroy()
    }
  }

  protected async handleRequest(
    socket: Socket,
    clientId: string,
    request: DaemonRequest
  ): Promise<void> {
    const isNotify = request.id.startsWith(NOTIFY_PREFIX)

    try {
      const result = await this.routeRequest(clientId, request)
      if (!isNotify) {
        const pendingShutdown = this.pendingShutdownReplies.get(
          this.shutdownReplyKey(clientId, request.id)
        )
        socket.write(encodeNdjson({ id: request.id, ok: true, payload: result }), () => {
          pendingShutdown?.start()
        })
      }
    } catch (err) {
      if (!isNotify) {
        socket.write(
          encodeNdjson({
            id: request.id,
            ok: false,
            error: err instanceof Error ? err.message : String(err)
          })
        )
      }
    }
  }

  protected shutdownReplyKey(clientId: string, requestId: string): string {
    return `${clientId}\u0000${requestId}`
  }

  protected deferShutdownUntilReply(
    clientId: string,
    requestId: string,
    socket: Socket,
    finish: () => Promise<void>
  ): void {
    const key = this.shutdownReplyKey(clientId, requestId)
    let started = false
    let timer: ReturnType<typeof setTimeout>
    const start = (): void => {
      if (started) {
        return
      }
      started = true
      clearTimeout(timer)
      socket.off('close', start)
      socket.off('error', start)
      this.pendingShutdownReplies.delete(key)
      if (!this.shutdownPromise) {
        this.shutdownPromise = finish()
      }
    }
    // Why: a non-reading peer must not pin a fenced daemon by holding its ack behind permanent socket backpressure.
    timer = setTimeout(start, DaemonServerFoundation.SHUTDOWN_REPLY_FLUSH_TIMEOUT_MS)
    timer.unref()
    socket.once('close', start)
    socket.once('error', start)
    this.pendingShutdownReplies.set(key, { start })
  }

  protected async preparePtySpawnUnlessCanceled(sessionId: string, clientId: string): Promise<void> {
    const preparation: PendingPtySpawnPreparation = { canceled: false, clientId }
    const pending = this.pendingPtySpawnPreparations.get(sessionId) ?? new Set()
    pending.add(preparation)
    this.pendingPtySpawnPreparations.set(sessionId, pending)
    try {
      // Why: register before the async probe so a concurrent close can cancel this creation before a subprocess exists.
      await this.preparePtySpawn()
      if (preparation.canceled) {
        throw new TerminalAttachCanceledError(sessionId)
      }
    } finally {
      pending.delete(preparation)
      if (pending.size === 0) {
        this.pendingPtySpawnPreparations.delete(sessionId)
      }
    }
  }

  protected cancelPendingPtySpawnPreparations(sessionId: string): boolean {
    const pending = this.pendingPtySpawnPreparations.get(sessionId)
    if (!pending) {
      return false
    }
    for (const preparation of pending) {
      preparation.canceled = true
    }
    return true
  }

  protected cancelAllPendingPtySpawnPreparations(): void {
    for (const sessionId of this.pendingPtySpawnPreparations.keys()) {
      this.cancelPendingPtySpawnPreparations(sessionId)
    }
  }

  protected cancelPendingPtySpawnPreparationsForClient(clientId: string): void {
    for (const pending of this.pendingPtySpawnPreparations.values()) {
      for (const preparation of pending) {
        if (preparation.clientId === clientId) {
          preparation.canceled = true
        }
      }
    }
  }


}
