import { useCallback } from 'react'
import { useAppStore } from '../store'

type TerminalSurfaceStore = ReturnType<typeof useAppStore.getState>

type TerminalSurfaceActivationContext = {
  activeWorktreeId: string | null
  setActiveTabType: TerminalSurfaceStore['setActiveTabType']
  setActiveTab: TerminalSurfaceStore['setActiveTab']
  setActiveBrowserTab: TerminalSurfaceStore['setActiveBrowserTab']
  getActiveWorktreeRuntimeEnvironmentId: (worktreeId: string | null) => string | null
  isWebRuntimeSessionActive: (environmentId: string | null) => boolean
  activateWebRuntimeSessionTab: (args: {
    worktreeId: string
    tabId: string
    environmentId: string
  }) => Promise<unknown> | void
  browserWorkspaceHasRemoteOwner: (
    state: TerminalSurfaceStore,
    tabId: string,
    environmentId: string
  ) => boolean
}

export function useTerminalSurfaceActivationActions(context: TerminalSurfaceActivationContext) {
  const {
    activeWorktreeId,
    setActiveTabType,
    setActiveTab,
    setActiveBrowserTab,
    getActiveWorktreeRuntimeEnvironmentId,
    isWebRuntimeSessionActive,
    activateWebRuntimeSessionTab,
    browserWorkspaceHasRemoteOwner
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
    [
      activateWebRuntimeSessionTab,
      activeWorktreeId,
      getActiveWorktreeRuntimeEnvironmentId,
      isWebRuntimeSessionActive,
      setActiveTab,
      setActiveTabType
    ]
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
    [
      activateWebRuntimeSessionTab,
      activeWorktreeId,
      browserWorkspaceHasRemoteOwner,
      getActiveWorktreeRuntimeEnvironmentId,
      isWebRuntimeSessionActive,
      setActiveBrowserTab,
      setActiveTabType
    ]
  )

  return {
    handleActivateTab,
    handleTogglePaneExpand,
    handleActivateBrowserTab
  }
}
