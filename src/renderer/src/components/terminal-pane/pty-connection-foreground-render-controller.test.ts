import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionForegroundRenderController } from './pty-connection-foreground-render-controller'

function createHarness() {
  let lastInputAt = 0
  let alternate = false
  let switches = 0
  const scheduleAtlasRecovery = vi.fn()
  const rewriteDecision = vi.fn(
    (
      data: string,
      state: {
        previousChunkEndsWithCarriageReturn: boolean
        previousRewriteCsiScanTail: string
      }
    ) => ({
      nextChunkEndsWithCarriageReturn: data.endsWith('\r'),
      nextRewriteCsiScanTail: '',
      prefersRenderRefresh: state.previousChunkEndsWithCarriageReturn && data[0] !== '\n'
    })
  )
  const foregroundRiskPrefersRefresh = vi.fn(() => false)
  const windowsEastAsianPrefersRefresh = vi.fn(() => false)
  const controller = createPtyConnectionForegroundRenderController({
    now: () => 200,
    getLastTerminalInputAt: () => lastInputAt,
    foregroundRiskPrefersRefresh,
    rewriteDecision,
    rewriteOutputPrefersRefresh: () => false,
    windowsEastAsianPrefersRefresh,
    isWindowsClient: false,
    isNativeWindowsConpty: false,
    getBufferType: () => (alternate ? 'alternate' : 'normal'),
    getBufferSwitches: () => switches,
    scheduleAtlasRecovery
  })
  return {
    controller,
    foregroundRiskPrefersRefresh,
    windowsEastAsianPrefersRefresh,
    scheduleAtlasRecovery,
    setLastInputAt(value: number) {
      lastInputAt = value
    },
    setAlternate(value: boolean) {
      alternate = value
    },
    incrementSwitches() {
      switches += 1
    }
  }
}

describe('createPtyConnectionForegroundRenderController', () => {
  it('carries rewrite state across chunks', () => {
    const state = createHarness()

    expect(state.controller.decideRenderRefresh('prompt\r').inPlaceRewrite).toBe(false)
    expect(state.controller.decideRenderRefresh('rewrite').inPlaceRewrite).toBe(true)
  })

  it('prioritizes renderer-risk recovery over ordinary rewrite refresh', () => {
    const state = createHarness()
    state.foregroundRiskPrefersRefresh.mockReturnValue(true)

    expect(state.controller.decideRenderRefresh('\x1b[2J')).toEqual({
      refresh: true,
      inPlaceRewrite: false,
      recoverWebglAtlasAfterParse: true
    })
  })

  it('uses the Windows East Asian refresh policy with recent-input context', () => {
    const state = createHarness()
    state.setLastInputAt(150)
    state.windowsEastAsianPrefersRefresh.mockReturnValue(true)

    expect(state.controller.decideRenderRefresh('한글').refresh).toBe(true)
    expect(state.windowsEastAsianPrefersRefresh).toHaveBeenCalledWith(
      '한글',
      expect.objectContaining({ hadRecentInput: true })
    )
  })

  it('recovers the atlas when alternate-screen membership changes during parse', () => {
    const state = createHarness()
    const onParsed = state.controller.alternateScreenAtlasRecoveryOnParsed()

    state.incrementSwitches()
    onParsed()

    expect(state.scheduleAtlasRecovery).toHaveBeenCalledTimes(1)
  })

  it('recovers the atlas when the write starts in the alternate screen', () => {
    const state = createHarness()
    state.setAlternate(true)

    state.controller.alternateScreenAtlasRecoveryOnParsed()()

    expect(state.scheduleAtlasRecovery).toHaveBeenCalledTimes(1)
  })
})
