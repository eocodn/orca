import { describe, expect, it, vi } from 'vitest'
import { fireQueuedAckCredits } from './pane-terminal-output-queue'
import type { QueueEntry } from './terminal-output-scheduler-queue-runtime-state'

describe('pane terminal output ACK credit queue', () => {
  it('attempts every queued credit when an earlier credit throws', () => {
    const firstCredit = vi.fn(() => {
      throw new Error('synthetic queued credit failure')
    })
    const secondCredit = vi.fn()
    const entry = {
      chunkIndex: 0,
      chunks: [{ ackCredit: firstCredit }, { ackCredit: secondCredit }]
    } as unknown as QueueEntry

    expect(() => fireQueuedAckCredits(entry)).not.toThrow()
    expect(firstCredit).toHaveBeenCalledOnce()
    expect(secondCredit).toHaveBeenCalledOnce()
  })
})
