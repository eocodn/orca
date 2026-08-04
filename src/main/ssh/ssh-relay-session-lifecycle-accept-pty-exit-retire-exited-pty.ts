// Why: single authority for all relay lifecycle state per SSH target (previously scattered across module Maps/Sets with duplicated paths).

import * as ptyAuthority from '../ipc/pty'
import {
  clearProviderPtyState,
  consumePendingPtyCleanupIfExact,
  consumeSshPtyExitFinalization,
  deletePtyOwnership,
  finalizePendingPtyCleanupIfExact,
  getPendingPtyCleanupIncarnation,
  getPtyIncarnation,
  getSshPtyProvider,
  hasPendingPtyCleanupExact,
  isCurrentPtyExit
} from '../ipc/pty'
import { acceptSshPtyOutputExit } from '../ipc/ssh-pty-output-intake-registry'
import { toRelaySshPtyId } from '../providers/ssh-pty-id'

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

export const SshRelaySessionMethods12 = {
  async acceptPtyExit(this: any, payload: SshPtyExitPayload): Promise<void> {
    if (this.activePtyProviderGeneration !== payload.providerGeneration) {
      return
    }
    const exitIncarnation = payload.incarnationId ?? payload.ptyIncarnation
    const stateTokenAtProofStart = ptyAuthority.getPtyStateToken?.(payload.id)
    if (!(await this.proveLegacyExitAbsence(payload, exitIncarnation))) {
      return
    }
    if (
      stateTokenAtProofStart !== undefined &&
      ptyAuthority.getPtyStateToken?.(payload.id) !== stateTokenAtProofStart
    ) {
      return
    }
    const isExactCleanupPending = (): boolean => {
      const pendingCleanupIncarnation = getPendingPtyCleanupIncarnation(payload.id)
      return (
        hasPendingPtyCleanupExact?.(payload.id, exitIncarnation) === true ||
        (pendingCleanupIncarnation !== undefined && exitIncarnation === pendingCleanupIncarnation)
      )
    }
    const finalizeExactCleanup = (): boolean =>
      finalizePendingPtyCleanupIfExact?.({ id: payload.id, incarnationId: exitIncarnation }) ===
        true || consumePendingPtyCleanupIfExact({ id: payload.id, incarnationId: exitIncarnation })
    try {
      await acceptSshPtyOutputExit({
        id: payload.id,
        code: payload.code,
        providerGeneration: payload.providerGeneration,
        ptyIncarnation: payload.ptyIncarnation
      })
    } catch (error) {
      // Why: an admitted exit cannot mutate state after its provider generation has been torn down.
      if (this.activePtyProviderGeneration !== payload.providerGeneration) {
        return
      }
      if (isExactCleanupPending() && finalizeExactCleanup()) {
        // Why: the exact provider exit is authoritative even when output delivery is canceled; retire relay state after finalizing the main-side cleanup snapshot.
        await this.retireCurrentPtyExitIfAuthoritative(payload, true, exitIncarnation)
        return
      }
      if (isExactCleanupPending()) {
        return
      }
      if (consumeSshPtyExitFinalization?.(payload)) {
        // Why: intake may finalize the renderer/runtime exit before a later projection close rejects; only provider/lease cleanup remains here.
        await this.retireCurrentPtyExitIfAuthoritative(payload, true, exitIncarnation)
        return
      }
      // Why: an exit that loses the output barrier still needs authoritative teardown.
      if (!(await this.retireCurrentPtyExitIfAuthoritative(payload, false, exitIncarnation))) {
        throw error
      }
      return
    }
    if (this.activePtyProviderGeneration !== payload.providerGeneration) {
      return
    }
    if (
      stateTokenAtProofStart !== undefined &&
      ptyAuthority.getPtyStateToken?.(payload.id) !== stateTokenAtProofStart
    ) {
      return
    }
    if (isExactCleanupPending()) {
      if (!finalizeExactCleanup() && isExactCleanupPending()) {
        return
      }
    }
    await this.retireCurrentPtyExitIfAuthoritative(payload, true, exitIncarnation)
  },
  async proveLegacyExitAbsence(this: any,
    payload: SshPtyExitPayload,
    exitIncarnation: string | undefined
  ): Promise<boolean> {
    if (!exitIncarnation?.startsWith('legacy:')) {
      return true
    }
    if (getPtyIncarnation(payload.id) === exitIncarnation) {
      return true
    }
    const provider = getSshPtyProvider(this.targetId)
    if (!provider?.listProcesses) {
      throw new Error('legacy_pty_exit_liveness_unavailable')
    }
    const sessions = await provider.listProcesses()
    // Why: legacy identities are synthetic; only an authoritative inventory can distinguish an old exit from a live same-id replacement.
    return !sessions.some((session) => session.id === payload.id)
  },
  async retireCurrentPtyExitIfAuthoritative(this: any,
    payload: SshPtyExitPayload,
    deliveryHandled: boolean,
    exitIncarnation: string | undefined
  ): Promise<boolean> {
    const stateTokenAtProofStart = ptyAuthority.getPtyStateToken?.(payload.id)
    if (!(await this.proveLegacyExitAbsence(payload, exitIncarnation))) {
      return true
    }
    if (
      stateTokenAtProofStart !== undefined &&
      ptyAuthority.getPtyStateToken?.(payload.id) !== stateTokenAtProofStart
    ) {
      return true
    }
    if (isCurrentPtyExit(payload)) {
      this.retireExitedPty(payload, deliveryHandled)
      return true
    }
    return false
  },
  retireExitedPty(this: any, payload: SshPtyExitPayload, deliveryHandled = false): void {
    const ptyIncarnation = payload.ptyIncarnation ?? payload.incarnationId
    const canonicalIncarnation = payload.incarnationId ?? ptyIncarnation
    if (ptyIncarnation) {
      const retired = this.retiredPtyExitIncarnations.get(payload.id)
      if (retired?.has(ptyIncarnation)) {
        return
      }
    }
    const relayPtyId = toRelaySshPtyId(this.targetId, payload.id)
    this.retiredSourceDeliveries.activate(relayPtyId)
    this.store.markSshRemotePtyLease(this.targetId, relayPtyId, 'terminated')
    clearProviderPtyState(payload.id)
    deletePtyOwnership(payload.id)
    ptyConsumerRecoveryByTarget.get(this.targetId)?.checkpointsByAppPtyId.delete(payload.id)
    ptyConsumerRecoveryByTarget
      .get(this.targetId)
      ?.checkpointsByAppPtyId.delete(toRelaySshPtyId(this.targetId, payload.id))
    if (!deliveryHandled) {
      this.runtime?.onPtyExit(payload.id, payload.code, canonicalIncarnation)
      const win = this.getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('pty:exit', payload)
      }
    }
    consumeSshPtyExitFinalization?.({ id: payload.id, ptyIncarnation })
    if (ptyIncarnation) {
      this.rememberRetiredPtyExit(payload.id, ptyIncarnation)
    }
  }
}
export type SshRelaySessionMethods12Surface = typeof SshRelaySessionMethods12
