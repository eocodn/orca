import { describe, expect, it, vi } from 'vitest'
import {
  REATTACH_LIVE_DATA_MAX_CHARS,
  createPtyConnectionReattachLiveDataController
} from './pty-connection-reattach-live-data-controller'

function createHarness() {
  let ptyId: string | null = 'pty-1'
  let streamGeneration = 1
  let disposed = false
  let nextCredit: (() => void) | undefined
  const delivered: {
    data: string
    meta?: { droppedOutput?: boolean }
    streamGeneration: number
  }[] = []
  const deliverWithDeferredCredit = vi.fn((_: () => void, deliver: () => void) => deliver())
  const controller = createPtyConnectionReattachLiveDataController({
    getPtyId: () => ptyId,
    getStreamGeneration: () => streamGeneration,
    isDisposed: () => disposed,
    takeDeliveryCredit: () => {
      const credit = nextCredit
      nextCredit = undefined
      return credit
    },
    deliverWithDeferredCredit,
    deliverData: (data, meta, generation) => {
      delivered.push({ data, meta, streamGeneration: generation })
    }
  })

  return {
    controller,
    delivered,
    deliverWithDeferredCredit,
    setPtyId(value: string | null) {
      ptyId = value
    },
    setStreamGeneration(value: number) {
      streamGeneration = value
    },
    setDisposed(value: boolean) {
      disposed = value
    },
    setNextCredit(credit: () => void) {
      nextCredit = credit
    }
  }
}

describe('createPtyConnectionReattachLiveDataController', () => {
  it('holds nested deferrals until the outermost owner settles', () => {
    const state = createHarness()

    state.controller.begin(1)
    state.controller.begin(1)
    expect(state.controller.defer('one', undefined, 1)).toBe(true)
    expect(state.controller.finish(true, 1)).toBeNull()
    expect(state.delivered).toEqual([])

    expect(state.controller.finish(true, 1)).toEqual({
      deliveredChunks: 1,
      ptyId: 'pty-1',
      streamGeneration: 1
    })
    expect(state.delivered).toEqual([{ data: 'one', meta: undefined, streamGeneration: 1 }])
  })

  it('drops superseded stream chunks and releases their delivery credit', () => {
    const state = createHarness()
    const staleCredit = vi.fn()

    state.controller.begin(1)
    state.setNextCredit(staleCredit)
    state.controller.defer('stale', undefined, 1)
    state.setStreamGeneration(2)
    state.controller.begin(2)
    state.controller.defer('current', undefined, 2)

    state.controller.finish(true, 1)
    const result = state.controller.finish(true, 2)

    expect(staleCredit).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ deliveredChunks: 1, ptyId: 'pty-1', streamGeneration: 2 })
    expect(state.delivered).toEqual([{ data: 'current', meta: undefined, streamGeneration: 2 }])
  })

  it('bounds buffered chunks and marks the surviving stream with a gap', () => {
    const state = createHarness()
    const credits = Array.from({ length: 1_025 }, () => vi.fn())

    state.controller.begin(1)
    for (let index = 0; index < credits.length; index += 1) {
      state.setNextCredit(credits[index])
      state.controller.defer(String(index), undefined, 1)
    }
    const result = state.controller.finish(true, 1)

    expect(credits[0]).toHaveBeenCalledTimes(1)
    expect(result?.deliveredChunks).toBe(1_024)
    expect(state.delivered[0]).toMatchObject({ data: '1', meta: { droppedOutput: true } })
    expect(state.delivered.at(-1)?.data).toBe('1024')
  })

  it('keeps only the bounded tail of one oversized frame and marks the stream gap', () => {
    const state = createHarness()
    const oversized = `prefix-${'x'.repeat(REATTACH_LIVE_DATA_MAX_CHARS)}`

    state.controller.begin(1)
    state.controller.defer(oversized, undefined, 1)
    const result = state.controller.finish(true, 1)

    expect(result?.deliveredChunks).toBe(1)
    expect(state.delivered[0]?.data).toHaveLength(REATTACH_LIVE_DATA_MAX_CHARS)
    expect(state.delivered[0]?.data).toBe(oversized.slice(-REATTACH_LIVE_DATA_MAX_CHARS))
    expect(state.delivered[0]?.meta).toEqual({ droppedOutput: true })
  })

  it('suppresses delivery when the current replay owner failed', () => {
    const state = createHarness()
    const credit = vi.fn()

    state.controller.begin(1)
    state.setNextCredit(credit)
    state.controller.defer('discarded', undefined, 1)

    expect(state.controller.finish(false, 1)).toEqual({
      deliveredChunks: 0,
      ptyId: 'pty-1',
      streamGeneration: 1
    })
    expect(state.delivered).toEqual([])
    expect(credit).toHaveBeenCalledTimes(1)
  })

  it('delivers current chunks through deferred credit and reports the settled identity', () => {
    const state = createHarness()
    const credit = vi.fn()

    state.controller.begin(1)
    state.setNextCredit(credit)
    state.controller.defer('live', { droppedOutput: false }, 1)

    expect(state.controller.finish(true, 1)).toEqual({
      deliveredChunks: 1,
      ptyId: 'pty-1',
      streamGeneration: 1
    })
    expect(state.deliverWithDeferredCredit).toHaveBeenCalledTimes(1)
    expect(state.delivered).toEqual([
      { data: 'live', meta: { droppedOutput: false }, streamGeneration: 1 }
    ])
    expect(credit).not.toHaveBeenCalled()
  })

  it('releases buffered credits exactly once on dispose', () => {
    const state = createHarness()
    const firstCredit = vi.fn()
    const secondCredit = vi.fn()

    state.controller.begin(1)
    state.setNextCredit(firstCredit)
    state.controller.defer('one', undefined, 1)
    state.setNextCredit(secondCredit)
    state.controller.defer('two', undefined, 1)
    state.setDisposed(true)

    state.controller.dispose()
    state.controller.dispose()
    expect(firstCredit).toHaveBeenCalledTimes(1)
    expect(secondCredit).toHaveBeenCalledTimes(1)
    expect(state.controller.finish(true, 1)).toBeNull()
  })
})
