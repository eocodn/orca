import { describe, expect, it, vi } from 'vitest'
import { runPtyConnectionFreshOrColdRestore } from './pty-connection-fresh-or-cold-restore'

describe('runPtyConnectionFreshOrColdRestore', () => {
  it('uses a prepared cold-restore startup when available', () => {
    const startup = { command: 'resume' } as never
    const startFreshColdRestore = vi.fn()
    const startFreshSpawn = vi.fn()

    expect(
      runPtyConnectionFreshOrColdRestore({
        coldRestoreStartup: startup,
        hasSleepingAgentSession: false,
        startFreshColdRestore,
        startFreshSpawn
      })
    ).toBe('cold-restore')
    expect(startFreshColdRestore).toHaveBeenCalledWith(startup)
    expect(startFreshSpawn).not.toHaveBeenCalled()
  })

  it('starts an unprepared cold restore for a sleeping agent session', () => {
    const startFreshColdRestore = vi.fn()

    expect(
      runPtyConnectionFreshOrColdRestore({
        coldRestoreStartup: null,
        hasSleepingAgentSession: true,
        startFreshColdRestore,
        startFreshSpawn: vi.fn()
      })
    ).toBe('cold-restore')
    expect(startFreshColdRestore).toHaveBeenCalledWith(undefined)
  })

  it('fresh-spawns when no cold-restore evidence exists', () => {
    const startFreshSpawn = vi.fn()

    expect(
      runPtyConnectionFreshOrColdRestore({
        coldRestoreStartup: null,
        hasSleepingAgentSession: false,
        startFreshColdRestore: vi.fn(),
        startFreshSpawn
      })
    ).toBe('fresh-spawn')
    expect(startFreshSpawn).toHaveBeenCalledOnce()
  })
})
