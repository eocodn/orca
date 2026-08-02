import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type * as NodeCrypto from 'node:crypto'
import { toSshExecutionHostId } from '../../shared/execution-host'
import { SshRelaySession } from './ssh-relay-session'
import { createMockDeps, mockDeploySuccess } from './ssh-relay-session-test-fixtures'

type MockMuxInstance = {
  requestHandlers: Map<string, (params: Record<string, unknown>) => Promise<unknown>>
}

const {
  acceptOutputExitMock,
  muxRequestMock,
  openConsumerSessionMock,
  muxInstancesRaw,
  ptyStateTokens
} = vi.hoisted(() => ({
  acceptOutputExitMock: vi.fn().mockResolvedValue(undefined),
  muxRequestMock: vi.fn(),
  openConsumerSessionMock: vi.fn(
    async (_mux: unknown, options: { clientInstanceId: string; outputFlowControl?: unknown }) => ({
      clientInstanceId: options.clientInstanceId,
      clientGeneration: 1,
      ownerGeneration: 1,
      ownerLease: 'test-owner-lease'
    })
  ),
  muxInstancesRaw: [] as unknown[],
  ptyStateTokens: new Map<string, symbol>()
}))
const muxInstances = muxInstancesRaw as MockMuxInstance[]

vi.mock('./ssh-relay-deploy', () => ({ deployAndLaunchRelay: vi.fn() }))
vi.mock('./ssh-pty-consumer-session', () => ({
  openSshPtyConsumerSession: openConsumerSessionMock
}))
vi.mock('../ipc/ssh-pty-output-intake-registry', () => ({
  acceptSshPtyOutputData: vi.fn().mockResolvedValue(undefined),
  acceptSshPtyOutputExit: acceptOutputExitMock,
  allocateSshPtyProviderGeneration: vi.fn(() => 17),
  beginSshPtyOutputGenerationMigration: vi.fn(() => ({
    byPty: new Map(),
    completion: Promise.resolve()
  })),
  closeSshPtyOutputGeneration: vi.fn(),
  getSshPtyAcceptedSourceCheckpoints: vi.fn(() => []),
  applySshPtySourceRecoveryCancellationProof: vi.fn(() => true),
  installSshPtySourceAckPublisher: vi.fn(() => () => {}),
  installSshPtySourceCancellationPublisher: vi.fn(() => () => {})
}))
vi.mock('./ssh-relay-deploy-helpers', () => ({ execCommand: vi.fn().mockResolvedValue('') }))
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>()
  return { ...actual, randomUUID: vi.fn() }
})
vi.mock('./ssh-remote-orca-cli', () => ({
  runRemoteOrcaCli: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
}))
vi.mock('./ssh-channel-multiplexer', () => ({
  SshChannelMultiplexer: class MockSshChannelMultiplexer {
    requestHandlers = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>()
    notify = vi.fn()
    notifyWithSettlement = vi.fn()
    request = muxRequestMock
    onNotification = vi.fn().mockReturnValue(() => {})
    onNotificationByMethod = vi.fn().mockReturnValue(() => {})
    onRequest = vi.fn(
      (method: string, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
        this.requestHandlers.set(method, handler)
        return () => this.requestHandlers.delete(method)
      }
    )
    onDispose = vi.fn().mockReturnValue(() => {})
    dispose = vi.fn()
    isDisposed = vi.fn().mockReturnValue(false)

    constructor() {
      muxInstancesRaw.push(this)
    }
  }
}))
vi.mock('../agent-hooks/remote-managed-hook-installers', () => ({
  installRemoteManagedAgentHooks: vi.fn()
}))
vi.mock('../providers/ssh-pty-provider', () => ({
  isSshPtyNotFoundError: (error: unknown) => String(error).includes('not found'),
  isSshPtyIdentityMismatchError: (error: unknown) => String(error).includes('identity mismatch'),
  SshPtyProvider: class MockSshPtyProvider {
    onData = vi.fn().mockReturnValue(() => {})
    onReplay = vi.fn().mockReturnValue(() => {})
    onExit = vi.fn().mockReturnValue(() => {})
    attach = vi.fn().mockResolvedValue(undefined)
    attachForReconnect = vi.fn().mockResolvedValue({})
    dispose = vi.fn()
  }
}))
vi.mock('../providers/ssh-filesystem-provider', () => ({
  SshFilesystemProvider: class MockSshFilesystemProvider {
    dispose = vi.fn()
  }
}))
vi.mock('../providers/ssh-git-provider', () => ({
  SshGitProvider: class MockSshGitProvider {}
}))
vi.mock('../ipc/pty', () => ({
  registerSshPtyProvider: vi.fn(),
  unregisterSshPtyProvider: vi.fn(),
  getSshPtyProvider: vi.fn(),
  getPtyIdsForConnection: vi.fn().mockReturnValue([]),
  clearPtyOwnershipForConnection: vi.fn(),
  clearProviderPtyState: vi.fn(),
  deletePtyOwnership: vi.fn(),
  getPtyIncarnation: vi.fn(() => undefined),
  getPtyStateToken: vi.fn((id: string) => ptyStateTokens.get(id)),
  getOrCreatePtyStateToken: vi.fn((id: string) => {
    const current = ptyStateTokens.get(id)
    if (current) {
      return current
    }
    const created = Symbol(id)
    ptyStateTokens.set(id, created)
    return created
  }),
  setPtyOwnership: vi.fn(),
  restorePtyIncarnation: vi.fn(),
  getPendingPtyCleanupIncarnation: vi.fn(() => undefined),
  consumePendingPtyCleanupIfExact: vi.fn(() => false),
  finalizePendingPtyCleanupIfExact: vi.fn(() => false),
  hasPendingPtyCleanupExact: vi.fn(() => false),
  consumeSshPtyExitFinalization: vi.fn(() => false),
  isCurrentPtyExit: vi.fn(() => true),
  answerStartupTerminalColorQueriesForPty: vi.fn((_id: string, data: string) => data)
}))
vi.mock('../providers/ssh-filesystem-dispatch', () => ({
  registerSshFilesystemProvider: vi.fn(),
  unregisterSshFilesystemProvider: vi.fn(),
  getSshFilesystemProvider: vi.fn().mockReturnValue({ dispose: vi.fn() })
}))
vi.mock('../providers/ssh-git-dispatch', () => ({
  registerSshGitProvider: vi.fn(),
  unregisterSshGitProvider: vi.fn()
}))

const {
  registerSshPtyProvider,
  getSshPtyProvider,
  getPtyIdsForConnection,
  clearProviderPtyState,
  deletePtyOwnership,
  getPtyIncarnation,
  setPtyOwnership,
  getPendingPtyCleanupIncarnation,
  consumePendingPtyCleanupIfExact,
  isCurrentPtyExit
} = await import('../ipc/pty')
const APP_PTY_ID = 'ssh:target-1@@pty-live'
const INCARNATION_LEAF_ID = '11111111-1111-4111-8111-111111111111'

function detachedLease() {
  return {
    targetId: 'target-1',
    ptyId: 'pty-live',
    state: 'detached' as const,
    worktreeId: 'worktree-1',
    tabId: 'tab-1',
    leafId: INCARNATION_LEAF_ID
  }
}

function emitExitDuringAttach(payload: {
  id: string
  code: number
  incarnationId?: string
  providerGeneration?: number
  ptyIncarnation?: string
}): void {
  const registeredProvider = vi.mocked(registerSshPtyProvider).mock.calls[0]?.[1] as unknown as {
    onExit: ReturnType<typeof vi.fn>
  }
  const exitHandler = registeredProvider.onExit.mock.calls[0]?.[0] as
    | ((exit: typeof payload) => void)
    | undefined
  queueMicrotask(() =>
    exitHandler?.({
      providerGeneration: 17,
      ptyIncarnation: payload.incarnationId ?? `legacy:${payload.id}`,
      ...payload
    })
  )
}

describe('SshRelaySession queued reconnect exits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ptyStateTokens.clear()
    vi.mocked(getPendingPtyCleanupIncarnation).mockReturnValue(undefined)
    vi.mocked(consumePendingPtyCleanupIfExact).mockReturnValue(false)
    vi.mocked(isCurrentPtyExit).mockReturnValue(true)
    muxInstances.splice(0)
    delete process.env.ORCA_FEATURE_REMOTE_AGENT_HOOKS
    muxRequestMock.mockReset()
    muxRequestMock.mockResolvedValue([])
    vi.mocked(randomUUID).mockReset()
    vi.mocked(randomUUID).mockReturnValue('00000000-0000-4000-8000-000000000001')
    mockDeploySuccess()
    vi.mocked(getPtyIdsForConnection).mockReturnValue([])
  })

  it('consumes a queued exit when canonical identity differs from transport identity', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const canonicalIncarnationId = 'canonical-incarnation'
    const transportIncarnationId = 'transport-incarnation'
    const sourceActivationLease = { commit: vi.fn(), rollback: vi.fn() }
    vi.mocked(getSshPtyProvider).mockReturnValue({
      attachForReconnect: vi.fn().mockImplementation(async () => {
        emitExitDuringAttach({
          id: APP_PTY_ID,
          code: 0,
          incarnationId: canonicalIncarnationId,
          ptyIncarnation: transportIncarnationId
        })
        return { incarnationId: canonicalIncarnationId, sourceActivationLease }
      }),
      dispose: vi.fn()
    } as unknown as ReturnType<typeof getSshPtyProvider>)
    vi.mocked(mockStore.getSshRemotePtyLeases).mockReturnValue([detachedLease()] as ReturnType<
      typeof mockStore.getSshRemotePtyLeases
    >)
    const runtime = {
      acceptPtyIncarnationForExit: vi.fn(),
      onPtyExit: vi.fn(),
      onPtySpawned: vi.fn(),
      registerPty: vi.fn()
    }
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      runtime as never
    )

    await session.establish(mockConn)

    expect(acceptOutputExitMock).toHaveBeenCalledWith({
      id: APP_PTY_ID,
      code: 0,
      providerGeneration: 17,
      ptyIncarnation: transportIncarnationId
    })
    expect(sourceActivationLease.rollback).toHaveBeenCalledOnce()
    expect(sourceActivationLease.commit).not.toHaveBeenCalled()
    expect(setPtyOwnership).not.toHaveBeenCalled()
    expect(mockStore.markSshRemotePtyLease).toHaveBeenCalledWith(
      'target-1',
      'pty-live',
      'terminated'
    )
  })

  it('ignores an older incarnation exit while reconnecting a reused PTY id', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow, mockWindow } = createMockDeps()
    const currentIncarnationId = 'incarnation-current'
    const runtime = {
      acceptPtyIncarnationForExit: vi.fn(),
      onPtyExit: vi.fn(),
      onPtySpawned: vi.fn(),
      registerPty: vi.fn()
    }
    const sourceActivationLease = { commit: vi.fn(), rollback: vi.fn() }
    vi.mocked(getSshPtyProvider).mockReturnValue({
      attachForReconnect: vi.fn().mockImplementation(async () => {
        emitExitDuringAttach({
          id: APP_PTY_ID,
          code: 0,
          incarnationId: 'incarnation-old'
        })
        return { incarnationId: currentIncarnationId, replay: 'live-output', sourceActivationLease }
      }),
      dispose: vi.fn()
    } as unknown as ReturnType<typeof getSshPtyProvider>)
    vi.mocked(mockStore.getSshRemotePtyLeases).mockReturnValue([detachedLease()] as ReturnType<
      typeof mockStore.getSshRemotePtyLeases
    >)
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      runtime as never
    )

    await session.establish(mockConn)

    expect(runtime.onPtyExit).not.toHaveBeenCalled()
    expect(runtime.acceptPtyIncarnationForExit).not.toHaveBeenCalled()
    expect(sourceActivationLease.commit).toHaveBeenCalledOnce()
    expect(sourceActivationLease.rollback).not.toHaveBeenCalled()
    expect(runtime.registerPty).toHaveBeenCalledWith(APP_PTY_ID, 'worktree-1', 'target-1', {
      tabId: 'tab-1',
      leafId: INCARNATION_LEAF_ID,
      incarnationId: currentIncarnationId
    })
    expect(setPtyOwnership).toHaveBeenCalledWith(APP_PTY_ID, 'target-1')
    expect(mockStore.persistPtyBinding).toHaveBeenCalledWith(
      expect.objectContaining({ ptyId: APP_PTY_ID, incarnationId: currentIncarnationId }),
      toSshExecutionHostId('target-1')
    )
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('pty:replay', {
      id: APP_PTY_ID,
      data: 'live-output'
    })
  })

  it('keeps the attached PTY when incarnation backfill persistence fails', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const incarnationId = 'incarnation-reconnect'
    vi.mocked(getSshPtyProvider).mockReturnValue({
      attachForReconnect: vi.fn().mockResolvedValue({ incarnationId }),
      dispose: vi.fn()
    } as unknown as ReturnType<typeof getSshPtyProvider>)
    vi.mocked(mockStore.getSshRemotePtyLeases).mockReturnValue([detachedLease()] as ReturnType<
      typeof mockStore.getSshRemotePtyLeases
    >)
    vi.mocked(mockStore.persistPtyBinding).mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    const runtime = { onPtySpawned: vi.fn(), registerPty: vi.fn() }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      runtime as never
    )

    await expect(session.establish(mockConn)).resolves.toBeUndefined()

    expect(runtime.registerPty).toHaveBeenCalledWith(APP_PTY_ID, 'worktree-1', 'target-1', {
      tabId: 'tab-1',
      leafId: INCARNATION_LEAF_ID,
      incarnationId
    })
    expect(mockStore.markSshRemotePtyLease).toHaveBeenCalledWith('target-1', 'pty-live', 'attached')
    expect(consoleError).toHaveBeenCalledWith(
      '[ssh-relay-session] Failed to persist reconnect incarnation:',
      expect.any(Error)
    )
    consoleError.mockRestore()
  })

  it('queues a replacement exit while exact cleanup is still pending during reattach', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const attachResult = {
      incarnationId: 'replacement-incarnation',
      sourceActivationLease: { commit: vi.fn(), rollback: vi.fn() }
    }
    let resolveAttach!: (result: typeof attachResult) => void
    const attachForReconnect = vi.fn(
      () => new Promise<typeof attachResult>((resolve) => (resolveAttach = resolve))
    )
    vi.mocked(getSshPtyProvider).mockReturnValue({
      attachForReconnect,
      dispose: vi.fn()
    } as unknown as ReturnType<typeof getSshPtyProvider>)
    vi.mocked(mockStore.getSshRemotePtyLeases).mockReturnValue([detachedLease()] as ReturnType<
      typeof mockStore.getSshRemotePtyLeases
    >)
    vi.mocked(getPendingPtyCleanupIncarnation).mockReturnValue('failed-incarnation')
    vi.mocked(isCurrentPtyExit).mockReturnValue(true)
    const runtime = { onPtyExit: vi.fn(), registerPty: vi.fn() }
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      runtime as never
    )

    const establish = session.establish(mockConn)
    await vi.waitFor(() =>
      expect(attachForReconnect).toHaveBeenCalledWith('pty-live', expect.anything())
    )
    emitExitDuringAttach({
      id: APP_PTY_ID,
      code: 0,
      incarnationId: 'replacement-incarnation'
    })
    resolveAttach(attachResult)
    await establish

    expect(acceptOutputExitMock).toHaveBeenCalledWith({
      id: APP_PTY_ID,
      code: 0,
      providerGeneration: 17,
      ptyIncarnation: 'replacement-incarnation'
    })
    expect(runtime.onPtyExit).not.toHaveBeenCalled()
  })

  it('does not retire a same-id SSH replacement after a stale not-found reply', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const runtime = { onPtyExit: vi.fn() }
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      runtime as never
    )
    await session.establish(mockConn)
    vi.clearAllMocks()
    mockDeploySuccess()

    vi.mocked(getSshPtyProvider).mockReturnValue({
      attachForReconnect: vi.fn().mockRejectedValue(new Error('PTY "pty-replaced" not found')),
      dispose: vi.fn()
    } as unknown as ReturnType<typeof getSshPtyProvider>)
    vi.mocked(getPtyIdsForConnection).mockReturnValue(['pty-replaced'])
    vi.mocked(getPtyIncarnation)
      .mockReturnValueOnce('old-incarnation')
      .mockReturnValue('replacement-incarnation')

    await session.reconnect(mockConn)

    expect(clearProviderPtyState).not.toHaveBeenCalled()
    expect(deletePtyOwnership).not.toHaveBeenCalled()
    expect(runtime.onPtyExit).not.toHaveBeenCalled()
  })

  it('does not retire a same-id replacement when the stale not-found reply has no old identity', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const runtime = { onPtyExit: vi.fn() }
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      runtime as never
    )
    await session.establish(mockConn)
    vi.clearAllMocks()
    mockDeploySuccess()

    ptyStateTokens.set('ssh:target-1@@pty-identityless', Symbol('old-state'))
    vi.mocked(getSshPtyProvider).mockReturnValue({
      attachForReconnect: vi.fn().mockImplementation(async () => {
        ptyStateTokens.set('ssh:target-1@@pty-identityless', Symbol('replacement-state'))
        throw new Error('PTY "pty-identityless" not found')
      }),
      dispose: vi.fn()
    } as unknown as ReturnType<typeof getSshPtyProvider>)
    vi.mocked(getPtyIdsForConnection).mockReturnValue(['pty-identityless'])
    vi.mocked(getPtyIncarnation).mockReturnValue(undefined)

    await session.reconnect(mockConn)

    expect(clearProviderPtyState).not.toHaveBeenCalled()
    expect(deletePtyOwnership).not.toHaveBeenCalled()
    expect(runtime.onPtyExit).not.toHaveBeenCalled()
  })
})
