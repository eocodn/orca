import { useCallback } from 'react'
import { useAppStore } from '../store'

export function useTerminalSurfaceActivationActions(context: Record<string, any>): Record<string, any> {
    const {
      activeWorktreeId,
      createTab,
      setActiveTabType,
      openNewTerminalTabInActiveWorkspace,
      setTabBarOrder,
      launchAgentInNewTab,
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
      setActiveBrowserTabType,
      browserTabsByWorktree,
      browserDefaultUrl,
      openFiles,
      getActiveWorktreeRuntimeEnvironmentId,
      isWebRuntimeSessionActive,
      createWebRuntimeSessionTerminal,
      createWebRuntimeSessionBrowserTab,
      activateWebRuntimeSessionTab,
      closeWebRuntimeSessionTab,
      openNewMarkdownInActiveWorkspace,
      openNewBrowserTabInActiveWorkspace,
      createBrowserTab,
      buildDuplicatedBrowserTabOptions,
      destroyWorkspaceWebviews,
      handleCloseFile,
      queueEditorCloseRequests,
      closeTerminalTab,
      browserWorkspaceHasRemoteOwner,
      focusTerminalTabSurface,
      toast,
      translate,
      resolveDefaultAgentForNewTab,
      listBoundAgentTabActions,
      resumeSleepingAgentSessionsForWorktree,
      terminalProviderHasAuthoritativeSnapshot,
      consumeSuppressedPtyExit,
      useAppStore: appStore
    } = context
  const handleActivateTab = useCallback(
    (tabId: string) => {
      const runtimeEnvironmentId = getActiveWorktreeRuntimeEnvironmentId(activeWorktreeId)
      if (activeWorktreeId && isWebRuntimeSessionActive(runtimeEnvironmentId)) {
        void activateWebRuntimeSessionTab({
          worktreeId: activeWorktreeId,
          tabId,
          environmentId: runtimeEnvironmentId
        })
      }
      setActiveTab(tabId)
      setActiveTabType('terminal')
    },
    [activeWorktreeId, setActiveTab, setActiveTabType]
  )

  const handleTogglePaneExpand = useCallback(
    (tabId: string) => {
      setActiveTab(tabId)
      requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent(TOGGLE_TERMINAL_PANE_EXPAND_EVENT, {
            detail: { tabId }
          })
        )
      })
    },
    [setActiveTab]
  )

  const handleActivateBrowserTab = useCallback(
    (tabId: string) => {
      const state = useAppStore.getState()
      const runtimeEnvironmentId = getActiveWorktreeRuntimeEnvironmentId(activeWorktreeId)
      if (
        activeWorktreeId &&
        isWebRuntimeSessionActive(runtimeEnvironmentId) &&
        browserWorkspaceHasRemoteOwner(state, tabId, runtimeEnvironmentId)
      ) {
        void activateWebRuntimeSessionTab({
          worktreeId: activeWorktreeId,
          tabId,
          environmentId: runtimeEnvironmentId
        })
      }
      setActiveBrowserTab(tabId)
      setActiveTabType('browser')
    },
    [activeWorktreeId, setActiveBrowserTab, setActiveTabType]
  )

  return {
    handleActivateTab,
    handleTogglePaneExpand,
    handleActivateBrowserTab,
  }
}

