import type { ConnectionState, ConnectionLogLevel } from './types'
import { publicKeyFromBase64, encrypt } from './e2ee'
import type { TerminalSnapshotState } from './rpc-client-terminal-binary-frame'
import { redactSocketEndpoint } from './socket-event-debug'
import { isStaleRpcSocketEvent, RpcSynthesizedCloseIndex } from './rpc-socket-close-evidence'
import { createRpcClientApi } from './rpc-client-connection-api'
import { openRpcSocket } from './rpc-client-connection-socket'
import { createRpcStreamRouting } from './rpc-client-connection-stream-routing'
import { createRpcConnectionLifecycle } from './rpc-client-connection-lifecycle'
import { createConnectionStateAccessors, createSocketSessionAccessors } from './rpc-client-connection-state'
import {
  createServerSubscriptionUnsubscriber,
  sendBrowserScreencastUnsubscribe
} from './rpc-client-connection-subscriptions'
import type {
  ConnectOptions,
  ConnectWaiter,
  PendingRequest,
  RpcClient,
  StreamRequest,
  StreamingListener
} from './rpc-client-connection-contracts'
import {
  ACTIVITY_PROBE_INTERVAL_MS,
  GIVE_UP_AFTER_ATTEMPTS
} from './rpc-client-connection-policy'
export type { ConnectOptions, RpcClient, SendRequestOptions } from './rpc-client-connection-contracts'
export function connect(
  endpoint: string,
  deviceToken: string,
  serverPublicKeyB64: string,
  optionsOrLegacy?: ConnectOptions | ((state: ConnectionState) => void)
): RpcClient {
  // Why: keep backward-compat with callers that pass a bare onStateChange fn.
  const options: ConnectOptions =
    typeof optionsOrLegacy === 'function'
      ? { onStateChange: optionsOrLegacy }
      : (optionsOrLegacy ?? {})
  const onStateChange = options.onStateChange
  const onLog = options.onLog
  let logCounter = 0
  function emitLog(level: ConnectionLogLevel, message: string, detail?: string) {
    if (!onLog) {
      return
    }
    onLog({
      id: `log-${++logCounter}-${Date.now()}`,
      ts: Date.now(),
      level,
      message,
      detail
    })
  }
  let ws: WebSocket | null = null
  const synthesizedCloses = new RpcSynthesizedCloseIndex()
  let state: ConnectionState = 'disconnected'
  let requestCounter = 0
  let reconnectAttempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let connectTimer: ReturnType<typeof setTimeout> | null = null
  let handshakeTimer: ReturnType<typeof setTimeout> | null = null
  let activityProbeTimer: ReturnType<typeof setInterval> | null = null
  let activityProbeInFlight = false
  let intentionallyClosed = false
  // Consecutive auth rejections; tolerate up to AUTH_RETRY_BUDGET (issue #5200) before latching to avoid a needless re-pair.
  let authRejectionCount = 0
  let authenticationGeneration = 0
  let lastConnectedAt: number | null = null
  // Why: cheap diagnostics for RN/OkHttp process-state poisoning (retry cadence, inbound traffic, close timing).
  let lastInboundAt: number | null = null
  let inboundSequence = 0
  let lastWsClosedAt: number | null = null
  let wsConstructionCounter = 0

  // Why: fresh ephemeral keypair per connection provides forward secrecy.
  let sharedKey: Uint8Array | null = null
  const serverPublicKey = publicKeyFromBase64(serverPublicKeyB64)

  const pending = new Map<string, PendingRequest>()
  const streamListeners = new Map<string, StreamRequest>()
  const terminalStreamListeners = new Map<number, StreamingListener>()
  const terminalStreamIdsByRequest = new Map<string, Set<number>>()
  const terminalSnapshots = new Map<number, TerminalSnapshotState>()
  let activeBrowserScreencastRequestId: string | null = null
  let pendingBrowserScreencastRequestId: string | null = null
  const stateListeners = new Set<(state: ConnectionState) => void>()
  const connectWaiters: ConnectWaiter[] = []

  if (onStateChange) {
    stateListeners.add(onStateChange)
  }

  // Diagnostic: dwell time in the current state, for spotting "stuck in connecting/reconnecting".
  let stateEnteredAt = Date.now()

  function rejectConnectWaiters(reason: string) {
    const error = new Error(reason)
    for (const waiter of connectWaiters.splice(0)) {
      if (waiter.timeout) {
        clearTimeout(waiter.timeout)
      }
      waiter.reject(error)
    }
  }

  function setState(next: ConnectionState) {
    if (state === next) {
      return
    }
    const prev = state
    const dwelt = Date.now() - stateEnteredAt
    state = next
    stateEnteredAt = Date.now()
    console.log('[net] state', {
      from: prev,
      to: next,
      dweltMs: dwelt,
      attempt: reconnectAttempt,
      endpoint: redactSocketEndpoint(endpoint)
    })
    if (next === 'connected') {
      lastConnectedAt = Date.now()
      authenticationGeneration++
      // Why: only a completed E2EE handshake proves the path is healthy (issue #10119).
      reconnectAttempt = 0
      // Why: a clean handshake proves the token is valid — reset the auth retry budget.
      authRejectionCount = 0
      for (const waiter of connectWaiters.splice(0)) {
        if (waiter.timeout) {
          clearTimeout(waiter.timeout)
        }
        waiter.resolve()
      }
    } else if (next === 'disconnected' || next === 'auth-failed') {
      const reason =
        next === 'auth-failed' ? 'Unauthorized — pairing may be revoked' : 'Connection closed'
      rejectConnectWaiters(reason)
    }
    for (const listener of stateListeners) {
      listener(next)
    }
  }

  function waitForConnected(timeoutMs?: number): Promise<void> {
    if (state === 'connected') {
      return Promise.resolve()
    }
    if (intentionallyClosed) {
      return Promise.reject(new Error('Client closed'))
    }
    if (state === 'reconnecting' && reconnectAttempt >= GIVE_UP_AFTER_ATTEMPTS) {
      // Why: past the cap the loop only trickles every 90s — fail fast instead of hanging on a long-unreachable host.
      return Promise.reject(new Error('Connection retry limit reached'))
    }
    return new Promise((resolve, reject) => {
      const waiter: ConnectWaiter = { resolve, reject, timeout: null }
      if (timeoutMs !== undefined) {
        // Why: per-request timeouts must cover offline/reconnect waiting, not just the RPC after connect.
        waiter.timeout = setTimeout(
          () => {
            const index = connectWaiters.indexOf(waiter)
            if (index !== -1) {
              connectWaiters.splice(index, 1)
            }
            reject(new Error('Timed out while connecting to the remote Orca runtime.'))
          },
          Math.max(0, timeoutMs)
        )
      }
      connectWaiters.push(waiter)
    })
  }

  function nextId(): string {
    return `rpc-${++requestCounter}-${Date.now()}`
  }

  const socketSession = createSocketSessionAccessors({
    getWs: () => ws,
    setWs: (value) => {
      ws = value
    },
    getState: () => state,
    setState: (value) => {
      state = value
    },
    getReconnectAttempt: () => reconnectAttempt,
    setReconnectAttempt: (value) => {
      reconnectAttempt = value
    },
    getReconnectTimer: () => reconnectTimer,
    setReconnectTimer: (value) => {
      reconnectTimer = value
    },
    getConnectTimer: () => connectTimer,
    setConnectTimer: (value) => {
      connectTimer = value
    },
    getHandshakeTimer: () => handshakeTimer,
    setHandshakeTimer: (value) => {
      handshakeTimer = value
    },
    getActivityProbeTimer: () => activityProbeTimer,
    setActivityProbeTimer: (value) => {
      activityProbeTimer = value
    },
    getActivityProbeInFlight: () => activityProbeInFlight,
    setActivityProbeInFlight: (value) => {
      activityProbeInFlight = value
    },
    getIntentionallyClosed: () => intentionallyClosed,
    setIntentionallyClosed: (value) => {
      intentionallyClosed = value
    },
    getAuthRejectionCount: () => authRejectionCount,
    setAuthRejectionCount: (value) => {
      authRejectionCount = value
    },
    getAuthenticationGeneration: () => authenticationGeneration,
    setAuthenticationGeneration: (value) => {
      authenticationGeneration = value
    },
    getLastConnectedAt: () => lastConnectedAt,
    setLastConnectedAt: (value) => {
      lastConnectedAt = value
    },
    getLastInboundAt: () => lastInboundAt,
    setLastInboundAt: (value) => {
      lastInboundAt = value
    },
    getInboundSequence: () => inboundSequence,
    setInboundSequence: (value) => {
      inboundSequence = value
    },
    getLastWsClosedAt: () => lastWsClosedAt,
    setLastWsClosedAt: (value) => {
      lastWsClosedAt = value
    },
    getWsConstructionCounter: () => wsConstructionCounter,
    setWsConstructionCounter: (value) => {
      wsConstructionCounter = value
    },
    getSharedKey: () => sharedKey,
    setSharedKey: (value) => {
      sharedKey = value
    }
  })
  const openConnection = () =>
    openRpcSocket({
      endpoint,
      deviceToken,
      serverPublicKey,
      session: socketSession,
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
      sendBrowserScreencastUnsubscribe: (subscriptionId) =>
        sendBrowserScreencastUnsubscribe({ nextId, deviceToken, sendEncrypted }, subscriptionId),
      activeBrowserScreencastRequestId: {
        get value() {
          return activeBrowserScreencastRequestId
        },
        set value(value: string | null) {
          activeBrowserScreencastRequestId = value
        }
      },
      pendingBrowserScreencastRequestId: {
        get value() {
          return pendingBrowserScreencastRequestId
        },
        set value(value: string | null) {
          pendingBrowserScreencastRequestId = value
        }
      }
    })


  function clearConnectTimer() {
    if (connectTimer) {
      clearTimeout(connectTimer)
      connectTimer = null
    }
  }

  // Why: app-level liveness probe (see ACTIVITY_PROBE_INTERVAL_MS) — force-closes the WS on failure so onclose reconnects.
  function runActivityProbe() {
    if (state !== 'connected' || !ws || activityProbeInFlight) {
      return
    }
    activityProbeInFlight = true
    const probeWs = ws
    const id = nextId()
    const probeInboundSequence = inboundSequence
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      activityProbeInFlight = false
      pending.delete(id)
      if (inboundSequence > probeInboundSequence) {
        return
      }
      console.log('[net] activity-probe TIMEOUT — forcing reconnect', { state })
      // Why: stale probe timers must not close a replacement socket.
      if (probeWs === ws && probeWs.readyState === WebSocket.OPEN) {
        probeWs.close()
        // Why: React Native can omit onclose for a wedged iOS transport.
        if (probeWs === ws) {
          synthesizedCloses.remember(probeWs, authenticationGeneration)
          handleSocketClosed(probeWs, { timedOut: true })
        }
      }
    }, 8_000)
    pending.set(id, {
      resolve: () => {
        if (timedOut) {
          return
        }
        activityProbeInFlight = false
        clearTimeout(timeout)
      },
      reject: () => {
        if (timedOut) {
          return
        }
        activityProbeInFlight = false
        clearTimeout(timeout)
      }
    })
    if (!sendEncrypted({ id, deviceToken, method: 'status.get' })) {
      activityProbeInFlight = false
      clearTimeout(timeout)
      pending.delete(id)
    }
  }

  function startActivityProbe() {
    stopActivityProbe()
    activityProbeTimer = setInterval(runActivityProbe, ACTIVITY_PROBE_INTERVAL_MS)
  }

  function stopActivityProbe() {
    if (activityProbeTimer) {
      clearInterval(activityProbeTimer)
      activityProbeTimer = null
    }
  }

  function sendEncrypted(request: unknown): boolean {
    if (ws && ws.readyState === WebSocket.OPEN && sharedKey) {
      ws.send(encrypt(JSON.stringify(request), sharedKey))
      return true
    }
    console.log('[net] sendEncrypted FAILED — channel not ready', {
      hasWs: !!ws,
      readyState: ws?.readyState,
      hasKey: !!sharedKey,
      state
    })
    // Why: RN can drop onclose, leaving state 'connected' over a dead socket; force reconnect or every send silently fails forever.
    if (state === 'connected' && ws && ws.readyState !== WebSocket.OPEN) {
      console.log('[net] sendEncrypted detected ws desync — forcing reconnect', {
        readyState: ws.readyState
      })
      synthesizedCloses.remember(ws, authenticationGeneration)
      handleSocketClosed(ws, { timedOut: false })
    }
    return false
  }



  const sendServerSubscriptionUnsubscribe = createServerSubscriptionUnsubscriber({
    nextId,
    deviceToken,
    sendEncrypted
  })

  const streamRouting = createRpcStreamRouting({
    pending,
    streamListeners,
    terminalStreamListeners,
    terminalStreamIdsByRequest,
    terminalSnapshots,
    streamState: {
      get activeBrowserScreencastRequestId() {
        return activeBrowserScreencastRequestId
      },
      set activeBrowserScreencastRequestId(value: string | null) {
        activeBrowserScreencastRequestId = value
      },
      get pendingBrowserScreencastRequestId() {
        return pendingBrowserScreencastRequestId
      },
      set pendingBrowserScreencastRequestId(value: string | null) {
        pendingBrowserScreencastRequestId = value
      }
    },
    sendServerSubscriptionUnsubscribe,
    recordInboundTraffic: () => {
      inboundSequence++
    }
  })
  const {
    rejectAllPending,
    removeStreamListener,
    markStreamsForReplay,
    resetTerminalStreamRoutingForRequest,
    emitStreamError,
    disposeBrowserScreencastStream,
    disposeRuntimeClientEventsStream,
    recordValidatedInboundTraffic,
    handleBinaryFrame
  } = streamRouting

  const lifecycle = createRpcConnectionLifecycle({
    endpoint,
    session: socketSession,
    emitLog,
    setState,
    rejectConnectWaiters,
    rejectAllPending,
    markStreamsForReplay,
    clearConnectTimer,
    stopActivityProbe,
    openConnection,
    pending,
    streamListeners,
    streamState: {
      get activeBrowserScreencastRequestId() {
        return activeBrowserScreencastRequestId
      },
      set activeBrowserScreencastRequestId(value: string | null) {
        activeBrowserScreencastRequestId = value
      },
      get pendingBrowserScreencastRequestId() {
        return pendingBrowserScreencastRequestId
      },
      set pendingBrowserScreencastRequestId(value: string | null) {
        pendingBrowserScreencastRequestId = value
      }
    },
    synthesizedCloses
  })
  const { handleSocketClosed, handleAuthRejection } = lifecycle

  openConnection()

  const connectionState = createConnectionStateAccessors({
    getState: () => state,
    setState: (value) => {
      state = value
    },
    getIntentionallyClosed: () => intentionallyClosed,
    setIntentionallyClosed: (value) => {
      intentionallyClosed = value
    },
    getReconnectTimer: () => reconnectTimer,
    setReconnectTimer: (value) => {
      reconnectTimer = value
    },
    getWs: () => ws,
    setWs: (value) => {
      ws = value
    },
    getSharedKey: () => sharedKey,
    setSharedKey: (value) => {
      sharedKey = value
    },
    getReconnectAttempt: () => reconnectAttempt,
    setReconnectAttempt: (value) => {
      reconnectAttempt = value
    },
    getConnectTimer: () => connectTimer,
    setConnectTimer: (value) => {
      connectTimer = value
    },
    getHandshakeTimer: () => handshakeTimer,
    setHandshakeTimer: (value) => {
      handshakeTimer = value
    }
  })
  return createRpcClientApi({
    pending,
    streamListeners,
    terminalStreamIdsByRequest,
    stateListeners,
    nextId,
    deviceToken,
    getLastConnectedAt: () => lastConnectedAt,
    connectionState,
    waitForConnected,
    sendEncrypted,
    clearConnectTimer,
    startActivityProbe,
    runActivityProbe,
    stopActivityProbe,
    openConnection,
    setState,
    rejectAllPending,
    removeStreamListener,
    emitStreamError,
    disposeBrowserScreencastStream,
    disposeRuntimeClientEventsStream,
    sendServerSubscriptionUnsubscribe,
    getActiveBrowserScreencastRequestId: () => activeBrowserScreencastRequestId,
    getPendingBrowserScreencastRequestId: () => pendingBrowserScreencastRequestId,
    setActiveBrowserScreencastRequestId: (id) => {
      activeBrowserScreencastRequestId = id
    },
    setPendingBrowserScreencastRequestId: (id) => {
      pendingBrowserScreencastRequestId = id
    }
  })
}

function isTerminalSubscribedResult(
  value: unknown
): value is { type: 'subscribed'; streamId: number } {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'subscribed' &&
    typeof (value as { streamId?: unknown }).streamId === 'number'
  )
}

function isStreamingSubscriptionReadyResult(
  value: unknown
): value is { type: 'ready'; subscriptionId: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'ready' &&
    typeof (value as { subscriptionId?: unknown }).subscriptionId === 'string'
  )
}
