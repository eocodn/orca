import { describe, expect, it, vi } from 'vitest'
import { runPtyConnectionSshDeferredSession } from './pty-connection-ssh-deferred-session-controller'

function createHarness(
  overrides: Partial<Parameters<typeof runPtyConnectionSshDeferredSession>[0]> = {}
) {
  const waitForConnection = vi.fn(async () => ({ connected: true as const }))
  const removeDeferredReconnectTarget = vi.fn()
  const reportError = vi.fn()
  const attachRetainedLegacyPty = vi.fn(() => true)
  const removeDeferredSession = vi.fn()
  const scheduleRuntimeGraphSync = vi.fn()
  const startFreshColdRestore = vi.fn(async () => 'pty-fresh')
  const coldRestoreStartup = { launchToken: 'token-1' } as never
  const buildColdRestoreStartup = vi.fn(() => coldRestoreStartup)
  const clearPaneMode2031State = vi.fn()
  const clearHiddenOutputRestoreState = vi.fn()
  const clearBindings = vi.fn()
  const attemptReattach = vi.fn(async () => {})
  const logWarning = vi.fn()
  const args = {
    tabId: 'tab-1',
    pendingSessionId: null,
    needsPassphrasePrompt: vi.fn(async () => false),
    getSshStatus: vi.fn(() => 'connected' as string | undefined),
    subscribeSshStatus: vi.fn(() => vi.fn()),
    outcomeForStatus: vi.fn(() => null),
    isCurrentAuthority: vi.fn(() => true),
    isDisposed: vi.fn(() => false),
    waitTeardowns: [] as (() => void)[],
    waitForConnection,
    removeDeferredReconnectTarget,
    reportError,
    legacyWorkerAutomaticResumeBlocked: vi.fn(() => false),
    attachRetainedLegacyPty,
    removeDeferredSession,
    scheduleRuntimeGraphSync,
    startFreshColdRestore,
    buildColdRestoreStartup,
    clearPaneMode2031State,
    clearHiddenOutputRestoreState,
    getTransportStreamGeneration: vi.fn(() => 7),
    isCurrentReattachAuthority: vi.fn(() => true),
    rejectObsoleteReattachAuthority: vi.fn(() => false),
    isSessionExpiredError: vi.fn(() => false),
    clearBindings,
    attemptReattach,
    logWarning,
    ...overrides
  }
  return {
    args,
    attachRetainedLegacyPty,
    attemptReattach,
    buildColdRestoreStartup,
    clearBindings,
    clearHiddenOutputRestoreState,
    clearPaneMode2031State,
    coldRestoreStartup,
    logWarning,
    removeDeferredReconnectTarget,
    removeDeferredSession,
    reportError,
    scheduleRuntimeGraphSync,
    startFreshColdRestore,
    waitForConnection: args.waitForConnection
  }
}

describe('runPtyConnectionSshDeferredSession', () => {
  it('short-circuits stale prompt admission before waiting for a connection', async () => {
    const state = createHarness({ isCurrentAuthority: vi.fn(() => false) })

    await expect(runPtyConnectionSshDeferredSession(state.args)).resolves.toBe('stale')
    expect(state.waitForConnection).not.toHaveBeenCalled()
  })

  it('reports a failed shared connection without dispatching saved-session work', async () => {
    const state = createHarness({
      waitForConnection: vi.fn(async () => ({ connected: false as const, error: 'denied' }))
    })

    await expect(runPtyConnectionSshDeferredSession(state.args)).resolves.toBe('failed')
    expect(state.reportError).toHaveBeenCalledWith('SSH connection failed: denied')
    expect(state.removeDeferredReconnectTarget).not.toHaveBeenCalled()
    expect(state.startFreshColdRestore).not.toHaveBeenCalled()
  })

  it('drops a connected result after direct SSH authority changes', async () => {
    const isCurrentAuthority = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)
    const state = createHarness({ isCurrentAuthority })

    await expect(runPtyConnectionSshDeferredSession(state.args)).resolves.toBe('stale')
    expect(state.removeDeferredReconnectTarget).not.toHaveBeenCalled()
    expect(state.startFreshColdRestore).not.toHaveBeenCalled()
  })

  it('starts a fresh cold restore when the connected tab has no saved session', async () => {
    const state = createHarness()

    await expect(runPtyConnectionSshDeferredSession(state.args)).resolves.toBe('connected')
    expect(state.removeDeferredReconnectTarget).toHaveBeenCalledOnce()
    expect(state.startFreshColdRestore).toHaveBeenCalledWith()
    expect(state.attemptReattach).not.toHaveBeenCalled()
  })

  it('uses retained attach when the legacy worker still owns the saved session', async () => {
    const state = createHarness({
      pendingSessionId: 'ssh:conn-1@@pty-1',
      legacyWorkerAutomaticResumeBlocked: vi.fn(() => true)
    })

    await expect(runPtyConnectionSshDeferredSession(state.args)).resolves.toBe('connected')
    expect(state.attachRetainedLegacyPty).toHaveBeenCalledWith('ssh:conn-1@@pty-1')
    expect(state.removeDeferredSession).toHaveBeenCalledOnce()
    expect(state.scheduleRuntimeGraphSync).toHaveBeenCalledOnce()
    expect(state.attemptReattach).not.toHaveBeenCalled()
  })

  it('prepares saved-session reattach and wires expired fallback to a blank cold restore', async () => {
    const state = createHarness({ pendingSessionId: 'ssh:conn-1@@pty-1' })

    await expect(runPtyConnectionSshDeferredSession(state.args)).resolves.toBe('connected')
    expect(state.removeDeferredSession).toHaveBeenCalledOnce()
    expect(state.buildColdRestoreStartup).toHaveBeenCalledOnce()
    expect(state.clearPaneMode2031State).toHaveBeenCalledOnce()
    expect(state.clearHiddenOutputRestoreState).toHaveBeenCalledOnce()
    expect(state.attemptReattach).toHaveBeenCalledOnce()
    const options = state.attemptReattach.mock.calls[0]?.[0]
    expect(options).toMatchObject({
      sessionId: 'ssh:conn-1@@pty-1',
      coldRestoreStartup: state.coldRestoreStartup
    })

    options?.onExpired()
    expect(state.clearBindings).toHaveBeenCalledWith('ssh:conn-1@@pty-1')
    expect(state.startFreshColdRestore).toHaveBeenCalledWith(state.coldRestoreStartup, {
      forceBlankRestoredViewport: true
    })
  })
})
