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

export const SshRelaySessionMethods11 = {
  observePrivateRecoveryFrame(this: any,
    pending: PendingPtyReattach,
    payload: SshPtyDataPayload
  ): void {
    const recovery = pending.recovery
    if (
      recovery &&
      payload.source?.deliveryToken === recovery.deliveryToken &&
      payload.source.clientGeneration === recovery.clientGeneration &&
      payload.source.ownerGeneration === recovery.ownerGeneration &&
      payload.ptyIncarnation === recovery.ptyIncarnation
    ) {
      pending.highestRecoverySourceEndSu = Math.max(
        pending.highestRecoverySourceEndSu ?? recovery.checkpointSourceEndSu,
        payload.source.sourceEndSu
      )
    }
  },
  admitRecoveryData(this: any, pending: PendingPtyReattach, payload: SshPtyDataPayload): void {
    if (pending.restoreRequired) {
      return
    }
    const recovery = pending.recovery
    const nextSourceSu = pending.nextRecoverySourceSu
    if (
      !recovery ||
      !payload.source ||
      nextSourceSu === undefined ||
      payload.source.deliveryToken !== recovery.deliveryToken ||
      payload.source.clientGeneration !== recovery.clientGeneration ||
      payload.source.ownerGeneration !== recovery.ownerGeneration ||
      payload.source.sourceStartSu !== nextSourceSu ||
      payload.source.sourceEndSu <= payload.source.sourceStartSu ||
      payload.source.sourceEndSu > recovery.recoveryEndSu ||
      payload.ptyIncarnation !== recovery.ptyIncarnation
    ) {
      pending.restoreRequired = 'recoveryFrameIdentityMismatch'
      this.wakeRecovery(pending)
      return
    }
    pending.nextRecoverySourceSu = payload.source.sourceEndSu
    pending.recoveryData.push(payload)
  },
  installPtyRecoveryNotifications(this: any, mux: SshChannelMultiplexer): void {
    for (const cleanup of this.ptyRecoveryNotificationCleanups) {
      cleanup()
    }
    this.ptyRecoveryNotificationCleanups = [
      mux.onNotificationByMethod('pty.recoveryComplete', (params) => {
        if (this.mux !== mux) {
          return
        }
        const id = typeof params.id === 'string' ? toAppSshPtyId(this.targetId, params.id) : ''
        const pending = this.pendingPtyReattaches.get(id)
        if (!pending || pending.mux !== mux) {
          return
        }
        const complete = parseRecoveryComplete(params)
        if (!complete) {
          pending.restoreRequired = 'invalidRecoveryComplete'
        } else {
          pending.recoveryComplete = complete
        }
        this.wakeRecovery(pending)
      }),
      mux.onNotificationByMethod('pty.restoreRequired', (params) => {
        if (this.mux !== mux) {
          return
        }
        const id = typeof params.id === 'string' ? toAppSshPtyId(this.targetId, params.id) : ''
        const pending = this.pendingPtyReattaches.get(id)
        if (!pending || pending.mux !== mux) {
          return
        }
        pending.restoreRequired =
          typeof params.reason === 'string' ? params.reason : 'relayRestoreRequired'
        this.wakeRecovery(pending)
      }),
      mux.onNotificationByMethod('pty.deliveryCanceled', (params) => {
        if (this.mux !== mux) {
          return
        }
        const id = typeof params.id === 'string' ? params.id : ''
        const identity = this.sourceIdentityByRelayPtyId.get(id)
        if (
          !identity ||
          params.deliveryToken !== identity.deliveryToken ||
          params.clientGeneration !== identity.clientGeneration ||
          params.ownerGeneration !== identity.ownerGeneration ||
          params.ptyIncarnation !== identity.ptyIncarnation
        ) {
          return
        }
        const replacementDeliveryToken =
          typeof params.replacementDeliveryToken === 'string' ? params.replacementDeliveryToken : ''
        const pending = this.pendingPtyReattaches.get(toAppSshPtyId(this.targetId, id))
        if (pending?.mux === mux) {
          if (
            replacementDeliveryToken.length === 0 ||
            replacementDeliveryToken === identity.deliveryToken
          ) {
            pending.restoreRequired =
              typeof params.reason === 'string'
                ? `relayDeliveryCanceled:${params.reason}`
                : 'relayDeliveryCanceled'
            this.wakeRecovery(pending)
            return
          }
          if (
            pending.replacementDeliveryToken &&
            pending.replacementDeliveryToken !== replacementDeliveryToken
          ) {
            pending.restoreRequired = 'recoveryReplacementTokenMismatch'
            this.wakeRecovery(pending)
            return
          }
          pending.replacementDeliveryToken = replacementDeliveryToken
          return
        }
        const generation = this.activePtyProviderGeneration
        if (
          generation !== null &&
          Number.isSafeInteger(params.sentEndSu) &&
          Number.isSafeInteger(params.creditedEndSu)
        ) {
          try {
            applySshPtySourceCancellationProof(
              {
                id: toAppSshPtyId(this.targetId, id),
                code: -1,
                providerGeneration: generation,
                ptyIncarnation: identity.ptyIncarnation
              },
              {
                sentEndSu: params.sentEndSu as number,
                creditedEndSu: params.creditedEndSu as number
              }
            )
            this.retiredSourceDeliveries.retire(generation, {
              relayPtyId: id,
              ...identity
            })
            this.sourceIdentityByRelayPtyId.delete(id)
          } catch {
            /* Invalid proof retains the active token identity. */
          }
        }
      })
    ]
  },
  wakeRecovery(this: any, pending: PendingPtyReattach): void {
    for (const resolve of pending.recoveryWaiters) {
      resolve()
    }
    pending.recoveryWaiters.clear()
  }
}
export type SshRelaySessionMethods11Surface = typeof SshRelaySessionMethods11
