import { useEffect } from 'react'
import type { AppState } from '../store'
import { useAppStore } from '../store'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusEntry
} from '../../../shared/agent-status-types'
import type {
  RuntimeMobileSessionTabsResult,
  RuntimeMobileSessionBrowserTab,
  RuntimeMobileSessionFileTab,
  RuntimeMobileSessionMarkdownTab,
  RuntimeMobileSessionTabGroup,
  RuntimeMobileSessionTerminalClientTab
} from '../../../shared/runtime-types'
import type {
  BrowserCertificateFailure,
  BrowserPage,
  BrowserWorkspace,
  Tab,
  TabGroup,
  TabGroupLayoutNode,
  TerminalLayoutSnapshot,
  TerminalPaneLayoutNode,
  TerminalTab
} from '../../../shared/types'
import type { OpenFile } from '../store/slices/editor'
import { isTerminalLeafId, makePaneKey, parsePaneKey } from '../../../shared/stable-pane-id'
import { getRemoteRuntimePtyEnvironmentId, toRemoteRuntimePtyId } from './runtime-terminal-stream'
import { sanitizeTerminalLayoutPaneTitlesForLabels } from '@/lib/terminal-pane-title-sanitization'
import {
  getExplicitRuntimeEnvironmentIdForWorktree,
  getRuntimeSessionMirrorEnvironmentIds
} from '@/lib/worktree-runtime-owner'
import {
  createWebRuntimeSessionTerminal,
  HOST_TERMINAL_SURFACE_SEPARATOR,
  isWebTerminalSurfaceTabId,
  toWebTerminalSurfaceTabId,
  WEB_TERMINAL_SURFACE_TAB_PREFIX
} from './web-runtime-session'
import {
  normalizeCompatibleAgentStatusEntryForOwner,
  normalizeCompatibleAgentTitleForOwner
} from '../../../shared/agent-title-owner'
import { resolvePaneAgentOwner } from '../../../shared/pane-agent-owner'
import { resolveTerminalLayoutRoot } from './remote-terminal-layout-resolution'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'
import {
  clearWebSessionFocusIntent,
  clearWebSessionFocusIntentsForOwner,
  peekWebSessionFocusIntent
} from './web-session-focus-intent'
import {
  clearWebSessionCloseIntentsForOwner,
  clearWebSessionCloseIntentsForWorktree,
  isWebSessionCloseIntentPending,
  reconcileWebSessionCloseIntents
} from './web-session-close-intent'
import {
  clearWebSessionReorderIntentsForOwner,
  clearWebSessionReorderIntentsForWorktree,
  resolveWebSessionReorderedOrder
} from './web-session-reorder-intent'
import {
  beginWebRuntimeWakeTerminalRespawn,
  clearAllWebRuntimeWakeTerminalRespawn,
  clearWebRuntimeWakeTerminalRespawnForWorktree,
  endWebRuntimeWakeTerminalRespawn,
  shouldSkipWebRuntimeWakeTerminalRespawn
} from './web-runtime-wake-terminal-respawn'
import { isRuntimeSubscriptionReplayResponse } from '../../../shared/runtime-subscription-replay'
import { queueAcceptedWebSessionTerminalSnapshot } from './web-session-terminal-handle-events'
import { recoverWebSessionTerminalOrphansBeforeApply } from './web-session-terminal-orphan-recovery'
import {
  clearWebAgentSessionHandoff,
  clearWebAgentSessionHandoffsForEnvironment,
  clearWebAgentSessionHandoffsForWorktree,
  isWebAgentSessionHandoffPostCreateSnapshotConfirmed,
  resolveWebAgentSessionHandoff
} from './web-agent-session-handoff'
import { getRuntimeEnvironmentRevision } from './runtime-environment-revision'
import {
  agentStatusEntryEqual,
  browserCertificateFailureEqual,
  browserPageEqual,
  browserWorkspaceEqual,
  findCurrentVisibleUnifiedTabId,
  groupEqual,
  isAgentStatusFresh,
  isMirroredCommandCodeTurnBump,
  openFileEqual,
  pushRecentTabId,
  sanitizeRecentTabIds,
  sameAgentStateHistory,
  sameBrowserPages,
  sameBrowserTabs,
  sameGroups,
  sameOpenFiles,
  sameStringArray,
  sameStringRecord,
  sameTerminalTabs,
  sameUnifiedTabs,
  tabEqual,
  terminalTabEqual,
  terminalLayoutNodeEqual,
  terminalLayoutEqual,
  toVisibleTabType,
  withWorktreeEntry
} from './web-session-tabs-equality'

import { WEB_SESSION_GROUP_PREFIX, latestSessionTabsSnapshotByWorktree, replayableSessionTabsSnapshotByWorktree, lastHostTerminalTabCountByWorktree, hostSessionTabIdByLocalKey, isSessionTabsListAllResult, sessionTabsFreshnessKey, rememberHostTerminalTabCount, getLastKnownHostTerminalTabCount, getLatestWebSessionTabsPublicationEpoch, acceptReplayedWebSessionTabsSnapshot, shouldApplyWebSessionTabsSnapshot, shouldBootstrapInitialWebRuntimeTerminal, shouldRespawnWebRuntimeTerminalAfterWake, shouldSyncRuntimeSessionTabs, shouldSyncAllRuntimeSessionTabs, resetWebSessionTabsSnapshotFreshnessForTests, _getWebSessionTabsTrackingCountsForTest, clearWebSessionTabsTrackingForWorktree, clearWebSessionTabsTrackingForEnvironment, hostSessionTabMappingKey, resolveHostSessionTabIdForWebSessionTab, isReadyTerminalTab, isTerminalSurfaceTab, isReadyBrowserTab, isReadyEditorTab, localEditorFileId, editorSourceFileId, isRuntimeTerminalTabForEnvironment, isMirroredTerminalSurfaceId, chooseRemoteTerminalLayout, shouldReplaceTerminalTab, buildMirroredTerminalTabs, toMirroredPaneKey, remapHostAgentStatus, isMirroredAgentPaneKeyForTabs, buildMirroredAgentStatusPatch, buildTerminalUnifiedTab, buildBrowserUnifiedTab, buildEditorUnifiedTab, findExistingEditorUnifiedTab, buildMirroredEditorTabs, findBrowserWorkspaceForRemotePage, browserWorkspaceHasRemoteEnvironmentPage, buildMirroredBrowserTabs, chooseTargetGroupId, collectLayoutGroupIds, buildHostGroupIdByTabId, pruneTabGroupLayout, appendTabGroupLayout, tabGroupLayoutEqual, mapHostRecentTabIds, buildHostToLocalTabIdMap, updateHostSessionTabIdMappings, buildMirroredHostGroups, applyWebSessionTabsSnapshot, applyWebSessionTabsSnapshots, applyFreshWebSessionTabsSnapshot, applyFreshWebSessionTabsSnapshots, applyWebSessionTabsStorePatch, type SessionTabsStreamEvent, type SessionTabsListAllResult, type SnapshotFreshness, type TerminalSurface, type ReadyTerminalSurface, type ReadyBrowserSurface, type ReadyEditorSurface, type MirroredTerminalTab, type MirroredBrowserTab, type MirroredEditorTab, type WebSessionTabsSyncState } from './web-session-tabs-reconciliation'

export function useWebSessionTabsSync(): void {
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)
  const runtimeSessionMirrorEnvironmentKey = useAppStore((state) =>
    getRuntimeSessionMirrorEnvironmentIds(state)
      .map((environmentId) => {
        const status = state.runtimeStatusByEnvironmentId.get(environmentId)
        const environment = state.runtimeEnvironments.find(
          (candidate) => candidate.id === environmentId
        )
        const pairingRevision = environment
          ? (environment.pairingRevision ?? environment.createdAt)
          : ''
        return `${environmentId}\u0001${status?.status?.runtimeId ?? ''}\u0001${status?.connectionGeneration ?? 0}\u0001${pairingRevision}`
      })
      .join('\u0000')
  )
  const activeWorktreeRuntimeEnvironmentId = useAppStore((state) =>
    getExplicitRuntimeEnvironmentIdForWorktree(state, state.activeWorktreeId)
  )
  const activeWorktreeRuntimeId = useAppStore((state) => {
    const environmentId = getExplicitRuntimeEnvironmentIdForWorktree(state, state.activeWorktreeId)
    return environmentId
      ? (state.runtimeStatusByEnvironmentId.get(environmentId)?.status?.runtimeId ?? null)
      : null
  })
  const activeWorktreeRuntimeConnectionGeneration = useAppStore((state) => {
    const environmentId = getExplicitRuntimeEnvironmentIdForWorktree(state, state.activeWorktreeId)
    return environmentId
      ? (state.runtimeStatusByEnvironmentId.get(environmentId)?.connectionGeneration ?? 0)
      : 0
  })
  const activeWorktreeRuntimePairingRevision = useAppStore((state) => {
    const environmentId = getExplicitRuntimeEnvironmentIdForWorktree(state, state.activeWorktreeId)
    const environment = state.runtimeEnvironments.find(
      (candidate) => candidate.id === environmentId
    )
    return environment ? (environment.pairingRevision ?? environment.createdAt) : undefined
  })
  const workspaceSessionReady = useAppStore((state) => state.workspaceSessionReady)

  useEffect(() => {
    const environments = runtimeSessionMirrorEnvironmentKey
      ? runtimeSessionMirrorEnvironmentKey
          .split('\u0000')
          .map((entry) => {
            const [environmentId = '', , , rawRevision = ''] = entry.split('\u0001')
            return {
              environmentId,
              expectedEnvironmentPairingRevision:
                rawRevision === '' ? undefined : Number(rawRevision)
            }
          })
          .filter(({ environmentId }) => environmentId.trim())
      : []
    // Why: mirror all paired runtimes' sessions, not just the selected worktree, so background worktrees don't look asleep (selectedness isn't liveness).
    // Why: applying the host snapshot before startup hydration writes browser-local session state clobbers it and leaves the sidebar stale.
    if (!workspaceSessionReady || environments.length === 0) {
      return
    }

    let disposed = false
    const unsubscribes: (() => void)[] = []
    // Why: the stream's initial snapshot can land after first render, so a one-shot fetch makes initial parity deterministic.
    for (const { environmentId, expectedEnvironmentPairingRevision } of environments) {
      if (
        !shouldSyncAllRuntimeSessionTabs({
          activeRuntimeEnvironmentId: environmentId,
          workspaceSessionReady
        })
      ) {
        continue
      }
      void window.api.runtimeEnvironments
        .call({
          selector: environmentId,
          method: 'session.tabs.listAll',
          params: {},
          timeoutMs: 15_000,
          expectedEnvironmentPairingRevision
        })
        .then(async (response: RuntimeRpcResponse<unknown>) => {
          if (
            disposed ||
            getRuntimeEnvironmentRevision(environmentId) !== expectedEnvironmentPairingRevision
          ) {
            return
          }
          if (response.ok === false) {
            console.warn('[web-session-tabs-sync] initial listAll failed:', response.error.message)
            return
          }
          const result = response.result
          if (!isSessionTabsListAllResult(result)) {
            console.warn('[web-session-tabs-sync] initial listAll returned an invalid payload')
            return
          }
          const recovered = await Promise.all(
            result.snapshots.map((snapshot) =>
              recoverWebSessionTerminalOrphansBeforeApply(
                useAppStore.getState(),
                snapshot,
                environmentId
              )
            )
          )
          if (disposed) {
            return
          }
          const applicable = recovered.filter(
            (snapshot): snapshot is RuntimeMobileSessionTabsResult => snapshot !== null
          )
          applyWebSessionTabsStorePatch((state) =>
            applyFreshWebSessionTabsSnapshots(state, applicable, environmentId)
          )
        })
        .catch((error) => {
          if (!disposed) {
            console.warn(
              '[web-session-tabs-sync] failed to load initial session tabs:',
              error instanceof Error ? error.message : String(error)
            )
          }
        })

      void window.api.runtimeEnvironments
        .subscribe(
          {
            selector: environmentId,
            method: 'session.tabs.subscribeAll',
            params: {},
            timeoutMs: 15_000,
            expectedEnvironmentPairingRevision
          },
          {
            onResponse: (response: RuntimeRpcResponse<unknown>) => {
              if (
                disposed ||
                getRuntimeEnvironmentRevision(environmentId) !== expectedEnvironmentPairingRevision
              ) {
                return
              }
              if (response.ok === false) {
                console.warn(
                  '[web-session-tabs-sync] global subscription failed:',
                  response.error.message
                )
                return
              }
              const event = response.result as SessionTabsStreamEvent
              const replayed = isRuntimeSubscriptionReplayResponse(response)
              if (event.type === 'snapshots') {
                void Promise.all(
                  event.snapshots.map((snapshot) =>
                    recoverWebSessionTerminalOrphansBeforeApply(
                      useAppStore.getState(),
                      snapshot,
                      environmentId
                    )
                  )
                )
                  .then((recovered) => {
                    if (!disposed) {
                      const applicable = recovered.filter(
                        (snapshot): snapshot is RuntimeMobileSessionTabsResult => snapshot !== null
                      )
                      if (replayed) {
                        for (const snapshot of applicable) {
                          acceptReplayedWebSessionTabsSnapshot(environmentId, snapshot.worktree)
                        }
                      }
                      applyWebSessionTabsStorePatch((state) =>
                        applyFreshWebSessionTabsSnapshots(state, applicable, environmentId)
                      )
                    }
                  })
                  .catch((error) => {
                    if (!disposed) {
                      console.warn('[web-session-tabs-sync] snapshot recovery failed:', error)
                    }
                  })
                return
              }
              if (event.type !== 'snapshot' && event.type !== 'updated') {
                return
              }
              void recoverWebSessionTerminalOrphansBeforeApply(
                useAppStore.getState(),
                event,
                environmentId
              )
                .then((recovered) => {
                  if (!disposed && recovered) {
                    if (replayed) {
                      acceptReplayedWebSessionTabsSnapshot(environmentId, recovered.worktree)
                    }
                    applyWebSessionTabsStorePatch((state) =>
                      applyFreshWebSessionTabsSnapshot(state, recovered, environmentId)
                    )
                  }
                })
                .catch((error) => {
                  if (!disposed) {
                    console.warn('[web-session-tabs-sync] snapshot recovery failed:', error)
                  }
                })
            },
            onError: (error) => {
              console.warn('[web-session-tabs-sync] global subscription error:', error.message)
            }
          }
        )
        .then((handle) => {
          if (disposed) {
            handle.unsubscribe()
            return
          }
          unsubscribes.push(handle.unsubscribe)
        })
        .catch((error) => {
          if (!disposed) {
            console.warn(
              '[web-session-tabs-sync] failed to subscribe globally:',
              error instanceof Error ? error.message : String(error)
            )
          }
        })
    }

    return () => {
      disposed = true
      for (const unsubscribe of unsubscribes) {
        unsubscribe()
      }
      // Why: environment ids churn as paired runtimes reconnect; don't leak stale tracking for the renderer lifetime.
      for (const { environmentId, expectedEnvironmentPairingRevision } of environments) {
        clearWebSessionTabsTrackingForEnvironment(environmentId)
        const owner = {
          environmentId,
          pairingRevision: expectedEnvironmentPairingRevision
        }
        clearWebSessionCloseIntentsForOwner(owner)
        clearWebSessionFocusIntentsForOwner(owner)
        clearWebSessionReorderIntentsForOwner(owner)
      }
    }
  }, [runtimeSessionMirrorEnvironmentKey, workspaceSessionReady])

  useEffect(() => {
    const environmentId = activeWorktreeRuntimeEnvironmentId?.trim()
    const expectedEnvironmentPairingRevision = activeWorktreeRuntimePairingRevision
    if (
      !shouldSyncRuntimeSessionTabs({
        activeWorktreeId,
        activeWorktreeRuntimeEnvironmentId,
        workspaceSessionReady
      }) ||
      !environmentId ||
      !activeWorktreeId
    ) {
      return
    }

    // Why: activating a worktree can clear its local mirror after the global stream already recorded this host revision.
    acceptReplayedWebSessionTabsSnapshot(environmentId, activeWorktreeId)
    let disposed = false
    let requestedInitialTerminal = false
    let requestedRespawnAfterWake = false
    let unsubscribe: (() => void) | null = null
    const applyActiveSnapshot = async (
      event: RuntimeMobileSessionTabsResult & { type: 'snapshot' | 'updated' },
      response: RuntimeRpcResponse<unknown>
    ): Promise<void> => {
      const recovered = await recoverWebSessionTerminalOrphansBeforeApply(
        useAppStore.getState(),
        event,
        environmentId
      )
      if (disposed || !recovered) {
        return
      }
      if (isRuntimeSubscriptionReplayResponse(response)) {
        acceptReplayedWebSessionTabsSnapshot(environmentId, recovered.worktree)
      }
      const recoveredEvent: SessionTabsStreamEvent = { ...recovered, type: event.type }
      const fresh = shouldApplyWebSessionTabsSnapshot(recovered, environmentId)
      const syncState = useAppStore.getState()
      const localWorktreeTabs = syncState.tabsByWorktree[activeWorktreeId] ?? []
      const localTerminalCount = localWorktreeTabs.length
      const hasLiveLocalPty = localWorktreeTabs.some(
        (tab) => (syncState.ptyIdsByTabId[tab.id] ?? []).length > 0
      )
      const shouldBootstrapInitialTerminal = shouldBootstrapInitialWebRuntimeTerminal({
        event: recoveredEvent,
        activeWorktreeId,
        requestedInitialTerminal,
        snapshotIsFresh: fresh,
        localTerminalCount
      })
      const shouldRespawnAfterWake = shouldRespawnWebRuntimeTerminalAfterWake({
        event: recoveredEvent,
        activeWorktreeId,
        requestedRespawnAfterWake,
        snapshotIsFresh: fresh,
        localTerminalCount,
        hasLiveLocalPty,
        skipWakeRespawn: shouldSkipWebRuntimeWakeTerminalRespawn(activeWorktreeId)
      })
      if (fresh) {
        applyWebSessionTabsStorePatch((state) =>
          applyWebSessionTabsSnapshot(state, recovered, environmentId)
        )
      }
      if (!disposed && shouldBootstrapInitialTerminal) {
        requestedInitialTerminal = true
        await createWebRuntimeSessionTerminal({
          worktreeId: activeWorktreeId,
          environmentId,
          activate: true
        })
      } else if (
        !disposed &&
        shouldRespawnAfterWake &&
        beginWebRuntimeWakeTerminalRespawn(activeWorktreeId)
      ) {
        requestedRespawnAfterWake = true
        await createWebRuntimeSessionTerminal({
          worktreeId: activeWorktreeId,
          environmentId,
          activate: true,
          selectWorktree: false
        }).finally(() => endWebRuntimeWakeTerminalRespawn(activeWorktreeId))
      }
    }
    void window.api.runtimeEnvironments
      .subscribe(
        {
          selector: environmentId,
          method: 'session.tabs.subscribe',
          params: { worktree: toRuntimeWorktreeSelector(activeWorktreeId) },
          timeoutMs: 15_000,
          expectedEnvironmentPairingRevision
        },
        {
          onResponse: (response: RuntimeRpcResponse<unknown>) => {
            if (
              disposed ||
              getRuntimeEnvironmentRevision(environmentId) !== expectedEnvironmentPairingRevision
            ) {
              return
            }
            if (response.ok === false) {
              console.warn('[web-session-tabs-sync] subscription failed:', response.error.message)
              return
            }
            const event = response.result as SessionTabsStreamEvent
            if (event.type !== 'snapshot' && event.type !== 'updated') {
              return
            }
            void applyActiveSnapshot(event, response).catch((error) => {
              if (!disposed) {
                console.warn('[web-session-tabs-sync] active snapshot recovery failed:', error)
              }
            })
          },
          onError: (error) => {
            console.warn('[web-session-tabs-sync] subscription error:', error.message)
          }
        }
      )
      .then((handle) => {
        if (disposed) {
          handle.unsubscribe()
          return
        }
        unsubscribe = handle.unsubscribe
      })
      .catch((error) => {
        if (!disposed) {
          console.warn(
            '[web-session-tabs-sync] failed to subscribe:',
            error instanceof Error ? error.message : String(error)
          )
        }
      })

    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [
    activeWorktreeId,
    activeWorktreeRuntimeEnvironmentId,
    activeWorktreeRuntimeConnectionGeneration,
    activeWorktreeRuntimeId,
    activeWorktreeRuntimePairingRevision,
    workspaceSessionReady
  ])
}
