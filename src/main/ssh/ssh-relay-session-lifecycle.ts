// Why: single authority for all relay lifecycle state per SSH target (previously scattered across module Maps/Sets with duplicated paths).

import type { BrowserWindow } from 'electron'
import { type DetectedPort } from '../../shared/ssh-types'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { SshChannelMultiplexer } from './ssh-channel-multiplexer'
import type { SshConnection } from './ssh-connection'
import type { SshPortForwardManager } from './ssh-port-forward'
import type { PortScanner } from './ssh-port-scanner'
import { type SshPtyConsumerSessionState } from './ssh-pty-consumer-session'
import { SshPtyRecoveryRetentionBudget } from './ssh-pty-recovery-retention-budget'
import { SshPtyRetiredSourceDeliveries } from './ssh-pty-retired-source-deliveries'
import type { RelayVersionMismatchError } from './ssh-relay-version-mismatch-error'
import { type RemoteHostPlatform } from './ssh-remote-platform'

import * as foundation from './ssh-relay-session-lifecycle-foundation'
const {
  SSH_PTY_EXIT_RETIREMENT_MAX_EVIDENCE,
  SSH_PTY_EXIT_RETRY_MAX_ATTEMPTS,
  SSH_PTY_REATTACH_ATTEMPT_TIMEOUT_MS,
  SSH_PTY_REATTACH_MAX_CONCURRENCY,
  SSH_PTY_REATTACH_RETRY_JITTER_MS,
  SSH_PTY_REATTACH_RETRY_MIN_DELAY_MS,
  SSH_SOURCE_RECOVERY_CANCELLATION_FAILED,
  expectedIdentityForLease,
  isSourceRecoveryCancellationError,
  nonNegativeSafeInteger,
  normalizeRelayGracePeriodSeconds,
  parseRecoveryComplete,
  positiveSafeInteger,
  ptyConsumerRecoveryByTarget,
  ptyConsumerRecoveryForTarget,
  sourceRecoveryCancellationError
} = foundation
type ExpectedPtyIdentity = foundation.ExpectedPtyIdentity
type PendingPtyReattach = foundation.PendingPtyReattach
type PtyConsumerRecovery = foundation.PtyConsumerRecovery
type RelaySessionState = foundation.RelaySessionState
type RemoteCliBridgeEnv = foundation.RemoteCliBridgeEnv
type SshPtyDataPayload = foundation.SshPtyDataPayload
type SshPtyExitPayload = foundation.SshPtyExitPayload
type SshPtyLease = foundation.SshPtyLease
type SshRelayAiVaultHostInfo = foundation.SshRelayAiVaultHostInfo

import {
  SshRelaySessionMethods12,
  type SshRelaySessionMethods12Surface
} from './ssh-relay-session-lifecycle-accept-pty-exit-retire-exited-pty'
import {
  SshRelaySessionMethods15,
  type SshRelaySessionMethods15Surface
} from './ssh-relay-session-lifecycle-attach-pty-with-deadline-source-recovery-request'
import {
  SshRelaySessionMethods16,
  type SshRelaySessionMethods16Surface
} from './ssh-relay-session-lifecycle-begin-pty-model-migration-abandon-pty-source-recovery'
import {
  SshRelaySessionMethods4,
  type SshRelaySessionMethods4Surface
} from './ssh-relay-session-lifecycle-establish-detach'
import {
  SshRelaySessionMethods14,
  type SshRelaySessionMethods14Surface
} from './ssh-relay-session-lifecycle-find-exact-pending-exit-attach-pty-with-retry'
import {
  SshRelaySessionMethods3,
  type SshRelaySessionMethods3Surface
} from './ssh-relay-session-lifecycle-get-host-platform-prepare-for-host-sleep'
import {
  SshRelaySessionMethods2,
  type SshRelaySessionMethods2Surface
} from './ssh-relay-session-lifecycle-get-state-get-mux'
import {
  SshRelaySessionMethods11,
  type SshRelaySessionMethods11Surface
} from './ssh-relay-session-lifecycle-observe-private-recovery-frame-wake-recovery'
import {
  SshRelaySessionMethods17,
  type SshRelaySessionMethods17Surface
} from './ssh-relay-session-lifecycle-owns-pty-recovery-attempt-same-source-delivery'
import {
  SshRelaySessionMethods1,
  type SshRelaySessionMethods1Surface
} from './ssh-relay-session-lifecycle-refresh-environment-set-on-ready'
import {
  SshRelaySessionMethods6,
  type SshRelaySessionMethods6Surface
} from './ssh-relay-session-lifecycle-remember-pty-consumer-recovery-install-remote-orca-cli-launcher'
import {
  SshRelaySessionMethods13,
  type SshRelaySessionMethods13Surface
} from './ssh-relay-session-lifecycle-remember-retired-pty-exit-reattach-known-pty'
import {
  SshRelaySessionMethods10,
  type SshRelaySessionMethods10Surface
} from './ssh-relay-session-lifecycle-schedule-pty-exit-retry-route-quarantined-reattach-data'
import {
  SshRelaySessionMethods9,
  type SshRelaySessionMethods9Surface
} from './ssh-relay-session-lifecycle-start-port-scanning-accept-pty-exit-once'
import {
  SshRelaySessionMethods5,
  type SshRelaySessionMethods5Surface
} from './ssh-relay-session-lifecycle-watch-mux-for-relay-loss-open-pty-consumer-session'
import {
  SshRelaySessionMethods8,
  type SshRelaySessionMethods8Surface
} from './ssh-relay-session-lifecycle-wire-up-agent-hook-events-broadcast-empty-lists'
import {
  SshRelaySessionMethods7,
  type SshRelaySessionMethods7Surface
} from './ssh-relay-session-lifecycle-wire-up-remote-orca-cli-wire-up-remote-workspace-events'

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

export interface SshRelaySession
  extends
    SshRelaySessionMethods1Surface,
    SshRelaySessionMethods2Surface,
    SshRelaySessionMethods3Surface,
    SshRelaySessionMethods4Surface,
    SshRelaySessionMethods5Surface,
    SshRelaySessionMethods6Surface,
    SshRelaySessionMethods7Surface,
    SshRelaySessionMethods8Surface,
    SshRelaySessionMethods9Surface,
    SshRelaySessionMethods10Surface,
    SshRelaySessionMethods11Surface,
    SshRelaySessionMethods12Surface,
    SshRelaySessionMethods13Surface,
    SshRelaySessionMethods14Surface,
    SshRelaySessionMethods15Surface,
    SshRelaySessionMethods16Surface,
    SshRelaySessionMethods17Surface {}

Object.assign(
  SshRelaySession.prototype,
  SshRelaySessionMethods1,
  SshRelaySessionMethods2,
  SshRelaySessionMethods3,
  SshRelaySessionMethods4,
  SshRelaySessionMethods5,
  SshRelaySessionMethods6,
  SshRelaySessionMethods7,
  SshRelaySessionMethods8,
  SshRelaySessionMethods9,
  SshRelaySessionMethods10,
  SshRelaySessionMethods11,
  SshRelaySessionMethods12,
  SshRelaySessionMethods13,
  SshRelaySessionMethods14,
  SshRelaySessionMethods15,
  SshRelaySessionMethods16,
  SshRelaySessionMethods17
)
