import { describe, expect, it, vi } from 'vitest'
import { preparePtyConnectionAttachRouteObservation } from './pty-connection-attach-route-observation'

const prepare = (
  overrides: Partial<Parameters<typeof preparePtyConnectionAttachRouteObservation>[0]> = {}
) =>
  preparePtyConnectionAttachRouteObservation({
    paneId: 'pane-1',
    tabId: 'tab-1',
    restoredPtyId: null,
    existingPtyId: null,
    pendingSpawnKey: 'wt-1:tab-1:pane-1',
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
    clearPanePtyLayoutBinding: vi.fn(),
    clearTabPtyId: vi.fn(),
    recordDiagnostic: vi.fn(),
    ...overrides
  })

describe('preparePtyConnectionAttachRouteObservation', () => {
  it('suppresses a tab fallback PTY claimed by a sibling pane', () => {
    const isPtyClaimedBySibling = vi.fn(() => true)

    const result = prepare({
      existingPtyId: 'wt-1@@sibling',
      isPtyClaimedBySibling
    })

    expect(isPtyClaimedBySibling).toHaveBeenCalledWith('wt-1@@sibling')
    expect(result.attachPtyId).toBeNull()
    expect(result.deferredReattachSessionId).toBeNull()
  })

  it('clears stale bindings for a sleeping remote session', () => {
    const order: string[] = []
    const clearPanePtyLayoutBinding = vi.fn(() => order.push('pane'))
    const clearTabPtyId = vi.fn(() => order.push('tab'))
    const recordDiagnostic = vi.fn(() => order.push('diagnostic'))

    const result = prepare({
      restoredPtyId: 'remote:runtime-1:pty-1',
      hasSleepingAgentSession: true,
      clearPanePtyLayoutBinding,
      clearTabPtyId,
      recordDiagnostic
    })

    expect(result.sleptRemoteRuntimeSessionId).toBe('remote:runtime-1:pty-1')
    expect(clearPanePtyLayoutBinding).toHaveBeenCalledWith(null)
    expect(clearTabPtyId).toHaveBeenCalledWith('tab-1', 'remote:runtime-1:pty-1')
    expect(order).toEqual(['pane', 'tab', 'diagnostic'])
  })

  it('records the observed route inputs and selected reattach session', () => {
    const recordDiagnostic = vi.fn()

    const result = prepare({
      restoredPtyId: 'wt-1@@agent',
      existingPtyId: 'wt-1@@agent',
      hadExistingPaneTransportAtConnect: true,
      recordDiagnostic
    })

    expect(result.deferredReattachSessionId).toBe('wt-1@@agent')
    expect(recordDiagnostic).toHaveBeenCalledWith(
      'pane=pane-1 tab=tab-1 restored=wt-1@@agent existing=wt-1@@agent detached=null reattach=wt-1@@agent hasTransport=true pendingKey=wt-1:tab-1:pane-1'
    )
  })
})
