import { describe, expect, it, vi } from 'vitest'
import { runPtyConnectionSshDeferredRoute } from './pty-connection-ssh-deferred-route'

const BASE = {
  connectionId: 'conn-1',
  tabId: 'tab-1',
  sshStatus: undefined as string | undefined,
  sshTargetLabels: new Map([['conn-1', 'SSH target']]),
  isDeferredTarget: false,
  restoredLeafSessionId: null as string | null,
  deferredTabSessionId: undefined as string | undefined,
  tabPtyId: null as string | null,
  hasLeafSessionMap: false,
  legacyWorkerAutomaticResumeBlocked: false
}

function run(overrides: Partial<typeof BASE> = {}) {
  const dispatchDeferredFlow = vi.fn()
  const recordRouteDiagnostic = vi.fn()
  const shouldStopNormalRouting = runPtyConnectionSshDeferredRoute({
    ...BASE,
    ...overrides,
    dispatchDeferredFlow,
    recordRouteDiagnostic
  })
  return { dispatchDeferredFlow, recordRouteDiagnostic, shouldStopNormalRouting }
}

describe('runPtyConnectionSshDeferredRoute', () => {
  it('suppresses a removed non-runtime SSH target before gate evaluation', () => {
    const state = run({ sshTargetLabels: new Map([['other', 'Other target']]) })

    expect(state.shouldStopNormalRouting).toBe(true)
    expect(state.dispatchDeferredFlow).not.toHaveBeenCalled()
    expect(state.recordRouteDiagnostic).not.toHaveBeenCalled()
  })

  it('exempts runtime-owned targets from removed-target suppression', () => {
    const state = run({
      connectionId: 'runtime-ssh-env-1',
      sshTargetLabels: new Map()
    })

    expect(state.shouldStopNormalRouting).toBe(false)
    expect(state.dispatchDeferredFlow).not.toHaveBeenCalled()
    expect(state.recordRouteDiagnostic).toHaveBeenCalledWith(
      '[pty-connection] SSH tab=tab-1 connectionId=runtime-ssh-env-1 pendingSessionId=null sshConnected=false'
    )
  })

  it('falls through when a connected target has no deferred work', () => {
    const state = run({ sshStatus: 'connected' })

    expect(state.shouldStopNormalRouting).toBe(false)
    expect(state.dispatchDeferredFlow).not.toHaveBeenCalled()
    expect(state.recordRouteDiagnostic).toHaveBeenCalledWith(
      '[pty-connection] SSH tab=tab-1 connectionId=conn-1 pendingSessionId=null sshConnected=true'
    )
  })

  it('falls through when legacy automatic resume owns an already-connected deferred target', () => {
    const state = run({
      sshStatus: 'connected',
      isDeferredTarget: true,
      legacyWorkerAutomaticResumeBlocked: true
    })

    expect(state.shouldStopNormalRouting).toBe(false)
    expect(state.dispatchDeferredFlow).not.toHaveBeenCalled()
  })

  it('dispatches deferred flow with the restored session and stops normal routing', () => {
    const state = run({
      restoredLeafSessionId: 'ssh:conn-1@@pty-1',
      deferredTabSessionId: 'ssh:conn-1@@pty-2',
      tabPtyId: 'ssh:conn-1@@pty-3'
    })

    expect(state.shouldStopNormalRouting).toBe(true)
    expect(state.dispatchDeferredFlow).toHaveBeenCalledWith('ssh:conn-1@@pty-1')
    expect(state.recordRouteDiagnostic).toHaveBeenCalledWith(
      '[pty-connection] SSH tab=tab-1 connectionId=conn-1 pendingSessionId=ssh:conn-1@@pty-1 sshConnected=false'
    )
  })
})
