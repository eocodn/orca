import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '../store'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import { useAllWorktrees } from '../store/selectors'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { getResolvedExecutionHostIdForWorktree } from '@/lib/resolved-worktree-execution-host'
import { hasFeatureInteraction } from '../../../shared/feature-interactions'
import { useTerminalProviderSnapshotCapability } from './terminal/use-terminal-provider-snapshot-capability'
import { useContextualTour } from './contextual-tours/use-contextual-tour'
import { setForegroundTerminalTabIds } from '@/lib/foreground-terminal-tabs'
import { useActivityTerminalPortals } from './activity/activity-terminal-portal'
import { isMainTerminalSideEffectAuthorityForPty } from './terminal-pane/terminal-side-effect-facts-handler'
import { isRemoteRuntimePtyId } from '@/runtime/runtime-terminal-inspection'
import {
  isWebRuntimeSessionActive,
  createWebRuntimeSessionTerminal,
  createWebRuntimeSessionBrowserTab,
  activateWebRuntimeSessionTab,
  closeWebRuntimeSessionTab
} from '@/runtime/web-runtime-session'
import { resumeSleepingAgentSessionsForWorktree } from '@/lib/resume-sleeping-agent-session'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { translate } from '@/i18n/i18n'
import { listBoundAgentTabActions, resolveDefaultAgentForNewTab } from '@/lib/agent-tab-shortcuts'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { buildDuplicatedBrowserTabOptions } from '@/lib/duplicate-browser-tab-options'
import { browserWorkspaceHasRemoteOwner } from '@/runtime/remote-browser-tab-ownership'
import { closeTerminalTab } from './terminal/terminal-tab-actions'
import { keybindingMatchesAction } from '../../../shared/keybindings'
import { matchesRecentTabSwitcherChord } from '../../../shared/window-shortcut-policy'
import { showTerminalShortcutCaptureNotification } from '@/lib/terminal-shortcut-capture-notification'
import {
  createFloatingWorkspaceBrowserTab,
  createFloatingWorkspaceMarkdownTab,
  createFloatingWorkspaceTerminalTab,
  handleEmptyFloatingWorkspacePanelCloseShortcut,
  isEventTargetInsideFloatingWorkspacePanel,
  isFloatingWorkspacePanelFocused,
  switchFloatingWorkspaceTab
} from '@/lib/floating-workspace-terminal-actions'
import {
  handleSwitchRecentTab,
  handleSwitchTab,
  handleSwitchTabAcrossAllTypes,
  handleSwitchTerminalTab
} from '../hooks/ipc-tab-switch'
import {
  collectBrowserWebviewIds,
  destroyRemovedBrowserWebview,
  destroyWorkspaceWebviews
} from '../store/slices/browser-webview-cleanup'
import { setWindowCloseRequestHandler } from './window-close-request-coordinator'
import { isIntentionalAppRestartInProgress } from '@/lib/updater-beforeunload'
import { preventUnloadAndScheduleShutdownCheckpointReset } from '@/lib/shutdown-checkpoint-guard'
import { shouldAutoCreateInitialTerminal } from './terminal/initial-terminal'
import {
  canMountTerminalWorkspaceForStartup,
  applyBackgroundMountTabRestriction,
  planColdActivationTabDeferral,
  pruneClosedBackgroundMountTabs,
  revealActivationDeferredTabs,
  shouldMountBackgroundWorktreeTab,
  takeAllPendingBackgroundTerminalWorktreeMounts,
  takePendingBackgroundTerminalWorktreeMount
} from './terminal/background-terminal-worktree-mount'
import { hasRegisteredRuntimeTerminalTab } from '../runtime/sync-runtime-graph'
import { terminalProviderHasAuthoritativeSnapshot } from './terminal/terminal-provider-snapshot-capability'
import {
  canDeferColdActivationTabsForHost,
  canWatcherCoverParkedTerminalTab,
  disposeAllParkedTerminalWatchers,
  pruneParkedTerminalWatchers,
  shouldDeferParkedPtyExitTabClose,
  syncParkedTerminalTabWatchers,
  terminalWatcherLiveWorkspaceIds
} from './terminal-pane/terminal-parked-tab-watchers'
import {
  canParkTerminalWorktreeRenderers,
  getTerminalWorktreeColdParkRecheckDelayMs,
  selectColdParkedTerminalWorktrees
} from './terminal-pane/terminal-hidden-view-parking'
import {
  selectForceParkEvictableTabIds,
  selectRetentionForceParkedTerminalWorktrees
} from './terminal-pane/terminal-hidden-worktree-retention'
import { captureForceParkedWorktreeBuffers } from './terminal-pane/force-park-buffer-capture'
import { warnTerminalLifecycleAnomaly } from './terminal-pane/terminal-lifecycle-diagnostics'
import {
  getTerminalParkingPolicyOverrides,
  recordTerminalWorktreeParkingDebugVerdicts
} from './terminal-pane/terminal-parking-e2e-overrides'
import { selectEvictionExemptTerminalTabIds } from './terminal-pane/terminal-eviction-exempt-tabs'
import { getEffectiveLayout } from './terminal/split-group-mount'
import {
  combineTerminalWorktreeParkIds,
  useManualTerminalWorktreeParking
} from './terminal-pane/use-manual-terminal-worktree-parking'
import { TerminalSurfaceMarkup } from './terminal-surface-render'
import { useTerminalSurfaceSaveController } from './terminal-surface-save-controller'
import { useTerminalSurfaceParkingController } from './terminal-surface-parking-controller'
import { useTerminalSurfaceActions } from './terminal-surface-actions'
import { useTerminalSurfaceKeyboard } from './terminal-surface-keyboard'
import { useTerminalSurfaceEffects } from './terminal-surface-effects'
import { openTabBarEntry } from './tab-bar/tab-create-entry-action'
function getActiveWorktreeRuntimeEnvironmentId(worktreeId: string | null): string | null {
  return getRuntimeEnvironmentIdForWorktree(useAppStore.getState(), worktreeId)
}
function getKeybindingContext(target: EventTarget | null): 'terminal' | 'app' {
  return target instanceof HTMLElement && target.classList.contains('xterm-helper-textarea')
    ? 'terminal'
    : 'app'
}
function Terminal(): React.JSX.Element | null {
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

  useContextualTour(
    'workspace-agent-sessions',
    Boolean(
      activeWorktreeId &&
      activeView === 'terminal' &&
      workspaceSessionReady &&
      activeTabType === 'terminal' &&
      Boolean(activeTabId) &&
      (!hasSplitTerminalPane || activeContextualTourId === 'workspace-agent-sessions')
    ),
    'workspace_agent_sessions_visible'
  )

  const terminalSave = useTerminalSurfaceSaveController({
    openFiles,
    activeWorktreeId,
    activeTabType,
    activeTabId,
    activeTabIdByWorktree,
    renderedActiveWorktreeId,
    tabs,
    tabsByWorktree,
    setActiveTab,
    setActiveTabType,
    setActiveWorktree,
    markFileDirty,
    closeFile,
    activeFileId,
    terminalParkingRevision,
    setTerminalParkingRevision,
    backgroundMountRevision,
    setBackgroundMountRevision,
    consumeSuppressedPtyExit
  })
  const {
    saveDialogFileId,
    saveDialogFile,
    handleSaveDialogCancel,
    handleSaveDialogDiscard,
    handleSaveDialogSave,
    windowCloseDialogOpen,
    setWindowCloseDialogOpen,
    confirmNativeWindowClose,
    proceedToNativeWindowClose,
    windowCloseAfterDirtyRef,
    queueEditorCloseRequests,
    handleCloseFile
  } = terminalSave
  const parking = useTerminalSurfaceParkingController({
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
    selectPairedRuntimeParkingEnvironmentIds,
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
    shouldDeferParkedPtyExitTabClose,
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
  })
  const {
    backgroundMountRevision,
    setBackgroundMountRevision,
    terminalParkingRevision,
    setTerminalParkingRevision,
    effectiveParkedTerminalWorktreeIds,
    forceParkedTerminalWorktreeIds,
    backgroundMountTabIdsByWorktreeRef,
    activationDeferredMountTabIdsByWorktreeRef,
    anyMountedWorktreeHasLayout
  } = parking
  // Auto-create first tab when worktree activates
  useEffect(() => {
    if (!workspaceSessionReady) {
      return
    }
    if (!activeWorktreeId) {
      return
    }
    // Why: host session-tabs are authoritative in the paired web client; a local fallback races the host's initial terminal and duplicates tabs.
    if (isWebRuntimeSessionActive(getActiveWorktreeRuntimeEnvironmentId(activeWorktreeId))) {
      return
    }

    // Why: give a newly activated worktree a focusable surface when nothing renders, without recreating one after the user closes the last visible tab.
    const { renderableTabCount } = reconcileWorktreeTabModel(activeWorktreeId)
    if (!shouldAutoCreateInitialTerminal(renderableTabCount)) {
      return
    }
    // Why: tag this never-visited-worktree tab so its PTY spawn doesn't count as activity and reshuffle the sidebar (explicit New Tab still bumps).
    createTab(activeWorktreeId, undefined, undefined, { pendingActivationSpawn: true })
  }, [workspaceSessionReady, activeWorktreeId, createTab, reconcileWorktreeTabModel])

  const startupResumeWorktreeIdsRef = useRef(new Set<string>())
  useEffect(() => {
    if (!workspaceSessionReady || !hydrationSucceeded || !activeWorktreeId) {
      return
    }
    if (startupResumeWorktreeIdsRef.current.has(activeWorktreeId)) {
      return
    }
    startupResumeWorktreeIdsRef.current.add(activeWorktreeId)
    // Why: startup hydration restores the worktree without activateAndRevealWorktree, so orphaned live/quit records need a terminal-surface pass after cold restore.
    resumeSleepingAgentSessionsForWorktree(activeWorktreeId)
  }, [activeWorktreeId, hydrationSucceeded, workspaceSessionReady])
  const terminalActions = useTerminalSurfaceActions({
    activeWorktreeId,
    createTab,
    setActiveTabType,
    openNewTerminalTabInActiveWorkspace,
    setTabBarOrder,
    activeTabId,
    closeTab,
    closeBrowserTab,
    closeFile,
    setActiveTab,
    setActiveWorktree,
    setActiveBrowserTab,
    setActiveFile,
    setTabCustomTitle,
    setTabColor,
    launchAgentInNewTab,
    openTabBarEntry,
    browserTabsByWorktree,
    openFiles,
    getActiveWorktreeRuntimeEnvironmentId,
    isWebRuntimeSessionActive,
    createWebRuntimeSessionTerminal,
    createWebRuntimeSessionBrowserTab,
    activateWebRuntimeSessionTab,
    closeWebRuntimeSessionTab,
    openNewBrowserTabInActiveWorkspace,
    consumeSuppressedPtyExit,
    openNewMarkdownInActiveWorkspace,
    createBrowserTab,
    buildDuplicatedBrowserTabOptions,
    destroyWorkspaceWebviews,
    closeTerminalTab,
    browserWorkspaceHasRemoteOwner,
    focusTerminalTabSurface,
    toast,
    translate,
    resolveDefaultAgentForNewTab,
    listBoundAgentTabActions,
    resumeSleepingAgentSessionsForWorktree
  })
  const {
    handleNewTab,
    handleNewAgentTab,
    handleNewBrowserTab,
    handleOpenEntry,
    handleDuplicateBrowserTab,
    handleNewFile,
    handleCloseTab,
    handleCloseBrowserTab,
    handlePtyExit,
    handleCloseOthers,
    handleCloseTabsToRight,
    handleCloseTabsToLeft,
    handleCloseAllFiles,
    handleActivateTab,
    handleTogglePaneExpand,
    handleActivateBrowserTab
  } = terminalActions
  useTerminalSurfaceKeyboard({
    activeWorktreeId,
    keybindings,
    terminalShortcutPolicy,
    handleNewBrowserTab,
    handleNewFile,
    handleNewTab,
    handleNewAgentTab,
    handleCloseTab,
    handleCloseBrowserTab,
    handlePtyExit,
    closeBrowserTab,
    handleCloseFile,
    handleCloseAllFiles,
    createFloatingWorkspaceTerminalTab,
    createFloatingWorkspaceBrowserTab,
    isFloatingWorkspacePanelFocused,
    switchFloatingWorkspaceTab,
    keybindingMatchesAction,
    showTerminalShortcutCaptureNotification,
    getKeybindingContext,
    handleSwitchRecentTab,
    handleSwitchTab,
    handleSwitchTabAcrossAllTypes,
    handleSwitchTerminalTab,
    createFloatingWorkspaceMarkdownTab,
    handleEmptyFloatingWorkspacePanelCloseShortcut,
    isEventTargetInsideFloatingWorkspacePanel,
    matchesRecentTabSwitcherChord,
    toast,
    translate
  })
  useTerminalSurfaceEffects({
    openFiles,
    activeWorktreeId,
    activeWorktreeBrowserTabIdsKey,
    activeTabType,
    activeBrowserTabId,
    renderedActiveWorktreeId,
    setActiveBrowserTab,
    setActiveTabType,
    browserTabsByWorktree,
    activeView,
    workspaceSurfaces,
    destroyRemovedBrowserWebview,
    collectBrowserWebviewIds,
    destroyWorkspaceWebviews,
    setWindowCloseRequestHandler,
    isIntentionalAppRestartInProgress,
    preventUnloadAndScheduleShutdownCheckpointReset,
    proceedToNativeWindowClose,
    queueEditorCloseRequests,
    windowCloseAfterDirtyRef
  })
  const terminalRenderProps = {
    renderedActiveWorktreeId,
    effectiveActiveLayout,
    titlebarTabsTarget,
    tabs,
    activeTabId,
    handleActivateTab,
    handleCloseTab,
    handleCloseOthers,
    handleCloseTabsToRight,
    handleCloseTabsToLeft,
    handleNewTab,
    handleNewBrowserTab,
    handleOpenEntry,
    handleNewFile,
    setTabCustomTitle,
    setTabColor,
    expandedPaneByTabId,
    handleTogglePaneExpand,
    worktreeFiles,
    worktreeBrowserTabs,
    activeFileId,
    activeBrowserTabId,
    activeTabType,
    setActiveFile,
    setActiveTabType,
    handleCloseFile,
    handleActivateBrowserTab,
    handleCloseBrowserTab,
    handleDuplicateBrowserTab,
    handleCloseAllFiles,
    makePreviewFilePermanent,
    pinFile,
    tabBarOrder,
    anyMountedWorktreeHasLayout,
    workspaceSurfaces,
    mountedWorktreeIdsRef,
    getEffectiveLayoutForWorktree,
    activeGroupIdByWorktree,
    measurableBackgroundWorktreeIdsRef,
    effectiveParkedTerminalWorktreeIds,
    forceParkedTerminalWorktreeIds,
    activityTerminalPortals,
    backgroundMountTabIdsByWorktreeRef,
    activationDeferredMountTabIdsByWorktreeRef,
    activeView,
    shouldMountBackgroundWorktreeTab,
    browserTabsByWorktree,
    windowCloseDialogOpen,
    setWindowCloseDialogOpen,
    confirmNativeWindowClose,
    saveDialogFileId,
    handleSaveDialogCancel,
    saveDialogFile,
    handleSaveDialogDiscard,
    handleSaveDialogSave
  }
  return <TerminalSurfaceMarkup {...terminalRenderProps} />
}

export default React.memo(Terminal)
