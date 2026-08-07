import { describe, expect, it, vi } from 'vitest'
import { runPtyConnectionNormalRouteSession } from './pty-connection-normal-route-session'

function createHarness(
  overrides: Partial<Parameters<typeof runPtyConnectionNormalRouteSession>[0]> = {}
) {
  const order: string[] = []
  const coldRestoreStartup = { command: 'codex resume' } as never
  const startFreshColdRestore = vi.fn(() => {
    order.push('cold-restore')
  })
  const startFreshSpawn = vi.fn(() => {
    order.push('fresh-spawn')
  })
  const attemptReattach = vi.fn(async () => {
    order.push('reattach')
  })
  const attachDetachedPty = vi.fn(() => {
    order.push('attach')
    return true
  })
  const scheduleRuntimeGraphSync = vi.fn(() => {
    order.push('sync')
  })
  const args: Parameters<typeof runPtyConnectionNormalRouteSession>[0] = {
    sleptRemoteRuntimeSessionId: null,
    deferredReattachSessionId: null,
    hasSleepingAgentSession: false,
    buildColdRestoreStartup: vi.fn(() => coldRestoreStartup),
    startFreshColdRestore,
    restoredReattach: {
      paneId: 3,
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      leafId: 'leaf-1',
      setAllowInitialIdleCacheSeed: vi.fn(),
      recordDiagnostic: vi.fn(),
      buildColdRestoreStartup: vi.fn(() => coldRestoreStartup),
      isDisposed: () => false,
      getTransportStreamGeneration: () => 7,
      isCurrentAuthority: () => true,
      rejectObsoleteAuthority: () => false,
      isRejectedSessionExpired: () => false,
      clearPaneBinding: vi.fn(),
      clearTabBinding: vi.fn(),
      reportError: vi.fn(),
      warnLifecycleAnomaly: vi.fn(),
      attemptReattach
    },
    attachSpawn: {
      paneId: 3,
      tabId: 'tab-1',
      attachPtyId: null,
      legacyAttachOnlyPtyId: null,
      attachUsesEagerBuffer: false,
      hasSshConnection: false,
      pendingSpawnKey: 'wt-1:tab-1:3',
      transport: { getPtyId: () => null },
      directSshRetryAttempt: undefined,
      setAllowInitialIdleCacheSeed: vi.fn(),
      recordDiagnostic: vi.fn(),
      attachRetainedLegacyPty: vi.fn(() => false),
      removeDeferredSshSessionId: vi.fn(),
      attachDetachedPty,
      clearTabPtyId: vi.fn(),
      startFreshSpawn,
      armDirectSshPaneRetryTimeout: vi.fn(),
      isDisposed: () => false,
      canAdoptCapturedDirectSshRetryPty: () => true,
      adoptPendingSpawn: vi.fn(() => true),
      reportError: vi.fn()
    },
    scheduleRuntimeGraphSync,
    ...overrides
  }
  return {
    args,
    attachDetachedPty,
    attemptReattach,
    coldRestoreStartup,
    order,
    scheduleRuntimeGraphSync,
    startFreshColdRestore,
    startFreshSpawn
  }
}

describe('runPtyConnectionNormalRouteSession', () => {
  it('selects restored reattach and synchronizes the runtime graph afterward', () => {
    const state = createHarness({ deferredReattachSessionId: 'wt-1@@pty-1' })

    expect(runPtyConnectionNormalRouteSession(state.args)).toBe('reattach')

    expect(state.attemptReattach).toHaveBeenCalledOnce()
    expect(state.attachDetachedPty).not.toHaveBeenCalled()
    expect(state.order).toEqual(['reattach', 'sync'])
  })

  it('injects attach candidates and synchronizes after attach execution', () => {
    const state = createHarness()
    state.args.attachSpawn.attachPtyId = 'pty-live'
    state.args.attachSpawn.attachUsesEagerBuffer = true
    state.args.attachSpawn.attachDetachedPty = vi.fn((_ptyId, eager) => {
      state.order.push(`attach:${eager}`)
      return true
    })

    expect(runPtyConnectionNormalRouteSession(state.args)).toBe('attach')
    expect(state.order).toEqual(['attach:true', 'sync'])
  })

  it('uses the prepared cold restore when no attach or pending spawn exists', () => {
    const state = createHarness({ sleptRemoteRuntimeSessionId: 'remote-pty-1' })

    expect(runPtyConnectionNormalRouteSession(state.args)).toBe('fresh')

    expect(state.startFreshColdRestore).toHaveBeenCalledWith(state.coldRestoreStartup)
    expect(state.startFreshSpawn).not.toHaveBeenCalled()
    expect(state.order).toEqual(['cold-restore', 'sync'])
  })
})
