import { createServer, type Server, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { writeFileSync, chmodSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import { encodeNdjson, createNdjsonParser } from './ndjson'
import { TerminalHost } from './terminal-host'
import { DaemonStreamDataBatcher } from './daemon-stream-data-batcher'
import {
  BackgroundTransientFactRelay,
  BACKGROUND_STREAM_DROP_ENABLED
} from './daemon-background-transient-facts'
import { extractHiddenStartupRendererQueryData } from '../../shared/terminal-reply-query-extraction'
import { startDaemonStreamBacklogProbe } from './daemon-stream-backlog-probe'
import type { SubprocessHandle } from './session'
import { checkPtySpawnHealth } from './pty-subprocess'
import { createNoopDaemonFileLog, type DaemonFileLog } from './daemon-file-log'
import { unlinkOwnedDaemonPidFile, unlinkOwnedDaemonTokenFile } from './daemon-spawner'
import {
  CLEAN_DISCONNECT_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  type HelloMessage
} from './types'
import { TerminalHistorySeedTransferRegistry } from './terminal-history-seed-transfer-registry'

export type DaemonServerOptions = {
  socketPath: string
  tokenPath: string
  pidPath?: string
  launchNonce?: string
  startedAtMs?: number
  /** Direct-construction seam for protocol fixture tests; production never overrides it. */
  protocolVersion?: number
  onIdleShutdown?: () => void
  /** Direct-construction-only controls; production uses the compiled initial-adoption timeout. */
  initialAdoptionTestConfig?: {
    timeoutMs: number
    clock: {
      setTimeout(callback: () => void, delayMs: number): unknown
      clearTimeout(handle: unknown): void
      now(): number
    }
  }
  ptySpawnHealthCheck?: () => Promise<void>
  preparePtySpawn?: () => Promise<void>
  // Why: login-session death detection (#7936) probes on PTY-exit bursts and fresh app connections.
  onPtySessionExit?: (sessionId: string) => void
  onAuthenticatedClientPair?: () => void
  log?: DaemonFileLog
  spawnSubprocess: (opts: {
    sessionId: string
    cols: number
    rows: number
    cwd?: string
    env?: Record<string, string>
    command?: string
    shellOverride?: string
  }) => SubprocessHandle
}


export type ConnectedClient = {
  clientId: string
  controlSocket: Socket
  streamSocket: Socket | null
  authenticatedPairEstablished: boolean
}

export type PendingPtySpawnPreparation = {
  canceled: boolean
  // Why: preparations are keyed by sessionId, but a control-socket close must
  // cancel only the disconnecting client's preps, not another client's (F4).
  clientId: string
}

export type PendingShutdownReply = {
  start: () => void
}

export class DaemonServerFoundation {

  [key: string]: any

  // Why: survive long enough to adopt a first client pair, but don't orphan forever if the parent crashes first.
  protected static readonly INITIAL_ADOPTION_TIMEOUT_MS = 2 * 60 * 1000
  protected static readonly SHUTDOWN_REPLY_FLUSH_TIMEOUT_MS = 1_000
  protected server: Server | null = null
  protected token: string
  protected host: TerminalHost
  protected socketPath: string
  protected tokenPath: string
  protected pidPath: string | null
  protected launchNonce: string | null
  protected startedAtMs: number | null
  protected protocolVersion: number
  protected onIdleShutdown: () => void
  protected onAuthenticatedClientPair: () => void
  protected ptySpawnHealthCheck: () => Promise<void>
  protected preparePtySpawn: () => Promise<void>
  protected log: DaemonFileLog
  protected transportSockets = new Set<Socket>()
  protected createOrAttachInFlight = 0
  protected idleShutdownState: 'running' | 'idle-shutdown-pending' | 'shutting-down' = 'running'
  protected initialAdoptionTimer: unknown | null = null
  protected initialAdoptionDeadlineMs: number | null = null
  protected retirementRequested = false
  protected shutdownPromise: Promise<void> | null = null
  protected ordinaryShutdownServerClose: Promise<void> | null = null
  protected pendingShutdownReplies = new Map<string, PendingShutdownReply>()
  protected initialAdoptionTimeoutMs: number
  protected lifecycleClock: NonNullable<DaemonServerOptions['initialAdoptionTestConfig']>['clock']

  protected clients = new Map<string, ConnectedClient>()
  protected streamDataBatcher = new DaemonStreamDataBatcher(
    (clientId) => this.clients.get(clientId),
    {
      isSessionDroppable: (sessionId) =>
        BACKGROUND_STREAM_DROP_ENABLED && this.transientFactRelay.isBackgrounded(sessionId),
      salvageDroppedData: (dropped) => {
        if (!dropped.includes('\x1b')) {
          return ''
        }
        const extracted = extractHiddenStartupRendererQueryData(dropped, '')
        return (
          extracted.statelessQueryData + extracted.statefulQueryData + extracted.oscColorQueryData
        )
      }
    }
  )
  // Facts ride the stream queue as control entries so they hold byte order (else a fact could arrive after the reveal snapshot).
  protected transientFactRelay = new BackgroundTransientFactRelay((sessionId, fact) => {
    const clientId = this.streamClientIdBySessionId.get(sessionId)
    if (clientId) {
      this.streamDataBatcher.enqueueControlEvent(clientId, sessionId, {
        type: 'event',
        event: 'transientFact',
        sessionId,
        payload: fact
      })
    }
  })
  protected streamClientIdBySessionId = new Map<string, string>()
  protected lastInputAtBySessionId = new Map<string, number>()
  protected pendingPtySpawnPreparations = new Map<string, Set<PendingPtySpawnPreparation>>()
  protected historySeedTransfers = new TerminalHistorySeedTransferRegistry()
  protected stopStreamBacklogProbe: () => void = () => {}

  // Why: bypass batching within this window so keystroke echo/redraws skip the daemon's fixed batch delay.
  protected static readonly INTERACTIVE_OUTPUT_WINDOW_MS = 100
  protected static readonly INTERACTIVE_OUTPUT_MAX_CHARS = 1024

  constructor(opts: DaemonServerOptions) {
    this.socketPath = opts.socketPath
    this.tokenPath = opts.tokenPath
    this.pidPath = opts.pidPath ?? null
    this.protocolVersion = opts.protocolVersion ?? PROTOCOL_VERSION
    this.launchNonce =
      opts.launchNonce ??
      (this.protocolVersion >= CLEAN_DISCONNECT_PROTOCOL_VERSION ? randomUUID() : null)
    this.startedAtMs =
      opts.startedAtMs ??
      (this.protocolVersion >= CLEAN_DISCONNECT_PROTOCOL_VERSION
        ? Date.now() - process.uptime() * 1000
        : null)
    this.onIdleShutdown = opts.onIdleShutdown ?? (() => {})
    this.initialAdoptionTimeoutMs =
      opts.initialAdoptionTestConfig?.timeoutMs ?? DaemonServerFoundation.INITIAL_ADOPTION_TIMEOUT_MS
    this.lifecycleClock = opts.initialAdoptionTestConfig?.clock ?? {
      setTimeout: (callback, delayMs) => {
        const timer = setTimeout(callback, delayMs)
        timer.unref()
        return timer
      },
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      now: () => Date.now()
    }
    this.token = randomUUID()
    this.onAuthenticatedClientPair = opts.onAuthenticatedClientPair ?? (() => {})
    this.host = new TerminalHost({
      spawnSubprocess: opts.spawnSubprocess,
      ...(opts.onPtySessionExit ? { onSessionReaped: opts.onPtySessionExit } : {})
    })
    this.ptySpawnHealthCheck = opts.ptySpawnHealthCheck ?? checkPtySpawnHealth
    this.preparePtySpawn = opts.preparePtySpawn ?? (() => Promise.resolve())
    this.stopStreamBacklogProbe = startDaemonStreamBacklogProbe(() => ({
      clients: Array.from(this.clients.values(), (client) => ({
        clientId: client.clientId,
        socketBufferedBytes: client.streamSocket?.writableLength ?? 0,
        batcherQueuedChars: this.streamDataBatcher.queuedCharsForClient(client.clientId)
      })),
      backgroundedSessionIdSuffixes: this.transientFactRelay.backgroundedSessionIdSuffixes()
    }))
    this.log = opts.log ?? createNoopDaemonFileLog()
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => this.handleConnection(socket))
      const onListenError = (err: Error): void => {
        reject(err)
      }

      this.server.once('error', onListenError)

      this.server.listen(this.socketPath, () => {
        // Why: drop the startup error listener after bind so it doesn't retain this closure.
        this.server?.off('error', onListenError)
        writeFileSync(this.tokenPath, this.token, { mode: 0o600 })
        try {
          chmodSync(this.socketPath, 0o600)
        } catch {
          // Best-effort on platforms that support it
        }
        if (this.protocolVersion >= CLEAN_DISCONNECT_PROTOCOL_VERSION) {
          // Why: a parent crash before the first full client pair must not leave an empty daemon alive forever.
          this.armInitialAdoptionTimeout()
        }
        resolve()
      })
    })
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise
    }
    const serverClose = this.beginOrdinaryShutdownFence()
    this.shutdownPromise = this.finishOrdinaryShutdown(serverClose)
    return this.shutdownPromise
  }

  protected beginOrdinaryShutdownFence(): Promise<void> {
    this.idleShutdownState = 'shutting-down'
    this.cancelInitialAdoptionTimer()
    this.ordinaryShutdownServerClose ??= this.beginServerClose()
    return this.ordinaryShutdownServerClose
  }

  protected async finishOrdinaryShutdown(serverClose: Promise<void>): Promise<void> {
    this.unlinkOwnedEndpointArtifacts()
    await this.disposeDaemonResources()
    await serverClose
  }

  protected unlinkOwnedEndpointArtifacts(): void {
    // Why: ownership checks prevent removing a late replacement's token or PID record.
    unlinkOwnedDaemonTokenFile(this.tokenPath, this.token)
    if (this.pidPath && this.launchNonce) {
      unlinkOwnedDaemonPidFile(this.pidPath, process.pid, this.launchNonce)
    }
  }

  protected async disposeDaemonResources(): Promise<void> {
    this.stopStreamBacklogProbe()
    this.transientFactRelay.dispose()
    this.cancelAllPendingPtySpawnPreparations()
    try {
      await this.host.dispose()
    } catch (err) {
      // Why: an unreapable child must not block daemon exit — post-exit it reparents to init anyway.
      this.log.log('shutdown-dispose-failed', {
        error: err instanceof Error ? err.message : String(err)
      })
    }
    this.streamDataBatcher.clear()
    this.historySeedTransfers.dispose()
    this.pendingShutdownReplies.clear()

    for (const [, client] of this.clients) {
      client.controlSocket.destroy()
      client.streamSocket?.destroy()
    }
    this.clients.clear()
    for (const socket of this.transportSockets) {
      socket.destroy()
    }
    this.transportSockets.clear()
  }

  protected beginServerClose(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) {
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      // Why: close synchronously before any awaited cleanup so no new transport enters after the empty proof.
      server.close(() => {
        // Node owns unlinking its Unix listener; an extra unlink here could delete a concurrent replacement.
        resolve()
      })
    })
  }

  protected isIdle(): boolean {
    return (
      this.transportSockets.size === 0 &&
      this.clients.size === 0 &&
      this.createOrAttachInFlight === 0 &&
      this.host.listSessions().length === 0
    )
  }

  protected reevaluateIdleShutdown(): void {
    if (this.idleShutdownState !== 'running') {
      return
    }
    if (this.retirementRequested) {
      this.cancelInitialAdoptionTimer()
      if (this.isIdle()) {
        this.beginIdleShutdown()
      }
      return
    }
    if (!this.isIdle() || this.initialAdoptionDeadlineMs === null) {
      this.cancelInitialAdoptionTimer()
      return
    }
    if (this.initialAdoptionTimer !== null) {
      return
    }
    const remainingMs = Math.max(0, this.initialAdoptionDeadlineMs - this.lifecycleClock.now())
    if (remainingMs === 0) {
      this.initialAdoptionDeadlineMs = null
      this.retirementRequested = true
      this.beginIdleShutdown()
      return
    }
    this.initialAdoptionTimer = this.lifecycleClock.setTimeout(() => {
      this.initialAdoptionTimer = null
      this.initialAdoptionDeadlineMs = null
      this.retirementRequested = true
      this.beginIdleShutdown()
    }, remainingMs)
  }

  protected armInitialAdoptionTimeout(): void {
    this.initialAdoptionDeadlineMs = this.lifecycleClock.now() + this.initialAdoptionTimeoutMs
    this.reevaluateIdleShutdown()
  }

  protected cancelInitialAdoptionTimer(): void {
    if (this.initialAdoptionTimer === null) {
      return
    }
    this.lifecycleClock.clearTimeout(this.initialAdoptionTimer)
    this.initialAdoptionTimer = null
  }

  protected beginIdleShutdown(): void {
    this.initialAdoptionTimer = null
    if (this.idleShutdownState !== 'running') {
      return
    }
    this.idleShutdownState = 'idle-shutdown-pending'
    if (!this.isIdle()) {
      // Why: work admitted before the fence wins; clear pending state to keep it usable.
      this.idleShutdownState = 'running'
      this.reevaluateIdleShutdown()
      return
    }

    this.idleShutdownState = 'shutting-down'
    // beginServerClose() runs synchronously up to server.close() before any yield to a racing connection.
    const serverClose = this.beginServerClose()
    this.shutdownPromise = this.finishIdleShutdown(serverClose)
  }

  protected async finishIdleShutdown(serverClose: Promise<void>): Promise<void> {
    this.unlinkOwnedEndpointArtifacts()
    await this.disposeDaemonResources()
    await serverClose
    this.onIdleShutdown()
  }

  protected handleConnection(socket: Socket): void {
    this.cancelInitialAdoptionTimer()
    this.transportSockets.add(socket)
    const removeTransport = (): void => {
      this.transportSockets.delete(socket)
      this.reevaluateIdleShutdown()
    }
    socket.once('close', removeTransport)
    socket.on('error', () => socket.destroy())

    if (this.idleShutdownState !== 'running') {
      // Why: a connection accepted just before close() gets an explicit retry signal instead of dying mid-auth.
      socket.end(
        encodeNdjson({
          type: 'hello',
          ok: false,
          error: 'Daemon temporarily unavailable; reconnect',
          retryable: true
        })
      )
      return
    }
    // Why: keep UTF-8 sequences intact across socket chunks before NDJSON parsing.
    const decoder = new StringDecoder('utf8')
    const parser = createNdjsonParser(
      (msg) => this.handleFirstMessage(socket, msg, parser),
      () => {
        socket.destroy()
      }
    )

    socket.on('data', (chunk) => parser.feed(decoder.write(chunk)))
  }

  protected handleFirstMessage(
    socket: Socket,
    msg: unknown,
    _parser: ReturnType<typeof createNdjsonParser>
  ): void {
    const hello = msg as HelloMessage
    if (hello.type !== 'hello') {
      this.log.log('client-hello-rejected', { reason: 'expected-hello' })
      socket.write(encodeNdjson({ type: 'hello', ok: false, error: 'Expected hello' }))
      socket.destroy()
      return
    }

    if (hello.version !== this.protocolVersion) {
      this.log.log('client-hello-rejected', {
        reason: 'protocol-mismatch',
        clientVersion: hello.version
      })
      socket.write(encodeNdjson({ type: 'hello', ok: false, error: 'Protocol version mismatch' }))
      socket.destroy()
      return
    }

    if (hello.token !== this.token) {
      this.log.log('client-hello-rejected', { reason: 'invalid-token', role: hello.role })
      socket.write(encodeNdjson({ type: 'hello', ok: false, error: 'Invalid token' }))
      socket.destroy()
      return
    }

    this.log.log('client-hello-accepted', { role: hello.role, clientId: hello.clientId })
    socket.write(
      encodeNdjson({
        type: 'hello',
        ok: true,
        ...(this.launchNonce && this.startedAtMs
          ? {
              daemonIdentity: {
                pid: process.pid,
                startedAtMs: this.startedAtMs,
                launchNonce: this.launchNonce
              }
            }
          : {})
      })
    )

    if (hello.role === 'control') {
      const previous = this.clients.get(hello.clientId)
      const client: ConnectedClient = {
        clientId: hello.clientId,
        controlSocket: socket,
        streamSocket: null,
        authenticatedPairEstablished: false
      }
      this.clients.set(hello.clientId, client)
      this.setupControlSocket(socket, hello.clientId)
      if (previous) {
        // Why: reconnect reuses clientId before stale close fires; cancel the old owner's preflight at handoff.
        this.cancelPendingPtySpawnPreparationsForClient(hello.clientId)
        this.historySeedTransfers.clearOwner(hello.clientId)
        this.recordFullyAuthenticatedDisconnect(previous.authenticatedPairEstablished)
        // Why: tear down the old sockets after installing the new owner so a stale close can't delete the replacement.
        previous.streamSocket?.destroy()
        previous.controlSocket.destroy()
      }
    } else if (hello.role === 'stream') {
      const client = this.clients.get(hello.clientId)
      if (!client) {
        // Why: a stream socket is meaningless without its control socket; drop the orphan.
        socket.destroy()
        return
      }
      this.setupStreamSocket(socket, client)
      client.authenticatedPairEstablished = true
      // Why: one-shot health probes authenticate only a control socket; they are not fresh app activity.
      this.onAuthenticatedClientPair()
      // A complete app connection (unlike a probe) re-owns the endpoint and cancels pending retirement.
      this.initialAdoptionDeadlineMs = null
      this.retirementRequested = false
      this.cancelInitialAdoptionTimer()
    }
  }


}
