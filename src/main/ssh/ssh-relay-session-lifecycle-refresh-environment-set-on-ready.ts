// Why: single authority for all relay lifecycle state per SSH target (previously scattered across module Maps/Sets with duplicated paths).

import type { BrowserWindow } from 'electron'
import type { RelayVersionMismatchError } from './ssh-relay-version-mismatch-error'
import type { SshPortForwardManager } from './ssh-port-forward'
import { type DetectedPort } from '../../shared/ssh-types'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

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

export const SshRelaySessionMethods1 = {
  refreshEnvironment(this: any,
    getMainWindow: () => BrowserWindow | null,
    store: Store,
    portForwardManager: SshPortForwardManager,
    runtime?: OrcaRuntimeService,
    onDetectedPortsChanged?: (targetId: string, ports: DetectedPort[], platform: string) => void
  ): void {
    this.getMainWindow = getMainWindow
    this.store = store
    this.portForwardManager = portForwardManager
    this.runtime = runtime
    this.onDetectedPortsChanged = onDetectedPortsChanged
  },
  setOnRelayLost(this: any, cb: (targetId: string) => void): void {
    this._onRelayLost = cb
  },
  setOnTerminalRelayError(this: any, cb: (targetId: string, err: RelayVersionMismatchError) => void): void {
    this._onTerminalRelayError = cb
  },
  setOnReady(this: any, cb: (targetId: string) => void): void {
    this._onReady = cb
  }
}
export type SshRelaySessionMethods1Surface = typeof SshRelaySessionMethods1
