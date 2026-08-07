import { describe, expect, it } from 'vitest'
import { createPtyConnectionMode2031ReplyScanController } from './pty-connection-mode2031-reply-scan-controller'

describe('createPtyConnectionMode2031ReplyScanController', () => {
  it('reports complete subscribe and unsubscribe decisions', () => {
    const controller = createPtyConnectionMode2031ReplyScanController()

    expect(controller.scan('\x1b[?2031h')).toBe('subscribed')
    expect(controller.scan('\x1b[?2031l')).toBe('unsubscribed')
  })

  it('carries a split subscribe across chunk boundaries', () => {
    const controller = createPtyConnectionMode2031ReplyScanController()

    expect(controller.scan('\x1b[?20')).toBeNull()
    expect(controller.scan('31h')).toBe('subscribed')
  })

  it('reset discards a partial sequence from the old stream', () => {
    const controller = createPtyConnectionMode2031ReplyScanController()
    controller.scan('\x1b[?20')

    controller.reset()

    expect(controller.scan('31h')).toBeNull()
  })
})
