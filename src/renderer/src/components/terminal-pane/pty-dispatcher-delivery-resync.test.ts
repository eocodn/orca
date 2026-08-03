// Why: pins the renderer half of the delivery-resync protocol — the singleton
// dispatcher must answer main's probe with the cumulative processed totals
// that back its ACKs, and must drop a PTY's total once it exits.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('pty dispatcher delivery resync', () => {
  const originalWindow = (globalThis as { window?: typeof window }).window

  let dataCallback:
    | ((payload: {
        id: string
        incarnationId: string
        data: string
        rawLength?: number
        background?: boolean
      }) => void)
    | null = null
  let exitCallback: ((payload: { id: string; code: number; incarnationId?: string }) => void) | null = null
  let resyncRequestCallback: ((payload: { requestId: number }) => void) | null = null
  const ackDataMock = vi.fn()
  const respondDeliveryResyncMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    dataCallback = null
    exitCallback = null
    resyncRequestCallback = null
    ackDataMock.mockClear()
    respondDeliveryResyncMock.mockClear()
    ;(globalThis as { window: typeof window }).window = {
      ...originalWindow,
      api: {
        ...originalWindow?.api,
        pty: {
          ...originalWindow?.api?.pty,
          ackData: ackDataMock,
          onData: vi.fn(
            (
              cb: (payload: {
                id: string
                incarnationId: string
                data: string
                rawLength?: number
                background?: boolean
              }) => void
            ) => {
              dataCallback ??= cb
              return () => {}
            }
          ),
          onReplay: vi.fn(() => () => {}),
          onExit: vi.fn((cb: (payload: { id: string; code: number; incarnationId?: string }) => void) => {
            exitCallback ??= cb
            return () => {}
          }),
          onDeliveryResyncRequest: vi.fn((cb: (payload: { requestId: number }) => void) => {
            resyncRequestCallback ??= cb
            return () => {}
          }),
          respondDeliveryResync: respondDeliveryResyncMock
        }
      }
    } as unknown as typeof window
  })

  afterEach(() => {
    if (originalWindow) {
      ;(globalThis as { window: typeof window }).window = originalWindow
    } else {
      delete (globalThis as { window?: typeof window }).window
    }
  })

  it('answers delivery resync probes with cumulative totals and drops exited PTYs', async () => {
    const { ensurePtyDispatcher } = await import('./pty-dispatcher')
    ensurePtyDispatcher()

    dataCallback?.({ id: 'pty-1', incarnationId: 'incarnation-1', data: 'hello' })
    dataCallback?.({
      id: 'pty-1',
      incarnationId: 'incarnation-1',
      data: 'world!!',
      rawLength: 7
    })
    dataCallback?.({ id: 'pty-2', incarnationId: 'incarnation-2', data: 'abc' })

    expect(ackDataMock).toHaveBeenNthCalledWith(1, 'pty-1', 5, 5, 'incarnation-1')
    expect(ackDataMock).toHaveBeenNthCalledWith(2, 'pty-1', 7, 12, 'incarnation-1')
    expect(ackDataMock).toHaveBeenNthCalledWith(3, 'pty-2', 3, 3, 'incarnation-2')

    resyncRequestCallback?.({ requestId: 7 })
    expect(respondDeliveryResyncMock).toHaveBeenCalledWith({
      requestId: 7,
      processedCharsByPty: {
        'pty-1': { incarnationId: 'incarnation-1', processedChars: 12 },
        'pty-2': { incarnationId: 'incarnation-2', processedChars: 3 }
      }
    })

    exitCallback?.({ id: 'pty-1', code: 0, incarnationId: 'incarnation-1' })
    resyncRequestCallback?.({ requestId: 8 })
    expect(respondDeliveryResyncMock).toHaveBeenLastCalledWith({
      requestId: 8,
      processedCharsByPty: {
        'pty-2': { incarnationId: 'incarnation-2', processedChars: 3 }
      }
    })
  })

  it('starts a fresh cumulative ACK domain when a PTY id is reused', async () => {
    const { ensurePtyDispatcher } = await import('./pty-dispatcher')
    ensurePtyDispatcher()

    dataCallback?.({ id: 'pty-reused', incarnationId: 'incarnation-old', data: 'old' })
    exitCallback?.({ id: 'pty-reused', code: 0, incarnationId: 'incarnation-old' })
    dataCallback?.({ id: 'pty-reused', incarnationId: 'incarnation-old', data: 'delayed-old' })
    expect(ackDataMock).toHaveBeenCalledTimes(1)
    dataCallback?.({ id: 'pty-reused', incarnationId: 'incarnation-new', data: 'fresh' })

    expect(ackDataMock).toHaveBeenNthCalledWith(1, 'pty-reused', 3, 3, 'incarnation-old')
    expect(ackDataMock).toHaveBeenNthCalledWith(2, 'pty-reused', 5, 5, 'incarnation-new')
    resyncRequestCallback?.({ requestId: 9 })
    expect(respondDeliveryResyncMock).toHaveBeenLastCalledWith({
      requestId: 9,
      processedCharsByPty: {
        'pty-reused': { incarnationId: 'incarnation-new', processedChars: 5 }
      }
    })
  })

  it('accepts a new incarnation frame when the prior exit was lost', async () => {
    const { ensurePtyDispatcher, ptyDataHandlers } = await import('./pty-dispatcher')
    const received: string[] = []
    ptyDataHandlers.set('pty-lost-exit', (data) => received.push(data))
    ensurePtyDispatcher()

    dataCallback?.({ id: 'pty-lost-exit', incarnationId: 'incarnation-old', data: 'old' })
    dataCallback?.({ id: 'pty-lost-exit', incarnationId: 'incarnation-new', data: 'fresh' })
    dataCallback?.({
      id: 'pty-lost-exit',
      incarnationId: 'incarnation-old',
      data: 'delayed-old'
    })

    expect(received).toEqual(['old', 'fresh'])
    expect(ackDataMock).toHaveBeenNthCalledWith(1, 'pty-lost-exit', 3, 3, 'incarnation-old')
    expect(ackDataMock).toHaveBeenNthCalledWith(2, 'pty-lost-exit', 5, 5, 'incarnation-new')
    expect(ackDataMock).toHaveBeenCalledTimes(2)

    resyncRequestCallback?.({ requestId: 10 })
    expect(respondDeliveryResyncMock).toHaveBeenLastCalledWith({
      requestId: 10,
      processedCharsByPty: {
        'pty-lost-exit': { incarnationId: 'incarnation-new', processedChars: 5 }
      }
    })
  })

  it('uses the active incarnation to fence delayed data from a tokenless legacy exit', async () => {
    const { ensurePtyDispatcher } = await import('./pty-dispatcher')
    ensurePtyDispatcher()

    dataCallback?.({ id: 'pty-legacy-exit', incarnationId: 'incarnation-old', data: 'old' })
    exitCallback?.({ id: 'pty-legacy-exit', code: 0 })
    dataCallback?.({
      id: 'pty-legacy-exit',
      incarnationId: 'incarnation-old',
      data: 'delayed-old'
    })
    dataCallback?.({ id: 'pty-legacy-exit', incarnationId: 'incarnation-new', data: 'fresh' })

    expect(ackDataMock).toHaveBeenNthCalledWith(
      1,
      'pty-legacy-exit',
      3,
      3,
      'incarnation-old'
    )
    expect(ackDataMock).toHaveBeenNthCalledWith(
      2,
      'pty-legacy-exit',
      5,
      5,
      'incarnation-new'
    )
    expect(ackDataMock).toHaveBeenCalledTimes(2)
  })
})
