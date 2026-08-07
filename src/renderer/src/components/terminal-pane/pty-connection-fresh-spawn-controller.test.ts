import { describe, expect, it, vi } from 'vitest'
import type { ColdRestoreAgentResumeStartup } from './pty-connection-e2e-support'
import { createPtyConnectionFreshSpawnController } from './pty-connection-fresh-spawn-controller'
import type { PtyConnectResult, PtyTransport } from './pty-transport'

const createController = (options?: {
  connectResult?: void | string | PtyConnectResult | Promise<void | string | PtyConnectResult>
  generation?: number
  currentGeneration?: number
  transportPtyId?: string | null
  runtimeEnvironmentId?: string | null
  hasPaneStartupLaunchConfig?: boolean
  hasConnection?: boolean
}) => {
  const connect = vi.fn(() => options?.connectResult ?? null)
  const declarePendingPaneSerializer = vi.fn(async () => 7)
  const clearPendingPaneSerializer = vi.fn(async () => {})
  const settlePaneSerializer = vi.fn(async () => {})
  const registerEffectiveLaunchConfig = vi.fn()
  const clearRegisteredStartupLaunchConfig = vi.fn()
  const writeStartupCwdFallbackNotice = vi.fn()
  const showSessionRestoredBanner = vi.fn()
  const clearSleepingRecordAfterColdRestoreSpawn = vi.fn()
  const bindActivePanePty = vi.fn()
  const reconcileSpawnedPtySize = vi.fn()
  const registerPaneSerializerFor = vi.fn()
  const schedulePendingStartupCommandDelivery = vi.fn()
  const setConnectInFlightSince = vi.fn()
  const controller = createPtyConnectionFreshSpawnController({
    transport: {
      connect,
      getPtyId: () => options?.transportPtyId ?? null
    } as Pick<PtyTransport, 'connect' | 'getPtyId'>,
    cacheKey: 'tab-1:leaf-1',
    runtimeEnvironmentId: options?.runtimeEnvironmentId ?? null,
    cols: 120,
    rows: 40,
    captureTransportOutputCallbacks: () => ({
      generation: options?.generation ?? 3,
      callbacks: {}
    }),
    getTransportStreamGeneration: () => options?.currentGeneration ?? 3,
    setConnectInFlightSince,
    mergeStartupEnvWithPaneIdentity: (env) =>
      env ? { ...env, ORCA_PANE_KEY: 'tab-1:leaf-1' } : undefined,
    shouldDeclareHiddenAtSpawn: () => true,
    claimCapturedDirectSshRetryPty: () => true,
    declarePendingPaneSerializer,
    clearPendingPaneSerializer,
    settlePaneSerializer,
    registerEffectiveLaunchConfig,
    hasPaneStartupLaunchConfig: () => options?.hasPaneStartupLaunchConfig ?? false,
    clearRegisteredStartupLaunchConfig,
    writeStartupCwdFallbackNotice,
    showSessionRestoredBanner,
    clearSleepingRecordAfterColdRestoreSpawn,
    getActivePanePtyBinding: () => null,
    bindActivePanePty,
    reconcileSpawnedPtySize,
    isRemoteRuntimePtyId: (ptyId) => ptyId.startsWith('remote:'),
    hasPtySerializer: () => false,
    registerPaneSerializerFor,
    hasConnection: () => options?.hasConnection ?? true,
    schedulePendingStartupCommandDelivery
  })
  return {
    controller,
    connect,
    declarePendingPaneSerializer,
    clearPendingPaneSerializer,
    settlePaneSerializer,
    registerEffectiveLaunchConfig,
    clearRegisteredStartupLaunchConfig,
    writeStartupCwdFallbackNotice,
    showSessionRestoredBanner,
    clearSleepingRecordAfterColdRestoreSpawn,
    bindActivePanePty,
    reconcileSpawnedPtySize,
    registerPaneSerializerFor,
    schedulePendingStartupCommandDelivery,
    setConnectInFlightSince
  }
}

describe('createPtyConnectionFreshSpawnController', () => {
  it('builds a cold-restore launch request and settles its accepted PTY', async () => {
    const launchConfig = { agentCommand: 'codex' } as ColdRestoreAgentResumeStartup['launchConfig']
    const startup = {
      agent: 'codex',
      command: 'codex resume',
      env: { TOKEN: '1' },
      launchConfig,
      resumeProviderSession: { kind: 'codex', threadId: 'thread-1' },
      launchToken: 'launch-1',
      useLiveEntry: false,
      hasSleepingRecord: true,
      sleepingRecordEntry: null
    } as ColdRestoreAgentResumeStartup
    const result = {
      id: 'pty-1',
      launchConfig,
      startupCwdFallback: { kind: 'worktree', cwd: '/workspace' },
      agentResumeUnavailable: true
    } satisfies PtyConnectResult
    const state = createController({
      connectResult: Promise.resolve(result),
      transportPtyId: 'pty-1'
    })

    await expect(state.controller.spawn(startup)).resolves.toBe('pty-1')

    expect(state.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        cols: 120,
        rows: 40,
        command: 'codex resume',
        env: { TOKEN: '1', ORCA_PANE_KEY: 'tab-1:leaf-1' },
        launchConfig,
        resumeProviderSession: startup.resumeProviderSession,
        launchToken: 'launch-1',
        launchAgent: 'codex',
        initiallyHidden: true
      })
    )
    expect(state.registerEffectiveLaunchConfig).toHaveBeenCalledWith(launchConfig, {
      launchToken: 'launch-1',
      launchAgent: 'codex'
    })
    expect(state.writeStartupCwdFallbackNotice).toHaveBeenCalledOnce()
    expect(state.showSessionRestoredBanner).toHaveBeenCalledWith('resume-unavailable')
    expect(state.clearSleepingRecordAfterColdRestoreSpawn).toHaveBeenCalledWith(startup)
    expect(state.bindActivePanePty).toHaveBeenCalledWith('pty-1')
    expect(state.reconcileSpawnedPtySize).toHaveBeenCalledWith('pty-1', 120, 40)
    expect(state.registerPaneSerializerFor).toHaveBeenCalledWith('pty-1')
    expect(state.settlePaneSerializer).toHaveBeenCalledWith('tab-1:leaf-1', 7)
    expect(state.schedulePendingStartupCommandDelivery).toHaveBeenCalledOnce()
  })

  it('rejects stale output generation and clears its serializer pre-signal', async () => {
    const state = createController({
      connectResult: Promise.resolve('pty-stale'),
      generation: 2,
      currentGeneration: 3
    })

    await expect(state.controller.spawn()).resolves.toBeNull()

    expect(state.clearPendingPaneSerializer).toHaveBeenCalledWith('tab-1:leaf-1', 7)
    expect(state.registerPaneSerializerFor).not.toHaveBeenCalled()
  })

  it('clears launch and serializer state when spawn resolves empty', async () => {
    const state = createController({
      connectResult: Promise.resolve(),
      hasPaneStartupLaunchConfig: true
    })

    await expect(state.controller.spawn()).resolves.toBeNull()

    expect(state.clearRegisteredStartupLaunchConfig).toHaveBeenCalledOnce()
    expect(state.clearPendingPaneSerializer).toHaveBeenCalledWith('tab-1:leaf-1', 7)
  })

  it('skips local serializer declaration for runtime-host spawns', async () => {
    const state = createController({
      connectResult: Promise.resolve('remote:runtime-1:pty-1'),
      runtimeEnvironmentId: 'runtime-1'
    })

    await expect(state.controller.spawn()).resolves.toBe('remote:runtime-1:pty-1')

    expect(state.declarePendingPaneSerializer).not.toHaveBeenCalled()
    expect(state.registerPaneSerializerFor).toHaveBeenCalledWith('remote:runtime-1:pty-1')
    expect(state.settlePaneSerializer).not.toHaveBeenCalled()
  })
})
