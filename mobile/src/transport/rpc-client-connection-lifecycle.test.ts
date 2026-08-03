import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRpcConnectionLifecycle } from './rpc-client-connection-lifecycle'
import { RECONNECT_DELAYS } from './rpc-client-connection-policy'

describe('createRpcConnectionLifecycle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens the connection when a scheduled reconnect timer fires', () => {
    vi.useFakeTimers()
    const openConnection = vi.fn()
    const session = {
      ws: null,
      state: 'reconnecting' as const,
      reconnectAttempt: 0,
      reconnectTimer: null,
      intentionallyClosed: false,
      authRejectionCount: 0,
      authenticationGeneration: 0,
      sharedKey: null,
      handshakeTimer: null,
      lastWsClosedAt: null
    }
    const lifecycle = createRpcConnectionLifecycle({
      endpoint: 'ws://localhost',
      session,
      emitLog: vi.fn(),
      setState: vi.fn(),
      rejectConnectWaiters: vi.fn(),
      rejectAllPending: vi.fn(),
      markStreamsForReplay: vi.fn(),
      clearConnectTimer: vi.fn(),
      stopActivityProbe: vi.fn(),
      openConnection,
      pending: new Map(),
      streamListeners: new Map(),
      streamState: {
        activeBrowserScreencastRequestId: null,
        pendingBrowserScreencastRequestId: null
      },
      synthesizedCloses: {
        takeUnauthorized: () => false,
        remember: vi.fn()
      }
    })

    lifecycle.scheduleReconnect()
    vi.advanceTimersByTime(RECONNECT_DELAYS[0]!)

    expect(openConnection).toHaveBeenCalledOnce()
    expect(session.reconnectTimer).toBeNull()
  })
})
