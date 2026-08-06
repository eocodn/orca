import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SshRelaySession } from './ssh-relay-session'
import { createMockDeps, mockDeploySuccess } from './ssh-relay-session-test-fixtures'

const { acceptOutputExitMock, muxRequestMock, ptyStateTokens } = vi.hoisted(() => ({
  acceptOutputExitMock: vi.fn().mockResolvedValue(undefined),
  muxRequestMock: vi.fn(),
  ptyStateTokens: new Map<string, symbol>()
}))

vi.mock('./ssh-relay-deploy', () => ({ deployAndLaunchRelay: vi.fn() }))
vi.mock('./ssh-pty-consumer-session', () => ({
  openSshPtyConsumerSession: vi.fn(async (_mux, options) => ({
    clientInstanceId: options.clientInstanceId,
    clientGeneration: 1,
    ownerGeneration: 1,
    ownerLease: 'test-owner-lease'
  }))
}))
vi.mock('../ipc/ssh-pty-output-intake-registry', () => ({
  acceptSshPtyOutputData: vi.fn().mockResolvedValue(undefined),
  acceptSshPtyOutputExit: acceptOutputExitMock,
  allocateSshPtyProviderGeneration: vi.fn(() => 31),
  beginSshPtyOutputGenerationMigration: vi.fn(() => ({
    byPty: new Map(),
    completion: Promise.resolve()
  })),
  closeSshPtyOutputGeneration: vi.fn(),
  getSshPtyAcceptedSourceCheckpoints: vi.fn(() => []),
  applySshPtySourceCancellationProof: vi.fn(() => true),
  applySshPtySourceRecoveryCancellationProof: vi.fn(() => true),
  installSshPtySourceAckPublisher: vi.fn(() => () => {}),
  installSshPtySourceCancellationPublisher: vi.fn(() => () => {})
}))
vi.mock('./ssh-relay-deploy-helpers', () => ({ execCommand: vi.fn().mockResolvedValue('') }))
vi.mock('./ssh-channel-multiplexer', () => ({
  SshChannelMultiplexer: class MockSshChannelMultiplexer {
    notify = vi.fn()
    notifyWithSettlement = vi.fn()
    request = muxRequestMock
    onNotification = vi.fn().mockReturnValue(() => {})
    onNotificationByMethod = vi.fn().mockReturnValue(() => {})
    onRequest = vi.fn().mockReturnValue(() => {})
    onDispose = vi.fn().mockReturnValue(() => {})
    dispose = vi.fn()
    isDisposed = vi.fn().mockReturnValue(false)
  }
}))
vi.mock('../providers/ssh-pty-provider', () => ({
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
  getSshPtyProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  getPtyIdsForConnection: vi.fn().mockReturnValue([]),
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
  clearPtyOwnershipForConnection: vi.fn(),
  clearProviderPtyState: vi.fn(),
  deletePtyOwnership: vi.fn(),
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
  clearProviderPtyState,
  deletePtyOwnership,
  getPendingPtyCleanupIncarnation,
  finalizePendingPtyCleanupIfExact,
  consumeSshPtyExitFinalization,
  isCurrentPtyExit
} = await import('../ipc/pty')

describe('SSH relay PTY incarnation retirement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ptyStateTokens.clear()
    acceptOutputExitMock.mockResolvedValue(undefined)
    muxRequestMock.mockResolvedValue([])
    mockDeploySuccess()
    vi.mocked(finalizePendingPtyCleanupIfExact).mockReturnValue(false)
    vi.mocked(consumeSshPtyExitFinalization).mockReturnValue(false)
    vi.mocked(isCurrentPtyExit).mockReturnValue(true)
  })

  it('keeps exact cleanup pending when its finalizer throws', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const runtime = { onPtyData: vi.fn(), onPtyExit: vi.fn() }
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      runtime as never
    )
    await session.establish(mockConn)
    const provider = vi.mocked(registerSshPtyProvider).mock.calls[0]?.[1] as unknown as {
      onExit: ReturnType<typeof vi.fn>
    }
    const onExit = provider.onExit.mock.calls[0]?.[0] as (payload: {
      id: string
      code: number
      incarnationId: string
      providerGeneration: number
      ptyIncarnation: string
    }) => void
    const payload = {
      id: 'ssh:target-1@@pty-finalizer-retry',
      code: 0,
      incarnationId: 'finalizer-incarnation',
      providerGeneration: 31,
      ptyIncarnation: 'finalizer-incarnation'
    }
    vi.mocked(getPendingPtyCleanupIncarnation).mockReturnValue(payload.ptyIncarnation)
    vi.mocked(finalizePendingPtyCleanupIfExact)
      .mockImplementationOnce(() => {
        throw new Error('finalizer failed')
      })
      .mockReturnValueOnce(true)
    vi.mocked(isCurrentPtyExit).mockReturnValue(true)

    onExit(payload)
    await vi.waitFor(() => expect(finalizePendingPtyCleanupIfExact).toHaveBeenCalledTimes(2))
  })

  it('keeps provider teardown single when intake finalized before rejecting', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow, mockWindow } = createMockDeps()
    const runtime = { onPtyData: vi.fn(), onPtyExit: vi.fn() }
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      runtime as never
    )
    await session.establish(mockConn)
    const provider = vi.mocked(registerSshPtyProvider).mock.calls[0]?.[1] as unknown as {
      onExit: ReturnType<typeof vi.fn>
    }
    const onExit = provider.onExit.mock.calls[0]?.[0] as (payload: {
      id: string
      code: number
      incarnationId: string
      providerGeneration: number
      ptyIncarnation: string
    }) => void
    vi.mocked(isCurrentPtyExit).mockReturnValue(true)
    vi.mocked(consumeSshPtyExitFinalization).mockReturnValue(true)
    acceptOutputExitMock.mockRejectedValueOnce(new Error('projection close rejected'))

    onExit({
      id: 'ssh:target-1@@pty-finalized',
      code: 0,
      incarnationId: 'finalized-incarnation',
      providerGeneration: 31,
      ptyIncarnation: 'finalized-incarnation'
    })

    await vi.waitFor(() => expect(clearProviderPtyState).toHaveBeenCalledOnce())
    expect(deletePtyOwnership).toHaveBeenCalledOnce()
    expect(mockStore.markSshRemotePtyLease).toHaveBeenCalledOnce()
    expect(runtime.onPtyExit).not.toHaveBeenCalled()
    expect(mockWindow.webContents.send).not.toHaveBeenCalledWith('pty:exit', expect.anything())
  })

  it('retries retirement after a cleanup side effect fails', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const runtime = { onPtyData: vi.fn(), onPtyExit: vi.fn() }
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      runtime as never
    )
    await session.establish(mockConn)
    const provider = vi.mocked(registerSshPtyProvider).mock.calls[0]?.[1] as unknown as {
      onExit: ReturnType<typeof vi.fn>
    }
    const onExit = provider.onExit.mock.calls[0]?.[0] as (payload: {
      id: string
      code: number
      incarnationId: string
      providerGeneration: number
      ptyIncarnation: string
    }) => void
    const payload = {
      id: 'ssh:target-1@@pty-retry-cleanup',
      code: 9,
      incarnationId: 'retry-incarnation',
      providerGeneration: 31,
      ptyIncarnation: 'retry-incarnation'
    }
    vi.mocked(getPendingPtyCleanupIncarnation).mockReturnValue(undefined)
    vi.mocked(isCurrentPtyExit).mockReturnValue(true)
    acceptOutputExitMock.mockRejectedValue(new Error('output barrier rejected'))
    vi.mocked(clearProviderPtyState).mockImplementationOnce(() => {
      throw new Error('transient cleanup failure')
    })

    onExit(payload)
    await vi.waitFor(() => expect(clearProviderPtyState).toHaveBeenCalledTimes(2))
    expect(deletePtyOwnership).toHaveBeenCalledOnce()
    expect(mockStore.markSshRemotePtyLease).toHaveBeenCalledTimes(2)
  })

  it('bounds retirement evidence across distinct PTY ids', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const runtime = { onPtyData: vi.fn(), onPtyExit: vi.fn() }
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      runtime as never
    )
    await session.establish(mockConn)
    const provider = vi.mocked(registerSshPtyProvider).mock.calls[0]?.[1] as unknown as {
      onExit: ReturnType<typeof vi.fn>
    }
    const onExit = provider.onExit.mock.calls[0]?.[0] as (payload: {
      id: string
      code: number
      incarnationId: string
      providerGeneration: number
      ptyIncarnation: string
    }) => void
    const total = 1025
    vi.mocked(getPendingPtyCleanupIncarnation).mockReturnValue(undefined)
    vi.mocked(isCurrentPtyExit).mockReturnValue(true)
    acceptOutputExitMock.mockRejectedValue(new Error('output barrier rejected'))

    for (let index = 0; index < total; index += 1) {
      onExit({
        id: `ssh:target-1@@pty-${index}`,
        code: 0,
        incarnationId: `incarnation-${index}`,
        providerGeneration: 31,
        ptyIncarnation: `incarnation-${index}`
      })
    }

    await vi.waitFor(() => expect(clearProviderPtyState).toHaveBeenCalledTimes(total))
    const retired = (
      session as unknown as {
        retiredPtyExitIncarnations: Map<string, Map<string, number>>
      }
    ).retiredPtyExitIncarnations
    expect(retired.size).toBeLessThan(total)
  })
})
