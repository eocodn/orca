import { redactSocketEndpoint } from './socket-event-debug'
import { AUTH_RETRY_BUDGET, GIVE_UP_AFTER_ATTEMPTS, RECONNECT_DELAYS, TRICKLE_RECONNECT_DELAY_MS, UNAUTHORIZED_CLOSE_CODE } from './rpc-client-connection-policy'
import type { ConnectionState } from './types'

type SessionState = {
  ws: WebSocket | null
  state: ConnectionState
  reconnectAttempt: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  intentionallyClosed: boolean
  authRejectionCount: number
  authenticationGeneration: number
  sharedKey: Uint8Array | null
  handshakeTimer: ReturnType<typeof setTimeout> | null
  lastWsClosedAt: number | null
}
type Dependencies = {
  endpoint: string
  session: SessionState
  emitLog: (level: 'info' | 'warn' | 'error' | 'success', message: string, detail?: string) => void
  setState: (state: ConnectionState) => void
  rejectConnectWaiters: (reason: string) => void
  rejectAllPending: (reason: string, options?: { deliveryUnknown?: boolean }) => void
  markStreamsForReplay: () => void
  clearConnectTimer: () => void
  stopActivityProbe: () => void
  openConnection: () => void
  pending: Map<string, unknown>
  streamListeners: Map<string, unknown>
  streamState: { activeBrowserScreencastRequestId: string | null; pendingBrowserScreencastRequestId: string | null }
  synthesizedCloses: { takeUnauthorized: (socket: WebSocket, closeCode: number | undefined, generation: number, unauthorizedCode: number) => boolean; remember: (socket: WebSocket, generation: number) => void }
}
export function createRpcConnectionLifecycle(deps: Dependencies) {
  const { endpoint, session, emitLog, setState, rejectConnectWaiters, rejectAllPending, markStreamsForReplay, clearConnectTimer, stopActivityProbe, openConnection, pending, streamListeners, streamState, synthesizedCloses } = deps
  function handleSocketClosed(
    closedWs: WebSocket,
    opts: { timedOut?: boolean; closeCode?: number } = {}
  ) {
    if (session.ws !== closedWs) {
      if (
        synthesizedCloses.takeUnauthorized(
          closedWs,
          opts.closeCode,
          session.authenticationGeneration,
          UNAUTHORIZED_CLOSE_CODE
        )
      ) {
        handleAuthRejection('Unauthorized — pairing may be revoked', true)
        return
      }
      console.log('[net] handleSocketClosed STALE — ignoring (session.ws already swapped)', {
        state: session.state,
        attempt: session.reconnectAttempt
      })
      return
    }
    session.lastWsClosedAt = Date.now()
    clearConnectTimer()
    session.ws = null
    session.sharedKey = null
    streamState.activeBrowserScreencastRequestId = null
    streamState.pendingBrowserScreencastRequestId = null
    markStreamsForReplay()
    if (session.handshakeTimer) {
      clearTimeout(session.handshakeTimer)
      session.handshakeTimer = null
    }
    stopActivityProbe()
    if (session.intentionallyClosed) {
      console.log('[net] handleSocketClosed — intentional close')
      setState('disconnected')
      rejectAllPending('Connection closed', { deliveryUnknown: true })
      return
    }
    // Why: a bare 4001 close means the desktop rejected our pairing but the encrypted
    // e2ee_error never arrived (or was undecryptable) — count it against the auth
    // retry budget instead of looping the generic reconnect forever.
    if (opts.closeCode === UNAUTHORIZED_CLOSE_CODE) {
      console.log('[net] handleSocketClosed — unauthorized close code', {
        attempt: session.reconnectAttempt
      })
      handleAuthRejection('Unauthorized — pairing may be revoked')
      return
    }
    console.log('[net] handleSocketClosed → reconnect', {
      timedOut: !!opts.timedOut,
      pendingCount: pending.size,
      streamCount: streamListeners.size,
      attempt: session.reconnectAttempt
    })
    emitLog('warn', 'WebSocket closed', 'Will attempt to reconnect')
    rejectAllPending('Connection interrupted', { deliveryUnknown: true })
    setState('reconnecting')
    scheduleReconnect()
  }

  // Why: an auth rejection may be transient (issue #5200) — retry up to AUTH_RETRY_BUDGET times before latching auth-failed.
  function handleAuthRejection(reason: string, preserveRecovery = false): void {
    session.authRejectionCount++
    if (session.authRejectionCount < AUTH_RETRY_BUDGET) {
      console.log('[net] auth rejected — retrying handshake', {
        attempt: session.authRejectionCount,
        budget: AUTH_RETRY_BUDGET,
        endpoint: redactSocketEndpoint(endpoint)
      })
      emitLog(
        'warn',
        'Authentication rejected',
        `Retrying (${session.authRejectionCount}/${AUTH_RETRY_BUDGET})`
      )
      if (preserveRecovery) {
        return
      }
      streamState.activeBrowserScreencastRequestId = null
      streamState.pendingBrowserScreencastRequestId = null
      // Why: close without setting session.intentionallyClosed so handleSocketClosed routes to reconnect and retries the handshake.
      const closing = session.ws
      session.ws = null
      session.sharedKey = null
      // Why: close cleanup stale-bails here, so mark active streams for replay.
      markStreamsForReplay()
      rejectAllPending(reason, { deliveryUnknown: true })
      if (closing) {
        closing.close()
      }
      setState('reconnecting')
      scheduleReconnect()
      return
    }
    streamState.activeBrowserScreencastRequestId = null
    streamState.pendingBrowserScreencastRequestId = null
    console.log('[net] auth rejected — budget exhausted, latching auth-failed', {
      attempt: session.authRejectionCount,
      endpoint: redactSocketEndpoint(endpoint)
    })
    session.intentionallyClosed = true
    session.ws?.close()
    session.ws = null
    setState('auth-failed')
    rejectAllPending(reason, { deliveryUnknown: true })
  }

  function scheduleReconnect() {
    // Why: past the cap, trickle (never park) — a parked loop only revives on a network transition a wedged VPN never produces.
    const pastGiveUpCap = session.reconnectAttempt >= GIVE_UP_AFTER_ATTEMPTS
    let delay: number
    if (pastGiveUpCap) {
      // Why: hold the counter at the cap — connection-health's "Can't reach desktop" verdict keys off attempts >= 12.
      delay = TRICKLE_RECONNECT_DELAY_MS
      rejectConnectWaiters('Connection retry limit reached')
    } else {
      delay = RECONNECT_DELAYS[Math.min(session.reconnectAttempt, RECONNECT_DELAYS.length - 1)]!
      session.reconnectAttempt++
    }
    console.log('[net] scheduleReconnect', {
      delayMs: delay,
      attempt: session.reconnectAttempt,
      trickle: pastGiveUpCap
    })
    emitLog(
      'info',
      `Reconnect scheduled in ${delay}ms`,
      pastGiveUpCap ? `Attempt ${session.reconnectAttempt} (slow retry)` : `Attempt ${session.reconnectAttempt}`
    )
    session.reconnectTimer = setTimeout(() => {
      session.reconnectTimer = null
      if (!session.intentionallyClosed && session.state === 'reconnecting') {
        openConnection()
      }
    }, delay)
  }


  return { handleSocketClosed, handleAuthRejection, scheduleReconnect }
}
