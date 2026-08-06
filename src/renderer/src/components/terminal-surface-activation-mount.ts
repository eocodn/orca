import { useAppStore } from '../store'

export function applyTerminalSurfaceActivationMount(context: Record<string, any>): void {
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
    canDeferColdActivationTabsForHost,
    activeWorktreeDeferralHostId,
    pairedRuntimeParkingEnvironmentIds,
    isRemoteRuntimePtyId,
    isParkRestorableTerminalPty,
    terminalProviderHasAuthoritativeSnapshot,
    lastActivationWorktreeIdRef,
    planColdActivationTabDeferral,
    backgroundMountTabIdsByWorktreeRef,
    activationDeferredMountTabIdsByWorktreeRef,
    hasRegisteredRuntimeTerminalTab,
    canWatcherCoverParkedTerminalTab,
    revealActivationDeferredTabs,
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

