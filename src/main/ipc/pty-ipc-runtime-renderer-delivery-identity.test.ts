import { describe, expect, it } from 'vitest'
import {
  canCoalescePtyData,
  preservePtyIncarnationId
} from './pty-ipc-runtime-renderer-delivery-coalescing'
import { splitPtyPendingDataChunk } from './pty-ipc-runtime-renderer-delivery-chunking'
import { createPtyRendererPendingQueue } from './pty-ipc-runtime-renderer-delivery-pending-queue'
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

  it('preserves incarnation identity on a chunk remainder', () => {
    const result = splitPtyPendingDataChunk(
      {
        data: 'abcdef',
        incarnationId: 'incarnation-current',
        startSeq: 12,
        containsBackgroundOutput: true
      },
      3
    )

    expect(result).toEqual({
      chunk: 'abc',
      remainder: {
        data: 'def',
        incarnationId: 'incarnation-current',
        startSeq: 15,
        containsBackgroundOutput: true
      }
    })
  })

  it('preserves incarnation identity through coalescing and overflow', () => {
    const queue = createPtyRendererPendingQueue(
      {
        pendingDataDropWarnedPtys: new Set(),
        pendingOverflowMarkedPtys: new Set(),
        pendingDroppedChars: 0,
        sshOutputIntake: null
      },
      () => 3
    )

    const first = queue.appendPendingPtyData(
      'pty-1',
      undefined,
      'ab',
      undefined,
      true,
      false,
      undefined,
      false,
      undefined,
      'incarnation-current'
    )
    const coalesced = queue.appendPendingPtyData(
      'pty-1',
      first,
      'c',
      undefined,
      true,
      false,
      undefined,
      false,
      undefined,
      'incarnation-current'
    )
    const overflow = queue.appendPendingPtyData(
      'pty-2',
      undefined,
      'abcd',
      undefined,
      true,
      false,
      undefined,
      false,
      undefined,
      'incarnation-current'
    )

    expect(coalesced).toMatchObject({ data: 'abc', incarnationId: 'incarnation-current' })
    expect(overflow).toMatchObject({ droppedOutput: true, incarnationId: 'incarnation-current' })
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
