import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService, type RuntimePtyController } from './orca-runtime'

describe('OrcaRuntimeService PTY controller seam', () => {
  it('installs and replaces the controller through the public runtime seam', () => {
    const firstGetSize = vi.fn(() => ({ cols: 80, rows: 24 }))
    const firstController: RuntimePtyController = {
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null,
      getSize: firstGetSize
    }
    const replacementGetSize = vi.fn(() => ({ cols: 120, rows: 40 }))
    const replacementController: RuntimePtyController = {
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null,
      getSize: replacementGetSize
    }
    const runtime = new OrcaRuntimeService()

    runtime.setPtyController(firstController)

    expect(runtime.getTerminalSize('pty-1')).toEqual({ cols: 80, rows: 24 })
    expect(firstGetSize).toHaveBeenCalledWith('pty-1')

    runtime.setPtyController(replacementController)

    expect(runtime.getTerminalSize('pty-1')).toEqual({ cols: 120, rows: 40 })
    expect(replacementGetSize).toHaveBeenCalledWith('pty-1')
  })
})
