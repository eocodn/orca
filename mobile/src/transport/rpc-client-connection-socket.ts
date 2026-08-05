import type { RpcResponse, RpcSuccess, ConnectionState } from './types'
import type { StreamRequest } from './rpc-client-connection-contracts'
import {
  CONNECT_TIMEOUT_MS,
  HANDSHAKE_TIMEOUT_MS,
  WEBSOCKET_CONNECTING_STATE
} from './rpc-client-connection-policy'
import { generateKeyPair, deriveSharedKey, publicKeyToBase64, decrypt, decryptBytes } from './e2ee'
import { websocketPayloadToUint8 } from './websocket-payload-bytes'
import { describeSocketEvent, redactSocketEndpoint } from './socket-event-debug'
import { logRpcSocketClose } from './rpc-socket-close-evidence'
import { isRpcResponse } from './rpc-response-shape'

type SessionState = {
  ws: WebSocket | null
  state: ConnectionState
  reconnectAttempt: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  connectTimer: ReturnType<typeof setTimeout> | null
  handshakeTimer: ReturnType<typeof setTimeout> | null
  activityProbeTimer: ReturnType<typeof setInterval> | null
  activityProbeInFlight: boolean
  intentionallyClosed: boolean
  authRejectionCount: number
  authenticationGeneration: number
  lastConnectedAt: number | null
  lastInboundAt: number | null
  inboundSequence: number
  lastWsClosedAt: number | null
  wsConstructionCounter: number
  sharedKey: Uint8Array | null
}
type SocketOpenDependencies = {
  endpoint: string
  deviceToken: string
  serverPublicKey: Uint8Array
  session: SessionState
  emitLog: (level: 'info' | 'warn' | 'error' | 'success', message: string, detail?: string) => void
  setState: (state: ConnectionState) => void
  synthesizedCloses: { remember: (socket: WebSocket, generation: number) => void }
  handleSocketClosed: (socket: WebSocket, opts?: { timedOut?: boolean; closeCode?: number }) => void
  isStaleRpcSocketEvent: (
    current: WebSocket | null,
    opening: WebSocket,
    event: string,
    state: ConnectionState,
    attempt: number
  ) => boolean
  streamListeners: Map<string, StreamRequest>
  pending: Map<string, { resolve: (response: RpcResponse) => void; reject: (error: Error) => void }>
  removeStreamListener: (id: string) => void
  resetTerminalStreamRoutingForRequest: (id: string) => void
  clearConnectTimer: () => void
  sendEncrypted: (request: unknown) => boolean
  startActivityProbe: () => void
  handleAuthRejection: (reason: string) => void
  handleBinaryFrame: (bytes: Uint8Array) => void
  isTerminalSubscribedResult: (value: unknown) => value is { type: 'subscribed'; streamId: number }
  isStreamingSubscriptionReadyResult: (
    value: unknown
  ) => value is { type: 'ready'; subscriptionId: string }
  emitStreamError: (stream: StreamRequest, message: string, error?: unknown) => void
  terminalStreamListeners: Map<number, (result: unknown) => void>
  terminalStreamIdsByRequest: Map<string, Set<number>>
  sendServerSubscriptionUnsubscribe: (stream: StreamRequest) => void
  recordValidatedInboundTraffic: () => void
  sendBrowserScreencastUnsubscribe: (subscriptionId: string) => void
  activeBrowserScreencastRequestId: { get value(): string | null; set value(value: string | null) }
  pendingBrowserScreencastRequestId: { get value(): string | null; set value(value: string | null) }
}
export function openRpcSocket(deps: SocketOpenDependencies): void {
  const { endpoint, deviceToken, serverPublicKey, session } = deps
  const {
    emitLog,
    setState,
    synthesizedCloses,
    handleSocketClosed,
    isStaleRpcSocketEvent,
    streamListeners,
    pending,
    removeStreamListener,
    resetTerminalStreamRoutingForRequest,
    clearConnectTimer,
    sendEncrypted,
    startActivityProbe,
    handleAuthRejection,
    handleBinaryFrame,
    isTerminalSubscribedResult,
    isStreamingSubscriptionReadyResult,
    emitStreamError,
    terminalStreamListeners,
    terminalStreamIdsByRequest,
    sendServerSubscriptionUnsubscribe,
    recordValidatedInboundTraffic,
    sendBrowserScreencastUnsubscribe
  } = deps
  function openConnection() {
    if (session.intentionallyClosed) {
      return
    }

    const now = Date.now()
    session.wsConstructionCounter++
    console.log('[net] openConnection', {
      attempt: session.reconnectAttempt,
      endpoint: redactSocketEndpoint(endpoint),
      // Why: diagnostic for RN/OkHttp pool corruption — high wsCount + repeated 1006 closes means process-session.state stuck.
      wsCount: session.wsConstructionCounter,
      msSinceLastConnected: session.lastConnectedAt != null ? now - session.lastConnectedAt : null,
      msSinceLastClose: session.lastWsClosedAt != null ? now - session.lastWsClosedAt : null,
      msSinceLastInbound: session.lastInboundAt != null ? now - session.lastInboundAt : null
    })
    setState('connecting')
    session.sharedKey = null

    emitLog(
      'info',
      session.reconnectAttempt > 0
        ? `Reconnecting (attempt ${session.reconnectAttempt + 1})`
        : 'Opening WebSocket',
      redactSocketEndpoint(endpoint)
    )

    const openingWs = new WebSocket(endpoint)
    session.ws = openingWs
    let openingWsAuthenticated = false
    let openingWsLastInboundAt: number | null = null

    // Why: RN can leave opens pending forever on flaky handoffs — force reconnect if onopen never arrives.
    session.connectTimer = setTimeout(() => {
      session.connectTimer = null
      if (session.ws === openingWs && openingWs.readyState === WEBSOCKET_CONNECTING_STATE) {
        console.log('[net] connect-timeout fired (onopen never arrived)', {
          attempt: session.reconnectAttempt,
          timeoutMs: CONNECT_TIMEOUT_MS
        })
        emitLog(
          'error',
          'WebSocket connect timeout',
          `No TCP/WS handshake within ${CONNECT_TIMEOUT_MS / 1000}s — endpoint unreachable?`
        )
        openingWs.close()
        if (session.ws === openingWs) {
          synthesizedCloses.remember(openingWs, session.authenticationGeneration)
          handleSocketClosed(openingWs, { timedOut: true })
        }
      }
    }, CONNECT_TIMEOUT_MS)

    openingWs.onopen = () => {
      if (
        isStaleRpcSocketEvent(
          session.ws,
          openingWs,
          'open',
          session.state,
          session.reconnectAttempt
        )
      ) {
        return
      }
      console.log('[net] session.ws.onopen', { attempt: session.reconnectAttempt })
      clearConnectTimer()
      // Why: no session.reconnectAttempt reset here — an open socket isn't a healthy session
      // until e2ee_authenticated. Resetting pre-handshake pinned the counter at 0↔1,
      // so a handshake-stall loop never escalated past "Connecting…" (issue #10119).
      setState('handshaking')
      emitLog('success', 'WebSocket open', 'Starting E2EE handshake')

      // Why: fresh ephemeral keypair per connection provides forward secrecy.
      const ephemeral = generateKeyPair()
      const hello = JSON.stringify({
        type: 'e2ee_hello',
        publicKeyB64: publicKeyToBase64(ephemeral.publicKey)
      })
      openingWs.send(hello)
      emitLog('info', 'Sent e2ee_hello', 'Awaiting server e2ee_ready')

      session.sharedKey = deriveSharedKey(ephemeral.secretKey, serverPublicKey)

      session.handshakeTimer = setTimeout(() => {
        session.handshakeTimer = null
        if (session.ws !== openingWs || session.state !== 'handshaking') {
          return
        }
        console.log('[net] handshake-timeout fired (e2ee_authenticated never arrived)', {
          timeoutMs: HANDSHAKE_TIMEOUT_MS
        })
        emitLog(
          'error',
          'Handshake timeout',
          `No e2ee_ready/e2ee_authenticated within ${HANDSHAKE_TIMEOUT_MS / 1000}s`
        )
        openingWs.close()
        // Why: React Native can omit onclose for a wedged mobile transport.
        if (session.ws === openingWs) {
          synthesizedCloses.remember(openingWs, session.authenticationGeneration)
          handleSocketClosed(openingWs, { timedOut: true })
        }
      }, HANDSHAKE_TIMEOUT_MS)
    }

    openingWs.onmessage = (event) => {
      if (
        isStaleRpcSocketEvent(
          session.ws,
          openingWs,
          'message',
          session.state,
          session.reconnectAttempt
        )
      ) {
        return
      }
      void handleSocketMessage(event.data)
    }

    async function handleSocketMessage(rawData: unknown) {
      const receivedAt = Date.now()
      session.lastInboundAt = receivedAt
      openingWsLastInboundAt = receivedAt
      const raw = typeof rawData === 'string' ? rawData : null

      // Why: e2ee_ready is plaintext (precedes encrypted auth); e2ee_authenticated/e2ee_error are encrypted.
      if (session.state === 'handshaking') {
        if (raw === null) {
          return
        }
        try {
          const msg = JSON.parse(raw)
          if (msg.type === 'e2ee_ready') {
            emitLog('success', 'Received e2ee_ready', 'Sending device token')
            sendEncrypted({ type: 'e2ee_auth', deviceToken })
            return
          }
        } catch {
          // Not plaintext JSON — fall through and try encrypted handshake messages.
        }

        if (!session.sharedKey || session.sharedKey.length !== 32) {
          return
        }

        const plaintext = decrypt(raw, session.sharedKey)
        if (plaintext === null) {
          return
        }

        try {
          const msg = JSON.parse(plaintext)
          if (msg.type === 'e2ee_authenticated') {
            if (session.handshakeTimer) {
              clearTimeout(session.handshakeTimer)
              session.handshakeTimer = null
            }
            console.log('[net] e2ee_authenticated — connected', {
              streamCount: streamListeners.size
            })
            openingWsAuthenticated = true
            setState('connected')
            emitLog('success', 'Authenticated', 'Channel ready for RPC')
            startActivityProbe()
            for (const [id, stream] of streamListeners) {
              if (stream.cancelled) {
                removeStreamListener(id)
                continue
              }
              // Why: a UI listener notified synchronously by setState('connected') may already have sent this stream — skip it.
              if (stream.sent) {
                continue
              }
              if (stream.method === 'browser.screencast') {
                deps.pendingBrowserScreencastRequestId.value = id
                deps.activeBrowserScreencastRequestId.value = null
              }
              resetTerminalStreamRoutingForRequest(id)
              if (
                sendEncrypted({ id, deviceToken, method: stream.method, params: stream.params })
              ) {
                stream.sent = true
              } else {
                emitStreamError(stream, 'Connection interrupted')
                removeStreamListener(id)
              }
            }
          } else if (msg.type === 'e2ee_error' || (!msg.ok && msg.error?.code === 'unauthorized')) {
            console.log('[net] e2ee auth FAILED', { msgType: msg.type, error: msg.error })
            if (session.handshakeTimer) {
              clearTimeout(session.handshakeTimer)
              session.handshakeTimer = null
            }
            handleAuthRejection('Unauthorized — pairing may be revoked')
          }
        } catch {
          // Not JSON — ignore during handshake.
        }
        return
      }

      // Why: session.sharedKey can be null after destroy() or a reconnect race — don't decrypt with an invalid key.
      if (!session.sharedKey || session.sharedKey.length !== 32) {
        return
      }

      if (raw === null) {
        const bytes = await websocketPayloadToUint8(rawData)
        if (session.ws !== openingWs) {
          return
        }
        if (!bytes) {
          return
        }
        const plaintextBytes = decryptBytes(bytes, session.sharedKey)
        if (!plaintextBytes) {
          return
        }
        handleBinaryFrame(plaintextBytes)
        return
      }

      const plaintext = decrypt(raw, session.sharedKey)
      if (plaintext === null) {
        return
      }

      let response: unknown
      try {
        response = JSON.parse(plaintext)
      } catch {
        return
      }
      if (!isRpcResponse(response)) {
        return
      }
      recordValidatedInboundTraffic()

      // Why: a mid-session unauthorized may be transient (issue #5200) — handleAuthRejection retries before latching auth-failed.
      if (!response.ok && response.error.code === 'unauthorized') {
        handleAuthRejection('Unauthorized — pairing may be revoked')
        return
      }

      const isStreaming = response.ok && (response as RpcSuccess).streaming === true

      if (isStreaming) {
        const stream = streamListeners.get(response.id)
        if (stream && response.ok) {
          const result = (response as RpcSuccess).result
          if (isStreamingSubscriptionReadyResult(result)) {
            stream.subscriptionId = result.subscriptionId
            if (stream.cancelled) {
              sendServerSubscriptionUnsubscribe(stream)
              removeStreamListener(response.id)
              return
            }
            if (stream.method === 'browser.screencast') {
              if (
                deps.pendingBrowserScreencastRequestId.value !== response.id &&
                deps.activeBrowserScreencastRequestId.value !== response.id
              ) {
                sendBrowserScreencastUnsubscribe(result.subscriptionId)
                removeStreamListener(response.id)
                return
              }
              deps.pendingBrowserScreencastRequestId.value = null
              deps.activeBrowserScreencastRequestId.value = response.id
            }
          }
          if (isTerminalSubscribedResult(result)) {
            let ids = terminalStreamIdsByRequest.get(response.id)
            if (!ids) {
              ids = new Set()
              terminalStreamIdsByRequest.set(response.id, ids)
            }
            ids.add(result.streamId)
            terminalStreamListeners.set(result.streamId, stream.listener)
          }
          if (!stream.cancelled) {
            stream.listener(result)
          }
        }
        return
      }

      if (response.ok) {
        const result = (response as RpcSuccess).result as Record<string, unknown> | null
        if (result && result.type === 'end') {
          const stream = streamListeners.get(response.id)
          if (stream) {
            if (!stream.cancelled) {
              stream.listener(result)
            }
            removeStreamListener(response.id)
            return
          }
        }
        if (result && result.type === 'scrollback') {
          const stream = streamListeners.get(response.id)
          if (stream) {
            stream.listener(result)
            return
          }
        }
      }

      const stream = streamListeners.get(response.id)
      if (stream) {
        if (!response.ok) {
          emitStreamError(stream, response.error.message, response.error)
        } else {
          emitStreamError(stream, 'Streaming request ended before it was ready.')
        }
        removeStreamListener(response.id)
        return
      }

      const req = pending.get(response.id)
      if (req) {
        pending.delete(response.id)
        req.resolve(response)
      }
    }

    openingWs.onclose = (event) => {
      const closeCode = logRpcSocketClose({
        event,
        state: session.state,
        attempt: session.reconnectAttempt,
        intentionallyClosed: session.intentionallyClosed,
        endpoint: redactSocketEndpoint(endpoint),
        constructedAt: now,
        authenticated: openingWsAuthenticated,
        lastInboundAt: openingWsLastInboundAt
      })
      handleSocketClosed(openingWs, { closeCode })
    }

    openingWs.onerror = (event) => {
      if (
        isStaleRpcSocketEvent(
          session.ws,
          openingWs,
          'error',
          session.state,
          session.reconnectAttempt
        )
      ) {
        return
      }
      // Why: RN surfaces the original network error here — onclose follows but its close code alone hides the cause.
      const e = event as { message?: string } | undefined
      const errEvent = describeSocketEvent(event)
      console.log('[net] ws.onerror', {
        message: e?.message,
        state: session.state,
        attempt: session.reconnectAttempt,
        eventKeys: errEvent.keys,
        eventStr: errEvent.json
      })
    }
  }
  openConnection()
}
