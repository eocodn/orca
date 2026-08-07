import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_DA1_RESPONSE } from './terminal-capability-replies'
import { createPtyConnectionHiddenRendererQueryController } from './pty-connection-hidden-renderer-query-controller'

function createController() {
  const sendImmediateReply = vi.fn()
  const replyOscColorQueries = vi.fn()
  const writeRendererQuery = vi.fn()
  const controller = createPtyConnectionHiddenRendererQueryController({
    sendImmediateReply,
    replyOscColorQueries,
    writeRendererQuery,
    getCursor: () => ({ cursorX: 8, cursorY: 4, cols: 20, rows: 10 })
  })
  return { controller, sendImmediateReply, replyOscColorQueries, writeRendererQuery }
}

describe('createPtyConnectionHiddenRendererQueryController', () => {
  it('keeps a split stateless CSI query hidden and completes it on foreground', () => {
    const { controller, writeRendererQuery } = createController()

    controller.observeHidden('\x1b[')
    const result = controller.takePendingForForeground('cTAIL', { rawLength: 5, seq: 10 })

    expect(writeRendererQuery).toHaveBeenCalledWith('\x1b[c', true)
    expect(result).toEqual({
      statefulQueryData: '',
      remainingData: 'TAIL',
      meta: { rawLength: 4, seq: 10 }
    })
  })

  it('completes a split OSC color query on foreground without replaying it', () => {
    const { controller, replyOscColorQueries, writeRendererQuery } = createController()

    controller.observeHidden('\x1b]10;?')
    const result = controller.takePendingForForeground('\x07tail', { rawLength: 5 })

    expect(replyOscColorQueries).toHaveBeenCalledWith('\x1b]10;?\x07')
    expect(writeRendererQuery).not.toHaveBeenCalled()
    expect(result.remainingData).toBe('tail')
    expect(result.meta?.rawLength).toBe(4)
  })

  it('keeps stateful queries live only while the hidden renderer state is clean', () => {
    const { controller } = createController()

    expect(controller.shouldSkip('\x1b[6n')).toBe(false)
    expect(controller.shouldSkip('plain output')).toBe(true)

    controller.observeHidden('plain output')
    expect(controller.shouldSkip('\x1b[6n')).toBe(true)

    controller.markClean()
    expect(controller.shouldSkip('\x1b[6n')).toBe(false)
  })

  it('salvages OSC, CPR, DA1, and rarer CSI queries from discarded bytes', () => {
    const { controller, replyOscColorQueries, sendImmediateReply, writeRendererQuery } =
      createController()

    controller.salvageDiscarded('\x1b]10;?\x07\x1b[6n\x1b[?25$p\x1b[c')

    expect(replyOscColorQueries).toHaveBeenCalledWith('\x1b]10;?\x07')
    expect(sendImmediateReply).toHaveBeenNthCalledWith(1, '\x1b[5;9R')
    expect(sendImmediateReply).toHaveBeenNthCalledWith(2, DEFAULT_DA1_RESPONSE)
    expect(writeRendererQuery).toHaveBeenCalledWith('\x1b[?25$p', true)
  })

  it('resets pending carry and dirty trust together', () => {
    const { controller, writeRendererQuery } = createController()

    controller.observeHidden('\x1b[')
    controller.reset()
    controller.takePendingForForeground('c')

    expect(writeRendererQuery).not.toHaveBeenCalled()
    expect(controller.shouldSkip('\x1b[6n')).toBe(false)
  })
})
