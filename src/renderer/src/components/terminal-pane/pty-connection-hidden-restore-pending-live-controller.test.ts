import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionHiddenRestorePendingLiveController } from './pty-connection-hidden-restore-pending-live-controller'

describe('createPtyConnectionHiddenRestorePendingLiveController', () => {
  it('queues chunks and drains them as one transaction', () => {
    const controller = createPtyConnectionHiddenRestorePendingLiveController({ maxChars: 10 })
    const drained: { chunk: { data: string; seq?: number; rawLength?: number }; data: string }[] =
      []

    expect(controller.enqueue({ data: 'abc', seq: 3 })).toEqual({ kind: 'queued' })
    expect(controller.enqueue({ data: 'de', rawLength: 2 })).toEqual({ kind: 'queued' })
    expect(controller.hasQueuedChunks()).toBe(true)

    expect(
      controller.drainAfterSnapshot(undefined, {
        onChunk: (chunk, data) => drained.push({ chunk, data }),
        onDiscarded: vi.fn()
      })
    ).toBe('drained')
    expect(drained).toEqual([
      { chunk: { data: 'abc', seq: 3 }, data: 'abc' },
      { chunk: { data: 'de', rawLength: 2 }, data: 'de' }
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
    expect(
      controller.drainAfterSnapshot(undefined, {
        onChunk: vi.fn(),
        onDiscarded: vi.fn()
      })
    ).toBe('overflow')
    expect(controller.hasPending()).toBe(false)
  })

  it('discards new chunks while the overflow latch is active', () => {
    const controller = createPtyConnectionHiddenRestorePendingLiveController({ maxChars: 2 })
    controller.enqueue({ data: 'abc' })

    expect(controller.enqueue({ data: 'later' })).toEqual({
      kind: 'discarded',
      chunks: [{ data: 'later' }]
    })
    expect(
      controller.drainAfterSnapshot(undefined, {
        onChunk: vi.fn(),
        onDiscarded: vi.fn()
      })
    ).toBe('overflow')
  })

  it('drains only bytes newer than the snapshot while preserving chunk sequence evidence', () => {
    const controller = createPtyConnectionHiddenRestorePendingLiveController({ maxChars: 20 })
    const onChunk = vi.fn()
    const onDiscarded = vi.fn()
    controller.enqueue({ data: 'abcdef', seq: 10, rawLength: 6 })

    expect(controller.drainAfterSnapshot(7, { onChunk, onDiscarded })).toBe('drained')
    expect(onChunk).toHaveBeenCalledWith({ data: 'abcdef', seq: 10, rawLength: 6 }, 'def')
    expect(onDiscarded).not.toHaveBeenCalled()
    expect(controller.hasPending()).toBe(false)
  })

  it('refetches and discards the remaining transaction when raw sequence offsets are unmappable', () => {
    const controller = createPtyConnectionHiddenRestorePendingLiveController({ maxChars: 20 })
    const onChunk = vi.fn()
    const onDiscarded = vi.fn()
    const first = { data: 'abc', seq: 10, rawLength: 8 }
    const second = { data: 'later', seq: 15, rawLength: 5 }
    controller.enqueue(first)
    controller.enqueue(second)

    expect(controller.drainAfterSnapshot(5, { onChunk, onDiscarded })).toBe('refetch')
    expect(onChunk).not.toHaveBeenCalled()
    expect(onDiscarded.mock.calls).toEqual([[first], [second]])
    expect(controller.hasPending()).toBe(false)
  })

  it('consumes an overflow latch as an overflow drain outcome', () => {
    const controller = createPtyConnectionHiddenRestorePendingLiveController({ maxChars: 5 })
    controller.enqueue({ data: 'abcdef' })

    expect(
      controller.drainAfterSnapshot(undefined, {
        onChunk: vi.fn(),
        onDiscarded: vi.fn()
      })
    ).toBe('overflow')
    expect(controller.hasPending()).toBe(false)
  })

  it('observes overflow raised while a drained chunk callback is running', () => {
    const controller = createPtyConnectionHiddenRestorePendingLiveController({ maxChars: 5 })
    const onDiscarded = vi.fn()
    controller.enqueue({ data: 'abc', seq: 3 })

    expect(
      controller.drainAfterSnapshot(undefined, {
        onChunk: () => {
          expect(controller.enqueue({ data: 'overflow' })).toEqual({
            kind: 'discarded',
            chunks: [{ data: 'overflow' }]
          })
        },
        onDiscarded
      })
    ).toBe('overflow')
    expect(onDiscarded).not.toHaveBeenCalled()
    expect(controller.hasPending()).toBe(false)
  })

  it('takes abandon replay data relative to the replayed snapshot and clears all state', () => {
    const controller = createPtyConnectionHiddenRestorePendingLiveController({ maxChars: 5 })
    controller.enqueue({ data: 'abc', seq: 3, rawLength: 3 })
    controller.enqueue({ data: 'de', seq: 5, rawLength: 2 })
    expect(controller.takeForAbandonReplay(4)).toEqual({
      chunks: [
        { data: 'abc', seq: 3, rawLength: 3 },
        { data: 'de', seq: 5, rawLength: 2 }
      ],
      data: 'e',
      overflow: false
    })
    expect(controller.hasPending()).toBe(false)

    controller.enqueue({ data: 'abcdef' })
    expect(controller.takeForAbandonReplay(null)).toEqual({ chunks: [], data: '', overflow: true })
    expect(controller.hasPending()).toBe(false)
  })

  it('falls back to the full chunk when abandon replay offsets cannot be mapped', () => {
    const controller = createPtyConnectionHiddenRestorePendingLiveController({ maxChars: 20 })
    controller.enqueue({ data: 'clean', seq: 10, rawLength: 8 })

    expect(controller.takeForAbandonReplay(5)).toEqual({
      chunks: [{ data: 'clean', seq: 10, rawLength: 8 }],
      data: 'clean',
      overflow: false
    })
  })
})
