import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe,expect,it } from 'vitest'

const ipcDir = import.meta.dirname

function readIpcSource(fileName: string): string {
  return readFileSync(join(ipcDir, fileName), 'utf8')
}

describe('IPC split API boundaries', () => {
  it('keeps the worktree registration compatibility entrypoint', () => {
    expect(readIpcSource('worktrees.ts')).toContain(
      "export { registerWorktreeHandlers } from './worktree-ipc-registration-implementation'"
    )
    expect(readIpcSource('worktree-ipc-registration-implementation.ts')).toContain(
      'export function registerWorktreeHandlers('
    )
  })

  it('does not retain split-corruption export tokens', () => {
    const sourceFiles = [
      'filesystem-watcher-ipc.ts',
      'repo-ipc-add.ts',
      'ssh-ipc-connection-registration-logic.ts',
      'worktree-ipc-events.ts',
      'worktree-remote-base.ts'
    ]
    for (const fileName of sourceFiles) {
      const corruptionPattern = new RegExp(`async${'export'}|async${'function'}`)
      expect(readIpcSource(fileName)).not.toMatch(corruptionPattern)
    }
  })

  it('routes renderer exit restore markers through the delivery state', () => {
    const source = readIpcSource('pty-ipc-runtime-renderer-exit-handling.ts')
    expect(source).not.toMatch(/\n\s+sendModelRestoreNeededMarker\(/)
    expect(source.match(/state\.sendModelRestoreNeededMarker\(/g)).toHaveLength(4)
  })
})
