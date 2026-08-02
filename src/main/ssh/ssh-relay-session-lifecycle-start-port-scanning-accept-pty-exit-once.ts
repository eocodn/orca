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

export const SshRelaySessionMethods9 = {
  startPortScanning(this: any): void {
    if (!this.mux || this.isDisposed()) {
      return
    }
    // Why: each scan walks /proc/*/fd remotely, so skip ticks while the window is hidden and rescan when it returns.
    const scanner = new PortScanner({
      isWindowVisible: () => isMainWindowVisible(this.getMainWindow()),
      onWindowBecameVisible: onMainWindowBecameVisible
    })
    this.portScanner = scanner
    // Why: guard against a late ports.detect callback from a pre-reconnect scanner publishing stale results into the new session.
    scanner.startScanning(this.targetId, this.mux, (targetId, ports, platform) => {
      if (this.portScanner !== scanner) {
        return
      }
      this.onDetectedPortsChanged?.(targetId, ports, platform)
    })
  },
  stopPortScanning(this: any): void {
    if (this.portScanner) {
      this.portScanner.stopScanning(this.targetId)
      this.portScanner = null
    }
  },
  wireUpPtyEvents(this: any,
    ptyProvider: SshPtyProvider,
    mux: SshChannelMultiplexer,
    providerGeneration: number
  ): void {
    ptyProvider.onData((payload) => {
      if (
        this.mux !== mux ||
        this.activePtyProviderGeneration !== providerGeneration ||
        payload.providerGeneration !== providerGeneration
      ) {
        return
      }
      const pending = this.pendingPtyReattaches.get(payload.id)
      if (pending && this.negotiatedPtyConsumerOwner()?.outputFlowControl) {
        if (pending.livePassthrough) {
          void this.acceptPtyData(payload).catch(() => {})
          return
        }
        this.quarantineReattachData(pending, payload)
        return
      }
      void this.acceptPtyData(payload).catch(() => {})
    })
    ptyProvider.onReplay((payload) => {
      if (this.mux !== mux || this.activePtyProviderGeneration !== providerGeneration) {
        return
      }
      const win = this.getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('pty:replay', payload)
      }
    })
    ptyProvider.onExit((payload) => {
      if (
        this.mux !== mux ||
        this.activePtyProviderGeneration !== providerGeneration ||
        payload.providerGeneration !== providerGeneration
      ) {
        return
      }
      const pendingCleanupIncarnation = getPendingPtyCleanupIncarnation(payload.id)
      const exitIncarnation = payload.incarnationId ?? payload.ptyIncarnation
      if (
        exitIncarnation === undefined &&
        (pendingCleanupIncarnation !== undefined ||
          hasPendingPtyCleanupWithoutIncarnation(payload.id))
      ) {
        return
      }
      const exactCleanupPending =
        hasPendingPtyCleanupExact?.(payload.id, exitIncarnation) === true ||
        (pendingCleanupIncarnation !== undefined && exitIncarnation === pendingCleanupIncarnation)
      if (exactCleanupPending) {
        void this.acceptPtyExitOnce(payload).catch(() => {})
        return
      }
      const pendingReattach = this.pendingPtyReattaches.get(payload.id)
      if (pendingReattach && !pendingReattach.activated) {
        // Why: attach response and exit can share one transport batch, before incarnation restoration runs.
        pendingReattach.exits.push(payload)
        this.wakeRecovery(pendingReattach)
        return
      }
      if (pendingCleanupIncarnation !== undefined && !isCurrentPtyExit(payload)) {
        return
      }
      if (!isCurrentPtyExit(payload)) {
        return
      }
      void this.acceptPtyExitOnce(payload).catch(() => {})
    })
  },
  acceptPtyExitOnce(this: any, payload: SshPtyExitPayload): Promise<void> {
    const key = JSON.stringify([payload.providerGeneration, payload.id, payload.ptyIncarnation])
    const active = this.activePtyExitPromises.get(key)
    if (active) {
      return active
    }
    const promise = this.acceptPtyExit(payload)
    this.activePtyExitPromises.set(key, promise)
    void promise
      .then(() => {
        this.ptyExitRetryAttempts.delete(key)
      })
      .catch((error) => {
        this.schedulePtyExitRetry(payload, error)
      })
      .finally(() => {
        if (this.activePtyExitPromises.get(key) === promise) {
          this.activePtyExitPromises.delete(key)
        }
      })
      .catch(() => {})
    return promise
  }
}
export type SshRelaySessionMethods9Surface = typeof SshRelaySessionMethods9
