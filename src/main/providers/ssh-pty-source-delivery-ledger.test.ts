import { describe, expect, it, vi } from 'vitest'
import { SshPtySourceDeliveryLedger } from './ssh-pty-source-delivery-ledger'

describe('SshPtySourceDeliveryLedger', () => {
  it('does not retire a replacement activation for an older incarnation exit', () => {
    const publish = vi.fn()
    const ledger = new SshPtySourceDeliveryLedger({ request: vi.fn() } as never, publish)
    const activation = ledger.install(
      'pty-1',
      Object.freeze({
        status: 'pending',
        clientGeneration: 2,
        ownerGeneration: 3,
        ptyIncarnation: 'incarnation-current',
        deliveryToken: 'token-current',
        checkpointSourceEndSu: 0,
        recoveryEndSu: 0
      })
    )
    activation.commit()

    ledger.recordExit('pty-1', 'incarnation-old')
    expect(
      ledger.admit({
        relayPtyId: 'pty-1',
        params: {
          ptyIncarnation: 'incarnation-current',
          deliveryToken: 'token-current',
          clientGeneration: 2,
          ownerGeneration: 3
        },
        data: 'still-live',
        source: {
          relayPtyId: 'pty-1',
          spanId: 'span-1',
          clientGeneration: 2,
          ownerGeneration: 3,
          deliveryToken: 'token-current',
          sourceStartSu: 0,
          sourceEndSu: 10
        }
      })
    ).toBe(true)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ data: 'still-live' }))
  })

  it('retains cancellation ownership when recovery transfer is superseded', async () => {
    const request = vi.fn(async () => ({ canceled: true, sentEndSu: 0, creditedEndSu: 0 }))
    const ledger = new SshPtySourceDeliveryLedger({ request } as never, vi.fn())
    const older = ledger.install(
      'pty-1',
      Object.freeze({
        status: 'pending',
        clientGeneration: 2,
        ownerGeneration: 3,
        ptyIncarnation: 'incarnation-1',
        deliveryToken: 'token-old',
        checkpointSourceEndSu: 0,
        recoveryEndSu: 0
      })
    )
    ledger.install(
      'pty-1',
      Object.freeze({
        status: 'pending',
        clientGeneration: 3,
        ownerGeneration: 4,
        ptyIncarnation: 'incarnation-1',
        deliveryToken: 'token-new',
        checkpointSourceEndSu: 0,
        recoveryEndSu: 0
      })
    )

    expect(() => older.transferToRecovery(vi.fn())).toThrow('ssh_source_receiving_activation_stale')
    await expect(older.rollback()).resolves.toBe(true)

    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith('pty.cancelDelivery', {
      id: 'pty-1',
      clientGeneration: 2,
      ownerGeneration: 3,
      deliveryToken: 'token-old'
    })
  })
})
