import { describe, expect, it } from 'vitest'
import { resolvePtyConnectionAttachCandidate } from './pty-connection-attach-candidate'

const resolve = (
  overrides: Partial<Parameters<typeof resolvePtyConnectionAttachCandidate>[0]> = {}
) =>
  resolvePtyConnectionAttachCandidate({
    restoredPtyId: null,
    existingPtyId: null,
    existingPtyClaimedBySibling: false,
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
    ...overrides
  })

describe('resolvePtyConnectionAttachCandidate', () => {
  it('does not steal a tab fallback PTY already claimed by a sibling pane', () => {
    const result = resolve({
      existingPtyId: 'wt-1@@sibling',
      existingPtyClaimedBySibling: true
    })

    expect(result.tabFallbackPtyId).toBeNull()
    expect(result.attachPtyId).toBeNull()
    expect(result.deferredReattachSessionId).toBeNull()
  })

  it('routes a live eager-buffer PTY to attach instead of session reattach', () => {
    const result = resolve({
      restoredPtyId: 'wt-1@@agent',
      currentTabLivePtyIds: ['wt-1@@agent'],
      hasEagerBuffer: (ptyId) => ptyId === 'wt-1@@agent'
    })

    expect(result.eagerLivePtyId).toBe('wt-1@@agent')
    expect(result.attachPtyId).toBe('wt-1@@agent')
    expect(result.attachUsesEagerBuffer).toBe(true)
    expect(result.deferredReattachSessionId).toBeNull()
  })

  it('lets a runtime-host wake hint reattach a local PTY without worktree parsing', () => {
    const result = resolve({
      restoredPtyId: 'other@@session',
      runtimeEnvironmentId: 'runtime-1'
    })

    expect(result.runtimeHostPtyWakeHint).toBe('other@@session')
    expect(result.deferredReattachSessionId).toBe('other@@session')
  })

  it('routes a paired parked remote PTY through reattach', () => {
    const result = resolve({
      restoredPtyId: 'remote:runtime-1:pty-1',
      mountFollowsTerminalPark: true,
      canRestorePairedParkedTerminal: () => true
    })

    expect(result.pairedParkedReattachSessionId).toBe('remote:runtime-1:pty-1')
    expect(result.deferredReattachSessionId).toBe('remote:runtime-1:pty-1')
    expect(result.attachPtyId).toBe('remote:runtime-1:pty-1')
  })

  it('keeps a sleeping remote session for cold restore instead of detached attach', () => {
    const result = resolve({
      restoredPtyId: 'remote:runtime-1:pty-1',
      hasSleepingAgentSession: true
    })

    expect(result.sleptRemoteRuntimeSessionId).toBe('remote:runtime-1:pty-1')
    expect(result.detachedRemoteLeafPtyId).toBeNull()
    expect(result.attachPtyId).toBeNull()
    expect(result.deferredReattachSessionId).toBeNull()
  })

  it('forces retained legacy sessions through attach-only routing', () => {
    const result = resolve({
      restoredPtyId: 'wt-1@@legacy',
      legacyWorkerAutomaticResumeBlocked: true
    })

    expect(result.legacyAttachOnlyPtyId).toBe('wt-1@@legacy')
    expect(result.attachPtyId).toBe('wt-1@@legacy')
    expect(result.deferredReattachSessionId).toBeNull()
  })
})
