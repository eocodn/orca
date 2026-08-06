import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { useAppStore, type AppState } from '../store'
import { haveSameTerminalIdSet } from './terminal-surface-parking-model'
import {
  TERMINAL_WORKTREE_COLD_PARK_DELAY_MS,
  canParkTerminalWorktreeRenderers,
  selectColdParkedTerminalWorktrees,
  type TerminalWorktreeColdParkCandidate
} from './terminal-pane/terminal-hidden-view-parking'
import { getTerminalWorktreeColdParkRecheckDelayMs } from './terminal-pane/terminal-cold-park-recheck-deadlines'
import { canWatcherCoverParkedTerminalTabs } from './terminal-pane/terminal-parked-tab-watchers'
import {
  TERMINAL_HIDDEN_WORKTREE_RETENTION_TTL_MS,
  hasPendingRetentionSpawnWork,
  selectForceParkEvictableTabIds,
  selectRetentionForceParkedTerminalWorktrees,
  type TerminalWorktreeRetentionCandidate
} from './terminal-pane/terminal-hidden-worktree-retention'
import { selectEvictionExemptTerminalTabIds } from './terminal-pane/terminal-eviction-exempt-tabs'
import { captureForceParkedWorktreeBuffers } from './terminal-pane/force-park-buffer-capture'
import { warnTerminalLifecycleAnomaly } from './terminal-pane/terminal-lifecycle-diagnostics'
import {
  getTerminalParkingPolicyOverrides,
  recordTerminalWorktreeParkingDebugVerdicts
} from './terminal-pane/terminal-parking-e2e-overrides'
type TerminalSurfaceParkingPolicyContext = {
  activeView: AppState['activeView']
  renderedActiveWorktreeId: string | null
  parkingRevision: string
  terminalWorktreeParkingTimersRef: MutableRefObject<Map<string, number>>
  activityTerminalPortals: readonly { worktreeId: string; tabId: string }[]
  workspaceSurfaces: readonly { id: string; path: string }[]
  terminalWorktreeHiddenSinceRef: MutableRefObject<Map<string, number>>
  mountedWorktreeIdsRef: MutableRefObject<Set<string>>
  measurableBackgroundWorktreeIdsRef: MutableRefObject<Set<string>>
  measuringTerminalWorktreeIdsRef: MutableRefObject<Set<string>>
  terminalWorktreeParkCooldownUntilRef: MutableRefObject<Map<string, number>>
  tabsByWorktree: AppState['tabsByWorktree']
  pendingStartupByTabId: AppState['pendingStartupByTabId']
  terminalSshParkingEnabled: boolean
  pairedRuntimeParkingEnvironmentIds: ReadonlySet<string>
  terminalParkingEnabled: boolean
  terminalRetentionBudgetEnabled: boolean
  forceParkedCaptureDoneRef: MutableRefObject<Set<string>>
  setParkedTerminalWorktreeIds: Dispatch<SetStateAction<ReadonlySet<string>>>
  setForceParkedTerminalWorktreeIds: Dispatch<SetStateAction<ReadonlySet<string>>>
  setEvictionExemptTerminalTabIds: Dispatch<SetStateAction<ReadonlySet<string>>>
  setTerminalParkingRevision: (updater: (revision: number) => number) => void
}
export function useTerminalSurfaceParkingPolicyEffect(
  context: TerminalSurfaceParkingPolicyContext
): void {
  const {
    activeView,
    renderedActiveWorktreeId,
    parkingRevision,
    terminalWorktreeParkingTimersRef,
    activityTerminalPortals,
    workspaceSurfaces,
    terminalWorktreeHiddenSinceRef,
    mountedWorktreeIdsRef,
    measurableBackgroundWorktreeIdsRef,
    measuringTerminalWorktreeIdsRef,
    terminalWorktreeParkCooldownUntilRef,
    tabsByWorktree,
    pendingStartupByTabId,
    terminalSshParkingEnabled,
    pairedRuntimeParkingEnvironmentIds,
    terminalParkingEnabled,
    terminalRetentionBudgetEnabled,
    forceParkedCaptureDoneRef,
    setParkedTerminalWorktreeIds,
    setForceParkedTerminalWorktreeIds,
    setEvictionExemptTerminalTabIds,
    setTerminalParkingRevision
  } = context
  useEffect(() => {
    // Revision key invalidates ref-backed parking state after mount and timer events.
    void parkingRevision
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
    for (const worktreeId of Array.from(nextParkedTerminalWorktreeIds)) {
      if (!canWatcherCoverParkedTerminalTabs(worktreeId, tabsByWorktree[worktreeId] ?? [])) {
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
            parkEligible && canWatcherCoverParkedTerminalTabs(candidate.worktreeId, tabs),
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
    parkingRevision,
    forceParkedCaptureDoneRef,
    measurableBackgroundWorktreeIdsRef,
    measuringTerminalWorktreeIdsRef,
    mountedWorktreeIdsRef,
    pendingStartupByTabId,
    pairedRuntimeParkingEnvironmentIds,
    renderedActiveWorktreeId,
    setEvictionExemptTerminalTabIds,
    setForceParkedTerminalWorktreeIds,
    setParkedTerminalWorktreeIds,
    setTerminalParkingRevision,
    terminalWorktreeHiddenSinceRef,
    terminalWorktreeParkCooldownUntilRef,
    terminalWorktreeParkingTimersRef,
    tabsByWorktree,
    terminalParkingEnabled,
    terminalRetentionBudgetEnabled,
    terminalSshParkingEnabled,
    workspaceSurfaces
  ])
}
