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
  }
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
  }
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
  }
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
