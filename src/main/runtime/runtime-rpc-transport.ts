


import type { RuntimeTransportMetadata } from '../../shared/runtime-bootstrap'


import {
  watchRuntimeMetadataOwnership} from './runtime-metadata-ownership-watch'

import type { RpcResponse } from './rpc/core'

import type { RpcMessageContext, RpcTransport } from './rpc/transport'
import { UnixSocketTransport } from './rpc/unix-socket-transport'
import { WebSocketTransport } from './rpc/ws-transport'
import { readWsFallbackPort, writeWsFallbackPort } from './rpc/ws-fallback-port-store'
import type { WebSocket } from 'ws'


import { UnpairedDeviceAuthThrottle } from './rpc/unpaired-device-auth-throttle'
import {
  MobileSocketWiring,
  type AuthenticatedMobileSocket} from './rpc/mobile-socket-wiring'









import { RuntimeRpcPairingServer } from "./runtime-rpc-pairing"
import {
  createRuntimeTransportMetadata,
  sweepOrphanedRuntimeSockets} from "./runtime-rpc-support"

export abstract class RuntimeRpcTransportServer extends RuntimeRpcPairingServer {
  protected abstract handleMessage(
    rawMessage: string,
    context?: RpcMessageContext
  ): Promise<RpcResponse>

  protected abstract handleWebSocketMessage(
    rawMessage: string,
    reply: (response: string) => void,
    sendBinary: (response: Uint8Array<ArrayBufferLike>) => boolean | void,
    wsTransport?: WebSocketTransport,
    ws?: WebSocket,
    authenticatedDeviceToken?: string | null,
    authenticatedSocket?: AuthenticatedMobileSocket
  ): Promise<void>

  async start(): Promise<void> {
    if (this.activeTransports.length > 0) {
      return
    }

    // Why: SIGKILL/OOM skip stop(), orphaning `o-<pid>-*.sock` files; sweep them. Skipped on Windows: named pipes leave no filesystem entries.
    if (this.platform !== 'win32') {
      sweepOrphanedRuntimeSockets(this.userDataPath, this.pid)
    }

    const transportMeta = createRuntimeTransportMetadata(
      this.userDataPath,
      this.pid,
      this.platform,
      this.runtime.getRuntimeId()
    )

    const socketTransport = new UnixSocketTransport({
      endpoint: transportMeta.endpoint,
      kind: transportMeta.kind as 'unix' | 'named-pipe',
      keepaliveIntervalMs: this.keepaliveIntervalMs
    })

    // Why: the `.catch` guarantees reply() always fires so a throw can't strand the client or leak the AbortController.
    socketTransport.onMessage((msg, reply, context) => {
      void this.handleMessage(msg, context)
        .then((response) => {
          reply(JSON.stringify(response))
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          // Why: best-effort id recovery so the client can correlate the error frame to its pending request.
          let id = 'unknown'
          try {
            const parsed = JSON.parse(msg) as { id?: unknown }
            if (typeof parsed.id === 'string' && parsed.id.length > 0) {
              id = parsed.id
            }
          } catch {
            // ignore — fall through with id='unknown'
          }
          reply(JSON.stringify(this.buildError(id, 'internal_error', message)))
        })
    })

    await socketTransport.start()

    const activeTransports: RpcTransport[] = [socketTransport]
    const transportsMeta: RuntimeTransportMetadata[] = [transportMeta]

    // Why: WebSocket uses per-device tokens + E2EE (tweetnacl) instead of TLS since React Native can't pin self-signed certs.
    if (this.enableWebSocket) {
      const pairingIdentity = this.initializePairingIdentity()
      if (!pairingIdentity.ok) {
        this.deviceRegistry = null
        this.e2eeKeypair = null
        this.pairingInitializationFailure = pairingIdentity.failure
      } else {
        this.deviceRegistry = pairingIdentity.deviceRegistry
        this.e2eeKeypair = pairingIdentity.e2eeKeypair
        this.pairingInitializationFailure = null
        try {
          const wsTransport = new WebSocketTransport({
            host: '0.0.0.0',
            port: this.wsPort,
            staticRoot: this.webClientRoot,
            // Why: stable fallback port across restarts keeps paired devices' endpoints valid (STA-1511); wsPort 0 = random (E2E).
            ...(this.wsPort !== 0 ? { fallbackPort: readWsFallbackPort(this.userDataPath) } : {}),
            ...(this.preferPinnedWsPort ? { preferPinnedPort: true } : {})
          })
          // Why: session-scoped (recreated per start) so each desktop launch may notify once.
          this.unpairedDeviceAuthThrottle = new UnpairedDeviceAuthThrottle({
            onTrigger: () => this.onUnpairedDeviceAuthFailure?.()
          })
          const mobileSocketWiring = new MobileSocketWiring({
            deviceRegistry: pairingIdentity.deviceRegistry,
            e2eeKeypair: pairingIdentity.e2eeKeypair,
            onText: (socket, plaintext, reply, sendBinary) => {
              void this.handleWebSocketMessage(
                plaintext,
                reply,
                sendBinary,
                undefined,
                socket.ws,
                socket.device.deviceToken,
                socket
              )
            },
            onBinary: (socket, bytes) => this.handleWebSocketBinaryMessage(bytes, socket.ws),
            onReady: () => {
              // Why: first authenticated mobile/remote client (direct WS and
              // cloud relay both attach here) starts path-candidate tracking.
              // Activation is a local-host concern: candidate buffers live on the
              // buffer-owning host's runtime, so a remote runtime proxy may
              // legitimately lack this method (its own server activates it).
              this.runtime.activateRecentPtyPathCandidateTracking?.()
              this.mobileRelayPairingProvider?.onDemandStateChanged?.()
            },
            onClose: (socket, hasOtherConnections) => {
              if (!socket) {
                return
              }
              this.abortWebSocketDispatches(socket.ws)
              // Why: subscriptions and binary streams are socket-scoped, but disconnect state is device-scoped across transports.
              this.runtime.cleanupSubscriptionsForConnection(socket.connectionId)
              this.runtime.cancelMobileDictationForConnection(socket.connectionId)
              this.binaryStreamHandlers.delete(socket.connectionId)
              if (!hasOtherConnections) {
                this.runtime.onClientDisconnected(socket.device.deviceToken)
              }
            },
            // Why: relay attempts are authorized upstream; only direct failures should prompt local re-pairing.
            onUnpairedDeviceAuthFailure: (metadata) => {
              if (metadata.transport === 'direct') {
                this.unpairedDeviceAuthThrottle?.recordFailure()
              }
            }
          })
          mobileSocketWiring.attachTransport(wsTransport)
          this.mobileSocketWiring = mobileSocketWiring

          await wsTransport.start()
          if (this.wsPort !== 0 && wsTransport.resolvedPort !== this.wsPort) {
            writeWsFallbackPort(this.userDataPath, wsTransport.resolvedPort)
          }
          activeTransports.push(wsTransport)
          transportsMeta.push({
            kind: 'websocket',
            endpoint: `ws://0.0.0.0:${wsTransport.resolvedPort}`
          })
        } catch (error) {
          // Why: WebSocket transport is supplementary; on failure (e.g. port in use) continue with Unix socket only.
          console.error('[runtime] Failed to start WebSocket transport:', error)
          this.mobileSocketWiring = null
        }
      }
    }

    // Why: set in-memory transport state before writing metadata so the bootstrap file has the real endpoint/token pair.
    this.activeTransports = activeTransports
    this.transports = transportsMeta

    try {
      this.writeMetadata()
    } catch (error) {
      // Why: a runtime that can't publish metadata is invisible to the CLI — close transports rather than run undiscoverable.
      this.activeTransports = []
      this.transports = []
      await Promise.all(activeTransports.map((t) => t.stop().catch(() => {}))).catch(() => {})
      throw error
    }

    this.metadataOwnershipWatch = watchRuntimeMetadataOwnership({
      userDataPath: this.userDataPath,
      ownedPid: this.pid,
      ownedRuntimeId: this.runtime.getRuntimeId(),
      pollIntervalMs: this.metadataOwnershipPollMs,
      republish: () => {
        // Why: never advertise endpoints we already tore down.
        if (this.activeTransports.length === 0) {
          return
        }
        this.writeMetadata()
      },
      onReclaim: (previous) => {
        console.warn(
          `[runtime] Reclaimed orca-runtime.json from a dead runtime (pid ${previous?.pid ?? 'none'}); republished pid ${this.pid}.`
        )
      }
    })
  }

  /** Why: test-only seam — runs one ownership check instead of waiting out the poll interval. */
  checkRuntimeMetadataOwnership(): void {
    this.metadataOwnershipWatch?.check()
  }

  async stop(): Promise<void> {
    const transports = this.activeTransports
    this.activeTransports = []
    this.transports = []
    this.metadataOwnershipWatch?.stop()
    this.metadataOwnershipWatch = null
    this.mobileSocketWiring = null
    if (transports.length === 0) {
      return
    }
    await Promise.all(transports.map((t) => t.stop()))
    // Why: leave the metadata file on shutdown — shared userData may host another live runtime whose bootstrap file we'd erase.
  }

}
