import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { PtyRendererDeliveryContext } from './pty-ipc-runtime-renderer-delivery-context'
import { createPtyRendererDeliveryDiagnostics } from './pty-ipc-runtime-renderer-delivery-diagnostics'

vi.mock('electron', () => ({
  app: { getVersion: () => 'test' }
}))
vi.mock('./pty-ipc-runtime-state', () => ({
  ptyRuntimeState: {
    activeRendererPtys: new Set(),
    visibleRendererPtys: new Set(),
    rendererVisibilityKnownPtys: new Set(),
    ptyIncarnationById: new Map(),
    lastPowerSuspendAtMs: null,
    lastPowerResumeAtMs: null
  }
}))

describe('pty renderer delivery diagnostics', () => {
  it('reports current pending and in-flight pressure after extraction', () => {
    const pending = new Map([['pty-queued', { data: 'queued' }]])
    const state = {
      pendingData: {
        size: pending.size,
        values: () => pending.values(),
        keys: () => pending.keys(),
        get: (id: string) => pending.get(id),
        totalPendingChars: 6
      },
      rendererDeliveryAccountingByPty: new Map([
        ['pty-1', { sentChars: 10, ackedChars: 3, lastSendAtMs: 1, lastAckAtMs: 2 }]
      ]),
      rendererInFlightTotalChars: 7,
      pendingDroppedChars: 0,
      flushTimer: null,
      ackGatedFlushSkipCount: 0,
      rendererLifecycleResetCount: 0,
      lastLifecycleResetClearedChars: 0,
      rendererPtyDispatcherReady: true,
      rendererDispatcherReadyForcedCount: 0,
      rendererDispatcherReadyTimeoutCount: 0
    } as unknown as PtyRendererDeliveryContext
    const mainWindow = {
      isDestroyed: () => false,
      isFocused: () => true,
      isVisible: () => true,
      isMinimized: () => false
    } as unknown as BrowserWindow

    const diagnostics = createPtyRendererDeliveryDiagnostics({
      state,
      mainWindow,
      mainDeliveryBreadcrumbs: { snapshot: () => [], record: () => {}, reset: () => {} },
      getRendererInFlightCharsForPty: () => 7
    })

    expect(diagnostics.readCurrentPtyRendererDeliveryDebugSnapshot()).toMatchObject({
      pendingPtyCount: 1,
      pendingChars: 6,
      rendererInFlightPtyCount: 1,
      rendererInFlightChars: 7
    })
  })
})
