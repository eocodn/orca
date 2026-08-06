import type { RuntimePtyController } from '../runtime/orca-runtime-context-2'
import type { PtySpawnResult } from '../providers/types'
import type { PtyRendererDeliveryContext } from './pty-ipc-runtime-renderer-delivery-context'
import { createPtySpawnPreparation } from './pty-ipc-runtime-controller-spawn-preparation'
import { SSH_SESSION_EXPIRED_ERROR } from '../providers/ssh-pty-errors'
import { shouldSkipCodexHomeEnvForWindowsShell } from './pty-ipc-runtime-host-env-foundation'

type PtySpawnArgs = Parameters<NonNullable<RuntimePtyController['spawn']>>[0]
type BindingRollbackReceipt = { rollbackIfCurrent: () => boolean }

export function createPtySpawnHandler(
  state: PtyRendererDeliveryContext & Record<string, any>
): NonNullable<RuntimePtyController['spawn']> {
  const prepare = createPtySpawnPreparation(state)
  const {
    runtime,
    trustedTerminalHandleEnv,
    reconcileAgentSessionOwnerListings,
    agentSessionOwners,
    assertPtyProviderIdentityCurrent,
    ptyIncarnationById,
    snapshotPtyCleanupAuthority,
    assertPtyCleanupComplete,
    assertSpawnReplyWasLive,
    stagePtyIncarnation,
    tryGetProviderForAgentSessionOwner,
    isProviderAgentSessionOwnerLive,
    commitPtyIncarnation,
    ptyOwnership,
    registerPty,
    ptySizes,
    pendingPtySizes,
    snapshotPtyPublication,
    restorePtyPublicationIfCurrent,
    isNativeWindowsLocalPtySpawn,
    markNativeWindowsConptyPty,
    getRelayPtyId,
    toSshExecutionHostId,
    isValidTerminalTabId,
    isTerminalLeafId,
    rememberPaneKeyForPty,
    pendingByPaneKey,
    rendererSerializerReadiness,
    pendingPtyIdBySerializerGeneration,
    resolvePaneSpawnReservation,
    cleanUpFailedFreshSpawn,
    rejectPaneSpawnReservation,
    rollbackPtyIncarnation,
    clearProviderPtyStateIfCurrent,
    deletePtyOwnership,
    normalizeNodePtySpawnError,
    isSshPtyIdentityMismatchError,
    store,
    markPtySpawned,
    createTerminalSessionStateSaveFailureMessage,
    sendPtySpawnedToRenderer
  } = state

  return async (args: PtySpawnArgs) => {
    const preparation = await prepare(args)
    if (preparation.kind === 'duplicate') {
      return await preparation.promise
    }
    const prepared = preparation.prepared
    const {
      cwd,
      provider,
      providerIdentity,
      daemonShellOverride,
      isDaemonHostSpawn,
      sessionId,
      effectiveSessionRelayId,
      effectiveSessionAppId,
      isMintedSessionId,
      expectedWslDistro,
      launchCommand,
      hostSessionBinding,
      env,
      spawnOptions,
      reportPtySpawnCommitted,
      publicationSnapshot: initialPublicationSnapshot,
      hadSessionSizeBeforeAttach,
      sessionSizeBeforeAttach,
      materializedPaneKey,
      metadataLeafId,
      paneSpawnReservation,
      finishTerminalInstall
    } = prepared
    let publicationSnapshot = initialPublicationSnapshot
    let result: PtySpawnResult
    let rejectedRegistrationCandidate: PtySpawnResult | null = null
    let pendingRegistrationPtyId: string | null = null
    let preparedProvisionalExecutionContext = false
    let bindingRollbackReceipt: BindingRollbackReceipt | null = null
    let failedPublicationStateToken: symbol | undefined
    let releaseWorktreeSpawn: (() => void) | undefined
    try {
      releaseWorktreeSpawn = await runtime?.acquireWorktreeTerminalSpawn?.(args.worktreeId)
      try {
        if (args.preAllocatedHandle) {
          trustedTerminalHandleEnv.add(args.preAllocatedHandle)
        }
        const expectedPtyId = effectiveSessionAppId ?? sessionId
        if (expectedPtyId) {
          assertPtyCleanupComplete(expectedPtyId)
          runtime?.beginPtyRegistration?.(expectedPtyId)
          pendingRegistrationPtyId = expectedPtyId
        }
        if (isDaemonHostSpawn && expectedPtyId) {
          preparedProvisionalExecutionContext =
            runtime?.preparePtyExecutionContext?.(expectedPtyId, expectedWslDistro, {
              resetIncarnation: isMintedSessionId,
              preserveExisting: !isMintedSessionId
            }) ?? false
        }
        const sequenceBeforeProviderSpawn = expectedPtyId
          ? (runtime?.getPtyOutputSequence?.(expectedPtyId) ?? 0)
          : 0
        const assertClientStillConnected = (): void => {
          if (args.signal?.aborted) {
            throw new Error('client_disconnected')
          }
        }
        if (args.agentSessionEnsure) {
          // Why: daemon-backed claims can outlive this controller; import all
          // proven owners before deciding that an identity is absent.
          await reconcileAgentSessionOwnerListings()
          const recoveredOwner = agentSessionOwners.find(args.agentSessionEnsure.claim)
          if (recoveredOwner && pendingRegistrationPtyId !== recoveredOwner.ptyId) {
            if (pendingRegistrationPtyId) {
              runtime?.cancelPendingPtyRegistration?.(pendingRegistrationPtyId)
            }
            runtime?.beginPtyRegistration?.(
              recoveredOwner.ptyId,
              ptyIncarnationById.get(recoveredOwner.ptyId)
            )
            pendingRegistrationPtyId = recoveredOwner.ptyId
          }
          let providerResult: PtySpawnResult | null = null
          const ensured = await agentSessionOwners.ensure({
            claim: args.agentSessionEnsure.claim,
            surface: args.agentSessionEnsure.surface,
            spawn: async () => {
              assertClientStillConnected()
              const providerSpawnPtyId = pendingRegistrationPtyId ?? expectedPtyId
              const cleanupAuthorityBeforeProviderSpawn =
                snapshotPtyCleanupAuthority(providerSpawnPtyId)
              assertPtyCleanupComplete(providerSpawnPtyId)
              assertPtyProviderIdentityCurrent(providerIdentity)
              const spawnedProviderResult = await provider.spawn(spawnOptions)
              providerResult = spawnedProviderResult
              rejectedRegistrationCandidate = spawnedProviderResult
              assertPtyProviderIdentityCurrent(providerIdentity)
              if (spawnedProviderResult.id === providerSpawnPtyId) {
                assertPtyCleanupComplete(
                  spawnedProviderResult.id,
                  cleanupAuthorityBeforeProviderSpawn
                )
              }
              // Why: a successful lower-owner return proves physical work committed even if admission sees an early exit.
              reportPtySpawnCommitted()
              assertSpawnReplyWasLive(spawnedProviderResult)
              runtime?.assertPtyRegistrationAllowed?.(
                spawnedProviderResult.id,
                spawnedProviderResult.incarnationId
              )
              if (spawnedProviderResult.incarnationId) {
                // Why: local providers cannot serialize controller claims, so liveness proof
                // needs the exact incarnation before the registry promotes the new owner.
                stagePtyIncarnation(spawnedProviderResult.id, spawnedProviderResult.incarnationId)
              }
              const providerEnsure = spawnedProviderResult.agentSessionEnsure
              return {
                ptyId: spawnedProviderResult.id,
                ...(providerEnsure
                  ? {
                      owner: providerEnsure.owner,
                      disposition: providerEnsure.disposition
                    }
                  : {})
              }
            },
            isLive: async (owner) => {
              const ownerProvider = tryGetProviderForAgentSessionOwner(owner.ptyId)
              if (!ownerProvider) {
                // Why: a disconnected relay may keep its PTY alive during the
                // grace window; missing transport is unknown, never absence.
                throw new Error('execution_owner_unavailable')
              }
              return await isProviderAgentSessionOwnerLive(ownerProvider, owner)
            }
          })
          assertPtyProviderIdentityCurrent(providerIdentity)
          result = providerResult ?? {
            id: ensured.owner.ptyId,
            isReattach: true,
            // Why: adoption from an authoritative listing must preserve the
            // incarnation proof used to reject a delayed exit from an older process.
            incarnationId: ptyIncarnationById.get(ensured.owner.ptyId)
          }
          result.agentSessionEnsure = ensured
        } else {
          assertClientStillConnected()
          const cleanupAuthorityBeforeProviderSpawn = snapshotPtyCleanupAuthority(expectedPtyId)
          assertPtyProviderIdentityCurrent(providerIdentity)
          result = await provider.spawn(spawnOptions)
          rejectedRegistrationCandidate = result
          assertPtyProviderIdentityCurrent(providerIdentity)
          if (expectedPtyId === result.id) {
            assertPtyCleanupComplete(result.id, cleanupAuthorityBeforeProviderSpawn)
          }
          // Why: daemon/relay returns cross the physical commit boundary before controller admission.
          reportPtySpawnCommitted()
          assertSpawnReplyWasLive(result)
        }
        rejectedRegistrationCandidate ??= result
        if (!publicationSnapshot || publicationSnapshot.id !== result.id) {
          publicationSnapshot = snapshotPtyPublication(result.id)
        }
        if (pendingRegistrationPtyId !== result.id) {
          if (pendingRegistrationPtyId) {
            runtime?.cancelPendingPtyRegistration?.(pendingRegistrationPtyId)
          }
          runtime?.beginPtyRegistration?.(result.id, result.incarnationId)
          pendingRegistrationPtyId = result.id
        }
        // Why: admission precedes sequence/context state and every durable publication below.
        runtime?.assertPtyRegistrationAllowed?.(result.id, result.incarnationId)
        const preparedIncarnation = runtime?.preparePtyRegistrationIncarnation?.(
          result.id,
          result.incarnationId
        )
        result.incarnationId ??= preparedIncarnation ?? undefined
        stagePtyIncarnation(result.id, result.incarnationId)
        failedPublicationStateToken = snapshotPtyPublication(result.id).stateToken
        if (result.providerSequence) {
          runtime?.synchronizePtyOutputSequenceFromProvider?.(
            result.id,
            result.providerSequence,
            sequenceBeforeProviderSpawn
          )
        }
        runtime?.preparePtyExecutionContext?.(
          result.id,
          args.connectionId
            ? null
            : result.wslDistro === undefined
              ? expectedWslDistro
              : result.wslDistro
        )
      } catch (err) {
        if ((isMintedSessionId || preparedProvisionalExecutionContext) && effectiveSessionAppId) {
          runtime?.preparePtyExecutionContext?.(effectiveSessionAppId, null, {
            resetIncarnation: true
          })
        }
        const rawMessage = err instanceof Error ? err.message : String(err)
        if (rawMessage === 'agent_session_exited_during_start' && rejectedRegistrationCandidate) {
          runtime?.releaseRejectedPtyRegistrationFence?.(
            rejectedRegistrationCandidate.id,
            rejectedRegistrationCandidate.incarnationId
          )
        }
        if (pendingRegistrationPtyId) {
          runtime?.cancelPendingPtyRegistration?.(
            pendingRegistrationPtyId,
            rejectedRegistrationCandidate?.incarnationId
          )
          pendingRegistrationPtyId = null
        }
        if (rejectedRegistrationCandidate) {
          rollbackPtyIncarnation(
            rejectedRegistrationCandidate.id,
            rejectedRegistrationCandidate.incarnationId
          )
        }
        const spawnError = normalizeNodePtySpawnError(err)
        const isIdentityMismatch =
          isSshPtyIdentityMismatchError(spawnError) || isSshPtyIdentityMismatchError(rawMessage)
        if (effectiveSessionAppId !== undefined) {
          if (isIdentityMismatch && hadSessionSizeBeforeAttach && sessionSizeBeforeAttach) {
            ptySizes.set(effectiveSessionAppId, sessionSizeBeforeAttach)
          } else {
            ptySizes.delete(effectiveSessionAppId)
          }
        }
        if (
          args.connectionId &&
          effectiveSessionRelayId !== undefined &&
          (spawnError.message.includes(SSH_SESSION_EXPIRED_ERROR) ||
            rawMessage.includes(SSH_SESSION_EXPIRED_ERROR))
        ) {
          if (effectiveSessionAppId !== undefined && !isIdentityMismatch) {
            const cleared =
              failedPublicationStateToken !== undefined
                ? clearProviderPtyStateIfCurrent(
                    effectiveSessionAppId,
                    failedPublicationStateToken,
                    rejectedRegistrationCandidate?.incarnationId
                  )
                : false
            if (cleared) {
              deletePtyOwnership(effectiveSessionAppId)
            }
          }
          if (!isIdentityMismatch) {
            store?.markSshRemotePtyLease(args.connectionId, effectiveSessionRelayId, 'expired')
          }
        }
        if (isMintedSessionId && sessionId !== undefined) {
          const expectedStateToken = failedPublicationStateToken ?? publicationSnapshot?.stateToken
          if (expectedStateToken !== undefined) {
            clearProviderPtyStateIfCurrent(
              sessionId,
              expectedStateToken,
              rejectedRegistrationCandidate?.incarnationId
            )
          }
        }
        if (!rawMessage.includes(SSH_SESSION_EXPIRED_ERROR) && publicationSnapshot) {
          restorePtyPublicationIfCurrent(publicationSnapshot, failedPublicationStateToken)
        }
        throw spawnError
      } finally {
        if (args.preAllocatedHandle) {
          trustedTerminalHandleEnv.delete(args.preAllocatedHandle)
        }
      }
      if (result.agentSessionEnsure?.disposition === 'adopted') {
        const owner = result.agentSessionEnsure.owner
        failedPublicationStateToken = commitPtyIncarnation(result.id, result.incarnationId)
        ptyOwnership.set(result.id, args.connectionId ?? ptyOwnership.get(result.id) ?? null)
        runtime?.registerPreAllocatedHandleForPty(result.id, owner.surface.terminalHandle)
        const registeredIncarnation = runtime?.registerPty(
          result.id,
          owner.surface.worktreeId,
          args.connectionId ?? null,
          {
            tabId: owner.surface.tabId,
            leafId: owner.surface.leafId,
            ...(result.incarnationId ? { incarnationId: result.incarnationId } : {})
          }
        )
        result.incarnationId ??= registeredIncarnation ?? undefined
        return {
          id: result.id,
          ...(result.incarnationId ? { incarnationId: result.incarnationId } : {}),
          agentSessionEnsure: result.agentSessionEnsure
        }
      }
      // Why: record the native-Windows-local-PTY determination before any byte reaches the emulator, so its ConPTY DA1 override exists from byte zero.
      if (
        isNativeWindowsLocalPtySpawn({
          connectionId: args.connectionId,
          cwd: args.cwd,
          shellOverride: daemonShellOverride
        })
      ) {
        markNativeWindowsConptyPty(result.id)
      }
      const relayResultId = getRelayPtyId(args.connectionId, result.id)
      const persistSshLease = (): void => {
        if (!store || !args.connectionId) {
          return
        }
        // Why: SSH leases keep relay ids for remote reconciliation, while session bindings keep app-facing ids for hydration.
        store.upsertSshRemotePtyLease({
          targetId: args.connectionId,
          ptyId: relayResultId,
          ...(typeof args.worktreeId === 'string' ? { worktreeId: args.worktreeId } : {}),
          ...(typeof args.tabId === 'string' ? { tabId: args.tabId } : {}),
          ...(typeof args.leafId === 'string' && isTerminalLeafId(args.leafId)
            ? { leafId: args.leafId }
            : {}),
          state: 'attached',
          lastAttachedAt: Date.now()
        })
      }
      if (hostSessionBinding) {
        try {
          const binding = {
            worktreeId: hostSessionBinding.worktreeId,
            tabId: hostSessionBinding.tabId,
            leafId: hostSessionBinding.leafId,
            ptyId: result.id,
            ...(result.incarnationId ? { incarnationId: result.incarnationId } : {}),
            ...(cwd ? { startupCwd: cwd } : {})
          }
          bindingRollbackReceipt = args.connectionId
            ? hostSessionBinding.store.persistPtyBinding(
                binding,
                toSshExecutionHostId(args.connectionId)
              )
            : hostSessionBinding.store.persistPtyBinding(binding)
        } catch (err) {
          console.error('[pty] failed to persist runtime PTY binding after spawn:', err)
          throw Object.assign(new Error(createTerminalSessionStateSaveFailureMessage()), {
            agentSessionOperationOutcome: 'unknown' as const
          })
        }
      }
      if (args.preAllocatedHandle) {
        runtime?.registerPreAllocatedHandleForPty(result.id, args.preAllocatedHandle)
      }
      if (args.worktreeId) {
        const registeredIncarnation = runtime?.registerPty(
          result.id,
          args.worktreeId,
          args.connectionId ?? null,
          // Why: thread validated pane identity so main can back a pending mobile create even if graph-sync stalls (#7587).
          typeof args.tabId === 'string' &&
            isValidTerminalTabId(args.tabId) &&
            args.tabId.length <= 512 &&
            metadataLeafId !== null
            ? {
                tabId: args.tabId,
                leafId: metadataLeafId,
                ...(result.incarnationId ? { incarnationId: result.incarnationId } : {})
              }
            : undefined,
          !args.connectionId
            ? shouldSkipCodexHomeEnvForWindowsShell(daemonShellOverride, cwd)
            : undefined
        )
        result.incarnationId ??= registeredIncarnation ?? undefined
      } else {
        // Why: non-worktree PTYs have no later surface-registration phase to clear admission intent.
        if (result.incarnationId) {
          runtime?.admitHeadlessPtyLifecycle?.(result.id, result.incarnationId)
        } else {
          runtime?.cancelPendingPtyRegistration?.(result.id)
        }
      }
      // Why: arms main's per-PTY Command Code output detector from the launch command (renderer startupCommand parity).
      runtime?.noteTerminalSpawnCommand?.(result.id, launchCommand ?? null)
      markPtySpawned(result.id)
      // Why: runtime-owned CLI PTYs bypass the renderer pty:spawn handler; record paneKey here too since hook titles and cache cleanup need this reverse lookup.
      const paneKey = rememberPaneKeyForPty(result.id, env?.ORCA_PANE_KEY)
      const pendingSerializer = paneKey ? pendingByPaneKey.get(paneKey) : undefined
      const inheritRendererReadiness =
        result.isReattach === true &&
        !pendingSerializer &&
        rendererSerializerReadiness.has(result.id)
      rendererSerializerReadiness.beginIncarnation(result.id, inheritRendererReadiness)
      if (paneKey && pendingSerializer) {
        pendingPtyIdBySerializerGeneration.set(pendingSerializer.gen, result.id)
      }
      if (!args.connectionId) {
        registerPty({
          ptyId: result.id,
          worktreeId: args.worktreeId ?? null,
          sessionId: sessionId ?? null,
          paneKey,
          pid:
            typeof result.pid === 'number' && Number.isFinite(result.pid) && result.pid > 0
              ? result.pid
              : null
        })
      }
      failedPublicationStateToken = commitPtyIncarnation(result.id, result.incarnationId)
      ptyOwnership.set(result.id, args.connectionId ?? null)
      ptySizes.set(result.id, { cols: args.cols, rows: args.rows })
      pendingPtySizes.delete(result.id)
      if (effectiveSessionAppId !== undefined && effectiveSessionAppId !== result.id) {
        ptySizes.delete(effectiveSessionAppId)
        pendingPtySizes.delete(effectiveSessionAppId)
      }
      persistSshLease()
      // Why: runtime-owned/background spawns bypass mounted-pane state, so inventory consumers need an explicit signal.
      sendPtySpawnedToRenderer(result.id)
      const response = {
        id: result.id,
        ...(result.incarnationId ? { incarnationId: result.incarnationId } : {}),
        ...(result.agentSessionEnsure ? { agentSessionEnsure: result.agentSessionEnsure } : {})
      }
      return resolvePaneSpawnReservation(materializedPaneKey, paneSpawnReservation, response)
    } catch (err) {
      const bindingRollbackApplied = bindingRollbackReceipt?.rollbackIfCurrent()
      if (bindingRollbackApplied === false) {
        console.error('[pty] durable PTY binding rollback did not apply')
      }
      if (rejectedRegistrationCandidate) {
        try {
          const runtimeExitObservedBeforeQuarantine =
            rejectedRegistrationCandidate.incarnationId !== undefined &&
            runtime?.hasObservedExactPtyExit?.(
              rejectedRegistrationCandidate.id,
              rejectedRegistrationCandidate.incarnationId
            ) === true
          runtime?.quarantinePtyAfterPublicationFailure?.(
            rejectedRegistrationCandidate.id,
            rejectedRegistrationCandidate.incarnationId
          )
          if (rejectedRegistrationCandidate.isReattach) {
            pendingPtySizes.delete(rejectedRegistrationCandidate.id)
            if (publicationSnapshot) {
              restorePtyPublicationIfCurrent(publicationSnapshot, failedPublicationStateToken)
            }
          } else {
            await cleanUpFailedFreshSpawn(
              provider,
              rejectedRegistrationCandidate,
              publicationSnapshot,
              runtimeExitObservedBeforeQuarantine
            )
          }
        } catch (cleanupError) {
          // Why: cleanup failure must not strand the pane reservation or mask the publication error.
          console.error(
            '[pty] failed to settle cleanup after spawn publication failure:',
            cleanupError
          )
        }
      }
      if (pendingRegistrationPtyId) {
        runtime?.cancelPendingPtyRegistration?.(
          pendingRegistrationPtyId,
          rejectedRegistrationCandidate?.incarnationId
        )
        pendingRegistrationPtyId = null
      }
      // Why: once the reservation is created, any later throw — spawn
      // failure, persist failure, or a post-spawn helper such as
      // registerPty/rememberPaneKeyForPty/track — must settle it. Otherwise
      // it lingers in paneSpawnReservationsByPaneKey and every future spawn
      // for this pane awaits a promise that never resolves. reject is a
      // no-op once the reservation has already resolved.
      rejectPaneSpawnReservation(materializedPaneKey, paneSpawnReservation, err)
      throw err
    } finally {
      releaseWorktreeSpawn?.()
      finishTerminalInstall()
    }
  }
}
