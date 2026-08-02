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
  restorePtyIncarnation: vi.fn(),
  getPendingPtyCleanupIncarnation: vi.fn(() => undefined),
  consumePendingPtyCleanupIfExact: vi.fn(() => false),
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
  setPtyOwnership,
  unregisterSshPtyProvider
} = await import('../ipc/pty')
const { closeSshPtyOutputGeneration, getSshPtyAcceptedSourceCheckpoints } =
  await import('../ipc/ssh-pty-output-intake-registry')
const { applySshPtySourceCancellationProof } = await import('../ipc/ssh-pty-output-intake-registry')
const { applySshPtySourceRecoveryCancellationProof } =
  await import('../ipc/ssh-pty-output-intake-registry')

describe('SshRelaySession recovery race fencing', () => {
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

  function emitSourceFrame(args: {
    targetId: string
    token: string
    clientGeneration: number
    ownerGeneration: number
    sourceStartSu: number
    sourceEndSu: number
  }): void {
    ptyDataHandlerRef.current?.({
      id: `ssh:${args.targetId}@@pty-1`,
      data: 'late',
      providerGeneration: 23,
      ptyIncarnation: 'incarnation-1',
      sequenceChars: args.sourceEndSu - args.sourceStartSu,
      source: {
        relayPtyId: 'pty-1',
        spanId: `${args.token}:${args.sourceStartSu}:${args.sourceEndSu}`,
        clientGeneration: args.clientGeneration,
        ownerGeneration: args.ownerGeneration,
        deliveryToken: args.token,
        sourceStartSu: args.sourceStartSu,
        sourceEndSu: args.sourceEndSu
      }
    })
  }

  function pendingRecovery(recoveryEndSu: number) {
    return {
      status: 'pending',
      clientGeneration: 2,
      ownerGeneration: 2,
      ptyIncarnation: 'incarnation-1',
      deliveryToken: 'new-token',
      checkpointSourceEndSu: 4,
      recoveryEndSu
    }
  }

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

  it('continues relay recovery when forward cleanup reports a failure', async () => {
    const { session, deps } = await prepareRecovery('forward-cleanup-failure')
    vi.mocked(deps.mockPortForward.removeAllForwards).mockRejectedValueOnce(
      new Error('forward teardown failed')
    )

    await expect(session.reconnect(deps.mockConn)).resolves.toBeUndefined()

    expect(muxDisposeMock).toHaveBeenCalledWith('connection_lost')
    expect(session.getState()).toBe('ready')
  })

  it('publishes held recovery data before an exact exit without waiting for completion', async () => {
    const targetId = 'exit-with-complete-private-body'
    const { session, deps } = await prepareRecovery(targetId)
    const recoveryActivationLease = { commit: vi.fn(), retire: vi.fn() }
    const sourceActivationLease = {
      commit: vi.fn(),
      rollback: vi.fn(async () => true),
      transferToRecovery: vi.fn((sink: (payload: unknown) => void) => {
        sink({
          id: `ssh:${targetId}@@pty-1`,
          data: 'held',
          providerGeneration: 23,
          ptyIncarnation: 'incarnation-1',
          sequenceChars: 4,
          source: {
            relayPtyId: 'pty-1',
            spanId: 'new-token:4:8',
            clientGeneration: 2,
            ownerGeneration: 2,
            deliveryToken: 'new-token',
            sourceStartSu: 4,
            sourceEndSu: 8
          }
        })
        return recoveryActivationLease
      })
    }
    attachForReconnectMock.mockImplementation(async () => {
      ptyExitHandlerRef.current?.({
        id: `ssh:${targetId}@@pty-1`,
        code: 0,
        providerGeneration: 23,
        ptyIncarnation: 'incarnation-1',
        incarnationId: 'incarnation-1'
      })
      return {
        incarnationId: 'incarnation-1',
        sourceRecovery: pendingRecovery(8),
        sourceActivationLease
      }
    })

    await session.reconnect(deps.mockConn)

    expect(acceptOutputDataMock).toHaveBeenCalledWith(expect.objectContaining({ data: 'held' }))
    expect(acceptOutputExitMock).toHaveBeenCalledOnce()
    expect(acceptOutputDataMock.mock.invocationCallOrder[0]).toBeLessThan(
      acceptOutputExitMock.mock.invocationCallOrder[0]!
    )
    expect(sourceActivationLease.transferToRecovery).toHaveBeenCalledOnce()
    expect(sourceActivationLease.rollback).not.toHaveBeenCalled()
    expect(recoveryActivationLease.commit).toHaveBeenCalledOnce()
    expect(recoveryActivationLease.retire).not.toHaveBeenCalled()
    expect(muxRequestMock).not.toHaveBeenCalledWith('pty.cancelDelivery', expect.anything())
    expect(setPtyOwnership).not.toHaveBeenCalled()
    expect(deps.mockStore.markSshRemotePtyLease).not.toHaveBeenCalledWith(
      targetId,
      'pty-1',
      'attached'
    )
  })

  it('drops a stale source checkpoint after a not-found reattach', async () => {
    const targetId = 'stale-checkpoint-after-not-found'
    const { session, deps } = await prepareRecovery(targetId)
    attachForReconnectMock
      .mockRejectedValueOnce(new Error('PTY "pty-1" not found'))
      .mockResolvedValueOnce({ incarnationId: 'replacement-incarnation' })

    await session.reconnect(deps.mockConn)
    vi.mocked(getSshPtyAcceptedSourceCheckpoints).mockReturnValue([])
    await session.reconnect(deps.mockConn)

    expect(attachForReconnectMock).toHaveBeenCalledTimes(2)
    expect(attachForReconnectMock.mock.calls[1]?.[2]).toMatchObject({
      status: 'checkpointUnavailable'
    })
  })

  it('settles exact cancellation before publishing an exit with incomplete recovery data', async () => {
    const targetId = 'exit-with-incomplete-private-body'
    let settleCancellation: ((proof: unknown) => void) | undefined
    muxRequestMock.mockImplementation((method) =>
      method === 'pty.cancelDelivery'
        ? new Promise((resolve) => {
            settleCancellation = resolve
          })
        : Promise.resolve([])
    )
    const { session, deps } = await prepareRecovery(targetId)
    const recoveryActivationLease = { commit: vi.fn(), retire: vi.fn() }
    const sourceActivationLease = {
      commit: vi.fn(),
      rollback: vi.fn(async () => true),
      transferToRecovery: vi.fn((sink: (payload: unknown) => void) => {
        sink({
          id: `ssh:${targetId}@@pty-1`,
          data: 'partial',
          providerGeneration: 23,
          ptyIncarnation: 'incarnation-1',
          sequenceChars: 2,
          source: {
            relayPtyId: 'pty-1',
            spanId: 'new-token:4:6',
            clientGeneration: 2,
            ownerGeneration: 2,
            deliveryToken: 'new-token',
            sourceStartSu: 4,
            sourceEndSu: 6
          }
        })
        return recoveryActivationLease
      })
    }
    attachForReconnectMock.mockImplementation(async () => {
      ptyExitHandlerRef.current?.({
        id: `ssh:${targetId}@@pty-1`,
        code: 0,
        providerGeneration: 23,
        ptyIncarnation: 'incarnation-1',
        incarnationId: 'incarnation-1'
      })
      return {
        incarnationId: 'incarnation-1',
        sourceRecovery: pendingRecovery(8),
        sourceActivationLease
      }
    })

    const reconnect = session.reconnect(deps.mockConn)
    await vi.waitFor(() =>
      expect(muxRequestMock).toHaveBeenCalledWith('pty.cancelDelivery', {
        id: 'pty-1',
        clientGeneration: 2,
        ownerGeneration: 2,
        deliveryToken: 'new-token'
      })
    )
    expect(acceptOutputExitMock).not.toHaveBeenCalled()

    settleCancellation?.({ canceled: true, sentEndSu: 6, creditedEndSu: 4 })
    await reconnect

    expect(acceptOutputDataMock).not.toHaveBeenCalled()
    expect(acceptOutputExitMock).toHaveBeenCalledOnce()
    expect(recoveryActivationLease.commit).not.toHaveBeenCalled()
    expect(recoveryActivationLease.retire).toHaveBeenCalledOnce()
    expect(sourceActivationLease.rollback).not.toHaveBeenCalled()
    expect(applySshPtySourceRecoveryCancellationProof).toHaveBeenCalledOnce()
  })

  it('awaits provisional cancellation proof before publishing an exact recovery exit', async () => {
    const targetId = 'exit-before-recovery-identity'
    let settleRollback: ((settled: boolean) => void) | undefined
    const { session, deps } = await prepareRecovery(targetId)
    const sourceActivationLease = {
      commit: vi.fn(),
      rollback: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            settleRollback = resolve
          })
      ),
      transferToRecovery: vi.fn()
    }
    attachForReconnectMock.mockImplementation(async () => {
      ptyExitHandlerRef.current?.({
        id: `ssh:${targetId}@@pty-1`,
        code: 0,
        providerGeneration: 23,
        ptyIncarnation: 'incarnation-1',
        incarnationId: 'incarnation-1'
      })
      return {
        incarnationId: 'incarnation-1',
        sourceRecovery: { status: 'restoreRequired', reason: 'checkpointUnavailable' },
        sourceActivationLease
      }
    })

    const reconnect = session.reconnect(deps.mockConn)
    await vi.waitFor(() => expect(sourceActivationLease.rollback).toHaveBeenCalledOnce())
    expect(acceptOutputExitMock).not.toHaveBeenCalled()

    settleRollback?.(true)
    await reconnect

    expect(acceptOutputExitMock).toHaveBeenCalledOnce()
    expect(sourceActivationLease.transferToRecovery).not.toHaveBeenCalled()
    expect(sourceActivationLease.commit).not.toHaveBeenCalled()
  })

  it('retains the empty recovery end as the first post-activation source anchor', async () => {
    const targetId = 'empty-recovery-gap'
    const { session, deps } = await prepareRecovery(targetId)
    attachForReconnectMock.mockImplementation(async () => {
      queueMicrotask(() => {
        completeRecovery({
          id: 'pty-1',
          clientGeneration: 2,
          ownerGeneration: 2,
          ptyIncarnation: 'incarnation-1',
          deliveryToken: 'new-token',
          checkpointSourceEndSu: 4,
          recoveryEndSu: 4
        })
      })
      return {
        incarnationId: 'incarnation-1',
        sourceRecovery: pendingRecovery(4)
      }
    })
    await session.reconnect(deps.mockConn)
    const closeCount = vi.mocked(closeSshPtyOutputGeneration).mock.calls.length

    emitSourceFrame({
      targetId,
      token: 'new-token',
      clientGeneration: 2,
      ownerGeneration: 2,
      sourceStartSu: 5,
      sourceEndSu: 8
    })

    expect(acceptOutputDataMock).not.toHaveBeenCalled()
    expect(closeSshPtyOutputGeneration).toHaveBeenCalledTimes(closeCount + 1)
    expect(closeSshPtyOutputGeneration).toHaveBeenLastCalledWith(
      23,
      'ssh_source_frame_stale_or_non_contiguous'
    )
  })

  it('drops late frames from a token after its cancellation proof is validated', async () => {
    const targetId = 'late-after-cancel'
    muxRequestMock.mockImplementation(async (method) =>
      method === 'pty.cancelDelivery' ? { canceled: true, sentEndSu: 8, creditedEndSu: 4 } : []
    )
    const { session, deps } = await prepareRecovery(targetId)
    attachForReconnectMock.mockImplementation(async () => {
      queueMicrotask(() => {
        emitSourceFrame({
          targetId,
          token: 'new-token',
          clientGeneration: 2,
          ownerGeneration: 2,
          sourceStartSu: 5,
          sourceEndSu: 8
        })
        completeRecovery({
          id: 'pty-1',
          clientGeneration: 2,
          ownerGeneration: 2,
          ptyIncarnation: 'incarnation-1',
          deliveryToken: 'new-token',
          checkpointSourceEndSu: 4,
          recoveryEndSu: 8
        })
      })
      return {
        incarnationId: 'incarnation-1',
        sourceRecovery: pendingRecovery(8)
      }
    })
    await session.reconnect(deps.mockConn)
    const closeCount = vi.mocked(closeSshPtyOutputGeneration).mock.calls.length

    emitSourceFrame({
      targetId,
      token: 'new-token',
      clientGeneration: 2,
      ownerGeneration: 2,
      sourceStartSu: 8,
      sourceEndSu: 12
    })

    expect(acceptOutputDataMock).not.toHaveBeenCalled()
    expect(closeSshPtyOutputGeneration).toHaveBeenCalledTimes(closeCount)
    expect(deps.mockStore.markSshRemotePtyLease).toHaveBeenCalledWith(targetId, 'pty-1', 'detached')
    expect(clearProviderPtyState).not.toHaveBeenCalled()
    expect(clearPtyOwnershipForConnection).not.toHaveBeenCalled()
    expect(deletePtyOwnership).not.toHaveBeenCalled()
    expect(deps.mockWindow.webContents.send).not.toHaveBeenCalledWith('pty:exit', expect.anything())
    expect(muxDisposeMock).not.toHaveBeenCalledWith('shutdown')
  })

  it('rejects cancellation proof below capacity-rejected and later private frames', async () => {
    const targetId = 'capacity-watermark'
    muxRequestMock.mockImplementation(async (method) =>
      method === 'pty.cancelDelivery' ? { canceled: true, sentEndSu: 8, creditedEndSu: 4 } : []
    )
    const { session, deps } = await prepareRecovery(targetId)
    const recoveryActivationLease = { commit: vi.fn(), retire: vi.fn() }
    const sourceActivationLease = {
      commit: vi.fn(),
      rollback: vi.fn(),
      transferToRecovery: vi.fn((sink: (payload: unknown) => void) => {
        sink({
          id: `ssh:${targetId}@@pty-1`,
          data: 'x'.repeat(2 * 1024 * 1024 + 1),
          providerGeneration: 23,
          ptyIncarnation: 'incarnation-1',
          sequenceChars: 4,
          source: {
            relayPtyId: 'pty-1',
            spanId: 'new-token:4:8',
            clientGeneration: 2,
            ownerGeneration: 2,
            deliveryToken: 'new-token',
            sourceStartSu: 4,
            sourceEndSu: 8
          }
        })
        sink({
          id: `ssh:${targetId}@@pty-1`,
          data: 'later',
          providerGeneration: 23,
          ptyIncarnation: 'incarnation-1',
          sequenceChars: 4,
          source: {
            relayPtyId: 'pty-1',
            spanId: 'new-token:8:12',
            clientGeneration: 2,
            ownerGeneration: 2,
            deliveryToken: 'new-token',
            sourceStartSu: 8,
            sourceEndSu: 12
          }
        })
        return recoveryActivationLease
      })
    }
    attachForReconnectMock.mockResolvedValue({
      incarnationId: 'incarnation-1',
      sourceRecovery: pendingRecovery(12),
      sourceActivationLease
    })

    await session.reconnect(deps.mockConn)

    expect(muxRequestMock).toHaveBeenCalledWith(
      'pty.cancelDelivery',
      expect.objectContaining({ deliveryToken: 'new-token' })
    )
    expect(vi.mocked(closeSshPtyOutputGeneration).mock.calls).toContainEqual([
      23,
      'ssh_source_recovery_cancellation_failed'
    ])
    expect(applySshPtySourceRecoveryCancellationProof).not.toHaveBeenCalled()
    expect(recoveryActivationLease.commit).not.toHaveBeenCalled()
    expect(recoveryActivationLease.retire).toHaveBeenCalledOnce()
  })

  it.each([
    ['publication', undefined],
    ['proof', { canceled: true, sentEndSu: 8, creditedEndSu: 4 }],
    ['negative-end', { canceled: true, sentEndSu: -1, creditedEndSu: 4 }],
    ['credited-ahead', { canceled: true, sentEndSu: 8, creditedEndSu: 9 }],
    ['checkpoint-mismatch', { canceled: true, sentEndSu: 8, creditedEndSu: 3 }],
    ['sent-before-private-end', { canceled: true, sentEndSu: 7, creditedEndSu: 4 }]
  ] as const)(
    'closes one provider generation when recovery cancellation %s rejects',
    async (failure, cancellationResult) => {
      const targetId = `cancel-${failure}-failure`
      muxRequestMock.mockImplementation(async (method) => {
        if (method !== 'pty.cancelDelivery') {
          return []
        }
        if (failure === 'publication') {
          throw new Error('cancel publication failed')
        }
        return cancellationResult
      })
      if (failure === 'proof') {
        vi.mocked(applySshPtySourceRecoveryCancellationProof).mockImplementation(() => {
          throw new Error('cancel proof rejected')
        })
      }
      const { session, deps } = await prepareRecovery(targetId)
      const onRelayLost = vi.fn()
      const recoveryActivationLease = { commit: vi.fn(), retire: vi.fn() }
      const activationLease = {
        commit: vi.fn(),
        rollback: vi.fn(),
        transferToRecovery: vi.fn(() => recoveryActivationLease)
      }
      session.setOnRelayLost(onRelayLost)
      let cleanupCountsBeforeFailure:
        | {
            generation: number
            mux: number
            provider: number
            ack: number
            cancellation: number
            unregister: number
          }
        | undefined
      attachForReconnectMock.mockImplementation(async () => {
        cleanupCountsBeforeFailure = {
          generation: vi.mocked(closeSshPtyOutputGeneration).mock.calls.length,
          mux: muxDisposeMock.mock.calls.length,
          provider: ptyProviderDisposeMock.mock.calls.length,
          ack: sourceAckCleanupMock.mock.calls.length,
          cancellation: sourceCancellationCleanupMock.mock.calls.length,
          unregister: vi.mocked(unregisterSshPtyProvider).mock.calls.length
        }
        queueMicrotask(() => {
          emitSourceFrame({
            targetId,
            token: 'new-token',
            clientGeneration: 2,
            ownerGeneration: 2,
            sourceStartSu: 5,
            sourceEndSu: 8
          })
        })
        return {
          incarnationId: 'incarnation-1',
          sourceRecovery: pendingRecovery(8),
          sourceActivationLease: activationLease
        }
      })

      await session.reconnect(deps.mockConn)

      expect(cleanupCountsBeforeFailure).toBeDefined()
      const before = cleanupCountsBeforeFailure!
      expect(vi.mocked(closeSshPtyOutputGeneration).mock.calls).toHaveLength(before.generation + 1)
      expect(closeSshPtyOutputGeneration).toHaveBeenLastCalledWith(
        23,
        'ssh_source_recovery_cancellation_failed'
      )
      expect(muxDisposeMock.mock.calls).toHaveLength(before.mux + 1)
      expect(muxDisposeMock).toHaveBeenLastCalledWith('connection_lost')
      expect(ptyProviderDisposeMock.mock.calls).toHaveLength(before.provider + 1)
      expect(sourceAckCleanupMock.mock.calls).toHaveLength(before.ack + 1)
      expect(sourceCancellationCleanupMock.mock.calls).toHaveLength(before.cancellation + 1)
      expect(vi.mocked(unregisterSshPtyProvider).mock.calls).toHaveLength(before.unregister + 1)
      expect(unregisterSshPtyProvider).toHaveBeenLastCalledWith(targetId, expect.anything())
      expect(activationLease.transferToRecovery).toHaveBeenCalledOnce()
      expect(activationLease.commit).not.toHaveBeenCalled()
      expect(activationLease.rollback).not.toHaveBeenCalled()
      expect(recoveryActivationLease.commit).not.toHaveBeenCalled()
      expect(recoveryActivationLease.retire).toHaveBeenCalledOnce()
      expect(onRelayLost).toHaveBeenCalledOnce()
      expect(session.getState()).toBe('reconnecting')
      expect(clearProviderPtyState).not.toHaveBeenCalled()
      expect(clearPtyOwnershipForConnection).not.toHaveBeenCalled()
      expect(deletePtyOwnership).not.toHaveBeenCalled()
      expect(deps.mockStore.markSshRemotePtyLease).not.toHaveBeenCalled()
      expect(deps.mockWindow.webContents.send).not.toHaveBeenCalledWith(
        'pty:exit',
        expect.anything()
      )
      expect(muxDisposeMock).not.toHaveBeenCalledWith('shutdown')
      expect(vi.mocked(closeSshPtyOutputGeneration).mock.calls).not.toContainEqual([
        99,
        expect.anything()
      ])
      expect(unregisterSshPtyProvider).not.toHaveBeenCalledWith('unrelated-target')
    }
  )

  it('overwrites the migration checkpoint with the post-recovery one for the same pty', async () => {
    const targetId = 'post-recovery-checkpoint-rekey'
    const { session, deps } = await prepareRecovery(targetId)
    attachForReconnectMock.mockImplementation(async () => {
      queueMicrotask(() => {
        emitSourceFrame({
          targetId,
          token: 'new-token',
          clientGeneration: 2,
          ownerGeneration: 2,
          sourceStartSu: 4,
          sourceEndSu: 8
        })
        completeRecovery({
          id: 'pty-1',
          clientGeneration: 2,
          ownerGeneration: 2,
          ptyIncarnation: 'incarnation-1',
          deliveryToken: 'new-token',
          checkpointSourceEndSu: 4,
          recoveryEndSu: 4
        })
      })
      return { incarnationId: 'incarnation-1', sourceRecovery: pendingRecovery(4) }
    })
    await session.reconnect(deps.mockConn)
    expect(acceptOutputDataMock).toHaveBeenCalledOnce()

    // The pre-migration identity is gone from the intake, so only the checkpoint
    // recorded after recovery can answer the next reconnect.
    vi.mocked(getSshPtyAcceptedSourceCheckpoints).mockReturnValue([])
    attachForReconnectMock.mockResolvedValue({
      incarnationId: 'incarnation-1',
      sourceRecovery: { status: 'restoreRequired', reason: 'checkpointUnavailable' }
    })
    await session.reconnect(deps.mockConn)

    expect(attachForReconnectMock).toHaveBeenCalledTimes(2)
    expect(attachForReconnectMock.mock.calls.at(-1)?.[2]).toMatchObject({
      status: 'checkpoint',
      deliveryToken: 'new-token',
      acceptedSourceEndSu: 8
    })
  })
})
