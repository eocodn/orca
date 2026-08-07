import { describe, expect, it } from 'vitest'
import { createPtyConnectionPanePtyBindingController } from './pty-connection-pane-pty-binding-controller'

function createHarness() {
  let now = 1_000
  let visible = true
  const calls: string[] = []
  const controller = createPtyConnectionPanePtyBindingController({
    now: () => now,
    isVisible: () => visible,
    setFitBinding: (ptyId) => calls.push(`fit:${ptyId}`),
    clearFitBinding: () => calls.push('fit:clear'),
    reportVisibility: (ptyId, nextVisible) => calls.push(`visible:${ptyId}:${nextVisible}`)
  })

  return {
    controller,
    calls,
    setNow(value: number) {
      now = value
    },
    setVisible(value: boolean) {
      visible = value
    }
  }
}

describe('createPtyConnectionPanePtyBindingController', () => {
  it('starts without an active binding', () => {
    const state = createHarness()
    expect(state.controller.getPtyId()).toBeNull()
    expect(state.controller.getBoundAt()).toBeNull()
  })

  it('binds fit and visibility before recording the current timestamp', () => {
    const state = createHarness()
    state.setNow(1_234)

    state.controller.bind('pty-1')

    expect(state.calls).toEqual(['fit:pty-1', 'visible:pty-1:true'])
    expect(state.controller.getPtyId()).toBe('pty-1')
    expect(state.controller.getBoundAt()).toBe(1_234)
  })

  it('rebinds the same PTY without hiding it first', () => {
    const state = createHarness()
    state.controller.bind('pty-1')
    state.calls.length = 0
    state.setNow(2_000)
    state.setVisible(false)

    state.controller.bind('pty-1')

    expect(state.calls).toEqual(['fit:pty-1', 'visible:pty-1:false'])
    expect(state.controller.getBoundAt()).toBe(2_000)
  })

  it('hides a replaced PTY before fitting and showing the replacement', () => {
    const state = createHarness()
    state.controller.bind('pty-1')
    state.calls.length = 0

    state.controller.bind('pty-2')

    expect(state.calls).toEqual(['visible:pty-1:false', 'fit:pty-2', 'visible:pty-2:true'])
    expect(state.controller.getPtyId()).toBe('pty-2')
  })

  it('clears fit state and active identity together', () => {
    const state = createHarness()
    state.controller.bind('pty-1')
    state.calls.length = 0

    state.controller.clear()

    expect(state.calls).toEqual(['fit:clear'])
    expect(state.controller.getPtyId()).toBeNull()
    expect(state.controller.getBoundAt()).toBeNull()
  })
})
