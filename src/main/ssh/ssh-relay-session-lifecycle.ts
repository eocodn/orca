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

import { SshRelaySessionMethods1, type SshRelaySessionMethods1Surface } from './ssh-relay-session-lifecycle-refresh-environment-set-on-ready'
import { SshRelaySessionMethods2, type SshRelaySessionMethods2Surface } from './ssh-relay-session-lifecycle-get-state-get-mux'
import { SshRelaySessionMethods3, type SshRelaySessionMethods3Surface } from './ssh-relay-session-lifecycle-get-host-platform-prepare-for-host-sleep'
import { SshRelaySessionMethods4, type SshRelaySessionMethods4Surface } from './ssh-relay-session-lifecycle-establish-detach'
import { SshRelaySessionMethods5, type SshRelaySessionMethods5Surface } from './ssh-relay-session-lifecycle-watch-mux-for-relay-loss-open-pty-consumer-session'
import { SshRelaySessionMethods6, type SshRelaySessionMethods6Surface } from './ssh-relay-session-lifecycle-remember-pty-consumer-recovery-install-remote-orca-cli-launcher'
import { SshRelaySessionMethods7, type SshRelaySessionMethods7Surface } from './ssh-relay-session-lifecycle-wire-up-remote-orca-cli-wire-up-remote-workspace-events'
import { SshRelaySessionMethods8, type SshRelaySessionMethods8Surface } from './ssh-relay-session-lifecycle-wire-up-agent-hook-events-broadcast-empty-lists'
import { SshRelaySessionMethods9, type SshRelaySessionMethods9Surface } from './ssh-relay-session-lifecycle-start-port-scanning-accept-pty-exit-once'
import { SshRelaySessionMethods10, type SshRelaySessionMethods10Surface } from './ssh-relay-session-lifecycle-schedule-pty-exit-retry-route-quarantined-reattach-data'
import { SshRelaySessionMethods11, type SshRelaySessionMethods11Surface } from './ssh-relay-session-lifecycle-observe-private-recovery-frame-wake-recovery'
import { SshRelaySessionMethods12, type SshRelaySessionMethods12Surface } from './ssh-relay-session-lifecycle-accept-pty-exit-retire-exited-pty'
import { SshRelaySessionMethods13, type SshRelaySessionMethods13Surface } from './ssh-relay-session-lifecycle-remember-retired-pty-exit-reattach-known-pty'
import { SshRelaySessionMethods14, type SshRelaySessionMethods14Surface } from './ssh-relay-session-lifecycle-find-exact-pending-exit-attach-pty-with-retry'
import { SshRelaySessionMethods15, type SshRelaySessionMethods15Surface } from './ssh-relay-session-lifecycle-attach-pty-with-deadline-source-recovery-request'
import { SshRelaySessionMethods16, type SshRelaySessionMethods16Surface } from './ssh-relay-session-lifecycle-begin-pty-model-migration-abandon-pty-source-recovery'
import { SshRelaySessionMethods17, type SshRelaySessionMethods17Surface } from './ssh-relay-session-lifecycle-owns-pty-recovery-attempt-same-source-delivery'

export * from './ssh-relay-session-lifecycle-foundation'

export class SshRelaySession {

  private _state: RelaySessionState = 'idle'
  private mux: SshChannelMultiplexer | null = null
  private abortController: AbortController | null = null
  private muxDisposeCleanup: (() => void) | null = null
  // Why: hold the notification-handler disposer so teardownProviders can release it on reconnect/shutdown (symmetric with muxDisposeCleanup).
  private muxNotificationCleanup: (() => void) | null = null
  // Why: onStateChange never fires when the relay channel closes but SSH stays up; this callback lets ssh.ts drive relay-level reconnect.
  private _onRelayLost: ((targetId: string) => void) | null = null
  // Why: version mismatch is terminal, so it needs a separate callback from _onRelayLost (which expects a recoverable transport drop).
  private _onTerminalRelayError:
    | ((targetId: string, err: RelayVersionMismatchError) => void)
    | null = null
  private _onReady: ((targetId: string) => void) | null = null
  private portScanner: PortScanner | null = null
  private currentConnection: SshConnection | null = null
  private hostPlatform: RemoteHostPlatform | null = null
  private remoteCliBridgeEnv: RemoteCliBridgeEnv | null = null
  private pendingPtyReattaches = new Map<string, PendingPtyReattach>()
  private readonly ptyRecoveryRetention = new SshPtyRecoveryRetentionBudget()
  private activePtyProviderGeneration: number | null = null
  private sourceAckPublisherCleanup: (() => void) | null = null
  private sourceCancellationPublisherCleanup: (() => void) | null = null
  private ptyRecoveryNotificationCleanups: (() => void)[] = []
  private readonly sourceIdentityByRelayPtyId = new Map<
    string,
    Readonly<{
      deliveryToken: string
      clientGeneration: number
      ownerGeneration: number
      ptyIncarnation: string
      nextSourceSu?: number
    }>
  >()
  private readonly retiredSourceDeliveries = new SshPtyRetiredSourceDeliveries()
  private readonly activePtyExitPromises = new Map<string, Promise<void>>()
  private readonly ptyExitRetryAttempts = new Map<string, number>()
  private readonly retiredPtyExitIncarnations = new Map<string, Map<string, number>>()
  private readonly retiredPtyExitOrder = new Map<number, { id: string; ptyIncarnation: string }>()
  private nextRetiredPtyExitSequence = 0
  private readonly ptyConsumerClientInstanceId: string
  private ptyConsumerSessionState: SshPtyConsumerSessionState | null = null
  private activeCompatibilityAttachmentIds = new Set<string>()


  constructor(
    readonly targetId: string,
    private getMainWindow: () => BrowserWindow | null,
    private store: Store,
    private portForwardManager: SshPortForwardManager,
    private runtime?: OrcaRuntimeService,
    private onDetectedPortsChanged?: (
      targetId: string,
      ports: DetectedPort[],
      platform: string
    ) => void
  ) {
    this.ptyConsumerClientInstanceId = ptyConsumerRecoveryForTarget(targetId).clientInstanceId
  }
}

export interface SshRelaySession extends SshRelaySessionMethods1Surface, SshRelaySessionMethods2Surface, SshRelaySessionMethods3Surface, SshRelaySessionMethods4Surface, SshRelaySessionMethods5Surface, SshRelaySessionMethods6Surface, SshRelaySessionMethods7Surface, SshRelaySessionMethods8Surface, SshRelaySessionMethods9Surface, SshRelaySessionMethods10Surface, SshRelaySessionMethods11Surface, SshRelaySessionMethods12Surface, SshRelaySessionMethods13Surface, SshRelaySessionMethods14Surface, SshRelaySessionMethods15Surface, SshRelaySessionMethods16Surface, SshRelaySessionMethods17Surface {}

Object.assign(SshRelaySession.prototype, SshRelaySessionMethods1, SshRelaySessionMethods2, SshRelaySessionMethods3, SshRelaySessionMethods4, SshRelaySessionMethods5, SshRelaySessionMethods6, SshRelaySessionMethods7, SshRelaySessionMethods8, SshRelaySessionMethods9, SshRelaySessionMethods10, SshRelaySessionMethods11, SshRelaySessionMethods12, SshRelaySessionMethods13, SshRelaySessionMethods14, SshRelaySessionMethods15, SshRelaySessionMethods16, SshRelaySessionMethods17)
