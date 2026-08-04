import { ipcMain } from 'electron'
import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import {
  resetSshConnectionGenerations
} from '../ssh/ssh-connection-generation'
import type { SshConnectionManager } from '../ssh/ssh-connection-manager'
import type { SshConnectionStore } from '../ssh/ssh-connection-store'
import {
  resetSshProviderAuthorities
} from '../ssh/ssh-provider-authority'

import {
  activeSessions,
  advertisedUrlWatcherUnsubscribe,
  clearRelayLostBackoff,
  connectInFlight,
  connectionManager,
  credentialRequestedForTarget,
  pendingTransportReconnects,
  portForwardManager,
  powerMonitorUnsubscribe,
  relayLostBackoff,
  relayStateOverrides,
  resetRelayInFlight,
  setAdvertisedUrlWatcherUnsubscribe,
  setConnectionManager,
  setCurrentGetMainWindow,
  setCurrentRuntime,
  setPersistedStore,
  setPortForwardManager,
  setPowerMonitorUnsubscribe,
  setRegisteredConnectSshTarget,
  setRegisteredGetSshState,
  setSshStore,
  SSH_IPC_CHANNELS,
  sshStore,
  targetLifecycleInFlight,
  testingTargets
} from './ssh-ipc-foundation'

export function getSshConnectionManager(): SshConnectionManager | null {
  return connectionManager
}

export async function resetSshHandlerStateForTests(): Promise<void> {
  advertisedUrlWatcherUnsubscribe?.()
  setAdvertisedUrlWatcherUnsubscribe(null)
  powerMonitorUnsubscribe?.()
  setPowerMonitorUnsubscribe(null)
  for (const ch of SSH_IPC_CHANNELS) {
    ipcMain.removeHandler(ch)
  }
  ipcMain.removeHandler('ssh:submitCredential')

  for (const session of activeSessions.values()) {
    session.dispose()
  }
  activeSessions.clear()
  for (const targetId of relayLostBackoff.keys()) {
    clearRelayLostBackoff(targetId)
  }
  relayStateOverrides.clear()
  connectInFlight.clear()
  targetLifecycleInFlight.clear()
  pendingTransportReconnects.clear()
  resetSshConnectionGenerations()
  resetSshProviderAuthorities()
  resetRelayInFlight.clear()
  testingTargets.clear()
  credentialRequestedForTarget.clear()

  await connectionManager?.disconnectAll()
  portForwardManager?.dispose()
  setConnectionManager(null)
  setPortForwardManager(null)
  setSshStore(null)
  setPersistedStore(null)
  setRegisteredConnectSshTarget(null)
  setRegisteredGetSshState(null)
  setCurrentGetMainWindow(() => null)
  setCurrentRuntime(undefined)
}

export function getSshConnectionStore(): SshConnectionStore | null {
  return sshStore
}

export function getActiveMultiplexer(connectionId: string): SshChannelMultiplexer | undefined {
  return activeSessions.get(connectionId)?.getMux() ?? undefined
}
