import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '../store'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import { useAllWorktrees } from '../store/selectors'
import { getResolvedExecutionHostIdForWorktree } from '@/lib/resolved-worktree-execution-host'
import { hasFeatureInteraction } from '../../../shared/feature-interactions'
import { useTerminalProviderSnapshotCapability } from './terminal/use-terminal-provider-snapshot-capability'
import { setForegroundTerminalTabIds } from '@/lib/foreground-terminal-tabs'
import { useActivityTerminalPortals } from './activity/activity-terminal-portal'
import { isMainTerminalSideEffectAuthorityForPty } from './terminal-pane/terminal-side-effect-facts-handler'
import { getEffectiveLayout } from './terminal/split-group-mount'
import { selectPairedRuntimeParkingEnvironmentIds } from './terminal-pane/terminal-hidden-view-parking'

export function useTerminalSurfaceState(): Record<string, any> {
  const mountedWorktreeIdsRef = useRef(new Set<string>())
  const measurableBackgroundWorktreeIdsRef = useRef(new Set<string>())
  const terminalWorktreeHiddenSinceRef = useRef(new Map<string, number>())
  // Why two extra clocks: hiddenSince survives a background-measure window (so
  // TTL/ranking stay honest), but re-park must wait a full coldParkDelayMs
  // after the measure ends — otherwise every ~3s measure lease on a
  // past-deadline worktree thrashes remount/reattach with an immediate re-park.
  const measuringTerminalWorktreeIdsRef = useRef(new Set<string>())
  const terminalWorktreeParkCooldownUntilRef = useRef(new Map<string, number>())
  const terminalWorktreeParkingTimersRef = useRef(new Map<string, number>())
  const allWorktrees = useAllWorktrees()
  const folderWorkspaces = useAppStore((s) => s.folderWorkspaces)
  const workspaceSurfaces = useMemo(
    () => [
      ...allWorktrees.map((worktree) => ({ id: worktree.id, path: worktree.path })),
      ...folderWorkspaces.map((workspace) => ({
        id: folderWorkspaceKey(workspace.id),
        path: workspace.folderPath
      }))
    ],
    [allWorktrees, folderWorkspaces]
  )
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const renderedActiveWorktreeId = activeWorktreeId
  const activeWorktreeDeferralHostId = useAppStore((s) =>
    getResolvedExecutionHostIdForWorktree(s, renderedActiveWorktreeId)
  )
  const activeView = useAppStore((s) => s.activeView)
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const pendingStartupByTabId = useAppStore((s) => s.pendingStartupByTabId)
  const terminalParkingEnabled = useAppStore((s) => s.settings?.terminalHiddenViewParking !== false)
  const terminalSshParkingEnabled = useAppStore((s) => s.settings?.terminalSshViewParking !== false)
  const runtimeStatusByEnvironmentId = useAppStore((s) => s.runtimeStatusByEnvironmentId)
  const pairedRuntimeParkingEnvironmentIds = useMemo(
    () => selectPairedRuntimeParkingEnvironmentIds(runtimeStatusByEnvironmentId),
    [runtimeStatusByEnvironmentId]
  )
  const terminalRetentionBudgetEnabled = useAppStore(
    (s) => s.settings?.terminalHiddenWorktreeRetentionBudget !== false
  )
  const terminalTitleSnapshotAuthorityEnabled = useAppStore((s) =>
    isMainTerminalSideEffectAuthorityForPty({
      settings: s.settings,
      runtimeEnvironmentId: null
    })
  )
  const activeTabId = useAppStore((s) => s.activeTabId)
  const activeTabIdByWorktree = useAppStore((s) => s.activeTabIdByWorktree)
  const createTab = useAppStore((s) => s.createTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const setActiveWorktree = useAppStore((s) => s.setActiveWorktree)
  const setTabCustomTitle = useAppStore((s) => s.setTabCustomTitle)
  const setTabColor = useAppStore((s) => s.setTabColor)
  const consumeSuppressedPtyExit = useAppStore((s) => s.consumeSuppressedPtyExit)
  const expandedPaneByTabId = useAppStore((s) => s.expandedPaneByTabId)
  const workspaceSessionReady = useAppStore((s) => s.workspaceSessionReady)
  const hydrationSucceeded = useAppStore((s) => s.hydrationSucceeded)
  const startupWorktreeRefreshCompleted = useAppStore((s) => s.startupWorktreeRefreshCompleted)
  const openFiles = useAppStore((s) => s.openFiles)
  const activeFileId = useAppStore((s) => s.activeFileId)
  const activeBrowserTabId = useAppStore((s) => s.activeBrowserTabId)
  const activeTabType = useAppStore((s) => s.activeTabType)
  const keybindings = useAppStore((s) => s.keybindings)
  const terminalShortcutPolicy = useAppStore(
    (s) => s.settings?.terminalShortcutPolicy ?? 'orca-first'
  )
  const setActiveTabType = useAppStore((s) => s.setActiveTabType)
  const setActiveFile = useAppStore((s) => s.setActiveFile)
  const closeFile = useAppStore((s) => s.closeFile)
  const makePreviewFilePermanent = useAppStore((s) => s.makePreviewFilePermanent)
  const pinFile = useAppStore((s) => s.pinFile)
  const browserTabsByWorktree = useAppStore((s) => s.browserTabsByWorktree)
  const createBrowserTab = useAppStore((s) => s.createBrowserTab)
  const openNewBrowserTabInActiveWorkspace = useAppStore(
    (s) => s.openNewBrowserTabInActiveWorkspace
  )
  const openNewMarkdownInActiveWorkspace = useAppStore((s) => s.openNewMarkdownInActiveWorkspace)
  const openNewTerminalTabInActiveWorkspace = useAppStore(
    (s) => s.openNewTerminalTabInActiveWorkspace
  )
  const closeBrowserTab = useAppStore((s) => s.closeBrowserTab)
  const setActiveBrowserTab = useAppStore((s) => s.setActiveBrowserTab)
  const groupsByWorktree = useAppStore((s) => s.groupsByWorktree)
  const layoutByWorktree = useAppStore((s) => s.layoutByWorktree)
  const activeGroupIdByWorktree = useAppStore((s) => s.activeGroupIdByWorktree)
  const ensureWorktreeRootGroup = useAppStore((s) => s.ensureWorktreeRootGroup)
  const reconcileWorktreeTabModel = useAppStore((s) => s.reconcileWorktreeTabModel)

  const markFileDirty = useAppStore((s) => s.markFileDirty)
  const setTabBarOrder = useAppStore((s) => s.setTabBarOrder)
  const tabBarOrderByWorktree = useAppStore((s) => s.tabBarOrderByWorktree)
  const tabBarOrder = renderedActiveWorktreeId
    ? tabBarOrderByWorktree[renderedActiveWorktreeId]
    : undefined
  // Why: use the activity page's selectedThread descriptor, not activeWorktreeId/activeTabId — selectThread updates the store in steps, so deriving here flashed the wrong terminal.
  const activityTerminalPortals: ActivityTerminalPortalTarget[] = useActivityTerminalPortals(
    activeView === 'activity'
  )
  const foregroundTerminalTabIds = useMemo(() => {
    const ids = new Set<string>()
    if (activeView === 'terminal' && activeTabType === 'terminal' && activeTabId) {
      ids.add(activeTabId)
    }
    for (const portal of activityTerminalPortals) {
      ids.add(portal.tabId)
    }
    return Array.from(ids)
  }, [activeTabId, activeTabType, activeView, activityTerminalPortals])

  useEffect(() => {
    // Why: hibernation must treat terminals portaled into foreground surfaces as visible even when not the active tab.
    setForegroundTerminalTabIds(foregroundTerminalTabIds)
    return () => setForegroundTerminalTabIds([])
  }, [foregroundTerminalTabIds])

  const tabs = useMemo(
    () => (renderedActiveWorktreeId ? (tabsByWorktree[renderedActiveWorktreeId] ?? []) : []),
    [renderedActiveWorktreeId, tabsByWorktree]
  )
  useTerminalProviderSnapshotCapability(workspaceSessionReady && hydrationSucceeded)

  // Why: TabBar portals into the titlebar (target created by App.tsx) so tabs share the "Orca" title row.
  const titlebarTabsTarget = document.getElementById('titlebar-tabs')

  useEffect(() => {
    if (!activeWorktreeId) {
      return
    }
    // Why: ensure a root group exists so terminal-first fallback can attach fresh tabs to a concrete owner before any explicit split.
    ensureWorktreeRootGroup(activeWorktreeId)
  }, [activeWorktreeId, ensureWorktreeRootGroup])

  // Filter editor files to only show those belonging to the active worktree
  const worktreeFiles = renderedActiveWorktreeId
    ? openFiles.filter((f) => f.worktreeId === renderedActiveWorktreeId)
    : []
  const worktreeBrowserTabs = renderedActiveWorktreeId
    ? (browserTabsByWorktree[renderedActiveWorktreeId] ?? [])
    : []
  const getEffectiveLayoutForWorktree = useCallback(
    (worktreeId: string) =>
      getEffectiveLayout(worktreeId, layoutByWorktree, groupsByWorktree, activeGroupIdByWorktree),
    [activeGroupIdByWorktree, groupsByWorktree, layoutByWorktree]
  )
  const effectiveActiveLayout = renderedActiveWorktreeId
    ? getEffectiveLayoutForWorktree(renderedActiveWorktreeId)
    : undefined
  const activeWorktreeBrowserTabIdsKey = renderedActiveWorktreeId
    ? (browserTabsByWorktree[renderedActiveWorktreeId] ?? []).map((tab) => tab.id).join(',')
    : ''
  const activeContextualTourId = useAppStore((s) => s.activeContextualTourId)
  const hasSplitTerminalPane = useAppStore((s) =>
    hasFeatureInteraction(s.featureInteractions, 'terminal-pane-split')
  )

  return {
    mountedWorktreeIdsRef,
    measurableBackgroundWorktreeIdsRef,
    terminalWorktreeHiddenSinceRef,
    measuringTerminalWorktreeIdsRef,
    terminalWorktreeParkCooldownUntilRef,
    terminalWorktreeParkingTimersRef,
    workspaceSurfaces,
    activeWorktreeId,
    renderedActiveWorktreeId,
    activeWorktreeDeferralHostId,
    activeView,
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
    createTab,
    closeTab,
    setActiveTab,
    setActiveWorktree,
    setTabCustomTitle,
    setTabColor,
    consumeSuppressedPtyExit,
    expandedPaneByTabId,
    workspaceSessionReady,
    hydrationSucceeded,
    startupWorktreeRefreshCompleted,
    openFiles,
    activeFileId,
    activeBrowserTabId,
    activeTabType,
    keybindings,
    terminalShortcutPolicy,
    setActiveTabType,
    setActiveFile,
    closeFile,
    makePreviewFilePermanent,
    pinFile,
    browserTabsByWorktree,
    createBrowserTab,
    openNewBrowserTabInActiveWorkspace,
    openNewMarkdownInActiveWorkspace,
    openNewTerminalTabInActiveWorkspace,
    closeBrowserTab,
    setActiveBrowserTab,
    groupsByWorktree,
    layoutByWorktree,
    activeGroupIdByWorktree,
    ensureWorktreeRootGroup,
    reconcileWorktreeTabModel,
    markFileDirty,
    setTabBarOrder,
    tabBarOrderByWorktree,
    tabBarOrder,
    activityTerminalPortals,
    foregroundTerminalTabIds,
    tabs,
    titlebarTabsTarget,
    worktreeFiles,
    worktreeBrowserTabs,
    getEffectiveLayoutForWorktree,
    effectiveActiveLayout,
    activeWorktreeBrowserTabIdsKey,
    activeContextualTourId,
    hasSplitTerminalPane,
    selectPairedRuntimeParkingEnvironmentIds,
  }
}
