import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionRestoredReattachFallback } from './pty-connection-restored-reattach-fallback'

const createFallback = (
  overrides: Partial<Parameters<typeof createPtyConnectionRestoredReattachFallback>[0]> = {}
) => {
  const order: string[] = []
  const args: Parameters<typeof createPtyConnectionRestoredReattachFallback>[0] = {
    sessionId: 'pty-1',
    coldRestoreStartup: null,
    paneId: 7,
    tabId: 'tab-1',
    worktreeId: 'worktree-1',
    leafId: 'leaf-1',
    isDisposed: () => false,
    getTransportStreamGeneration: () => 3,
    isCurrentAuthority: () => true,
    rejectObsoleteAuthority: () => false,
    isRejectedSessionExpired: () => false,
    clearPaneBinding: vi.fn(() => order.push('pane')),
    clearTabBinding: vi.fn(() => order.push('tab')),
    startFreshColdRestore: vi.fn(() => order.push('cold-restore')),
    reportError: vi.fn(() => order.push('report-error')),
    warnLifecycleAnomaly: vi.fn(() => order.push('warn')),
    ...overrides
  }
  return { fallback: createPtyConnectionRestoredReattachFallback(args), args, order }
}

describe('createPtyConnectionRestoredReattachFallback', () => {
  it('clears pane then tab bindings and starts a blank cold restore after expiry', () => {
    const startup = { command: 'resume' } as never
    const { fallback, args, order } = createFallback({ coldRestoreStartup: startup })

    fallback.onExpired()

    expect(order).toEqual(['pane', 'tab', 'cold-restore'])
    expect(args.startFreshColdRestore).toHaveBeenCalledWith(startup, {
      forceBlankRestoredViewport: true
    })
  })

  it('reports a non-expired rejection with restored-session lifecycle context', () => {
    const { fallback, args, order } = createFallback()

    fallback.onRejected(new Error('reattach failed'), 3)

    expect(order).toEqual(['warn', 'pane', 'tab', 'report-error', 'cold-restore'])
    expect(args.warnLifecycleAnomaly).toHaveBeenCalledWith('restored PTY reattach threw', {
      tabId: 'tab-1',
      worktreeId: 'worktree-1',
      leafId: 'leaf-1',
      paneId: 7,
      ptyId: 'pty-1',
      reason: 'reattach failed'
    })
  })

  it('does not report an expired rejection as a transport error', () => {
    const reportError = vi.fn()
    const { fallback } = createFallback({
      isRejectedSessionExpired: () => true,
      reportError
    })

    fallback.onRejected(new Error('expired'), 3)

    expect(reportError).not.toHaveBeenCalled()
  })
})
