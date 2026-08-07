import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionFreshSpawnFollowController } from './pty-connection-fresh-spawn-follow-controller'

function createHarness() {
  let renderListener: (() => void) | null = null
  let resizeListener: (() => void) | null = null
  const renderDispose = vi.fn()
  const resizeDispose = vi.fn()
  const markFollowOutput = vi.fn()
  const scrollToBottom = vi.fn()
  const controller = createPtyConnectionFreshSpawnFollowController({
    isDisposed: () => false,
    markFollowOutput,
    getScrollIntentKind: () => 'followOutput',
    deferGeometryMutation: () => false,
    scrollToBottom,
    subscribeRender(listener) {
      renderListener = listener
      return { dispose: renderDispose }
    },
    subscribeResize(listener) {
      resizeListener = listener
      return { dispose: resizeDispose }
    }
  })
  return {
    controller,
    markFollowOutput,
    renderDispose,
    resizeDispose,
    scrollToBottom,
    runRender() {
      renderListener?.()
    },
    runResize() {
      resizeListener?.()
    }
  }
}

describe('createPtyConnectionFreshSpawnFollowController', () => {
  it('resets follow output immediately without retaining listeners when native scroll succeeds', () => {
    const state = createHarness()

    state.controller.reset()

    expect(state.markFollowOutput).toHaveBeenCalledOnce()
    expect(state.scrollToBottom).toHaveBeenCalledOnce()
    expect(state.renderDispose).not.toHaveBeenCalled()
    expect(state.resizeDispose).not.toHaveBeenCalled()
  })

  it('retries a detached dimensions failure on render and disposes both listeners after success', () => {
    const state = createHarness()
    state.scrollToBottom.mockImplementationOnce(() => {
      throw new TypeError('Cannot read dimensions')
    })

    state.controller.reset()
    state.runRender()

    expect(state.scrollToBottom).toHaveBeenCalledTimes(2)
    expect(state.renderDispose).toHaveBeenCalledOnce()
    expect(state.resizeDispose).toHaveBeenCalledOnce()
  })

  it('cancels the earlier retry listeners before a repeated reset', () => {
    const state = createHarness()
    state.scrollToBottom.mockImplementationOnce(() => {
      throw new TypeError('missing dimensions')
    })

    state.controller.reset()
    state.controller.reset()

    expect(state.renderDispose).toHaveBeenCalledOnce()
    expect(state.resizeDispose).toHaveBeenCalledOnce()
    expect(state.scrollToBottom).toHaveBeenCalledTimes(2)
  })

  it('cleans up and rethrows a non-dimensions failure', () => {
    const state = createHarness()
    state.scrollToBottom.mockImplementation(() => {
      throw new Error('renderer failed')
    })

    expect(() => state.controller.reset()).toThrow('renderer failed')
    expect(state.renderDispose).not.toHaveBeenCalled()
    expect(state.resizeDispose).not.toHaveBeenCalled()
  })
})
