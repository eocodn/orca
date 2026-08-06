import { createServer, createConnection, type Socket, type Server } from 'node:net'
import { statSync, unlinkSync } from 'node:fs'
import { RELAY_SENTINEL } from './protocol'
import { setupDaemonHandshake } from './relay-handshake'
import type { RelayDispatcher } from './dispatcher'
import type { PtyHandler } from './pty-handler'
import type { FsHandler } from './fs-handler'
import type { GitHandler } from './git-handler'
import type { SshPtyConsumerSessionAdapter } from './ssh-pty-consumer-session-adapter'
import type { RelayPtySourcePublication } from './relay-pty-source-publication'
import { relayLogLine } from './relay-diagnostic-log'

const STALE_SOCKET_PROBE_TIMEOUT_MS = 500
const EMPTY_DETACHED_STARTUP_GRACE_MS = 60_000
type SocketIdentity = { dev: bigint; ino: bigint; ctimeNs: bigint }
function sameSocketIdentity(a: SocketIdentity, b: SocketIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.ctimeNs === b.ctimeNs
}
function readSocketIdentity(sockPath: string): SocketIdentity | null {
  if (process.platform === 'win32' && /^\\\\[.?]\\pipe\\/i.test(sockPath)) {return null}
  try {
    const stat = statSync(sockPath, { bigint: true })
    return { dev: stat.dev, ino: stat.ino, ctimeNs: stat.ctimeNs }
  } catch {
    return null
  }
}
function isWindowsNamedPipePath(sockPath: string): boolean {
  return process.platform === 'win32' && /^\\\\[.?]\\pipe\\/i.test(sockPath)
}

export type RelaySocketTransportState = {
  stdoutAlive: boolean
  flushStdoutDrainWaiters: () => void
}
export type RelaySocketOwnership = {
  ownsSocketPath: boolean
  ownedSocketIdentity: SocketIdentity | null
}
export type RelaySocketLifecycleState = {
  dispatcher: RelayDispatcher
  detached: boolean
  graceTimeMs: number
  sockPath: string
  endpointCredential?: string
  launchVersion: string
  ptyHandler: PtyHandler
  ptyConsumerSessionAdapter: SshPtyConsumerSessionAdapter
  ptySourcePublication: RelayPtySourcePublication
  fsHandler: FsHandler
  gitHandler: GitHandler
  transportState: RelaySocketTransportState
  socketOwnership: RelaySocketOwnership
  ownsCurrentSocketPath: () => boolean
  cleanupOwnedSocket: () => void
}

export async function runRelaySocketLifecycle(state: RelaySocketLifecycleState): Promise<void> {
  const {
    dispatcher,
    detached,
    graceTimeMs,
    sockPath,
    endpointCredential,
    launchVersion,
    ptyHandler,
    ptyConsumerSessionAdapter,
    ptySourcePublication,
    fsHandler,
    gitHandler,
    transportState,
    socketOwnership,
    ownsCurrentSocketPath,
    cleanupOwnedSocket
  } = state
  // ── Socket server for reconnection ──────────────────────────────────
  // Why: the SSH channel dies on app restart; a Unix socket lets a new --connect bridge reach the dispatcher that owns live PTYs.

  const socketClients = new Map<Socket, number>()
  let socketServer: Server | null = null
  const startedAt = Date.now()
  let acceptedSocketConnections = 0
  let hasAcceptedSocketClient = false
  let graceDeadlineAt: number | null = null
  let graceReason: string | null = null

  dispatcher.onRequest('relay.status', async () => ({
    pid: process.pid,
    uptimeMs: Date.now() - startedAt,
    detached,
    stdoutAlive: transportState.stdoutAlive,
    memory: process.memoryUsage(),
    ptys: {
      active: ptyHandler.activePtyCount
    },
    ptySourceCredit: {
      enabled: true,
      session: ptyConsumerSessionAdapter.getDebugSnapshot(),
      publication: ptySourcePublication.getDebugSnapshot()
    },
    socket: {
      path: sockPath,
      owned: socketOwnership.ownsSocketPath,
      listening: socketServer?.listening ?? false,
      clients: socketClients.size,
      acceptedConnections: acceptedSocketConnections
    },
    grace: {
      active: ptyHandler.graceTimerActive,
      deadlineAt: graceDeadlineAt,
      reason: graceReason
    }
  }))

  function cancelGrace(reason: string): void {
    if (ptyHandler.graceTimerActive) {
      relayLogLine(`[relay] Grace canceled: ${reason}`)
    }
    graceDeadlineAt = null
    graceReason = null
    ptyHandler.cancelGraceTimer()
  }

  function attachAcceptedSocket(sock: Socket, leftover: Buffer): void {
    // Why: remove the initial stdin data listener once a socket client is accepted, so stale SSH-channel bytes can't interleave.
    process.stdin.pause()
    process.stdin.removeAllListeners('data')

    hasAcceptedSocketClient = true
    acceptedSocketConnections++
    relayLogLine(
      `[relay] Socket client accepted (clients=${socketClients.size + 1}, accepted=${acceptedSocketConnections})`
    )
    cancelGrace('socket client accepted')

    // Why: same backpressure surface as stdout — bulk frames wait for socket drain so they can't bury interactive PTY frames.
    const sockDrainWaiters = new Set<() => void>()
    const flushSockDrainWaiters = (): void => {
      for (const cb of Array.from(sockDrainWaiters)) {
        sockDrainWaiters.delete(cb)
        cb()
      }
    }
    sock.on('drain', flushSockDrainWaiters)
    sock.on('close', flushSockDrainWaiters)
    sock.on('error', flushSockDrainWaiters)
    const clientId = dispatcher.attachClient(
      (data, onSettled) => {
        if (!sock.destroyed) {
          return sock.write(data, (error) => {
            onSettled(error ? { ok: false, error } : { ok: true })
          })
        }
        onSettled({ ok: false, error: new Error('Relay socket is closed') })
        return false
      },
      {
        supportsWriteCallback: true,
        writableLength: () => sock.writableLength,
        writableHighWaterMark: () => sock.writableHighWaterMark,
        close: () => sock.destroy(),
        waitWriteDrain: (cb) => {
          if (sock.destroyed) {
            cb()
            return
          }
          sockDrainWaiters.add(cb)
          return () => sockDrainWaiters.delete(cb)
        }
      },
      {
        principal: `relay-endpoint:${launchVersion}`,
        authenticated: endpointCredential !== undefined,
        allowSessionOwner: endpointCredential !== undefined,
        authenticationKind: endpointCredential ? 'endpoint-credential' : 'unproved'
      },
      {
        pauseReads: () => sock.pause(),
        resumeReads: () => sock.resume()
      }
    )
    socketClients.set(sock, clientId)

    // Why: feed handshake-buffered leftover bytes before wiring sock.on('data') so frame ordering is preserved.
    if (leftover.length > 0) {
      dispatcher.feedClient(clientId, leftover)
    }

    sock.on('data', (chunk: Buffer) => {
      cancelGrace('socket client data')
      dispatcher.feedClient(clientId, chunk)
    })
  }

  async function startSocketServer(): Promise<Server> {
    const server = createServer((sock) => {
      // Why: pre-dispatcher version handshake — see relay-handshake.ts.
      setupDaemonHandshake(sock, {
        launchVersion,
        endpointCredential,
        onAccepted: attachAcceptedSocket
      })

      // Why: destroy on 'end' (FIN from --connect's dying channel) so the 'close' handler fires promptly and the daemon enters grace.
      sock.on('end', () => {
        if (!sock.destroyed) {
          sock.destroy()
        }
      })

      sock.on('error', () => {
        // Why: Node emits 'error' then 'close'; the close handler owns cleanup and grace startup.
      })

      sock.on('close', () => {
        const clientId = socketClients.get(sock)
        socketClients.delete(sock)
        if (clientId !== undefined) {
          dispatcher.detachClient(clientId)
        }
        relayLogLine(`[relay] Socket client closed (clients=${socketClients.size})`)
        if (!transportState.stdoutAlive && socketClients.size === 0) {
          startGrace('socket client closed')
        }
      })
    })

    // Why: umask 0o177 before listen makes the socket 0o600 atomically, closing the chmod-after-listen TOCTOU window.
    const shouldSetSocketUmask = !isWindowsNamedPipePath(sockPath)
    const prevUmask = shouldSetSocketUmask ? process.umask(0o177) : 0
    let umaskRestored = false
    const restoreUmask = (): void => {
      if (shouldSetSocketUmask && !umaskRestored) {
        process.umask(prevUmask)
        umaskRestored = true
      }
    }

    await new Promise<void>((resolve, reject) => {
      let staleRetryAttempted = false

      function removeStartupListeners(): void {
        server.off('listening', onListening)
        server.off('error', onInitialError)
        server.off('error', failInitial)
      }

      function listenForStartupError(onError: (err: NodeJS.ErrnoException) => void): void {
        server.once('listening', onListening)
        server.once('error', onError)
        server.listen(sockPath)
      }

      function onListening(): void {
        removeStartupListeners()
        restoreUmask()
        socketOwnership.ownsSocketPath = true
        socketOwnership.ownedSocketIdentity = readSocketIdentity(sockPath)
        server.on('error', (err) => {
          relayLogLine(`[relay] Socket server error: ${err.message}`)
        })
        relayLogLine(`[relay] Socket server listening: ${sockPath}`)
        resolve()
      }

      function failInitial(err: NodeJS.ErrnoException): void {
        removeStartupListeners()
        restoreUmask()
        if (err.code === 'EADDRINUSE') {
          relayLogLine(
            `[relay] Socket path already in use: ${sockPath}; another relay is likely active. Use --connect instead of starting a new daemon.`
          )
        } else {
          relayLogLine(`[relay] Socket server error before listen: ${err.message}`)
        }
        reject(err)
      }

      function unlinkIfStillStale(blockedIdentity: SocketIdentity | null): boolean {
        const currentIdentity = readSocketIdentity(sockPath)
        if (currentIdentity === null) {
          return true
        }
        if (blockedIdentity === null || !sameSocketIdentity(currentIdentity, blockedIdentity)) {
          return false
        }
        try {
          unlinkSync(sockPath)
          return true
        } catch (unlinkErr) {
          const e = unlinkErr as NodeJS.ErrnoException
          return e.code === 'ENOENT'
        }
      }

      // Why: EADDRINUSE may be a stale socket from a crashed relay, not a live one; probe-connect to tell them apart before unlinking.
      function onInitialError(err: NodeJS.ErrnoException): void {
        if (err.code !== 'EADDRINUSE' || staleRetryAttempted) {
          failInitial(err)
          return
        }
        if (isWindowsNamedPipePath(sockPath)) {
          failInitial(err)
          return
        }
        staleRetryAttempted = true
        const blockedIdentity = readSocketIdentity(sockPath)
        const probe = createConnection({ path: sockPath })
        let probeSettled = false
        let probeTimeout: NodeJS.Timeout | null = null
        const finishProbe = (callback: () => void): void => {
          if (probeSettled) {
            return
          }
          probeSettled = true
          if (probeTimeout) {
            clearTimeout(probeTimeout)
          }
          callback()
        }
        probe.once('connect', () => {
          finishProbe(() => {
            probe.destroy()
            failInitial(err)
          })
        })
        probe.once('error', (probeErr: NodeJS.ErrnoException) => {
          finishProbe(() => {
            if (probeErr.code !== 'ECONNREFUSED' && probeErr.code !== 'ENOENT') {
              failInitial(err)
              return
            }
            if (!unlinkIfStillStale(blockedIdentity)) {
              failInitial(err)
              return
            }
            relayLogLine(`[relay] Removed stale socket at ${sockPath} and retrying listen`)
            removeStartupListeners()
            listenForStartupError(failInitial)
          })
        })
        probeTimeout = setTimeout(() => {
          finishProbe(() => {
            probe.destroy()
            failInitial(err)
          })
        }, STALE_SOCKET_PROBE_TIMEOUT_MS)
      }

      listenForStartupError(onInitialError)
    })

    return server
  }

  try {
    socketServer = await startSocketServer()
    // Why: publish endpoint.env only after socket ownership is proven, so a refused duplicate daemon can't poison hook coordinates.
  } catch {
    process.exit(1)
  }

  // ── stdin/stdout transport (initial connection) ─────────────────────

  // Why: without this handler an EPIPE/ERR_STREAM_DESTROYED on stdout becomes an uncaught exception, exiting before grace starts.
  process.stdout.on('error', () => {
    transportState.stdoutAlive = false
    transportState.flushStdoutDrainWaiters()
    dispatcher.invalidateClient()
  })

  function startGrace(reason: string): void {
    const startupEmptyDetached =
      detached && !hasAcceptedSocketClient && ptyHandler.activePtyCount === 0
    // Why: a detached relay that never accepted a client has no PTY state and shouldn't linger forever.
    const timeoutMs = startupEmptyDetached
      ? graceTimeMs === 0
        ? EMPTY_DETACHED_STARTUP_GRACE_MS
        : Math.min(graceTimeMs, EMPTY_DETACHED_STARTUP_GRACE_MS)
      : graceTimeMs
    graceDeadlineAt = timeoutMs === 0 ? null : Date.now() + timeoutMs
    graceReason = reason
    relayLogLine(
      `[relay] Grace started (${reason}): timeoutMs=${timeoutMs}, startupEmptyDetached=${startupEmptyDetached}, ptys=${ptyHandler.activePtyCount}, clients=${socketClients.size}`
    )
    ptyHandler.startGraceTimer(() => {
      relayLogLine(`[relay] Grace expired (${reason}); shutting down`)
      shutdown()
    }, timeoutMs)
  }

  if (detached) {
    // Why: detached stdin is /dev/null, so listening would EOF → grace → shutdown before --connect arrives; use the socket instead.
    startGrace('detached startup')
  } else {
    process.stdin.on('data', (chunk: Buffer) => {
      cancelGrace('stdin data')
      dispatcher.feed(chunk)
    })

    process.stdin.on('end', () => {
      // Why: stdin close means the SSH channel is gone; mark stdout dead so its write callback no-ops instead of hitting a dead pipe.
      transportState.stdoutAlive = false
      transportState.flushStdoutDrainWaiters()
      dispatcher.invalidateClient()
      if (socketClients.size === 0) {
        startGrace('stdin ended')
      }
    })

    process.stdin.on('error', () => {
      transportState.stdoutAlive = false
      transportState.flushStdoutDrainWaiters()
      dispatcher.invalidateClient()
      if (socketClients.size === 0) {
        startGrace('stdin error')
      }
    })
  }

  let shutdownInFlight = false
  function shutdown(): void {
    if (shutdownInFlight) {
      return
    }
    shutdownInFlight = true
    relayLogLine(
      `[relay] Shutdown: ptys=${ptyHandler.activePtyCount}, clients=${socketClients.size}, ownsSocket=${socketOwnership.ownsSocketPath}`
    )
    graceDeadlineAt = null
    graceReason = null
    void ptyHandler
      .dispose()
      .then(() => {
        dispatcher.dispose()
        fsHandler.dispose()
        gitHandler.dispose()
        // Why: server.close() unlinks the listen path; skip if a newer relay rebound it, else we strand that newer daemon.
        if (socketServer && ownsCurrentSocketPath()) {
          socketServer.close()
        }
        cleanupOwnedSocket()
        process.exit(0)
      })
      .catch((error) => {
        // Why: keep owning a PTY whose native kill was rejected so a transient signal failure doesn't orphan a remote shell.
        shutdownInFlight = false
        relayLogLine(
          `[relay] Shutdown deferred: ${error instanceof Error ? error.message : String(error)}`
        )
      })
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  // Why: default SIGHUP exits immediately, killing PTYs before grace; ignore it so the relay survives SSH disconnect.
  process.on('SIGHUP', () => {
    relayLogLine('[relay] Received SIGHUP (SSH session dropped), ignoring')
  })
  process.on('exit', (code) => {
    relayLogLine(`[relay] Process exiting with code ${code}`)
  })

  dispatcher.writePrimaryBytes(Buffer.from(RELAY_SENTINEL))
  if (detached) {
    transportState.stdoutAlive = false
    dispatcher.invalidateClient()
  }
}
