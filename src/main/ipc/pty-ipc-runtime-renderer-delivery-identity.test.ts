import { describe, expect, it } from 'vitest'
import {
  canCoalescePtyData,
  preservePtyIncarnationId
} from './pty-ipc-runtime-renderer-delivery-queue'
import { isRendererPtyExitCurrent } from './pty-ipc-runtime-renderer-exit-handling'

describe('PTY renderer delivery identity coalescing', () => {
  it('does not coalesce pending bytes from different incarnations', () => {
    expect(canCoalescePtyData({ incarnationId: 'incarnation-old' }, 'incarnation-new')).toBe(false)
    expect(canCoalescePtyData({ incarnationId: 'incarnation-current' }, undefined)).toBe(false)
    expect(canCoalescePtyData({ data: 'legacy' }, undefined)).toBe(true)
  })

  it.each<[string, { data: string; droppedOutput?: boolean }, string]>([
    ['coalesced pending data', { data: 'old' }, 'incarnation-current'],
    ['chunk remainder', { data: 'tail' }, 'incarnation-current'],
    ['overflow sentinel', { data: 'queries', droppedOutput: true }, 'incarnation-current']
  ])('preserves the incarnation on %s', (_name, value, incarnationId) => {
    expect(preservePtyIncarnationId(value, incarnationId)).toEqual({
      ...value,
      incarnationId
    })
  })

  it('does not accept an exit from a stale incarnation at the renderer boundary', () => {
    expect(
      isRendererPtyExitCurrent('incarnation-old', 'incarnation-current', undefined)
    ).toBe(false)
    expect(isRendererPtyExitCurrent('incarnation-current', 'incarnation-current', undefined)).toBe(
      true
    )
    expect(isRendererPtyExitCurrent(undefined, 'incarnation-current', undefined)).toBe(false)
  })
})
