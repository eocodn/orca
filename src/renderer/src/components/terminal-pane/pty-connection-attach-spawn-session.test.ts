import { afterEach, describe, expect, it, vi } from 'vitest'
import { pendingSpawnByPaneKey } from './pty-connection-runtime-state'
import { runPtyConnectionAttachSpawnSession } from './pty-connection-attach-spawn-session'

const pendingSpawnKey = 'worktree-1:tab-1:pane-7'

const runSession = (
  overrides: Partial<Parameters<typeof runPtyConnectionAttachSpawnSession>[0]> = {}
) =>
  runPtyConnectionAttachSpawnSession({
    paneId: 7,
    tabId: 'tab-1',
    attachPtyId: null,
    legacyAttachOnlyPtyId: null,
    attachUsesEagerBuffer: false,
    hasSshConnection: false,
    pendingSpawnKey,
    transport: { getPtyId: () => null },
    directSshRetryAttempt: undefined,
    setAllowInitialIdleCacheSeed: vi.fn(),
    recordDiagnostic: vi.fn(),
    attachRetainedLegacyPty: vi.fn(() => false),
    removeDeferredSshSessionId: vi.fn(),
    attachDetachedPty: vi.fn(() => true),
    clearTabPtyId: vi.fn(),
    startFreshSpawn: vi.fn(),
    startFreshOrColdRestore: vi.fn(),
    armDirectSshPaneRetryTimeout: vi.fn(),
    isDisposed: () => false,
    canAdoptCapturedDirectSshRetryPty: () => true,
    adoptPendingSpawn: vi.fn(() => true),
    reportError: vi.fn(),
    ...overrides
  })

afterEach(() => {
  pendingSpawnByPaneKey.delete(pendingSpawnKey)
})

describe('runPtyConnectionAttachSpawnSession', () => {
  it('routes an attach without joining or fresh-spawning', () => {
    const attachDetachedPty = vi.fn(() => true)
    const startFreshOrColdRestore = vi.fn()

    expect(
      runSession({
        attachPtyId: 'pty-1',
        attachDetachedPty,
        startFreshOrColdRestore
      })
    ).toBe('attach')
    expect(attachDetachedPty).toHaveBeenCalledWith('pty-1', false)
    expect(startFreshOrColdRestore).not.toHaveBeenCalled()
  })

  it('uses the shared fallback when no pending spawn exists', () => {
    const startFreshOrColdRestore = vi.fn()

    expect(runSession({ startFreshOrColdRestore })).toBe('fresh')
    expect(startFreshOrColdRestore).toHaveBeenCalledOnce()
  })

  it('joins and adopts an existing pending spawn', async () => {
    const pendingSpawn = Promise.resolve('spawned-pty')
    const armDirectSshPaneRetryTimeout = vi.fn()
    const adoptPendingSpawn = vi.fn(() => true)
    pendingSpawnByPaneKey.set(pendingSpawnKey, pendingSpawn)

    expect(runSession({ armDirectSshPaneRetryTimeout, adoptPendingSpawn })).toBe('pending')
    await pendingSpawn
    await Promise.resolve()

    expect(armDirectSshPaneRetryTimeout).toHaveBeenCalledWith(pendingSpawn, undefined)
    expect(adoptPendingSpawn).toHaveBeenCalledWith('spawned-pty')
  })
})
