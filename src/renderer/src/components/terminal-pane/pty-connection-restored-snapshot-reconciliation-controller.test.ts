import { describe, expect, it } from 'vitest'
import { createPtyConnectionRestoredSnapshotReconciliationController } from './pty-connection-restored-snapshot-reconciliation-controller'

describe('createPtyConnectionRestoredSnapshotReconciliationController', () => {
  it('arms a usable snapshot baseline but skips an empty delivery window', () => {
    const controller = createPtyConnectionRestoredSnapshotReconciliationController()

    controller.setBaseline('pty-1', { seq: 100, pendingDeliveryStartSeq: 40 })
    expect(controller.getBaselinePtyId()).toBe('pty-1')

    controller.setBaseline('pty-1', { seq: 100, pendingDeliveryStartSeq: 100 })
    expect(controller.getBaselinePtyId()).toBeNull()
  })

  it('drops duplicates and slices a partially overlapping chunk', () => {
    const controller = createPtyConnectionRestoredSnapshotReconciliationController()
    controller.setBaseline('pty-1', { seq: 100, pendingDeliveryStartSeq: 40 })

    expect(controller.reconcile('pty-1', 'old', { seq: 80, rawLength: 3 })).toEqual({
      action: 'drop-duplicate'
    })
    expect(controller.reconcile('pty-1', 'abcdefghij', { seq: 105, rawLength: 10 })).toEqual({
      action: 'write',
      data: 'fghij',
      meta: { seq: 105, rawLength: 5 }
    })
  })

  it('retires the baseline for a different PTY or restarted delivery window', () => {
    const controller = createPtyConnectionRestoredSnapshotReconciliationController()
    controller.setBaseline('pty-1', { seq: 100, pendingDeliveryStartSeq: 40 })

    expect(controller.reconcile('pty-2', 'fresh', { seq: 5, rawLength: 5 })).toEqual({
      action: 'write',
      data: 'fresh',
      meta: { seq: 5, rawLength: 5 }
    })
    expect(controller.getBaselinePtyId()).toBeNull()

    controller.setBaseline('pty-1', { seq: 100, pendingDeliveryStartSeq: 40 })
    expect(controller.reconcile('pty-1', 'restart', { seq: 30, rawLength: 7 })).toEqual({
      action: 'write',
      data: 'restart',
      meta: { seq: 30, rawLength: 7 }
    })
    expect(controller.getBaselinePtyId()).toBeNull()
  })

  it('requests a fresh restore for continuity gaps and unmappable overlaps', () => {
    const controller = createPtyConnectionRestoredSnapshotReconciliationController()
    controller.setBaseline('pty-1', { seq: 100, pendingDeliveryStartSeq: 40 })

    expect(controller.reconcile('pty-1', 'gap', { seq: 120, rawLength: 5 })).toEqual({
      action: 'force-fresh-restore'
    })

    controller.setBaseline('pty-1', { seq: 100, pendingDeliveryStartSeq: 40 })
    expect(controller.reconcile('pty-1', 'clean', { seq: 105, rawLength: 10 })).toEqual({
      action: 'force-fresh-restore'
    })
  })

  it('advances the expected sequence after pending chunks are drained', () => {
    const controller = createPtyConnectionRestoredSnapshotReconciliationController()
    controller.setBaseline('pty-1', { seq: 100, pendingDeliveryStartSeq: 40 })
    controller.advanceExpectedSeq(115)

    expect(controller.reconcile('pty-1', 'next', { seq: 120, rawLength: 5 })).toEqual({
      action: 'write',
      data: 'next',
      meta: { seq: 120, rawLength: 5 }
    })
  })

  it('passes seq-less chunks through without retiring the baseline', () => {
    const controller = createPtyConnectionRestoredSnapshotReconciliationController()
    controller.setBaseline('pty-1', { seq: 100, pendingDeliveryStartSeq: 40 })

    expect(controller.reconcile('pty-1', 'plain', undefined)).toEqual({
      action: 'write',
      data: 'plain',
      meta: undefined
    })
    expect(controller.getBaselinePtyId()).toBe('pty-1')
  })
})
