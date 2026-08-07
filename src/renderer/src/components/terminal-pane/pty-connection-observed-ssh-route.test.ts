import { describe, expect, it, vi } from 'vitest'
import { runPtyConnectionObservedSshRoute } from './pty-connection-observed-ssh-route'

function createHarness(
  overrides: Partial<Parameters<typeof runPtyConnectionObservedSshRoute>[0]> = {}
) {
  const order: string[] = []
  const needsPassphrasePrompt = vi.fn(async () => {
    order.push('prompt')
    return false
  })
  const attemptReattach = vi.fn(async () => {
    order.push('reattach')
  })
  const args: Parameters<typeof runPtyConnectionObservedSshRoute>[0] = {
    route: {
      connectionId: 'conn-1',
      tabId: 'tab-1',
      sshStatus: undefined,
      sshTargetLabels: new Map([['conn-1', 'SSH target']]),
      isDeferredTarget: false,
      restoredLeafSessionId: null,
      deferredTabSessionId: undefined,
      tabPtyId: null,
      hasLeafSessionMap: false,
      legacyWorkerAutomaticResumeBlocked: false,
      recordRouteDiagnostic: (message) => order.push(`route:${message}`)
    },
    session: {
      tabId: 'tab-1',
      needsPassphrasePrompt,
      getSshStatus: () => undefined,
      subscribeSshStatus: () => vi.fn(),
      outcomeForStatus: () => null,
      isCurrentAuthority: () => true,
      isDisposed: () => false,
      waitTeardowns: [],
      waitForConnection: async () => ({ connected: true }),
      removeDeferredReconnectTarget: () => order.push('remove-target'),
      reportError: (message) => order.push(`error:${message}`),
      legacyWorkerAutomaticResumeBlocked: () => false,
      attachRetainedLegacyPty: () => false,
      removeDeferredSession: () => order.push('remove-session'),
      scheduleRuntimeGraphSync: () => order.push('sync'),
      startFreshColdRestore: () => order.push('cold-restore'),
      buildColdRestoreStartup: () => null,
      clearPaneMode2031State: () => order.push('clear-mode'),
      clearHiddenOutputRestoreState: () => order.push('clear-hidden'),
      getTransportStreamGeneration: () => 7,
      isCurrentReattachAuthority: () => true,
      rejectObsoleteReattachAuthority: () => false,
      isSessionExpiredError: () => false,
      clearBindings: () => order.push('clear-bindings'),
      attemptReattach,
      logWarning: (...values) => order.push(`warn:${String(values[0])}`)
    },
    ...overrides
  }
  return { args, attemptReattach, needsPassphrasePrompt, order }
}

describe('runPtyConnectionObservedSshRoute', () => {
  it('suppresses a removed target without starting a deferred session', async () => {
    const state = createHarness()
    state.args.route.sshTargetLabels = new Map([['other', 'Other target']])

    expect(runPtyConnectionObservedSshRoute(state.args)).toBe(true)
    await Promise.resolve()

    expect(state.needsPassphrasePrompt).not.toHaveBeenCalled()
    expect(state.order).toEqual([])
  })

  it('falls through for a connected target with no deferred work', async () => {
    const state = createHarness()
    state.args.route.sshStatus = 'connected'

    expect(runPtyConnectionObservedSshRoute(state.args)).toBe(false)
    await Promise.resolve()

    expect(state.needsPassphrasePrompt).not.toHaveBeenCalled()
    expect(state.order).toEqual([
      'route:[pty-connection] SSH tab=tab-1 connectionId=conn-1 pendingSessionId=null sshConnected=true'
    ])
  })

  it('starts the selected restored-session transaction and stops normal routing', async () => {
    const state = createHarness()
    state.args.route.restoredLeafSessionId = 'ssh:conn-1@@pty-1'

    expect(runPtyConnectionObservedSshRoute(state.args)).toBe(true)
    await vi.waitFor(() => expect(state.attemptReattach).toHaveBeenCalledOnce())

    expect(state.order).toEqual([
      'route:[pty-connection] SSH tab=tab-1 connectionId=conn-1 pendingSessionId=ssh:conn-1@@pty-1 sshConnected=false',
      'prompt',
      'remove-target',
      'warn:[pty-connection] Attempting reattach for tab=tab-1 sessionId=ssh:conn-1@@pty-1',
      'remove-session',
      'clear-mode',
      'clear-hidden',
      'reattach'
    ])
  })
})
