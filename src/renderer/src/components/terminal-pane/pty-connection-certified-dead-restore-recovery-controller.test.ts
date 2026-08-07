import { describe, expect, it } from 'vitest'
import { createPtyConnectionCertifiedDeadRestoreRecoveryController } from './pty-connection-certified-dead-restore-recovery-controller'

describe('createPtyConnectionCertifiedDeadRestoreRecoveryController', () => {
  it('grants exactly one recovery claim for an xterm instance', () => {
    const controller = createPtyConnectionCertifiedDeadRestoreRecoveryController()

    expect(controller.claim()).toBe(true)
    expect(controller.claim()).toBe(false)
    expect(controller.claim()).toBe(false)
  })

  it('does not expose a reset path because the latch is xterm-scoped', () => {
    const controller = createPtyConnectionCertifiedDeadRestoreRecoveryController()

    expect('reset' in controller).toBe(false)
  })
})
