import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'

function makeStore(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    getRepos: () => [],
    getSettings: () => ({
      workspaceDir: '/tmp/workspaces',
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      branchPrefix: 'none',
      branchPrefixCustom: ''
    }),
    getGitHubCache: () => undefined,
    ...overrides
  }
}

describe('runtime session control', () => {
  it('fails closed when the Store cannot provide a durable revision', async () => {
    const runtime = new OrcaRuntimeService(makeStore() as never)

    await expect(runtime.getSessionSnapshot()).rejects.toThrow('session_revision_unavailable')
  })

  it('does not flush when durable revision observation is unavailable', async () => {
    const flushOrThrow = vi.fn()
    const runtime = new OrcaRuntimeService(makeStore({ flushOrThrow }) as never)

    await expect(runtime.flushSession()).rejects.toThrow('session_persistence_unavailable')
    expect(flushOrThrow).not.toHaveBeenCalled()
  })

  it('preserves the Store receiver while observing a session revision', async () => {
    const store = {
      ...makeStore(),
      revision: 'revision-bound',
      getStateRevision() {
        return this.revision
      }
    }
    const runtime = new OrcaRuntimeService(store as never)
    runtime.listAllMobileSessionTabs = vi.fn(async () => [])

    await expect(runtime.getSessionSnapshot()).resolves.toMatchObject({
      revision: 'revision-bound',
      snapshots: []
    })
  })

  it('flushes the same stable revision represented by the authoritative sessions', async () => {
    const events: string[] = []
    const flushOrThrow = vi.fn(() => events.push('flush'))
    const getStateRevision = vi.fn(() => {
      events.push('revision')
      return 'revision-2'
    })
    const runtime = new OrcaRuntimeService(makeStore({ flushOrThrow, getStateRevision }) as never)

    const result = await runtime.flushSession()

    expect(result).toMatchObject({
      hostGeneration: runtime.getRuntimeId(),
      revision: 'revision-2',
      snapshots: [],
      flushed: true
    })
    expect(flushOrThrow).toHaveBeenCalledOnce()
    expect(events).toEqual(['revision', 'revision', 'flush', 'revision'])
  })

  it('retries when a session mutation races the authoritative read', async () => {
    let revision = 'revision-1'
    let durableRevision = revision
    let listCalls = 0
    const listAllMobileSessionTabs = vi.fn(async () => {
      listCalls += 1
      if (listCalls === 1) {
        revision = 'revision-2'
      }
      return []
    })
    const runtime = new OrcaRuntimeService(
      makeStore({
        flushOrThrow: vi.fn(() => {
          durableRevision = revision
        }),
        getStateRevision: vi.fn(() => revision)
      }) as never
    )
    runtime.listAllMobileSessionTabs = listAllMobileSessionTabs

    const result = await runtime.flushSession()

    expect(result.revision).toBe('revision-2')
    expect(durableRevision).toBe('revision-2')
    expect(listAllMobileSessionTabs).toHaveBeenCalledTimes(2)
  })

  it('fails after the bounded session snapshot stability retries are exhausted', async () => {
    let revisionRead = 0
    const listAllMobileSessionTabs = vi.fn(async () => [])
    const runtime = new OrcaRuntimeService(
      makeStore({
        getStateRevision: vi.fn(() => `revision-${++revisionRead}`)
      }) as never
    )
    runtime.listAllMobileSessionTabs = listAllMobileSessionTabs

    await expect(runtime.getSessionSnapshot()).rejects.toThrow('session_snapshot_unstable')
    expect(listAllMobileSessionTabs).toHaveBeenCalledTimes(3)
  })

  it('propagates synchronous flush failures without reporting a flushed snapshot', async () => {
    const flushOrThrow = vi.fn(() => {
      throw new Error('disk full')
    })
    const runtime = new OrcaRuntimeService(
      makeStore({
        flushOrThrow,
        getStateRevision: vi.fn(() => 'revision-1')
      }) as never
    )

    await expect(runtime.flushSession()).rejects.toThrow('disk full')
    expect(flushOrThrow).toHaveBeenCalledOnce()
  })

  it('rejects when the authoritative revision changes after the flush boundary', async () => {
    const getStateRevision = vi
      .fn<() => string>()
      .mockReturnValueOnce('revision-1')
      .mockReturnValueOnce('revision-1')
      .mockReturnValueOnce('revision-2')
    const runtime = new OrcaRuntimeService(
      makeStore({ flushOrThrow: vi.fn(), getStateRevision }) as never
    )

    await expect(runtime.flushSession()).rejects.toThrow('session_flush_raced')
    expect(getStateRevision).toHaveBeenCalledTimes(3)
  })
})
