import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionRenderRiskController } from './pty-connection-render-risk-controller'

function createHarness() {
  let ptyId: string | null = 'pty-a'
  const prefersRenderRefresh = vi.fn((data: string) => data.includes('\x1b[2J'))
  const rewriteDecision = vi.fn(
    (
      _data: string,
      state: {
        previousChunkEndsWithCarriageReturn: boolean
        previousRewriteCsiScanTail: string
      }
    ) => ({
      nextChunkEndsWithCarriageReturn: state.previousChunkEndsWithCarriageReturn,
      nextRewriteCsiScanTail: state.previousRewriteCsiScanTail,
      prefersRenderRefresh: false
    })
  )
  const controller = createPtyConnectionRenderRiskController({
    getPtyId: () => ptyId,
    prefersRenderRefresh,
    rewriteDecision,
    containsCursorPositionSequence: () => false
  })
  return {
    controller,
    prefersRenderRefresh,
    setPtyId(value: string | null) {
      ptyId = value
    }
  }
}

describe('createPtyConnectionRenderRiskController', () => {
  it('carries an incomplete foreground CSI sequence into the next chunk', () => {
    const state = createHarness()

    expect(state.controller.foregroundOutputPrefersRenderRefresh('\x1b[')).toBe(false)
    expect(state.controller.foregroundOutputPrefersRenderRefresh('2J')).toBe(true)
    expect(state.prefersRenderRefresh).toHaveBeenLastCalledWith('\x1b[2J')
  })

  it('recognizes a hidden synchronized-output marker split across chunks', () => {
    const state = createHarness()
    const marker = '\x1b[?2026h'

    expect(state.controller.hiddenOutputNeedsAtlasRecoveryAfterParse(marker.slice(0, -1))).toBe(
      false
    )
    expect(
      state.controller.hiddenOutputNeedsAtlasRecoveryAfterParse(`${marker.slice(-1)}payload`)
    ).toBe(true)
  })

  it('resets hidden synchronized state when PTY authority rotates', () => {
    const state = createHarness()

    expect(state.controller.hiddenOutputNeedsAtlasRecoveryAfterParse('\x1b[?2026hpayload')).toBe(
      true
    )
    state.setPtyId('pty-b')

    expect(state.controller.hiddenOutputNeedsAtlasRecoveryAfterParse('plain output')).toBe(false)
  })

  it('clears hidden frame state when skipped bytes invalidate the parser history', () => {
    const state = createHarness()

    expect(state.controller.hiddenOutputNeedsAtlasRecoveryAfterParse('\x1b[?2026hpayload')).toBe(
      true
    )
    state.controller.resetSkippedHidden()

    expect(state.controller.hiddenOutputNeedsAtlasRecoveryAfterParse('plain output')).toBe(false)
  })

  it('advances rewrite state even when synchronized output already requests recovery', () => {
    let previousCarriageReturn = false
    const rewriteDecision = vi.fn((data: string) => {
      const prefersRenderRefresh = previousCarriageReturn && data[0] !== '\n'
      previousCarriageReturn = data.endsWith('\r')
      return {
        nextChunkEndsWithCarriageReturn: previousCarriageReturn,
        nextRewriteCsiScanTail: '',
        prefersRenderRefresh
      }
    })
    const controller = createPtyConnectionRenderRiskController({
      getPtyId: () => 'pty-a',
      prefersRenderRefresh: () => false,
      rewriteDecision,
      containsCursorPositionSequence: () => false
    })

    expect(controller.hiddenOutputNeedsAtlasRecoveryAfterParse('prompt rewrite\r')).toBe(false)
    expect(controller.hiddenOutputNeedsAtlasRecoveryAfterParse('\x1b[?2026hframe\x1b[?2026l')).toBe(
      true
    )
    expect(controller.hiddenOutputNeedsAtlasRecoveryAfterParse('plain after frame')).toBe(false)
    expect(rewriteDecision).toHaveBeenCalledTimes(3)
  })
})
