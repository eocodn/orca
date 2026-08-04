import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const daemonFragmentFiles = [
  'daemon-health-core.ts',
  'daemon-process-identity.ts',
  'daemon-server-connections.ts',
  'daemon-server-foundation.ts',
  'daemon-server-protocol.ts',
  'daemon-server-shutdown.ts',
  'daemon-lifecycle-adoption-process.ts',
  'daemon-lifecycle-cleanup.ts',
  'daemon-lifecycle-event.ts',
  'daemon-lifecycle-init.ts',
  'daemon-lifecycle-launcher-process.ts',
  'daemon-lifecycle-manager.ts',
  'daemon-lifecycle-process.ts',
  'daemon-lifecycle-restart.ts',
  'daemon-lifecycle-state.ts',
  'daemon-lifecycle-support.ts'
]

describe('daemon fragment strict diagnostics', () => {
  it('has no syntax or unused declaration diagnostics', () => {
    const configPath = resolve('config/tsconfig.node.json')
    let output = ''
    try {
      output = execFileSync(
        'pnpm',
        ['exec', 'tsc', '--noEmit', '--pretty', 'false', '-p', configPath],
        { cwd: resolve('.'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      )
    } catch (error) {
      const commandError = error as { stdout?: string; stderr?: string }
      output = `${commandError.stdout ?? ''}${commandError.stderr ?? ''}`
    }
    const diagnostics = output
      .split(/\r?\n/)
      .filter((line) => daemonFragmentFiles.some((file) => line.includes(`src/main/daemon/${file}`)))
    expect(diagnostics).toEqual([])
  })
})
