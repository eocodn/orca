/* Owns the WebSocket lifecycle and replay state for web runtime clients. */
import type { RuntimeRpcResponse, RuntimeRpcSuccess } from '../../../shared/runtime-rpc-envelope'
import { isKeepaliveFrame } from '../../../shared/runtime-rpc-envelope'
import type { WebPairingOffer } from './web-pairing'
import type { WebRuntimeClient } from './web-runtime-connection'
import { installWindowVisibilityInterval } from '../lib/window-visibility-interval'
import { withRemoteRuntimeTailscaleHint } from '../../../shared/remote-runtime-tailscale-hint'
import {
  decrypt,
  decryptBytes,
  deriveSharedKey,
  encrypt,
  encryptBytes,
  generateKeyPair,
  publicKeyFromBase64,
  publicKeyToBase64
} from './web-e2ee'
import { SESSION_TAB_CLOSE_INTENT_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import { createWebRuntimeUnauthorizedError } from './web-runtime-client-error'
import {
  createFileWatchReplayOverflowResponse,
  getFileWatchSubscriptionId,
  isEndResult,
  isFileWatchStartingResponse,
  isRuntimeFailureResponse,
  websocketPayloadToUint8
} from './web-runtime-connection-frame'

export type WebRuntimeConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'handshaking'
  | 'connected'
  | 'auth-failed'

type PendingRequest = {
  method: string
  resolve: (response: RuntimeRpcResponse<unknown>) => void
  reject: (error: Error) => void
  timeout: number
}

export type SubscriptionCallbacks = {
  onResponse: (response: RuntimeRpcResponse<unknown>) => void
  onBinary?: (bytes: Uint8Array<ArrayBufferLike>) => void
  onError?: (error: { code: string; message: string }) => void
  onClose?: () => void
  onTransportInterrupted?: () => void
  onTransportReplayed?: () => void
}

export type RuntimeSubscription = {
  id: string
  method: string
  params: unknown
  callbacks: SubscriptionCallbacks
  needsReplay: boolean
}

export type WebRuntimeSubscriptionHandle = {
  unsubscribe: () => void
  sendBinary: (bytes: Uint8Array<ArrayBufferLike>) => void
}

export type SubscribeOptions = {
  timeoutMs?: number
  // Why: token-keyed server cleanup needs an explicit unsubscribe to be reaped on view-toggle, not just socket close.
  buildUnsubscribe?: (params: unknown) => { method: string; params: unknown } | null
}

export const REQUEST_TIMEOUT_MS = 30_000
const CONNECT_TIMEOUT_MS = 12_000
const HANDSHAKE_TIMEOUT_MS = 10_000
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15_000]
export const SHARED_CONNECTION_SUBSCRIPTION_METHODS = new Set(['files.watch'])
// Why: browser WebSockets hide pings/pongs, so a half-open socket stays OPEN with no onclose/onerror — poll liveness in-app.
const HEARTBEAT_INTERVAL_MS = 10_000
const HEARTBEAT_IDLE_MS = 25_000
const HEARTBEAT_PROBE_GRACE_MS = 20_000

export class WebRuntimeConnectionLifecycle {

  protected ws: WebSocket | null = null
  protected sharedKey: Uint8Array | null = null
  protected state: WebRuntimeConnectionState = 'disconnected'
  protected requestCounter = 0
  protected reconnectAttempt = 0
  protected intentionallyClosed = false
  protected connectTimer: number | null = null
  protected handshakeTimer: number | null = null
  protected reconnectTimer: number | null = null
  protected heartbeatCleanup: (() => void) | null = null
  protected lastInboundFrameAt = 0
  // Timestamp of an outstanding liveness probe (null = none); dead-close fires only on an unanswered sent probe.
  protected heartbeatProbeSentAt: number | null = null
  // Why: tracks last tick time to detect a suspended loop (frozen tab) so a long gap re-probes instead of closing.
  protected lastHeartbeatTickAt = 0
  protected readonly pending = new Map<string, PendingRequest>()
  protected readonly subscriptions = new Map<string, RuntimeSubscription>()
  protected readonly fileWatchTeardownRetries = new Map<string, Set<() => Promise<void>>>()
  protected readonly childClients = new Set<WebRuntimeClient>()
  protected readonly waiters: { resolve: () => void; reject: (error: Error) => void }[] = []
  protected readonly serverPublicKey: Uint8Array

  constructor(protected readonly pairing: WebPairingOffer) {
    this.serverPublicKey = publicKeyFromBase64(pairing.publicKeyB64)
    this.openConnection()
  }

  protected openConnection(): void {
    if (this.intentionallyClosed) {
      return
    }
    let ws: WebSocket
    try {
      ws = new WebSocket(this.pairing.endpoint)
    } catch (error) {
      this.rejectAllPending(error instanceof Error ? error.message : String(error))
      this.scheduleReconnect()
      return
    }

    ws.binaryType = 'arraybuffer'
    this.ws = ws
    this.sharedKey = null
    this.setState('connecting')

    this.connectTimer = window.setTimeout(() => {
      if (this.ws === ws && ws.readyState === WebSocket.CONNECTING) {
        ws.close()
        this.handleSocketClosed(ws)
      }
    }, CONNECT_TIMEOUT_MS)

    ws.onopen = () => {
      if (this.ws !== ws) {
        return
      }
      this.clearConnectTimer()
      this.setState('handshaking')
      const keyPair = generateKeyPair()
      this.sharedKey = deriveSharedKey(keyPair.secretKey, this.serverPublicKey)
      ws.send(
        JSON.stringify({
          type: 'e2ee_hello',
          publicKeyB64: publicKeyToBase64(keyPair.publicKey)
        })
      )
      this.handshakeTimer = window.setTimeout(() => {
        if (this.ws === ws && this.state === 'handshaking') {
          ws.close()
        }
      }, HANDSHAKE_TIMEOUT_MS)
    }

    ws.onmessage = (event) => {
      // Why: stale callbacks from a pre-reconnect socket must not drive state on the replacement this.ws.
      if (this.ws !== ws) {
        return
      }
      // Why: any inbound frame proves the socket is alive — reset the liveness watchdog and clear any outstanding probe.
      this.lastInboundFrameAt = this.now()
      this.heartbeatProbeSentAt = null
      void this.handleSocketMessage(event.data, ws)
    }

    ws.onclose = () => this.handleSocketClosed(ws)
    ws.onerror = () => {
      if (this.state === 'connecting') {
        this.rejectAllWaiters(
          new Error(
            withRemoteRuntimeTailscaleHint(
              'Could not connect to the remote Orca runtime.',
              this.pairing.endpoint
            )
          )
        )
      }
    }
  }

  protected async handleSocketMessage(rawData: unknown, sourceWs?: WebSocket): Promise<void> {
    const raw = typeof rawData === 'string' ? rawData : null
    if (this.state === 'handshaking') {
      if (raw === null || !this.sharedKey) {
        return
      }
      try {
        const control = JSON.parse(raw) as { type?: unknown }
        if (control.type === 'e2ee_ready') {
          this.sendEncrypted({
            type: 'e2ee_auth',
            deviceToken: this.pairing.deviceToken,
            clientCapabilities: [SESSION_TAB_CLOSE_INTENT_RUNTIME_CAPABILITY]
          })
          return
        }
      } catch {
        // The authenticated control frame is encrypted, so non-JSON is normal here.
      }

      const plaintext = decrypt(raw, this.sharedKey)
      if (plaintext === null) {
        return
      }
      try {
        const control = JSON.parse(plaintext) as {
          type?: unknown
          error?: { code?: string; message?: string }
        }
        if (control.type === 'e2ee_authenticated') {
          this.clearHandshakeTimer()
          this.reconnectAttempt = 0
          this.setState('connected')
        } else if (control.type === 'e2ee_error' || control.error?.code === 'unauthorized') {
          this.intentionallyClosed = true
          this.setState('auth-failed')
          this.rejectAllPending(createWebRuntimeUnauthorizedError())
          this.notifySubscriptionsError('unauthorized', 'Unauthorized. Pair this web client again.')
          this.ws?.close()
        }
      } catch {
        // Ignore malformed handshake payloads; the server will close on timeout.
      }
      return
    }

    if (this.state !== 'connected' || !this.sharedKey) {
      return
    }

    if (raw === null) {
      const encrypted = await websocketPayloadToUint8(rawData)
      if (sourceWs && this.ws !== sourceWs) {
        return
      }
      if (!encrypted) {
        return
      }
      const plaintext = decryptBytes(encrypted, this.sharedKey)
      if (!plaintext) {
        return
      }
      for (const subscription of this.subscriptions.values()) {
        subscription.callbacks.onBinary?.(plaintext)
      }
      return
    }

    const plaintext = decrypt(raw, this.sharedKey)
    if (plaintext === null) {
      return
    }

    let response: RuntimeRpcResponse<unknown> | Record<string, unknown>
    try {
      response = JSON.parse(plaintext) as RuntimeRpcResponse<unknown> | Record<string, unknown>
    } catch {
      return
    }
    if (isKeepaliveFrame(response)) {
      return
    }
    if (!('id' in response) || typeof response.id !== 'string') {
      return
    }
    if (isRuntimeFailureResponse(response) && response.error.code === 'unauthorized') {
      this.intentionallyClosed = true
      this.setState('auth-failed')
      this.rejectAllPending(createWebRuntimeUnauthorizedError())
      this.notifySubscriptionsError('unauthorized', 'Unauthorized. Pair this web client again.')
      this.ws?.close()
      return
    }

    const subscription = this.subscriptions.get(response.id)
    if (subscription) {
      const subscriptionResponse = response as RuntimeRpcResponse<unknown>
      // Why: setup failures must be evicted before callbacks so reconnect cannot replay them.
      if (subscriptionResponse.ok === false) {
        this.subscriptions.delete(response.id)
      }
      // Why: subscription-backed unary RPCs can return ordinary success frames.
      subscription.callbacks.onResponse(subscriptionResponse)
      if (subscriptionResponse.ok && isEndResult(subscriptionResponse.result)) {
        this.subscriptions.delete(response.id)
        subscription.callbacks.onClose?.()
      }
      return
    }

    const pending = this.pending.get(response.id)
    if (!pending) {
      return
    }
    this.pending.delete(response.id)
    window.clearTimeout(pending.timeout)
    pending.resolve(response as RuntimeRpcResponse<unknown>)
  }

  protected sendEncrypted(message: unknown): boolean {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.sharedKey) {
      return false
    }
    ws.send(encrypt(JSON.stringify(message), this.sharedKey))
    return true
  }

  protected sendEncryptedBinary(bytes: Uint8Array<ArrayBufferLike>): boolean {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.sharedKey) {
      return false
    }
    ws.send(encryptBytes(bytes, this.sharedKey))
    return true
  }

  protected waitForConnected(timeoutMs = REQUEST_TIMEOUT_MS): Promise<void> {
    if (this.state === 'connected') {
      return Promise.resolve()
    }
    if (this.state === 'auth-failed') {
      return Promise.reject(createWebRuntimeUnauthorizedError())
    }
    if (this.intentionallyClosed) {
      return Promise.reject(new Error('Remote Orca runtime connection closed.'))
    }
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.resolve === resolve)
        if (index !== -1) {
          this.waiters.splice(index, 1)
        }
        reject(
          new Error(
            withRemoteRuntimeTailscaleHint(
              'Timed out while connecting to the remote Orca runtime.',
              this.pairing.endpoint
            )
          )
        )
      }, timeoutMs)
      this.waiters.push({
        resolve: () => {
          window.clearTimeout(timeout)
          resolve()
        },
        reject: (error) => {
          window.clearTimeout(timeout)
          reject(error)
        }
      })
    })
  }

  protected handleSocketClosed(closedWs: WebSocket): void {
    if (this.ws !== closedWs) {
      return
    }
    this.ws = null
    this.sharedKey = null
    this.clearConnectTimer()
    this.clearHandshakeTimer()
    this.clearHeartbeatTimer()
    this.rejectAllPending('Remote Orca runtime connection interrupted.')
    this.handleInterruptedSubscriptions()
    if (this.intentionallyClosed || this.state === 'auth-failed') {
      this.setState(this.state === 'auth-failed' ? 'auth-failed' : 'disconnected')
      return
    }
    this.setState('disconnected')
    this.scheduleReconnect()
  }

  protected scheduleReconnect(): void {
    if (this.reconnectTimer || this.intentionallyClosed) {
      return
    }
    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]
    this.reconnectAttempt += 1
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.openConnection()
    }, delay)
  }

  protected setState(next: WebRuntimeConnectionState): void {
    this.state = next
    if (next === 'connected') {
      this.replayInterruptedSubscriptions()
      this.startHeartbeat()
      for (const waiter of this.waiters.splice(0)) {
        waiter.resolve()
      }
    } else if (next === 'auth-failed') {
      this.rejectAllWaiters(createWebRuntimeUnauthorizedError())
    }
  }

  protected nextId(): string {
    this.requestCounter += 1
    return `web-rpc-${this.requestCounter}-${Date.now()}`
  }

  protected rejectAllPending(reason: string | Error): void {
    const error = typeof reason === 'string' ? new Error(reason) : reason
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      window.clearTimeout(pending.timeout)
      pending.reject(error)
    }
  }

  protected rejectAllWaiters(error: Error): void {
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error)
    }
  }

  protected notifySubscriptionsClosed(): void {
    const subscriptions = Array.from(this.subscriptions.values())
    this.subscriptions.clear()
    for (const subscription of subscriptions) {
      subscription.callbacks.onClose?.()
    }
  }

  protected handleInterruptedSubscriptions(): void {
    for (const [id, subscription] of Array.from(this.subscriptions)) {
      if (!SHARED_CONNECTION_SUBSCRIPTION_METHODS.has(subscription.method)) {
        this.subscriptions.delete(id)
        subscription.callbacks.onClose?.()
        continue
      }
      subscription.callbacks.onTransportInterrupted?.()
      if (this.subscriptions.get(subscription.id) === subscription) {
        subscription.needsReplay = true
      }
    }
  }

  protected replayInterruptedSubscriptions(): void {
    for (const subscription of Array.from(this.subscriptions.values())) {
      if (!subscription.needsReplay) {
        continue
      }
      this.subscriptions.delete(subscription.id)
      subscription.id = this.nextId()
      subscription.needsReplay = false
      this.subscriptions.set(subscription.id, subscription)
      if (
        this.sendEncrypted({
          id: subscription.id,
          deviceToken: this.pairing.deviceToken,
          method: subscription.method,
          params: subscription.params
        })
      ) {
        subscription.callbacks.onTransportReplayed?.()
      } else {
        subscription.needsReplay = true
      }
    }
  }

  protected notifySubscriptionsError(code: string, message: string): void {
    const subscriptions = Array.from(this.subscriptions.values())
    this.subscriptions.clear()
    for (const subscription of subscriptions) {
      subscription.callbacks.onError?.({ code, message })
    }
  }

  protected clearTimers(): void {
    this.clearConnectTimer()
    this.clearHandshakeTimer()
    this.clearHeartbeatTimer()
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  protected clearConnectTimer(): void {
    if (this.connectTimer) {
      window.clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
  }

  protected clearHandshakeTimer(): void {
    if (this.handshakeTimer) {
      window.clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }
  }

  // Why: overridable seams so tests can drive deterministic time + visibility without faking globals.
  protected now(): number {
    return Date.now()
  }

  protected isDocumentVisible(): boolean {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden'
  }

  protected startHeartbeat(): void {
    this.clearHeartbeatTimer()
    // Why: this runs at 'connected', right after the handshake's inbound frames — a genuine liveness
    // baseline. Only the fresh-connect moment resets lastInboundFrameAt; the visible re-arm below must not.
    const now = this.now()
    this.lastInboundFrameAt = now
    this.lastHeartbeatTickAt = now
    this.heartbeatProbeSentAt = null
    this.heartbeatCleanup = installWindowVisibilityInterval({
      run: () => this.runHeartbeatTick(),
      runOnVisible: () => this.rebaselineHeartbeat(),
      intervalMs: HEARTBEAT_INTERVAL_MS
    })
  }

  protected rebaselineHeartbeat(): void {
    // Why: the interval is merely parked while hidden, so on becoming visible reset the tick clock (don't
    // let the parked gap trip the suspended-loop rebaseline) and drop a probe that was in flight when we
    // hid. But PRESERVE lastInboundFrameAt: if the socket went silent while hidden, keeping the real
    // last-heard time lets the next tick detect the staleness and probe promptly, instead of masking a
    // dead connection for another full idle window (#9883 review).
    this.lastHeartbeatTickAt = this.now()
    this.heartbeatProbeSentAt = null
  }

  protected clearHeartbeatTimer(): void {
    this.heartbeatCleanup?.()
    this.heartbeatCleanup = null
    this.heartbeatProbeSentAt = null
  }

  protected runHeartbeatTick(): void {
    const now = this.now()
    // Why: a much-later-than-scheduled tick means the loop was suspended (frozen tab), not a dead socket — re-baseline.
    const sinceLastTick = now - this.lastHeartbeatTickAt
    this.lastHeartbeatTickAt = now
    if (sinceLastTick >= HEARTBEAT_INTERVAL_MS * 2) {
      this.lastInboundFrameAt = now
      this.heartbeatProbeSentAt = null
    }
    // Why: don't probe while hidden — no visible staleness to detect and it wastes battery; next visible tick re-checks.
    if (!this.isDocumentVisible()) {
      return
    }
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN || this.state !== 'connected') {
      return
    }
    // Why: close only when a probe we actually sent goes unanswered past grace — never on raw accumulated silence.
    if (
      this.heartbeatProbeSentAt !== null &&
      now - this.heartbeatProbeSentAt >= HEARTBEAT_PROBE_GRACE_MS
    ) {
      ws.close()
      this.handleSocketClosed(ws)
      return
    }
    if (this.heartbeatProbeSentAt === null && now - this.lastInboundFrameAt >= HEARTBEAT_IDLE_MS) {
      // Why: fire-and-forget liveness probe; its id is intentionally unmatched so it registers no pending request/timeout.
      if (
        this.sendEncrypted({
          id: `web-heartbeat-${this.nextId()}`,
          deviceToken: this.pairing.deviceToken,
          method: 'status.get'
        })
      ) {
        this.heartbeatProbeSentAt = now
      }
    }
  }
}
