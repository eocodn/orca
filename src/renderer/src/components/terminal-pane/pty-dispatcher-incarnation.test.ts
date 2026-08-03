import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./terminal-pty-ack-gate', () => ({
  clearProcessedPtyCharTotal: vi.fn(),
  deliverPtyDataWithDeferredAck: (
    id: string,
    chars: number,
    dispatch: () => void,
    incarnationId?: string
  ) => {
    dispatch()
    ;(globalThis as { window?: Window }).window?.api.pty.ackData?.(id, chars, chars, incarnationId)
  },
  exposeE2eTerminalPtyAckGate: vi.fn(),
  getProcessedPtyCharTotals: () => ({})
}))
vi.mock('./terminal-delivery-watchdog', () => ({
  clearReceivedPtyCharTotal: vi.fn(),
  isPtyPushDeliveryBlackholed: () => false,
  recordPtyDataReceived: vi.fn(),
  startTerminalDeliveryWatchdog: vi.fn()
}))
vi.mock('./terminal-freeze-breadcrumbs', () => ({ recordTerminalFreezeBreadcrumb: vi.fn() }))
vi.mock('./terminal-freeze-report', () => ({ installTerminalFreezeReport: vi.fn() }))
vi.mock('./pty-shutdown-data-suspension', () => ({
  bufferPtyShutdownData: vi.fn(),
  bufferPtyShutdownReplayData: () => false,
  drainRolledBackPtyShutdownData: vi.fn(),
  isPtyDataHandlerShutdownPending: vi.fn(() => false),
  ptyDataHandlers: new Map(),
  ptyDataSidecars: new Map(),
  ptyExitHandlers: new Map(),
  ptyReplayHandlers: new Map(),
  ptyShutdownLifecycleHandlers: new Map(),
  ptyTeardownHandlers: new Map(),
  restorePtyDataHandlersAfterFailedShutdown: vi.fn(),
  unregisterPtyDataHandlers: vi.fn()
}))
vi.mock('./pty-shutdown-exit-deferral', () => ({ markCommittedPtyShutdowns: vi.fn() }))

describe('pty dispatcher incarnation fencing', () => {
  const originalWindow = (globalThis as { window?: typeof window }).window
  type DataCallback = (payload: { id: string; incarnationId: string; data: string }) => void
  let dataCallback: DataCallback | null = null
  const ackDataMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    dataCallback = null
    ackDataMock.mockClear()
    ;(globalThis as { window: typeof window }).window = {
      ...originalWindow,
      api: {
        ...originalWindow?.api,
        pty: {
          ...originalWindow?.api?.pty,
          ackData: ackDataMock,
          onData: vi.fn((callback: DataCallback) => {
            dataCallback ??= callback
            return () => {}
          }),
          onReplay: vi.fn(() => () => {}),
          onExit: vi.fn(() => () => {})
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

  it('never re-admits an older incarnation after multiple replacements', async () => {
    const { ensurePtyDispatcher, ptyDataHandlers } = await import('./pty-dispatcher')
    const received: string[] = []
    ptyDataHandlers.set('pty-multiple-replacements', (data) => received.push(data))
    ensurePtyDispatcher()

    dataCallback?.({
      id: 'pty-multiple-replacements',
      incarnationId: 'incarnation-a',
      data: 'old-a'
    })
    dataCallback?.({
      id: 'pty-multiple-replacements',
      incarnationId: 'incarnation-b',
      data: 'active-b'
    })
    dataCallback?.({
      id: 'pty-multiple-replacements',
      incarnationId: 'incarnation-c',
      data: 'active-c'
    })
    dataCallback?.({
      id: 'pty-multiple-replacements',
      incarnationId: 'incarnation-a',
      data: 'delayed-old-a'
    })

    expect(received).toEqual(['old-a', 'active-b', 'active-c'])
    expect(ackDataMock).toHaveBeenCalledTimes(3)
  })
})
