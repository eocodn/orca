import { describe, expect, it } from 'vitest'
import { canCoalescePtyData } from './pty-ipc-runtime-renderer-delivery-queue'

describe('PTY renderer delivery identity coalescing', () => {
  it('does not coalesce pending bytes from different incarnations', () => {
    expect(canCoalescePtyData({ incarnationId: 'incarnation-old' }, 'incarnation-new')).toBe(false)
    expect(canCoalescePtyData({ incarnationId: 'incarnation-current' }, undefined)).toBe(false)
    expect(canCoalescePtyData({ data: 'legacy' }, undefined)).toBe(true)
  })
})
