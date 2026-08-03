// Why: single authority for all relay lifecycle state per SSH target (previously scattered across module Maps/Sets with duplicated paths).

import { acceptSshPtyOutputData, closeSshPtyOutputGeneration } from '../ipc/ssh-pty-output-intake-registry'

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

export const SshRelaySessionMethods10 = {
  schedulePtyExitRetry(this: any, payload: SshPtyExitPayload, error: unknown): void {
    const key = JSON.stringify([payload.providerGeneration, payload.id, payload.ptyIncarnation])
    const attempts = (this.ptyExitRetryAttempts.get(key) ?? 0) + 1
    if (attempts > SSH_PTY_EXIT_RETRY_MAX_ATTEMPTS) {
      console.error('[ssh-relay-session] PTY exit retirement retries exhausted:', error)
      return
    }
    this.ptyExitRetryAttempts.set(key, attempts)
    // Why: provider exits are one-shot; retry the same authoritative payload after transient cleanup failure.
    setTimeout(() => {
      void this.acceptPtyExitOnce(payload).catch(() => {})
    }, 0)
  },
  acceptPtyData(this: any, payload: SshPtyDataPayload): Promise<unknown> {
    const consumerOwner = this.negotiatedPtyConsumerOwner()
    const offeredSource = payload.source
    if (
      offeredSource &&
      this.retiredSourceDeliveries.has(payload.providerGeneration, offeredSource)
    ) {
      return Promise.resolve()
    }
    if (
      consumerOwner?.outputFlowControl &&
      (!offeredSource ||
        payload.sourceMalformed ||
        offeredSource.clientGeneration !== consumerOwner.clientGeneration ||
        offeredSource.ownerGeneration !== consumerOwner.ownerGeneration)
    ) {
      closeSshPtyOutputGeneration(
        payload.providerGeneration,
        'ssh_source_frame_malformed_or_missing'
      )
      this.mux?.dispose('connection_lost')
      return Promise.reject(new Error('ssh_source_frame_malformed_or_missing'))
    }
    const source = consumerOwner?.outputFlowControl ? offeredSource : undefined
    if (source) {
      const current = this.sourceIdentityByRelayPtyId.get(source.relayPtyId)
      if (
        source.sourceEndSu <= source.sourceStartSu ||
        (current &&
          (current.deliveryToken !== source.deliveryToken ||
            current.clientGeneration !== source.clientGeneration ||
            current.ownerGeneration !== source.ownerGeneration ||
            current.ptyIncarnation !== payload.ptyIncarnation ||
            (current.nextSourceSu !== undefined && current.nextSourceSu !== source.sourceStartSu)))
      ) {
        closeSshPtyOutputGeneration(
          payload.providerGeneration,
          'ssh_source_frame_stale_or_non_contiguous'
        )
        this.mux?.dispose('connection_lost')
        return Promise.reject(new Error('ssh_source_frame_stale_or_non_contiguous'))
      }
      this.sourceIdentityByRelayPtyId.set(source.relayPtyId, {
        deliveryToken: source.deliveryToken,
        clientGeneration: source.clientGeneration,
        ownerGeneration: source.ownerGeneration,
        ptyIncarnation: payload.ptyIncarnation,
        nextSourceSu: source.sourceEndSu
      })
    }
    const rawLength = payload.sequenceChars ?? payload.data.length
    return acceptSshPtyOutputData({
      id: payload.id,
      data: payload.data,
      providerGeneration: payload.providerGeneration,
      ptyIncarnation: payload.ptyIncarnation,
      rawLength,
      transformed: payload.transformed === true,
      ...(typeof payload.seq === 'number' ? { sequence: payload.seq } : {}),
      ...(source ? { source } : {})
    })
  },
  quarantineReattachData(this: any, pending: PendingPtyReattach, payload: SshPtyDataPayload): void {
    this.observePrivateRecoveryFrame(pending, payload)
    if (pending.restoreRequired) {
      return
    }
    const sourceSu = payload.source
      ? payload.source.sourceEndSu - payload.source.sourceStartSu
      : (payload.sequenceChars ?? payload.data.length)
    if (!this.ptyRecoveryRetention.tryRetain(pending.retentionKey, payload.data, sourceSu)) {
      pending.restoreRequired = 'recoveryQuarantineCapacityExceeded'
      this.wakeRecovery(pending)
      return
    }
    this.routeQuarantinedReattachData(pending, payload)
  },
  routeQuarantinedReattachData(this: any,
    pending: PendingPtyReattach,
    payload: SshPtyDataPayload
  ): void {
    this.observePrivateRecoveryFrame(pending, payload)
    if (!pending.recovery) {
      pending.queuedData.push(payload)
      return
    }
    if (
      pending.recoveryComplete &&
      pending.nextRecoverySourceSu === pending.recovery.recoveryEndSu
    ) {
      pending.liveData.push(payload)
      return
    }
    this.admitRecoveryData(pending, payload)
  }
}
export type SshRelaySessionMethods10Surface = typeof SshRelaySessionMethods10
