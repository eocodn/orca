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

export const SshRelaySessionMethods5 = {
  watchMuxForRelayLoss(this: any, mux: SshChannelMultiplexer): void {
    this.muxDisposeCleanup?.()
    this.muxDisposeCleanup = mux.onDispose((reason) => {
      if (reason === 'connection_lost' && this.mux === mux && !this.isDisposed()) {
        console.warn(
          `[ssh-relay-session] Relay channel lost for ${this.targetId}, triggering reconnect`
        )
        this._onRelayLost?.(this.targetId)
      }
    })
  }
  async registerProviders(this: any,
    mux: SshChannelMultiplexer,
    shouldContinue: (() => boolean) | undefined,
    connectionIncarnation: string
  ): Promise<boolean> {
    await this.registerRelayRoots(mux)
    if (shouldContinue && !shouldContinue()) {
      return false
    }

    await this.installPluginsOnRelay(mux)
    if (shouldContinue && !shouldContinue()) {
      return false
    }

    try {
      await this.installRemoteOrcaCliLauncher()
    } catch (error) {
      // Why: on MaxSessions=1 remotes the relay holds the only slot, so this raw-connection install can fail — don't fail the whole connection.
      console.warn(
        `[ssh-relay-session] remote orca CLI launcher install failed for ${this.targetId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    if (shouldContinue && !shouldContinue()) {
      return false
    }

    this.wireUpRemoteOrcaCli(mux, connectionIncarnation)

    const providerGeneration = allocateSshPtyProviderGeneration()
    const ptyProvider = new SshPtyProvider(
      this.targetId,
      mux,
      this.remoteCliBridgeEnv ?? undefined,
      providerGeneration
    )
    const consumerOwnerState = this.negotiatedPtyConsumerOwner()
    if (consumerOwnerState) {
      ptyProvider.setPtyDeliveryPauseAdapter?.(({ id, providerGeneration: generation, paused }) => {
        if (
          generation !== providerGeneration ||
          this.activePtyProviderGeneration !== providerGeneration ||
          this.mux !== mux
        ) {
          return
        }
        const sourceIdentity = this.sourceIdentityByRelayPtyId.get(id)
        if (consumerOwnerState.outputFlowControl && !sourceIdentity) {
          return
        }
        mux.notify('pty.setDeliveryPaused', {
          id,
          paused,
          clientGeneration: consumerOwnerState.clientGeneration,
          ownerGeneration: consumerOwnerState.ownerGeneration,
          ...(sourceIdentity ? { deliveryToken: sourceIdentity.deliveryToken } : {})
        })
      })
    }
    this.sourceAckPublisherCleanup?.()
    this.sourceAckPublisherCleanup = null
    this.sourceCancellationPublisherCleanup?.()
    this.sourceCancellationPublisherCleanup = null
    if (consumerOwnerState?.outputFlowControl) {
      this.sourceAckPublisherCleanup = installSshPtySourceAckPublisher(
        providerGeneration,
        (batch, onSettled) =>
          mux.notifyWithSettlement(
            'pty.ackData',
            batch as unknown as Record<string, unknown>,
            onSettled
          )
      )
      this.sourceCancellationPublisherCleanup = installSshPtySourceCancellationPublisher(
        providerGeneration,
        async (request) => {
          const result = (await mux.request('pty.cancelDelivery', {
            ...request,
            id: toRelaySshPtyId(this.targetId, request.id)
          })) as Record<string, unknown>
          if (
            result.canceled !== true ||
            !Number.isSafeInteger(result.sentEndSu) ||
            !Number.isSafeInteger(result.creditedEndSu)
          ) {
            throw new Error('ssh_source_cancellation_proof_invalid')
          }
          return {
            sentEndSu: result.sentEndSu as number,
            creditedEndSu: result.creditedEndSu as number
          }
        }
      )
    }
    this.activePtyProviderGeneration = providerGeneration
    registerSshPtyProvider(this.targetId, ptyProvider)
    this.installPtyRecoveryNotifications(mux)

    const connection = this.requireReadyConnection()
    const createSftp =
      connection.usesSystemSshTransport?.() === true
        ? undefined
        : (options?: { signal?: AbortSignal }) => this.requireReadyConnection().sftp(options)
    // Why: getHostPlatform() falls back to this.hostPlatform when bridge env is incomplete, so path rules still match the host.
    const hostPlatform = this.getHostPlatform() ?? undefined
    const fsProvider = new SshFilesystemProvider(
      this.targetId,
      mux,
      createSftp,
      {
        downloadFile: (sourcePath, destinationPath) =>
          this.requireReadyConnection().downloadFile(sourcePath, destinationPath, {
            hostPlatform
          }),
        openFileUploadSession: () =>
          this.requireReadyConnection().openFileUploadSession({
            hostPlatform
          }),
        writeBuffer: (remotePath, contents, options) =>
          this.requireReadyConnection().writeBuffer(remotePath, contents, {
            hostPlatform,
            append: options.append,
            exclusive: options.exclusive
          })
      },
      hostPlatform
    )
    registerSshFilesystemProvider(this.targetId, fsProvider)

    const gitProvider = new SshGitProvider(
      this.targetId,
      mux,
      this.remoteCliBridgeEnv?.hostPlatform ?? null
    )
    registerSshGitProvider(this.targetId, gitProvider)

    this.wireUpPtyEvents(ptyProvider, mux, providerGeneration)
    this.wireUpAgentHookEvents(mux)
    this.wireUpRemoteWorkspaceEvents(mux)
    void this.installManagedHooksOnRemote(mux, shouldContinue)
    return true
  }
  negotiatedPtyConsumerOwner(this: any, serverBuildId?: string): SshPtyConsumerOwnerState | null {
    const state = this.ptyConsumerSessionState
    if (state && state.mode !== 'legacy-fallback') {
      return state as SshPtyConsumerOwnerState
    }
    const recovery = ptyConsumerRecoveryByTarget.get(this.targetId)
    return !serverBuildId || recovery?.serverBuildId === serverBuildId
      ? (recovery?.owner ?? null)
      : null
  }
  async openPtyConsumerSession(this: any,
    mux: SshChannelMultiplexer,
    serverBuildId: string | undefined,
    shouldContinue?: () => boolean
  ): Promise<SshPtyConsumerSessionState> {
    const previousOwner = this.negotiatedPtyConsumerOwner(serverBuildId)
    const options = {
      clientInstanceId: this.ptyConsumerClientInstanceId,
      expectedServerBuildId: serverBuildId,
      allowSameBuildLegacyFallback: true,
      outputFlowControl: { requestedWindowSu: DEFAULT_PTY_SOURCE_WINDOW_SU }
    }
    try {
      return await openSshPtyConsumerSession(mux, {
        ...options,
        ...(previousOwner
          ? {
              resume: {
                ownerGeneration: previousOwner.ownerGeneration,
                ownerLease: previousOwner.ownerLease
              }
            }
          : {})
      })
    } catch (error) {
      if (
        !previousOwner ||
        (error as { code?: unknown }).code !== PTY_CONSUMER_STALE_OWNER_RECOVERY_ERROR
      ) {
        throw error
      }
      if (shouldContinue && !shouldContinue()) {
        return {
          mode: 'legacy-fallback',
          clientInstanceId: options.clientInstanceId,
          serverBuildId: serverBuildId ?? ''
        }
      }
      const recovery = ptyConsumerRecoveryByTarget.get(this.targetId)
      if (recovery) {
        delete recovery.owner
        recovery.checkpointsByAppPtyId.clear()
        for (const [ptyId, migration] of recovery.modelMigrationsByAppPtyId) {
          recovery.modelMigrationsByAppPtyId.set(
            ptyId,
            migration.then(() =>
              Object.freeze({
                status: 'checkpoint-unavailable' as const,
                reason: 'completion-failed' as const
              })
            )
          )
        }
      }
      this.ptyConsumerSessionState = null
      const retried = await openSshPtyConsumerSession(mux, options)
      if (shouldContinue && !shouldContinue()) {
        return {
          mode: 'legacy-fallback',
          clientInstanceId: options.clientInstanceId,
          serverBuildId: serverBuildId ?? ''
        }
      }
      return retried
    }
  }
}
export type SshRelaySessionMethods5Surface = typeof SshRelaySessionMethods5
