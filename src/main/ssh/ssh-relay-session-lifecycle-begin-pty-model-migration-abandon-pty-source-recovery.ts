// Why: single authority for all relay lifecycle state per SSH target (previously scattered across module Maps/Sets with duplicated paths).

import type { PtySourceRecoveryRequest } from '../../shared/pty-source-recovery-contract'
import {
  applySshPtySourceRecoveryCancellationProof,
  beginSshPtyOutputGenerationMigration,
  closeSshPtyOutputGeneration,
  getSshPtyAcceptedSourceCheckpoints
} from '../ipc/ssh-pty-output-intake-registry'
import { toRelaySshPtyId } from '../providers/ssh-pty-id'
import type { SshPtyAttachResult } from '../providers/ssh-pty-session-reattach'

import * as foundation from './ssh-relay-session-lifecycle-foundation'
const { SSH_PTY_EXIT_RETIREMENT_MAX_EVIDENCE, SSH_PTY_EXIT_RETRY_MAX_ATTEMPTS, SSH_PTY_REATTACH_ATTEMPT_TIMEOUT_MS, SSH_PTY_REATTACH_MAX_CONCURRENCY, SSH_PTY_REATTACH_RETRY_JITTER_MS, SSH_PTY_REATTACH_RETRY_MIN_DELAY_MS, SSH_SOURCE_RECOVERY_CANCELLATION_FAILED, expectedIdentityForLease, isSourceRecoveryCancellationError, nonNegativeSafeInteger, normalizeRelayGracePeriodSeconds, parseRecoveryComplete, positiveSafeInteger, ptyConsumerRecoveryByTarget, ptyConsumerRecoveryForTarget, sourceRecoveryCancellationError } = foundation
type ExpectedPtyIdentity = foundation.ExpectedPtyIdentity
type PendingPtyReattach = foundation.PendingPtyReattach
type PtyConsumerRecovery = foundation.PtyConsumerRecovery
type RelaySessionState = foundation.RelaySessionState
type RemoteCliBridgeEnv = foundation.RemoteCliBridgeEnv
type SshPtyDataPayload = foundation.SshPtyDataPayload
type SshPtyExitPayload = foundation.SshPtyExitPayload
type SshPtyLease = foundation.SshPtyLease
type SshRelayAiVaultHostInfo = foundation.SshRelayAiVaultHostInfo

export const SshRelaySessionMethods16 = {
  beginPtyModelMigration(this: any, providerGeneration: number, closeReason: string): void {
    const recovery = ptyConsumerRecoveryByTarget.get(this.targetId)
    if (!recovery) {
      closeSshPtyOutputGeneration(providerGeneration, closeReason)
      return
    }
    for (const checkpoint of getSshPtyAcceptedSourceCheckpoints(providerGeneration)) {
      recovery.checkpointsByAppPtyId.set(checkpoint.id, checkpoint)
    }
    const migration = beginSshPtyOutputGenerationMigration(providerGeneration)
    for (const [ptyId, result] of migration.byPty) {
      const previous = recovery.modelMigrationsByAppPtyId.get(ptyId)
      const fence = previous ? previous.then(() => result) : result
      recovery.modelMigrationsByAppPtyId.set(ptyId, fence)
      void fence.then((outcome) => {
        const current = ptyConsumerRecoveryByTarget.get(this.targetId)
        if (current?.modelMigrationsByAppPtyId.get(ptyId) !== fence) {
          return
        }
        if (outcome.status === 'settled') {
          current.checkpointsByAppPtyId.set(ptyId, outcome.checkpoint)
        } else {
          current.checkpointsByAppPtyId.delete(ptyId)
          current.checkpointsByAppPtyId.delete(toRelaySshPtyId(this.targetId, ptyId))
        }
        current.modelMigrationsByAppPtyId.delete(ptyId)
      })
    }
    void migration.completion.then(() => {
      closeSshPtyOutputGeneration(providerGeneration, closeReason)
    })
  },
  async finishSourceRecovery(this: any,
    relayPtyId: string,
    appPtyId: string,
    attachResult: SshPtyAttachResult,
    request: PtySourceRecoveryRequest,
    pending: PendingPtyReattach,
    shouldContinue: () => boolean,
    activateRecoveryQuarantine: () => void
  ): Promise<boolean> {
    const recovery = attachResult.sourceRecovery
    const pendingRecovery = recovery?.status === 'pending' ? recovery : undefined
    const owner = this.negotiatedPtyConsumerOwner()
    if (
      !owner?.outputFlowControl ||
      !pendingRecovery ||
      request.status !== 'checkpoint' ||
      pendingRecovery.clientGeneration !== owner.clientGeneration ||
      pendingRecovery.ownerGeneration !== owner.ownerGeneration ||
      pendingRecovery.ptyIncarnation !== attachResult.incarnationId ||
      pendingRecovery.ptyIncarnation !== request.ptyIncarnation ||
      pendingRecovery.checkpointSourceEndSu !== request.acceptedSourceEndSu ||
      (pending.replacementDeliveryToken !== undefined &&
        pending.replacementDeliveryToken !== pendingRecovery.deliveryToken)
    ) {
      if (!shouldContinue() || !this.ownsPtyRecoveryAttempt(appPtyId, pending)) {
        return false
      }
      await this.abandonPtySourceRecovery(relayPtyId, appPtyId, pending)
      return false
    }
    const acceptedRecovery = pendingRecovery
    pending.recovery = acceptedRecovery
    pending.nextRecoverySourceSu = acceptedRecovery.checkpointSourceEndSu
    this.retiredSourceDeliveries.activate(relayPtyId)
    this.sourceIdentityByRelayPtyId.set(relayPtyId, {
      deliveryToken: acceptedRecovery.deliveryToken,
      clientGeneration: acceptedRecovery.clientGeneration,
      ownerGeneration: acceptedRecovery.ownerGeneration,
      ptyIncarnation: acceptedRecovery.ptyIncarnation,
      nextSourceSu: acceptedRecovery.checkpointSourceEndSu
    })
    activateRecoveryQuarantine()
    for (const payload of pending.queuedData.splice(0)) {
      this.routeQuarantinedReattachData(pending, payload)
    }
    await this.waitForRecoveryFence(pending, shouldContinue)
    const exactExit = this.findExactPendingExit(pending, acceptedRecovery.ptyIncarnation)
    const complete = pending.recoveryComplete ?? (exactExit ? acceptedRecovery : undefined)
    if (
      !shouldContinue() ||
      pending.restoreRequired ||
      !complete ||
      complete.deliveryToken !== acceptedRecovery.deliveryToken ||
      complete.clientGeneration !== acceptedRecovery.clientGeneration ||
      complete.ownerGeneration !== acceptedRecovery.ownerGeneration ||
      complete.ptyIncarnation !== acceptedRecovery.ptyIncarnation ||
      complete.checkpointSourceEndSu !== acceptedRecovery.checkpointSourceEndSu ||
      complete.recoveryEndSu !== acceptedRecovery.recoveryEndSu ||
      pending.nextRecoverySourceSu !== acceptedRecovery.recoveryEndSu
    ) {
      if (!shouldContinue() || !this.ownsPtyRecoveryAttempt(appPtyId, pending)) {
        return false
      }
      await this.abandonPtySourceRecovery(relayPtyId, appPtyId, pending)
      return false
    }
    let nextLiveSourceSu = acceptedRecovery.recoveryEndSu
    for (const payload of pending.liveData) {
      if (
        !payload.source ||
        payload.source.deliveryToken !== acceptedRecovery.deliveryToken ||
        payload.source.clientGeneration !== acceptedRecovery.clientGeneration ||
        payload.source.ownerGeneration !== acceptedRecovery.ownerGeneration ||
        payload.source.sourceStartSu !== nextLiveSourceSu ||
        payload.source.sourceEndSu <= payload.source.sourceStartSu ||
        payload.ptyIncarnation !== acceptedRecovery.ptyIncarnation
      ) {
        if (!shouldContinue() || !this.ownsPtyRecoveryAttempt(appPtyId, pending)) {
          return false
        }
        await this.abandonPtySourceRecovery(relayPtyId, appPtyId, pending)
        return false
      }
      nextLiveSourceSu = payload.source.sourceEndSu
    }
    try {
      for (const payload of pending.recoveryData) {
        await this.acceptPtyData(payload)
      }
      for (const payload of pending.liveData) {
        await this.acceptPtyData(payload)
      }
      pending.livePassthrough = true
    } catch {
      if (!shouldContinue() || !this.ownsPtyRecoveryAttempt(appPtyId, pending)) {
        return false
      }
      await this.abandonPtySourceRecovery(relayPtyId, appPtyId, pending)
      return false
    }
    if (!shouldContinue() || !this.ownsPtyRecoveryAttempt(appPtyId, pending)) {
      return false
    }
    const acceptedSourceEndSu = pending.liveData.reduce(
      (endSu, payload) => Math.max(endSu, payload.source?.sourceEndSu ?? endSu),
      acceptedRecovery.recoveryEndSu
    )
    // Why: checkpoints are app-id keyed; a relay-id entry here would be shadowed
    // by a staler app-id entry on the next sourceRecoveryRequest lookup.
    ptyConsumerRecoveryByTarget.get(this.targetId)?.checkpointsByAppPtyId.set(
      appPtyId,
      Object.freeze({
        id: appPtyId,
        providerGeneration: this.activePtyProviderGeneration!,
        clientGeneration: acceptedRecovery.clientGeneration,
        ownerGeneration: acceptedRecovery.ownerGeneration,
        ptyIncarnation: acceptedRecovery.ptyIncarnation,
        deliveryToken: acceptedRecovery.deliveryToken,
        acceptedSourceEndSu
      })
    )
    return true
  },
  async waitForRecoveryFence(this: any,
    pending: PendingPtyReattach,
    shouldContinue: () => boolean
  ): Promise<void> {
    const deadline = Date.now() + SSH_PTY_REATTACH_ATTEMPT_TIMEOUT_MS
    while (
      shouldContinue() &&
      !pending.recoveryComplete &&
      !pending.restoreRequired &&
      !this.findExactPendingExit(pending, pending.recovery?.ptyIncarnation) &&
      Date.now() < deadline
    ) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(
          () => {
            pending.recoveryWaiters.delete(settle)
            resolve()
          },
          Math.max(1, deadline - Date.now())
        )
        timer.unref?.()
        const settle = (): void => {
          clearTimeout(timer)
          resolve()
        }
        pending.recoveryWaiters.add(settle)
      })
    }
    if (
      !pending.recoveryComplete &&
      !pending.restoreRequired &&
      !this.findExactPendingExit(pending, pending.recovery?.ptyIncarnation)
    ) {
      pending.restoreRequired = 'recoveryFenceTimeout'
    }
  },
  async abandonPtySourceRecovery(this: any,
    relayPtyId: string,
    appPtyId: string,
    pending: PendingPtyReattach
  ): Promise<void> {
    if (!this.ownsPtyRecoveryAttempt(appPtyId, pending)) {
      return
    }
    const recovery = pending.recovery
    const { mux, providerGeneration } = pending
    if (recovery && !mux.isDisposed()) {
      const cancellationRequest = {
        id: relayPtyId,
        clientGeneration: recovery.clientGeneration,
        ownerGeneration: recovery.ownerGeneration,
        deliveryToken: recovery.deliveryToken
      }
      this.retiredSourceDeliveries.retire(providerGeneration, {
        relayPtyId,
        deliveryToken: recovery.deliveryToken,
        clientGeneration: recovery.clientGeneration,
        ownerGeneration: recovery.ownerGeneration
      })
      try {
        const result = (await mux.request('pty.cancelDelivery', cancellationRequest)) as Record<
          string,
          unknown
        >
        const highestPrivateSourceEndSu = pending.liveData.reduce(
          (endSu, payload) => Math.max(endSu, payload.source?.sourceEndSu ?? endSu),
          Math.max(
            pending.nextRecoverySourceSu ?? recovery.checkpointSourceEndSu,
            pending.highestRecoverySourceEndSu ?? recovery.checkpointSourceEndSu
          )
        )
        if (
          result.canceled !== true ||
          !Number.isSafeInteger(result.sentEndSu) ||
          (result.sentEndSu as number) < highestPrivateSourceEndSu ||
          !Number.isSafeInteger(result.creditedEndSu) ||
          result.creditedEndSu !== recovery.checkpointSourceEndSu ||
          (result.creditedEndSu as number) > (result.sentEndSu as number)
        ) {
          throw new Error('ssh_source_cancellation_proof_invalid')
        }
        if (!this.ownsPtyRecoveryAttempt(appPtyId, pending)) {
          return
        }
        const identity = this.sourceIdentityByRelayPtyId.get(relayPtyId)
        if (identity && !this.sameSourceDelivery(identity, recovery)) {
          return
        }
        if (identity) {
          const applied = applySshPtySourceRecoveryCancellationProof(
            {
              id: appPtyId,
              code: -1,
              providerGeneration,
              ptyIncarnation: recovery.ptyIncarnation
            },
            {
              sentEndSu: result.sentEndSu as number,
              creditedEndSu: result.creditedEndSu as number
            }
          )
          if (!applied) {
            throw new Error('ssh_source_cancellation_proof_rejected')
          }
        }
      } catch (error) {
        if (!this.ownsPtyRecoveryAttempt(appPtyId, pending)) {
          return
        }
        console.warn(
          `[ssh-relay-session] Failed to cancel replacement delivery for ${relayPtyId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
        throw sourceRecoveryCancellationError(error)
      }
    }
    if (!this.ownsPtyRecoveryAttempt(appPtyId, pending)) {
      return
    }
    const identity = this.sourceIdentityByRelayPtyId.get(relayPtyId)
    if (!identity || !recovery || this.sameSourceDelivery(identity, recovery)) {
      this.sourceIdentityByRelayPtyId.delete(relayPtyId)
    }
    ptyConsumerRecoveryByTarget.get(this.targetId)?.checkpointsByAppPtyId.delete(appPtyId)
    ptyConsumerRecoveryByTarget.get(this.targetId)?.checkpointsByAppPtyId.delete(relayPtyId)
    this.store.markSshRemotePtyLease(this.targetId, relayPtyId, 'detached')
  }
}
export type SshRelaySessionMethods16Surface = typeof SshRelaySessionMethods16
