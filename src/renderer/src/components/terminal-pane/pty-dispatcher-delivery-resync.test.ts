import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { processedTotals } = vi.hoisted(() => ({
  processedTotals: new Map<string, { incarnationId?: string; chars: number }>()
}))

vi.mock('./terminal-pty-ack-gate', () => ({
  clearProcessedPtyCharTotal: (id: string) => processedTotals.delete(id),
  getProcessedPtyCharTotals: () =>
    Object.fromEntries(
      Array.from(processedTotals, ([id, total]) => [
        id,
        total.incarnationId
          ? { incarnationId: total.incarnationId, processedChars: total.chars }
          : total.chars
      ])
    ),
  deliverPtyDataWithDeferredAck: (
    id: string,
    chars: number,
    dispatch: () => void,
    incarnationId?: string
  ) => {
    dispatch()
    const previous = processedTotals.get(id)
    const next = previous?.incarnationId === incarnationId ? previous.chars + chars : chars
    processedTotals.set(id, { incarnationId, chars: next })
    window.api.pty.ackData(id, chars, next, incarnationId ?? '')
  },
  exposeE2eTerminalPtyAckGate: () => {}
}))
vi.mock('./terminal-delivery-watchdog', () => ({
  clearReceivedPtyCharTotal: () => {},
  isPtyPushDeliveryBlackholed: () => false,
  recordPtyDataReceived: () => {},
  startTerminalDeliveryWatchdog: () => {}
}))
vi.mock('./terminal-freeze-breadcrumbs', () => ({ recordTerminalFreezeBreadcrumb: () => {} }))
vi.mock('./terminal-freeze-report', () => ({ installTerminalFreezeReport: () => {} }))
vi.mock('./pty-shutdown-exit-deferral', () => ({ markCommittedPtyShutdowns: () => {} }))

describe('pty dispatcher incarnation fencing', () => {
  const originalWindow = (globalThis as { window?: typeof window }).window

  let dataCallback:
    | ((payload: { id: string; incarnationId?: string; data: string; rawLength?: number }) => void)
    | null = null
  let exitCallback:
    | ((payload: { id: string; code: number; incarnationId?: string }) => void)
    | null = null
  let replayCallback:
    | ((payload: { id: string; data: string; incarnationId?: string }) => void)
    | null = null
  let resyncRequestCallback: ((payload: { requestId: number }) => void) | null = null
  const ackDataMock = vi.fn()
  const respondDeliveryResyncMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    processedTotals.clear()
    dataCallback = null
    exitCallback = null
    replayCallback = null
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
          onData: vi.fn((cb: typeof dataCallback) => {
            dataCallback ??= cb
            return () => {}
          }),
          onReplay: vi.fn((cb: typeof replayCallback) => {
            replayCallback ??= cb
            return () => {}
          }),
          onExit: vi.fn((cb: typeof exitCallback) => {
            exitCallback ??= cb
            return () => {}
          }),
          onDeliveryResyncRequest: vi.fn((cb: typeof resyncRequestCallback) => {
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

  it('does not dispatch or ACK a tokenless frame after an incarnation is active', async () => {
    const { ensurePtyDispatcher, ptyDataHandlers } = await import('./pty-dispatcher')
    const received: string[] = []
    ptyDataHandlers.set('pty-1', (data) => received.push(data))
    ensurePtyDispatcher()

    dataCallback?.({ id: 'pty-1', incarnationId: 'incarnation-current', data: 'fresh' })
    dataCallback?.({ id: 'pty-1', data: 'stale-without-token' })

    expect(received).toEqual(['fresh'])
    expect(ackDataMock).toHaveBeenCalledTimes(1)
  })

  it('fences tokenless replay after an incarnation is active', async () => {
    const { ensurePtyDispatcher, ptyReplayHandlers } = await import('./pty-dispatcher')
    const received: string[] = []
    ptyReplayHandlers.set('pty-1', (data) => received.push(data))
    ensurePtyDispatcher()

    dataCallback?.({ id: 'pty-1', incarnationId: 'incarnation-current', data: 'fresh' })
    replayCallback?.({ id: 'pty-1', data: 'stale-replay' })
    replayCallback?.({ id: 'pty-1', incarnationId: 'incarnation-current', data: 'current-replay' })

    expect(received).toEqual(['current-replay'])
  })

  it('answers delivery resync with incarnation-tagged cumulative totals', async () => {
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
    resyncRequestCallback?.({ requestId: 7 })

    expect(ackDataMock).toHaveBeenNthCalledWith(1, 'pty-1', 5, 5, 'incarnation-1')
    expect(ackDataMock).toHaveBeenNthCalledWith(2, 'pty-1', 7, 12, 'incarnation-1')
    expect(ackDataMock).toHaveBeenNthCalledWith(3, 'pty-2', 3, 3, 'incarnation-2')
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

  it('drops the active incarnation totals on its matching exit', async () => {
    const { ensurePtyDispatcher } = await import('./pty-dispatcher')
    ensurePtyDispatcher()

    dataCallback?.({ id: 'pty-reused', incarnationId: 'incarnation-old', data: 'old' })
    exitCallback?.({ id: 'pty-reused', code: 0, incarnationId: 'incarnation-old' })
    dataCallback?.({ id: 'pty-reused', incarnationId: 'incarnation-old', data: 'delayed-old' })
    dataCallback?.({ id: 'pty-reused', incarnationId: 'incarnation-new', data: 'fresh' })

    expect(ackDataMock).toHaveBeenNthCalledWith(1, 'pty-reused', 3, 3, 'incarnation-old')
    expect(ackDataMock).toHaveBeenNthCalledWith(2, 'pty-reused', 5, 5, 'incarnation-new')
  })

  it('accepts a new incarnation after the prior exit was lost', async () => {
    const { ensurePtyDispatcher, ptyDataHandlers } = await import('./pty-dispatcher')
    const received: string[] = []
    ptyDataHandlers.set('pty-lost-exit', (data) => received.push(data))
    ensurePtyDispatcher()

    dataCallback?.({ id: 'pty-lost-exit', incarnationId: 'incarnation-old', data: 'old' })
    dataCallback?.({ id: 'pty-lost-exit', incarnationId: 'incarnation-new', data: 'fresh' })
    dataCallback?.({ id: 'pty-lost-exit', incarnationId: 'incarnation-old', data: 'delayed-old' })

    expect(received).toEqual(['old', 'fresh'])
    expect(ackDataMock).toHaveBeenNthCalledWith(1, 'pty-lost-exit', 3, 3, 'incarnation-old')
    expect(ackDataMock).toHaveBeenNthCalledWith(2, 'pty-lost-exit', 5, 5, 'incarnation-new')
    expect(ackDataMock).toHaveBeenCalledTimes(2)
  })

  it('uses the active incarnation to fence delayed data from a tokenless exit', async () => {
    const { ensurePtyDispatcher, ptyDataHandlers } = await import('./pty-dispatcher')
    const received: string[] = []
    ptyDataHandlers.set('pty-legacy-exit', (data) => received.push(data))
    ensurePtyDispatcher()

    dataCallback?.({ id: 'pty-legacy-exit', incarnationId: 'incarnation-old', data: 'old' })
    exitCallback?.({ id: 'pty-legacy-exit', code: 0 })
    dataCallback?.({ id: 'pty-legacy-exit', incarnationId: 'incarnation-old', data: 'delayed-old' })
    dataCallback?.({ id: 'pty-legacy-exit', incarnationId: 'incarnation-new', data: 'fresh' })

    expect(received).toEqual(['old', 'fresh'])
    expect(ackDataMock).toHaveBeenNthCalledWith(1, 'pty-legacy-exit', 3, 3, 'incarnation-old')
    expect(ackDataMock).toHaveBeenNthCalledWith(2, 'pty-legacy-exit', 5, 5, 'incarnation-new')
    expect(ackDataMock).toHaveBeenCalledTimes(2)
  })
})
