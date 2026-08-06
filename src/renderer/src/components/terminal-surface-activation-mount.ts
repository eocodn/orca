import { useAppStore } from '../store'
import type { AppState } from '../store'
import type { MutableRefObject } from 'react'
import { isRemoteRuntimePtyId } from '@/runtime/runtime-terminal-inspection'
import { isParkRestorableTerminalPty } from './terminal-pane/terminal-hidden-view-parking'
import { terminalProviderHasAuthoritativeSnapshot } from './terminal/terminal-provider-snapshot-capability'
import {
  canDeferColdActivationTabsForHost,
  canWatcherCoverParkedTerminalTab
} from './terminal-pane/terminal-parked-tab-watchers'
import { hasRegisteredRuntimeTerminalTab } from '../runtime/sync-runtime-graph'
import {
  planColdActivationTabDeferral,
  revealActivationDeferredTabs
} from './terminal/background-terminal-worktree-mount'

type TerminalSurfaceActivationMountContext = {
  renderedActiveWorktreeId: string | null
  canMountTerminalWorkspaceForStartup: (args: {
    workspaceSessionReady: boolean
    hydrationSucceeded: boolean
    startupWorktreeRefreshCompleted: boolean
  }) => boolean
  workspaceSessionReady: boolean
  hydrationSucceeded: boolean
  startupWorktreeRefreshCompleted: boolean
  tabsByWorktree: AppState['tabsByWorktree']
  terminalParkingEnabled: boolean
  terminalTitleSnapshotAuthorityEnabled: boolean
  activeTabId: string | null
  activeTabIdByWorktree: AppState['activeTabIdByWorktree']
  groupsByWorktree: AppState['groupsByWorktree']
  activityTerminalPortals: readonly { worktreeId: string; tabId: string }[]
  pendingStartupByTabId: AppState['pendingStartupByTabId']
  activeWorktreeDeferralHostId: string | null
  pairedRuntimeParkingEnvironmentIds: ReadonlySet<string>
  lastActivationWorktreeIdRef: MutableRefObject<string | null>
  backgroundMountTabIdsByWorktreeRef: MutableRefObject<Map<string, ReadonlySet<string>>>
  activationDeferredMountTabIdsByWorktreeRef: MutableRefObject<Map<string, ReadonlySet<string>>>
  mountedWorktreeIdsRef: MutableRefObject<Set<string>>
}

export function applyTerminalSurfaceActivationMount(
  context: TerminalSurfaceActivationMountContext
): void {
  const {
    renderedActiveWorktreeId,
    canMountTerminalWorkspaceForStartup,
    workspaceSessionReady,
    hydrationSucceeded,
    startupWorktreeRefreshCompleted,
    tabsByWorktree,
    terminalParkingEnabled,
    terminalTitleSnapshotAuthorityEnabled,
    activeTabId,
    activeTabIdByWorktree,
    groupsByWorktree,
    activityTerminalPortals,
    pendingStartupByTabId,
    activeWorktreeDeferralHostId,
    pairedRuntimeParkingEnvironmentIds,
    lastActivationWorktreeIdRef,
    backgroundMountTabIdsByWorktreeRef,
    activationDeferredMountTabIdsByWorktreeRef,
    mountedWorktreeIdsRef
  } = context
  if (
    renderedActiveWorktreeId &&
    canMountTerminalWorkspaceForStartup({
      workspaceSessionReady,
      hydrationSucceeded,
      startupWorktreeRefreshCompleted
    })
  ) {
    const worktreeTabs = tabsByWorktree[renderedActiveWorktreeId] ?? []
    const coldActivationDeferralEnabled =
      terminalParkingEnabled && terminalTitleSnapshotAuthorityEnabled
    const immediateTabIds = new Set<string>()
    if (activeTabId) {
      immediateTabIds.add(activeTabId)
    }
    const rememberedActiveTabId = activeTabIdByWorktree[renderedActiveWorktreeId]
    if (rememberedActiveTabId) {
      immediateTabIds.add(rememberedActiveTabId)
    }
    const unifiedTabById = new Map(
      (useAppStore.getState().unifiedTabsByWorktree[renderedActiveWorktreeId] ?? []).map(
        (unifiedTab) => [unifiedTab.id, unifiedTab]
      )
    )
    for (const group of groupsByWorktree[renderedActiveWorktreeId] ?? []) {
      if (!group.activeTabId) {
        continue
      }
      immediateTabIds.add(group.activeTabId)
      const activeUnifiedTab = unifiedTabById.get(group.activeTabId)
      if (activeUnifiedTab?.contentType === 'terminal') {
        immediateTabIds.add(activeUnifiedTab.entityId)
      }
    }
    for (const portal of activityTerminalPortals) {
      if (portal.worktreeId === renderedActiveWorktreeId) {
        immediateTabIds.add(portal.tabId)
      }
    }
    for (const tab of worktreeTabs) {
      if (pendingStartupByTabId[tab.id] !== undefined) {
        immediateTabIds.add(tab.id)
      }
    }
    const activationHostSupportsDeferral = canDeferColdActivationTabsForHost({
      executionHostId: activeWorktreeDeferralHostId,
      pairedRuntimeParkingEnvironmentIds
    })
    const isColdActivationPtyEligible = (ptyId: string): boolean =>
      isRemoteRuntimePtyId(ptyId)
        ? isParkRestorableTerminalPty(ptyId, renderedActiveWorktreeId, {
            pairedRuntimeParkingEnvironmentIds
          })
        : terminalProviderHasAuthoritativeSnapshot(ptyId)
    if (lastActivationWorktreeIdRef.current !== renderedActiveWorktreeId) {
      lastActivationWorktreeIdRef.current = renderedActiveWorktreeId
      const tabById = new Map(worktreeTabs.map((tab) => [tab.id, tab]))
      planColdActivationTabDeferral({
        restrictions: backgroundMountTabIdsByWorktreeRef.current,
        deferredMountTabIdsByWorktree: activationDeferredMountTabIdsByWorktreeRef.current,
        worktreeId: renderedActiveWorktreeId,
        allTabIds: worktreeTabs.map((tab) => tab.id),
        isTabLive: hasRegisteredRuntimeTerminalTab,
        isTabDeferrable: (tabId) => {
          const tab = tabById.get(tabId)
          return (
            coldActivationDeferralEnabled &&
            activationHostSupportsDeferral &&
            tab !== undefined &&
            canWatcherCoverParkedTerminalTab(
              renderedActiveWorktreeId,
              tab,
              isColdActivationPtyEligible
            )
          )
        },
        immediateTabIds
      })
    } else if (!coldActivationDeferralEnabled || !activationHostSupportsDeferral) {
      backgroundMountTabIdsByWorktreeRef.current.delete(renderedActiveWorktreeId)
      activationDeferredMountTabIdsByWorktreeRef.current.delete(renderedActiveWorktreeId)
    } else {
      for (const tab of worktreeTabs) {
        if (
          !canWatcherCoverParkedTerminalTab(
            renderedActiveWorktreeId,
            tab,
            isColdActivationPtyEligible
          )
        ) {
          immediateTabIds.add(tab.id)
        }
      }
      revealActivationDeferredTabs({
        restrictions: backgroundMountTabIdsByWorktreeRef.current,
        deferredMountTabIdsByWorktree: activationDeferredMountTabIdsByWorktreeRef.current,
        worktreeId: renderedActiveWorktreeId,
        allTabIds: worktreeTabs.map((tab) => tab.id),
        immediateTabIds
      })
    }
    mountedWorktreeIdsRef.current.add(renderedActiveWorktreeId)
  } else {
    lastActivationWorktreeIdRef.current = null
  }
}
