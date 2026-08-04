import { type BrowserWindow } from 'electron'
import { isRuntimeOwnedSshTargetId } from '../../shared/execution-host'
import type {
  DirectSshAuthority,
  SshConnectionState,
  SshTarget
} from '../../shared/ssh-types'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { SshConnectionManager } from '../ssh/ssh-connection-manager'
import type { SshConnectionStore } from '../ssh/ssh-connection-store'
import type { SshPortForwardManager } from '../ssh/ssh-port-forward'
import {
  getSshProviderAuthority,
  isCurrentSshProviderAuthority,
  rotateSshProviderAuthority
} from '../ssh/ssh-provider-authority'
import type { SshRelaySession } from '../ssh/ssh-relay-session'
import { type SshRelayAiVaultHostInfo } from '../ssh/ssh-relay-session'

export let sshStore: SshConnectionStore | null = null
export let connectionManager: SshConnectionManager | null = null
export let portForwardManager: SshPortForwardManager | null = null
export let registeredConnectSshTarget: ((targetId: string) => Promise<SshConnectionState>) | null = null
export let registeredGetSshState: ((targetId: string) => SshConnectionState | undefined) | null = null
export let persistedStore: Store | null = null
export let advertisedUrlWatcherUnsubscribe: (() => void) | null = null
export let powerMonitorUnsubscribe: (() => void) | null = null
export let currentGetMainWindow: () => BrowserWindow | null = () => null
export let currentRuntime: OrcaRuntimeService | undefined

export function clearRelayStateOverride(targetId: string): void {
  relayStateOverrides.delete(targetId)
}

export function setSshStore(value: SshConnectionStore | null): void {
  sshStore = value
}

export function setConnectionManager(value: SshConnectionManager | null): void {
  connectionManager = value
}

export function setPortForwardManager(value: SshPortForwardManager | null): void {
  portForwardManager = value
}

export function setPersistedStore(value: Store | null): void {
  persistedStore = value
}

export function setRegisteredConnectSshTarget(
  value: ((targetId: string) => Promise<SshConnectionState>) | null
): void {
  registeredConnectSshTarget = value
}

export function setRegisteredGetSshState(
  value: ((targetId: string) => SshConnectionState | undefined) | null
): void {
  registeredGetSshState = value
}

export function setCurrentGetMainWindow(value: () => BrowserWindow | null): void {
  currentGetMainWindow = value
}

export function setCurrentRuntime(value: OrcaRuntimeService | undefined): void {
  currentRuntime = value
}

export function setAdvertisedUrlWatcherUnsubscribe(unsubscribe: (() => void) | null): void {
  advertisedUrlWatcherUnsubscribe = unsubscribe
}

export function setPowerMonitorUnsubscribe(unsubscribe: (() => void) | null): void {
  powerMonitorUnsubscribe = unsubscribe
}

export const SSH_IPC_CHANNELS = [
  'ssh:listTargets',
  'ssh:listRemovedTargetLabels',
  'ssh:addTarget',
  'ssh:updateTarget',
  'ssh:removeTarget',
  'ssh:importConfig',
  'ssh:connect',
  'ssh:disconnect',
  'ssh:terminateSessions',
  'ssh:resetRelay',
  'ssh:getState',
  'ssh:needsPassphrasePrompt',
  'ssh:testConnection',
  'ssh:addPortForward',
  'ssh:updatePortForward',
  'ssh:removePortForward',
  'ssh:listPortForwards',
  'ssh:listDetectedPorts'
] as const

// Why: keep this outside registerSshHandlers so a BrowserWindow recreation mid-connect doesn't split credential tracking.
export const credentialRequestedForTarget = new Set<string>()

export function getCurrentMainWindow(): BrowserWindow | null {
  return currentGetMainWindow()
}

export async function connectRegisteredSshTarget(targetId: string): Promise<SshConnectionState> {
  if (!registeredConnectSshTarget) {
    throw new Error('ssh_handlers_not_registered')
  }
  return registeredConnectSshTarget(targetId)
}

export function getRegisteredSshState(targetId: string): SshConnectionState | undefined {
  return registeredGetSshState?.(targetId)
}

/** Public targets for runtime RPC clients — same list the desktop renderer gets. */
export function listRegisteredSshTargets(): SshTarget[] {
  return sshStore?.listTargets() ?? []
}

/** Removed-target id → last known label, for ghost-host display on paired clients. */
export function listRegisteredRemovedSshTargetLabels(): Record<string, string> {
  return sshStore?.listRemovedTargetLabels() ?? {}
}

export async function disconnectRegisteredSshTarget(targetId: string): Promise<void> {
  invalidateConnectAttempt(targetId)
  await runTargetLifecycle(targetId, () =>
    teardownSshTargetTransport(targetId, (session) => session.detach())
  )
}

export async function removeRegisteredSshTarget(targetId: string): Promise<void> {
  if (!sshStore) {
    return
  }
  const store = sshStore
  invalidateConnectAttempt(targetId)
  await runTargetLifecycle(targetId, async () => {
    try {
      // Why: removal is destructive; dispose so remote PTYs cannot reattach to a deleted target.
      await teardownSshTargetTransport(targetId, (session) => session.dispose())
    } catch (err) {
      // Why: a failed disconnect must not block metadata removal, else the target lingers in the store with uncleaned leases.
      console.warn(
        `[ssh] Failed to disconnect removed target ${targetId}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    persistedStore?.removeSshRemotePtyLeases(targetId)
    store.removeTarget(targetId)
  })
}

// One session per SSH target owns the whole relay lifecycle (mux, providers, abort controller, state machine).
export const activeSessions = new Map<string, SshRelaySession>()
export const targetLifecycleInFlight = new Map<string, Promise<void>>()

export function getActiveSshAiVaultHostInfo(targetId: string): SshRelayAiVaultHostInfo | null {
  if (isRuntimeOwnedSshTargetId(targetId)) {
    return null
  }
  return activeSessions.get(targetId)?.getAiVaultHostInfo() ?? null
}

export function getActiveSshAiVaultHostInfos(): SshRelayAiVaultHostInfo[] {
  return [...activeSessions.values()].flatMap((session) => {
    if (isRuntimeOwnedSshTargetId(session.targetId)) {
      return []
    }
    const info = session.getAiVaultHostInfo()
    return info ? [info] : []
  })
}

export function runTargetLifecycle(targetId: string, operation: () => Promise<void>): Promise<void> {
  const prior = targetLifecycleInFlight.get(targetId)
  const operationPromise = (async () => {
    if (prior) {
      await prior.catch(() => undefined)
    }
    await operation()
  })()
  let trackedPromise!: Promise<void>
  trackedPromise = operationPromise.finally(() => {
    if (targetLifecycleInFlight.get(targetId) === trackedPromise) {
      targetLifecycleInFlight.delete(targetId)
    }
  })
  targetLifecycleInFlight.set(targetId, trackedPromise)
  return trackedPromise
}

export async function awaitTargetLifecycle(targetId: string): Promise<void> {
  while (true) {
    const lifecycle = targetLifecycleInFlight.get(targetId)
    if (!lifecycle) {
      return
    }
    await lifecycle.catch(() => undefined)
  }
}

export async function teardownSshTargetTransport(
  targetId: string,
  teardown: (session: SshRelaySession) => void
): Promise<void> {
  let transportDisconnect: Promise<{ ok: true } | { ok: false; error: unknown }>
  try {
    transportDisconnect = Promise.resolve(connectionManager?.disconnect(targetId)).then(
      () => ({ ok: true }) as const,
      (error: unknown) => ({ ok: false, error }) as const
    )
  } catch (error) {
    transportDisconnect = Promise.resolve({ ok: false, error })
  }
  const sessionTeardown = teardownActiveSshSession(targetId, teardown).then(
    () => ({ ok: true }) as const,
    (error: unknown) => ({ ok: false, error }) as const
  )
  const [disconnectResult, teardownResult] = await Promise.all([
    transportDisconnect,
    sessionTeardown
  ])
  if (!teardownResult.ok) {
    throw teardownResult.error
  }
  if (!disconnectResult.ok) {
    throw disconnectResult.error
  }
}

export async function teardownActiveSshSession(
  targetId: string,
  teardown: (session: SshRelaySession) => void
): Promise<void> {
  const session = activeSessions.get(targetId)
  if (!session) {
    return
  }
  let teardownError: { error: unknown } | null = null
  try {
    // Why: await port teardown so local listeners are released before disconnect/remove completes, else an immediate reconnect hits EADDRINUSE.
    await portForwardManager?.removeAllForwards(targetId)
  } catch (error) {
    teardownError = { error }
  }
  try {
    teardown(session)
  } catch (error) {
    teardownError ??= { error }
  }
  if (activeSessions.get(targetId) === session) {
    activeSessions.delete(targetId)
    clearRelayLostBackoff(targetId)
    clearRelayStateOverride(targetId)
  }
  if (teardownError) {
    throw teardownError.error
  }
}

export function relayGracePeriodForTarget(target: SshTarget | null | undefined): number | undefined {
  return target?.relayGracePeriodSeconds
}

// Why: tabs must share one connect, while a disconnect must invalidate that
// attempt so its late continuation cannot clobber a replacement.
export type ConnectAttempt = {
  authority: DirectSshAuthority
  promise: Promise<SshConnectionState>
}

export const connectInFlight = new Map<string, ConnectAttempt>()
export const pendingTransportReconnects = new Set<string>()

export function invalidateConnectAttempt(targetId: string): void {
  rotateSshProviderAuthority(targetId)
  pendingTransportReconnects.delete(targetId)
  connectInFlight.delete(targetId)
  credentialRequestedForTarget.delete(targetId)
}

export function isCurrentConnectAttempt(targetId: string, authority: DirectSshAuthority): boolean {
  return authority.targetId === targetId && isCurrentSshProviderAuthority(authority)
}

export function connectCancelledError(): Error {
  return new Error('SSH connection attempt was cancelled')
}

// Why: publish reset's teardown/force-stop/disconnect lifecycle so new connects and duplicate resets can't race it.
export const resetRelayInFlight = new Map<string, Promise<void>>()

// Why: ssh:testConnection connects then disconnects; suppressing broadcasts during the test avoids worktree cards flashing connected → disconnected.
export const testingTargets = new Set<string>()

// Why: without backoff, a relay channel that keeps dying reconnects as fast as the network allows, hammering local + remote sshd; track attempts and back off to end the loop recoverably.
export type RelayLostBackoffState = {
  attempts: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  stabilizedTimer: ReturnType<typeof setTimeout> | null
}
export const relayLostBackoff = new Map<string, RelayLostBackoffState>()
export const relayStateOverrides = new Map<string, SshConnectionState>()
export const RELAY_LOST_MAX_ATTEMPTS = 6
export const RELAY_LOST_BASE_DELAY_MS = 500
export const RELAY_LOST_MAX_DELAY_MS = 15_000
// Why: a reconnect whose mux dies within this window was a flap, not a recovery — don't reset the attempt counter. 5s covers provider re-registration + PTY reattach.
export const RELAY_LOST_STABILIZED_MS = 5_000

export function clearRelayLostBackoff(targetId: string): void {
  const state = relayLostBackoff.get(targetId)
  if (state?.reconnectTimer) {
    clearTimeout(state.reconnectTimer)
  }
  if (state?.stabilizedTimer) {
    clearTimeout(state.stabilizedTimer)
  }
  relayLostBackoff.delete(targetId)
}

export function broadcastSshState(
  getMainWindow: () => BrowserWindow | null,
  targetId: string,
  state: SshConnectionState
): void {
  // Why: runtime-owned (ephemeral-VM) targets are hidden from the renderer, so broadcasting their state only triggers wasted listTargets() lookups.
  if (isRuntimeOwnedSshTargetId(targetId)) {
    currentRuntime?.invalidateSshWorktreeScanCache?.(targetId)
    return
  }
  const enrichedState = withSshRemotePlatform(targetId, state)
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('ssh:state-changed', { targetId, state: enrichedState })
  }
  // Why: paired remote clients have no ssh:state-changed IPC; without this their terminals keep a stale reconnect overlay.
  currentRuntime?.notifySshStateChanged?.(targetId, enrichedState)
}

export function withSshRemotePlatform(targetId: string, state: SshConnectionState): SshConnectionState {
  const remotePlatform = activeSessions.get(targetId)?.getHostPlatform()?.os
  const authority = getSshProviderAuthority(targetId)
  return {
    ...state,
    targetId,
    providerEpoch: authority.providerEpoch,
    connectionGeneration: authority.connectionGeneration,
    ...(remotePlatform ? { remotePlatform } : {})
  }
}
