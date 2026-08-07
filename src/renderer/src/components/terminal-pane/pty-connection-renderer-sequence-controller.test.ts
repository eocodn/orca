import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionRendererSequenceController } from './pty-connection-renderer-sequence-controller'

function createHarness() {
  let ptyId: string | null = 'pty-1'
  const sliceDataAfterSequence = vi.fn(
    (data: string, meta: { seq?: number; rawLength?: number } | undefined, sequence: number) =>
      `${data}:${meta?.seq ?? 'none'}:${sequence}`
  )
  const controller = createPtyConnectionRendererSequenceController({
    getPtyId: () => ptyId,
    sliceDataAfterSequence
  })

  return {
    controller,
    sliceDataAfterSequence,
    setPtyId(value: string | null) {
      ptyId = value
    }
  }
}

describe('createPtyConnectionRendererSequenceController', () => {
  it('keeps the ordered high-water monotonic within one PTY and resets on rotation', () => {
    const state = createHarness()

    state.controller.recordOrdered({ seq: 10 })
    state.controller.recordOrdered({ seq: 8 })
    expect(state.controller.getOrderedFrame()).toEqual({ ptyId: 'pty-1', seq: 10 })

    state.controller.recordOrdered({ seq: 12 })
    expect(state.controller.getOrderedFrame()).toEqual({ ptyId: 'pty-1', seq: 12 })

    state.setPtyId('pty-2')
    state.controller.recordOrdered({ seq: 3 })
    expect(state.controller.getOrderedFrame()).toEqual({ ptyId: 'pty-2', seq: 3 })
  })

  it('invalidates the ordered baseline when the FIFO channel sequence regresses', () => {
    const state = createHarness()

    state.controller.recordOrdered({ seq: 100 })
    state.controller.observeChannel({ seq: 100 })
    state.controller.observeChannel({ seq: 90 })

    expect(state.controller.getOrderedFrame()).toEqual({ ptyId: null, seq: null })
  })

  it('does not carry a prior PTY channel domain into a replacement PTY', () => {
    const state = createHarness()

    state.controller.recordOrdered({ seq: 100 })
    state.controller.observeChannel({ seq: 100 })
    state.setPtyId('pty-2')
    state.controller.recordOrdered({ seq: 4 })
    state.controller.observeChannel({ seq: 2 })

    expect(state.controller.getOrderedFrame()).toEqual({ ptyId: 'pty-2', seq: 4 })
  })

  it('resets only sequence domains owned by the exited PTY', () => {
    const state = createHarness()

    state.controller.recordOrdered({ seq: 20 })
    state.controller.observeChannel({ seq: 20 })
    state.controller.resetForPtyExit('pty-other')
    expect(state.controller.getOrderedFrame()).toEqual({ ptyId: 'pty-1', seq: 20 })

    state.controller.resetForPtyExit('pty-1')
    expect(state.controller.getOrderedFrame()).toEqual({ ptyId: null, seq: null })

    state.controller.observeChannel({ seq: 1 })
    state.controller.recordOrdered({ seq: 1 })
    expect(state.controller.getOrderedFrame()).toEqual({ ptyId: 'pty-1', seq: 1 })
  })

  it('passes hidden data through without a current ordered frame and delegates current slicing', () => {
    const state = createHarness()
    const meta = { seq: 20, rawLength: 4 }

    expect(state.controller.getHiddenDataAfterOrdered('data', meta)).toBe('data')
    expect(state.sliceDataAfterSequence).not.toHaveBeenCalled()

    state.controller.recordOrdered({ seq: 10 })
    expect(state.controller.getHiddenDataAfterOrdered('data', meta)).toBe('data:20:10')
    expect(state.sliceDataAfterSequence).toHaveBeenLastCalledWith('data', meta, 10)

    state.setPtyId('pty-2')
    expect(state.controller.getHiddenDataAfterOrdered('next', meta)).toBe('next')
  })
})
