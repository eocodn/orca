import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionHiddenRestoreCleanupController } from './pty-connection-hidden-restore-cleanup-controller'

describe('createPtyConnectionHiddenRestoreCleanupController', () => {
  it('disposes safely before cleanup functions are bound', () => {
    const controller = createPtyConnectionHiddenRestoreCleanupController()

    controller.dispose()
  })

  it('runs every bound hidden-restore cleanup', () => {
    const cancelSnapshotScrollRestore = vi.fn()
    const clearDeferredRetry = vi.fn()
    const clearForegroundDeadline = vi.fn()
    const clearFloodRepaint = vi.fn()
    const controller = createPtyConnectionHiddenRestoreCleanupController()
    controller.bind({
      cancelSnapshotScrollRestore,
      clearDeferredRetry,
      clearForegroundDeadline,
      clearFloodRepaint
    })

    controller.dispose()

    expect(cancelSnapshotScrollRestore).toHaveBeenCalledTimes(1)
    expect(clearDeferredRetry).toHaveBeenCalledTimes(1)
    expect(clearForegroundDeadline).toHaveBeenCalledTimes(1)
    expect(clearFloodRepaint).toHaveBeenCalledTimes(1)
  })

  it('disposes the bound cleanup bundle idempotently', () => {
    const cleanup = vi.fn()
    const controller = createPtyConnectionHiddenRestoreCleanupController()
    controller.bind({
      cancelSnapshotScrollRestore: cleanup,
      clearDeferredRetry: cleanup,
      clearForegroundDeadline: cleanup,
      clearFloodRepaint: cleanup
    })

    controller.dispose()
    controller.dispose()

    expect(cleanup).toHaveBeenCalledTimes(4)
  })
})
