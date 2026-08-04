// Why: single authority for all relay lifecycle state per SSH target (previously scattered across module Maps/Sets with duplicated paths).

import { randomUUID } from 'node:crypto'
import * as ptyAuthority from '../ipc/pty'
import {
  getPtyIdsForConnection,
  getPtyIncarnation,
  getSshPtyProvider,
  restorePtyIncarnation,
  setPtyOwnership
} from '../ipc/pty'
import { toAppSshPtyId,toRelaySshPtyId } from '../providers/ssh-pty-id'
import type { SshPtyRecoveryActivationLease } from '../providers/ssh-pty-notification-routing'
import type { SshPtyProvider } from '../providers/ssh-pty-provider'
import type { SshPtyAttachResult } from '../providers/ssh-pty-session-reattach'
import type { SshChannelMultiplexer } from './ssh-channel-multiplexer'

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

export const SshRelaySessionMethods13 = {
  rememberRetiredPtyExit(this: any, id: string, ptyIncarnation: string): void {
    const retired = this.retiredPtyExitIncarnations.get(id) ?? new Map<string, number>()
    if (retired.has(ptyIncarnation)) {
      return
    }
    if (this.retiredPtyExitOrder.size >= SSH_PTY_EXIT_RETIREMENT_MAX_EVIDENCE) {
      const oldest = this.retiredPtyExitOrder.entries().next().value
      if (oldest) {
        const [sequence, evidence] = oldest
        this.retiredPtyExitOrder.delete(sequence)
        const oldRetired = this.retiredPtyExitIncarnations.get(evidence.id)
        if (oldRetired?.get(evidence.ptyIncarnation) === sequence) {
          oldRetired.delete(evidence.ptyIncarnation)
          if (oldRetired.size === 0) {
            this.retiredPtyExitIncarnations.delete(evidence.id)
          }
        }
      }
    }
    const sequence = ++this.nextRetiredPtyExitSequence
    retired.set(ptyIncarnation, sequence)
    this.retiredPtyExitIncarnations.set(id, retired)
    this.retiredPtyExitOrder.set(sequence, { id, ptyIncarnation })
  },
  forwardReattachReplay(
    this: any,
    appPtyId: string,
    data: string,
    incarnationId?: string
  ): void {
    if (!data) {
      return
    }
    const win = this.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('pty:replay', {
        id: appPtyId,
        data,
        ...(incarnationId ? { incarnationId } : {})
      })
    }
  },
  async reattachKnownPtys(this: any,
    mux: SshChannelMultiplexer,
    shouldContinue: () => boolean
  ): Promise<void> {
    const activeLeases = this.store
      .getSshRemotePtyLeases(this.targetId)
      .filter((lease) => lease.state !== 'terminated' && lease.state !== 'expired')
    const activeLeaseByPtyId = new Map(activeLeases.map((lease) => [lease.ptyId, lease]))
    const leasedPtyIds = activeLeases.map((lease) => lease.ptyId)
    // Why: pass pane identity so the relay can reject cross-generation id collisions; tabId falls back for pre-leafId leases.
    const expectedIdentityByPtyId = new Map(
      activeLeases
        .map((lease): [string, ExpectedPtyIdentity] | null => {
          const expected = expectedIdentityForLease(lease)
          return expected ? [lease.ptyId, expected] : null
        })
        .filter((entry): entry is [string, ExpectedPtyIdentity] => entry !== null)
    )
    // Why: after app restart ptyOwnership is empty, but durable SSH leases still describe grace-window survivors.
    const ptyIds = Array.from(
      new Set([
        ...getPtyIdsForConnection(this.targetId).map((ptyId) =>
          toRelaySshPtyId(this.targetId, ptyId)
        ),
        ...leasedPtyIds
      ])
    )
    const ptyProvider = getSshPtyProvider(this.targetId) as SshPtyProvider | undefined
    const providerGeneration = this.activePtyProviderGeneration
    if (!ptyProvider || providerGeneration === null || this.mux !== mux) {
      return
    }
    let nextPtyIndex = 0
    const worker = async (): Promise<void> => {
      while (shouldContinue()) {
        const ptyId = ptyIds[nextPtyIndex++]
        if (ptyId === undefined) {
          return
        }
        try {
          await this.reattachKnownPty({
            ptyProvider,
            ptyId,
            activeLeaseByPtyId,
            expectedIdentityByPtyId,
            mux,
            providerGeneration,
            shouldContinue
          })
        } catch (error) {
          if (isSourceRecoveryCancellationError(error)) {
            throw error
          }
          console.warn(
            `[ssh-relay-session] PTY ${ptyId} reattach processing failed for ${this.targetId}: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(SSH_PTY_REATTACH_MAX_CONCURRENCY, ptyIds.length) }, worker)
    )
  },
  async reattachKnownPty(this: any, args: {
    ptyProvider: SshPtyProvider
    ptyId: string
    activeLeaseByPtyId: Map<string, SshPtyLease>
    expectedIdentityByPtyId: Map<string, ExpectedPtyIdentity>
    mux: SshChannelMultiplexer
    providerGeneration: number
    shouldContinue: () => boolean
  }): Promise<void> {
    const {
      ptyProvider,
      ptyId,
      activeLeaseByPtyId,
      expectedIdentityByPtyId,
      mux,
      providerGeneration,
      shouldContinue
    } = args
    const appPtyId = toAppSshPtyId(this.targetId, ptyId)
    const pendingReattach: PendingPtyReattach = {
      mux,
      providerGeneration,
      retentionKey: `${providerGeneration}\0${appPtyId}\0${randomUUID()}`,
      exits: [],
      queuedData: [],
      recoveryData: [],
      liveData: [],
      recoveryWaiters: new Set(),
      livePassthrough: false,
      activated: false,
      incarnationIdAtStart: getPtyIncarnation(appPtyId),
      stateTokenAtStart: ptyAuthority.getOrCreatePtyStateToken?.(appPtyId)
    }
    this.pendingPtyReattaches.set(appPtyId, pendingReattach)
    let sourceActivationLease: SshPtyAttachResult['sourceActivationLease']
    let recoveryActivationLease: SshPtyRecoveryActivationLease | undefined
    try {
      const recoveryRequest = await this.sourceRecoveryRequest(appPtyId)
      const attachResult = await this.attachPtyWithRetry(
        ptyProvider,
        ptyId,
        expectedIdentityByPtyId.get(ptyId),
        recoveryRequest,
        shouldContinue
      )
      sourceActivationLease = attachResult.sourceActivationLease
      if (!shouldContinue()) {
        return
      }
      const exitDuringAttach = this.findExactPendingExit(
        pendingReattach,
        attachResult.incarnationId
      )
      if (exitDuringAttach && !recoveryRequest) {
        if (attachResult.incarnationId) {
          restorePtyIncarnation(appPtyId, attachResult.incarnationId)
          this.runtime?.acceptPtyIncarnationForExit?.(appPtyId, attachResult.incarnationId)
        }
        await this.acceptPtyExitOnce(exitDuringAttach)
        return
      }
      if (recoveryRequest) {
        const recovered = await this.finishSourceRecovery(
          ptyId,
          appPtyId,
          attachResult,
          recoveryRequest,
          pendingReattach,
          shouldContinue,
          () => {
            const lease = sourceActivationLease
            if (!lease) {
              return
            }
            recoveryActivationLease = lease.transferToRecovery((payload) =>
              this.quarantineReattachData(pendingReattach, payload)
            )
            sourceActivationLease = undefined
          }
        )
        if (!recovered) {
          const recoveryExit = this.findExactPendingExit(
            pendingReattach,
            attachResult.incarnationId
          )
          if (
            recoveryExit &&
            shouldContinue() &&
            this.ownsPtyRecoveryAttempt(appPtyId, pendingReattach)
          ) {
            if (recoveryActivationLease) {
              recoveryActivationLease.retire()
              recoveryActivationLease = undefined
            } else if (sourceActivationLease) {
              const canceled = await sourceActivationLease.rollback()
              sourceActivationLease = undefined
              if (!canceled) {
                throw sourceRecoveryCancellationError(
                  new Error('ssh_source_activation_cancellation_unproven')
                )
              }
            }
            this.preparePtyIncarnationForExit(appPtyId, attachResult.incarnationId)
            await this.acceptPtyExitOnce(recoveryExit)
          }
          return
        }
        const recoveryExit = this.findExactPendingExit(pendingReattach, attachResult.incarnationId)
        if (recoveryExit) {
          this.preparePtyIncarnationForExit(appPtyId, attachResult.incarnationId)
          pendingReattach.activated = true
          recoveryActivationLease?.commit()
          recoveryActivationLease = undefined
          await this.acceptPtyExitOnce(recoveryExit)
          return
        }
      }
      if (!shouldContinue() || !this.ownsPtyRecoveryAttempt(appPtyId, pendingReattach)) {
        return
      }
      setPtyOwnership(appPtyId, this.targetId)
      if (attachResult.incarnationId) {
        restorePtyIncarnation(appPtyId, attachResult.incarnationId)
        this.restoreReattachedPtyRuntime(
          appPtyId,
          attachResult.incarnationId,
          activeLeaseByPtyId.get(ptyId)
        )
      }
      this.store.markSshRemotePtyLease(this.targetId, ptyId, 'attached')
      pendingReattach.activated = true
      recoveryActivationLease?.commit()
      recoveryActivationLease = undefined
      const exitAfterActivation = this.findExactPendingExit(
        pendingReattach,
        attachResult.incarnationId
      )
      if (exitAfterActivation) {
        await this.acceptPtyExitOnce(exitAfterActivation)
        return
      }
      if (!recoveryRequest) {
        this.forwardReattachReplay(
          appPtyId,
          attachResult.replay ?? '',
          attachResult.incarnationId
        )
      }
      sourceActivationLease?.commit()
      sourceActivationLease = undefined
    } catch (error) {
      if (isSourceRecoveryCancellationError(error)) {
        throw error
      }
      if (!shouldContinue()) {
        return
      }
      this.handlePtyReattachFailure(ptyId, appPtyId, pendingReattach, error)
    } finally {
      recoveryActivationLease?.retire()
      sourceActivationLease?.rollback()
      if (this.pendingPtyReattaches.get(appPtyId) === pendingReattach) {
        this.pendingPtyReattaches.delete(appPtyId)
      }
      this.ptyRecoveryRetention.release(pendingReattach.retentionKey)
    }
  }
}
export type SshRelaySessionMethods13Surface = typeof SshRelaySessionMethods13
