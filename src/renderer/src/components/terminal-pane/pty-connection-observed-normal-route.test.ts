import { describe, expect, it, vi } from 'vitest'
import { runPtyConnectionObservedNormalRoute } from './pty-connection-observed-normal-route'

function createHarness(
  overrides: Partial<Parameters<typeof runPtyConnectionObservedNormalRoute>[0]> = {}
) {
  const order: string[] = []
  const coldRestoreStartup = { command: 'codex resume' } as never
  const startFreshColdRestore = vi.fn(() => order.push('cold-restore'))
  const startFreshSpawn = vi.fn(() => order.push('fresh-spawn'))
  const attemptReattach = vi.fn(async () => order.push('reattach'))
  const attachDetachedPty = vi.fn((_ptyId: string, eager: boolean) => {
    order.push(`attach:${eager}`)
    return true
  })
  const clearPanePtyLayoutBinding = vi.fn(() => order.push('clear-pane'))
  const clearTabPtyId = vi.fn(() => order.push('clear-tab'))
  const recordDiagnostic = vi.fn(() => order.push('diagnostic'))
  const scheduleRuntimeGraphSync = vi.fn(() => order.push('sync'))
  const args: Parameters<typeof runPtyConnectionObservedNormalRoute>[0] = {
    observation: {
      paneId: 'pane-3',
      tabId: 'tab-1',
      restoredPtyId: null,
      existingPtyId: null,
      pendingSpawnKey: 'wt-1:tab-1:pane-3',
      hadExistingPaneTransportAtConnect: false,
      hasSleepingAgentSession: false,
      currentTabLivePtyIds: [],
      runtimeEnvironmentId: null,
      mountFollowsTerminalPark: false,
      worktreeId: 'wt-1',
      legacyWorkerAutomaticResumeBlocked: false,
      isRemoteRuntimePtyId: (ptyId) => ptyId.startsWith('remote:'),
      hasEagerBuffer: () => false,
      canRestorePairedParkedTerminal: () => false,
      isSessionOwnedByWorktree: (sessionId, worktreeId) =>
        !sessionId.includes('@@') || sessionId.startsWith(`${worktreeId}@@`),
      isPtyClaimedBySibling: () => false,
      clearPanePtyLayoutBinding,
      clearTabPtyId,
      recordDiagnostic
    },
    normalRoute: {
      buildColdRestoreStartup: vi.fn(() => coldRestoreStartup),
      startFreshColdRestore,
      restoredReattach: {
        paneId: 3,
        tabId: 'tab-1',
        worktreeId: 'wt-1',
        leafId: 'leaf-1',
        setAllowInitialIdleCacheSeed: vi.fn(),
        recordDiagnostic,
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
        hasSshConnection: false,
        pendingSpawnKey: 'wt-1:tab-1:pane-3',
        transport: { getPtyId: () => null },
        directSshRetryAttempt: undefined,
        setAllowInitialIdleCacheSeed: vi.fn(),
        recordDiagnostic,
        attachRetainedLegacyPty: vi.fn(() => false),
        removeDeferredSshSessionId: vi.fn(),
        attachDetachedPty,
        clearTabPtyId,
        startFreshSpawn,
        armDirectSshPaneRetryTimeout: vi.fn(),
        isDisposed: () => false,
        canAdoptCapturedDirectSshRetryPty: () => true,
        adoptPendingSpawn: vi.fn(() => true),
        reportError: vi.fn()
      },
      scheduleRuntimeGraphSync
    },
    ...overrides
  }
  return {
    args,
    attemptReattach,
    coldRestoreStartup,
    order,
    startFreshColdRestore,
    startFreshSpawn
  }
}

describe('runPtyConnectionObservedNormalRoute', () => {
  it('clears a sleeping remote candidate before cold restore and graph sync', () => {
    const state = createHarness()
    state.args.observation.restoredPtyId = 'remote:runtime-1:pty-1'
    state.args.observation.hasSleepingAgentSession = true

    expect(runPtyConnectionObservedNormalRoute(state.args)).toBe('fresh')

    expect(state.startFreshColdRestore).toHaveBeenCalledWith(state.coldRestoreStartup)
    expect(state.startFreshSpawn).not.toHaveBeenCalled()
    expect(state.order).toEqual([
      'clear-pane',
      'clear-tab',
      'diagnostic',
      'diagnostic',
      'cold-restore',
      'sync'
    ])
  })

  it('routes a live eager candidate to attach', () => {
    const state = createHarness()
    state.args.observation.restoredPtyId = 'wt-1@@agent'
    state.args.observation.currentTabLivePtyIds = ['wt-1@@agent']
    state.args.observation.hasEagerBuffer = (ptyId) => ptyId === 'wt-1@@agent'

    expect(runPtyConnectionObservedNormalRoute(state.args)).toBe('attach')
    expect(state.order).toEqual(['diagnostic', 'diagnostic', 'attach:true', 'sync'])
  })

  it('routes a restored worktree session to reattach', () => {
    const state = createHarness()
    state.args.observation.restoredPtyId = 'wt-1@@agent'

    expect(runPtyConnectionObservedNormalRoute(state.args)).toBe('reattach')
    expect(state.attemptReattach).toHaveBeenCalledOnce()
    expect(state.order).toEqual(['diagnostic', 'diagnostic', 'reattach', 'sync'])
  })
})
