import { describe, expect, it, vi } from 'vitest'
import type { ReattachAttemptOptions } from './pty-connection-reattach-attempt-controller'
import { runPtyConnectionDeferredReattach } from './pty-connection-deferred-reattach-controller'

describe('runPtyConnectionDeferredReattach', () => {
  it('enables idle seeding, records the route, and wires fallback handlers in order', () => {
    const order: string[] = []
    const coldRestoreStartup = { command: 'codex resume' } as never
    const fallbackHandlers = {
      onTransportError: vi.fn(),
      onExpired: vi.fn(),
      onRejected: vi.fn()
    }
    let attemptOptions: ReattachAttemptOptions | null = null

    runPtyConnectionDeferredReattach({
      paneId: 3,
      sessionId: 'wt-1@@pty-1',
      setAllowInitialIdleCacheSeed: (value) => order.push(`seed:${value}`),
      recordDiagnostic: (message) => order.push(message),
      buildColdRestoreStartup: () => {
        order.push('build-startup')
        return coldRestoreStartup
      },
      createFallbackHandlers: (sessionId, startup) => {
        order.push(`fallback:${sessionId}:${startup === coldRestoreStartup}`)
        return fallbackHandlers
      },
      attemptReattach: (options) => {
        order.push('attempt')
        attemptOptions = options
        return Promise.resolve()
      }
    })

    expect(order).toEqual([
      'seed:true',
      'pane=3 -> REATTACH wt-1@@pty-1',
      'build-startup',
      'fallback:wt-1@@pty-1:true',
      'attempt'
    ])
    expect(attemptOptions).toEqual({
      sessionId: 'wt-1@@pty-1',
      coldRestoreStartup,
      onTransportError: fallbackHandlers.onTransportError,
      onExpired: fallbackHandlers.onExpired,
      onRejected: fallbackHandlers.onRejected
    })
  })

  it('does not await the reattach promise', () => {
    const never = new Promise<void>(() => {})
    const result = runPtyConnectionDeferredReattach({
      paneId: 1,
      sessionId: 'pty-1',
      setAllowInitialIdleCacheSeed: vi.fn(),
      recordDiagnostic: vi.fn(),
      buildColdRestoreStartup: () => null,
      createFallbackHandlers: () => ({
        onTransportError: vi.fn(),
        onExpired: vi.fn(),
        onRejected: vi.fn()
      }),
      attemptReattach: () => never
    })

    expect(result).toBeUndefined()
  })
})
