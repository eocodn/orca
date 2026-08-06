import React from 'react'
import { toast } from 'sonner'
import { useAppStore } from '../store'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
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
    activeWorktreeId,
    activeTabId,
    renderedActiveWorktreeId,
    activeView,
    workspaceSurfaces,
    createTab,
    workspaceSessionReady,
    hydrationSucceeded,
    openFiles,
    activeBrowserTabId,
    activeTabType,
    keybindings,
    terminalShortcutPolicy,
    setActiveTabType,
    browserTabsByWorktree,
    closeBrowserTab,
    setActiveBrowserTab,
    reconcileWorktreeTabModel,
    activeWorktreeBrowserTabIdsKey,
    activeContextualTourId,
    hasSplitTerminalPane
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
    handleNewTab,
    handleNewAgentTab,
    handleNewBrowserTab,
    handleNewFile,
    handleCloseTab,
    handleCloseBrowserTab,
    handlePtyExit,
    handleCloseAllFiles,
    handleCloseFile,
    proceedToNativeWindowClose,
    queueEditorCloseRequests,
    windowCloseAfterDirtyRef
  } = composedControllers
  useTerminalSurfaceStartupEffects({
    workspaceSessionReady,
    activeWorktreeId,
    hydrationSucceeded,
    createTab,
    reconcileWorktreeTabModel,
    resumeSleepingAgentSessionsForWorktree,
    getActiveWorktreeRuntimeEnvironmentId
  })
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
  const terminalRenderProps = buildTerminalSurfaceRenderProps({
    ...terminalState,
    ...terminalSave,
    ...parking,
    ...terminalActions
  })
  return <TerminalSurfaceMarkup {...terminalRenderProps} />
}

export default React.memo(Terminal)
