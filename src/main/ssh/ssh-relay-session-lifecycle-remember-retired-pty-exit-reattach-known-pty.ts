// Why: single authority for all relay lifecycle state per SSH target (previously scattered across module Maps/Sets with duplicated paths).

import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { deployAndLaunchRelay } from './ssh-relay-deploy'
import { execCommand } from './ssh-relay-deploy-helpers'
import { isRelayVersionMismatchError } from './ssh-relay-version-mismatch-error'
import type { RelayVersionMismatchError } from './ssh-relay-version-mismatch-error'
import { SshChannelMultiplexer } from './ssh-channel-multiplexer'
import { SshPtyProvider } from '../providers/ssh-pty-provider'
import type { SshPtyAttachResult } from '../providers/ssh-pty-session-reattach'
import type { SshPtyDataCallback, SshPtyExitCallback } from '../providers/ssh-pty-provider-contract'
import type { SshPtyRecoveryActivationLease } from '../providers/ssh-pty-notification-routing'
import { isSshPtyIdentityMismatchError, isSshPtyNotFoundError } from '../providers/ssh-pty-errors'
import { toAppSshPtyId, toRelaySshPtyId } from '../providers/ssh-pty-id'
import { SshFilesystemProvider } from '../providers/ssh-filesystem-provider'
import { SshGitProvider } from '../providers/ssh-git-provider'
import { agentHookServer } from '../agent-hooks/server'
import { isAgentStatusHooksEnabled } from '../agent-hooks/managed-agent-hook-controls'
import {
  buildManagedHookDetectionCommands,
  detectedManagedHookAgents
} from '../agent-hooks/managed-hook-detection-commands'
import {
  AGENT_HOOK_INSTALL_MANAGED_HOOKS_METHOD,
  AGENT_HOOK_INSTALL_PLUGINS_METHOD,
  AGENT_HOOK_NOTIFICATION_METHOD,
  AGENT_HOOK_REQUEST_REPLAY_METHOD,
  isRemoteAgentHooksEnabled
} from '../../shared/agent-hook-relay'
import { _internals as openCodeInternals } from '../opencode/hook-service'
import { getPiAgentStatusExtensionSource } from '../pi/agent-status-extension-source'
import {
  registerSshPtyProvider,
  unregisterSshPtyProvider,
  getSshPtyProvider,
  getPtyIdsForConnection,
  clearPtyOwnershipForConnection,
  clearProviderPtyState,
  deletePtyOwnership,
  getPtyIncarnation,
  setPtyOwnership,
  restorePtyIncarnation,
  getPendingPtyCleanupIncarnation,
  consumePendingPtyCleanupIfExact,
  finalizePendingPtyCleanupIfExact,
  hasPendingPtyCleanupExact,
  hasPendingPtyCleanupWithoutIncarnation,
  isCurrentPtyExit,
  consumeSshPtyExitFinalization
} from '../ipc/pty'
import * as ptyAuthority from '../ipc/pty'
import {
  acceptSshPtyOutputData,
  acceptSshPtyOutputExit,
  allocateSshPtyProviderGeneration,
  applySshPtySourceCancellationProof,
  applySshPtySourceRecoveryCancellationProof,
  beginSshPtyOutputGenerationMigration,
  closeSshPtyOutputGeneration,
  getSshPtyAcceptedSourceCheckpoints,
  installSshPtySourceAckPublisher,
  installSshPtySourceCancellationPublisher
} from '../ipc/ssh-pty-output-intake-registry'
import type { SshPtyAcceptedSourceCheckpoint } from '../ipc/ssh-pty-output-source-obligations'
import type { SshPtyOutputMigrationResult } from '../ipc/ssh-pty-output-model-migration'
import {
  registerSshFilesystemProvider,
  unregisterSshFilesystemProvider,
  getSshFilesystemProvider
} from '../providers/ssh-filesystem-dispatch'
import { registerSshGitProvider, unregisterSshGitProvider } from '../providers/ssh-git-dispatch'
import { notifyRemoteWorkspaceHandlers } from '../ipc/remote-workspace-events'
import { PortScanner } from './ssh-port-scanner'
import { isMainWindowVisible, onMainWindowBecameVisible } from '../window/main-window-visibility'
import type { SshPortForwardManager } from './ssh-port-forward'
import type { SshConnection } from './ssh-connection'
import { joinRemotePath, isWindowsRemoteHost, type RemoteHostPlatform } from './ssh-remote-platform'
import { makeRemoteDirectoryCommand } from './ssh-remote-commands'
import { createRemoteCliInstallPlan } from './ssh-remote-cli-launcher'
import {
  DEFAULT_SSH_RELAY_GRACE_PERIOD_SECONDS,
  type DetectedPort,
  MAX_SSH_RELAY_GRACE_PERIOD_SECONDS,
  MIN_SSH_RELAY_GRACE_PERIOD_SECONDS,
  SSH_RELAY_CONFIGURE_GRACE_TIME_METHOD
} from '../../shared/ssh-types'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { DEFAULT_PTY_SOURCE_WINDOW_SU } from '../../shared/pty-source-credit-contract'
import { PTY_CONSUMER_STALE_OWNER_RECOVERY_ERROR } from '../../shared/pty-consumer-session'
import { runRemoteOrcaCli } from './ssh-remote-orca-cli'
import {
  acknowledgeRemoteOrcaCliPostOutput,
  parseRemoteOrcaCliPostOutput
} from './ssh-remote-orchestration-post-output'
import { toSshExecutionHostId, type ExecutionHostId } from '../../shared/execution-host'
import { isTerminalLeafId, makePaneKey } from '../../shared/stable-pane-id'
import { isValidTerminalTabId } from '../../shared/terminal-tab-id'
import {
  openSshPtyConsumerSession,
  type SshPtyConsumerOwnerState,
  type SshPtyConsumerSessionState
} from './ssh-pty-consumer-session'
import type {
  PtySourceRecoveryComplete,
  PtySourceRecoveryPending,
  PtySourceRecoveryRequest
} from '../../shared/pty-source-recovery-contract'
import { SshPtyRecoveryRetentionBudget } from './ssh-pty-recovery-retention-budget'
import { SshPtyRetiredSourceDeliveries } from './ssh-pty-retired-source-deliveries'

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
  forwardReattachReplay(this: any, appPtyId: string, data: string): void {
    if (!data) {
      return
    }
    const win = this.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('pty:replay', { id: appPtyId, data })
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
        this.forwardReattachReplay(appPtyId, attachResult.replay ?? '')
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
