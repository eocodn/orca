import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SshRelaySession } from './ssh-relay-session'
import { SSH_RELAY_CONFIGURE_GRACE_TIME_METHOD } from '../../shared/ssh-types'
import { createMockDeps, mockDeploySuccess } from './ssh-relay-session-test-fixtures'

const { acceptOutputDataMock, muxRequestMock, openConsumerSessionMock, pauseAdapterMock } =
  vi.hoisted(() => ({
    acceptOutputDataMock: vi.fn().mockResolvedValue(undefined),
    muxRequestMock: vi.fn(),
    openConsumerSessionMock: vi.fn(),
    pauseAdapterMock: vi.fn()
  }))

vi.mock('./ssh-relay-deploy', () => ({
  deployAndLaunchRelay: vi.fn()
}))

vi.mock('./ssh-pty-consumer-session', () => ({
  SSH_PTY_SOURCE_WINDOW_SU: 256 * 1024,
  openSshPtyConsumerSession: openConsumerSessionMock
}))

vi.mock('../ipc/ssh-pty-output-intake-registry', () => ({
  acceptSshPtyOutputData: acceptOutputDataMock,
  acceptSshPtyOutputExit: vi.fn().mockResolvedValue(undefined),
  allocateSshPtyProviderGeneration: vi.fn(() => 41),
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

vi.mock('./ssh-relay-deploy-helpers', () => ({
  execCommand: vi.fn().mockResolvedValue('')
}))

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
  isSshPtyNotFoundError: (err: unknown) =>
    (err instanceof Error ? err.message : String(err)).includes('not found'),
  isSshPtyIdentityMismatchError: (err: unknown) =>
    (err instanceof Error ? err.message : String(err)).includes('identity mismatch'),
  SshPtyProvider: class MockSshPtyProvider {
    onData = vi.fn().mockReturnValue(() => {})
    onReplay = vi.fn().mockReturnValue(() => {})
    onExit = vi.fn().mockReturnValue(() => {})
    attach = vi.fn().mockResolvedValue(undefined)
    attachForReconnect = vi.fn().mockResolvedValue({})
    setPtyDeliveryPauseAdapter = pauseAdapterMock
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
  getSshPtyProvider: vi.fn().mockReturnValue({
    dispose: vi.fn(),
    attach: vi.fn().mockResolvedValue(undefined),
    attachForReconnect: vi.fn().mockResolvedValue({})
  }),
  getPtyIdsForConnection: vi.fn().mockReturnValue([]),
  clearPtyOwnershipForConnection: vi.fn(),
  clearProviderPtyState: vi.fn(),
  deletePtyOwnership: vi.fn(),
  getPtyIncarnation: vi.fn(() => undefined),
  setPtyOwnership: vi.fn(),
  restorePtyIncarnation: vi.fn(),
  getPendingPtyCleanupIncarnation: vi.fn(() => undefined),
  consumePendingPtyCleanupIfExact: vi.fn(() => false),
  finalizePendingPtyCleanupIfExact: vi.fn(() => false),
  hasPendingPtyCleanupExact: vi.fn(() => false),
  isCurrentPtyExit: vi.fn(() => true)
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

const { deployAndLaunchRelay } = await import('./ssh-relay-deploy')
const { getRemoteHostPlatform } = await import('./ssh-remote-platform')
const { getPtyIdsForConnection, unregisterSshPtyProvider } = await import('../ipc/pty')
const { unregisterSshFilesystemProvider } = await import('../providers/ssh-filesystem-dispatch')
const { unregisterSshGitProvider } = await import('../providers/ssh-git-dispatch')

describe('SshRelaySession host binding races', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    openConsumerSessionMock.mockImplementation(async (_mux, options) => ({
      mode: 'legacy-fallback',
      clientInstanceId: options.clientInstanceId,
      serverBuildId: 'test-relay-build'
    }))
    delete process.env.ORCA_FEATURE_REMOTE_AGENT_HOOKS
    muxRequestMock.mockReset()
    muxRequestMock.mockResolvedValue([])
    mockDeploySuccess()
    vi.mocked(getPtyIdsForConnection).mockReturnValue([])
  })

  it('overlapping reconnects cancel the stale one', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)
    await session.establish(mockConn)

    // Why: make the first reconnect hang so the second one aborts it
    let resolveFirst!: () => void
    vi.mocked(deployAndLaunchRelay).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = () =>
          resolve({
            transport: { write: vi.fn(), onData: vi.fn(), onClose: vi.fn() },
            platform: 'linux-x64' as const
          })
      })
    )
    mockDeploySuccess()

    const firstReconnect = session.reconnect(mockConn)
    const secondReconnect = session.reconnect(mockConn)

    resolveFirst()
    await Promise.all([firstReconnect, secondReconnect])

    expect(session.getState()).toBe('ready')
  })

  it('does not let a stale deploy overwrite the winning host binding', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)
    await session.establish(mockConn)

    const hostA = getRemoteHostPlatform('linux-x64')
    const hostB = getRemoteHostPlatform('win32-x64')
    const deployment = (hostPlatform: typeof hostA) => ({
      transport: { write: vi.fn(), onData: vi.fn(), onClose: vi.fn() },
      platform: hostPlatform.relayPlatform,
      hostPlatform
    })
    let resolveStale!: (result: ReturnType<typeof deployment>) => void
    vi.mocked(deployAndLaunchRelay)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveStale = resolve
        })
      )
      .mockResolvedValueOnce(deployment(hostB))

    const staleReconnect = session.reconnect(mockConn)
    await vi.waitFor(() => expect(deployAndLaunchRelay).toHaveBeenCalledOnce())
    const winningReconnect = session.reconnect(mockConn)
    await winningReconnect
    resolveStale(deployment(hostA))
    await staleReconnect

    expect(session.getHostPlatform()).toEqual(hostB)
  })

  it('does not let a stale reconnect tear down the winning provider after port cleanup', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)
    await session.establish(mockConn)

    let releaseStaleCleanup!: () => void
    const staleCleanup = new Promise<void>((resolve) => {
      releaseStaleCleanup = resolve
    })
    vi.mocked(mockPortForward.removeAllForwards)
      .mockImplementationOnce(() => staleCleanup)
      .mockResolvedValue(undefined)

    const staleReconnect = session.reconnect(mockConn)
    await vi.waitFor(() => expect(mockPortForward.removeAllForwards).toHaveBeenCalledOnce())
    const winningReconnect = session.reconnect(mockConn)
    await winningReconnect
    const winningMux = session.getMux()
    expect(session.getState()).toBe('ready')

    releaseStaleCleanup()
    await staleReconnect

    expect(session.getState()).toBe('ready')
    expect(session.getMux()).toBe(winningMux)
    expect(winningMux?.isDisposed()).toBe(false)
  })

  it('passes grace time to deployAndLaunchRelay', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)

    await session.establish(mockConn, 600)

    expect(deployAndLaunchRelay).toHaveBeenCalledWith(mockConn, undefined, 600, 'target-1')
  })

  it('restores the configured relay grace after establish', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)

    await session.establish(mockConn, 600)

    expect(session.getMux()?.notify).toHaveBeenCalledWith(SSH_RELAY_CONFIGURE_GRACE_TIME_METHOD, {
      graceTimeSeconds: 600
    })
  })

  it('sets relay grace to unlimited before host sleep', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)
    await session.establish(mockConn)
    vi.mocked(session.getMux()!.notify).mockClear()

    session.prepareForHostSleep()

    expect(session.getMux()?.notify).toHaveBeenCalledWith(SSH_RELAY_CONFIGURE_GRACE_TIME_METHOD, {
      graceTimeSeconds: 0
    })
  })

  it('cleans up port forwards on dispose', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)
    await session.establish(mockConn)

    session.dispose()

    expect(mockPortForward.removeAllForwards).toHaveBeenCalledWith('target-1')
  })

  it('cleans up port forwards on reconnect', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)
    await session.establish(mockConn)
    vi.clearAllMocks()
    mockDeploySuccess()

    await session.reconnect(mockConn)

    expect(mockPortForward.removeAllForwards).toHaveBeenCalledWith('target-1')
  })

  it('establish cleans up mux and providers on partial registration failure', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    // Why: simulate registerRelayRoots failing after mux is created but
    // before providers are fully registered.
    mockStore.getRepos = vi.fn().mockImplementation(() => {
      throw new Error('store error during root registration')
    })

    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)

    await expect(session.establish(mockConn)).rejects.toThrow('store error')
    expect(session.getState()).toBe('idle')
    expect(session.getMux()).toBeNull()
    expect(unregisterSshPtyProvider).toHaveBeenCalledWith('target-1', expect.anything())
    expect(unregisterSshFilesystemProvider).toHaveBeenCalledWith('target-1')
    expect(unregisterSshGitProvider).toHaveBeenCalledWith('target-1')
  })

  it('reconnect on idle session is a no-op', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)

    await session.reconnect(mockConn)

    expect(session.getState()).toBe('idle')
    expect(deployAndLaunchRelay).not.toHaveBeenCalled()
  })

  it('reconnect failure still allows retry from onStateChange', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)
    await session.establish(mockConn)

    // Fail the first reconnect
    vi.mocked(deployAndLaunchRelay).mockRejectedValueOnce(new Error('deploy failed'))
    await session.reconnect(mockConn)
    expect(session.getState()).toBe('reconnecting')

    // Retry should work — reconnect accepts 'reconnecting' state
    mockDeploySuccess()
    await session.reconnect(mockConn)
    expect(session.getState()).toBe('ready')
  })
})
