import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveRelayGrokHome, withManagedHookInstallFence } from './managed-hook-runtime'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe.runIf(process.platform !== 'win32')('resolveRelayGrokHome', () => {
  it('uses the login-shell GROK_HOME and normalizes trailing separators', async () => {
    vi.stubEnv('SHELL', '/bin/sh')
    vi.stubEnv('GROK_HOME', '/srv/grok///')

    await expect(resolveRelayGrokHome('/home/orca')).resolves.toBe('/srv/grok')
  })

  it('falls back when the login-shell GROK_HOME is not an absolute POSIX path', async () => {
    vi.stubEnv('SHELL', '/bin/sh')
    vi.stubEnv('GROK_HOME', '../relative')

    await expect(resolveRelayGrokHome('/home/orca')).resolves.toBe('/home/orca/.grok')
  })
})

describe.skipIf(process.platform === 'win32')('withManagedHookInstallFence', () => {
  it('serializes concurrent remote installer runs through the shared process fence', async () => {
    const home = await mkdtemp(join(tmpdir(), 'managed-hook-fence-'))
    try {
      let releaseFirst: (() => void) | undefined
      let firstEntered = false
      let secondEntered = false
      const first = withManagedHookInstallFence(
        () =>
          new Promise<void>((resolve) => {
            firstEntered = true
            releaseFirst = resolve
          }),
        { home }
      )

      await vi.waitFor(() => expect(firstEntered).toBe(true))

      const second = withManagedHookInstallFence(
        async () => {
          secondEntered = true
        },
        { home }
      )
      await new Promise((resolve) => setImmediate(resolve))
      expect(secondEntered).toBe(false)

      releaseFirst?.()
      await Promise.all([first, second])
      expect(secondEntered).toBe(true)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
