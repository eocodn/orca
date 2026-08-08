import { describe, expect, it, vi } from 'vitest'
import type { ColdRestoreAgentResumeStartup } from './pty-connection-e2e-support'
import { createPtyConnectionReattachResultAdmissionController } from './pty-connection-reattach-result-admission-controller'
import type { PtyConnectResult } from './pty-transport-types'

function createHarness() {
  const startup = {
    launchToken: 'launch-token',
    agent: 'codex',
    useLiveEntry: false,
    sleepingRecordEntry: { paneKey: 'pane', record: {} }
  } as ColdRestoreAgentResumeStartup
  const clearPaneBinding = vi.fn()
  const clearTabBinding = vi.fn()
  const startFreshColdRestore = vi.fn()
  const registerEffectiveLaunchConfig = vi.fn()
  const warnMissingPty = vi.fn()
  const disconnect = vi.fn()
  const rejectObsoleteDirectSshReattach = vi.fn(() => false)
  let transportPtyId: string | null = 'pty-1'
  const controller = createPtyConnectionReattachResultAdmissionController({
    isDisposed: () => false,
    isGenerationCurrent: () => true,
    getTransportPtyId: () => transportPtyId,
    rejectObsoleteDirectSshReattach,
    warnMissingPty,
    clearPaneBinding,
    clearTabBinding,
    startFreshColdRestore,
    registerEffectiveLaunchConfig,
    disconnect,
    isPassiveResumeAuthority: (candidate) => candidate === startup
  })

  return {
    controller,
    startup,
    clearPaneBinding,
    clearTabBinding,
    startFreshColdRestore,
    registerEffectiveLaunchConfig,
    warnMissingPty,
    disconnect,
    rejectObsoleteDirectSshReattach,
    setTransportPtyId: (ptyId: string | null) => {
      transportPtyId = ptyId
    }
  }
}

describe('createPtyConnectionReattachResultAdmissionController', () => {
  it('treats exited-before-attach as an already delivered terminal success', () => {
    const state = createHarness()

    expect(
      state.controller.admit({
        result: { id: 'pty-1', exitedBeforeAttach: true },
        staleSessionId: 'stale-pty',
        coldRestoreStartup: null,
        attemptGeneration: 7
      })
    ).toEqual({ status: 'handled', accepted: true })

    expect(state.rejectObsoleteDirectSshReattach).not.toHaveBeenCalled()
  })

  it('rejects an obsolete direct SSH retry lease before adopting its PTY', () => {
    const state = createHarness()
    state.rejectObsoleteDirectSshReattach.mockReturnValueOnce(true)

    expect(
      state.controller.admit({
        result: { id: 'pty-stale' },
        staleSessionId: 'stale-pty',
        coldRestoreStartup: null,
        attemptGeneration: 7
      })
    ).toEqual({ status: 'handled', accepted: false })

    expect(state.rejectObsoleteDirectSshReattach).toHaveBeenCalledWith('pty-stale')
  })

  it('clears an exact stale binding and fresh-restores when no PTY id remains', () => {
    const state = createHarness()
    state.setTransportPtyId(null)

    expect(
      state.controller.admit({
        result: undefined,
        staleSessionId: 'stale-pty',
        coldRestoreStartup: state.startup,
        attemptGeneration: 7
      })
    ).toEqual({ status: 'handled', accepted: false })

    expect(state.warnMissingPty).toHaveBeenCalledWith('stale-pty')
    expect(state.clearPaneBinding).toHaveBeenCalledWith('stale-pty')
    expect(state.clearTabBinding).toHaveBeenCalledWith('stale-pty')
    expect(state.startFreshColdRestore).toHaveBeenCalledWith(state.startup)
  })

  it('retires an expired result and starts a fresh cold restore', () => {
    const state = createHarness()
    const result = { id: 'pty-1', sessionExpired: true } satisfies PtyConnectResult

    expect(
      state.controller.admit({
        result,
        staleSessionId: 'stale-pty',
        coldRestoreStartup: state.startup,
        attemptGeneration: 7
      })
    ).toEqual({ status: 'handled', accepted: false })

    expect(state.registerEffectiveLaunchConfig).toHaveBeenCalledOnce()
    expect(state.clearPaneBinding).toHaveBeenCalledWith('stale-pty')
    expect(state.clearTabBinding).toHaveBeenCalledWith('stale-pty')
    expect(state.startFreshColdRestore).toHaveBeenCalledWith(state.startup)
  })

  it('replaces a contentless adopted shell when passive hibernation owns resume authority', () => {
    const state = createHarness()

    expect(
      state.controller.admit({
        result: { id: 'pty-1', isReattach: true },
        staleSessionId: 'stale-pty',
        coldRestoreStartup: state.startup,
        attemptGeneration: 7
      })
    ).toEqual({ status: 'handled', accepted: false })

    expect(state.disconnect).toHaveBeenCalledOnce()
    expect(state.clearPaneBinding).toHaveBeenCalledWith('stale-pty')
    expect(state.clearTabBinding).toHaveBeenCalledWith('stale-pty')
    expect(state.startFreshColdRestore).toHaveBeenCalledWith(state.startup)
  })

  it('admits a current structural replay with its effective launch metadata', () => {
    const state = createHarness()
    const result = {
      id: 'pty-1',
      snapshot: 'snapshot',
      launchAgent: 'codex'
    } satisfies PtyConnectResult

    expect(
      state.controller.admit({
        result,
        staleSessionId: 'stale-pty',
        coldRestoreStartup: state.startup,
        attemptGeneration: 7
      })
    ).toEqual({
      status: 'accepted',
      ptyId: 'pty-1',
      connectResult: result,
      hasStructuralReplay: true
    })

    expect(state.registerEffectiveLaunchConfig).toHaveBeenCalledWith(result.launchConfig, {
      launchToken: 'launch-token',
      launchAgent: 'codex'
    })
  })
})
