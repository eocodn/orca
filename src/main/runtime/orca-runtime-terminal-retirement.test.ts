import { describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type {
  RuntimeMobileSessionTerminalTab,
  RuntimeMobileSessionTabsResult,
  RuntimeMobileSessionTabsSnapshot
} from '../../shared/runtime-types'
import type { WorkspaceSessionState } from '../../shared/types'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  type ExecutionHostId
} from '../../shared/execution-host'
import { sanitizeWorkspaceSessionTerminalRetirements } from './mobile-session-terminal-persistence-retirement'
import { OrcaRuntimeService } from './orca-runtime'

const WORKTREE_ID = 'repo::/worktree'
const REPO_ID = 'repo'
// Why: main's hydrateHeadlessMobileSessionTabsFromWorkspaceSession skips
// `${repoId}::…` keys whose repo is missing from getRepos (PR #9343). Tests
// that persist worktree sessions must advertise that repo as live.
const LIVE_REPO = {
  id: REPO_ID,
  path: '/worktree',
  displayName: 'repo',
  badgeColor: 'blue',
  addedAt: 1
} as const

function runtimeStore(
  overrides: {
    getRepos?: () => readonly (typeof LIVE_REPO & { connectionId?: string })[]
    getRepo?: (id: string) => (typeof LIVE_REPO & { connectionId?: string }) | undefined
    getFolderWorkspaces?: () => readonly {
      id: string
      folderPath: string
      connectionId?: string | null
    }[]
    getWorkspaceSession?: (hostId?: ExecutionHostId) => WorkspaceSessionState
    setWorkspaceSession?: (session: WorkspaceSessionState, hostId?: ExecutionHostId) => void
    flushOrThrow?: () => void
  } = {}
): never {
  const getRepos = overrides.getRepos ?? (() => [LIVE_REPO])
  return {
    getRepos,
    getRepo: overrides.getRepo ?? ((id: string) => getRepos().find((repo) => repo.id === id)),
    ...overrides
  } as never
}

function makeSplitSnapshot(
  leftPtyId = 'pty-left',
  rightPtyId = 'pty-right',
  worktree = WORKTREE_ID
): RuntimeMobileSessionTabsSnapshot {
  const parentLayout = {
    root: {
      type: 'split' as const,
      direction: 'vertical' as const,
      first: { type: 'leaf' as const, leafId: 'left' },
      second: { type: 'leaf' as const, leafId: 'right' }
    },
    activeLeafId: 'left',
    expandedLeafId: 'left',
    ptyIdsByLeafId: { left: leftPtyId, right: rightPtyId }
  }
  return {
    worktree,
    publicationEpoch: 'renderer',
    snapshotVersion: 1,
    activeGroupId: 'group',
    activeTabId: 'tab::left',
    activeTabType: 'terminal',
    tabGroups: [{ id: 'group', activeTabId: 'tab', tabOrder: ['tab'] }],
    tabs: [
      {
        type: 'terminal',
        id: 'tab::left',
        parentTabId: 'tab',
        leafId: 'left',
        ptyId: leftPtyId,
        title: 'Left',
        parentLayout,
        isActive: true
      },
      {
        type: 'terminal',
        id: 'tab::right',
        parentTabId: 'tab',
        leafId: 'right',
        ptyId: rightPtyId,
        title: 'Right',
        parentLayout,
        isActive: false
      }
    ]
  }
}

function syncSplit(runtime: OrcaRuntimeService, snapshot = makeSplitSnapshot()): void {
  const findTerminalPtyId = (leafId: string): string | null | undefined =>
    snapshot.tabs.find(
      (tab): tab is RuntimeMobileSessionTerminalTab =>
        tab.type === 'terminal' && tab.leafId === leafId
    )?.ptyId
  const leftPtyId = findTerminalPtyId('left')
  const rightPtyId = findTerminalPtyId('right')
  runtime.syncWindowGraph(1, {
    tabs: [
      {
        tabId: 'tab',
        worktreeId: snapshot.worktree,
        title: 'Terminal',
        activeLeafId: 'left',
        layout:
          snapshot.tabs[0]?.type === 'terminal'
            ? (snapshot.tabs[0].parentLayout?.root ?? null)
            : null
      }
    ],
    leaves: [
      {
        tabId: 'tab',
        worktreeId: snapshot.worktree,
        leafId: 'left',
        paneRuntimeId: 1,
        ptyId: leftPtyId ?? 'pty-left'
      },
      {
        tabId: 'tab',
        worktreeId: snapshot.worktree,
        leafId: 'right',
        paneRuntimeId: 2,
        ptyId: rightPtyId ?? 'pty-right'
      }
    ],
    mobileSessionTabs: [snapshot]
  })
}

function makePersistedSplitSession(worktree = WORKTREE_ID): WorkspaceSessionState {
  return {
    ...getDefaultWorkspaceSession(),
    tabsByWorktree: {
      [worktree]: [
        {
          id: 'tab',
          ptyId: 'pty-left',
          worktreeId: worktree,
          title: 'Terminal',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1
        }
      ]
    },
    terminalLayoutsByTabId: {
      tab: {
        root: {
          type: 'split' as const,
          direction: 'vertical' as const,
          first: { type: 'leaf' as const, leafId: 'left' },
          second: { type: 'leaf' as const, leafId: 'right' }
        },
        activeLeafId: 'left',
        expandedLeafId: null,
        ptyIdsByLeafId: { left: 'pty-left', right: 'pty-right' }
      }
    }
  }
}

describe('OrcaRuntimeService terminal surface retirement', () => {
  it('releases each early-exit fence after its matching registration is rejected', () => {
    const runtime = new OrcaRuntimeService()
    const internals = runtime as unknown as {
      earlyExitedPtyIncarnations: Map<string, string | null>
    }

    for (let index = 0; index < 1_000; index += 1) {
      const ptyId = `pty-early-${index}`
      const incarnationId = `incarnation-${index}`
      runtime.beginPtyRegistration(ptyId, incarnationId)
      runtime.onPtyExit(ptyId, 0, incarnationId)
      expect(() => runtime.assertPtyRegistrationAllowed(ptyId, incarnationId)).toThrow(
        'agent_session_exited_during_start'
      )
      runtime.releaseRejectedPtyRegistrationFence(ptyId, incarnationId)
    }

    expect(internals.earlyExitedPtyIncarnations.size).toBe(0)
  })

  it('does not retain fences for completed surface-less lifecycles', () => {
    const runtime = new OrcaRuntimeService()
    const internals = runtime as unknown as {
      earlyExitedPtyIncarnations: Map<string, string | null>
      pendingPtyRegistrationIncarnations: Map<string, string | null>
    }

    for (let index = 0; index < 1_000; index += 1) {
      runtime.onPtySpawned(`pty-headless-${index}`, `incarnation-${index}`, {
        awaitsRegistration: false
      })
      runtime.onPtyExit(`pty-headless-${index}`, 0, `incarnation-${index}`)
    }

    expect(internals.earlyExitedPtyIncarnations.size).toBe(0)
    expect(internals.pendingPtyRegistrationIncarnations.size).toBe(0)
  })

  it('fences an early-exited replacement even when its pane already exists', () => {
    const runtime = new OrcaRuntimeService()
    runtime.attachWindow(1)
    syncSplit(runtime)
    runtime.registerPty('pty-left', WORKTREE_ID, null, {
      tabId: 'tab',
      leafId: 'left',
      incarnationId: 'incarnation-old'
    })

    runtime.onPtySpawned('pty-left', 'incarnation-replacement')
    runtime.onPtyExit('pty-left', 0, 'incarnation-replacement')

    expect(() =>
      runtime.assertPtyRegistrationAllowed('pty-left', 'incarnation-replacement')
    ).toThrow('agent_session_exited_during_start')
    runtime.releaseRejectedPtyRegistrationFence('pty-left', 'incarnation-replacement')
    const internals = runtime as unknown as {
      earlyExitedPtyIncarnations: Map<string, string | null>
      pendingPtyRegistrationIncarnations: Map<string, string | null>
    }
    expect(internals.earlyExitedPtyIncarnations.size).toBe(0)
    expect(internals.pendingPtyRegistrationIncarnations.size).toBe(0)
  })

  it('retires the exact split leaf and rejects a stale renderer resurrection', async () => {
    const runtime = new OrcaRuntimeService()
    runtime.attachWindow(1)
    const staleSnapshot = makeSplitSnapshot()
    syncSplit(runtime, staleSnapshot)

    runtime.onPtyExit('pty-left', 0, undefined, { authoritativeIdentityLess: true })

    expect(await runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)).toMatchObject({
      activeTabId: 'tab::right',
      tabs: [
        {
          id: 'tab::right',
          status: 'ready',
          terminal: expect.stringMatching(/^term_/),
          isActive: true,
          parentLayout: {
            root: { type: 'leaf', leafId: 'right' },
            activeLeafId: 'right',
            expandedLeafId: null,
            ptyIdsByLeafId: { right: 'pty-right' }
          }
        }
      ]
    })

    syncSplit(runtime, { ...staleSnapshot, snapshotVersion: 2 })

    const afterStaleFrame = await runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)
    expect(afterStaleFrame.tabs.map((tab) => tab.id)).toEqual(['tab::right'])
  })

  it('rejects one stale shared-PTY surface without removing its live sibling', () => {
    const session = makePersistedSplitSession()
    session.tabsByWorktree[WORKTREE_ID]![0]!.ptyId = 'pty-shared'
    session.terminalLayoutsByTabId.tab = {
      root: { type: 'leaf', leafId: 'right' },
      activeLeafId: 'right',
      expandedLeafId: null,
      ptyIdsByLeafId: { right: 'pty-shared' }
    }
    session.terminalPtyIncarnationsByPaneKey = { 'tab:right': 'incarnation-current' }
    session.terminalTopologyRevisionByRepoId = { [REPO_ID]: 1 }
    const runtime = new OrcaRuntimeService(runtimeStore({ getWorkspaceSession: () => session }))
    runtime.attachWindow(1)
    runtime.registerPty('pty-shared', WORKTREE_ID, null, {
      tabId: 'tab',
      leafId: 'right',
      incarnationId: 'incarnation-current'
    })
    const snapshot = makeSplitSnapshot()
    const incoming = {
      ...snapshot,
      tabs: snapshot.tabs.map((tab) =>
        tab.type === 'terminal'
          ? {
              ...tab,
              ptyId: 'pty-shared',
              parentLayout: tab.parentLayout
                ? {
                    ...tab.parentLayout,
                    ptyIdsByLeafId: { left: 'pty-shared', right: 'pty-shared' }
                  }
                : undefined
            }
          : tab
      )
    }
    type IncomingTerminalTab = Extract<(typeof incoming.tabs)[number], { type: 'terminal' }>
    const rightTab = incoming.tabs.find(
      (tab): tab is IncomingTerminalTab => tab.type === 'terminal' && tab.leafId === 'right'
    )!
    const hostSnapshot: RuntimeMobileSessionTabsSnapshot = {
      ...incoming,
      activeTabId: rightTab.id,
      tabs: [
        {
          ...rightTab,
          parentLayout: {
            root: { type: 'leaf', leafId: 'right' },
            activeLeafId: 'right',
            expandedLeafId: null,
            ptyIdsByLeafId: { right: 'pty-shared' }
          }
        }
      ]
    }

    runtime.syncWindowGraph(1, {
      tabs: [
        {
          tabId: 'tab',
          worktreeId: WORKTREE_ID,
          title: 'Terminal',
          activeLeafId: 'right',
          layout: { type: 'leaf', leafId: 'right' }
        }
      ],
      leaves: [
        {
          tabId: 'tab',
          worktreeId: WORKTREE_ID,
          leafId: 'right',
          paneRuntimeId: 2,
          ptyId: 'pty-shared'
        }
      ],
      mobileSessionTabs: [hostSnapshot]
    })
    ;(
      runtime as unknown as {
        mobileSessionTabsByWorktree: Map<string, RuntimeMobileSessionTabsSnapshot>
      }
    ).mobileSessionTabsByWorktree.set(WORKTREE_ID, hostSnapshot)

    runtime.syncWindowGraph(1, {
      tabs: [
        {
          tabId: 'tab',
          worktreeId: WORKTREE_ID,
          title: 'Terminal',
          activeLeafId: 'right',
          layout: incoming.tabs[0]?.type === 'terminal' ? incoming.tabs[0].parentLayout!.root : null
        }
      ],
      leaves: [
        {
          tabId: 'tab',
          worktreeId: WORKTREE_ID,
          leafId: 'left',
          paneRuntimeId: 1,
          ptyId: 'pty-shared'
        },
        {
          tabId: 'tab',
          worktreeId: WORKTREE_ID,
          leafId: 'right',
          paneRuntimeId: 2,
          ptyId: 'pty-shared'
        }
      ],
      mobileSessionTabs: [incoming]
    })

    const internalSnapshot = (
      runtime as unknown as {
        mobileSessionTabsByWorktree: Map<string, RuntimeMobileSessionTabsSnapshot>
      }
    ).mobileSessionTabsByWorktree.get(WORKTREE_ID)
    expect(internalSnapshot?.tabs).toEqual([
      expect.objectContaining({ id: 'tab::right', ptyId: 'pty-shared' })
    ])
  })

  it('honors a legacy persisted tombstone before its first migration write', async () => {
    const session = makePersistedSplitSession()
    session.tabsByWorktree[WORKTREE_ID]![0]!.ptyId = 'pty-right'
    session.terminalLayoutsByTabId.tab = {
      root: { type: 'leaf', leafId: 'right' },
      activeLeafId: 'right',
      expandedLeafId: null,
      ptyIdsByLeafId: { right: 'pty-right' }
    }
    Object.assign(session, {
      terminalSurfaceTombstonesByPaneKey: {
        'tab:left': {
          worktreeId: WORKTREE_ID,
          parentTabId: 'tab',
          leafId: 'left',
          ptyId: 'pty-left',
          incarnationId: 'incarnation-left',
          retiredAt: 42
        }
      }
    })
    const runtime = new OrcaRuntimeService(runtimeStore({ getWorkspaceSession: () => session }))
    runtime.attachWindow(1)
    runtime.registerPty('pty-right', WORKTREE_ID, null, {
      tabId: 'tab',
      leafId: 'right',
      incarnationId: 'incarnation-right'
    })

    syncSplit(runtime)

    const tabs = (await runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)).tabs
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({ type: 'terminal', ptyId: 'pty-right' })
  })

  it('publishes the host-rebased layout after a stale client pane update', async () => {
    let session = makePersistedSplitSession()
    session.tabsByWorktree[WORKTREE_ID]![0]!.ptyId = 'pty-right'
    session.terminalLayoutsByTabId.tab = {
      root: { type: 'leaf', leafId: 'right' },
      activeLeafId: 'right',
      expandedLeafId: null,
      ptyIdsByLeafId: { right: 'pty-right' }
    }
    Object.assign(session, {
      terminalTopologyRevisionByRepoId: { [REPO_ID]: 1 }
    })
    const runtime = new OrcaRuntimeService(
      runtimeStore({
        getWorkspaceSession: () => session,
        setWorkspaceSession: (incoming: WorkspaceSessionState) => {
          session = sanitizeWorkspaceSessionTerminalRetirements(incoming, session)
        }
      })
    )

    await runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)
    await runtime.updateMobileSessionPaneLayout(`id:${WORKTREE_ID}`, {
      tabId: 'tab',
      root: {
        type: 'split',
        direction: 'vertical',
        first: { type: 'leaf', leafId: 'left' },
        second: { type: 'leaf', leafId: 'right' }
      },
      expandedLeafId: null,
      titlesByLeafId: { right: 'Survivor' }
    })

    const tabs = (await runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)).tabs
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({
      type: 'terminal',
      ptyId: 'pty-right',
      parentLayout: {
        root: { type: 'leaf', leafId: 'right' }
      }
    })
  })

  it('retires a permanently exited surface despite a stale sleeping record', async () => {
    const session = {
      ...getDefaultWorkspaceSession(),
      sleepingAgentSessionsByPaneKey: { 'tab:left': {} as never }
    }
    const runtime = new OrcaRuntimeService(
      runtimeStore({
        getWorkspaceSession: () => session,
        setWorkspaceSession: vi.fn(),
        flushOrThrow: vi.fn()
      })
    )
    runtime.attachWindow(1)
    syncSplit(runtime)

    runtime.onPtyExit('pty-left', 0, undefined, { authoritativeIdentityLess: true })

    const result = await runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)
    expect(result.tabs.find((tab) => tab.id === 'tab::left')).toBeUndefined()
    expect(result.tabs.find((tab) => tab.id === 'tab::right')).toMatchObject({
      status: 'ready'
    })
  })

  it('ignores a delayed exit from an older incarnation of a reused PTY id', async () => {
    const setWorkspaceSession = vi.fn()
    const runtime = new OrcaRuntimeService(
      runtimeStore({
        getWorkspaceSession: () => makePersistedSplitSession(),
        setWorkspaceSession
      })
    )
    runtime.attachWindow(1)
    syncSplit(runtime)
    runtime.registerPty('pty-left', WORKTREE_ID, null, {
      tabId: 'tab',
      leafId: 'left',
      incarnationId: 'incarnation-a'
    })
    runtime.registerPty('pty-left', WORKTREE_ID, null, {
      tabId: 'tab',
      leafId: 'left',
      incarnationId: 'incarnation-b'
    })

    runtime.onPtyExit('pty-left', 0, 'incarnation-a')

    expect((await runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)).tabs).toEqual([
      expect.objectContaining({ id: 'tab::left', status: 'ready' }),
      expect.objectContaining({ id: 'tab::right', status: 'ready' })
    ])
    expect(setWorkspaceSession).not.toHaveBeenCalled()
  })

  it('ignores a duplicate exact exit after the lifecycle is disconnected', () => {
    const runtime = new OrcaRuntimeService()
    runtime.registerPty('pty-duplicate-exit', WORKTREE_ID, null, {
      tabId: 'tab',
      leafId: 'left',
      incarnationId: 'incarnation-duplicate'
    })

    runtime.onPtyExit('pty-duplicate-exit', 0, 'incarnation-duplicate')
    const internals = runtime as unknown as {
      ptysById: Map<string, { connected: boolean; lastExitCode: number | null }>
      ptyLifecycleGenerationById: Map<string, number>
    }
    const firstPty = internals.ptysById.get('pty-duplicate-exit')
    const firstGeneration = internals.ptyLifecycleGenerationById.get('pty-duplicate-exit')

    runtime.onPtyExit('pty-duplicate-exit', 0, 'incarnation-duplicate')

    expect(firstPty).toMatchObject({ connected: false, lastExitCode: 0 })
    expect(internals.ptyLifecycleGenerationById.get('pty-duplicate-exit')).toBe(firstGeneration)
  })

  it('retries durable retirement after an exact exit was not persisted', async () => {
    const session = makePersistedSplitSession()
    const flushOrThrow = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('disk unavailable')
      })
      .mockImplementationOnce(() => undefined)
    const runtime = new OrcaRuntimeService(
      runtimeStore({
        getWorkspaceSession: () => session,
        setWorkspaceSession: vi.fn(),
        flushOrThrow
      })
    )
    runtime.attachWindow(1)
    syncSplit(runtime)
    runtime.registerPty('pty-left', WORKTREE_ID, null, {
      tabId: 'tab',
      leafId: 'left',
      incarnationId: 'retry-durable-incarnation'
    })

    runtime.onPtyExit('pty-left', 0, 'retry-durable-incarnation')
    runtime.onPtyExit('pty-left', 0, 'retry-durable-incarnation')

    expect(flushOrThrow).toHaveBeenCalledTimes(2)
    expect((await runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)).tabs).toEqual([
      expect.objectContaining({ id: 'tab::right', status: 'ready' })
    ])
  })

  it('rolls back the mutable session when a durable retirement flush fails', async () => {
    let session = makePersistedSplitSession()
    const originalSession = structuredClone(session)
    const setWorkspaceSession = vi.fn((nextSession: WorkspaceSessionState) => {
      session = nextSession
    })
    const flushOrThrow = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('disk unavailable')
      })
      .mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const runtime = new OrcaRuntimeService(
        runtimeStore({
          getWorkspaceSession: () => session,
          setWorkspaceSession,
          flushOrThrow
        })
      )
      runtime.attachWindow(1)
      syncSplit(runtime)
      runtime.registerPty('pty-left', WORKTREE_ID, null, {
        tabId: 'tab',
        leafId: 'left',
        incarnationId: 'mutable-session-flush'
      })

      runtime.onPtyExit('pty-left', 0, 'mutable-session-flush')

      expect(session.terminalLayoutsByTabId.tab).toMatchObject({
        root: { type: 'split' },
        ptyIdsByLeafId: { left: 'pty-left' }
      })
      await vi.waitFor(() => expect(flushOrThrow).toHaveBeenCalledTimes(2))
      expect(session.terminalLayoutsByTabId.tab).toMatchObject({
        root: { type: 'leaf', leafId: 'right' },
        ptyIdsByLeafId: { right: 'pty-right' }
      })
      expect(setWorkspaceSession).toHaveBeenCalledTimes(3)
      expect(setWorkspaceSession.mock.calls[1]?.[0]).toEqual(originalSession)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('automatically retries durable retirement after a one-shot exact exit', async () => {
    const session = makePersistedSplitSession()
    const flushOrThrow = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('disk unavailable')
      })
      .mockImplementationOnce(() => undefined)
    const runtime = new OrcaRuntimeService(
      runtimeStore({
        getWorkspaceSession: () => session,
        setWorkspaceSession: vi.fn(),
        flushOrThrow
      })
    )
    runtime.attachWindow(1)
    syncSplit(runtime)
    runtime.registerPty('pty-left', WORKTREE_ID, null, {
      tabId: 'tab',
      leafId: 'left',
      incarnationId: 'one-shot-durable-incarnation'
    })

    runtime.onPtyExit('pty-left', 0, 'one-shot-durable-incarnation')

    await vi.waitFor(() => expect(flushOrThrow).toHaveBeenCalledTimes(2))
    expect((await runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)).tabs).toEqual([
      expect.objectContaining({ id: 'tab::right', status: 'ready' })
    ])
  })

  it('treats a reconnect-proven incarnation as a fresh lifecycle', () => {
    const flushOrThrow = vi.fn()
    const runtime = new OrcaRuntimeService(
      runtimeStore({
        getWorkspaceSession: () => makePersistedSplitSession(),
        setWorkspaceSession: vi.fn(),
        flushOrThrow
      })
    )
    runtime.attachWindow(1)
    syncSplit(runtime)
    runtime.registerPty('pty-left', WORKTREE_ID, null, {
      tabId: 'tab',
      leafId: 'left',
      incarnationId: 'incarnation-before-reconnect'
    })

    runtime.onPtyExit('pty-left', -1, 'incarnation-before-reconnect')
    runtime.acceptPtyIncarnationForExit('pty-left', 'incarnation-after-reconnect')
    runtime.onPtyExit('pty-left', 0, 'incarnation-after-reconnect')

    expect(flushOrThrow).toHaveBeenCalledTimes(2)
  })

  it('does not let an old pending durable retirement remove a current replacement', async () => {
    vi.useFakeTimers()
    try {
      const session = makePersistedSplitSession()
      const flushOrThrow = vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('disk unavailable')
        })
        .mockImplementationOnce(() => undefined)
      const runtime = new OrcaRuntimeService(
        runtimeStore({
          getWorkspaceSession: () => session,
          setWorkspaceSession: vi.fn(),
          flushOrThrow
        })
      )
      runtime.attachWindow(1)
      syncSplit(runtime)
      runtime.registerPty('pty-left', WORKTREE_ID, null, {
        tabId: 'tab',
        leafId: 'left',
        incarnationId: 'old-pending-incarnation'
      })

      runtime.onPtyExit('pty-left', 0, 'old-pending-incarnation')
      runtime.acceptPtyIncarnationForExit('pty-left', 'new-current-incarnation')
      runtime.onPtyExit('pty-left', 0, 'old-pending-incarnation')

      expect(flushOrThrow).toHaveBeenCalledOnce()
      await expect(runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)).resolves.toMatchObject({
        tabs: [
          expect.objectContaining({ id: 'tab::left', ptyId: 'pty-left' }),
          expect.objectContaining({ id: 'tab::right', ptyId: 'pty-right' })
        ]
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not let a pending replacement admit an old durable retirement retry', async () => {
    vi.useFakeTimers()
    try {
      const session = makePersistedSplitSession()
      const flushOrThrow = vi.fn().mockImplementationOnce(() => {
        throw new Error('disk unavailable')
      })
      const runtime = new OrcaRuntimeService(
        runtimeStore({
          getWorkspaceSession: () => session,
          setWorkspaceSession: vi.fn(),
          flushOrThrow
        })
      )
      runtime.attachWindow(1)
      syncSplit(runtime)
      runtime.registerPty('pty-left', WORKTREE_ID, null, {
        tabId: 'tab',
        leafId: 'left',
        incarnationId: 'old-pending-incarnation'
      })

      runtime.onPtyExit('pty-left', 0, 'old-pending-incarnation')
      runtime.beginPtyRegistration('pty-left', 'new-pending-incarnation')
      await vi.advanceTimersByTimeAsync(0)

      expect(flushOrThrow).toHaveBeenCalledOnce()
      await expect(runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)).resolves.toMatchObject({
        tabs: [
          expect.objectContaining({ id: 'tab::left', ptyId: 'pty-left' }),
          expect.objectContaining({ id: 'tab::right', ptyId: 'pty-right' })
        ]
      })
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('does not let an admitted headless replacement admit an old durable retirement retry', async () => {
    vi.useFakeTimers()
    try {
      const session = makePersistedSplitSession()
      const flushOrThrow = vi.fn().mockImplementationOnce(() => {
        throw new Error('disk unavailable')
      })
      const runtime = new OrcaRuntimeService(
        runtimeStore({
          getWorkspaceSession: () => session,
          setWorkspaceSession: vi.fn(),
          flushOrThrow
        })
      )
      runtime.attachWindow(1)
      syncSplit(runtime)
      runtime.registerPty('pty-left', WORKTREE_ID, null, {
        tabId: 'tab',
        leafId: 'left',
        incarnationId: 'old-headless-incarnation'
      })

      runtime.onPtyExit('pty-left', 0, 'old-headless-incarnation')
      runtime.beginPtyRegistration('pty-left', 'new-headless-incarnation')
      runtime.admitHeadlessPtyLifecycle('pty-left', 'new-headless-incarnation')
      await vi.advanceTimersByTimeAsync(0)

      expect(flushOrThrow).toHaveBeenCalledOnce()
      await expect(runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)).resolves.toMatchObject({
        tabs: [
          expect.objectContaining({ id: 'tab::left', ptyId: 'pty-left' }),
          expect.objectContaining({ id: 'tab::right', ptyId: 'pty-right' })
        ]
      })
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('retires a current PTY after an authoritative identity-less exit proof', async () => {
    const session = makePersistedSplitSession()
    const setWorkspaceSession = vi.fn()
    const runtime = new OrcaRuntimeService(
      runtimeStore({
        getWorkspaceSession: () => session,
        setWorkspaceSession,
        flushOrThrow: vi.fn()
      })
    )
    runtime.attachWindow(1)
    syncSplit(runtime)
    runtime.registerPty('pty-left', WORKTREE_ID, null, {
      tabId: 'tab',
      leafId: 'left',
      incarnationId: 'current-incarnation'
    })

    runtime.onPtyExit('pty-left', 0, undefined, {
      authoritativeIdentityLess: true,
      expectedIncarnationId: 'current-incarnation'
    })

    expect(setWorkspaceSession).toHaveBeenCalled()
    await expect(runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)).resolves.toMatchObject({
      tabs: [expect.objectContaining({ id: 'tab::right', status: 'ready' })]
    })
  })

  it('does not let an identity-less proof for the old incarnation retire a headless replacement', async () => {
    const session = makePersistedSplitSession()
    const runtime = new OrcaRuntimeService(
      runtimeStore({
        getWorkspaceSession: () => session,
        setWorkspaceSession: vi.fn(),
        flushOrThrow: vi.fn()
      })
    )
    runtime.attachWindow(1)
    syncSplit(runtime)
    runtime.registerPty('pty-left', WORKTREE_ID, null, {
      tabId: 'tab',
      leafId: 'left',
      incarnationId: 'old-incarnation'
    })
    runtime.beginPtyRegistration('pty-left', 'new-incarnation')
    runtime.admitHeadlessPtyLifecycle('pty-left', 'new-incarnation')

    runtime.onPtyExit('pty-left', 0, undefined, {
      authoritativeIdentityLess: true,
      expectedIncarnationId: 'old-incarnation'
    })

    await expect(runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)).resolves.toMatchObject({
      tabs: [
        expect.objectContaining({ id: 'tab::left', ptyId: 'pty-left' }),
        expect.objectContaining({ id: 'tab::right', ptyId: 'pty-right' })
      ]
    })
  })

  it('does not fence a pending replacement from an identity-less exit proven for the old incarnation', () => {
    const runtime = new OrcaRuntimeService()
    runtime.registerPty('pty-identityless-old-proof', WORKTREE_ID, null, {
      tabId: 'tab',
      leafId: 'left',
      incarnationId: 'old-incarnation'
    })
    runtime.beginPtyRegistration('pty-identityless-old-proof', 'new-incarnation')

    runtime.onPtyExit('pty-identityless-old-proof', 0, undefined, {
      authoritativeIdentityLess: true,
      expectedIncarnationId: 'old-incarnation'
    })

    expect(() =>
      runtime.assertPtyRegistrationAllowed('pty-identityless-old-proof', 'new-incarnation')
    ).not.toThrow()
  })

  it('retires an admitted headless replacement instead of rejecting it against the old PTY record', async () => {
    vi.useFakeTimers()
    try {
      const session = makePersistedSplitSession()
      const flushOrThrow = vi.fn().mockImplementationOnce(() => {
        throw new Error('disk unavailable')
      })
      const runtime = new OrcaRuntimeService(
        runtimeStore({
          getWorkspaceSession: () => session,
          setWorkspaceSession: vi.fn(),
          flushOrThrow
        })
      )
      runtime.attachWindow(1)
      syncSplit(runtime)
      runtime.registerPty('pty-left', WORKTREE_ID, null, {
        tabId: 'tab',
        leafId: 'left',
        incarnationId: 'old-incarnation'
      })
      runtime.onPtyExit('pty-left', 0, 'old-incarnation')
      runtime.beginPtyRegistration('pty-left', 'new-incarnation')
      runtime.admitHeadlessPtyLifecycle('pty-left', 'new-incarnation')

      runtime.onPtyExit('pty-left', 0, 'new-incarnation')

      await expect(runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)).resolves.toMatchObject({
        tabs: [expect.objectContaining({ id: 'tab::right', ptyId: 'pty-right' })]
      })
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('persists terminal retirement in the execution host partition of a remote worktree', async () => {
    const remoteRepo = { ...LIVE_REPO, connectionId: 'ssh-target-1' }
    const replacementRepo = { ...LIVE_REPO, connectionId: 'ssh-target-2' }
    const remoteHostId = getRepoExecutionHostId(remoteRepo)
    const replacementHostId = getRepoExecutionHostId(replacementRepo)
    const localHostId = LOCAL_EXECUTION_HOST_ID
    const session = makePersistedSplitSession()
    const localSession = makePersistedSplitSession()
    const sessions = new Map<ExecutionHostId, WorkspaceSessionState>([
      [remoteHostId, session],
      [localHostId, localSession],
      [replacementHostId, makePersistedSplitSession()]
    ])
    let repos = [remoteRepo]
    const setWorkspaceSession = vi.fn((next: WorkspaceSessionState, hostId?: ExecutionHostId) => {
      sessions.set(hostId ?? localHostId, next)
    })
    const runtime = new OrcaRuntimeService(
      runtimeStore({
        getRepos: () => repos,
        getWorkspaceSession: (hostId) => sessions.get(hostId ?? 'local')!,
        setWorkspaceSession,
        flushOrThrow: vi.fn()
      })
    )
    runtime.attachWindow(1)
    syncSplit(runtime)
    runtime.registerPty('pty-left', WORKTREE_ID, 'ssh-target-1', {
      tabId: 'tab',
      leafId: 'left',
      incarnationId: 'remote-incarnation'
    })
    repos = [replacementRepo]

    runtime.onPtyExit('pty-left', 0, 'remote-incarnation')

    expect(setWorkspaceSession).toHaveBeenCalledWith(expect.anything(), remoteHostId)
    expect(setWorkspaceSession).not.toHaveBeenCalledWith(expect.anything(), replacementHostId)
    expect(sessions.get(remoteHostId)?.tabsByWorktree[WORKTREE_ID]?.[0]?.ptyId).toBe('pty-right')
    expect(sessions.get(localHostId)?.tabsByWorktree[WORKTREE_ID]?.[0]?.ptyId).toBe('pty-left')
    expect(sessions.get(replacementHostId)?.tabsByWorktree[WORKTREE_ID]?.[0]?.ptyId).toBe(
      'pty-left'
    )
  })

  it('keeps a deleted folder workspace exit from escaping the runtime boundary', async () => {
    const folderWorktree = 'folder:folder-1'
    const session = makePersistedSplitSession(folderWorktree)
    let folderWorkspacePresent = true
    const runtime = new OrcaRuntimeService(
      runtimeStore({
        getFolderWorkspaces: () =>
          folderWorkspacePresent
            ? [{ id: 'folder-1', folderPath: '/folder-workspace', connectionId: null }]
            : [],
        getWorkspaceSession: () => session,
        setWorkspaceSession: vi.fn(),
        flushOrThrow: vi.fn()
      })
    )
    runtime.attachWindow(1)
    syncSplit(runtime, makeSplitSnapshot('pty-left', 'pty-right', folderWorktree))
    runtime.registerPty('pty-left', folderWorktree, null, {
      tabId: 'tab',
      leafId: 'left',
      incarnationId: 'folder-incarnation'
    })
    folderWorkspacePresent = false

    expect(() => runtime.onPtyExit('pty-left', 0, 'folder-incarnation')).not.toThrow()
    expect(
      (runtime as unknown as { ptysById: Map<string, { connected: boolean }> }).ptysById.get(
        'pty-left'
      )?.connected
    ).toBe(false)
  })

  it('uses the worktree execution host when the PTY record has already disappeared', async () => {
    const remoteRepo = { ...LIVE_REPO, connectionId: 'ssh-target-1' }
    const remoteHostId = getRepoExecutionHostId(remoteRepo)
    const session = makePersistedSplitSession()
    const localSession = makePersistedSplitSession()
    const sessions = new Map<ExecutionHostId, WorkspaceSessionState>([
      [remoteHostId, session],
      [LOCAL_EXECUTION_HOST_ID, localSession]
    ])
    const setWorkspaceSession = vi.fn((next: WorkspaceSessionState, hostId?: ExecutionHostId) => {
      sessions.set(hostId ?? LOCAL_EXECUTION_HOST_ID, next)
    })
    const getWorkspaceSession = vi.fn(
      (hostId?: ExecutionHostId) => sessions.get(hostId ?? LOCAL_EXECUTION_HOST_ID)!
    )
    const runtime = new OrcaRuntimeService(
      runtimeStore({
        getRepos: () => [remoteRepo],
        getRepo: () => remoteRepo,
        getWorkspaceSession,
        setWorkspaceSession,
        flushOrThrow: vi.fn()
      })
    )
    runtime.attachWindow(1)
    syncSplit(runtime)
    setWorkspaceSession.mockClear()

    runtime.onPtyExit('pty-left', 0, 'remote-incarnation')

    expect(setWorkspaceSession).toHaveBeenCalledWith(expect.anything(), remoteHostId)
    expect(setWorkspaceSession).not.toHaveBeenCalledWith(expect.anything(), LOCAL_EXECUTION_HOST_ID)
  })

  it('continues durable retirement after transient failures exceed the initial retry budget', async () => {
    vi.useFakeTimers()
    let allowFlush = false
    const session = makePersistedSplitSession()
    const flushOrThrow = vi.fn(() => {
      if (!allowFlush) {
        throw new Error('disk unavailable')
      }
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const runtime = new OrcaRuntimeService(
        runtimeStore({
          getWorkspaceSession: () => session,
          setWorkspaceSession: vi.fn(),
          flushOrThrow
        })
      )
      runtime.attachWindow(1)
      syncSplit(runtime)
      runtime.registerPty('pty-left', WORKTREE_ID, null, {
        tabId: 'tab',
        leafId: 'left',
        incarnationId: 'retry-budget-incarnation'
      })

      runtime.onPtyExit('pty-left', 0, 'retry-budget-incarnation')
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(200)
      allowFlush = true
      await vi.advanceTimersByTimeAsync(400)

      expect(flushOrThrow).toHaveBeenCalledTimes(5)
      await expect(runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)).resolves.toMatchObject({
        tabs: [expect.objectContaining({ id: 'tab::right' })]
      })
    } finally {
      vi.clearAllTimers()
      errorSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('keeps durable retirement keys distinct when ids contain the separator', () => {
    vi.useFakeTimers()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const ptyIdA = 'collision\u0000left'
      const ptyIdB = 'collision'
      const incarnationIdA = 'right'
      const incarnationIdB = 'left\u0000right'
      const session = makePersistedSplitSession()
      session.tabsByWorktree[WORKTREE_ID]![0]!.ptyId = ptyIdA
      session.terminalLayoutsByTabId.tab.ptyIdsByLeafId = {
        left: ptyIdA,
        right: ptyIdB
      }
      const runtime = new OrcaRuntimeService(
        runtimeStore({
          getWorkspaceSession: () => session,
          setWorkspaceSession: vi.fn(),
          flushOrThrow: vi.fn(() => {
            throw new Error('disk unavailable')
          })
        })
      )
      runtime.attachWindow(1)
      syncSplit(runtime, makeSplitSnapshot(ptyIdA, ptyIdB))
      runtime.registerPty(ptyIdA, WORKTREE_ID, null, {
        tabId: 'tab',
        leafId: 'left',
        incarnationId: incarnationIdA
      })
      runtime.registerPty(ptyIdB, WORKTREE_ID, null, {
        tabId: 'tab',
        leafId: 'right',
        incarnationId: incarnationIdB
      })

      runtime.onPtyExit(ptyIdA, 0, incarnationIdA)
      runtime.onPtyExit(ptyIdB, 0, incarnationIdB)

      const internals = runtime as unknown as {
        pendingPtyDurableRetirements: Map<string, unknown>
      }
      expect(internals.pendingPtyDurableRetirements.size).toBe(2)
    } finally {
      vi.clearAllTimers()
      errorSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('keeps exit-proof attach disconnected until a live lifecycle is admitted', () => {
    const runtime = new OrcaRuntimeService()
    syncSplit(runtime)
    runtime.registerPty('pty-left', WORKTREE_ID, null, {
      tabId: 'tab',
      leafId: 'left',
      incarnationId: 'incarnation-before-exit-proof'
    })
    runtime.onPtyExit('pty-left', 0, 'incarnation-before-exit-proof')

    runtime.acceptPtyIncarnationForExit('pty-left', 'incarnation-after-exit-proof')

    const internals = runtime as unknown as {
      ptysById: Map<string, { connected: boolean; lastExitCode: number | null }>
      leavesByPtyId: Map<string, { connected: boolean; lastExitCode: number | null }[]>
    }
    expect(internals.ptysById.get('pty-left')).toMatchObject({
      connected: false,
      lastExitCode: null
    })
    expect(internals.leavesByPtyId.get('pty-left')).toEqual([
      expect.objectContaining({ connected: false, lastExitCode: 0 })
    ])
  })

  it('retires a durable surface after reconnect proves a newer incarnation', async () => {
    const session = makePersistedSplitSession()
    const setWorkspaceSession = vi.fn()
    const runtime = new OrcaRuntimeService(
      runtimeStore({
        getWorkspaceSession: () => session,
        setWorkspaceSession,
        flushOrThrow: vi.fn()
      })
    )
    runtime.attachWindow(1)
    syncSplit(runtime)
    runtime.registerPty('pty-left', WORKTREE_ID, null, {
      tabId: 'tab',
      leafId: 'left',
      incarnationId: 'incarnation-before-reconnect'
    })

    runtime.acceptPtyIncarnationForExit('pty-left', 'incarnation-after-reconnect')
    runtime.onPtyExit('pty-left', 0, 'incarnation-after-reconnect')

    expect((await runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)).tabs).toEqual([
      expect.objectContaining({ id: 'tab::right', status: 'ready' })
    ])
    expect(setWorkspaceSession).toHaveBeenCalledWith(
      expect.objectContaining({
        terminalLayoutsByTabId: {
          tab: expect.objectContaining({
            root: { type: 'leaf', leafId: 'right' },
            ptyIdsByLeafId: { right: 'pty-right' }
          })
        }
      })
    )
  })

  it('publishes only same-repo retirements individually accepted by persistence', async () => {
    let session = makePersistedSplitSession()
    session.terminalLayoutsByTabId.tab.ptyIdsByLeafId = {
      left: 'pty-shared',
      right: 'pty-shared'
    }
    session.tabsByWorktree[WORKTREE_ID]![0]!.ptyId = 'pty-shared'
    session.terminalPtyIncarnationsByPaneKey = {
      'tab:left': 'incarnation-exiting',
      'tab:right': 'incarnation-newer'
    }
    const setWorkspaceSession = vi.fn((next: WorkspaceSessionState) => {
      session = next
    })
    const runtime = new OrcaRuntimeService(
      runtimeStore({
        getWorkspaceSession: () => session,
        setWorkspaceSession,
        flushOrThrow: vi.fn()
      })
    )
    runtime.attachWindow(1)
    const snapshot = makeSplitSnapshot()
    const sharedSnapshot: RuntimeMobileSessionTabsSnapshot = {
      ...snapshot,
      tabs: snapshot.tabs.map((tab) =>
        tab.type === 'terminal'
          ? {
              ...tab,
              ptyId: 'pty-shared',
              parentLayout: tab.parentLayout
                ? {
                    ...tab.parentLayout,
                    ptyIdsByLeafId: { left: 'pty-shared', right: 'pty-shared' }
                  }
                : undefined
            }
          : tab
      )
    }
    syncSplit(runtime, sharedSnapshot)
    runtime.registerPty('pty-shared', WORKTREE_ID, null, {
      tabId: 'tab',
      leafId: 'left',
      incarnationId: 'incarnation-exiting'
    })
    const published: RuntimeMobileSessionTabsResult[] = []
    const unsubscribe = runtime.onMobileSessionTabsChanged((event) => published.push(event))

    runtime.onPtyExit('pty-shared', 0, 'incarnation-exiting')

    expect(session.terminalLayoutsByTabId.tab).toMatchObject({
      root: { type: 'leaf', leafId: 'right' },
      ptyIdsByLeafId: { right: 'pty-shared' }
    })
    expect(session.terminalPtyIncarnationsByPaneKey).toEqual({
      'tab:right': 'incarnation-newer'
    })
    expect(published.at(-1)?.tabs).toEqual([
      expect.objectContaining({
        ptyId: 'pty-shared',
        parentLayout: expect.objectContaining({ root: { type: 'leaf', leafId: 'right' } })
      })
    ])
    expect((await runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)).tabs).toEqual([
      expect.objectContaining({
        ptyId: 'pty-shared',
        parentLayout: expect.objectContaining({ root: { type: 'leaf', leafId: 'right' } })
      })
    ])
    expect(setWorkspaceSession).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('de-persists an exact surface even when there is no mobile snapshot', () => {
    const session = makePersistedSplitSession()
    const setWorkspaceSession = vi.fn()
    const flushOrThrow = vi.fn()
    const runtime = new OrcaRuntimeService(
      runtimeStore({
        getWorkspaceSession: () => session,
        setWorkspaceSession,
        flushOrThrow
      })
    )
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, {
      tabs: [
        {
          tabId: 'tab',
          worktreeId: WORKTREE_ID,
          title: 'Terminal',
          activeLeafId: 'left',
          layout: { type: 'leaf', leafId: 'left' }
        }
      ],
      leaves: [
        {
          tabId: 'tab',
          worktreeId: WORKTREE_ID,
          leafId: 'left',
          paneRuntimeId: 1,
          ptyId: 'pty-left'
        }
      ]
    })
    runtime.registerPty('pty-left', WORKTREE_ID, null, {
      tabId: 'tab',
      leafId: 'left',
      incarnationId: 'incarnation-a'
    })

    runtime.onPtyExit('pty-left', 0, 'incarnation-a')

    expect(setWorkspaceSession).toHaveBeenCalledWith(
      expect.objectContaining({
        terminalLayoutsByTabId: {
          tab: expect.objectContaining({
            root: { type: 'leaf', leafId: 'right' },
            ptyIdsByLeafId: { right: 'pty-right' }
          })
        },
        terminalSurfaceTombstonesByPaneKey: {},
        terminalTopologyRevisionByRepoId: { [REPO_ID]: 1 }
      })
    )
    expect(flushOrThrow).toHaveBeenCalledOnce()
  })

  it('does not publish absence when the durable retirement flush fails', async () => {
    const session = makePersistedSplitSession()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const runtime = new OrcaRuntimeService(
      runtimeStore({
        getWorkspaceSession: () => session,
        setWorkspaceSession: vi.fn(),
        flushOrThrow: vi.fn(() => {
          throw new Error('disk unavailable')
        })
      })
    )
    runtime.attachWindow(1)
    syncSplit(runtime)
    runtime.registerPty('pty-left', WORKTREE_ID, null, {
      tabId: 'tab',
      leafId: 'left',
      incarnationId: 'incarnation-a'
    })
    const events: unknown[] = []
    const unsubscribe = runtime.onMobileSessionTabsChanged((event) => events.push(event))

    runtime.onPtyExit('pty-left', 0, 'incarnation-a')

    expect((await runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)).tabs).toEqual([
      expect.objectContaining({ id: 'tab::left' }),
      expect.objectContaining({ id: 'tab::right' })
    ])
    expect(events).toEqual([])
    expect(errorSpy).toHaveBeenCalledWith(
      '[runtime] failed to persist terminal retirement:',
      expect.any(Error)
    )
    unsubscribe()
    errorSpy.mockRestore()
  })
})
