import { describe, expect, it, vi } from 'vitest'
import type { ReattachAttemptOptions } from './pty-connection-reattach-attempt-controller'
import { runPtyConnectionRestoredReattachSession } from './pty-connection-restored-reattach-session'

function createHarness(
  overrides: Partial<Parameters<typeof runPtyConnectionRestoredReattachSession>[0]> = {}
) {
  const order: string[] = []
  const coldRestoreStartup = { command: 'codex resume' } as never
  const attemptReattach = vi.fn(async (_options: ReattachAttemptOptions) => {})
  const args: Parameters<typeof runPtyConnectionRestoredReattachSession>[0] = {
    paneId: 3,
    tabId: 'tab-1',
    worktreeId: 'wt-1',
    leafId: 'leaf-1',
    sessionId: 'wt-1@@pty-1',
    setAllowInitialIdleCacheSeed: (value) => order.push(`seed:${value}`),
    recordDiagnostic: (message) => order.push(message),
    buildColdRestoreStartup: () => {
      order.push('build-startup')
      return coldRestoreStartup
    },
    isDisposed: () => false,
    getTransportStreamGeneration: () => 7,
    isCurrentAuthority: () => true,
    rejectObsoleteAuthority: () => false,
    isRejectedSessionExpired: () => false,
    clearPaneBinding: (sessionId) => order.push(`pane:${sessionId}`),
    clearTabBinding: (sessionId) => order.push(`tab:${sessionId}`),
    startFreshColdRestore: (startup, options) => {
      order.push(`restore:${startup === coldRestoreStartup}:${options.forceBlankRestoredViewport}`)
    },
    reportError: (message) => order.push(`error:${message}`),
    warnLifecycleAnomaly: (event, details) => order.push(`warn:${event}:${details.ptyId}`),
    attemptReattach,
    ...overrides
  }
  return { args, attemptReattach, coldRestoreStartup, order }
}

describe('runPtyConnectionRestoredReattachSession', () => {
  it('prepares the restored-session transaction before starting reattach', () => {
    const state = createHarness()

    runPtyConnectionRestoredReattachSession(state.args)

    expect(state.order).toEqual(['seed:true', 'pane=3 -> REATTACH wt-1@@pty-1', 'build-startup'])
    expect(state.attemptReattach).toHaveBeenCalledOnce()
    expect(state.attemptReattach.mock.calls[0]?.[0]).toMatchObject({
      sessionId: 'wt-1@@pty-1',
      coldRestoreStartup: state.coldRestoreStartup
    })
  })

  it('clears exact bindings and starts a blank cold restore after expiry', () => {
    const state = createHarness()

    runPtyConnectionRestoredReattachSession(state.args)
    state.attemptReattach.mock.calls[0]?.[0].onExpired()

    expect(state.order).toEqual([
      'seed:true',
      'pane=3 -> REATTACH wt-1@@pty-1',
      'build-startup',
      'pane:wt-1@@pty-1',
      'tab:wt-1@@pty-1',
      'restore:true:true'
    ])
  })

  it('preserves restored-session lifecycle context for rejected attempts', () => {
    const state = createHarness()

    runPtyConnectionRestoredReattachSession(state.args)
    state.attemptReattach.mock.calls[0]?.[0].onRejected(new Error('reattach failed'), 7)

    expect(state.order).toEqual([
      'seed:true',
      'pane=3 -> REATTACH wt-1@@pty-1',
      'build-startup',
      'warn:restored PTY reattach threw:wt-1@@pty-1',
      'pane:wt-1@@pty-1',
      'tab:wt-1@@pty-1',
      'error:reattach failed',
      'restore:true:true'
    ])
  })
})
