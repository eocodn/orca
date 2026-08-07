import { describe, expect, it } from 'vitest'
import { createPtyConnectionSynchronizedForegroundController } from './pty-connection-synchronized-foreground-controller'

function createHarness(protectedOutput = true) {
  let now = 1_000
  let lastInputAt = 1_000
  const controller = createPtyConnectionSynchronizedForegroundController({
    protectedOutput,
    now: () => now,
    getLastTerminalInputAt: () => lastInputAt
  })

  return {
    controller,
    setNow(value: number) {
      now = value
    },
    setLastInputAt(value: number) {
      lastInputAt = value
    }
  }
}

describe('createPtyConnectionSynchronizedForegroundController', () => {
  it('keeps a submit-opened split frame latency-sensitive through a late close', () => {
    const state = createHarness()

    const opened = state.controller.observe('\x1b[?2026hframe', true)
    state.setNow(1_700)
    const closed = state.controller.observe('tail\x1b[?2026l', true)

    expect(opened).toMatchObject({
      synchronizedOutput: true,
      latencySensitive: true,
      holdForeground: true,
      coalesceForeground: false
    })
    expect(closed).toMatchObject({
      synchronizedOutput: true,
      latencySensitive: true,
      holdForeground: false,
      coalesceForeground: true
    })
  })

  it('keeps a stale synchronized frame off the latency fast path', () => {
    const state = createHarness()
    state.setLastInputAt(0)

    expect(state.controller.observe('\x1b[?2026hframe', true)).toMatchObject({
      synchronizedOutput: true,
      latencySensitive: false,
      holdForeground: true
    })
    state.setNow(2_000)
    expect(state.controller.observe('tail\x1b[?2026l', true)).toMatchObject({
      synchronizedOutput: true,
      latencySensitive: false,
      coalesceForeground: true
    })
  })

  it('re-evaluates interactivity when one chunk closes and opens a new frame', () => {
    const state = createHarness()

    expect(state.controller.observe('\x1b[?2026hfirst', true).latencySensitive).toBe(true)
    state.setNow(1_600)
    const reopened = state.controller.observe('\x1b[?2026l\x1b[?2026hsecond', true)
    const closed = state.controller.observe('tail\x1b[?2026l', true)

    expect(reopened).toMatchObject({
      synchronizedOutput: true,
      latencySensitive: false,
      holdForeground: true,
      coalesceForeground: true
    })
    expect(closed.latencySensitive).toBe(false)
  })

  it('clears synchronized state when output is hidden or protection is disabled', () => {
    const state = createHarness()

    state.controller.observe('\x1b[?2026hframe', true)
    expect(state.controller.observe('hidden chunk', false)).toMatchObject({
      synchronizedOutput: false,
      latencySensitive: false,
      holdForeground: false,
      coalesceForeground: false,
      stripTransientCursorShows: false
    })
    expect(state.controller.observe('tail\x1b[?2026l', true).latencySensitive).toBe(false)

    const unprotected = createHarness(false)
    expect(unprotected.controller.observe('\x1b[?2026hframe\x1b[?2026l', true)).toEqual({
      synchronizedOutput: false,
      latencySensitive: false,
      nativeWindowsCursorRestore: false,
      stripTransientCursorShows: false,
      coalesceForeground: false,
      holdForeground: false
    })
  })

  it('reports cursor restore independently of synchronized-frame membership', () => {
    const state = createHarness()

    expect(state.controller.observe('\x1b[?25l\x1b[13;14H\x1b[?25h', true)).toMatchObject({
      synchronizedOutput: false,
      latencySensitive: false,
      nativeWindowsCursorRestore: true,
      stripTransientCursorShows: true,
      coalesceForeground: false,
      holdForeground: false
    })
  })
})
