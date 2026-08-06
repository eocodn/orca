import { useEffect } from 'react'
import { haveSameTerminalIdSet } from './terminal-surface-parking-model'

export function useTerminalSurfaceParkingPolicyEffect(context: Record<string, any>): void {
  const {
    terminalWorktreeParkingTimersRef,
    getTerminalParkingPolicyOverrides,
    activityTerminalPortals,
    workspaceSurfaces,
    terminalWorktreeHiddenSinceRef,
    mountedWorktreeIdsRef,
    measuringTerminalWorktreeIdsRef,
    terminalWorktreeParkCooldownUntilRef,
    tabsByWorktree,
    pendingStartupByTabId,
    terminalSshParkingEnabled,
    pairedRuntimeParkingEnvironmentIds,
    selectColdParkedTerminalWorktrees,
    terminalParkingEnabled,
    canWatcherCoverParkedTerminalTab,
    canParkTerminalWorktreeRenderers,
    terminalRetentionBudgetEnabled,
    selectRetentionForceParkedTerminalWorktrees,
    recordTerminalWorktreeParkingDebugVerdicts,
    forceParkedCaptureDoneRef,
    selectEvictionExemptTerminalTabIds,
    selectForceParkEvictableTabIds,
    warnTerminalLifecycleAnomaly,
    captureForceParkedWorktreeBuffers,
    useAppStore,
    setParkedTerminalWorktreeIds,
    setForceParkedTerminalWorktreeIds,
    setEvictionExemptTerminalTabIds,
    getTerminalWorktreeColdParkRecheckDelayMs,
    setTerminalParkingRevision
  } = context

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
}

