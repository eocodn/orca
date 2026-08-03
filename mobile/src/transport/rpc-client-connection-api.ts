import type { RpcResponse, RpcSuccess, ConnectionState } from './types'
import { markRpcDeliveryUnknown } from './rpc-delivery-ambiguity'
import { openRpcRequestBudget, resolvePostConnectRequestTimeout } from './rpc-request-budget'
import { buildStreamUnsubscribe, buildTerminalUnsubscribeParams, updateTerminalSubscriptionViewport as updateCachedTerminalSubscriptionViewport } from './rpc-client-terminal-subscription'
import type {
  RpcClient,
  SendRequestOptions,
  StreamRequest,
  StreamingListener,
  SubscribeOptions,
  SubscriptionDisposeOptions
} from './rpc-client-connection-contracts'

const REQUEST_TIMEOUT_MS = 30_000

type PendingRequest = {
  resolve: (response: RpcResponse) => void
  reject: (error: Error) => void
}
type ApiDependencies = {
  pending: Map<string, PendingRequest>
  streamListeners: Map<string, StreamRequest>
  terminalStreamIdsByRequest: Map<string, Set<number>>
  stateListeners: Set<(state: ConnectionState) => void>
  nextId: () => string
  deviceToken: string
  getLastConnectedAt: () => number | null
  connectionState: {
    state: ConnectionState
    intentionallyClosed: boolean
    reconnectTimer: ReturnType<typeof setTimeout> | null
    ws: WebSocket | null
    sharedKey: Uint8Array | null
    reconnectAttempt: number
    connectTimer: ReturnType<typeof setTimeout> | null
    handshakeTimer: ReturnType<typeof setTimeout> | null
  }
  waitForConnected: (timeoutMs?: number) => Promise<void>
  sendEncrypted: (request: unknown) => boolean
  clearConnectTimer: () => void
  startActivityProbe: () => void
  runActivityProbe: () => void
  stopActivityProbe: () => void
  openConnection: () => void
  setState: (state: ConnectionState) => void
  rejectAllPending: (reason: string, options?: { deliveryUnknown?: boolean }) => void
  removeStreamListener: (id: string) => void
  emitStreamError: (stream: StreamRequest, message: string, error?: unknown) => void
  disposeBrowserScreencastStream: (id: string, options?: SubscriptionDisposeOptions) => void
  disposeRuntimeClientEventsStream: (id: string, options?: SubscriptionDisposeOptions) => void
  sendServerSubscriptionUnsubscribe: (stream: StreamRequest) => void
  getActiveBrowserScreencastRequestId: () => string | null
  getPendingBrowserScreencastRequestId: () => string | null
  setActiveBrowserScreencastRequestId: (id: string | null) => void
  setPendingBrowserScreencastRequestId: (id: string | null) => void
}
export function createRpcClientApi(deps: ApiDependencies): RpcClient {
  const {
    pending,
    streamListeners,
    terminalStreamIdsByRequest,
    stateListeners,
    nextId,
    deviceToken,
    emitStreamError
  } = deps
  const {
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
    disposeBrowserScreencastStream,
    disposeRuntimeClientEventsStream
  } = deps

  return {
    async sendRequest(
      method: string,
      params?: unknown,
      options?: SendRequestOptions
    ): Promise<RpcResponse> {
      const budget = openRpcRequestBudget(options)
      const waitStart = budget.startedAt
      const wasConnected = connectionState.state === 'connected'
      if (options?.failWhenDisconnected && !wasConnected) {
        throw new Error(`Not connected: ${method}`)
      }
      await waitForConnected(options?.timeoutMs)
      if (!wasConnected) {
        console.log('[net] sendRequest waited for connect', {
          method,
          waitedMs: Date.now() - waitStart
        })
      }

      return new Promise((resolve, reject) => {
        const id = nextId()
        const timeoutMs = resolvePostConnectRequestTimeout(budget, REQUEST_TIMEOUT_MS)
        const timeout = setTimeout(() => {
          pending.delete(id)
          console.log('[net] sendRequest TIMEOUT', {
            method,
            timeoutMs,
            state: connectionState.state
          })
          // Why: the frame was written 30s ago — the host may have processed it.
          reject(markRpcDeliveryUnknown(new Error(`Request timed out: ${method}`)))
        }, timeoutMs)

        pending.set(id, {
          resolve: (response) => {
            clearTimeout(timeout)
            resolve(response)
          },
          reject: (error) => {
            clearTimeout(timeout)
            reject(error)
          }
        })

        if (!sendEncrypted({ id, deviceToken, method, params })) {
          pending.delete(id)
          clearTimeout(timeout)
          reject(new Error('Connection interrupted'))
        }
      })
    },

    subscribe(
      method: string,
      params: unknown,
      onData: StreamingListener,
      options?: SubscribeOptions
    ): () => void {
      const id = nextId()
      const stream: StreamRequest = {
        method,
        params,
        listener: onData,
        onBinaryFrame: options?.onBinaryFrame
      }
      streamListeners.set(id, stream)
      if (method === 'browser.screencast') {
        const activeBrowserScreencastRequestId = deps.getActiveBrowserScreencastRequestId()
        if (activeBrowserScreencastRequestId && activeBrowserScreencastRequestId !== id) {
          disposeBrowserScreencastStream(activeBrowserScreencastRequestId)
        }
        const pendingBrowserScreencastRequestId = deps.getPendingBrowserScreencastRequestId()
        if (pendingBrowserScreencastRequestId && pendingBrowserScreencastRequestId !== id) {
          disposeBrowserScreencastStream(pendingBrowserScreencastRequestId)
        }
        // Why: screencast frames carry no stream id, so route only after the new stream's ready to drop stale old-page pixels.
        deps.setPendingBrowserScreencastRequestId(id)
        deps.setActiveBrowserScreencastRequestId(null)
      }

      if (connectionState.state === 'connected') {
        if (sendEncrypted({ id, deviceToken, method, params })) {
          stream.sent = true
        } else {
          emitStreamError(stream, 'Connection interrupted')
          removeStreamListener(id)
        }
      } else {
        // Registered now; the outbound subscribe is (re-)sent once the channel reaches 'connected'.
        console.log('[net] subscribe queued — waiting for connected', {
          method,
          state: connectionState.state
        })
      }

      return (disposeOptions?: SubscriptionDisposeOptions) => {
        const stream = streamListeners.get(id)
        if (stream?.method === 'browser.screencast') {
          disposeBrowserScreencastStream(id, disposeOptions)
          return
        }
        if (stream?.method === 'runtime.clientEvents.subscribe') {
          disposeRuntimeClientEventsStream(id, disposeOptions)
          return
        }
        if (stream?.method === 'terminal.subscribe') {
          // Why: server keys cleanup by composite `${terminal}:${clientId}` so two phones don't evict each other. See docs/mobile-presence-lock.md.
          const unsubscribeParams = buildTerminalUnsubscribeParams(stream.params)
          if (unsubscribeParams && !disposeOptions?.suppressServerUnsubscribe) {
            sendEncrypted({
              id: nextId(),
              deviceToken,
              method: 'terminal.unsubscribe',
              params: unsubscribeParams
            })
          }
        } else {
          const unsub = buildStreamUnsubscribe(stream?.method, stream?.params, {
            requestId: id,
            subscriptionId: stream?.subscriptionId
          })
          if (unsub) {
            sendEncrypted({ id: nextId(), deviceToken, method: unsub.method, params: unsub.params })
          }
        }
        removeStreamListener(id)
      }
    },

    updateTerminalSubscriptionViewport(
      terminal: string,
      viewport: { cols: number; rows: number }
    ): void {
      updateCachedTerminalSubscriptionViewport(streamListeners.values(), terminal, viewport)
    },

    getState(): ConnectionState {
      return connectionState.state
    },

    getReconnectAttempt(): number {
      return connectionState.reconnectAttempt
    },

    getLastConnectedAt(): number | null {
      return deps.getLastConnectedAt()
    },

    onStateChange(listener: (state: ConnectionState) => void): () => void {
      stateListeners.add(listener)
      return () => stateListeners.delete(listener)
    },

    notifyForeground(): void {
      if (connectionState.intentionallyClosed) {
        return
      }
      if (connectionState.state === 'connected') {
        // Why: OS can kill the TCP path while backgrounded without onclose; probe now to detect the half-open socket in ≤8s (issue #5049).
        console.log('[net] foreground — probing live connection')
        startActivityProbe()
        runActivityProbe()
        return
      }
      if (connectionState.state === 'reconnecting') {
        // Why: foreground is a strong user signal — restart immediately instead of waiting out a 60s/90s backoff timer.
        console.log('[net] foreground — restarting reconnect loop', {
          attempt: connectionState.reconnectAttempt,
          hadTimer: !!connectionState.reconnectTimer
        })
        if (connectionState.reconnectTimer) {
          clearTimeout(connectionState.reconnectTimer)
          connectionState.reconnectTimer = null
        }
        connectionState.reconnectAttempt = 0
        openConnection()
      }
    },

    close() {
      connectionState.intentionallyClosed = true
      if (connectionState.reconnectTimer) {
        clearTimeout(connectionState.reconnectTimer)
        connectionState.reconnectTimer = null
      }
      clearConnectTimer()
      if (connectionState.handshakeTimer) {
        clearTimeout(connectionState.handshakeTimer)
        connectionState.handshakeTimer = null
      }
      stopActivityProbe()
      if (connectionState.ws) {
        connectionState.ws.close()
        connectionState.ws = null
      }
      connectionState.sharedKey = null
      setState('disconnected')
      // Why: closing the client cannot retract request frames already written.
      rejectAllPending('Client closed', { deliveryUnknown: true })
    }
  }
}
