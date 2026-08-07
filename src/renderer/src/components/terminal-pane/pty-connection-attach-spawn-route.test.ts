import { describe, expect, it, vi } from 'vitest'
import { runPtyConnectionAttachSpawnRoute } from './pty-connection-attach-spawn-route'

const run = (overrides: Partial<Parameters<typeof runPtyConnectionAttachSpawnRoute>[0]> = {}) => {
  const setAllowInitialIdleCacheSeed = vi.fn()
  const recordDiagnostic = vi.fn()
  const attachRetainedLegacyPty = vi.fn(() => true)
  const removeDeferredSshSessionId = vi.fn()
  const attachDetachedPty = vi.fn(() => true)
  const clearTabPtyId = vi.fn()
  const startFreshSpawn = vi.fn()
  const joinPendingSpawn = vi.fn(() => false)
  const startFreshOrColdRestore = vi.fn()
  const result = runPtyConnectionAttachSpawnRoute({
    paneId: 1,
    tabId: 'tab-1',
    attachPtyId: null,
    legacyAttachOnlyPtyId: null,
    attachUsesEagerBuffer: false,
    hasSshConnection: false,
    setAllowInitialIdleCacheSeed,
    recordDiagnostic,
    attachRetainedLegacyPty,
    removeDeferredSshSessionId,
    attachDetachedPty,
    clearTabPtyId,
    startFreshSpawn,
    joinPendingSpawn,
    startFreshOrColdRestore,
    ...overrides
  })
  return {
    result,
    setAllowInitialIdleCacheSeed,
    recordDiagnostic,
    attachRetainedLegacyPty,
    removeDeferredSshSessionId,
    attachDetachedPty,
    clearTabPtyId,
    startFreshSpawn,
    joinPendingSpawn,
    startFreshOrColdRestore
  }
}

describe('runPtyConnectionAttachSpawnRoute', () => {
  it('attaches a retained legacy PTY and clears deferred SSH metadata on success', () => {
    const state = run({
      attachPtyId: 'ssh:ssh-1@@legacy',
      legacyAttachOnlyPtyId: 'ssh:ssh-1@@legacy',
      hasSshConnection: true
    })

    expect(state.result).toBe('attach')
    expect(state.setAllowInitialIdleCacheSeed).toHaveBeenCalledWith(false)
    expect(state.attachRetainedLegacyPty).toHaveBeenCalledWith('ssh:ssh-1@@legacy')
    expect(state.removeDeferredSshSessionId).toHaveBeenCalledOnce()
    expect(state.attachDetachedPty).not.toHaveBeenCalled()
  })

  it('clears a stale detached binding and fresh-spawns when attach fails', () => {
    const state = run({
      attachPtyId: 'pty-stale',
      attachUsesEagerBuffer: true,
      attachDetachedPty: () => false
    })

    expect(state.result).toBe('attach')
    expect(state.clearTabPtyId).toHaveBeenCalledWith('tab-1', 'pty-stale')
    expect(state.startFreshSpawn).toHaveBeenCalledOnce()
  })

  it('joins an existing pending spawn before creating another PTY', () => {
    const state = run({ joinPendingSpawn: () => true })

    expect(state.result).toBe('pending')
    expect(state.startFreshOrColdRestore).not.toHaveBeenCalled()
  })

  it('starts the appropriate fresh path when no pending spawn exists', () => {
    const state = run()

    expect(state.result).toBe('fresh')
    expect(state.recordDiagnostic).toHaveBeenCalledWith('pane=1 -> FRESH SPAWN')
    expect(state.startFreshOrColdRestore).toHaveBeenCalledOnce()
  })
})
