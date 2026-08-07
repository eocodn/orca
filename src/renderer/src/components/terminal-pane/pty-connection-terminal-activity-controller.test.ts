import { describe, expect, it } from 'vitest'
import { createPtyConnectionTerminalActivityController } from './pty-connection-terminal-activity-controller'

describe('createPtyConnectionTerminalActivityController', () => {
  it('starts without input or output evidence', () => {
    const controller = createPtyConnectionTerminalActivityController()

    expect(controller.getLastInputAt()).toBe(Number.NEGATIVE_INFINITY)
    expect(controller.hasReceivedOutput()).toBe(false)
  })

  it('records the latest accepted input timestamp', () => {
    const controller = createPtyConnectionTerminalActivityController()

    controller.markInput(100)
    controller.markInput(250)

    expect(controller.getLastInputAt()).toBe(250)
  })

  it('keeps output evidence sticky after the first received output', () => {
    const controller = createPtyConnectionTerminalActivityController()

    controller.markOutput()
    controller.markOutput()

    expect(controller.hasReceivedOutput()).toBe(true)
  })
})
