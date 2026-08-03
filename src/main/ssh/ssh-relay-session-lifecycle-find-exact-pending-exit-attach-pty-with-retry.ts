// Why: single authority for all relay lifecycle state per SSH target (previously scattered across module Maps/Sets with duplicated paths).

import { SshPtyProvider } from '../providers/ssh-pty-provider'
import type { SshPtyAttachResult } from '../providers/ssh-pty-session-reattach'
import { isSshPtyNotFoundError } from '../providers/ssh-pty-errors'
import { restorePtyIncarnation } from '../ipc/pty'
import { toSshExecutionHostId } from '../../shared/execution-host'
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

export const SshRelaySessionMethods14 = {
  findExactPendingExit(this: any,
    pending: PendingPtyReattach,
    ptyIncarnation: string | undefined
  ): SshPtyExitPayload | undefined {
    if (!ptyIncarnation) {
      return undefined
    }
    return pending.exits.find((exit) => {
      if (exit.providerGeneration !== pending.providerGeneration) {
        return false
      }
      return exit.incarnationId !== undefined
        ? exit.incarnationId === ptyIncarnation
        : exit.ptyIncarnation === ptyIncarnation
    })
  },
  preparePtyIncarnationForExit(this: any, appPtyId: string, ptyIncarnation: string | undefined): void {
    if (!ptyIncarnation) {
      return
    }
    restorePtyIncarnation(appPtyId, ptyIncarnation)
    this.runtime?.acceptPtyIncarnationForExit?.(appPtyId, ptyIncarnation)
  },
  restoreReattachedPtyRuntime(this: any,
    appPtyId: string,
    incarnationId: string,
    lease: SshPtyLease | undefined
  ): void {
    if (lease?.worktreeId && lease.tabId && lease.leafId) {
      this.runtime?.registerPty(appPtyId, lease.worktreeId, this.targetId, {
        tabId: lease.tabId,
        leafId: lease.leafId,
        incarnationId
      })
      try {
        this.store.persistPtyBinding(
          {
            worktreeId: lease.worktreeId,
            tabId: lease.tabId,
            leafId: lease.leafId,
            ptyId: appPtyId,
            incarnationId
          },
          toSshExecutionHostId(this.targetId)
        )
      } catch (error) {
        console.error('[ssh-relay-session] Failed to persist reconnect incarnation:', error)
      }
      return
    }
    this.runtime?.onPtySpawned(appPtyId, incarnationId, { awaitsRegistration: false })
  },
  async attachPtyWithRetry(this: any,
    ptyProvider: SshPtyProvider,
    ptyId: string,
    expectedIdentity: ExpectedPtyIdentity | undefined,
    recoveryRequest: PtySourceRecoveryRequest | undefined,
    shouldContinue: () => boolean
  ): Promise<SshPtyAttachResult> {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!shouldContinue()) {
        throw lastError ?? new Error('PTY reattach attempt is no longer current')
      }
      try {
        return await this.attachPtyWithDeadline(
          ptyProvider,
          ptyId,
          expectedIdentity,
          recoveryRequest
        )
      } catch (error) {
        lastError = error
        if (!shouldContinue() || isSshPtyNotFoundError(error) || attempt === 1) {
          throw error
        }
        await this.waitForPtyReattachRetry()
      }
    }
    throw lastError
  }
}
export type SshRelaySessionMethods14Surface = typeof SshRelaySessionMethods14
