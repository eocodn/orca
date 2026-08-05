// Why: single authority for all relay lifecycle state per SSH target (previously scattered across module Maps/Sets with duplicated paths).

import {
  getPendingPtyCleanupIncarnation,
  hasPendingPtyCleanupExact,
  hasPendingPtyCleanupWithoutIncarnation,
  isCurrentPtyExit
} from '../ipc/pty'
import type { SshPtyProvider } from '../providers/ssh-pty-provider'
import { isMainWindowVisible, onMainWindowBecameVisible } from '../window/main-window-visibility'
import type { SshChannelMultiplexer } from './ssh-channel-multiplexer'
import { PortScanner } from './ssh-port-scanner'

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
  wireUpPtyEvents(
    this: any,
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
      const isLegacyExit = exitIncarnation?.startsWith('legacy:') === true
      if (pendingCleanupIncarnation !== undefined && !isLegacyExit && !isCurrentPtyExit(payload)) {
        return
      }
      // Legacy exits require remote inventory proof before lifecycle cleanup.
      if (!isLegacyExit && !isCurrentPtyExit(payload)) {
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
