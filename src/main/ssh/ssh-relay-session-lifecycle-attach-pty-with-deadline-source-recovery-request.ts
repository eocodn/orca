// Why: single authority for all relay lifecycle state per SSH target (previously scattered across module Maps/Sets with duplicated paths).

import { SshPtyProvider } from '../providers/ssh-pty-provider'
import type { SshPtyAttachResult } from '../providers/ssh-pty-session-reattach'
import { isSshPtyIdentityMismatchError, isSshPtyNotFoundError } from '../providers/ssh-pty-errors'
import { toRelaySshPtyId } from '../providers/ssh-pty-id'
import {
  clearProviderPtyState,
  deletePtyOwnership,
  getPtyIncarnation
} from '../ipc/pty'
import * as ptyAuthority from '../ipc/pty'
import type { PtySourceRecoveryRequest } from '../../shared/pty-source-recovery-contract'

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

export const SshRelaySessionMethods15 = {
  async attachPtyWithDeadline(this: any,
    ptyProvider: SshPtyProvider,
    ptyId: string,
    expectedIdentity: ExpectedPtyIdentity | undefined,
    recoveryRequest: PtySourceRecoveryRequest | undefined
  ): Promise<SshPtyAttachResult> {
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true
        reject(
          new Error(`PTY reattach attempt timed out after ${SSH_PTY_REATTACH_ATTEMPT_TIMEOUT_MS}ms`)
        )
      }, SSH_PTY_REATTACH_ATTEMPT_TIMEOUT_MS)
      timer.unref?.()
    })
    try {
      const attach = expectedIdentity
        ? recoveryRequest
          ? ptyProvider.attachForReconnect(ptyId, expectedIdentity, recoveryRequest)
          : ptyProvider.attachForReconnect(ptyId, expectedIdentity)
        : recoveryRequest
          ? ptyProvider.attachForReconnect(ptyId, undefined, recoveryRequest)
          : ptyProvider.attachForReconnect(ptyId)
      const guardedAttach = attach.then((result) => {
        if (timedOut) {
          result.sourceActivationLease?.rollback()
        }
        return result
      })
      return (await Promise.race([guardedAttach, timeout])) ?? {}
    } finally {
      if (timer) {
        clearTimeout(timer)
      }
    }
  },
  async waitForPtyReattachRetry(this: any): Promise<void> {
    const delayMs =
      SSH_PTY_REATTACH_RETRY_MIN_DELAY_MS +
      Math.floor(Math.random() * (SSH_PTY_REATTACH_RETRY_JITTER_MS + 1))
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delayMs)
      timer.unref?.()
    })
  },
  handlePtyReattachFailure(this: any,
    ptyId: string,
    appPtyId: string,
    pending: PendingPtyReattach,
    error: unknown
  ): void {
    if (!isSshPtyNotFoundError(error)) {
      pending.restoreRequired = 'reattachAttemptsExhausted'
      this.wakeRecovery(pending)
      console.warn(
        `[ssh-relay-session] Leaving PTY ${ptyId} detached for ${this.targetId} after bounded reattach attempts failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      return
    }
    if (isSshPtyIdentityMismatchError(error)) {
      console.warn(
        `[ssh-relay-session] Ignoring stale PTY ${ptyId} for ${this.targetId} after relay identity mismatch: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      return
    }
    console.warn(
      `[ssh-relay-session] Dropping stale PTY ${ptyId} for ${this.targetId} after relay reattach failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    const currentStateToken = ptyAuthority.getPtyStateToken?.(appPtyId)
    if (
      pending.stateTokenAtStart === undefined ||
      currentStateToken !== pending.stateTokenAtStart ||
      (pending.incarnationIdAtStart !== undefined &&
        getPtyIncarnation(appPtyId) !== pending.incarnationIdAtStart)
    ) {
      // Why: a not-found reply belongs to the reattach generation that was queried, not a same-id replacement admitted while it was in flight.
      console.warn(
        `[ssh-relay-session] Ignoring stale not-found result for replaced PTY ${ptyId} on ${this.targetId}`
      )
      return
    }
    const incarnationId = getPtyIncarnation(appPtyId)
    const recovery = ptyConsumerRecoveryByTarget.get(this.targetId)
    recovery?.checkpointsByAppPtyId.delete(appPtyId)
    recovery?.checkpointsByAppPtyId.delete(ptyId)
    clearProviderPtyState(appPtyId)
    deletePtyOwnership(appPtyId)
    this.store.markSshRemotePtyLease(this.targetId, ptyId, 'expired')
    if (incarnationId) {
      this.runtime?.onPtyExit(appPtyId, -1, incarnationId)
    } else {
      this.runtime?.onPtyExit(appPtyId, -1, undefined, {
        authoritativeIdentityLess: true
      })
    }
    const win = this.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('pty:exit', { id: appPtyId, code: -1 })
    }
  },
  async sourceRecoveryRequest(this: any,
    appPtyId: string
  ): Promise<PtySourceRecoveryRequest | undefined> {
    if (!this.negotiatedPtyConsumerOwner()?.outputFlowControl) {
      return undefined
    }
    const recovery = ptyConsumerRecoveryByTarget.get(this.targetId)
    const migration = recovery?.modelMigrationsByAppPtyId.get(appPtyId)
    if (migration) {
      const outcome = await migration
      if (recovery?.modelMigrationsByAppPtyId.get(appPtyId) === migration) {
        recovery.modelMigrationsByAppPtyId.delete(appPtyId)
      }
      if (outcome.status !== 'settled') {
        return Object.freeze({ status: 'checkpointUnavailable' })
      }
    }
    const checkpoints = recovery?.checkpointsByAppPtyId
    const relayPtyId = toRelaySshPtyId(this.targetId, appPtyId)
    // Why: every checkpoint writer records app-id keys now, so the relay-id
    // lookup (and its paired delete below) is a legacy guard only.
    const checkpoint = checkpoints?.get(appPtyId) ?? checkpoints?.get(relayPtyId)
    if (!checkpoint) {
      return Object.freeze({ status: 'checkpointUnavailable' })
    }
    return Object.freeze({
      status: 'checkpoint',
      clientGeneration: checkpoint.clientGeneration,
      ownerGeneration: checkpoint.ownerGeneration,
      ptyIncarnation: checkpoint.ptyIncarnation,
      deliveryToken: checkpoint.deliveryToken,
      acceptedSourceEndSu: checkpoint.acceptedSourceEndSu
    })
  }
}
export type SshRelaySessionMethods15Surface = typeof SshRelaySessionMethods15
