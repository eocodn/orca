import { getClientRuntime } from '@/runtime/client-runtime'
import { useEffect } from 'react'
import { useAppStore } from '../store'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { runSleepWorktree } from '@/components/sidebar/sleep-worktree-flow'
import { createBackgroundSleepingAgentWakeDispatcher } from '@/lib/wake-sleeping-agents-in-background'
import type { DirectSshAuthority } from '../../../shared/ssh-types'
import {
  toRuntimeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'
import { attachMobileMarkdownBridge } from '@/runtime/mobile-markdown-bridge'
import { createWorktreeChangeRefreshQueue } from './worktree-change-refresh-queue'
import { subscribeRuntimeClientEvents } from '@/runtime/runtime-client-events'
import { registerMobileStateEvents } from './ipc-events-mobile-state'
import { registerZoomEvents } from './ipc-events-zoom'
import { registerUiEvents } from './ipc-events-ui'
import { registerTerminalCreateEvents } from './ipc-events-terminal-create'
import { registerTerminalRequestEvents } from './ipc-events-terminal-request'
import {
  activateTerminalInitiatedWorktree,
  focusTerminalInitiatedTab
} from './ipc-events-terminal-model'
import { registerBrowserEvents } from './ipc-events-browser'
import { registerTabEvents } from './ipc-events-tabs'
import { registerSessionEvents } from './ipc-events-session'
import { registerRateLimitEvents } from './ipc-events-rate-limits'
import { toRemoteRuntimePtyId } from '@/runtime/runtime-terminal-stream'
import { dispatchTerminalSideEffectBatch } from '@/components/terminal-pane/terminal-side-effect-facts-handler'
import {
  applyRuntimeEnvironmentSshStateChanged,
  hydrateRuntimeEnvironmentSshState
} from '@/runtime/runtime-environment-ssh-state'
import {
  createRuntimeProjectRefreshScheduler,
  refreshRuntimeProjectWorktrees
} from './runtime-project-refresh-scheduler'
import { createRuntimeClientEventsSync } from './runtime-client-events-sync'
import type { RuntimeClientEvent } from '../../../shared/runtime-client-events'
import { applyHostWorktreeTerminalSleepState } from '@/components/terminal-pane/pty-shutdown-exit-deferral'
import {
  resolveLegacyWorkerTerminalRecoveryAction,
  rollbackLegacyWorkerTerminalSurfaceInStore
} from './legacy-worker-terminal-recovery-event'
import type { AppState } from '../store/types'
import { resetAgentHookCompletionNotificationCoordinators } from './agent-hook-completion-notifications'
import {
  buildRuntimeClientEventEnvironmentKey,
  getNewlyConnectedRuntimeEnvironmentIds,
  getNewlyDisconnectedRuntimeEnvironmentIds,
  getReachableRuntimeEnvironmentIds,
  getRuntimeClientEventEnvironmentIds,
  getRuntimeProjectRefreshEnvironmentIds
} from './ipc-events-runtime-environment-model'
export {
  buildRuntimeClientEventEnvironmentKey,
  getNewlyConnectedRuntimeEnvironmentIds,
  getNewlyDisconnectedRuntimeEnvironmentIds,
  getRuntimeProjectRefreshEnvironmentIds
} from './ipc-events-runtime-environment-model'
import { acquireDirectSshDetectedWorktreeRefresh } from '@/store/slices/worktrees'
import { createDirectSshWorktreeRefreshScheduler } from './direct-ssh-worktree-refresh-scheduler'
import {
  createDirectSshReconnectCoordinator,
  type DirectSshPreparationInput,
  type DirectSshPreparationReason
} from './direct-ssh-reconnect-coordinator'
import { directSshAuthoritiesEqual } from './direct-ssh-reconnect-tokens'
import { createDirectSshHostHydration } from './direct-ssh-host-hydration'
import { createDirectSshReconnectProductTelemetryAdapter } from '@/lib/direct-ssh-reconnect-product-telemetry'
import { registerAgentStatusEvents } from './ipc-events-agent-status'
import { registerSshEvents } from './ipc-events-ssh'
import { registerWorktreeEvents } from './ipc-events-worktree'
import { createIpcEventsCleanup } from './ipc-events-lifecycle'
import { currentDirectSshAuthority } from './ipc-events-direct-ssh-authority'
import {
  activateExistingLeafInLayout,
  acquireBrowserAutomationBootstrapLease,
  addSplitLeafToLayout,
  getAuthoritativeDetectedWorktreeIds,
  getVisibleWorktreeIdsForRepo,
  isRuntimeEnvironmentActive,
  remountTerminalTabsAwaitingHostHydration,
  tryMakePaneKey,
  isPinnedSessionTab,
  resolveTerminalPresentation,
  WORKTREE_RENAME_PURGE_GRACE_MS,
  recentlyRenamedWorktreeIdExpiry,
  openNewWorkspaceFromShortcut,
  resolveBrowserSessionTabTarget
} from './ipc-events-surface-model'
export {
  buildNewWorkspaceShortcutModalData,
  openNewWorkspaceFromShortcut,
  resolveBrowserSessionTabTarget,
  isRemoteWorkspaceSnapshotApplyInProgress
} from './ipc-events-surface-model'
import {
  createRemoteWorkspaceTargetSync,
  type RemoteWorkspaceTargetSync
} from './remote-workspace-target-sync'
export { resolveZoomTarget } from './resolve-zoom-target'
export function useIpcEvents(): void {
  useEffect(() => {
    const unsubs: (() => void)[] = []
    const reconnectAuthorityByTarget = new Map<string, DirectSshAuthority>()
    const authorityReconciliationDeadlines = new Set<{
      timer: ReturnType<typeof setTimeout>
      settle: () => void
    }>()
    let directSshEffectStopped = false
    const scheduler = createDirectSshWorktreeRefreshScheduler({
      startAttempt: (key) => {
        const acquired = acquireDirectSshDetectedWorktreeRefresh(useAppStore, {
          repoId: key.repoId,
          executionHostId: key.executionHostId,
          authority: {
            targetId: key.targetId,
            providerEpoch: key.providerEpoch,
            connectionGeneration: key.connectionGeneration
          },
          requireAuthoritative: key.authorityRequirement === 'required'
        })
        return {
          providerRequestId: acquired.providerRequestId,
          result: acquired.result.then((result) => acquired.merge(result)),
          cancel: acquired.release
        }
      }
    })
    const hostHydration = createDirectSshHostHydration({
      store: useAppStore,
      isCurrentAuthority: (authority) =>
        directSshAuthoritiesEqual(currentDirectSshAuthority(authority.targetId), authority),
      listRepos: (authority) => {
        const executionHostId = toSshExecutionHostId(authority.targetId)
        return (
          getClientRuntime().workspace.repos.listForExecutionHost?.({
            executionHostId,
            expectedAuthority: authority
          }) ??
          Promise.resolve({
            authoritative: false,
            executionHostId,
            reason: 'unavailable' as const
          })
        )
      },
      listLineage: (authority) => {
        const executionHostId = toSshExecutionHostId(authority.targetId)
        return (
          getClientRuntime().workspace.worktrees.listLineageForHost?.({
            executionHostId,
            expectedAuthority: authority
          }) ??
          Promise.resolve({
            authoritative: false,
            executionHostId,
            reason: 'unavailable' as const
          })
        )
      }
    })
    type DirectSshTerminalActions = Partial<
      Pick<AppState, 'invalidateStaleDirectSshTargetPtyBindings' | 'retryDirectSshTargetPanes'>
    >
    const directSshTerminalActions = (): DirectSshTerminalActions =>
      useAppStore.getState() as DirectSshTerminalActions
    let remoteWorkspaceTargetSync: RemoteWorkspaceTargetSync | null = null
    const reconnectCoordinator = createDirectSshReconnectCoordinator({
      scheduler,
      isCurrentConnectedAuthority: (authority) =>
        directSshAuthoritiesEqual(currentDirectSshAuthority(authority.targetId), authority),
      capturePreparationInput: hostHydration.capturePreparationInput,
      readHostScopedLineage: hostHydration.readHostScopedLineage,
      invalidateStaleTerminalBindings: (authority) =>
        directSshTerminalActions().invalidateStaleDirectSshTargetPtyBindings?.(authority) ?? 0,
      retryTargetPanes: (authority) =>
        directSshTerminalActions().retryDirectSshTargetPanes?.(authority) ?? 0,
      finalizeHydratedTerminalPanes: (authority) =>
        directSshTerminalActions().retryDirectSshTargetPanes?.(authority) ?? 0,
      correctUnboundTerminalPanes: (authority) =>
        directSshTerminalActions().retryDirectSshTargetPanes?.(authority) ?? 0,
      syncRemoteWorkspaceAfterConnect: (token) =>
        remoteWorkspaceTargetSync?.syncAfterConnect(token),
      onTelemetry: createDirectSshReconnectProductTelemetryAdapter()
    })
    const remoteWorkspaceApi = getClientRuntime().remoteWorkspace
    if (remoteWorkspaceApi) {
      remoteWorkspaceTargetSync = createRemoteWorkspaceTargetSync({
        store: useAppStore,
        remoteWorkspace: remoteWorkspaceApi,
        getCurrentAuthority: currentDirectSshAuthority,
        isPreparationTokenCurrent: hostHydration.isPreparationTokenCurrent,
        capturePreparationInput: (authority, reason, snapshotRevision) =>
          hostHydration.capturePreparationInput(authority, reason, snapshotRevision),
        prepareOnly: reconnectCoordinator.prepareOnly,
        finalizeHydratedTerminals: (authority) =>
          directSshAuthoritiesEqual(reconnectAuthorityByTarget.get(authority.targetId), authority)
            ? reconnectCoordinator.finalizeHydratedTerminals(authority)
            : 0
      })
    }
    const prepareAndSyncDirectSshTarget = async (
      authority: DirectSshAuthority,
      reason: DirectSshPreparationReason,
      options?: { authorityAlreadyReplaced?: boolean }
    ): Promise<void> => {
      try {
        if (!options?.authorityAlreadyReplaced) {
          reconnectCoordinator.replaceAuthority(authority)
        }
        const input: DirectSshPreparationInput | null = await hostHydration.capturePreparationInput(
          authority,
          reason
        )
        if (!input) {
          return
        }
        const prepared = await reconnectCoordinator.prepareOnly(input)
        if (prepared.token && hostHydration.isPreparationTokenCurrent(prepared.token)) {
          await remoteWorkspaceTargetSync?.syncAfterConnect(prepared.token)
        }
      } catch (error) {
        if (directSshAuthoritiesEqual(currentDirectSshAuthority(authority.targetId), authority)) {
          useAppStore.getState().setRemoteWorkspaceSyncStatus(authority.targetId, {
            phase: 'error',
            message: error instanceof Error ? error.message : 'Workspace sync failed'
          })
        }
      }
    }
    const backgroundSleepingAgentWakeDispatcher = createBackgroundSleepingAgentWakeDispatcher()
    unsubs.push(backgroundSleepingAgentWakeDispatcher.dispose)
    unsubs.push(attachMobileMarkdownBridge())

    const handleWorktreesChanged = async (
      repoId: string,
      renamed?: { oldWorktreeId: string; newWorktreeId: string },
      options?: { forceLocalOwner?: boolean; executionHostId?: ExecutionHostId }
    ): Promise<void> => {
      const localRefreshStartedWithRuntime =
        options?.forceLocalOwner === true && isRuntimeEnvironmentActive()
      // Why: capture active-ness before migration moves the pointer; re-key maps before the diff so a rename isn't a deletion.
      const renamedWasActive =
        renamed != null && useAppStore.getState().activeWorktreeId === renamed.oldWorktreeId
      if (renamed) {
        // Shield both ids from the deletion diff across the rename's event burst — the worktree list lags the on-disk move.
        const expiry = Date.now() + WORKTREE_RENAME_PURGE_GRACE_MS
        recentlyRenamedWorktreeIdExpiry.set(renamed.oldWorktreeId, expiry)
        recentlyRenamedWorktreeIdExpiry.set(renamed.newWorktreeId, expiry)
        useAppStore.getState().migrateWorktreeIdentity(renamed.oldWorktreeId, renamed.newWorktreeId)
      }
      // Why: diff before/after fetch to catch out-of-band deletions and purge worktree state, else zombie ptyId entries leak (design §2c, §4.4).
      const state = useAppStore.getState()
      const before =
        getAuthoritativeDetectedWorktreeIds(state, repoId) ??
        getVisibleWorktreeIdsForRepo(state, repoId)
      await state.fetchWorktrees(
        repoId,
        options?.forceLocalOwner
          ? { forceLocalOwner: true }
          : options?.executionHostId
            ? { executionHostId: options.executionHostId }
            : undefined
      )
      await useAppStore
        .getState()
        .fetchWorktreeLineage(
          options?.forceLocalOwner
            ? { forceLocalOwner: true }
            : options?.executionHostId
              ? { executionHostId: options.executionHostId }
              : undefined
        )
      // Why: an id change unmounts the active pane; re-activate so the tab reconciles, else it vanishes until re-select.
      if (renamedWasActive && renamed) {
        useAppStore.getState().setActiveWorktree(renamed.newWorktreeId)
      }
      // Sweep expired rename-grace entries before any early return, else forced-local
      // (or non-authoritative) events let the map grow for the session.
      const now = Date.now()
      for (const [id, expiry] of recentlyRenamedWorktreeIdExpiry) {
        if (expiry <= now) {
          recentlyRenamedWorktreeIdExpiry.delete(id)
        }
      }
      // Why: the deletion diff below is repo-wide, but a forced-local scan overlapping
      // a runtime cannot prove remote absence (legacy runtime rows may lack hostId).
      // fetchWorktrees still purges removed local rows host-scoped; accepted gap: the
      // workspace-space entry survives until the next local-only rescan.
      if (
        options?.forceLocalOwner &&
        (localRefreshStartedWithRuntime || isRuntimeEnvironmentActive())
      ) {
        return
      }
      const afterState = useAppStore.getState()
      const after = getAuthoritativeDetectedWorktreeIds(afterState, repoId)
      if (!after) {
        return
      }
      const removed: string[] = []
      for (const id of before) {
        if (after.has(id)) {
          continue
        }
        // A recently renamed worktree's old/new id isn't a deletion — its state moved to the new id; the list just lags.
        const graceExpiry = recentlyRenamedWorktreeIdExpiry.get(id)
        if (graceExpiry != null && graceExpiry > now) {
          continue
        }
        removed.push(id)
      }
      if (removed.length > 0) {
        console.warn(
          `[worktree-purge] diff-based purge removing state for ${removed.length} worktree(s):`,
          removed
        )
        afterState.purgeWorktreeTerminalState(removed)
        afterState.removeWorkspaceSpaceWorktrees(removed)
      }
    }
    const worktreeChangeRefreshQueue = createWorktreeChangeRefreshQueue(handleWorktreesChanged)
    unsubs.push(worktreeChangeRefreshQueue.dispose)

    const activateNotifiedWorktree = async (
      {
        repoId,
        worktreeId,
        setup,
        startup,
        defaultTabs
      }: Extract<RuntimeClientEvent, { type: 'activateWorktree' }>,
      options: { allowRuntimeEnvironment: boolean }
    ): Promise<void> => {
      if (!options.allowRuntimeEnvironment && isRuntimeEnvironmentActive()) {
        // Why: local CLI worktree events carry local ids; runtime activation comes via the remote stream, allowed separately.
        return
      }
      const existedBeforeFetch = Boolean(useAppStore.getState().getKnownWorktreeById(worktreeId))
      // Why: fetch first so activation can resolve the CLI-created worktree; it arrived from main, not yet in renderer state.
      await useAppStore.getState().fetchWorktrees(repoId)
      const existsAfterFetch = Boolean(useAppStore.getState().getKnownWorktreeById(worktreeId))
      // Why: use the canonical activation path so the CLI switch records a back/forward visit, or the nav buttons ignore it.
      activateAndRevealWorktree(worktreeId, {
        ...(setup ? { setup } : {}),
        ...(startup ? { startup } : {}),
        ...(defaultTabs ? { defaultTabs } : {}),
        ...(!existedBeforeFetch && existsAfterFetch ? { sidebarRevealBehavior: 'auto' } : {}),
        // Why: this activation came from the host runtime stream; echoing it back can create a selection loop.
        notifyHostRuntime: false
      })
    }

    const ensureRuntimeEventRepoKnown = async (
      environmentId: string,
      repoId: string
    ): Promise<void> => {
      if ((useAppStore.getState().repos ?? []).some((repo) => repo.id === repoId)) {
        return
      }
      await useAppStore.getState().fetchRuntimeEnvironmentRepos(environmentId)
    }

    const runtimeProjectRefreshScheduler = createRuntimeProjectRefreshScheduler({
      refresh: async (environmentId) => {
        // Why: refresh the env's SSH bucket on (re)connect so a pre-drop snapshot can't keep a reconnect overlay stale.
        void hydrateRuntimeEnvironmentSshState(environmentId, { force: true }).catch(() => {})
        const repos = await useAppStore.getState().fetchRuntimeEnvironmentRepos(environmentId)
        await refreshRuntimeProjectWorktrees(environmentId, repos, (repoId, options) =>
          useAppStore.getState().fetchWorktrees(repoId, options)
        )
        await useAppStore.getState().fetchWorktreeLineage({
          executionHostId: toRuntimeExecutionHostId(environmentId)
        })
      },
      onError: (error) => {
        console.error('Failed to refresh runtime projects:', error)
      }
    })

    const handleRuntimeClientEvent = (
      environmentId: string,
      event: RuntimeClientEvent,
      generation = getEnvironmentSshStateGeneration(environmentId)
    ): void => {
      if (event.type === 'worktreeTerminalSleepState') {
        applyHostWorktreeTerminalSleepState(environmentId, event)
        return
      }
      if (event.type === 'terminalSideEffects') {
        dispatchTerminalSideEffectBatch({
          ...event.batch,
          ptyId: toRemoteRuntimePtyId(event.batch.ptyId, environmentId)
        })
        return
      }
      if (event.type === 'reposChanged') {
        runtimeProjectRefreshScheduler.request(environmentId)
        return
      }
      if (event.type === 'sshStateChanged') {
        applyRuntimeEnvironmentSshStateChanged(
          environmentId,
          event.targetId,
          event.state,
          generation
        )
        return
      }
      if (event.type === 'worktreesChanged') {
        void ensureRuntimeEventRepoKnown(environmentId, event.repoId).then(() =>
          worktreeChangeRefreshQueue.enqueue({
            repoId: event.repoId,
            executionHostId: toRuntimeExecutionHostId(environmentId)
          })
        )
        return
      }
      if (event.type === 'linearLinkedIssueUpdated') {
        void useAppStore
          .getState()
          .refreshLinearIssue(event.identifier, event.workspaceId)
          .catch((error) => {
            console.error('Failed to refresh updated Linear issue:', error)
          })
        return
      }
      void ensureRuntimeEventRepoKnown(environmentId, event.repoId)
        .then(() => activateNotifiedWorktree(event, { allowRuntimeEnvironment: true }))
        .catch((error) => {
          console.error('Failed to activate runtime-created worktree:', error)
        })
    }

    const runtimeClientEventsSync = createRuntimeClientEventsSync({
      getDesiredEnvironmentIds: getRuntimeClientEventEnvironmentIds,
      getSubscriptionKey: (environmentId) => buildRuntimeClientEventEnvironmentKey([environmentId]),
      subscribe: (environmentId, onEvent, onError) => {
        const sshGeneration = getEnvironmentSshStateGeneration(environmentId)
        const runtimeGeneration = getRuntimeEnvironmentConnectionGeneration(environmentId)
        const runtimeRevision = getRuntimeEnvironmentRevision(environmentId)
        return subscribeRuntimeClientEvents(
          environmentId,
          (event) => {
            if (
              sshGeneration === getEnvironmentSshStateGeneration(environmentId) &&
              runtimeGeneration === getRuntimeEnvironmentConnectionGeneration(environmentId) &&
              runtimeRevision === getRuntimeEnvironmentRevision(environmentId)
            ) {
              onEvent(event)
            }
          },
          onError,
          () => {
            // Why: events during a transport gap are lost; a quick reconnect won't flip unreachable, so refetch (#7970).
            runtimeProjectRefreshScheduler.request(environmentId)
            // Why: sshStateChanged events during the transport gap are lost, so downgrade the possibly-stale bucket, then refetch.
            useAppStore.getState().markEnvironmentSshStateStale(environmentId)
            void hydrateRuntimeEnvironmentSshState(environmentId, { force: true }).catch(() => {})
          }
        )
      },
      onEvent: handleRuntimeClientEvent
    })

    runtimeClientEventsSync.sync()
    // Why: no on-connect repo fetch (PR #2); seed discovery for connected runtimes or remote projects hide until Add-Project.
    let runtimeClientEventEnvironmentIds = getRuntimeClientEventEnvironmentIds()
    for (const environmentId of runtimeClientEventEnvironmentIds) {
      runtimeProjectRefreshScheduler.request(environmentId)
    }
    let runtimeClientEventEnvironmentKey = buildRuntimeClientEventEnvironmentKey(
      runtimeClientEventEnvironmentIds
    )
    let reachableRuntimeEnvironmentIds = getReachableRuntimeEnvironmentIds()
    let reachableRuntimeEnvironmentKey = buildRuntimeClientEventEnvironmentKey(
      reachableRuntimeEnvironmentIds
    )
    const unsubscribeRuntimeEnvironmentStore = useAppStore.subscribe(() => {
      const nextEnvironmentIds = getRuntimeClientEventEnvironmentIds()
      const nextKey = buildRuntimeClientEventEnvironmentKey(nextEnvironmentIds)
      const nextReachableEnvironmentIds = getReachableRuntimeEnvironmentIds()
      const nextReachableKey = buildRuntimeClientEventEnvironmentKey(nextReachableEnvironmentIds)
      if (
        nextKey === runtimeClientEventEnvironmentKey &&
        nextReachableKey === reachableRuntimeEnvironmentKey
      ) {
        return
      }
      for (const environmentId of getRuntimeProjectRefreshEnvironmentIds({
        previousDesired: runtimeClientEventEnvironmentIds,
        nextDesired: nextEnvironmentIds,
        previousReachable: reachableRuntimeEnvironmentIds,
        nextReachable: nextReachableEnvironmentIds
      })) {
        runtimeProjectRefreshScheduler.request(environmentId)
      }
      for (const environmentId of getNewlyDisconnectedRuntimeEnvironmentIds(
        reachableRuntimeEnvironmentIds,
        nextReachableEnvironmentIds
      )) {
        // No-op when the environment has no SSH bucket (e.g. web client).
        useAppStore.getState().markEnvironmentSshStateStale(environmentId)
      }
      runtimeClientEventEnvironmentIds = nextEnvironmentIds
      runtimeClientEventEnvironmentKey = nextKey
      reachableRuntimeEnvironmentIds = nextReachableEnvironmentIds
      reachableRuntimeEnvironmentKey = nextReachableKey
      runtimeClientEventsSync.sync()
    })
    unsubs.push(runtimeClientEventsSync.stop)
    unsubs.push(runtimeProjectRefreshScheduler.stop)

    registerWorktreeEvents({
      unsubs,
      isRuntimeEnvironmentActive,
      remountTerminalTabsAwaitingHostHydration,
      worktreeChangeRefreshQueue
    })
    registerUiEvents({
      unsubs,
      isRuntimeEnvironmentActive,
      activateNotifiedWorktree,
      openNewWorkspaceFromShortcut
    })
    registerTerminalCreateEvents({
      unsubs,
      resolveTerminalPresentation,
      activateTerminalInitiatedWorktree,
      focusTerminalInitiatedTab,
      tryMakePaneKey,
      addSplitLeafToLayout,
      activateExistingLeafInLayout
    })
    registerTerminalRequestEvents({
      unsubs,
      resolveTerminalPresentation,
      activateTerminalInitiatedWorktree,
      focusTerminalInitiatedTab
    })
    registerSessionEvents({
      unsubs,
      isRuntimeEnvironmentActive,
      isPinnedSessionTab,
      resolveBrowserSessionTabTarget,
      runSleepWorktree,
      backgroundSleepingAgentWakeDispatcher
    })
    registerBrowserEvents({
      unsubs,
      acquireBrowserAutomationBootstrapLease
    })
    registerTabEvents({
      unsubs,
      isRuntimeEnvironmentActive,
      acquireBrowserAutomationBootstrapLease,
      isPinnedSessionTab,
      resolveBrowserSessionTabTarget
    })
    registerRateLimitEvents({ unsubs })
    registerSshEvents({
      unsubs,
      isEffectStopped: () => directSshEffectStopped,
      currentDirectSshAuthority,
      reconnectAuthorityByTarget,
      authorityReconciliationDeadlines,
      reconnectCoordinator,
      directSshTerminalActions,
      prepareAndSyncDirectSshTarget,
      remoteWorkspaceTargetSync
    })
    registerZoomEvents({ unsubs })
    registerAgentStatusEvents({ unsubs })
    registerMobileStateEvents({ unsubs })
    return createIpcEventsCleanup({
      unsubscribeRuntimeEnvironmentStore,
      unsubs,
      markDirectSshEffectStopped: () => {
        directSshEffectStopped = true
      },
      authorityReconciliationDeadlines,
      remoteWorkspaceTargetSync,
      hostHydration,
      reconnectCoordinator,
      reconnectAuthorityByTarget,
      resetAgentHookCompletionNotificationCoordinators
    })
  }, [])
}
