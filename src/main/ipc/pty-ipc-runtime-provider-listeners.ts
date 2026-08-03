import { LocalPtyProvider } from '../providers/local-pty-provider'
import type { IPtyProvider } from '../providers/types'
import { SshPtyOutputIntake } from './ssh-pty-output-intake'
import { installSshPtyOutputIntake, publishSshPtySourceAck, cancelSshPtySourceDelivery } from './ssh-pty-output-intake-registry'
import {
  clearSupersededPtyLifecycle,
  consumeProviderClearedPtyExit,
  consumeSupersededPtyExit,
  deletePendingPtyCleanupExact,
  hasPendingPtyCleanupExact,
  isCurrentPendingPtyCleanupEntry,
  isPtyStateClearedAfterPendingCleanup,
  isSupersededPtyCleanup,
  providerProvesPtyIncarnationAbsent,
  rememberSupersededPtyExit,
  schedulePendingPtyCleanupReconciliation
} from './pty-ipc-runtime-cleanup-reconciliation'
import {
  capturePtyLifecycleTarget,
  isCurrentPtyExit,
  isCurrentPtyLifecycleTarget,
  rememberSshPtyExitFinalization
} from './pty-ipc-runtime-provider-routing'
import { clearProviderPtyState } from './pty-ipc-runtime-provider-lifecycle-state'
import { markClaudePtyExited } from '../claude-accounts/live-pty-gate'
import { getPtyRegistrationSharedState } from './pty-ipc-runtime-registration-shared-state'
import { ptyRuntimeState } from './pty-ipc-runtime-state'
import type {
  PtyRendererDeliveryContext,
  PtyShutdownObservation,
  PtyShutdownTarget
} from './pty-ipc-runtime-renderer-delivery-context'
import { capturePtyShutdownTarget } from './pty-ipc-runtime-shutdown-state'

export function installPtyProviderListeners(): PtyRendererDeliveryContext {
  const state = getPtyRegistrationSharedState() as PtyRendererDeliveryContext
  const { mainWindow, runtime } = state
  state.sshOutputIntake = new SshPtyOutputIntake({
    getModelSequence: (id) => runtime?.getPtyOutputSequence(id) ?? 0,
    acceptModel: (event, projection) => {
      if (!runtime) {
        throw new Error('SSH PTY output requires the main terminal model')
      }
      return runtime.acceptPtyDataBounded(
        event.id,
        event.data,
        Date.now(),
        event.rawLength,
        event.transformed,
        projection.desktopSpan ? [projection.desktopSpan] : undefined,
        event.ptyIncarnation
      )
    },
    project: (event, projection) =>
      state.acceptPtyDataForRenderer(
        {
          id: event.id,
          incarnationId: event.ptyIncarnation,
          data: event.data,
          sequenceChars: event.rawLength,
          transformed: event.transformed
        },
        projection.identity.sequenceEnd,
        projection
      ),
    prepareExit: (event) => {
      const release = state.preparePtyExitForRenderer(event)
      if (!release) {
        throw new Error('pty_renderer_exit_in_progress')
      }
      return release
    },
    finalizeExit: (event) => {
      runtime?.onPtyExit(event.id, event.code, event.ptyIncarnation)
      state.finalizePtyExitForRenderer(event)
      rememberSshPtyExitFinalization(event.id, event.ptyIncarnation)
    },
    pauseProvider: (generation, id) => {
      const provider = ptyRuntimeState.sshProvidersByGeneration.get(generation) as
        | (IPtyProvider & { hasPtyDeliveryPauseAdapter?: () => boolean })
        | undefined
      if (!provider?.hasPtyDeliveryPauseAdapter?.()) {
        return false
      }
      provider.pauseProducer?.(id)
      return true
    },
    resumeProvider: (generation, id) =>
      ptyRuntimeState.sshProvidersByGeneration.get(generation)?.resumeProducer?.(id),
    closeProvider: (generation, reason) => {
      const provider = ptyRuntimeState.sshProvidersByGeneration.get(generation)
      ;(
        provider as (IPtyProvider & { closeOutputIntake?: (reason: string) => void }) | undefined
      )?.closeOutputIntake?.(reason)
    },
    resetModelForMigration: (_generation, id) => runtime?.resetPtyModelAfterMigrationFailure(id),
    onGenerationClosed: (providerGeneration) => {
      for (const id of state.pendingData.keys()) {
        const pending = state.pendingData.get(id)
        if (
          pending?.projectionAdmissionIds &&
          state.sshOutputIntake?.hasProjectionFromGeneration(
            pending.projectionAdmissionIds,
            providerGeneration
          )
        ) {
          state.pendingData.delete(id)
          state.updateProducerFlowControl(id)
          state.pendingOverflowMarkedPtys.delete(id)
        }
      }
      ptyRuntimeState.sshProvidersByGeneration.delete(providerGeneration)
    },
    publishSourceAck: publishSshPtySourceAck,
    cancelSourceDelivery: cancelSshPtySourceDelivery
  })
  runtime?.setRemoteTerminalSourceRangeConsumerHooks?.(
    state.sshOutputIntake.getRemoteSourceRangeConsumerHooks()
  )
  const cleanupSshOutputIntakeRegistry = installSshPtyOutputIntake(state.sshOutputIntake)
  ptyRuntimeState.sshOutputIntakeCleanup = () => {
    runtime?.setRemoteTerminalSourceRangeConsumerHooks?.(null)
    cleanupSshOutputIntakeRegistry()
  }

  state.ptyShutdownTargetsInFlightById = new Map<string, Set<PtyShutdownTarget>>()

  async function shutdownProviderAndDetectExit(
    provider: IPtyProvider,
    id: string,
    opts: { immediate?: boolean; keepHistory?: boolean; deadlineMs?: number }
  ): Promise<PtyShutdownObservation> {
    let providerExitObserved = false
    let identityLessExitPayload: PtyShutdownObservation['identityLessExitPayload']
    const expectedTarget = capturePtyShutdownTarget(id, provider)
    const expectedIncarnationId = expectedTarget.incarnationId
    const unsubscribe = provider.onExit((payload) => {
      if (payload.id !== id) {
        return
      }
      const providerIncarnationId =
        payload.incarnationId ??
        ('ptyIncarnation' in payload && typeof payload.ptyIncarnation === 'string'
          ? payload.ptyIncarnation
          : undefined)
      if (expectedIncarnationId !== undefined) {
        if (providerIncarnationId === expectedIncarnationId) {
          providerExitObserved = true
        }
        return
      }
      if (providerIncarnationId === undefined) {
        if (ptyRuntimeState.ptyStateTokenById.get(id) === expectedTarget.stateToken) {
          providerExitObserved = true
          identityLessExitPayload ??= payload
        }
        return
      }
      providerExitObserved = true
    })
    const shutdownTargets = state.ptyShutdownTargetsInFlightById.get(id) ?? new Set()
    shutdownTargets.add(expectedTarget)
    state.ptyShutdownTargetsInFlightById.set(id, shutdownTargets)
    try {
      await provider.shutdown(id, opts)
    } finally {
      shutdownTargets.delete(expectedTarget)
      if (shutdownTargets.size === 0) {
        state.ptyShutdownTargetsInFlightById.delete(id)
      }
      unsubscribe()
    }
    return {
      providerExitObserved,
      ...(identityLessExitPayload ? { identityLessExitPayload } : {})
    }
  }

  // Why extracted: the "Restart daemon" flow rebinds against the fresh adapter after replaceDaemonProvider, sharing this code path with startup registration.
  const bindProviderListeners = (): void => {
    const boundProvider = ptyRuntimeState.localProvider
    const isLocalProvider = boundProvider instanceof LocalPtyProvider
    ptyRuntimeState.localDataUnsub?.()
    ptyRuntimeState.localExitUnsub?.()
    ptyRuntimeState.localBackgroundStreamUnsub?.()
    ptyRuntimeState.localWriteUnavailableUnsub?.()

    // Why: a daemon death takes down every session at once. The provider signals
    // each affected pane here so background panes remount + re-attach too, not
    // just the pane whose write happened to detect the dead endpoint (STA-2373).
    ptyRuntimeState.localWriteUnavailableUnsub =
      boundProvider.onWriteUnavailable?.((payload) => {
        if (ptyRuntimeState.localProvider !== boundProvider) {
          return
        }
        if (
          mainWindow.isDestroyed() ||
          (typeof mainWindow.webContents.isDestroyed === 'function' &&
            mainWindow.webContents.isDestroyed())
        ) {
          return
        }
        mainWindow.webContents.send('pty:writeUnavailable', { id: payload.id })
      }) ?? null

    // Daemon keep-tail thinning facts, in byte order with onData: markers flip transient-fact scan authority; a gap forces renderer restore from the snapshot.
    ptyRuntimeState.localBackgroundStreamUnsub =
      boundProvider.onBackgroundStreamEvent?.((payload) => {
        if (ptyRuntimeState.localProvider !== boundProvider) {
          return
        }
        if (payload.kind === 'backgroundMarker') {
          runtime?.setPtyTransientFactDelegation(
            payload.id,
            payload.background,
            payload.scanSeedAnsi,
            payload.mode2031PendingSubscribe
          )
          return
        }
        if (payload.kind === 'dataGap') {
          ptyRuntimeState.providerSnapshotRequiredPtys.add(payload.id)
          runtime?.notePtyDataGap(payload.id, payload.sequenceChars ?? payload.droppedChars)
          state.sendModelRestoreNeededMarker(
            payload.id,
            'hidden-drop',
            runtime?.getPtyOutputSequence(payload.id)
          )
          return
        }
        runtime?.emitDaemonPtyTransientFact(payload.id, payload.fact)
      }) ?? null

    ptyRuntimeState.localDataUnsub = boundProvider.onData((payload) => {
      if (ptyRuntimeState.localProvider !== boundProvider) {
        return
      }
      if (payload.incarnationId !== undefined) {
        // Why: current-provider data is authoritative evidence that a new live lifecycle has appeared after teardown.
        ptyRuntimeState.clearedPtyLifecycleIds.delete(payload.id)
      }
      if (hasPendingPtyCleanupExact(payload.id, payload.incarnationId)) {
        return
      }
      if (payload.incarnationId !== undefined) {
        const currentIncarnation = ptyRuntimeState.ptyIncarnationById.get(payload.id)
        const pendingIncarnation = ptyRuntimeState.pendingPtyIncarnationById.get(payload.id)
        if (
          (currentIncarnation !== undefined && currentIncarnation !== payload.incarnationId) ||
          (pendingIncarnation !== undefined && pendingIncarnation !== payload.incarnationId)
        ) {
          return
        }
        if (
          currentIncarnation === undefined &&
          pendingIncarnation === undefined &&
          boundProvider.hasPty?.(payload.id) === true
        ) {
          ptyRuntimeState.ptyIncarnationById.set(payload.id, payload.incarnationId)
          ptyRuntimeState.ptyStateTokenById.set(payload.id, Symbol(payload.id))
        }
      }
      const rawLength = payload.sequenceChars ?? payload.data.length
      const admission = runtime?.acceptPtyDataBounded
        ? runtime.acceptPtyDataBounded(
            payload.id,
            payload.data,
            Date.now(),
            rawLength,
            payload.transformed,
            undefined,
            payload.incarnationId
          )
        : runtime?.onPtyData
          ? {
              admitted: true,
              sequence: runtime.onPtyData(
                payload.id,
                payload.data,
                Date.now(),
                rawLength,
                payload.transformed
              )
            }
          : boundProvider.hasPty?.(payload.id) === true
            ? { admitted: true, sequence: undefined }
            : undefined
      if (admission?.admitted !== true) {
        return
      }
      state.acceptPtyDataForRenderer(payload, admission?.sequence)
    })
    const handleProviderExit = (
      payload: {
        id: string
        code: number
        incarnationId?: string
      },
      verification: { identityLessAbsenceProven?: boolean; stateToken?: symbol } | undefined,
      provider: IPtyProvider
    ): void => {
      if (ptyRuntimeState.localProvider !== provider) {
        return
      }
      if (consumeSupersededPtyExit(payload)) {
        return
      }
      if (hasPendingPtyCleanupExact(payload.id, payload.incarnationId)) {
        const cleanupPending = ptyRuntimeState.cleanupPendingPtyById.get(payload.id)?.get(payload.incarnationId)
        if (!cleanupPending) {
          return
        }
        const finalizeExactCleanupExit = (): void => {
          if (
            ptyRuntimeState.localProvider !== provider ||
            !isCurrentPendingPtyCleanupEntry(payload.id, cleanupPending)
          ) {
            return
          }
          let restored = false
          try {
            restored = state.foundation.restorePublicationAfterExactCleanup(
              { id: payload.id, incarnationId: payload.incarnationId },
              cleanupPending.publicationSnapshot ?? null,
              true,
              cleanupPending.failedStateToken
            )
          } catch (error) {
            // Why: the provider exit is authoritative, but a projection failure must leave the exact tombstone retryable.
            console.warn('[pty] exact cleanup finalizer failed after provider exit:', error)
            schedulePendingPtyCleanupReconciliation(provider)
            return
          }
          if (!restored) {
            const currentAfterCleanup = ptyRuntimeState.ptyIncarnationById.get(payload.id)
            const pendingAfterCleanup = ptyRuntimeState.pendingPtyIncarnationById.get(payload.id)
            const supersededAfterCleanup =
              isSupersededPtyCleanup(payload.id, cleanupPending) ||
              (currentAfterCleanup !== undefined &&
                currentAfterCleanup !== payload.incarnationId) ||
              (pendingAfterCleanup !== undefined && pendingAfterCleanup !== payload.incarnationId)
            if (supersededAfterCleanup && payload.incarnationId !== undefined) {
              rememberSupersededPtyExit(payload.id, payload.incarnationId)
            }
            if (
              !supersededAfterCleanup &&
              !isPtyStateClearedAfterPendingCleanup(payload.id, cleanupPending)
            ) {
              // Why: an identity-less replacement has no exact lifecycle to fence the failed exit; reconciliation must prove its absence.
              return
            }
            deletePendingPtyCleanupExact(payload.id, payload.incarnationId)
            return
          }
          deletePendingPtyCleanupExact(payload.id, payload.incarnationId)
          // Why: preserve the provider incarnation so the renderer can retire delayed data for this id.
          const currentAfterCleanup = ptyRuntimeState.ptyIncarnationById.get(payload.id)
          const pendingAfterCleanup = ptyRuntimeState.pendingPtyIncarnationById.get(payload.id)
          if (
            pendingAfterCleanup === undefined &&
            (currentAfterCleanup === undefined || currentAfterCleanup === payload.incarnationId)
          ) {
            state.sendPtyExitToRenderer(payload)
          }
        }

        // Why: a delayed exact exit can arrive after same-id replacement; provider inventory is the authority for that race.
        void providerProvesPtyIncarnationAbsent(provider, payload.id, payload.incarnationId)
          .then((absenceProof) => {
            if (
              ptyRuntimeState.localProvider !== provider ||
              !isCurrentPendingPtyCleanupEntry(payload.id, cleanupPending)
            ) {
              return
            }
            if (absenceProof.superseded) {
              if (payload.incarnationId !== undefined) {
                rememberSupersededPtyExit(payload.id, payload.incarnationId)
              }
              if (isCurrentPendingPtyCleanupEntry(payload.id, cleanupPending)) {
                deletePendingPtyCleanupExact(payload.id, payload.incarnationId)
                clearSupersededPtyLifecycle(payload.id, cleanupPending)
              }
              return
            }
            if (absenceProof.identityLessLive) {
              schedulePendingPtyCleanupReconciliation(provider)
              return
            }
            finalizeExactCleanupExit()
          })
          .catch((error) => {
            // Why: the exact provider exit remains authoritative when a follow-up inventory read is unavailable.
            console.warn('[pty] exact cleanup inventory recheck failed after provider exit:', error)
            if (payload.incarnationId === undefined) {
              return
            }
            finalizeExactCleanupExit()
          })
        return
      }
      const verifiedIdentityLessExit =
        verification?.identityLessAbsenceProven === true &&
        payload.incarnationId === undefined &&
        verification.stateToken !== undefined &&
        ptyRuntimeState.ptyStateTokenById.get(payload.id) === verification.stateToken
      const providerClearedExit = consumeProviderClearedPtyExit(payload)
      if (!isCurrentPtyExit(payload) && !verifiedIdentityLessExit && !providerClearedExit) {
        return
      }
      if (state.consumeSyntheticKillExit(payload)) {
        return
      }
      if (state.consumeFinalizedCleanupExit(payload)) {
        state.sendPtyExitToRenderer(payload)
        return
      }
      if (!isLocalProvider) {
        const currentIncarnation = ptyRuntimeState.ptyIncarnationById.get(payload.id)
        clearProviderPtyState(payload.id)
        ptyRuntimeState.ptyOwnership.delete(payload.id)
        markClaudePtyExited(payload.id)
        if (ptyRuntimeState.cleanupPendingPtyById.has(payload.id)) {
          schedulePendingPtyCleanupReconciliation(provider)
        }
        if (
          payload.incarnationId === undefined &&
          verification?.identityLessAbsenceProven === true
        ) {
          runtime?.onPtyExit(payload.id, payload.code, undefined, {
            authoritativeIdentityLess: true,
            ...(currentIncarnation ? { expectedIncarnationId: currentIncarnation } : {})
          })
        } else {
          runtime?.onPtyExit(payload.id, payload.code, payload.incarnationId)
        }
      }
      state.sendPtyExitToRenderer(payload)
    }
    ptyRuntimeState.localExitUnsub = boundProvider.onExit((payload) => {
      const incarnationId = payload.incarnationId
      if (incarnationId === undefined) {
        const stateToken = ptyRuntimeState.ptyStateTokenById.get(payload.id)
        const hasMatchingShutdownTarget =
          stateToken !== undefined &&
          [...(state.ptyShutdownTargetsInFlightById.get(payload.id) ?? [])].some(
            (target) => target.stateToken === stateToken
          )
        if (hasMatchingShutdownTarget) {
          // Why: an identity-less exit cannot distinguish the PTY being shut
          // down from a same-id replacement; the shutdown's inventory proof is
          // the only authoritative cleanup boundary while it is in flight.
          return
        }
      }
      const stateToken = ptyRuntimeState.ptyStateTokenById.get(payload.id)
      if (incarnationId === undefined && stateToken !== undefined) {
        // Why: legacy providers omit incarnation ids, so an old exit must not retire an id-reused PTY without an authoritative absence check.
        const lifecycleTarget = capturePtyLifecycleTarget(payload.id)
        void providerProvesPtyIncarnationAbsent(boundProvider, payload.id, undefined)
          .then((absenceProof) => {
            if (
              absenceProof.absent &&
              isCurrentPtyLifecycleTarget(payload.id, lifecycleTarget) &&
              ptyRuntimeState.ptyStateTokenById.get(payload.id) === stateToken
            ) {
              handleProviderExit(
                payload,
                {
                  identityLessAbsenceProven: true,
                  stateToken
                },
                boundProvider
              )
            }
          })
          .catch((error) => {
            console.warn('[pty] identity-less provider exit verification failed:', error)
          })
        return
      }
      handleProviderExit(payload, undefined, boundProvider)
    })
  }

  bindProviderListeners()
  schedulePendingPtyCleanupReconciliation(ptyRuntimeState.localProvider)
  ptyRuntimeState.rebindProviderListeners = bindProviderListeners


  Object.assign(state, {
    shutdownProviderAndDetectExit
  })
  ptyRuntimeState.rebindProviderListeners = bindProviderListeners
  return state
}
