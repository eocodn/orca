import { describe, expect, it, vi } from 'vitest'
import type { ReattachAttemptOptions } from './pty-connection-reattach-attempt-controller'
import { runPtyConnectionSavedSshReattach } from './pty-connection-saved-ssh-reattach-controller'

const run = (overrides: Partial<Parameters<typeof runPtyConnectionSavedSshReattach>[0]> = {}) => {
  const order: string[] = []
  const attachRetainedLegacyPty = vi.fn(() => true)
  const removeDeferredSession = vi.fn(() => order.push('remove-deferred'))
  const scheduleRuntimeGraphSync = vi.fn(() => order.push('sync-runtime'))
  const startFreshColdRestore = vi.fn(() => order.push('fresh-cold-restore'))
  const coldRestoreStartup = { command: 'codex resume' } as never
  const buildColdRestoreStartup = vi.fn(() => {
    order.push('build-startup')
    return coldRestoreStartup
  })
  const clearPaneMode2031State = vi.fn(() => order.push('clear-mode'))
  const clearHiddenOutputRestoreState = vi.fn(() => order.push('clear-hidden'))
  const fallbackHandlers = {
    onTransportError: vi.fn(),
    onExpired: vi.fn(),
    onRejected: vi.fn()
  }
  const createFallbackHandlers = vi.fn(() => fallbackHandlers)
  let attemptOptions: ReattachAttemptOptions | null = null
  const attemptReattach = vi.fn((options: ReattachAttemptOptions) => {
    order.push('attempt')
    attemptOptions = options
    return Promise.resolve()
  })
  const logAttempt = vi.fn(() => order.push('log-attempt'))
  const logResult = vi.fn()
  const logRejected = vi.fn()
  const result = runPtyConnectionSavedSshReattach({
    pendingSessionId: null,
    legacyWorkerAutomaticResumeBlocked: false,
    attachRetainedLegacyPty,
    removeDeferredSession,
    scheduleRuntimeGraphSync,
    startFreshColdRestore,
    buildColdRestoreStartup,
    clearPaneMode2031State,
    clearHiddenOutputRestoreState,
    createFallbackHandlers,
    attemptReattach,
    logAttempt,
    logResult,
    logRejected,
    ...overrides
  })
  return {
    result,
    order,
    attachRetainedLegacyPty,
    removeDeferredSession,
    scheduleRuntimeGraphSync,
    startFreshColdRestore,
    buildColdRestoreStartup,
    clearPaneMode2031State,
    clearHiddenOutputRestoreState,
    createFallbackHandlers,
    attemptReattach,
    logAttempt,
    logResult,
    logRejected,
    fallbackHandlers,
    getAttemptOptions: () => attemptOptions
  }
}

describe('runPtyConnectionSavedSshReattach', () => {
  it('starts a fresh cold restore when no saved session exists', () => {
    const state = run()

    expect(state.result).toBe('fresh')
    expect(state.startFreshColdRestore).toHaveBeenCalledOnce()
    expect(state.attemptReattach).not.toHaveBeenCalled()
  })

  it('uses retained attach-only routing for a blocked legacy session', () => {
    const state = run({
      pendingSessionId: 'ssh:ssh-1@@legacy',
      legacyWorkerAutomaticResumeBlocked: true
    })

    expect(state.result).toBe('legacy')
    expect(state.attachRetainedLegacyPty).toHaveBeenCalledWith('ssh:ssh-1@@legacy')
    expect(state.removeDeferredSession).toHaveBeenCalledOnce()
    expect(state.scheduleRuntimeGraphSync).toHaveBeenCalledOnce()
    expect(state.attemptReattach).not.toHaveBeenCalled()
  })

  it('keeps deferred metadata when retained legacy attach fails', () => {
    const state = run({
      pendingSessionId: 'ssh:ssh-1@@legacy',
      legacyWorkerAutomaticResumeBlocked: true,
      attachRetainedLegacyPty: () => false
    })

    expect(state.removeDeferredSession).not.toHaveBeenCalled()
    expect(state.scheduleRuntimeGraphSync).not.toHaveBeenCalled()
  })

  it('prepares and starts a normal saved-session reattach in lifecycle order', () => {
    const state = run({ pendingSessionId: 'ssh:ssh-1@@pty-1' })

    expect(state.result).toBe('reattach')
    expect(state.order).toEqual([
      'log-attempt',
      'remove-deferred',
      'build-startup',
      'clear-mode',
      'clear-hidden',
      'attempt'
    ])
    const options = state.getAttemptOptions()
    expect(options?.sessionId).toBe('ssh:ssh-1@@pty-1')
    expect(options?.onTransportError).toBe(state.fallbackHandlers.onTransportError)
    expect(options?.onExpired).toBe(state.fallbackHandlers.onExpired)

    options?.onResult?.('pty-1')
    expect(state.logResult).toHaveBeenCalledWith('pty-1')
    options?.onRejected(new Error('boom'), 7)
    expect(state.logRejected).toHaveBeenCalledWith(expect.any(Error))
    expect(state.fallbackHandlers.onRejected).toHaveBeenCalledWith(expect.any(Error), 7)
  })
})
