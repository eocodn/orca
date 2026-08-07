import { describe, expect, it } from 'vitest'
import { createPtyConnectionParkMountEvidenceController } from './pty-connection-park-mount-evidence-controller'

describe('createPtyConnectionParkMountEvidenceController', () => {
  it('starts absent when the mount did not follow a park', () => {
    const controller = createPtyConnectionParkMountEvidenceController(false)

    expect(controller.peek()).toBe(false)
    expect(controller.consume()).toBe(false)
  })

  it('peeks without consuming park evidence', () => {
    const controller = createPtyConnectionParkMountEvidenceController(true)

    expect(controller.peek()).toBe(true)
    expect(controller.peek()).toBe(true)
    expect(controller.consume()).toBe(true)
  })

  it('consumes park evidence only once', () => {
    const controller = createPtyConnectionParkMountEvidenceController(true)

    expect(controller.consume()).toBe(true)
    expect(controller.consume()).toBe(false)
    expect(controller.peek()).toBe(false)
  })
})
