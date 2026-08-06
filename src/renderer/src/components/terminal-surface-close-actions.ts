import { useCallback } from 'react'
import { useAppStore } from '../store'

export function useTerminalSurfaceCloseActions(context: Record<string, any>): Record<string, any> {
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
  const handleCloseTab = useCallback((tabId: string) => {
    closeTerminalTab(tabId)
  }, [])

  const handleCloseBrowserTab = useCallback(
    (tabId: string) => {
      const state = useAppStore.getState()
      const owningWorktreeEntry = Object.entries(state.browserTabsByWorktree).find(
        ([, worktreeTabs]) => worktreeTabs.some((tab) => tab.id === tabId)
      )
      const owningWorktreeId = owningWorktreeEntry?.[0] ?? null
      if (!owningWorktreeId) {
        return
      }
      if (isPinnedVisibleTab(state, owningWorktreeId, tabId)) {
        return
      }
      const runtimeEnvironmentId = getActiveWorktreeRuntimeEnvironmentId(owningWorktreeId)
      if (
        isWebRuntimeSessionActive(runtimeEnvironmentId) &&
        browserWorkspaceHasRemoteOwner(state, tabId, runtimeEnvironmentId)
      ) {
        void closeWebRuntimeSessionTab({
          worktreeId: owningWorktreeId,
          tabId,
          environmentId: runtimeEnvironmentId,
          reason: 'user'
        })
        return
      }
      const currentTabs = state.browserTabsByWorktree[owningWorktreeId] ?? []
      if (currentTabs.length <= 1) {
        destroyWorkspaceWebviews(state.browserPagesByWorkspace, tabId)
        closeBrowserTab(tabId)
        if (state.activeWorktreeId === owningWorktreeId) {
          const worktreeFile = state.openFiles.find((file) => file.worktreeId === owningWorktreeId)
          if (worktreeFile) {
            setActiveFile(worktreeFile.id)
            setActiveTabType('editor')
          } else {
            const terminalTab = (state.tabsByWorktree[owningWorktreeId] ?? [])[0]
            if (terminalTab) {
              setActiveTab(terminalTab.id)
              setActiveTabType('terminal')
            } else {
              setActiveWorktree(null)
            }
          }
        }
        return
      }
      if (state.activeWorktreeId === owningWorktreeId && tabId === state.activeBrowserTabId) {
        const idx = currentTabs.findIndex((tab) => tab.id === tabId)
        const nextTab = currentTabs[idx + 1] ?? currentTabs[idx - 1]
        if (nextTab) {
          setActiveBrowserTab(nextTab.id)
        }
      }
      destroyWorkspaceWebviews(state.browserPagesByWorkspace, tabId)
      closeBrowserTab(tabId)
    },
    [
      closeBrowserTab,
      setActiveBrowserTab,
      setActiveFile,
      setActiveTab,
      setActiveTabType,
      setActiveWorktree
    ]
  )

  const handlePtyExit = useCallback(
    (tabId: string, ptyId: string) => {
      if (consumeSuppressedPtyExit(ptyId)) {
        return
      }
      // Why: a parked multi-leaf tab has no PaneManager to promote split siblings, so closing here would kill them; reveal-remount handles dead PTYs per leaf.
      if (shouldDeferParkedPtyExitTabClose(tabId, ptyId)) {
        return
      }
      closeTerminalTab(tabId, { reason: 'pty-exit', lifecyclePtyId: ptyId })
    },
    [consumeSuppressedPtyExit]
  )

  // Bulk-close for the tab bar: unlike closeUnifiedTab it must route each id to
  // its backend (web-runtime sessions, terminals, editor files, browser tabs),
  // skip pinned tabs, and defer dirty editor files to the confirm flow.
  const closeTabBarTabs = useCallback(
    (tabIds: string[]) => {
      if (!activeWorktreeId) {
        return
      }
      const state = useAppStore.getState()
      const dirtyFileIds: string[] = []
      for (const id of tabIds) {
        const unifiedTab = (state.unifiedTabsByWorktree[activeWorktreeId] ?? []).find(
          (candidate) => candidate.id === id || candidate.entityId === id
        )
        if (unifiedTab?.isPinned) {
          continue
        }
        const runtimeEnvironmentId = getActiveWorktreeRuntimeEnvironmentId(activeWorktreeId)
        if (
          isWebRuntimeSessionActive(runtimeEnvironmentId) &&
          (unifiedTab?.contentType === 'terminal' ||
            (unifiedTab?.contentType === 'browser' &&
              browserWorkspaceHasRemoteOwner(state, unifiedTab.entityId, runtimeEnvironmentId)))
        ) {
          if (unifiedTab.contentType === 'terminal') {
            // Why: paired-host bulk close must revoke renderer resume and hook authority, not just remove the host session tab.
            closeTerminalTab(unifiedTab.entityId)
          } else {
            void closeWebRuntimeSessionTab({
              worktreeId: activeWorktreeId,
              tabId: unifiedTab.id,
              environmentId: runtimeEnvironmentId,
              reason: 'user'
            })
          }
          continue
        }
        if ((state.tabsByWorktree[activeWorktreeId] ?? []).some((tab) => tab.id === id)) {
          closeTab(id)
        } else if (
          state.openFiles.some((file) => file.worktreeId === activeWorktreeId && file.id === id)
        ) {
          const file = state.openFiles.find((candidate) => candidate.id === id)
          if (file?.isDirty) {
            dirtyFileIds.push(id)
            continue
          }
          closeFile(id)
        } else if (
          (state.browserTabsByWorktree[activeWorktreeId] ?? []).some((tab) => tab.id === id)
        ) {
          destroyWorkspaceWebviews(state.browserPagesByWorkspace, id)
          closeBrowserTab(id)
        }
      }
      if (dirtyFileIds.length > 0) {
        queueEditorCloseRequests(dirtyFileIds)
      }
    },
    [activeWorktreeId, closeBrowserTab, closeFile, closeTab, queueEditorCloseRequests]
  )

  const handleCloseOthers = useCallback(
    (tabId: string) => {
      if (!activeWorktreeId) {
        return
      }
      const order = useAppStore.getState().tabBarOrderByWorktree[activeWorktreeId] ?? []
      closeTabBarTabs(order.filter((id) => id !== tabId))
    },
    [activeWorktreeId, closeTabBarTabs]
  )

  const handleCloseTabsToRight = useCallback(
    (tabId: string) => {
      if (!activeWorktreeId) {
        return
      }
      const currentOrder = useAppStore.getState().tabBarOrderByWorktree[activeWorktreeId] ?? []
      const index = currentOrder.indexOf(tabId)
      if (index === -1) {
        return
      }
      closeTabBarTabs(currentOrder.slice(index + 1))
    },
    [activeWorktreeId, closeTabBarTabs]
  )

  const handleCloseTabsToLeft = useCallback(
    (tabId: string) => {
      if (!activeWorktreeId) {
        return
      }
      const currentOrder = useAppStore.getState().tabBarOrderByWorktree[activeWorktreeId] ?? []
      const index = currentOrder.indexOf(tabId)
      if (index === -1) {
        return
      }
      closeTabBarTabs(currentOrder.slice(0, index))
    },
    [activeWorktreeId, closeTabBarTabs]
  )

  const handleCloseAllFiles = useCallback(() => {
    if (!activeWorktreeId) {
      return
    }
    const state = useAppStore.getState()
    const filesInWorktree = state.openFiles.filter((file) => file.worktreeId === activeWorktreeId)
    const closableFiles = filesInWorktree.filter(
      (file) => !isPinnedEditorFileTab(state, activeWorktreeId, file.id)
    )
    const dirtyFileIds = closableFiles.filter((file) => file.isDirty).map((file) => file.id)
    for (const file of closableFiles) {
      if (!file.isDirty) {
        closeFile(file.id)
      }
    }
    if (dirtyFileIds.length > 0) {
      queueEditorCloseRequests(dirtyFileIds)
    }
  }, [activeWorktreeId, closeFile, queueEditorCloseRequests])

  return {
    handleCloseTab,
    handleCloseBrowserTab,
    handlePtyExit,
    closeTabBarTabs,
    handleCloseOthers,
    handleCloseTabsToRight,
    handleCloseTabsToLeft,
    handleCloseAllFiles,
  }
}

