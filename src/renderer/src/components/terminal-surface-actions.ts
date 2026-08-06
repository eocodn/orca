import { useCallback } from 'react'
import { useAppStore } from '../store'
export function useTerminalSurfaceActions(context: Record<string, any>): Record<string, any> {
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
  const handleNewTab = useCallback(
    (shellOverride?: string) => {
      if (!activeWorktreeId) {
        return
      }
      const targetGroupId =
        useAppStore.getState().activeGroupIdByWorktree[activeWorktreeId] ??
        useAppStore.getState().groupsByWorktree[activeWorktreeId]?.[0]?.id
      const runtimeEnvironmentId = getActiveWorktreeRuntimeEnvironmentId(activeWorktreeId)
      if (isWebRuntimeSessionActive(runtimeEnvironmentId)) {
        void createWebRuntimeSessionTerminal({
          worktreeId: activeWorktreeId,
          environmentId: runtimeEnvironmentId,
          targetGroupId,
          command: shellOverride,
          activate: true
        })
        return
      }
      if (!shellOverride && targetGroupId) {
        void openNewTerminalTabInActiveWorkspace(targetGroupId)
        return
      }
      const newTab = createTab(activeWorktreeId, undefined, shellOverride)
      setActiveTabType('terminal')
      // Why: persist tab-bar order with the new terminal appended; else reconcileOrder falls back to terminals-first and jumps it to index 0 before editor tabs.
      const state = useAppStore.getState()
      const currentTerminals = state.tabsByWorktree[activeWorktreeId] ?? []
      const currentEditors = state.openFiles.filter((f) => f.worktreeId === activeWorktreeId)
      const currentBrowsers = state.browserTabsByWorktree[activeWorktreeId] ?? []
      const stored = state.tabBarOrderByWorktree[activeWorktreeId]
      const termIds = currentTerminals.map((t) => t.id)
      const editorIds = currentEditors.map((f) => f.id)
      const browserIds = currentBrowsers.map((tab) => tab.id)
      const validIds = new Set([...termIds, ...editorIds, ...browserIds])
      const base = (stored ?? []).filter((id) => validIds.has(id))
      const inBase = new Set(base)
      for (const id of [...termIds, ...editorIds, ...browserIds]) {
        if (!inBase.has(id)) {
          base.push(id)
          inBase.add(id)
        }
      }
      // The new tab is already in base via termIds; move it to the end
      const order = base.filter((id) => id !== newTab.id)
      order.push(newTab.id)
      setTabBarOrder(activeWorktreeId, order)
      // Why: shell-specific creation still uses the legacy path; keep focus here until the lifted action accepts shell overrides.
      focusTerminalTabSurface(newTab.id)
    },
    [
      activeWorktreeId,
      createTab,
      openNewTerminalTabInActiveWorkspace,
      setActiveTabType,
      setTabBarOrder
    ]
  )

  const handleNewAgentTab = useCallback(
    (agent: TuiAgent) => {
      if (!activeWorktreeId) {
        return
      }
      const state = useAppStore.getState()
      const targetGroupId =
        state.activeGroupIdByWorktree[activeWorktreeId] ??
        state.groupsByWorktree[activeWorktreeId]?.[0]?.id
      const result = launchAgentInNewTab({
        agent,
        worktreeId: activeWorktreeId,
        groupId: targetGroupId,
        launchSource: 'shortcut'
      })
      if (!result) {
        toast.error(
          translate(
            'auto.components.Terminal.e57db40c11',
            'Could not build launch command for {{value0}}.',
            { value0: agent }
          )
        )
      }
    },
    [activeWorktreeId]
  )

  const handleNewBrowserTab = useCallback(() => {
    if (!activeWorktreeId) {
      return
    }
    const targetGroupId =
      useAppStore.getState().activeGroupIdByWorktree[activeWorktreeId] ??
      useAppStore.getState().groupsByWorktree[activeWorktreeId]?.[0]?.id
    if (targetGroupId) {
      void openNewBrowserTabInActiveWorkspace(targetGroupId)
      return
    }
    const defaultUrl = useAppStore.getState().browserDefaultUrl ?? 'about:blank'
    const runtimeEnvironmentId = getActiveWorktreeRuntimeEnvironmentId(activeWorktreeId)
    if (isWebRuntimeSessionActive(runtimeEnvironmentId)) {
      void createWebRuntimeSessionBrowserTab({
        worktreeId: activeWorktreeId,
        environmentId: runtimeEnvironmentId,
        url: defaultUrl
      })
      return
    }
    createBrowserTab(activeWorktreeId, defaultUrl, {
      title: translate('auto.components.Terminal.37da0d736f', 'New Browser Tab'),
      focusAddressBar: true
    })
  }, [activeWorktreeId, createBrowserTab, openNewBrowserTabInActiveWorkspace])

  const handleOpenEntry = useCallback(async (args: TabCreateEntryArgs) => {
    await openTabBarEntry(args)
  }, [])

  const handleDuplicateBrowserTab = useCallback(
    (browserTabId: string) => {
      if (!activeWorktreeId) {
        return
      }
      const state = useAppStore.getState()
      const tabs = state.browserTabsByWorktree[activeWorktreeId] ?? []
      const source = tabs.find((t) => t.id === browserTabId)
      if (!source) {
        return
      }
      const runtimeEnvironmentId = getActiveWorktreeRuntimeEnvironmentId(activeWorktreeId)
      if (
        isWebRuntimeSessionActive(runtimeEnvironmentId) &&
        browserWorkspaceHasRemoteOwner(state, source.id, runtimeEnvironmentId)
      ) {
        void createWebRuntimeSessionBrowserTab({
          worktreeId: activeWorktreeId,
          environmentId: runtimeEnvironmentId,
          url: source.url,
          profileId: source.sessionProfileId
        })
        return
      }
      createBrowserTab(activeWorktreeId, source.url, {
        ...buildDuplicatedBrowserTabOptions(source)
      })
    },
    [activeWorktreeId, createBrowserTab]
  )

  const handleNewFile = useCallback(async () => {
    if (!activeWorktreeId) {
      return
    }
    const targetGroupId =
      useAppStore.getState().activeGroupIdByWorktree[activeWorktreeId] ??
      useAppStore.getState().groupsByWorktree[activeWorktreeId]?.[0]?.id
    if (!targetGroupId) {
      return
    }
    await openNewMarkdownInActiveWorkspace(targetGroupId)
  }, [activeWorktreeId, openNewMarkdownInActiveWorkspace])

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
    handleNewTab,
    handleNewAgentTab,
    handleNewBrowserTab,
    handleOpenEntry,
    handleDuplicateBrowserTab,
    handleNewFile,
    handleCloseTab,
    handleCloseBrowserTab,
    handlePtyExit,
    closeTabBarTabs,
    handleCloseOthers,
    handleCloseTabsToRight,
    handleCloseTabsToLeft,
    handleCloseAllFiles,
    handleActivateTab,
    handleTogglePaneExpand,
    handleActivateBrowserTab
  }
}
