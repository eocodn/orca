import { toast } from 'sonner'
import { useAppStore } from '../store'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
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
import { useTerminalSurfaceSaveController } from './terminal-surface-save-controller'
import { useTerminalSurfaceParkingController } from './terminal-surface-parking-controller'
import { useTerminalSurfaceActions } from './terminal-surface-actions'
import type { useTerminalSurfaceState } from './terminal-surface-state'

function getActiveWorktreeRuntimeEnvironmentId(worktreeId: string | null): string | null {
  return getRuntimeEnvironmentIdForWorktree(useAppStore.getState(), worktreeId)
}
type TerminalSurfaceControllerContext = ReturnType<typeof useTerminalSurfaceState>
type TerminalSurfaceControllerResult = ReturnType<typeof useTerminalSurfaceSaveController> & {
  parking: ReturnType<typeof useTerminalSurfaceParkingController>
  terminalActions: ReturnType<typeof useTerminalSurfaceActions>
} & ReturnType<typeof useTerminalSurfaceActions> &
  ReturnType<typeof useTerminalSurfaceSaveController>

export function useTerminalSurfaceControllerComposition(
  state: TerminalSurfaceControllerContext
): TerminalSurfaceControllerResult {
  const {
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
    consumeSuppressedPtyExit,
    workspaceSessionReady,
    hydrationSucceeded,
    startupWorktreeRefreshCompleted,
    workspaceSurfaces,
    pendingStartupByTabId,
    terminalParkingEnabled,
    terminalSshParkingEnabled,
    runtimeStatusByEnvironmentId,
    pairedRuntimeParkingEnvironmentIds,
    terminalRetentionBudgetEnabled,
    terminalTitleSnapshotAuthorityEnabled,
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
    createTab,
    closeTab,
    setTabCustomTitle,
    setTabColor,
    setActiveFile,
    browserTabsByWorktree,
    createBrowserTab,
    openNewBrowserTabInActiveWorkspace,
    openNewMarkdownInActiveWorkspace,
    openNewTerminalTabInActiveWorkspace,
    closeBrowserTab,
    setActiveBrowserTab,
    setTabBarOrder
  } = state

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
    setActiveFile,
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
    terminalWorktreeParkingTimersRef
  })
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
    queueEditorCloseRequests: terminalSave.queueEditorCloseRequests,
    closeTerminalTab,
    browserWorkspaceHasRemoteOwner,
    focusTerminalTabSurface,
    toast,
    translate,
    resolveDefaultAgentForNewTab,
    listBoundAgentTabActions,
    resumeSleepingAgentSessionsForWorktree
  })
  return {
    ...terminalSave,
    ...parking,
    ...terminalActions,
    terminalSave,
    parking,
    terminalActions
  }
}
