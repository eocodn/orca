import { powerMonitor, type BrowserWindow } from 'electron'
import type { SshRelaySession } from '../ssh/ssh-relay-session'
import type { SshPortForwardManager } from '../ssh/ssh-port-forward'
import type {
  DetectedPort,
  EnrichedDetectedPort,
  SavedPortForward,
  SshConnectionStatus,
  SshConnectionState
} from '../../shared/ssh-types'
import {
  getConnectionIdsForWorktree,
  enrichSshDetectedPorts,
  enrichSshForwardEntries,
  getWorktreeIdsForConnection
} from '../ports/ssh-advertised-url-enrichment'
import { advertisedUrlWatcher } from '../ports/advertised-url-watcher'

import { sshStore,
  connectionManager,
  portForwardManager,
  persistedStore,
  advertisedUrlWatcherUnsubscribe,
  powerMonitorUnsubscribe,
  activeSessions,
  relayStateOverrides,
  broadcastSshState,
  withSshRemotePlatform,
  setAdvertisedUrlWatcherUnsubscribe,
  setPowerMonitorUnsubscribe } from './ssh-ipc-foundation'
export { sshStore,
  connectionManager,
  portForwardManager,
  registeredConnectSshTarget,
  registeredGetSshState,
  persistedStore,
  advertisedUrlWatcherUnsubscribe,
  powerMonitorUnsubscribe,
  currentGetMainWindow,
  currentRuntime,
  SSH_IPC_CHANNELS,
  credentialRequestedForTarget,
  getCurrentMainWindow,
  connectRegisteredSshTarget,
  getRegisteredSshState,
  listRegisteredSshTargets,
  listRegisteredRemovedSshTargetLabels,
  disconnectRegisteredSshTarget,
  removeRegisteredSshTarget,
  activeSessions,
  targetLifecycleInFlight,
  getActiveSshAiVaultHostInfo,
  getActiveSshAiVaultHostInfos,
  runTargetLifecycle,
  awaitTargetLifecycle,
  teardownSshTargetTransport,
  teardownActiveSshSession,
  relayGracePeriodForTarget,
  type ConnectAttempt,
  connectInFlight,
  pendingTransportReconnects,
  invalidateConnectAttempt,
  isCurrentConnectAttempt,
  connectCancelledError,
  resetRelayInFlight,
  testingTargets,
  type RelayLostBackoffState,
  relayLostBackoff,
  relayStateOverrides,
  RELAY_LOST_MAX_ATTEMPTS,
  RELAY_LOST_BASE_DELAY_MS,
  RELAY_LOST_MAX_DELAY_MS,
  RELAY_LOST_STABILIZED_MS,
  clearRelayLostBackoff,
  broadcastSshState,
  withSshRemotePlatform,
  clearRelayStateOverride } from './ssh-ipc-foundation'

export function publishRelayOverride(
  getMainWindow: () => BrowserWindow | null,
  targetId: string,
  status: SshConnectionStatus,
  error: string | null,
  reconnectAttempt: number
): void {
  const state = withSshRemotePlatform(targetId, { targetId, status, error, reconnectAttempt })
  relayStateOverrides.set(targetId, state)
  broadcastSshState(getMainWindow, targetId, state)
}

export function connectionSupportsFolderDownload(targetId: string): boolean {
  // Why: connections without an explicit transport are ssh2-shaped; only a confirmed system-SSH transport lacks the SFTP-only capability.
  return connectionManager?.getConnection(targetId)?.usesSystemSshTransport?.() !== true
}

export function getPublicSshState(targetId: string): SshConnectionState | undefined {
  const state = relayStateOverrides.get(targetId) ?? connectionManager!.getState(targetId)
  return state ? withSshRemotePlatform(targetId, state) : undefined
}

export function broadcastPortForwards(getMainWindow: () => BrowserWindow | null, targetId: string): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) {
    return
  }
  win.webContents.send('ssh:port-forwards-changed', {
    targetId,
    forwards: listForwardsEnriched(targetId)
  })
}

export function broadcastDetectedPorts(
  getMainWindow: () => BrowserWindow | null,
  targetId: string,
  ports: DetectedPort[],
  options?: Parameters<typeof enrichSshDetectedPorts>[3]
): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) {
    return
  }
  win.webContents.send('ssh:detected-ports-changed', {
    targetId,
    ports: enrichDetected(targetId, ports, options)
  })
}

export function listForwardsEnriched(targetId: string): ReturnType<SshPortForwardManager['listForwards']> {
  const raw = portForwardManager!.listForwards(targetId)
  if (!persistedStore) {
    return raw
  }
  return enrichSshForwardEntries(raw, getWorktreeIdsForConnection(persistedStore, targetId))
}

export function enrichDetected(
  targetId: string,
  ports: DetectedPort[],
  options?: Parameters<typeof enrichSshDetectedPorts>[3]
): EnrichedDetectedPort[] {
  if (!persistedStore) {
    return ports
  }
  return enrichSshDetectedPorts(
    ports,
    getWorktreeIdsForConnection(persistedStore, targetId),
    undefined,
    options
  )
}

// Why: after user add/remove/update the runtime manager is the source of truth — persist exactly its entries (unrestored ones handled by a separate helper).
export function persistPortForwards(targetId: string): void {
  const active = portForwardManager!.listForwards(targetId)
  const saved: SavedPortForward[] = active.map((f) => ({
    localPort: f.localPort,
    remoteHost: f.remoteHost,
    remotePort: f.remotePort,
    label: f.label
  }))
  sshStore!.updateTarget(targetId, { portForwards: saved.length > 0 ? saved : undefined })
}

// Why: keep forwards that failed to restore in the persisted list so they retry on next reconnect instead of being silently dropped.
export function persistPortForwardsWithUnrestored(targetId: string): void {
  const active = portForwardManager!.listForwards(targetId)
  const activeKeys = new Set(active.map((f) => `${f.localPort}:${f.remoteHost}:${f.remotePort}`))

  const existing = sshStore!.getTarget(targetId)?.portForwards ?? []
  const unrestored = existing.filter(
    (pf) => !activeKeys.has(`${pf.localPort}:${pf.remoteHost}:${pf.remotePort}`)
  )

  const saved: SavedPortForward[] = [
    ...active.map((f) => ({
      localPort: f.localPort,
      remoteHost: f.remoteHost,
      remotePort: f.remotePort,
      label: f.label
    })),
    ...unrestored
  ]
  sshStore!.updateTarget(targetId, { portForwards: saved.length > 0 ? saved : undefined })
}

export async function restorePortForwards(
  targetId: string,
  getMainWindow: () => BrowserWindow | null
): Promise<void> {
  const target = sshStore!.getTarget(targetId)
  if (!target?.portForwards?.length) {
    return
  }
  const conn = connectionManager!.getConnection(targetId)
  if (!conn) {
    return
  }

  // Why: keep failed restores in persisted state — a failure may be transient (port temporarily busy), so retry on next reconnect.
  for (const saved of target.portForwards) {
    // Why: a reconnect mid-loop swaps the connection object; bail on identity change so we don't add forwards to a stale conn (leaking listeners).
    if (connectionManager!.getConnection(targetId) !== conn) {
      return
    }
    try {
      await portForwardManager!.addForward(
        targetId,
        conn,
        saved.localPort,
        saved.remoteHost,
        saved.remotePort,
        saved.label
      )
    } catch (err) {
      console.warn(
        `[ssh] Failed to restore forward :${saved.localPort} → ${saved.remoteHost}:${saved.remotePort}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  persistPortForwardsWithUnrestored(targetId)
  broadcastPortForwards(getMainWindow, targetId)
}

export function registerAdvertisedUrlRefresh(getMainWindow: () => BrowserWindow | null): void {
  advertisedUrlWatcherUnsubscribe?.()
  // Why: SSH port scans only emit on raw host/port/PID changes, but a terminal can print the advertised URL later, so the watcher must also refresh the renderer.
  setAdvertisedUrlWatcherUnsubscribe(advertisedUrlWatcher.onDidChange(({ worktreeId }) => {
    if (!persistedStore) {
      return
    }
    for (const targetId of getConnectionIdsForWorktree(persistedStore, worktreeId)) {
      const session = activeSessions.get(targetId)
      if (!session) {
        continue
      }
      const scanner = session.getPortScanner()
      if (scanner) {
        // Why: watcher changes can arrive before the next SSH scan refreshes listener PIDs, so don't validate PIDs against cached scanner rows.
        broadcastDetectedPorts(getMainWindow, targetId, scanner.getDetectedPorts(targetId), {
          validatePid: false
        })
      }
      broadcastPortForwards(getMainWindow, targetId)
    }
  }))
}

// Why: macOS can resume before the network is back, so a failed first probe gets one retry before the link is declared dead (#7773).
export const RESUME_PROBE_TIMEOUT_MS = 5_000
export const RESUME_PROBE_ATTEMPTS = 2

export async function isRelayLinkAliveAfterResume(session: SshRelaySession): Promise<boolean> {
  const mux = session.getMux()
  if (!mux || mux.isDisposed()) {
    return false
  }
  for (let attempt = 0; attempt < RESUME_PROBE_ATTEMPTS; attempt++) {
    if (await mux.probeLiveness(RESUME_PROBE_TIMEOUT_MS)) {
      return true
    }
  }
  return false
}

export function registerPowerMonitorReconnect(): void {
  powerMonitorUnsubscribe?.()
  const onSuspend = (): void => {
    for (const session of activeSessions.values()) {
      session.prepareForHostSleep()
    }
  }
  const onResume = (): void => {
    for (const [targetId, session] of activeSessions) {
      const manager = connectionManager
      const conn = manager?.getConnection(targetId)
      if (!conn) {
        continue
      }
      void (async () => {
        // Why: unconditional reconnect on wake tore down live sessions and flashed the overlay (#7773); only reconnect if the relay link actually died during sleep.
        if (await isRelayLinkAliveAfterResume(session)) {
          return
        }
        // Why: the probe can take ~10s; bail if the session/connection was replaced or torn down meanwhile, else we'd resurrect it.
        if (activeSessions.get(targetId) !== session || manager?.getConnection(targetId) !== conn) {
          return
        }
        try {
          await manager?.reconnect(targetId)
        } catch (err) {
          console.warn(
            `[ssh] Failed to reconnect ${targetId} after system resume: ${
              err instanceof Error ? err.message : String(err)
            }`
          )
        }
      })()
    }
  }
  powerMonitor.on('suspend', onSuspend)
  powerMonitor.on('resume', onResume)
  setPowerMonitorUnsubscribe(() => {
    powerMonitor.off('suspend', onSuspend)
    powerMonitor.off('resume', onResume)
  })
}
