import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SshRelaySession } from './ssh-relay-session'
import { createMockDeps, mockDeploySuccess } from './ssh-relay-session-test-fixtures'

const {
  acceptOutputDataMock,
  acceptOutputExitMock,
  muxRequestMock,
  onNotificationByMethodMock,
  openConsumerSessionMock,
  muxDisposeMock,
  ptyProviderDisposeMock,
  sourceAckCleanupMock,
  sourceCancellationCleanupMock,
  attachForReconnectMock,
  ptyDataHandlerRef,
  ptyExitHandlerRef,
  ptyStateTokens
} = vi.hoisted(() => ({
  acceptOutputDataMock: vi.fn().mockResolvedValue(undefined),
  acceptOutputExitMock: vi.fn().mockResolvedValue(undefined),
  muxRequestMock: vi.fn(),
  onNotificationByMethodMock: vi.fn(),
  openConsumerSessionMock: vi.fn(),
  muxDisposeMock: vi.fn(),
  ptyProviderDisposeMock: vi.fn(),
  sourceAckCleanupMock: vi.fn(),
  sourceCancellationCleanupMock: vi.fn(),
  attachForReconnectMock: vi.fn().mockResolvedValue({}),
  ptyDataHandlerRef: { current: undefined as undefined | ((payload: unknown) => void) },
  ptyExitHandlerRef: { current: undefined as undefined | ((payload: unknown) => void) },
  ptyStateTokens: new Map<string, symbol>()
}))

vi.mock('./ssh-relay-deploy', () => ({ deployAndLaunchRelay: vi.fn() }))
vi.mock('./ssh-pty-consumer-session', () => ({
  openSshPtyConsumerSession: openConsumerSessionMock
}))
vi.mock('../ipc/ssh-pty-output-intake-registry', () => ({
  acceptSshPtyOutputData: acceptOutputDataMock,
  acceptSshPtyOutputExit: acceptOutputExitMock,
  allocateSshPtyProviderGeneration: vi.fn(() => 23),
  beginSshPtyOutputGenerationMigration: vi.fn(() => ({
    byPty: new Map(),
    completion: Promise.resolve()
  })),
  closeSshPtyOutputGeneration: vi.fn(),
  getSshPtyAcceptedSourceCheckpoints: vi.fn(() => []),
  installSshPtySourceAckPublisher: vi.fn(() => sourceAckCleanupMock),
  installSshPtySourceCancellationPublisher: vi.fn(() => sourceCancellationCleanupMock),
  applySshPtySourceCancellationProof: vi.fn(() => true),
  applySshPtySourceRecoveryCancellationProof: vi.fn(() => true)
}))
vi.mock('./ssh-channel-multiplexer', () => ({
  SshChannelMultiplexer: class MockSshChannelMultiplexer {
    notify = vi.fn()
    notifyWithSettlement = vi.fn()
    request = muxRequestMock
    onNotification = vi.fn().mockReturnValue(() => {})
    onNotificationByMethod = onNotificationByMethodMock.mockImplementation(() => () => {})
    onRequest = vi.fn().mockReturnValue(() => {})
    onDispose = vi.fn().mockReturnValue(() => {})
    dispose = muxDisposeMock
    isDisposed = vi.fn().mockReturnValue(false)
  }
}))
vi.mock('../providers/ssh-pty-provider', () => ({
  isSshPtyNotFoundError: vi.fn().mockReturnValue(false),
  isSshPtyIdentityMismatchError: vi.fn().mockReturnValue(false),
  SshPtyProvider: class MockSshPtyProvider {
    onData = vi.fn().mockImplementation((handler) => {
      ptyDataHandlerRef.current = handler
      return () => {}
    })
    onReplay = vi.fn().mockReturnValue(() => {})
    onExit = vi.fn().mockImplementation((handler) => {
      ptyExitHandlerRef.current = handler
      return () => {}
    })
    attachForReconnect = attachForReconnectMock
    setPtyDeliveryPauseAdapter = vi.fn()
    dispose = ptyProviderDisposeMock
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
  isCurrentPtyExit: vi.fn(() => true),
  clearPtyOwnershipForConnection: vi.fn(),
  clearProviderPtyState: vi.fn(),
  deletePtyOwnership: vi.fn(),
  getPtyIncarnation: vi.fn(() => undefined),
  restorePtyIncarnation: vi.fn(),
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
  finalizePendingPtyCleanupIfExact: vi.fn(() => false),
  hasPendingPtyCleanupExact: vi.fn(() => false),
  consumeSshPtyExitFinalization: vi.fn(() => false),
  setPtyOwnership: vi.fn()
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
  clearProviderPtyState,
  clearPtyOwnershipForConnection,
  deletePtyOwnership,
  getSshPtyProvider,
  getPtyIdsForConnection,
  registerSshPtyProvider,
  setPtyOwnership
} = await import('../ipc/pty')
const { getSshPtyAcceptedSourceCheckpoints } = await import('../ipc/ssh-pty-output-intake-registry')
const { applySshPtySourceCancellationProof } = await import('../ipc/ssh-pty-output-intake-registry')
const { applySshPtySourceRecoveryCancellationProof } =
  await import('../ipc/ssh-pty-output-intake-registry')

describe('SshRelaySession recovery overlap fencing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ptyDataHandlerRef.current = undefined
    ptyExitHandlerRef.current = undefined
    ptyStateTokens.clear()
    attachForReconnectMock.mockResolvedValue({})
    vi.mocked(getPtyIdsForConnection).mockReturnValue([])
    vi.mocked(getSshPtyAcceptedSourceCheckpoints).mockReturnValue([])
    vi.mocked(applySshPtySourceCancellationProof).mockReturnValue(true)
    vi.mocked(applySshPtySourceRecoveryCancellationProof).mockReturnValue(true)
    muxRequestMock.mockResolvedValue([])
    mockDeploySuccess()
  })

  function completeRecovery(params: Record<string, unknown>): void {
    const complete = onNotificationByMethodMock.mock.calls.findLast(
      ([method]) => method === 'pty.recoveryComplete'
    )?.[1] as ((params: Record<string, unknown>) => void) | undefined
    complete?.(params)
  }

  async function prepareRecovery(targetId: string): Promise<{
    session: SshRelaySession
    deps: ReturnType<typeof createMockDeps>
  }> {
    let generation = 0
    openConsumerSessionMock.mockImplementation(async (_mux, options) => ({
      mode: 'negotiated',
      clientInstanceId: options.clientInstanceId,
      clientGeneration: ++generation,
      ownerGeneration: generation,
      ownerLease: `owner-lease-${generation}`,
      outputFlowControl: { version: 1, windowSu: 256 * 1024 }
    }))
    vi.mocked(getSshPtyAcceptedSourceCheckpoints).mockReturnValue([
      {
        id: `ssh:${targetId}@@pty-1`,
        providerGeneration: 23,
        clientGeneration: 1,
        ownerGeneration: 1,
        ptyIncarnation: 'incarnation-1',
        deliveryToken: 'old-token',
        acceptedSourceEndSu: 4
      }
    ])
    const deps = createMockDeps()
    const session = new SshRelaySession(
      targetId,
      deps.getMainWindow,
      deps.mockStore,
      deps.mockPortForward
    )
    await session.establish(deps.mockConn)
    vi.mocked(getPtyIdsForConnection).mockReturnValue([`ssh:${targetId}@@pty-1`])
    vi.mocked(getSshPtyProvider).mockImplementation(
      () => vi.mocked(registerSshPtyProvider).mock.calls.at(-1)?.[1]
    )
    return { session, deps }
  }

  it('keeps a stale overlapping recovery from canceling or mutating its replacement', async () => {
    const targetId = 'overlapping-recovery'
    const { session, deps } = await prepareRecovery(targetId)
    const staleRecoveryLease = { commit: vi.fn(), retire: vi.fn() }
    const replacementRecoveryLease = { commit: vi.fn(), retire: vi.fn() }
    const staleLease = {
      commit: vi.fn(),
      rollback: vi.fn(),
      transferToRecovery: vi.fn(() => staleRecoveryLease)
    }
    const replacementLease = {
      commit: vi.fn(),
      rollback: vi.fn(),
      transferToRecovery: vi.fn(() => replacementRecoveryLease)
    }
    attachForReconnectMock.mockImplementation(async () => {
      const ownerGeneration = openConsumerSessionMock.mock.calls.length
      if (ownerGeneration === 3) {
        queueMicrotask(() => {
          completeRecovery({
            id: 'pty-1',
            clientGeneration: 3,
            ownerGeneration: 3,
            ptyIncarnation: 'incarnation-1',
            deliveryToken: 'replacement-token',
            checkpointSourceEndSu: 4,
            recoveryEndSu: 4
          })
        })
      }
      return {
        incarnationId: 'incarnation-1',
        sourceRecovery: {
          status: 'pending',
          clientGeneration: ownerGeneration,
          ownerGeneration,
          ptyIncarnation: 'incarnation-1',
          deliveryToken: ownerGeneration === 2 ? 'stale-token' : 'replacement-token',
          checkpointSourceEndSu: 4,
          recoveryEndSu: 4
        },
        sourceActivationLease: ownerGeneration === 2 ? staleLease : replacementLease
      }
    })

    const staleReconnect = session.reconnect(deps.mockConn)
    await vi.waitFor(() => expect(attachForReconnectMock).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    const replacementReconnect = session.reconnect(deps.mockConn)
    await Promise.all([staleReconnect, replacementReconnect])

    const recoveryRequests = attachForReconnectMock.mock.calls.map((call) => call[2])
    expect(recoveryRequests).toHaveLength(2)
    expect(recoveryRequests[1]).toMatchObject({
      status: 'checkpoint',
      deliveryToken: 'old-token',
      acceptedSourceEndSu: 4
    })
    expect(muxRequestMock.mock.calls.filter(([method]) => method === 'pty.cancelDelivery')).toEqual(
      []
    )
    expect(deps.mockStore.markSshRemotePtyLease).toHaveBeenCalledTimes(1)
    expect(deps.mockStore.markSshRemotePtyLease).toHaveBeenCalledWith(targetId, 'pty-1', 'attached')
    expect(setPtyOwnership).toHaveBeenCalledTimes(1)
    expect(staleLease.transferToRecovery).toHaveBeenCalledOnce()
    expect(staleLease.commit).not.toHaveBeenCalled()
    expect(staleLease.rollback).not.toHaveBeenCalled()
    expect(staleRecoveryLease.commit).not.toHaveBeenCalled()
    expect(staleRecoveryLease.retire).toHaveBeenCalledOnce()
    expect(replacementLease.transferToRecovery).toHaveBeenCalledOnce()
    expect(replacementLease.commit).not.toHaveBeenCalled()
    expect(replacementLease.rollback).not.toHaveBeenCalled()
    expect(replacementRecoveryLease.commit).toHaveBeenCalledOnce()
    expect(replacementRecoveryLease.retire).not.toHaveBeenCalled()
    expect(clearProviderPtyState).not.toHaveBeenCalled()
    expect(clearPtyOwnershipForConnection).not.toHaveBeenCalled()
    expect(deletePtyOwnership).not.toHaveBeenCalled()
    expect(deps.mockWindow.webContents.send).not.toHaveBeenCalledWith('pty:exit', expect.anything())
    expect(muxDisposeMock).not.toHaveBeenCalledWith('shutdown')
    expect(session.getState()).toBe('ready')
  })

  it('does not let a stale reconnect overwrite the winning consumer owner', async () => {
    const targetId = 'stale-consumer-owner-reconnect'
    const { session, deps } = await prepareRecovery(targetId)
    const staleOwner = {
      mode: 'negotiated' as const,
      clientInstanceId: 'stale-client',
      clientGeneration: 10,
      ownerGeneration: 10,
      ownerLease: 'stale-owner-lease',
      outputFlowControl: { version: 1 as const, windowSu: 256 * 1024 }
    }
    const winningOwner = {
      mode: 'negotiated' as const,
      clientInstanceId: 'winning-client',
      clientGeneration: 11,
      ownerGeneration: 11,
      ownerLease: 'winning-owner-lease',
      outputFlowControl: { version: 1 as const, windowSu: 256 * 1024 }
    }
    let resolveStale!: (state: typeof staleOwner) => void
    openConsumerSessionMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = resolve
          })
      )
      .mockResolvedValueOnce(winningOwner)

    const staleReconnect = session.reconnect(deps.mockConn)
    await vi.waitFor(() => expect(openConsumerSessionMock).toHaveBeenCalledTimes(2))
    const winningReconnect = session.reconnect(deps.mockConn)
    await winningReconnect
    resolveStale(staleOwner)
    await staleReconnect

    await session.reconnect(deps.mockConn)

    expect(openConsumerSessionMock.mock.calls[3]?.[1]).toMatchObject({
      resume: {
        ownerGeneration: winningOwner.ownerGeneration,
        ownerLease: winningOwner.ownerLease
      }
    })
  })
})
