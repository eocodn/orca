import { describe, expect, it, vi } from 'vitest'
import type { DirectSshPaneRetryAttemptId } from '@/store/slices/direct-ssh-terminal-recovery'
import { createPtyConnectionReattachBindingController } from './pty-connection-reattach-binding-controller'

function createHarness() {
  const calls: string[] = []
  const setPanePtyFitBinding = vi.fn((ptyId: string) => calls.push(`fit:${ptyId}`))
  const reportPanePtyVisibility = vi.fn((ptyId: string, visible: boolean) =>
    calls.push(`visibility:${ptyId}:${visible}`)
  )
  const registerSideEffectFactConsumerForPty = vi.fn((ptyId: string) =>
    calls.push(`facts:${ptyId}`)
  )
  const syncHiddenRendererPtyDelivery = vi.fn(() => calls.push('hidden-delivery'))
  const syncPanePtyLayoutBinding = vi.fn((ptyId: string) => calls.push(`layout:${ptyId}`))
  const notifyCodexPaneBoundForStaleSweep = vi.fn((ptyId: string) =>
    calls.push(`stale-sweep:${ptyId}`)
  )
  const updateTabPtyId = vi.fn((ptyId: string, directSshRetryAttemptId?: string) =>
    calls.push(`tab:${ptyId}:${directSshRetryAttemptId ?? 'normal'}`)
  )
  const startProcessTracking = vi.fn(() => calls.push('process-tracking'))
  const sampleVisiblePaneForegroundAgent = vi.fn(() => calls.push('foreground-sample'))
  const registerPaneSerializerFor = vi.fn((ptyId: string) => calls.push(`serializer:${ptyId}`))
  const scheduleReattachIdleAgentCursorReset = vi.fn(() => calls.push('cursor-reset'))
  const scheduleRuntimeGraphSync = vi.fn(() => calls.push('runtime-graph'))

  const controller = createPtyConnectionReattachBindingController({
    isVisible: () => true,
    setPanePtyFitBinding,
    reportPanePtyVisibility,
    registerSideEffectFactConsumerForPty,
    syncHiddenRendererPtyDelivery,
    syncPanePtyLayoutBinding,
    notifyCodexPaneBoundForStaleSweep,
    updateTabPtyId,
    startProcessTracking,
    sampleVisiblePaneForegroundAgent,
    registerPaneSerializerFor,
    scheduleReattachIdleAgentCursorReset,
    scheduleRuntimeGraphSync
  })

  return { controller, calls, updateTabPtyId }
}

describe('createPtyConnectionReattachBindingController', () => {
  it('binds the adopted PTY in replay-safe order without syncing the runtime graph early', () => {
    const state = createHarness()

    state.controller.bind('pty-1')

    expect(state.calls).toEqual([
      'fit:pty-1',
      'visibility:pty-1:true',
      'facts:pty-1',
      'hidden-delivery',
      'layout:pty-1',
      'stale-sweep:pty-1',
      'tab:pty-1:normal',
      'process-tracking',
      'foreground-sample',
      'serializer:pty-1'
    ])
    expect(state.calls).not.toContain('runtime-graph')
  })

  it('carries the accepted direct SSH retry attempt into the tab binding', () => {
    const state = createHarness()

    state.controller.bind('pty-ssh', {
      directSshRetryAttemptId: 'attempt-7' as DirectSshPaneRetryAttemptId
    })

    expect(state.updateTabPtyId).toHaveBeenCalledWith('pty-ssh', 'attempt-7')
  })

  it('completes cursor recovery before publishing the runtime graph', () => {
    const state = createHarness()

    state.controller.complete()

    expect(state.calls).toEqual(['cursor-reset', 'runtime-graph'])
  })
})
