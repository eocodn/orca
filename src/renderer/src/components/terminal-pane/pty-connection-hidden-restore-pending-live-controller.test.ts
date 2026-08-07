import { describe, expect, it } from 'vitest'
import { createPtyConnectionHiddenRestorePendingLiveController } from './pty-connection-hidden-restore-pending-live-controller'

describe('createPtyConnectionHiddenRestorePendingLiveController', () => {
  it('queues chunks and takes them as one batch', () => {
    const controller = createPtyConnectionHiddenRestorePendingLiveController({ maxChars: 10 })

    expect(controller.enqueue({ data: 'abc', seq: 3 })).toEqual({ kind: 'queued' })
    expect(controller.enqueue({ data: 'de', rawLength: 2 })).toEqual({ kind: 'queued' })
    expect(controller.hasQueuedChunks()).toBe(true)

    expect(controller.takeBatch()).toEqual([
      { data: 'abc', seq: 3 },
      { data: 'de', rawLength: 2 }
    ])
    expect(controller.hasPending()).toBe(false)
  })

  it('turns a cap crossing into one overflow latch and returns discarded chunks', () => {
    const controller = createPtyConnectionHiddenRestorePendingLiveController({ maxChars: 5 })
    controller.enqueue({ data: 'abc' })

    expect(controller.enqueue({ data: 'def' })).toEqual({
      kind: 'discarded',
      chunks: [{ data: 'abc' }, { data: 'def' }]
    })
    expect(controller.hasPending()).toBe(true)
    expect(controller.hasQueuedChunks()).toBe(false)
    expect(controller.takeOverflow()).toBe(true)
    expect(controller.takeOverflow()).toBe(false)
  })

  it('discards new chunks while the overflow latch is active', () => {
    const controller = createPtyConnectionHiddenRestorePendingLiveController({ maxChars: 2 })
    controller.enqueue({ data: 'abc' })

    expect(controller.enqueue({ data: 'later' })).toEqual({
      kind: 'discarded',
      chunks: [{ data: 'later' }]
    })
    expect(controller.takeOverflow()).toBe(true)
  })

  it('discardAll clears queued chunks without erasing a concurrent overflow latch', () => {
    const controller = createPtyConnectionHiddenRestorePendingLiveController({ maxChars: 5 })
    controller.enqueue({ data: 'abc' })
    expect(controller.discardAll()).toEqual([{ data: 'abc' }])

    controller.enqueue({ data: 'abcdef' })
    expect(controller.discardAll()).toEqual([])
    expect(controller.takeOverflow()).toBe(true)
  })

  it('takeForAbandon snapshots usable chunks or overflow and clears all state', () => {
    const controller = createPtyConnectionHiddenRestorePendingLiveController({ maxChars: 5 })
    controller.enqueue({ data: 'abc', seq: 3 })
    expect(controller.takeForAbandon()).toEqual({
      chunks: [{ data: 'abc', seq: 3 }],
      overflow: false
    })
    expect(controller.hasPending()).toBe(false)

    controller.enqueue({ data: 'abcdef' })
    expect(controller.takeForAbandon()).toEqual({ chunks: [], overflow: true })
    expect(controller.hasPending()).toBe(false)
  })
})
