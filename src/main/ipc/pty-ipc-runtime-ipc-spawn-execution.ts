import type { RuntimePtyController } from '../runtime/orca-runtime-context-2'
import type { PtySpawnResult } from '../providers/types'
import type { PtyRendererDeliveryContext } from './pty-ipc-runtime-renderer-delivery-context'
import { createPtyIpcSpawnPreparation } from './pty-ipc-runtime-ipc-spawn-preparation'
import { SSH_SESSION_EXPIRED_ERROR } from '../providers/ssh-pty-errors'
import { classifyError } from '../telemetry/classify-error'
import { track } from '../telemetry/client'
import { toSshExecutionHostId } from '../../shared/execution-host'
import { isValidTerminalTabId } from '../../shared/terminal-tab-id'
import { shouldSkipCodexHomeEnvForWindowsShell } from './pty-ipc-runtime-host-env-foundation'
import { agentHookServer } from '../agent-hooks/server'

type BindingRollbackReceipt = { rollbackIfCurrent: () => boolean }

export function createPtyIpcSpawnHandler(state: PtyRendererDeliveryContext & Record<string, any>): NonNullable<RuntimePtyController['spawn']> {
  const prepare = createPtyIpcSpawnPreparation(state)
  const {
    runtime, store, trustedTerminalHandleEnv, ptySizes, pendingPtySizes, ptyOwnership,
    getRelayPtyId,
    assertPtyCleanupComplete, assertSpawnReplyWasLive, stagePtyIncarnation,
    rollbackPtyIncarnation, commitPtyIncarnation, clearProviderPtyState, deletePtyOwnership,
    snapshotPtyCleanupAuthority, snapshotPtyPublication, restorePtyPublicationIfCurrent,
    registerPty, recordCodexPaneAccountForSpawn,
    rememberPaneKeyForPty, pendingByPaneKey, pendingPtyIdBySerializerGeneration,
    rendererSerializerReadiness, sendPtySpawnedToRenderer, resolvePaneSpawnReservation,
    rejectPaneSpawnReservation, cleanUpFailedFreshSpawn, transitionSpawnHiddenRendererPtyDeliveryState,
    clearMigrationUnsupportedPtysForPaneKey, closeStartupQueryAuthorityForPty,
    syncPtyBackgroundedDelivery, getSettings,
    getCohortAtEmit, agentKindSchema, launchSourceSchema, requestKindSchema, createTerminalSessionStateSaveFailureMessage,
    normalizeNodePtySpawnError, isSshPtyIdentityMismatchError, markClaudePtySpawned,
    markNativeWindowsConptyPty
  } = state

  return async (args: Record<string, any>) => {
    const preparation = await prepare(args)
    if (preparation.kind === 'duplicate') {
      return await preparation.promise
    }
    const prepared = preparation.prepared
    let {
      spawnTiming, startupCwdFallback, cwd, provider, isClaudeLaunch, isDaemonHostSpawn, isMintedSessionId,
      effectiveSessionId, effectiveSessionAppId, effectiveSessionRelayId, expectedWslDistro,
      metadataLeafId, legacySpawnPaneKey, migrationUnsupportedPaneKey,
      effectiveLaunchConfig, preAllocatedHandle,
      validatedPaneKey, reservationPaneKey, validatedLeafId, effectiveShellOverride,
      nativeWindowsConptySpawn, codexSelectionTarget, codexResumeLaunch, codexResumeHome, launchCommand,
      selectedCodexHomePath, spawnOptions, publicationSnapshot, hadSessionSizeBeforeAttach,
      sessionSizeBeforeAttach, finishTerminalInstall, paneSpawnReservation,
      initiallyHidden, preSpawnHiddenMarkId
    } = prepared
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
        if (preAllocatedHandle) {
          trustedTerminalHandleEnv.add(preAllocatedHandle)
        }
        spawnTiming.mark('options')
        const expectedPtyId = effectiveSessionAppId ?? effectiveSessionId
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
        const cleanupAuthorityBeforeProviderSpawn = snapshotPtyCleanupAuthority(expectedPtyId)
        result = await provider.spawn(spawnOptions)
        rejectedRegistrationCandidate = result
        if (expectedPtyId === result.id) {
          assertPtyCleanupComplete(result.id, cleanupAuthorityBeforeProviderSpawn)
        }
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
        assertSpawnReplyWasLive(result)
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
        spawnTiming.mark('provider_spawn')
      } catch (err) {
        if ((isMintedSessionId || preparedProvisionalExecutionContext) && effectiveSessionAppId) {
          runtime?.preparePtyExecutionContext?.(effectiveSessionAppId, null, {
            resetIncarnation: true
          })
        }
        // Why: a stale hidden mark on this session id would gate a later visible attach that reuses it.
        if (preSpawnHiddenMarkId !== null) {
          transitionSpawnHiddenRendererPtyDeliveryState(preSpawnHiddenMarkId, false)
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
          // Why: expired remote reattach = relay already dropped the PTY; clear the lease so writes can't restore the stale binding.
          if (effectiveSessionAppId !== undefined && !isIdentityMismatch) {
            clearProviderPtyState(effectiveSessionAppId)
            deletePtyOwnership(effectiveSessionAppId)
          }
          if (!isIdentityMismatch) {
            store?.markSshRemotePtyLease(args.connectionId, effectiveSessionRelayId, 'expired')
          }
        }
        // Why: provider state buildPtyHostEnv materialized for this minted id leaks if spawn failed.
        if (isMintedSessionId && effectiveSessionId !== undefined) {
          clearProviderPtyState(effectiveSessionId)
        }
        // Why: telemetry-plan.md§agent_error — attribute the error to the renderer-threaded agent_kind, else sniff the command for `claude`; raw messages are dropped at the validator boundary.
        const rendererAgentKindParse =
          args.telemetry?.agent_kind !== undefined
            ? agentKindSchema.safeParse(args.telemetry.agent_kind)
            : null
        const errorAgentKind = rendererAgentKindParse?.success
          ? rendererAgentKindParse.data
          : isClaudeLaunch
            ? ('claude-code' as const)
            : null
        if (errorAgentKind) {
          const classified = classifyError(spawnError)
          track('agent_error', {
            agent_kind: errorAgentKind,
            error_class: classified.error_class,
            ...getCohortAtEmit()
          })
        }
        if (!rawMessage.includes(SSH_SESSION_EXPIRED_ERROR) && publicationSnapshot) {
          restorePtyPublicationIfCurrent(publicationSnapshot, failedPublicationStateToken)
        }
        throw spawnError
      } finally {
        if (preAllocatedHandle) {
          trustedTerminalHandleEnv.delete(preAllocatedHandle)
        }
      }
      spawnTiming.log(result.id, {
        daemon: isDaemonHostSpawn,
        reattach: result.isReattach ?? false
      })
      const relayResultId = getRelayPtyId(args.connectionId, result.id)
      // Why: patch the load-bearing ptyId binding synchronously so a force-quit in the renderer's ~450 ms debounce window can't orphan daemon history or an SSH relay lease (Issue #217).
      if (
        store &&
        typeof args.worktreeId === 'string' &&
        typeof args.tabId === 'string' &&
        validatedLeafId !== null
      ) {
        try {
          const binding = {
            worktreeId: args.worktreeId,
            tabId: args.tabId,
            leafId: validatedLeafId,
            ptyId: result.id,
            ...(result.incarnationId ? { incarnationId: result.incarnationId } : {}),
            ...(cwd ? { startupCwd: cwd } : {})
          }
          bindingRollbackReceipt = args.connectionId
            ? store.persistPtyBinding(binding, toSshExecutionHostId(args.connectionId))
            : store.persistPtyBinding(binding)
        } catch (err) {
          console.error('[pty] failed to persist PTY binding after spawn:', err)
          throw Object.assign(new Error(createTerminalSessionStateSaveFailureMessage()), {
            agentSessionOperationOutcome: 'unknown' as const
          })
        }
      }
      recordCodexPaneAccountForSpawn({
        ptyId: result.id,
        isDaemonHostSpawn,
        isReattach: result.isReattach === true,
        pinnedByResume: Boolean(codexResumeHome),
        launchCodexHomePath: selectedCodexHomePath,
        target: codexSelectionTarget,
        settings: getSettings?.()
      })
      if (preAllocatedHandle) {
        runtime?.registerPreAllocatedHandleForPty(result.id, preAllocatedHandle)
      }
      if (initiallyHidden) {
        transitionSpawnHiddenRendererPtyDeliveryState(result.id, true)
        if (preSpawnHiddenMarkId !== null && preSpawnHiddenMarkId !== result.id) {
          transitionSpawnHiddenRendererPtyDeliveryState(preSpawnHiddenMarkId, false)
        }
        syncPtyBackgroundedDelivery(result.id, 'spawn')
        closeStartupQueryAuthorityForPty(result.id)
      }
      if (nativeWindowsConptySpawn) {
        markNativeWindowsConptyPty(result.id)
      }
      // Why: when the renderer has declared it will own the serializer for this paneKey, suppress the daemon-snapshot seed so its hydration path is sole authority (keyed on paneKey since the ptyId isn't known yet). See docs/mobile-prefer-renderer-scrollback.md.
      const rendererPreSignaled = validatedPaneKey
        ? pendingByPaneKey.has(validatedPaneKey)
        : false
      const rendererAlreadyRegistered =
        result.isReattach === true &&
        !rendererPreSignaled &&
        rendererSerializerReadiness.has(result.id)
      rendererSerializerReadiness.beginIncarnation(result.id, rendererAlreadyRegistered)
      // Why: capture the pending gen at spawn time so this PTY's teardown only settles its own generation, not a remount that replaced the entry.
      if (validatedPaneKey && rendererPreSignaled) {
        const pending = pendingByPaneKey.get(validatedPaneKey)
        if (pending) {
          pendingPtyIdBySerializerGeneration.set(pending.gen, result.id)
        }
      }

      // Why: seed the headless emulator before registerPty so concurrent live PTY data lands on top of the seed, not replacing it (mobile keeps the daemon-restored scrollback).
      // Skip when the renderer will be authoritative — its xterm buffer is richer than the daemon snapshot.
      if (runtime && !rendererPreSignaled && !rendererAlreadyRegistered) {
        const snapshotSeedSize =
          typeof result.snapshotCols === 'number' && typeof result.snapshotRows === 'number'
            ? { cols: result.snapshotCols, rows: result.snapshotRows }
            : undefined
        if (typeof result.snapshot === 'string' && result.snapshot.length > 0) {
          // Why kitty flags ride seed metadata: the snapshot omits them, but the re-seeded emulator must answer hidden `CSI ? u` with the running app's flags (terminal-query-authority.md).
          runtime.seedHeadlessTerminal(
            result.id,
            result.snapshot,
            snapshotSeedSize,
            typeof result.snapshotKittyKeyboardFlags === 'number'
              ? { kittyKeyboardFlags: result.snapshotKittyKeyboardFlags }
              : {}
          )
        } else if (
          result.coldRestore &&
          typeof result.coldRestore.scrollback === 'string' &&
          result.coldRestore.scrollback.length > 0
        ) {
          const coldRestoreSeedSize =
            typeof result.coldRestore.cols === 'number' &&
            typeof result.coldRestore.rows === 'number'
              ? { cols: result.coldRestore.cols, rows: result.coldRestore.rows }
              : undefined
          runtime.seedHeadlessTerminal(
            result.id,
            result.coldRestore.scrollback,
            coldRestoreSeedSize,
            {
              cwd: result.coldRestore.cwd,
              oscLinks: result.coldRestore.oscLinks,
              preferProviderIfExisting: true
            }
          )
        } else if (typeof result.replay === 'string' && result.replay.length > 0) {
          // Why: the relay reattach replay is the one restore main never ingests, so without
          // this seed its model is a mere suffix of what the renderer painted — and a later
          // park-reveal would outrank the fuller relay replay with that fragment.
          runtime.seedHeadlessTerminal(result.id, result.replay)
        }
      }
      if (
        typeof args.worktreeId === 'string' &&
        args.worktreeId.length > 0 &&
        args.worktreeId.length <= 512
      ) {
        const registeredIncarnation = runtime?.registerPty(
          result.id,
          args.worktreeId,
          args.connectionId ?? null,
          // Why: pass validated pane identity so a throttled mobile create publishes its surface main-side instead of destroying the live PTY (#7587); bound the untrusted tabId.
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
            ? shouldSkipCodexHomeEnvForWindowsShell(effectiveShellOverride, cwd)
            : undefined
        )
        result.incarnationId ??= registeredIncarnation ?? undefined
        pendingRegistrationPtyId = null
      } else if (pendingRegistrationPtyId) {
        if (result.incarnationId) {
          runtime?.admitHeadlessPtyLifecycle?.(pendingRegistrationPtyId, result.incarnationId)
        } else {
          runtime?.cancelPendingPtyRegistration?.(pendingRegistrationPtyId)
        }
        pendingRegistrationPtyId = null
      }
      // Why: arm main's per-PTY Command Code output detector from the launch command (startupCommand parity); banner detection covers PTYs without one.
      runtime?.noteTerminalSpawnCommand?.(
        result.id,
        typeof launchCommand === 'string' ? launchCommand : null
      )
      if (isClaudeLaunch) {
        markClaudePtySpawned(result.id)
      }
      // Why: record the paneKey mapping so clearProviderPtyState can clear the agent-hooks server's per-paneKey caches on exit.
      // Why: args.env is untrusted IPC JSON (type unenforced); bound the paneKey so malformed/oversized values can't pollute ptyPaneKey or clearPaneState.
      const rememberedPaneKey = validatedPaneKey
        ? rememberPaneKeyForPty(result.id, validatedPaneKey)
        : null
      if (legacySpawnPaneKey && migrationUnsupportedPaneKey) {
        agentHookServer.registerPaneKeyAlias(
          legacySpawnPaneKey.paneKey,
          migrationUnsupportedPaneKey,
          result.id,
          Date.now(),
          { authorityVerified: true }
        )
        clearMigrationUnsupportedPtysForPaneKey(migrationUnsupportedPaneKey)
      } else if (validatedPaneKey) {
        if (!result.isReattach) {
          clearMigrationUnsupportedPtysForPaneKey(validatedPaneKey)
        }
      }
      // Why: register only local PTYs with the memory collector — SSH PTYs run remotely and their process tree is invisible to our local `ps`.
      if (!args.connectionId) {
        // Why: record the spawn-result pid once here so the memory module needn't reach back into ipc/pty on a hot path (works for in-process and daemon-hosted PTYs).
        const spawnedPid = result.pid ?? null
        // Why: args.worktreeId/sessionId arrive as untrusted IPC strings (type unenforced at the boundary); bound them so malformed/oversized values can't pollute registerPty's maps.
        registerPty({
          ptyId: result.id,
          worktreeId:
            typeof args.worktreeId === 'string' &&
            args.worktreeId.length > 0 &&
            args.worktreeId.length <= 512
              ? args.worktreeId
              : null,
          sessionId:
            typeof args.sessionId === 'string' &&
            args.sessionId.length > 0 &&
            args.sessionId.length <= 256
              ? args.sessionId
              : null,
          paneKey: rememberedPaneKey,
          pid:
            typeof spawnedPid === 'number' && Number.isFinite(spawnedPid) && spawnedPid > 0
              ? spawnedPid
              : null
        })
      }
      commitPtyIncarnation(result.id, result.incarnationId)
      ptyOwnership.set(result.id, args.connectionId ?? null)
      ptySizes.set(result.id, { cols: args.cols, rows: args.rows })
      pendingPtySizes.delete(result.id)
      if (store && args.connectionId) {
        store.upsertSshRemotePtyLease({
          targetId: args.connectionId,
          ptyId: relayResultId,
          ...(typeof args.worktreeId === 'string' ? { worktreeId: args.worktreeId } : {}),
          ...(typeof args.tabId === 'string' ? { tabId: args.tabId } : {}),
          ...(validatedLeafId ? { leafId: validatedLeafId } : {}),
          state: 'attached',
          lastAttachedAt: Date.now()
        })
      }
      // Why: telemetry-plan.md§Agent launch semantics — fire agent_started only after spawn resolved; safeParse each field so a spoofed IPC payload can't poison the event (missing required field skips it).
      if (args.telemetry) {
        const agentKindParse = agentKindSchema.safeParse(args.telemetry.agent_kind)
        const launchSourceParse = launchSourceSchema.safeParse(args.telemetry.launch_source)
        const requestKindParse = requestKindSchema.safeParse(args.telemetry.request_kind)
        if (agentKindParse.success && launchSourceParse.success && requestKindParse.success) {
          track('agent_started', {
            agent_kind: agentKindParse.data,
            launch_source: launchSourceParse.data,
            request_kind: requestKindParse.data,
            ...getCohortAtEmit()
          })
        }
      }
      const response = {
        ...result,
        ...(!result.isReattach && effectiveLaunchConfig
          ? { launchConfig: effectiveLaunchConfig }
          : {}),
        // Why: a daemon-retry race can surface isReattach even for a minted session id, and a reattach must never claim its cwd was remapped.
        ...(startupCwdFallback && !result.isReattach ? { startupCwdFallback } : {}),
        // Why: the pane asked to resume and got a fresh session instead; only the
        // renderer can say so, and a reattach never ran this launch command.
        ...(codexResumeLaunch.notifyResumeUnavailable && !result.isReattach
          ? { agentResumeUnavailable: true as const }
          : {})
      }
      // Why: renderer tab state cannot reliably infer background and reattached PTYs in the daemon inventory.
      sendPtySpawnedToRenderer(result.id)
      return resolvePaneSpawnReservation(reservationPaneKey, paneSpawnReservation, response)
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
              restorePtyPublicationIfCurrent(
                publicationSnapshot,
                failedPublicationStateToken
              )
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
      // Why: once the reservation is created, any later throw —
      // spawn failure, persist failure, or a post-spawn helper such as
      // seedHeadlessTerminal/registerPty/track — must settle it. Otherwise
      // it lingers in paneSpawnReservationsByPaneKey and every future spawn
      // for this pane awaits a promise that never resolves. reject is a
      // no-op once the reservation has already resolved.
      rejectPaneSpawnReservation(reservationPaneKey, paneSpawnReservation, err)
      throw err
    } finally {
      releaseWorktreeSpawn?.()
      finishTerminalInstall()
    }
  }
}
