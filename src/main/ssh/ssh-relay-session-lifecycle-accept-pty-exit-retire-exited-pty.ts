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
