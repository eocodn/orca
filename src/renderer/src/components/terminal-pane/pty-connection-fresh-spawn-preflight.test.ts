import { describe, expect, it, vi } from 'vitest'
import { runPtyConnectionFreshSpawnPreflight } from './pty-connection-fresh-spawn-preflight'

const run = (
  overrides: Partial<Parameters<typeof runPtyConnectionFreshSpawnPreflight>[0]> = {}
) => {
  const order: string[] = []
  const setPendingStartupCommand = vi.fn()
  const result = runPtyConnectionFreshSpawnPreflight({
    legacyWorkerAutomaticResumeBlocked: false,
    worktreeDeleting: false,
    hasSshConnection: false,
    startupCommand: null,
    clearPaneMode2031State: () => order.push('mode2031'),
    clearHiddenOutputRestoreState: () => order.push('hidden-restore'),
    resetFreshSpawnFollowOutput: () => order.push('follow-output'),
    resetKittyKeyboardModes: () => order.push('kitty'),
    prepareFreshShellViewportForSpawn: () => order.push('viewport'),
    setPendingStartupCommand,
    ...overrides
  })
  return { result, order, setPendingStartupCommand }
}

describe('runPtyConnectionFreshSpawnPreflight', () => {
  it('blocks without side effects when legacy automatic resume is unavailable', () => {
    const state = run({ legacyWorkerAutomaticResumeBlocked: true })

    expect(state.result).toBe(false)
    expect(state.order).toEqual([])
    expect(state.setPendingStartupCommand).not.toHaveBeenCalled()
  })

  it('blocks without side effects while the worktree is being deleted', () => {
    const state = run({ worktreeDeleting: true })

    expect(state.result).toBe(false)
    expect(state.order).toEqual([])
    expect(state.setPendingStartupCommand).not.toHaveBeenCalled()
  })

  it('initializes fresh-shell state in lifecycle order', () => {
    const state = run()

    expect(state.result).toBe(true)
    expect(state.order).toEqual([
      'mode2031',
      'hidden-restore',
      'follow-output',
      'kitty',
      'viewport'
    ])
  })

  it('queues a startup command only for SSH fresh spawns', () => {
    const ssh = run({ hasSshConnection: true, startupCommand: 'codex resume' })
    expect(ssh.setPendingStartupCommand).toHaveBeenCalledWith({ command: 'codex resume' })

    const local = run({ hasSshConnection: false, startupCommand: 'codex resume' })
    expect(local.setPendingStartupCommand).not.toHaveBeenCalled()
  })
})
