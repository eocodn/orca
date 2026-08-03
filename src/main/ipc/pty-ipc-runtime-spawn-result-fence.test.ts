import { describe, expect, it, vi } from 'vitest'

const createControllerPreparation = vi.hoisted(() => vi.fn())
const createIpcPreparation = vi.hoisted(() => vi.fn())

vi.mock('./pty-ipc-runtime-controller-spawn-preparation', () => ({
  createPtySpawnPreparation: createControllerPreparation
}))
vi.mock('./pty-ipc-runtime-ipc-spawn-preparation', () => ({
  createPtyIpcSpawnPreparation: createIpcPreparation
}))

import { createPtySpawnHandler } from './pty-ipc-runtime-controller-spawn-execution'
import { createPtyIpcSpawnHandler } from './pty-ipc-runtime-ipc-spawn-execution'

function createProviderReplacementFenceState(
  provider: { spawn: ReturnType<typeof vi.fn> },
  providerReplaced: () => boolean
) {
  const assertPtyProviderIdentityCurrent = vi.fn(() => {
    if (providerReplaced()) {
      throw new Error('pty_provider_changed_during_spawn_preparation')
    }
  })
  const cleanUpFailedFreshSpawn = vi.fn(async () => {})
  const finishTerminalInstall = vi.fn()

  return {
    provider,
    providerIdentity: {},
    assertPtyProviderIdentityCurrent,
    assertPtyCleanupComplete: vi.fn(),
    cleanUpFailedFreshSpawn,
    finishTerminalInstall,
    normalizeNodePtySpawnError: (error: Error) => error,
    isSshPtyIdentityMismatchError: vi.fn(() => false),
    rejectPaneSpawnReservation: vi.fn(),
    rollbackPtyIncarnation: vi.fn(),
    snapshotPtyCleanupAuthority: vi.fn(),
    snapshotPtyPublication: vi.fn(() => ({ id: 'stale-pty', stateToken: Symbol('stale') })),
    stagePtyIncarnation: vi.fn(),
    assertSpawnReplyWasLive: vi.fn(),
    registerPty: vi.fn(),
    sendPtySpawnedToRenderer: vi.fn(),
    runtime: {
      assertPtyRegistrationAllowed: vi.fn(),
      registerPty: vi.fn()
    }
  }
}

describe('PTY spawn result provider fence', () => {
  it('cleans up and rejects a controller result after provider replacement during spawn', async () => {
    let providerReplaced = false
    const result = { id: 'controller-stale-pty', isReattach: false }
    const provider = {
      spawn: vi.fn(async () => {
        providerReplaced = true
        await Promise.resolve()
        return result
      })
    }
    const state = createProviderReplacementFenceState(provider, () => providerReplaced)
    createControllerPreparation.mockReturnValue(async () => ({
      kind: 'fresh',
      prepared: {
        provider,
        providerIdentity: {},
        spawnOptions: {},
        finishTerminalInstall: state.finishTerminalInstall
      }
    }))

    const handler = createPtySpawnHandler(state as never)

    await expect(handler({} as never)).rejects.toThrow(
      'pty_provider_changed_during_spawn_preparation'
    )
    expect(state.assertPtyProviderIdentityCurrent).toHaveBeenCalledTimes(2)
    expect(state.stagePtyIncarnation).not.toHaveBeenCalled()
    expect(state.registerPty).not.toHaveBeenCalled()
    expect(state.sendPtySpawnedToRenderer).not.toHaveBeenCalled()
    expect(state.runtime.assertPtyRegistrationAllowed).not.toHaveBeenCalled()
    expect(state.cleanUpFailedFreshSpawn).toHaveBeenCalledWith(
      provider,
      result,
      undefined,
      false
    )
  })

  it('cleans up and rejects an IPC result after provider replacement during spawn', async () => {
    let providerReplaced = false
    const result = { id: 'ipc-stale-pty', isReattach: false }
    const provider = {
      spawn: vi.fn(async () => {
        providerReplaced = true
        await Promise.resolve()
        return result
      })
    }
    const state = {
      ...createProviderReplacementFenceState(provider, () => providerReplaced),
      ptySizes: new Map(),
      pendingPtySizes: new Map(),
      spawnTiming: { mark: vi.fn(), log: vi.fn() },
      preSpawnHiddenMarkId: null
    }
    createIpcPreparation.mockReturnValue(async () => ({
      kind: 'fresh',
      prepared: {
        provider,
        providerIdentity: {},
        spawnOptions: {},
        finishTerminalInstall: state.finishTerminalInstall,
        spawnTiming: state.spawnTiming,
        preSpawnHiddenMarkId: null
      }
    }))

    const handler = createPtyIpcSpawnHandler(state as never)

    await expect(handler({})).rejects.toThrow(
      'pty_provider_changed_during_spawn_preparation'
    )
    expect(state.assertPtyProviderIdentityCurrent).toHaveBeenCalledTimes(2)
    expect(state.stagePtyIncarnation).not.toHaveBeenCalled()
    expect(state.runtime.registerPty).not.toHaveBeenCalled()
    expect(state.sendPtySpawnedToRenderer).not.toHaveBeenCalled()
    expect(state.runtime.assertPtyRegistrationAllowed).not.toHaveBeenCalled()
    expect(state.cleanUpFailedFreshSpawn).toHaveBeenCalledWith(
      provider,
      result,
      undefined,
      false
    )
  })
})
