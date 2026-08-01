import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SshRelaySession } from './ssh-relay-session'
import { createMockDeps, mockDeploySuccess } from './ssh-relay-session-test-fixtures'

const { acceptOutputExitMock, muxRequestMock } = vi.hoisted(() => ({
  acceptOutputExitMock: vi.fn().mockResolvedValue(undefined),
  muxRequestMock: vi.fn()
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
vi.mock('../agent-hooks/remote-managed-hook-installers', () => ({
  installRemoteManagedAgentHooks: vi.fn().mockResolvedValue([])
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
  consumePendingPtyCleanupIfExact,
  finalizePendingPtyCleanupIfExact,
  consumeSshPtyExitFinalization,
  isCurrentPtyExit
} = await import('../ipc/pty')

describe('SSH relay PTY incarnation exits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    acceptOutputExitMock.mockResolvedValue(undefined)
    muxRequestMock.mockResolvedValue([])
    mockDeploySuccess()
    vi.mocked(finalizePendingPtyCleanupIfExact).mockReturnValue(false)
    vi.mocked(consumeSshPtyExitFinalization).mockReturnValue(false)
    vi.mocked(isCurrentPtyExit).mockReturnValue(true)
  })

  it('drops a stale exit before ownership cleanup and propagates a current incarnation', async () => {
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
    vi.mocked(isCurrentPtyExit).mockReturnValueOnce(false)

    onExit({
      id: 'ssh:target-1@@pty-reused',
      code: 0,
      incarnationId: 'old-incarnation',
      providerGeneration: 31,
      ptyIncarnation: 'old-incarnation'
    })

    expect(clearProviderPtyState).not.toHaveBeenCalled()
    expect(deletePtyOwnership).not.toHaveBeenCalled()
    expect(mockStore.markSshRemotePtyLease).not.toHaveBeenCalled()
    expect(acceptOutputExitMock).not.toHaveBeenCalled()
    expect(runtime.onPtyExit).not.toHaveBeenCalled()
    expect(mockWindow.webContents.send).not.toHaveBeenCalledWith('pty:exit', expect.anything())

    onExit({
      id: 'ssh:target-1@@pty-reused',
      code: 7,
      incarnationId: 'current-incarnation',
      providerGeneration: 31,
      ptyIncarnation: 'current-incarnation'
    })
    await vi.waitFor(() =>
      expect(acceptOutputExitMock).toHaveBeenCalledWith({
        id: 'ssh:target-1@@pty-reused',
        code: 7,
        providerGeneration: 31,
        ptyIncarnation: 'current-incarnation'
      })
    )
    expect(runtime.onPtyExit).not.toHaveBeenCalled()
  })

  it('blocks an SSH exit without incarnation proof while failed-spawn cleanup is pending', async () => {
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
      providerGeneration: number
      ptyIncarnation: string
    }) => void
    vi.mocked(getPendingPtyCleanupIncarnation).mockReturnValue('failed-incarnation')
    vi.mocked(isCurrentPtyExit).mockReturnValue(true)

    onExit({
      id: 'ssh:target-1@@pty-reused',
      code: 0,
      providerGeneration: 31,
      ptyIncarnation: 'failed-incarnation'
    })

    await Promise.resolve()
    expect(acceptOutputExitMock).not.toHaveBeenCalled()
    expect(clearProviderPtyState).not.toHaveBeenCalled()
    expect(deletePtyOwnership).not.toHaveBeenCalled()
    expect(runtime.onPtyExit).not.toHaveBeenCalled()
    expect(mockWindow.webContents.send).not.toHaveBeenCalledWith('pty:exit', expect.anything())
  })

  it('rejects a non-exact SSH exit while cleanup identity is pending without reattach state', async () => {
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
    vi.mocked(getPendingPtyCleanupIncarnation).mockReturnValue('failed-incarnation')
    vi.mocked(isCurrentPtyExit).mockReturnValue(false)

    onExit({
      id: 'ssh:target-1@@pty-reused',
      code: 0,
      incarnationId: 'other-incarnation',
      providerGeneration: 31,
      ptyIncarnation: 'other-incarnation'
    })

    await Promise.resolve()
    expect(acceptOutputExitMock).not.toHaveBeenCalled()
    expect(clearProviderPtyState).not.toHaveBeenCalled()
    expect(deletePtyOwnership).not.toHaveBeenCalled()
    expect(runtime.onPtyExit).not.toHaveBeenCalled()
    expect(mockWindow.webContents.send).not.toHaveBeenCalledWith('pty:exit', expect.anything())
  })

  it('accepts a current replacement exit while an older cleanup identity is pending', async () => {
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
    vi.mocked(getPendingPtyCleanupIncarnation).mockReturnValue('failed-incarnation')
    vi.mocked(isCurrentPtyExit).mockReturnValue(true)

    onExit({
      id: 'ssh:target-1@@pty-reused',
      code: 7,
      incarnationId: 'current-incarnation',
      providerGeneration: 31,
      ptyIncarnation: 'current-incarnation'
    })

    await vi.waitFor(() =>
      expect(acceptOutputExitMock).toHaveBeenCalledWith({
        id: 'ssh:target-1@@pty-reused',
        code: 7,
        providerGeneration: 31,
        ptyIncarnation: 'current-incarnation'
      })
    )
  })

  it('retires a physical exit when the output barrier rejects before cleanup is pending', async () => {
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
    vi.mocked(getPendingPtyCleanupIncarnation).mockReturnValue(undefined)
    vi.mocked(isCurrentPtyExit).mockReturnValue(true)
    acceptOutputExitMock.mockRejectedValueOnce(new Error('output barrier rejected'))

    onExit({
      id: 'ssh:target-1@@pty-reused',
      code: 9,
      incarnationId: 'current-incarnation',
      providerGeneration: 31,
      ptyIncarnation: 'current-incarnation'
    })

    await vi.waitFor(() =>
      expect(runtime.onPtyExit).toHaveBeenCalledWith(
        'ssh:target-1@@pty-reused',
        9,
        'current-incarnation'
      )
    )
    expect(clearProviderPtyState).toHaveBeenCalledWith('ssh:target-1@@pty-reused')
    expect(deletePtyOwnership).toHaveBeenCalledWith('ssh:target-1@@pty-reused')
    expect(mockStore.markSshRemotePtyLease).toHaveBeenCalledWith(
      'target-1',
      'pty-reused',
      'terminated'
    )
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('pty:exit', expect.anything())
  })

  it('accepts the exact cleanup exit even when the replacement incarnation is current', async () => {
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
    vi.mocked(getPendingPtyCleanupIncarnation).mockReturnValue('failed-incarnation')
    vi.mocked(consumePendingPtyCleanupIfExact).mockReturnValue(true)
    vi.mocked(isCurrentPtyExit).mockReturnValue(false)

    onExit({
      id: 'ssh:target-1@@pty-reused',
      code: 0,
      incarnationId: 'failed-incarnation',
      providerGeneration: 31,
      ptyIncarnation: 'failed-incarnation'
    })

    await vi.waitFor(() =>
      expect(acceptOutputExitMock).toHaveBeenCalledWith({
        id: 'ssh:target-1@@pty-reused',
        code: 0,
        providerGeneration: 31,
        ptyIncarnation: 'failed-incarnation'
      })
    )
    expect(consumePendingPtyCleanupIfExact).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ssh:target-1@@pty-reused',
        incarnationId: 'failed-incarnation'
      })
    )
    expect(clearProviderPtyState).not.toHaveBeenCalled()
    expect(deletePtyOwnership).not.toHaveBeenCalled()
    expect(mockStore.markSshRemotePtyLease).not.toHaveBeenCalled()
    expect(runtime.onPtyExit).not.toHaveBeenCalled()
    expect(mockWindow.webContents.send).not.toHaveBeenCalledWith('pty:exit', expect.anything())
  })

  it('consumes exact cleanup after the output barrier rejects', async () => {
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
    vi.mocked(getPendingPtyCleanupIncarnation).mockReturnValue('failed-incarnation')
    vi.mocked(consumePendingPtyCleanupIfExact).mockReturnValue(true)
    vi.mocked(finalizePendingPtyCleanupIfExact).mockReturnValue(true)
    vi.mocked(isCurrentPtyExit).mockReturnValue(true)
    acceptOutputExitMock.mockRejectedValueOnce(new Error('ssh_exit_delivery_canceled'))

    onExit({
      id: 'ssh:target-1@@pty-reused',
      code: 0,
      incarnationId: 'failed-incarnation',
      providerGeneration: 31,
      ptyIncarnation: 'failed-incarnation'
    })

    await vi.waitFor(() =>
      expect(acceptOutputExitMock).toHaveBeenCalledWith({
        id: 'ssh:target-1@@pty-reused',
        code: 0,
        providerGeneration: 31,
        ptyIncarnation: 'failed-incarnation'
      })
    )
    expect(finalizePendingPtyCleanupIfExact).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ssh:target-1@@pty-reused',
        incarnationId: 'failed-incarnation'
      })
    )
    expect(clearProviderPtyState).toHaveBeenCalledWith('ssh:target-1@@pty-reused')
    expect(deletePtyOwnership).toHaveBeenCalledWith('ssh:target-1@@pty-reused')
    expect(mockStore.markSshRemotePtyLease).toHaveBeenCalledWith(
      'target-1',
      'pty-reused',
      'terminated'
    )
    expect(runtime.onPtyExit).not.toHaveBeenCalled()
    expect(mockWindow.webContents.send).not.toHaveBeenCalledWith('pty:exit', expect.anything())
  })

  it('retires a barrier-rejected duplicate exit only once', async () => {
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
    const payload = {
      id: 'ssh:target-1@@pty-reused',
      code: 9,
      incarnationId: 'current-incarnation',
      providerGeneration: 31,
      ptyIncarnation: 'current-incarnation'
    }
    vi.mocked(getPendingPtyCleanupIncarnation).mockReturnValue(undefined)
    vi.mocked(isCurrentPtyExit).mockReturnValue(true)
    acceptOutputExitMock.mockRejectedValue(new Error('output barrier rejected'))

    onExit(payload)
    onExit(payload)

    await vi.waitFor(() => expect(runtime.onPtyExit).toHaveBeenCalledOnce())
    expect(clearProviderPtyState).toHaveBeenCalledOnce()
    expect(deletePtyOwnership).toHaveBeenCalledOnce()
    expect(mockStore.markSshRemotePtyLease).toHaveBeenCalledOnce()
    expect(mockWindow.webContents.send).toHaveBeenCalledOnce()
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
})
