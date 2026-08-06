import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store'
import { haveSameTerminalIdSet } from './terminal-surface-parking-model'
export function useTerminalSurfaceParkingController(
  context: Record<string, any>
): Record<string, any> {
  const {
    activeView,
    renderedActiveWorktreeId,
    workspaceSurfaces,
    tabsByWorktree,
    pendingStartupByTabId,
    terminalParkingEnabled,
    terminalSshParkingEnabled,
    runtimeStatusByEnvironmentId,
    pairedRuntimeParkingEnvironmentIds,
    terminalRetentionBudgetEnabled,
    terminalTitleSnapshotAuthorityEnabled,
    activeTabId,
    activeTabIdByWorktree,
    workspaceSessionReady,
    hydrationSucceeded,
    startupWorktreeRefreshCompleted,
    activityTerminalPortals,
    activeWorktreeDeferralHostId,
    layoutByWorktree,
    groupsByWorktree,
    activeGroupIdByWorktree,
    getEffectiveLayoutForWorktree,
    mountedWorktreeIdsRef,
    measurableBackgroundWorktreeIdsRef,
    terminalWorktreeHiddenSinceRef,
    measuringTerminalWorktreeIdsRef,
    terminalWorktreeParkCooldownUntilRef,
    terminalWorktreeParkingTimersRef,
    isRemoteRuntimePtyId,
    isParkRestorableTerminalPty,
    terminalProviderHasAuthoritativeSnapshot,
    selectColdParkedTerminalWorktrees,
    selectRetentionForceParkedTerminalWorktrees,
    selectForceParkEvictableTabIds,
    selectEvictionExemptTerminalTabIds,
    captureForceParkedWorktreeBuffers,
    warnTerminalLifecycleAnomaly,
    getTerminalParkingPolicyOverrides,
    recordTerminalWorktreeParkingDebugVerdicts,
    canParkTerminalWorktreeRenderers,
    getTerminalWorktreeColdParkRecheckDelayMs,
    combineTerminalWorktreeParkIds,
    useManualTerminalWorktreeParking,
    canDeferColdActivationTabsForHost,
    canWatcherCoverParkedTerminalTab,
    disposeAllParkedTerminalWatchers,
    pruneParkedTerminalWatchers,
    syncParkedTerminalTabWatchers,
    terminalWatcherLiveWorkspaceIds,
    findActivityTerminalPortal,
    hasRegisteredRuntimeTerminalTab,
    canMountTerminalWorkspaceForStartup,
    applyBackgroundMountTabRestriction,
    planColdActivationTabDeferral,
    pruneClosedBackgroundMountTabs,
    revealActivationDeferredTabs,
    shouldMountBackgroundWorktreeTab,
    takeAllPendingBackgroundTerminalWorktreeMounts,
    takePendingBackgroundTerminalWorktreeMount
  } = context
  const measurableBackgroundWorktreeTimersRef = useRef(new Map<string, number>())
  const [backgroundMountRevision, setBackgroundMountRevision] = useState(0)
  const [terminalParkingRevision, setTerminalParkingRevision] = useState(0)
  const [parkedTerminalWorktreeIds, setParkedTerminalWorktreeIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const manuallyParkedTerminalWorktreeIds = useManualTerminalWorktreeParking({
    activeView,
    renderedActiveWorktreeId
  })
  const effectiveParkedTerminalWorktreeIds = useMemo(
    () =>
      combineTerminalWorktreeParkIds(parkedTerminalWorktreeIds, manuallyParkedTerminalWorktreeIds),
    [manuallyParkedTerminalWorktreeIds, parkedTerminalWorktreeIds]
  )
  const [forceParkedTerminalWorktreeIds, setForceParkedTerminalWorktreeIds] = useState<
    ReadonlySet<string>
  >(() => new Set())
  const [evictionExemptTerminalTabIds, setEvictionExemptTerminalTabIds] = useState<
    ReadonlySet<string>
  >(() => new Set())
  const forceParkedCaptureDoneRef = useRef(new Set<string>())
  const backgroundMountTabIdsByWorktreeRef = useRef(new Map<string, ReadonlySet<string>>())
  const activationDeferredMountTabIdsByWorktreeRef = useRef(new Map<string, ReadonlySet<string>>())
  const lastActivationWorktreeIdRef = useRef<string | null>(null)
  useEffect(() => {
    const timers = measurableBackgroundWorktreeTimersRef.current
    const closeDialogDebounceTimers = closeDialogDebounceTimersRef.current
    const applyBackgroundMount = (detail: BackgroundMountTerminalWorktreeDetail): void => {
      const worktreeId = detail.worktreeId
      applyBackgroundMountTabRestriction(
        backgroundMountTabIdsByWorktreeRef.current,
        mountedWorktreeIdsRef.current,
        worktreeId,
        detail.tabIds
      )
      const worktreeTabIds = (useAppStore.getState().tabsByWorktree[worktreeId] ?? []).map(
        (tab) => tab.id
      )
      revealActivationDeferredTabs({
        restrictions: backgroundMountTabIdsByWorktreeRef.current,
        deferredMountTabIdsByWorktree: activationDeferredMountTabIdsByWorktreeRef.current,
        worktreeId,
        allTabIds: worktreeTabIds,
        immediateTabIds: new Set(detail.tabIds ?? worktreeTabIds)
      })
      scheduleBackgroundTerminalWorktreeMeasure({
        mountedWorktreeIds: mountedWorktreeIdsRef.current,
        measurableBackgroundWorktreeIds: measurableBackgroundWorktreeIdsRef.current,
        timers,
        worktreeId,
        onRevision: () => setBackgroundMountRevision((revision) => revision + 1),
        setTimeoutFn: window.setTimeout,
        clearTimeoutFn: window.clearTimeout
      })
    }
    const onBackgroundMountTerminalWorktree = (event: Event): void => {
      const customEvent = event as CustomEvent<BackgroundMountTerminalWorktreeDetail>
      const worktreeId = customEvent.detail?.worktreeId
      const pending = takePendingBackgroundTerminalWorktreeMount(worktreeId)
      const detail = pending ?? customEvent.detail
      if (detail?.worktreeId) {
        applyBackgroundMount(detail)
      }
    }
    window.addEventListener(
      BACKGROUND_MOUNT_TERMINAL_WORKTREE_EVENT,
      onBackgroundMountTerminalWorktree as EventListener
    )
    for (const pending of takeAllPendingBackgroundTerminalWorktreeMounts()) {
      applyBackgroundMount(pending)
    }
    return () => {
      window.removeEventListener(
        BACKGROUND_MOUNT_TERMINAL_WORKTREE_EVENT,
        onBackgroundMountTerminalWorktree as EventListener
      )
      for (const timer of timers.values()) {
        window.clearTimeout(timer)
      }
      timers.clear()
      for (const timer of closeDialogDebounceTimers) {
        window.clearTimeout(timer)
      }
      closeDialogDebounceTimers.clear()
    }
  }, [])
  useEffect(() => {
    const timers = terminalWorktreeParkingTimersRef.current
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer)
      }
      timers.clear()
    }
  }, [])
  useEffect(() => {
    const parkingTimers = terminalWorktreeParkingTimersRef.current
    for (const timer of parkingTimers.values()) {
      window.clearTimeout(timer)
    }
    parkingTimers.clear()
    const nowMs = Date.now()
    const overrides = getTerminalParkingPolicyOverrides()
    const portalWorktreeIds = new Set(activityTerminalPortals.map((portal) => portal.worktreeId))
    const currentWorktreeIds = new Set(workspaceSurfaces.map((workspace) => workspace.id))
    for (const worktreeId of Array.from(terminalWorktreeHiddenSinceRef.current.keys())) {
      if (!currentWorktreeIds.has(worktreeId) || !mountedWorktreeIdsRef.current.has(worktreeId)) {
        terminalWorktreeHiddenSinceRef.current.delete(worktreeId)
        measuringTerminalWorktreeIdsRef.current.delete(worktreeId)
        terminalWorktreeParkCooldownUntilRef.current.delete(worktreeId)
      }
    }
    const retentionCandidates: TerminalWorktreeColdParkCandidate[] = []
    for (const workspace of workspaceSurfaces) {
      const worktreeId = workspace.id
      if (!mountedWorktreeIdsRef.current.has(worktreeId)) {
        terminalWorktreeHiddenSinceRef.current.delete(worktreeId)
        measuringTerminalWorktreeIdsRef.current.delete(worktreeId)
        terminalWorktreeParkCooldownUntilRef.current.delete(worktreeId)
        continue
      }
      const isVisible = activeView === 'terminal' && renderedActiveWorktreeId === worktreeId
      const shouldMeasureHiddenWorktree =
        !isVisible && measurableBackgroundWorktreeIdsRef.current.has(worktreeId)
      const hasActivityTerminalPortal = portalWorktreeIds.has(worktreeId)
      if (shouldMeasureHiddenWorktree) {
        measuringTerminalWorktreeIdsRef.current.add(worktreeId)
      } else {
        if (measuringTerminalWorktreeIdsRef.current.has(worktreeId)) {
          terminalWorktreeParkCooldownUntilRef.current.set(
            worktreeId,
            nowMs + (overrides.coldParkDelayMs ?? TERMINAL_WORKTREE_COLD_PARK_DELAY_MS)
          )
        }
        measuringTerminalWorktreeIdsRef.current.delete(worktreeId)
      }
      if (isVisible || hasActivityTerminalPortal) {
        terminalWorktreeHiddenSinceRef.current.delete(worktreeId)
        terminalWorktreeParkCooldownUntilRef.current.delete(worktreeId)
      } else if (!shouldMeasureHiddenWorktree) {
        if (!terminalWorktreeHiddenSinceRef.current.has(worktreeId)) {
          terminalWorktreeHiddenSinceRef.current.set(worktreeId, nowMs)
        }
      }
      retentionCandidates.push({
        worktreeId,
        terminalTabs: tabsByWorktree[worktreeId] ?? [],
        isVisible,
        shouldMeasureHiddenWorktree,
        hasActivityTerminalPortal,
        hiddenSinceMs: terminalWorktreeHiddenSinceRef.current.get(worktreeId) ?? null,
        parkCooldownUntilMs: terminalWorktreeParkCooldownUntilRef.current.get(worktreeId) ?? null
      })
    }
    const restorePolicy = {
      sshParkingEnabled: terminalSshParkingEnabled,
      pairedRuntimeParkingEnvironmentIds
    }
    const nextParkedTerminalWorktreeIds = selectColdParkedTerminalWorktrees({
      worktrees: retentionCandidates,
      pendingStartupByTabId,
      parkingEnabled: terminalParkingEnabled,
      nowMs,
      restorePolicy,
      ...overrides
    })
    const watcherCoverageByTabId = new Map<string, boolean>()
    const worktreeTabsAreWatcherCovered = (worktreeId: string, tabs: TerminalTab[]): boolean =>
      tabs.every((tab) => {
        const cached = watcherCoverageByTabId.get(tab.id)
        if (cached !== undefined) {
          return cached
        }
        const covered = canWatcherCoverParkedTerminalTab(worktreeId, tab)
        watcherCoverageByTabId.set(tab.id, covered)
        return covered
      })
    for (const worktreeId of Array.from(nextParkedTerminalWorktreeIds)) {
      if (!worktreeTabsAreWatcherCovered(worktreeId, tabsByWorktree[worktreeId] ?? [])) {
        nextParkedTerminalWorktreeIds.delete(worktreeId)
      }
    }
    const retentionBudgetCandidates: TerminalWorktreeRetentionCandidate[] = retentionCandidates.map(
      (candidate) => {
        const tabs = tabsByWorktree[candidate.worktreeId] ?? []
        const parkEligible = canParkTerminalWorktreeRenderers({
          ...candidate,
          parkCooldownUntilMs: null,
          pendingStartupByTabId,
          parkingEnabled: terminalParkingEnabled,
          nowMs,
          restorePolicy,
          ...(overrides.coldParkDelayMs !== undefined
            ? { coldParkDelayMs: overrides.coldParkDelayMs }
            : {})
        })
        return {
          worktreeId: candidate.worktreeId,
          hiddenSinceMs: candidate.hiddenSinceMs,
          isVisible: candidate.isVisible,
          shouldMeasureHiddenWorktree: candidate.shouldMeasureHiddenWorktree,
          hasActivityTerminalPortal: candidate.hasActivityTerminalPortal,
          parkCooldownUntilMs: candidate.parkCooldownUntilMs ?? null,
          ordinaryParkingCovers:
            parkEligible && worktreeTabsAreWatcherCovered(candidate.worktreeId, tabs),
          hasPendingSpawnWork: tabs.some((tab) =>
            hasPendingRetentionSpawnWork(tab, pendingStartupByTabId)
          )
        }
      }
    )
    const forceParkedWorktreeIds = selectRetentionForceParkedTerminalWorktrees({
      worktrees: retentionBudgetCandidates,
      parkingEnabled: terminalParkingEnabled,
      retentionBudgetEnabled: terminalRetentionBudgetEnabled,
      nowMs,
      ...overrides
    })
    recordTerminalWorktreeParkingDebugVerdicts(
      retentionBudgetCandidates.map((candidate) => ({
        ...candidate,
        parkCooldownUntilMs: candidate.parkCooldownUntilMs ?? null,
        forceParked: forceParkedWorktreeIds.has(candidate.worktreeId)
      }))
    )
    const capturedForceParked = forceParkedCaptureDoneRef.current
    for (const id of Array.from(capturedForceParked)) {
      if (!forceParkedWorktreeIds.has(id)) {
        capturedForceParked.delete(id)
      }
    }
    const repos = useAppStore.getState().repos
    const nextEvictionExemptTabIds = new Set<string>()
    for (const worktreeId of forceParkedWorktreeIds) {
      const forceParkedTabs = tabsByWorktree[worktreeId] ?? []
      const exemptTabIds = selectEvictionExemptTerminalTabIds(worktreeId, forceParkedTabs)
      for (const tabId of exemptTabIds) {
        nextEvictionExemptTabIds.add(tabId)
      }
      if (!capturedForceParked.has(worktreeId)) {
        const evictableTabIds = selectForceParkEvictableTabIds(forceParkedTabs, (tab) =>
          exemptTabIds.has(tab.id)
        )
        if (evictableTabIds.length === 0 && forceParkedTabs.length > 0) {
          warnTerminalLifecycleAnomaly('retention force-park freed no panes', {
            worktreeId,
            reason: `exemptTabs=${forceParkedTabs.length}`
          })
        }
        if (captureForceParkedWorktreeBuffers({ worktreeId, tabIds: evictableTabIds, repos })) {
          capturedForceParked.add(worktreeId)
        }
      }
      nextParkedTerminalWorktreeIds.add(worktreeId)
    }
    setParkedTerminalWorktreeIds((current) =>
      haveSameTerminalIdSet(current, nextParkedTerminalWorktreeIds)
        ? current
        : nextParkedTerminalWorktreeIds
    )
    setForceParkedTerminalWorktreeIds((current) =>
      haveSameTerminalIdSet(current, forceParkedWorktreeIds) ? current : forceParkedWorktreeIds
    )
    setEvictionExemptTerminalTabIds((current) =>
      haveSameTerminalIdSet(current, nextEvictionExemptTabIds) ? current : nextEvictionExemptTabIds
    )
    const retentionTtlEligibleIds = new Set(
      retentionBudgetCandidates
        .filter((candidate) => !candidate.ordinaryParkingCovers && !candidate.hasPendingSpawnWork)
        .map((candidate) => candidate.worktreeId)
    )
    for (const candidate of retentionCandidates) {
      if (
        candidate.isVisible ||
        candidate.shouldMeasureHiddenWorktree ||
        candidate.hasActivityTerminalPortal ||
        nextParkedTerminalWorktreeIds.has(candidate.worktreeId)
      ) {
        continue
      }
      const delayMs = getTerminalWorktreeColdParkRecheckDelayMs({
        parkingEnabled: terminalParkingEnabled,
        hiddenSinceMs: candidate.hiddenSinceMs,
        parkCooldownUntilMs: candidate.parkCooldownUntilMs,
        nowMs,
        ...overrides,
        ...(terminalRetentionBudgetEnabled && retentionTtlEligibleIds.has(candidate.worktreeId)
          ? {
              retentionTtlMs: overrides.retentionTtlMs ?? TERMINAL_HIDDEN_WORKTREE_RETENTION_TTL_MS
            }
          : {})
      })
      if (delayMs !== null && delayMs > 0) {
        const worktreeId = candidate.worktreeId
        const timer = window.setTimeout(() => {
          parkingTimers.delete(worktreeId)
          setTerminalParkingRevision((revision) => revision + 1)
        }, delayMs)
        parkingTimers.set(worktreeId, timer)
      }
    }
  }, [
    activeView,
    activityTerminalPortals,
    backgroundMountRevision,
    pendingStartupByTabId,
    pairedRuntimeParkingEnvironmentIds,
    renderedActiveWorktreeId,
    tabsByWorktree,
    terminalParkingEnabled,
    terminalParkingRevision,
    terminalRetentionBudgetEnabled,
    terminalSshParkingEnabled,
    workspaceSurfaces
  ])
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
  pruneClosedBackgroundMountTabs(
    backgroundMountTabIdsByWorktreeRef.current,
    mountedWorktreeIdsRef.current,
    tabsByWorktree,
    activationDeferredMountTabIdsByWorktreeRef.current
  )
  const allWorktreeIds = new Set(workspaceSurfaces.map((workspace) => workspace.id))
  for (const id of mountedWorktreeIdsRef.current) {
    if (!allWorktreeIds.has(id)) {
      mountedWorktreeIdsRef.current.delete(id)
      backgroundMountTabIdsByWorktreeRef.current.delete(id)
      activationDeferredMountTabIdsByWorktreeRef.current.delete(id)
    }
  }
  const anyMountedWorktreeHasLayout = computeAnyMountedWorktreeHasLayout(
    workspaceSurfaces.map((workspace) => workspace.id),
    mountedWorktreeIdsRef.current,
    layoutByWorktree,
    groupsByWorktree,
    activeGroupIdByWorktree
  )
  useEffect(() => {
    pruneParkedTerminalWatchers(
      terminalWatcherLiveWorkspaceIds(workspaceSurfaces.map((workspace) => workspace.id))
    )
    for (const workspace of workspaceSurfaces) {
      if (
        anyMountedWorktreeHasLayout &&
        mountedWorktreeIdsRef.current.has(workspace.id) &&
        getEffectiveLayoutForWorktree(workspace.id)
      ) {
        continue
      }
      const tabs = tabsByWorktree[workspace.id] ?? []
      const parkedTabIds = new Set<string>()
      let deferredTabIds: ReadonlySet<string> | null = null
      if (!anyMountedWorktreeHasLayout && mountedWorktreeIdsRef.current.has(workspace.id)) {
        const isVisible = activeView === 'terminal' && workspace.id === renderedActiveWorktreeId
        const shouldMeasureHiddenWorktree =
          !isVisible && measurableBackgroundWorktreeIdsRef.current.has(workspace.id)
        const parked =
          !isVisible &&
          !shouldMeasureHiddenWorktree &&
          effectiveParkedTerminalWorktreeIds.has(workspace.id)
        if (parked) {
          for (const tab of tabs) {
            const activityTerminalPortal = findActivityTerminalPortal(activityTerminalPortals, {
              worktreeId: workspace.id,
              tabId: tab.id
            })
            if (!activityTerminalPortal && !evictionExemptTerminalTabIds.has(tab.id)) {
              parkedTabIds.add(tab.id)
            }
          }
        }
        deferredTabIds =
          activationDeferredMountTabIdsByWorktreeRef.current.get(workspace.id) ?? null
        for (const tab of tabs) {
          if (
            deferredTabIds?.has(tab.id) &&
            !parkedTabIds.has(tab.id) &&
            canWatcherCoverParkedTerminalTab(workspace.id, tab) &&
            !findActivityTerminalPortal(activityTerminalPortals, {
              worktreeId: workspace.id,
              tabId: tab.id
            })
          ) {
            parkedTabIds.add(tab.id)
          }
        }
      }
      syncParkedTerminalTabWatchers({
        worktreeId: workspace.id,
        tabs,
        parkedTabIds,
        ...(deferredTabIds ? { restoreTitleOnStartTabIds: deferredTabIds } : {})
      })
    }
  }, [
    activeTabId,
    activeView,
    activityTerminalPortals,
    activeTabIdByWorktree,
    anyMountedWorktreeHasLayout,
    backgroundMountRevision,
    evictionExemptTerminalTabIds,
    getEffectiveLayoutForWorktree,
    groupsByWorktree,
    effectiveParkedTerminalWorktreeIds,
    pendingStartupByTabId,
    renderedActiveWorktreeId,
    tabsByWorktree,
    terminalParkingEnabled,
    terminalTitleSnapshotAuthorityEnabled,
    workspaceSessionReady,
    workspaceSurfaces
  ])
  useEffect(() => () => disposeAllParkedTerminalWatchers(), [])
  return {
    measurableBackgroundWorktreeTimersRef,
    backgroundMountRevision,
    setBackgroundMountRevision,
    terminalParkingRevision,
    setTerminalParkingRevision,
    effectiveParkedTerminalWorktreeIds,
    forceParkedTerminalWorktreeIds,
    evictionExemptTerminalTabIds,
    backgroundMountTabIdsByWorktreeRef,
    activationDeferredMountTabIdsByWorktreeRef,
    anyMountedWorktreeHasLayout
  }
}
