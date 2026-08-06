import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Parse Linux /proc/<pid>/stat start ticks without assuming command names lack ')'. */
export function parseLinuxStartTicks(statLine: string): string | null {
  const commandEnd = statLine.lastIndexOf(')')
  if (commandEnd < 0) return null
  return statLine.slice(commandEnd + 1).trim().split(/\s+/)[19] ?? null
}

export async function readBootIdentity(): Promise<string | undefined> {
  if (process.platform === 'linux') {
    try {
      const bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim()
      return bootId || undefined
    } catch {
      return undefined
    }
  }
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('sysctl', ['-n', 'kern.bootsessionuuid'], {
        encoding: 'utf8',
        timeout: 1_000
      })
      return stdout.trim() || undefined
    } catch {
      return undefined
    }
  }
  return undefined
}
