import React from 'react'
import { toast } from 'sonner'
import { useAppStore } from '../store'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { hasFeatureInteraction } from '../../../shared/feature-interactions'
import { useContextualTour } from './contextual-tours/use-contextual-tour'
import { resumeSleepingAgentSessionsForWorktree } from '@/lib/resume-sleeping-agent-session'
import { translate } from '@/i18n/i18n'
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
import { TerminalSurfaceMarkup } from './terminal-surface-render'
import { useTerminalSurfaceKeyboard } from './terminal-surface-keyboard'
import { useTerminalSurfaceEffects } from './terminal-surface-effects'
import { useTerminalSurfaceState } from './terminal-surface-state'
import { useTerminalSurfaceStartupEffects } from './terminal-surface-startup-effects'
import { useTerminalSurfaceInputEffects } from './terminal-surface-input-effects'
import { useTerminalSurfaceControllerComposition } from './terminal-surface-controller-composition'
import { buildTerminalSurfaceRenderProps } from './terminal-surface-render-props'
function getActiveWorktreeRuntimeEnvironmentId(worktreeId: string | null): string | null {
  return getRuntimeEnvironmentIdForWorktree(useAppStore.getState(), worktreeId)
}
function getKeybindingContext(target: EventTarget | null): 'terminal' | 'app' {
  return target instanceof HTMLElement && target.classList.contains('xterm-helper-textarea')
    ? 'terminal'
    : 'app'
}
function Terminal(): React.JSX.Element | null {
  const terminalState = useTerminalSurfaceState()
  const {
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
  } = terminalState
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

  const composedControllers = useTerminalSurfaceControllerComposition(terminalState)
  const {
    terminalSave,
    parking,
    terminalActions,
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
    handleCloseFile,
    backgroundMountRevision,
    setBackgroundMountRevision,
    terminalParkingRevision,
    setTerminalParkingRevision,
    effectiveParkedTerminalWorktreeIds,
    forceParkedTerminalWorktreeIds,
    backgroundMountTabIdsByWorktreeRef,
    activationDeferredMountTabIdsByWorktreeRef,
    anyMountedWorktreeHasLayout,
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
  } = composedControllers
  useTerminalSurfaceStartupEffects({
    workspaceSessionReady,
    activeWorktreeId,
    hydrationSucceeded,
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
    translate,
    openFiles,
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
  const terminalRenderProps = buildTerminalSurfaceRenderProps({
    ...terminalState,
    ...terminalSave,
    ...parking,
    ...terminalActions
  })
  return <TerminalSurfaceMarkup {...terminalRenderProps} />
}

export default React.memo(Terminal)
