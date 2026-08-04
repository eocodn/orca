import {
  chmod as chmodFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename as renameFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SFTPWrapper } from 'ssh2'
import { afterEach, describe, expect, it } from 'vitest'

import { installRemote } from './codex-hook-remote'

type Callback = (error?: Error | null, value?: unknown) => void

function createLocalSftp(): SFTPWrapper {
  return {
    readFile(path: string, options: unknown, callback: Callback) {
      void readFile(path, typeof options === 'string' ? (options as BufferEncoding) : 'utf8').then(
        (value) => callback(null, value),
        (error) => callback(error)
      )
    },
    writeFile(path: string, data: string, options: unknown, callback: Callback) {
      const mode =
        typeof options === 'object' &&
        options !== null &&
        'mode' in options &&
        typeof options.mode === 'number'
          ? options.mode
          : undefined
      void writeFile(path, data, mode === undefined ? undefined : { mode }).then(
        () => callback(null),
        (error) => callback(error)
      )
    },
    readdir(path: string, callback: Callback) {
      void readdir(path).then(
        (value) => callback(null, value),
        (error) => callback(error)
      )
    },
    mkdir(path: string, callback: Callback) {
      void mkdir(path).then(
        () => callback(null),
        (error) => callback(error)
      )
    },
    stat(path: string, callback: Callback) {
      void stat(path).then(
        (value) => callback(null, value),
        (error) => callback(error)
      )
    },
    rename(oldPath: string, newPath: string, callback: Callback) {
      void renameFile(oldPath, newPath).then(
        () => callback(null),
        (error) => callback(error)
      )
    },
    unlink(path: string, callback: Callback) {
      void rm(path).then(
        () => callback(null),
        (error) => callback(error)
      )
    },
    chmod(path: string, mode: number, callback: Callback) {
      void chmodFile(path, mode).then(
        () => callback(null),
        (error) => callback(error)
      )
    }
  } as unknown as SFTPWrapper
}

describe('remote Codex hook installation', () => {
  let remoteHome: string | undefined

  afterEach(async () => {
    if (remoteHome) {
      await rm(remoteHome, { recursive: true, force: true })
      remoteHome = undefined
    }
  })

  it('places the managed status hook before remote user hooks', async () => {
    remoteHome = await mkdtemp(join(tmpdir(), 'codex-hook-remote-'))
    const codexHome = join(remoteHome, '.codex')
    await mkdir(codexHome, { recursive: true })
    await writeFile(
      join(codexHome, 'hooks.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [{ hooks: [{ type: 'command', command: 'slow-user-post-tool-hook' }] }]
        }
      })
    )
    await writeFile(join(codexHome, 'config.toml'), '')

    const status = await installRemote({}, createLocalSftp(), remoteHome)

    expect(status.state).toBe('installed')
    const config = JSON.parse(await readFile(join(codexHome, 'hooks.json'), 'utf8')) as {
      hooks: Record<string, { hooks?: { command?: string }[] }[]>
    }
    expect(config.hooks.PostToolUse?.[0]?.hooks?.[0]?.command).toContain(
      `${remoteHome}/.orca/agent-hooks/codex-hook.sh`
    )
    expect(config.hooks.PostToolUse?.[1]?.hooks?.[0]?.command).toBe(
      'slow-user-post-tool-hook'
    )
  })
})
