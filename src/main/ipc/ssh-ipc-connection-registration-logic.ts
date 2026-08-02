// SSH target, relay lifecycle, PTY, and port-forward IPC handlers.
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

import { createSshConnectionCallbacks,
  broadcastDetectedPortsFromCurrentWindow,
  configureRelaySessionCallbacks,
  refreshActiveRelaySessions } from './ssh-ipc-browse'
export { createSshConnectionCallbacks,
  broadcastDetectedPortsFromCurrentWindow,
  configureRelaySessionCallbacks,
  refreshActiveRelaySessions } from './ssh-ipc-browse'

export function registerSshHandlers(
  store: Store,
  getMainWindow: () => BrowserWindow | null,
  runtime?: OrcaRuntimeService
): { connectionManager: SshConnectionManager; sshStore: SshConnectionStore } {
  initializeSshConnectionGenerationSession()
  // Why: macOS re-activation re-calls this with a new BrowserWindow; ipcMain.handle() throws on a duplicate channel, so remove prior handlers first.
  for (const ch of SSH_IPC_CHANNELS) {
    ipcMain.removeHandler(ch)
  }

  currentGetMainWindow = getMainWindow
  currentRuntime = runtime
  sshStore = new SshConnectionStore(store)
  persistedStore = store
  registerAdvertisedUrlRefresh(getCurrentMainWindow)

  registerCredentialHandler(getCurrentMainWindow)

  const callbacks = createSshConnectionCallbacks()
  if (connectionManager) {
    connectionManager.setCallbacks(callbacks)
  } else {
    connectionManager = new SshConnectionManager(callbacks)
  }
  portForwardManager ??= new SshPortForwardManager()
  portForwardManager.setCallbacks({
    onForwardClosed: (entry, reason) => {
      if (reason.kind === 'unexpected-exit') {
        console.warn(
          `[ssh] Port forward ${entry.localPort} → ${entry.remoteHost}:${entry.remotePort} closed unexpectedly${
            reason.detail ? `: ${reason.detail}` : ''
          }`
        )
      }
      persistPortForwardsWithUnrestored(entry.connectionId)
      broadcastPortForwards(getCurrentMainWindow, entry.connectionId)
    }
  })
  refreshActiveRelaySessions()
  registerPowerMonitorReconnect()
  registerSshBrowseHandler(() => connectionManager)

  // ── Target CRUD ────────────────────────────────────────────────────

  // Why: add/import can re-adopt workspaces orphaned on a removed target id (see ssh-target-readoption); the renderer must refresh its repo list to surface them.
  function takeRepoReadoptions(): SshRepoReadoption[] {
    if (!sshStore || sshStore.lastRepoReadoptions.length === 0) {
      return []
    }
    const repoReadoptions = sshStore.lastRepoReadoptions
    sshStore.lastRepoReadoptions = []
    for (const targetId of new Set(
      repoReadoptions.flatMap(({ oldTargetId, newTargetId }) => [oldTargetId, newTargetId])
    )) {
      rotateSshProviderAuthority(targetId)
    }
    const win = getCurrentMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('repos:changed')
    }
    return repoReadoptions
  }

  ipcMain.handle('ssh:listTargets', () => {
    return sshStore!.listTargets()
  })

  ipcMain.handle('ssh:listRemovedTargetLabels', () => {
    return sshStore!.listRemovedTargetLabels()
  })

  ipcMain.handle('ssh:addTarget', (_event, args: { target: Omit<SshTarget, 'id'> }) => {
    const target = sshStore!.addTarget(args.target)
    // Why: re-adding a removed host can re-adopt orphaned workspaces; refresh the renderer's repo list so they move back onto the live host.
    const repoReadoptions = takeRepoReadoptions()
    return { target, repoReadoptions }
  })

  ipcMain.handle(
    'ssh:updateTarget',
    (_event, args: { id: string; updates: Partial<Omit<SshTarget, 'id'>> }) => {
      return sshStore!.updateTarget(args.id, args.updates)
    }
  )

  ipcMain.handle('ssh:removeTarget', async (_event, args: { id: string }) => {
    await removeRegisteredSshTarget(args.id)
  })

  ipcMain.handle('ssh:importConfig', (_event, args?: { reAdopt?: boolean }) => {
    const targets = sshStore!.importFromSshConfig(args)
    const repoReadoptions = takeRepoReadoptions()
    return { targets, repoReadoptions }
  })

  // ── Connection lifecycle ───────────────────────────────────────────

  async function connectTarget(targetId: string): Promise<SshConnectionState> {
    const e2eProbePath = process.env.ORCA_E2E_FORBID_LOCAL_SSH_CONNECT_PROBE
    if (e2eProbePath) {
      appendFileSync(e2eProbePath, `${JSON.stringify(targetId)}\n`)
      throw new Error('e2e_forbidden_local_ssh_connect')
    }
    // Why: fence callers that entered before a same-turn disconnect/reset but resume after its cleanup.
    const admissionAuthority = getSshProviderAuthority(targetId)
    await awaitTargetLifecycle(targetId)
    const reset = resetRelayInFlight.get(targetId)
    if (reset) {
      await reset
    }

    // Why: serialize concurrent ssh:connect for the same target; interleaved connects otherwise leak the first session.
    const existing = connectInFlight.get(targetId)
    let replacePendingTransport = false
    if (existing) {
      if (isCurrentConnectAttempt(targetId, existing.authority)) {
        return existing.promise
      }
    }
    if (!isCurrentConnectAttempt(targetId, admissionAuthority)) {
      throw connectCancelledError()
    }
    const observedAuthority = admissionAuthority
    if (existing) {
      if (connectInFlight.get(targetId) === existing) {
        connectInFlight.delete(targetId)
        replacePendingTransport = true
      }
    }
    if (!isCurrentSshProviderAuthority(observedAuthority)) {
      throw connectCancelledError()
    }

    pendingTransportReconnects.delete(targetId)
    const promise = doConnect(targetId, replacePendingTransport)
    const attempt = { authority: getSshProviderAuthority(targetId), promise }
    connectInFlight.set(targetId, attempt)
    try {
      return await promise
    } finally {
      if (connectInFlight.get(targetId) === attempt) {
        connectInFlight.delete(targetId)
      }
    }
  }

  registeredConnectSshTarget = connectTarget
  registeredGetSshState = (targetId: string) => getPublicSshState(targetId)

  ipcMain.handle('ssh:connect', async (_event, args: { targetId: string }) => {
    return connectTarget(args.targetId)
  })

  async function doConnect(
    targetId: string,
    replacePendingTransport = false
  ): Promise<SshConnectionState> {
    const target = sshStore!.getTarget(targetId)
    if (!target) {
      throw new Error(`SSH target "${targetId}" not found`)
    }

    const existingSession = activeSessions.get(targetId)
    const existingState = connectionManager!.getState(targetId)
    const existingMux = existingSession?.getMux()
    if (
      existingSession?.getState() === 'ready' &&
      existingState?.status === 'connected' &&
      connectionManager!.getConnection(targetId) &&
      existingMux &&
      !existingMux.isDisposed() &&
      !relayStateOverrides.has(targetId) &&
      !relayLostBackoff.has(targetId)
    ) {
      // Why: BrowserWindow reactivation re-fires ssh:connect for already-live targets; treat as a refresh instead of tearing down the relay and its forwards.
      broadcastSshState(getCurrentMainWindow, targetId, existingState)
      return getPublicSshState(targetId)!
    }

    const authority = rotateSshProviderAuthority(targetId)
    clearRelayStateOverride(targetId)
    const pendingTransportDisconnect = replacePendingTransport
      ? connectionManager!.disconnect(targetId).then(
          () => ({ ok: true }) as const,
          (error: unknown) => ({ ok: false, error }) as const
        )
      : null
    let conn
    // Why: tear down any existing session first to avoid leaking its multiplexer, providers, and timers (double-connect / reconnect-after-error).
    if (existingSession) {
      // Why: await port teardown before disposing, else the new session's restorePortForwards can hit EADDRINUSE on not-yet-released ports.
      await portForwardManager!.removeAllForwards(targetId)
      if (!isCurrentConnectAttempt(targetId, authority)) {
        throw connectCancelledError()
      }
      existingSession.detach()
      if (activeSessions.get(targetId) === existingSession) {
        activeSessions.delete(targetId)
        clearRelayLostBackoff(targetId)
        clearRelayStateOverride(targetId)
      }
    }

    if (pendingTransportDisconnect) {
      const disconnectResult = await pendingTransportDisconnect
      if (!disconnectResult.ok) {
        throw disconnectResult.error
      }
      if (!isCurrentConnectAttempt(targetId, authority)) {
        throw connectCancelledError()
      }
    }

    // Why: create the session early so onStateChange sees it in 'deploying' and skips reconnect logic.
    const session = new SshRelaySession(
      targetId,
      getCurrentMainWindow,
      persistedStore!,
      portForwardManager!,
      currentRuntime,
      broadcastDetectedPortsFromCurrentWindow
    )
    configureRelaySessionCallbacks(session)
    activeSessions.set(targetId, session)
    const ownsSession = (): boolean =>
      isCurrentConnectAttempt(targetId, authority) && activeSessions.get(targetId) === session

    try {
      conn = await connectionManager!.connect(target)
      if (!ownsSession()) {
        throw connectCancelledError()
      }
    } catch (err) {
      // Why: connect()'s internal state may not have reached the renderer; broadcast explicitly so the UI leaves 'connecting'.
      const errObj = err instanceof Error ? err : new Error(String(err))
      const status: SshConnectionStatus = isAuthError(errObj) ? 'auth-failed' : 'error'
      if (!ownsSession()) {
        throw connectCancelledError()
      }
      // Why: clear this failed connect's flag so a later non-prompting connect isn't deferred.
      credentialRequestedForTarget.delete(targetId)
      activeSessions.delete(targetId)
      clearRelayLostBackoff(targetId)
      clearRelayStateOverride(targetId)
      broadcastSshState(getCurrentMainWindow, targetId, {
        targetId,
        status,
        error: errObj.message,
        reconnectAttempt: 0
      })
      throw err
    }

    try {
      callbacks.onStateChange(targetId, {
        targetId,
        status: 'deploying-relay',
        error: null,
        reconnectAttempt: 0
      })

      await session.establish(conn, relayGracePeriodForTarget(target))
      if (!ownsSession()) {
        throw connectCancelledError()
      }

      // Why: we manually pushed `deploying-relay`, so send `connected` straight to the renderer — routing through onStateChange would trigger reconnect logic.
      clearRelayStateOverride(targetId)
      broadcastSshState(getCurrentMainWindow, targetId, {
        targetId,
        status: 'connected',
        error: null,
        reconnectAttempt: 0,
        supportsFolderDownload: conn.usesSystemSshTransport?.() !== true
      })
    } catch (err) {
      if (!ownsSession()) {
        throw connectCancelledError()
      }
      activeSessions.delete(targetId)
      clearRelayLostBackoff(targetId)
      await connectionManager!.disconnect(targetId)
      throw err
    }

    // Why: persist whether this connect needed a credential so startup can partition targets into eager vs deferred without re-probing keys.
    const requiredPassphrase = credentialRequestedForTarget.has(targetId)
    credentialRequestedForTarget.delete(targetId)
    sshStore!.updateTarget(targetId, { lastRequiredPassphrase: requiredPassphrase })

    return getPublicSshState(targetId)!
  }

  ipcMain.handle('ssh:disconnect', async (_event, args: { targetId: string }) => {
    await disconnectRegisteredSshTarget(args.targetId)
  })

  ipcMain.handle('ssh:terminateSessions', async (_event, args: { targetId: string }) => {
    invalidateConnectAttempt(args.targetId)
    await runTargetLifecycle(args.targetId, async () => {
      const provider = getSshPtyProvider(args.targetId)
      const leasedIds = persistedStore!
        .getSshRemotePtyLeases(args.targetId)
        .filter((lease) => lease.state !== 'terminated' && lease.state !== 'expired')
        .map((lease) => lease.ptyId)
      const ptyIdsByRelayId = new Map<string, string>()
      for (const ptyId of getPtyIdsForConnection(args.targetId)) {
        const relayPtyId = toRelaySshPtyId(args.targetId, ptyId)
        ptyIdsByRelayId.set(relayPtyId, toAppSshPtyId(args.targetId, ptyId))
      }
      for (const ptyId of leasedIds) {
        const relayPtyId = toRelaySshPtyId(args.targetId, ptyId)
        ptyIdsByRelayId.set(
          relayPtyId,
          ptyIdsByRelayId.get(relayPtyId) ?? toAppSshPtyId(args.targetId, ptyId)
        )
      }
      const ptyIds = Array.from(ptyIdsByRelayId, ([relayPtyId, appPtyId]) => ({
        relayPtyId,
        appPtyId
      }))

      if (ptyIds.length > 0 && !provider) {
        throw new Error(
          `${SSH_TERMINATE_RECONNECT_REQUIRED}: SSH relay is not connected; reconnect before terminating remote sessions.`
        )
      }
      const shutdownResults = provider
        ? await Promise.allSettled(
            ptyIds.map(({ appPtyId }) =>
              provider.shutdown(appPtyId, { immediate: true, keepHistory: false })
            )
          )
        : []
      const shutdownFailures: string[] = []
      for (const [index, result] of shutdownResults.entries()) {
        const { appPtyId, relayPtyId } = ptyIds[index]
        if (result.status !== 'fulfilled' && !isSshPtyNotFoundError(result.reason)) {
          shutdownFailures.push(
            `${relayPtyId}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
          )
          continue
        }
        clearProviderPtyState(appPtyId)
        deletePtyOwnership(appPtyId)
        persistedStore!.markSshRemotePtyLease(args.targetId, relayPtyId, 'terminated')
      }
      if (shutdownFailures.length > 0) {
        // Why: a failed relay shutdown can leave the remote process alive in the grace window; keep the lease/session so the user can retry.
        throw new Error(`Failed to terminate SSH host sessions: ${shutdownFailures.join('; ')}`)
      }
      await teardownSshTargetTransport(args.targetId, (session) => session.dispose())
    })
  })

  async function doResetRelay(targetId: string, target: SshTarget): Promise<void> {
    const inFlightConnect = connectInFlight.get(targetId)
    if (inFlightConnect) {
      try {
        // Why: resetting activeSessions mid-deploy would dispose the session doConnect will use.
        await inFlightConnect.promise
      } catch {
        // The reset can still recover a stale remote relay after a failed connect.
      }
    }

    rotateSshProviderAuthority(targetId)
    const session = activeSessions.get(targetId)
    if (session) {
      // Why: detach() not dispose() — reset has its own stale-lease semantics below that dispose()'s clean-termination recording would hide.
      await teardownActiveSshSession(targetId, (capturedSession) => capturedSession.detach())
    }

    const existingConn = connectionManager!.getConnection(targetId)
    const conn = existingConn ?? (await connectionManager!.connect(target))
    try {
      await forceStopRelayForTarget(conn, targetId)
    } finally {
      const ptyIds = new Set(getPtyIdsForConnection(targetId))
      for (const lease of persistedStore!.getSshRemotePtyLeases(targetId)) {
        if (lease.state !== 'terminated' && lease.state !== 'expired') {
          ptyIds.add(lease.ptyId)
          persistedStore!.markSshRemotePtyLease(targetId, lease.ptyId, 'expired')
        }
      }
      // Why: reset force-kills the remote relay, so every local PTY handle it owned is stale even if the reset command failed after SIGTERM.
      for (const ptyId of ptyIds) {
        const appPtyId = toAppSshPtyId(targetId, ptyId)
        clearProviderPtyState(appPtyId)
        deletePtyOwnership(appPtyId)
      }
      // Why: reset's connect() may trip onCredentialRequest; clear so a later non-prompting doConnect doesn't persist lastRequiredPassphrase=true.
      credentialRequestedForTarget.delete(targetId)
      await connectionManager!.disconnect(targetId)
    }
  }

  ipcMain.handle('ssh:resetRelay', (_event, args: { targetId: string }) => {
    const existingReset = resetRelayInFlight.get(args.targetId)
    if (existingReset) {
      return existingReset
    }

    const target = sshStore!.getTarget(args.targetId)
    if (!target) {
      throw new Error(`SSH target "${args.targetId}" not found`)
    }

    let resetPromise: Promise<void>
    resetPromise = runTargetLifecycle(args.targetId, () =>
      doResetRelay(args.targetId, target)
    ).finally(() => {
      if (resetRelayInFlight.get(args.targetId) === resetPromise) {
        resetRelayInFlight.delete(args.targetId)
      }
    })
    resetRelayInFlight.set(args.targetId, resetPromise)
    return resetPromise
  })

  ipcMain.handle('ssh:getState', (_event, args: { targetId: string }) => {
    return getPublicSshState(args.targetId)
  })

  // Why: auto-connect callers need to know whether connecting will prompt; true when the last connect required a credential and no live conn has it cached.
  ipcMain.handle('ssh:needsPassphrasePrompt', (_event, args: { targetId: string }) => {
    const target = sshStore!.getTarget(args.targetId)
    if (!target?.lastRequiredPassphrase) {
      return false
    }
    const conn = connectionManager!.getConnection(args.targetId)
    return !conn?.hasCachedCredential()
  })

  ipcMain.handle('ssh:testConnection', async (_event, args: { targetId: string }) => {
    const target = sshStore!.getTarget(args.targetId)
    if (!target) {
      throw new Error(`SSH target "${args.targetId}" not found`)
    }

    // Why: with a live/reconnecting session, testConnection's disconnect() would tear down the relay stack (PTYs, watchers), so skip.
    const existingSession = activeSessions.get(args.targetId)
    const sessionState = existingSession?.getState()
    if (
      sessionState === 'ready' ||
      sessionState === 'deploying' ||
      sessionState === 'reconnecting'
    ) {
      return { success: true, state: connectionManager!.getState(args.targetId) }
    }

    // Why: testConnection's disconnect() would tear down an in-flight connect's relay deployment; await it instead.
    const inFlight = connectInFlight.get(args.targetId)
    if (inFlight) {
      try {
        const state = await inFlight.promise
        return { success: true, state }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    }

    testingTargets.add(args.targetId)
    try {
      const conn = await connectionManager!.connect(target)
      const state = conn.getState()
      await connectionManager!.disconnect(args.targetId)
      return { success: true, state }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    } finally {
      testingTargets.delete(args.targetId)
      // Why: clear so a test's credential prompt doesn't leave lastRequiredPassphrase=true and defer this target at startup.
      credentialRequestedForTarget.delete(args.targetId)
    }
  })

  // ── Port forwarding ─────────────────────────────────────────────────

  ipcMain.handle(
    'ssh:addPortForward',
    async (
      _event,
      args: {
        targetId: string
        localPort: number
        remoteHost: string
        remotePort: number
        label?: string
      }
    ) => {
      const conn = connectionManager!.getConnection(args.targetId)
      if (!conn) {
        throw new Error(`SSH connection "${args.targetId}" not found`)
      }
      const entry = await portForwardManager!.addForward(
        args.targetId,
        conn,
        args.localPort,
        args.remoteHost,
        args.remotePort,
        args.label
      )
      persistPortForwards(args.targetId)
      broadcastPortForwards(getCurrentMainWindow, args.targetId)
      return entry
    }
  )

  ipcMain.handle(
    'ssh:updatePortForward',
    async (
      _event,
      args: {
        id: string
        targetId: string
        localPort: number
        remoteHost: string
        remotePort: number
        label?: string
      }
    ) => {
      const conn = connectionManager!.getConnection(args.targetId)
      if (!conn) {
        throw new Error(`SSH connection "${args.targetId}" not found`)
      }
      try {
        const entry = await portForwardManager!.updateForward(
          args.id,
          conn,
          args.localPort,
          args.remoteHost,
          args.remotePort,
          args.label
        )
        persistPortForwards(entry.connectionId)
        broadcastPortForwards(getCurrentMainWindow, entry.connectionId)
        return entry
      } catch (err) {
        // Why: edit/rollback may have failed, so resync renderer to actual runtime state.
        persistPortForwards(args.targetId)
        broadcastPortForwards(getCurrentMainWindow, args.targetId)
        throw err
      }
    }
  )

  ipcMain.handle('ssh:removePortForward', async (_event, args: { id: string }) => {
    const removed = await portForwardManager!.removeForwardAndWait(args.id)
    if (removed) {
      persistPortForwards(removed.connectionId)
      broadcastPortForwards(getCurrentMainWindow, removed.connectionId)
    }
    return removed
  })

  ipcMain.handle('ssh:listPortForwards', (_event, args?: { targetId?: string }) => {
    const all = portForwardManager!.listForwards(args?.targetId)
    if (!persistedStore || !args?.targetId) {
      // Why: cross-target entries can't be mapped to worktrees in one call, so serve the raw list.
      return all
    }
    return enrichSshForwardEntries(all, getWorktreeIdsForConnection(persistedStore, args.targetId))
  })

  ipcMain.handle('ssh:listDetectedPorts', (_event, args: { targetId: string }) => {
    const session = activeSessions.get(args.targetId)
    const ports = session?.getPortScanner()?.getDetectedPorts(args.targetId) ?? []
    return enrichDetected(args.targetId, ports)
  })

  return { connectionManager, sshStore }
}
