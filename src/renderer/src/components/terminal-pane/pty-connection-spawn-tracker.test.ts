import { afterEach, describe, expect, it, vi } from 'vitest'
import { pendingSpawnByPaneKey } from './pty-connection-runtime-state'
import { trackPtyConnectionSpawn } from './pty-connection-spawn-tracker'

afterEach(() => {
  pendingSpawnByPaneKey.clear()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

const track = (
  spawnPromise: Promise<string | null>,
  overrides: Partial<Parameters<typeof trackPtyConnectionSpawn>[0]> = {}
) => {
  const settleDirectSshPaneRetryAttempt = vi.fn()
  const armDirectSshPaneRetryTimeout = vi.fn()
  const tracked = trackPtyConnectionSpawn({
    pendingSpawnKey: 'pane-1',
    spawnPromise,
    directSshRetryAttempt: undefined,
    armDirectSshPaneRetryTimeout,
    isDisposed: () => false,
    getPtyId: () => null,
    settleDirectSshPaneRetryAttempt,
    ...overrides
  })
  return { tracked, settleDirectSshPaneRetryAttempt, armDirectSshPaneRetryTimeout }
}

describe('trackPtyConnectionSpawn', () => {
  it('registers the exact tracked promise and removes it after settlement', async () => {
    const source = deferred<string | null>()
    const { tracked, armDirectSshPaneRetryTimeout } = track(source.promise)

    expect(pendingSpawnByPaneKey.get('pane-1')).toBe(tracked)
    expect(armDirectSshPaneRetryTimeout).toHaveBeenCalledWith(tracked, undefined)

    source.resolve('pty-1')
    await tracked
    expect(pendingSpawnByPaneKey.has('pane-1')).toBe(false)
  })

  it('does not let an older promise delete a newer registry owner', async () => {
    const first = deferred<string | null>()
    const second = deferred<string | null>()
    const firstTracked = track(first.promise).tracked
    const secondTracked = track(second.promise).tracked

    first.resolve('pty-old')
    await firstTracked
    expect(pendingSpawnByPaneKey.get('pane-1')).toBe(secondTracked)

    second.resolve('pty-new')
    await secondTracked
  })

  it('settles an exact SSH retry as failed after an empty result remains authoritative', async () => {
    const attempt = {
      attemptId: 'attempt-1',
      authority: { targetId: 'ssh-1', providerEpoch: 1, connectionGeneration: 2 },
      tabGeneration: 3
    }
    const { tracked, settleDirectSshPaneRetryAttempt } = track(Promise.resolve(null), {
      directSshRetryAttempt: attempt
    })

    await tracked
    await Promise.resolve()

    expect(settleDirectSshPaneRetryAttempt).toHaveBeenCalledWith(attempt, 'failed')
  })

  it('does not fail a retry after disposal or another PTY binding wins', async () => {
    const disposed = track(Promise.resolve(null), { isDisposed: () => true })
    await disposed.tracked
    await Promise.resolve()
    expect(disposed.settleDirectSshPaneRetryAttempt).not.toHaveBeenCalled()

    const bound = track(Promise.resolve(null), { getPtyId: () => 'pty-live' })
    await bound.tracked
    await Promise.resolve()
    expect(bound.settleDirectSshPaneRetryAttempt).not.toHaveBeenCalled()
  })
})
