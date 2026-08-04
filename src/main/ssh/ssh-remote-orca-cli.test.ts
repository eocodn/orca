import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/host/app'
  }
}))
vi.mock('../persistence', () => ({
  getCanonicalUserDataPath: () => '/host/user-data'
}))

import type { HostCliPassthroughOptions } from './ssh-remote-cli-host-passthrough'
import { runRemoteOrcaCli } from './ssh-remote-orca-cli'

const LEGACY_FALLBACK_OPTIONS: HostCliPassthroughOptions = {
  execPath: '/host/electron',
  cliEntryPath: '/host/app/out/cli/index.js',
  userDataPath: '/host/user-data',
  entryExists: () => false
}

type FakeChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { end: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }
  kill: ReturnType<typeof vi.fn>
}

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { end: vi.fn(), on: vi.fn() }
  child.kill = vi.fn()
  return child
}

const runtime = { getRuntimeId: () => 'runtime-test' } as never

describe('runRemoteOrcaCli', () => {
  it('routes supported commands through the full host CLI', async () => {
    const child = createFakeChild()
    const spawn = vi.fn(() => child)
    const resultPromise = runRemoteOrcaCli(
      runtime,
      {
        argv: ['worktree', 'create', '--repo', 'orca', '--branch', 'fix/x', '--json'],
        cwd: '/home/alice/repo',
        env: { ORCA_TERMINAL_HANDLE: 'term_ssh' }
      },
      {
        execPath: '/host/electron',
        cliEntryPath: '/host/app/out/cli/index.js',
        userDataPath: '/host/user-data',
        entryExists: () => true,
        spawn: spawn as never
      }
    )

    await Promise.resolve()
    child.stdout.emit('data', Buffer.from('{"ok":true}\n'))
    child.emit('close', 0)

    await expect(resultPromise).resolves.toEqual({
      stdout: '{"ok":true}\n',
      stderr: '',
      exitCode: 0
    })
    expect(spawn).toHaveBeenCalledOnce()
  })

  it('rejects host-interactive commands with a targeted error', async () => {
    const spawn = vi.fn()
    const result = await runRemoteOrcaCli(
      runtime,
      { argv: ['serve'], cwd: '/home/alice', env: {} },
      { ...LEGACY_FALLBACK_OPTIONS, spawn: spawn as never }
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('orca serve')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('rejects interactive account add but bridges account list', async () => {
    const firstSpawn = vi.fn()
    const addResult = await runRemoteOrcaCli(
      runtime,
      { argv: ['account', 'add'], cwd: '/home/alice', env: {} },
      { ...LEGACY_FALLBACK_OPTIONS, spawn: firstSpawn as never }
    )
    expect(addResult.exitCode).toBe(1)
    expect(firstSpawn).not.toHaveBeenCalled()

    const child = createFakeChild()
    const spawn = vi.fn(() => child)
    const listPromise = runRemoteOrcaCli(
      runtime,
      { argv: ['account', 'list'], cwd: '/home/alice', env: {} },
      { ...LEGACY_FALLBACK_OPTIONS, entryExists: () => true, spawn: spawn as never }
    )
    await Promise.resolve()
    child.stdout.emit('data', Buffer.from('Managed Claude accounts\n'))
    child.emit('close', 0)

    await expect(listPromise).resolves.toEqual({
      stdout: 'Managed Claude accounts\n',
      stderr: '',
      exitCode: 0
    })
  })

  it('bridges account add help without starting an interactive login', async () => {
    const child = createFakeChild()
    const spawn = vi.fn(() => child)
    const resultPromise = runRemoteOrcaCli(
      runtime,
      { argv: ['account', 'add', '--help'], cwd: '/home/alice', env: {} },
      { ...LEGACY_FALLBACK_OPTIONS, entryExists: () => true, spawn: spawn as never }
    )
    await Promise.resolve()
    child.stdout.emit('data', Buffer.from('Usage: orca account add\n'))
    child.emit('close', 0)

    await expect(resultPromise).resolves.toEqual({
      stdout: 'Usage: orca account add\n',
      stderr: '',
      exitCode: 0
    })
  })

  it('reports host-interactive command errors as JSON envelopes', async () => {
    const result = await runRemoteOrcaCli(
      runtime,
      { argv: ['serve', '--json'], cwd: '/home/alice', env: {} },
      LEGACY_FALLBACK_OPTIONS
    )

    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: 'unsupported_over_ssh' }
    })
  })

  it('reports the passthrough root cause for unsupported fallback commands', async () => {
    const result = await runRemoteOrcaCli(
      runtime,
      { argv: ['worktree', 'list'], cwd: '/home/alice', env: {} },
      LEGACY_FALLBACK_OPTIONS
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unsupported SSH Orca CLI command: worktree list')
    expect(result.stderr).toContain('full Orca CLI bridge unavailable')
  })
})
