import { describe, expect, it, vi } from 'vitest'
import { runPtyConnectionDeferredSshConnect } from './pty-connection-deferred-ssh-connect-controller'

describe('runPtyConnectionDeferredSshConnect', () => {
  it('short-circuits settlement when prompt admission does not continue', async () => {
    const runSettlement = vi.fn(async () => 'connected' as const)

    await expect(
      runPtyConnectionDeferredSshConnect({
        runPromptAdmission: async () => 'cancelled',
        runSettlement
      })
    ).resolves.toBe('cancelled')

    expect(runSettlement).not.toHaveBeenCalled()
  })

  it('runs settlement only after prompt admission continues', async () => {
    const order: string[] = []

    await expect(
      runPtyConnectionDeferredSshConnect({
        runPromptAdmission: async () => {
          order.push('admission')
          return 'continue'
        },
        runSettlement: async () => {
          order.push('settlement')
          return 'connected'
        }
      })
    ).resolves.toBe('connected')

    expect(order).toEqual(['admission', 'settlement'])
  })

  it('propagates unexpected admission rejection', async () => {
    const error = new Error('admission crashed')

    await expect(
      runPtyConnectionDeferredSshConnect({
        runPromptAdmission: async () => {
          throw error
        },
        runSettlement: async () => 'connected'
      })
    ).rejects.toBe(error)
  })

  it('propagates unexpected settlement rejection', async () => {
    const error = new Error('settlement crashed')

    await expect(
      runPtyConnectionDeferredSshConnect({
        runPromptAdmission: async () => 'continue',
        runSettlement: async () => {
          throw error
        }
      })
    ).rejects.toBe(error)
  })
})
