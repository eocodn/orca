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

import { registerSshHandlers } from './ssh-ipc-pty'
export { registerSshHandlers } from './ssh-ipc-pty'

export function getSshConnectionManager(): SshConnectionManager | null {
  return connectionManager
}

export async function resetSshHandlerStateForTests(): Promise<void> {
  advertisedUrlWatcherUnsubscribe?.()
  advertisedUrlWatcherUnsubscribe = null
  powerMonitorUnsubscribe?.()
  powerMonitorUnsubscribe = null
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
  connectionManager = null
  portForwardManager = null
  sshStore = null
  persistedStore = null
  registeredConnectSshTarget = null
  registeredGetSshState = null
  currentGetMainWindow = () => null
  currentRuntime = undefined
}

export function getSshConnectionStore(): SshConnectionStore | null {
  return sshStore
}

export function getActiveMultiplexer(connectionId: string): SshChannelMultiplexer | undefined {
  return activeSessions.get(connectionId)?.getMux() ?? undefined
}
