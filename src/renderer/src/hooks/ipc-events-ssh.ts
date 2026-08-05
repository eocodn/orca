import { getClientRuntime } from '@/runtime/client-runtime'
import { useAppStore } from '../store'
import type { AppState } from '../store/types'
import type { DirectSshAuthority, SshConnectionState } from '../../../shared/ssh-types'
import type { DirectSshConnectedStateOrigin } from './direct-ssh-state-routing'
import type { DirectSshPreparationReason } from './direct-ssh-reconnect-coordinator'
import type { createDirectSshReconnectCoordinator } from './direct-ssh-reconnect-coordinator'
import type { RemoteWorkspaceTargetSync } from './remote-workspace-target-sync'
import { directSshAuthoritiesEqual } from './direct-ssh-reconnect-tokens'
import {
  registerDirectSshWakeRouting,
  routeDirectSshConnectedState
} from './direct-ssh-state-routing'
import { isDirectSshReconnectCoordinatorRoutingEnabled } from './direct-ssh-reconnect-rollout'
type SshSurfaceContext = {
  unsubs: Array<() => void>
  isEffectStopped: () => boolean
  currentDirectSshAuthority: (targetId: string) => DirectSshAuthority | null
  reconnectAuthorityByTarget: Map<string, DirectSshAuthority>
  authorityReconciliationDeadlines: Set<{
    timer: ReturnType<typeof setTimeout>
    settle: () => void
  }>
  reconnectCoordinator: ReturnType<typeof createDirectSshReconnectCoordinator>
  directSshTerminalActions: () => Partial<
    Pick<AppState, 'invalidateStaleDirectSshTargetPtyBindings' | 'retryDirectSshTargetPanes'>
  >
  prepareAndSyncDirectSshTarget: (
    authority: DirectSshAuthority,
    reason: DirectSshPreparationReason,
    options?: { authorityAlreadyReplaced?: boolean }
  ) => Promise<void>
  remoteWorkspaceTargetSync: RemoteWorkspaceTargetSync | null
}
export function registerSshEvents(context: SshSurfaceContext): void {
  const {
    unsubs,
    isEffectStopped,
    currentDirectSshAuthority,
    reconnectAuthorityByTarget,
    authorityReconciliationDeadlines,
    reconnectCoordinator,
    directSshTerminalActions,
    prepareAndSyncDirectSshTarget,
    remoteWorkspaceTargetSync
  } = context
  const sshStateWatermarkByTargetId = new Map<string, number>()
  const pendingPortHydrationByTargetId = new Map<
    string,
    { receivedForwardPush: boolean; receivedDetectedPush: boolean }
  >()
  const hydrateSshPorts = (targetId: string, authority: DirectSshAuthority): void => {
    const pendingPortHydration = {
      receivedForwardPush: false,
      receivedDetectedPush: false
    }
    pendingPortHydrationByTargetId.set(targetId, pendingPortHydration)
    const isHydrationAuthorityCurrent = (): boolean =>
      !isEffectStopped() &&
      directSshAuthoritiesEqual(currentDirectSshAuthority(targetId), authority)
    const forwardHydration = getClientRuntime()
      .ssh.listPortForwards({ targetId })
      .then((forwards) => {
        // Why: if the session disconnected while awaiting the snapshot, applying it would resurrect a dead session's ports.
        if (isHydrationAuthorityCurrent() && !pendingPortHydration.receivedForwardPush) {
          useAppStore.getState().setPortForwards(targetId, forwards)
        }
      })
    const detectedHydration = getClientRuntime()
      .ssh.listDetectedPorts({ targetId })
      .then((detected) => {
        if (isHydrationAuthorityCurrent() && !pendingPortHydration.receivedDetectedPush) {
          useAppStore.getState().setDetectedPorts(targetId, detected)
        }
      })
    // Why: one failed or stalled port stream must not block the other stream or later targets.
    void Promise.allSettled([forwardHydration, detectedHydration]).then(() => {
      if (pendingPortHydrationByTargetId.get(targetId) === pendingPortHydration) {
        pendingPortHydrationByTargetId.delete(targetId)
      }
    })
  }
  let applySshConnectionStateChange!: (
    targetId: string,
    state: SshConnectionState,
    origin: DirectSshConnectedStateOrigin
  ) => void

  // Why: hydrate initial SSH state for all targets so worktree cards show correct connect state on launch.
  void (async () => {
    try {
      const targets = await getClientRuntime().ssh.listTargets()
      if (isEffectStopped()) {
        return
      }
      useAppStore.getState().setSshTargetsMetadata(targets)
      // Why: ghost-host UI (removed target still referenced by a workspace) shows a tombstone name instead of the raw id.
      try {
        const removedLabels = await getClientRuntime().ssh.listRemovedTargetLabels()
        if (isEffectStopped()) {
          return
        }
        useAppStore.getState().setRemovedSshTargetLabels(removedLabels)
      } catch {
        // Best-effort — a missing map just falls back to the raw target id.
      }
      for (const target of targets) {
        const hydrationWatermark = sshStateWatermarkByTargetId.get(target.id) ?? 0
        const state = await getClientRuntime().ssh.getState({ targetId: target.id })
        if (
          !isEffectStopped() &&
          state &&
          (sshStateWatermarkByTargetId.get(target.id) ?? 0) === hydrationWatermark
        ) {
          applySshConnectionStateChange(target.id, state as SshConnectionState, 'initial-hydration')
        }
      }
    } catch {
      // SSH may not be configured
    }
  })()

  unsubs.push(
    getClientRuntime().ssh.onCredentialRequest((data) => {
      useAppStore.getState().enqueueSshCredentialRequest(data)
    })
  )

  unsubs.push(
    getClientRuntime().ssh.onCredentialResolved(({ requestId }) => {
      useAppStore.getState().removeSshCredentialRequest(requestId)
    })
  )

  unsubs.push(
    getClientRuntime().ssh.onPortForwardsChanged(({ targetId, forwards }) => {
      const pendingPortHydration = pendingPortHydrationByTargetId.get(targetId)
      if (pendingPortHydration) {
        pendingPortHydration.receivedForwardPush = true
      }
      useAppStore.getState().setPortForwards(targetId, forwards)
    })
  )

  unsubs.push(
    getClientRuntime().ssh.onDetectedPortsChanged(({ targetId, ports }) => {
      const pendingPortHydration = pendingPortHydrationByTargetId.get(targetId)
      if (pendingPortHydration) {
        pendingPortHydration.receivedDetectedPush = true
      }
      useAppStore.getState().setDetectedPorts(targetId, ports)
    })
  )

  const reconcileSshAuthority = (
    targetId: string,
    initiatingState: SshConnectionState,
    origin: DirectSshConnectedStateOrigin,
    watermark: number
  ): void => {
    let pendingDeadline: { timer: ReturnType<typeof setTimeout>; settle: () => void } | undefined
    const deadline = new Promise<null>((resolve) => {
      const settle = (): void => resolve(null)
      const timer = setTimeout(settle, 5_000)
      pendingDeadline = { timer, settle }
      authorityReconciliationDeadlines.add(pendingDeadline)
    })
    void Promise.race([
      getClientRuntime()
        .ssh.getState({ targetId })
        .catch(() => null),
      deadline
    ])
      .then((latest) => {
        if (
          isEffectStopped() ||
          latest?.targetId !== targetId ||
          !latest?.providerEpoch ||
          latest.connectionGeneration === undefined ||
          (sshStateWatermarkByTargetId.get(targetId) ?? 0) !== watermark
        ) {
          return
        }
        const current = useAppStore.getState().sshConnectionStates?.get(targetId)
        if (
          current?.status !== initiatingState.status ||
          latest.status !== initiatingState.status ||
          current.providerEpoch !== initiatingState.providerEpoch ||
          current.connectionGeneration !== initiatingState.connectionGeneration ||
          (current.providerEpoch !== undefined &&
            current.providerEpoch !== null &&
            current.providerEpoch !== latest.providerEpoch) ||
          (current.connectionGeneration !== undefined &&
            current.connectionGeneration !== latest.connectionGeneration)
        ) {
          return
        }
        applySshConnectionStateChange(
          targetId,
          {
            ...current,
            providerEpoch: latest.providerEpoch,
            connectionGeneration: latest.connectionGeneration
          },
          origin
        )
      })
      .catch(() => undefined)
      .finally(() => {
        if (pendingDeadline) {
          clearTimeout(pendingDeadline.timer)
          authorityReconciliationDeadlines.delete(pendingDeadline)
        }
      })
  }

  applySshConnectionStateChange = (
    targetId: string,
    state: SshConnectionState,
    origin: DirectSshConnectedStateOrigin
  ): void => {
    const store = useAppStore.getState()
    const previous = store.sshConnectionStates?.get(targetId)
    store.setSshConnectionState(targetId, state)

    if (['disconnected', 'auth-failed', 'reconnection-failed', 'error'].includes(state.status)) {
      reconnectAuthorityByTarget.delete(targetId)
      reconnectCoordinator.invalidate(targetId)
      // Why: remote agent list is tied to a live relay; clear on disconnect so reconnect re-detects against the new relay.
      store.clearRemoteDetectedAgents(targetId)

      // Why: defensive — clear port state in case the removeAllForwards broadcast races this state change.
      store.clearPortForwards(targetId)
      store.setDetectedPorts(targetId, [])

      // SSH teardown has no per-PTY exits; clear only exact-target bindings in one store publication.
      store.clearDirectSshTargetPtyBindings(targetId)
      return
    }

    if (state.status !== 'connected') {
      return
    }
    const authority = currentDirectSshAuthority(targetId)
    if (!authority) {
      reconcileSshAuthority(targetId, state, origin, sshStateWatermarkByTargetId.get(targetId) ?? 0)
      return
    }
    const previousAuthority =
      previous?.status === 'connected' &&
      previous.providerEpoch &&
      previous.connectionGeneration !== undefined
        ? {
            targetId,
            providerEpoch: previous.providerEpoch,
            connectionGeneration: previous.connectionGeneration
          }
        : null
    routeDirectSshConnectedState(
      {
        coordinator: reconnectCoordinator,
        coordinatorRoutingEnabled: isDirectSshReconnectCoordinatorRoutingEnabled(),
        invalidateStaleTerminalBindings: (nextAuthority) =>
          directSshTerminalActions().invalidateStaleDirectSshTargetPtyBindings?.(nextAuthority) ??
          0,
        retryTargetPanes: (nextAuthority) =>
          directSshTerminalActions().retryDirectSshTargetPanes?.(nextAuthority) ?? 0,
        prepareAndSync: prepareAndSyncDirectSshTarget,
        rememberReconnectAuthority: (nextAuthority) => {
          if (nextAuthority) {
            reconnectAuthorityByTarget.set(targetId, nextAuthority)
          } else {
            reconnectAuthorityByTarget.delete(targetId)
          }
        }
      },
      { authority, previousAuthority, origin }
    )
    // Why: initial connected state can be partial; hydrate only after reconciliation yields a complete authority.
    if (origin === 'initial-hydration') {
      hydrateSshPorts(targetId, authority)
    }
  }

  let sshTargetStateEventId = 0
  const latestSshTargetStateEventByTargetId = new Map<string, number>()

  handleSshStateChangedEvent = (data: { targetId: string; state: unknown }): void => {
    const store = useAppStore.getState()
    const state = data.state as SshConnectionState
    const stateEventId = ++sshTargetStateEventId
    sshStateWatermarkByTargetId.set(
      data.targetId,
      (sshStateWatermarkByTargetId.get(data.targetId) ?? 0) + 1
    )
    latestSshTargetStateEventByTargetId.set(data.targetId, stateEventId)
    if (!store.sshTargetLabels.has(data.targetId)) {
      // Why: unknown target id could be a post-boot add or a removed target racing disconnect; confirm with main first.
      getClientRuntime()
        .ssh.listTargets()
        // Why: refresh doubles as a deletion guard; retry once so a transient IPC failure doesn't drop a real added-target event.
        .catch(() => getClientRuntime().ssh.listTargets())
        .then((targets) => {
          if (latestSshTargetStateEventByTargetId.get(data.targetId) !== stateEventId) {
            return
          }
          latestSshTargetStateEventByTargetId.delete(data.targetId)
          if (isEffectStopped()) {
            return
          }
          const latestStore = useAppStore.getState()
          if (!targets.some((target) => target.id === data.targetId)) {
            // Why: state events can race after target removal; absence from main's target list means deletion, not a new target.
            latestStore.clearRemovedSshTargetState(data.targetId)
            return
          }
          latestStore.setSshTargetsMetadata(targets)
          applySshConnectionStateChange(data.targetId, state, 'push')
        })
        .catch(() => {
          if (
            !isEffectStopped() &&
            latestSshTargetStateEventByTargetId.get(data.targetId) === stateEventId
          ) {
            latestSshTargetStateEventByTargetId.delete(data.targetId)
            applySshConnectionStateChange(data.targetId, state, 'push')
          }
        })
      return
    }

    latestSshTargetStateEventByTargetId.delete(data.targetId)
    applySshConnectionStateChange(data.targetId, state, 'push')
  }

  unsubs.push(getClientRuntime().ssh.onStateChanged(handleSshStateChangedEvent))
  unsubs.push(
    registerDirectSshWakeRouting({
      getConnectionStates: () => useAppStore.getState().sshConnectionStates ?? [],
      wakeAuthority: (authority) => {
        reconnectCoordinator.correctUnboundTerminals(authority, 'wake-refresh')
        void prepareAndSyncDirectSshTarget(authority, 'wake-refresh')
      },
      ...(typeof window.api.ui.onSystemResumed === 'function'
        ? { onSystemResumed: (callback: () => void) => window.api.ui.onSystemResumed(callback) }
        : {})
    })
  )

  let remoteWorkspaceClientId: string | null = null
  let remoteWorkspaceClientIdPromise: Promise<string | null> | null = null
  const getRemoteWorkspaceClientId = (): Promise<string | null> => {
    const remoteWorkspace = getClientRuntime().remoteWorkspace
    if (!remoteWorkspace) {
      return Promise.resolve(null)
    }
    if (remoteWorkspaceClientId) {
      return Promise.resolve(remoteWorkspaceClientId)
    }
    remoteWorkspaceClientIdPromise ??= remoteWorkspace
      .clientId()
      .then((id) => {
        remoteWorkspaceClientId = id
        return id
      })
      .catch(() => null)
    return remoteWorkspaceClientIdPromise
  }
  if (getClientRuntime().remoteWorkspace) {
    void getRemoteWorkspaceClientId()
    unsubs.push(
      getClientRuntime().remoteWorkspace.onChanged((event) => {
        void (async () => {
          // Why: relay notifications can race the client-id IPC; self-originated writes must never bounce back into restore.
          const clientId = await getRemoteWorkspaceClientId()
          if (event.sourceClientId && clientId && event.sourceClientId === clientId) {
            return
          }
          await remoteWorkspaceTargetSync
            ?.applyUnsolicitedSnapshot(event.targetId, event.snapshot)
            .catch((err) => {
              useAppStore.getState().setRemoteWorkspaceSyncStatus(event.targetId, {
                phase: 'error',
                revision: event.snapshot.revision,
                message: err instanceof Error ? err.message : 'Failed to apply remote workspace'
              })
            })
        })()
      })
    )
  }
}
