import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { AppState } from '../store'
import { useTerminalSurfaceBackgroundMountEffects } from './terminal-surface-background-mount-effects'
import { useTerminalSurfaceParkingPolicyEffect } from './terminal-surface-parking-policy-effect'
import { applyTerminalSurfaceActivationMount } from './terminal-surface-activation-mount'
import { findActivityTerminalPortal } from './activity/activity-terminal-portal'
import { pruneClosedBackgroundMountTabs } from './terminal/background-terminal-worktree-mount'
import {
  canWatcherCoverParkedTerminalTab,
  disposeAllParkedTerminalWatchers,
  pruneParkedTerminalWatchers,
  syncParkedTerminalTabWatchers,
  terminalWatcherLiveWorkspaceIds
} from './terminal-pane/terminal-parked-tab-watchers'
import {
  combineTerminalWorktreeParkIds,
  useManualTerminalWorktreeParking
} from './terminal-pane/use-manual-terminal-worktree-parking'
import type { getEffectiveLayout } from './terminal/split-group-mount'

export type TerminalSurfaceParkingContext = {
  activeView: AppState['activeView']
  renderedActiveWorktreeId: string | null
  workspaceSurfaces: readonly { id: string; path: string }[]
  tabsByWorktree: AppState['tabsByWorktree']
  pendingStartupByTabId: AppState['pendingStartupByTabId']
  terminalParkingEnabled: boolean
  terminalSshParkingEnabled: boolean
  pairedRuntimeParkingEnvironmentIds: ReadonlySet<string>
  terminalRetentionBudgetEnabled: boolean
  terminalTitleSnapshotAuthorityEnabled: boolean
  activeTabId: string | null
  activeTabIdByWorktree: AppState['activeTabIdByWorktree']
  workspaceSessionReady: boolean
  hydrationSucceeded: boolean
  startupWorktreeRefreshCompleted: boolean
  activityTerminalPortals: readonly { worktreeId: string; tabId: string }[]
  activeWorktreeDeferralHostId: string | null
  layoutByWorktree: AppState['layoutByWorktree']
  groupsByWorktree: AppState['groupsByWorktree']
  activeGroupIdByWorktree: AppState['activeGroupIdByWorktree']
  getEffectiveLayoutForWorktree: (worktreeId: string) => ReturnType<typeof getEffectiveLayout>
  mountedWorktreeIdsRef: MutableRefObject<Set<string>>
  measurableBackgroundWorktreeIdsRef: MutableRefObject<Set<string>>
  terminalWorktreeHiddenSinceRef: MutableRefObject<Map<string, number>>
  measuringTerminalWorktreeIdsRef: MutableRefObject<Set<string>>
  terminalWorktreeParkCooldownUntilRef: MutableRefObject<Map<string, number>>
  terminalWorktreeParkingTimersRef: MutableRefObject<Map<string, number>>
}
export function useTerminalSurfaceParkingController(
  context: TerminalSurfaceParkingContext
): ReturnType<typeof useTerminalSurfaceParkingController> {
  const {
    activeView,
    renderedActiveWorktreeId,
    workspaceSurfaces,
    tabsByWorktree,
    pendingStartupByTabId,
    terminalParkingEnabled,
    terminalTitleSnapshotAuthorityEnabled,
    activeTabId,
    activeTabIdByWorktree,
    workspaceSessionReady,
    activityTerminalPortals,
    layoutByWorktree,
    groupsByWorktree,
    activeGroupIdByWorktree,
    getEffectiveLayoutForWorktree,
    mountedWorktreeIdsRef,
    measurableBackgroundWorktreeIdsRef,
    terminalWorktreeParkingTimersRef
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
    const timers = terminalWorktreeParkingTimersRef.current
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer)
      }
      timers.clear()
    }
  }, [])
  useTerminalSurfaceBackgroundMountEffects(context)
  useTerminalSurfaceParkingPolicyEffect({
    ...context,
    measurableBackgroundWorktreeTimersRef,
    backgroundMountTabIdsByWorktreeRef,
    activationDeferredMountTabIdsByWorktreeRef,
    forceParkedCaptureDoneRef,
    setParkedTerminalWorktreeIds,
    setForceParkedTerminalWorktreeIds,
    setEvictionExemptTerminalTabIds,
    setTerminalParkingRevision
  })
  applyTerminalSurfaceActivationMount({
    ...context,
    lastActivationWorktreeIdRef,
    backgroundMountTabIdsByWorktreeRef,
    activationDeferredMountTabIdsByWorktreeRef,
    mountedWorktreeIdsRef
  })
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
