import { ipcMain, powerMonitor, type BrowserWindow } from 'electron'
import { appendFileSync } from 'node:fs'
import type { Store } from '../persistence'
import { SshConnectionStore } from '../ssh/ssh-connection-store'
import type { SshConnectionCallbacks } from '../ssh/ssh-connection'
import { SshConnectionManager } from '../ssh/ssh-connection-manager'
import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import { SshRelaySession, type SshRelayAiVaultHostInfo } from '../ssh/ssh-relay-session'
import { SshPortForwardManager } from '../ssh/ssh-port-forward'
import type {
  DetectedPort,
  EnrichedDetectedPort,
  SavedPortForward,
  SshRepoReadoption,
  SshTarget,
  SshConnectionStatus,
  SshConnectionState,
  DirectSshAuthority
} from '../../shared/ssh-types'
import { SSH_TERMINATE_RECONNECT_REQUIRED } from '../../shared/constants'
import { isRuntimeOwnedSshTargetId } from '../../shared/execution-host'
import { isAuthError } from '../ssh/ssh-connection-utils'
import { forceStopRelayForTarget } from '../ssh/ssh-relay-reset'
import { isSshPtyNotFoundError } from '../providers/ssh-pty-errors'
import { toAppSshPtyId, toRelaySshPtyId } from '../providers/ssh-pty-id'
import { registerSshBrowseHandler } from './ssh-browse'
import {
  getConnectionIdsForWorktree,
  enrichSshDetectedPorts,
  enrichSshForwardEntries,
  getWorktreeIdsForConnection
} from '../ports/ssh-advertised-url-enrichment'
import { advertisedUrlWatcher } from '../ports/advertised-url-watcher'
import { requestCredential, registerCredentialHandler } from './ssh-passphrase'
import {
  clearProviderPtyState,
  deletePtyOwnership,
  getPtyIdsForConnection,
  getSshPtyProvider
} from './pty'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  initializeSshConnectionGenerationSession,
  resetSshConnectionGenerations
} from '../ssh/ssh-connection-generation'
import {
  getSshProviderAuthority,
  isCurrentSshProviderAuthority,
  resetSshProviderAuthorities,
  rotateSshProviderAuthority
} from '../ssh/ssh-provider-authority'

import { publishRelayOverride,
  clearRelayStateOverride,
  connectionSupportsFolderDownload,
  getPublicSshState,
  broadcastPortForwards,
  broadcastDetectedPorts,
  listForwardsEnriched,
  enrichDetected,
  persistPortForwards,
  persistPortForwardsWithUnrestored,
  restorePortForwards,
  registerAdvertisedUrlRefresh,
  RESUME_PROBE_TIMEOUT_MS,
  RESUME_PROBE_ATTEMPTS,
  isRelayLinkAliveAfterResume,
  registerPowerMonitorReconnect } from './ssh-ipc-connections'
export { publishRelayOverride,
  clearRelayStateOverride,
  connectionSupportsFolderDownload,
  getPublicSshState,
  broadcastPortForwards,
  broadcastDetectedPorts,
  listForwardsEnriched,
  enrichDetected,
  persistPortForwards,
  persistPortForwardsWithUnrestored,
  restorePortForwards,
  registerAdvertisedUrlRefresh,
  RESUME_PROBE_TIMEOUT_MS,
  RESUME_PROBE_ATTEMPTS,
  isRelayLinkAliveAfterResume,
  registerPowerMonitorReconnect } from './ssh-ipc-connections'

export function createSshConnectionCallbacks(): SshConnectionCallbacks {
  return {
    onCredentialRequest: (targetId, kind, detail) => {
      credentialRequestedForTarget.add(targetId)
      return requestCredential(getCurrentMainWindow, targetId, kind, detail)
    },
    onStateChange: (targetId: string, state: SshConnectionState) => {
      if (testingTargets.has(targetId)) {
        return
      }

      // Why: an SSH reconnect must re-deploy the relay and rebuild providers; the guard below fires only for real reconnects, not an explicit connect's 'deploying'.
      const session = activeSessions.get(targetId)
      const sessionState = session?.getState()
      const transportReconnectStarted =
        state.status === 'reconnecting' &&
        (sessionState === 'ready' || sessionState === 'reconnecting') &&
        !pendingTransportReconnects.has(targetId)
      if (transportReconnectStarted) {
        rotateSshProviderAuthority(targetId)
        pendingTransportReconnects.add(targetId)
      } else if (
        state.status === 'disconnected' ||
        state.status === 'auth-failed' ||
        state.status === 'reconnection-failed' ||
        state.status === 'error'
      ) {
        pendingTransportReconnects.delete(targetId)
      }
      const completedTransportReconnect =
        state.status === 'connected' && pendingTransportReconnects.delete(targetId)
      const shouldReconnectRelay =
        session !== undefined &&
        completedTransportReconnect &&
        state.reconnectAttempt === 0 &&
        (sessionState === 'ready' || sessionState === 'reconnecting')
      const relayReconnectAlreadyInFlight =
        !completedTransportReconnect &&
        state.status === 'connected' &&
        sessionState === 'reconnecting' &&
        relayStateOverrides.has(targetId)

      if (shouldReconnectRelay) {
        // Why: SSH connects before the relay providers rebuild; keep renderer actions gated until SshRelaySession reaches ready again.
        publishRelayOverride(
          getCurrentMainWindow,
          targetId,
          'reconnecting',
          'Relay channel reconnecting...',
          state.reconnectAttempt
        )
      } else if (relayReconnectAlreadyInFlight) {
        // Why: duplicate connected notifications belong to the same socket generation and must not expose providers before relay recovery finishes.
        return
      } else if (
        state.status === 'connected' &&
        session !== undefined &&
        sessionState !== 'ready' &&
        !completedTransportReconnect &&
        connectInFlight.has(targetId)
      ) {
        // Why: the raw SSH transport reaches 'connected' before the relay session establishes during an
        // explicit connect. Forwarding it makes the renderer treat the host as fully up — it remounts
        // SSH panes (-> window.api.ssh.connect) and fires connected-gated data reads before any provider
        // exists. On a permanent relay-deploy failure that premature 'connected' drives an unbounded
        // reconnect loop. Hold it at 'deploying-relay'; the in-flight doConnect broadcasts the
        // authoritative 'connected' directly (bypassing this callback) after establish() succeeds, or a
        // terminal state on failure. The connectInFlight gate keeps this scoped to a live connect, so a
        // stray raw 'connected' with no follow-up (e.g. a transport blip on a session left 'idle' by a
        // relay version mismatch) is never wedged at 'deploying-relay'.
        clearRelayStateOverride(targetId)
        broadcastSshState(getCurrentMainWindow, targetId, {
          targetId,
          status: 'deploying-relay',
          error: state.error,
          reconnectAttempt: state.reconnectAttempt
        })
      } else {
        clearRelayStateOverride(targetId)
        broadcastSshState(getCurrentMainWindow, targetId, state)
      }

      if (!session) {
        return
      }
      // Why: allow reconnect from both 'ready' and 'reconnecting'; without the latter, a failed relay deploy would permanently brick the session.
      if (shouldReconnectRelay) {
        const target = sshStore?.getTarget(targetId)
        const conn = connectionManager?.getConnection(targetId)
        if (conn) {
          void session.reconnect(conn, relayGracePeriodForTarget(target))
        }
      }
    }
  }
}

export function broadcastDetectedPortsFromCurrentWindow(
  targetId: string,
  ports: DetectedPort[],
  _platform: string
): void {
  broadcastDetectedPorts(getCurrentMainWindow, targetId, ports)
}

export function configureRelaySessionCallbacks(session: SshRelaySession): void {
  session.setOnTerminalRelayError((tid, err) => {
    clearRelayLostBackoff(tid)
    if (activeSessions.get(tid)?.getState() !== 'deploying') {
      rotateSshProviderAuthority(tid)
    }
    console.warn(
      `[ssh] Terminal relay error for ${tid}: ${err.message}; skipping reconnect backoff.`
    )
    publishRelayOverride(getCurrentMainWindow, tid, 'error', err.message, 0)
  })

  session.setOnRelayLost((tid) => {
    const s = activeSessions.get(tid)
    if (!s) {
      return
    }
    const c = connectionManager?.getConnection(tid)
    if (!c) {
      return
    }
    const t = sshStore?.getTarget(tid)

    // Why: bounded exponential backoff — without it, a remote bug that closes every fresh --connect channel becomes an infinite relay-deploy loop.
    const state = relayLostBackoff.get(tid) ?? {
      attempts: 0,
      reconnectTimer: null,
      stabilizedTimer: null
    }
    if (state.stabilizedTimer) {
      clearTimeout(state.stabilizedTimer)
      state.stabilizedTimer = null
    }
    if (state.reconnectTimer) {
      return
    }
    rotateSshProviderAuthority(tid)
    if (state.attempts >= RELAY_LOST_MAX_ATTEMPTS) {
      console.warn(
        `[ssh] Relay channel for ${tid} kept dying across ${state.attempts} attempts; giving up. User must reconnect manually.`
      )
      relayLostBackoff.delete(tid)
      // Why: surface the failure — a live SSH connection with a dead relay is otherwise invisible (typing in remote terminals just stops working).
      publishRelayOverride(
        getCurrentMainWindow,
        tid,
        'error',
        'Relay channel kept dropping. Click Reconnect on the SSH target before retrying.',
        0
      )
      return
    }
    const delay = Math.min(RELAY_LOST_BASE_DELAY_MS * 2 ** state.attempts, RELAY_LOST_MAX_DELAY_MS)
    state.attempts += 1
    publishRelayOverride(
      getCurrentMainWindow,
      tid,
      'reconnecting',
      'Relay channel lost. Reconnecting...',
      state.attempts
    )
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null
      relayLostBackoff.set(tid, state)
      const liveConn = connectionManager?.getConnection(tid)
      if (!liveConn || !activeSessions.has(tid)) {
        return
      }
      void s.reconnect(liveConn, relayGracePeriodForTarget(t))
    }, delay)
    relayLostBackoff.set(tid, state)
    console.warn(
      `[ssh] Relay channel for ${tid} lost; reconnect attempt ${state.attempts}/${RELAY_LOST_MAX_ATTEMPTS} in ${delay}ms`
    )
  })

  // Why: fires after both establish() and reconnect() reach 'ready'; re-create persisted port forwards so they survive restarts and blips.
  session.setOnReady((tid) => {
    const state = relayLostBackoff.get(tid)
    if (state) {
      if (state.stabilizedTimer) {
        clearTimeout(state.stabilizedTimer)
      }
      // Why: stabilization counts post-ready uptime; slow deploy time before `ready` doesn't prove the new relay survived real work.
      state.stabilizedTimer = setTimeout(() => {
        const current = relayLostBackoff.get(tid)
        if (current === state && !current.reconnectTimer) {
          relayLostBackoff.delete(tid)
        }
      }, RELAY_LOST_STABILIZED_MS)
      relayLostBackoff.set(tid, state)
    }
    clearRelayStateOverride(tid)
    if (!testingTargets.has(tid)) {
      broadcastSshState(getCurrentMainWindow, tid, {
        targetId: tid,
        status: 'connected',
        error: null,
        reconnectAttempt: 0,
        supportsFolderDownload: connectionSupportsFolderDownload(tid)
      })
    }
    currentRuntime?.notifySshRelayReady?.(tid)
    void restorePortForwards(tid, getCurrentMainWindow)
  })
}

export function refreshActiveRelaySessions(): void {
  if (!persistedStore || !portForwardManager) {
    return
  }
  for (const session of activeSessions.values()) {
    session.refreshEnvironment(
      getCurrentMainWindow,
      persistedStore,
      portForwardManager,
      currentRuntime,
      broadcastDetectedPortsFromCurrentWindow
    )
    configureRelaySessionCallbacks(session)
  }
}

