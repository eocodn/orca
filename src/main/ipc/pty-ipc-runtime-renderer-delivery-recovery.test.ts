import { describe, expect, it } from 'vitest'
import { createPtyRendererDeliveryRecovery } from './pty-ipc-runtime-renderer-delivery-recovery'

function createRecoveryState() {
  return {
    rendererDeliveryAccountingByPty: new Map([
      [
        'pty-1',
        {
          incarnationId: 'incarnation-current',
          sentChars: 10,
          ackedChars: 2,
          lastSendAtMs: 1,
          lastAckAtMs: null
        }
      ]
    ]),
    rendererInFlightTotalChars: 8,
    pendingData: new Map(),
    sshOutputIntake: null,
    deliveryResyncOutstandingRequestId: null,
    deliveryResyncTimer: null,
    deliveryResyncRequestSerial: 0,
    deliveryResyncUnansweredWarnLogged: false
  }
}

describe('PTY renderer delivery recovery incarnation fencing', () => {
  it('ignores a stale cumulative ACK total', () => {
    const state = createRecoveryState()
    const recovery = createPtyRendererDeliveryRecovery({
      state: state as never,
      runtime: undefined,
      mainWindow: { isDestroyed: () => false, webContents: { send: () => {} } } as never,
      mainDeliveryBreadcrumbs: { record: () => {} } as never,
      readCurrentPtyRendererDeliveryDebugSnapshot: () => ({}),
      deletePendingPtyData: () => {},
      updateProducerFlowControl: () => {}
    })

    expect(recovery.applyCumulativeAck('pty-1', 99, 'incarnation-old')).toBe(0)
    expect(state.rendererDeliveryAccountingByPty.get('pty-1')).toMatchObject({
      sentChars: 10,
      ackedChars: 2,
      incarnationId: 'incarnation-current'
    })
    expect(state.rendererInFlightTotalChars).toBe(8)
  })

  it('does not let an identity-less health report write off an incarnation-aware PTY', () => {
    const state = createRecoveryState()
    const recovery = createPtyRendererDeliveryRecovery({
      state: state as never,
      runtime: undefined,
      mainWindow: { isDestroyed: () => false, webContents: { send: () => {} } } as never,
      mainDeliveryBreadcrumbs: { record: () => {} } as never,
      readCurrentPtyRendererDeliveryDebugSnapshot: () => ({}),
      deletePendingPtyData: () => {},
      updateProducerFlowControl: () => {}
    })

    expect(
      recovery.writeOffLostRendererDelivery({
        receivedCharsByPty: { 'pty-1': 99 },
        rendererPtyDataListenerCount: 1
      })
    ).toEqual([])
    expect(state.rendererDeliveryAccountingByPty.get('pty-1')?.ackedChars).toBe(2)
  })
})
