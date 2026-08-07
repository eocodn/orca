import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionRendererSequenceExitResetController } from './pty-connection-renderer-sequence-exit-reset-controller'

describe('createPtyConnectionRendererSequenceExitResetController', () => {
  it('resets safely before runtime sequence state is bound', () => {
    const controller = createPtyConnectionRendererSequenceExitResetController()

    controller.resetForExit('pty-1')
  })

  it('clears matching restored baseline before resetting the sequence domain', () => {
    const order: string[] = []
    const controller = createPtyConnectionRendererSequenceExitResetController()
    controller.bindRuntime({
      getRestoredSnapshotBaselinePtyId: () => 'pty-1',
      clearRestoredSnapshotBaseline: () => order.push('clear-baseline'),
      resetRendererSequenceForPtyExit: () => order.push('reset-sequence')
    })

    controller.resetForExit('pty-1')

    expect(order).toEqual(['clear-baseline', 'reset-sequence'])
  })

  it('keeps another PTY baseline while resetting the exited sequence domain', () => {
    const clearRestoredSnapshotBaseline = vi.fn()
    const resetRendererSequenceForPtyExit = vi.fn()
    const controller = createPtyConnectionRendererSequenceExitResetController()
    controller.bindRuntime({
      getRestoredSnapshotBaselinePtyId: () => 'pty-other',
      clearRestoredSnapshotBaseline,
      resetRendererSequenceForPtyExit
    })

    controller.resetForExit('pty-1')

    expect(clearRestoredSnapshotBaseline).not.toHaveBeenCalled()
    expect(resetRendererSequenceForPtyExit).toHaveBeenCalledWith('pty-1')
  })
})
