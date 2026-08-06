import { useEffect, useRef } from 'react'
import { getClientRuntime } from '@/runtime/client-runtime'
import { useAppStore } from '../store'
export function useTerminalSurfaceEffects(context: Record<string, any>): void {
  const {
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
  } = context
  // Warn on window close if there are unsaved editor files
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent): void => {
      // Why: intentional restarts pre-save dirty tabs, so don't let stale dirty flags veto the relaunch.
      if (isIntentionalAppRestartInProgress()) {
        return
      }
      const dirtyFiles = useAppStore.getState().openFiles.filter((f) => f.isDirty)
      if (dirtyFiles.length > 0) {
        preventUnloadAndScheduleShutdownCheckpointReset(e, window)
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // Handle main-process window close requests: only dirty editor files block close (terminal sessions detach via daemon/SSH).
  // Why: register into the coordinator, not IPC directly, so quits on the Terminal-less landing page are still handled (#5144).
  useEffect(() => {
    setWindowCloseRequestHandler(({ isQuitting }) => {
      if (isIntentionalAppRestartInProgress()) {
        getClientRuntime().app.confirmWindowClose()
        return
      }

      // Why: ignore duplicate quit signals while a close is in flight, else the in-flight ref is overwritten and the close sequence is lost.
      if (windowCloseAfterDirtyRef.current) {
        return
      }

      const dirtyFiles = useAppStore.getState().openFiles.filter((f) => f.isDirty)
      if (dirtyFiles.length > 0) {
        queueEditorCloseRequests(
          dirtyFiles.map((file) => file.id),
          { isQuitting }
        )
        return
      }

      proceedToNativeWindowClose(isQuitting)
    })
    return () => setWindowCloseRequestHandler(null)
  }, [proceedToNativeWindowClose, queueEditorCloseRequests])

  // Why: browser pages can vanish via store-only paths; the store can't destroy webviews (owns DOM nodes), so this subscriber tears down orphaned ones.
  const prevBrowserWebviewIdsRef = useRef<Set<string>>(
    collectBrowserWebviewIds(
      useAppStore.getState().browserTabsByWorktree,
      useAppStore.getState().browserPagesByWorkspace
    )
  )
  useEffect(() => {
    let prevBrowserTabs = useAppStore.getState().browserTabsByWorktree
    let prevBrowserPages = useAppStore.getState().browserPagesByWorkspace
    return useAppStore.subscribe((state) => {
      if (
        state.browserTabsByWorktree === prevBrowserTabs &&
        state.browserPagesByWorkspace === prevBrowserPages
      ) {
        return
      }
      prevBrowserTabs = state.browserTabsByWorktree
      prevBrowserPages = state.browserPagesByWorkspace
      const currentIds = collectBrowserWebviewIds(
        state.browserTabsByWorktree,
        state.browserPagesByWorkspace
      )
      for (const prevId of prevBrowserWebviewIdsRef.current) {
        if (!currentIds.has(prevId)) {
          destroyRemovedBrowserWebview(prevId)
        }
      }
      prevBrowserWebviewIdsRef.current = currentIds
    })
  }, [])

  // Why: fall back to terminal when activeTabType 'browser' has no renderable tab; run as effect, not render (Zustand mutations mid-render blank the screen).
  useEffect(() => {
    const activeWorktreeBrowserTabs = renderedActiveWorktreeId
      ? (useAppStore.getState().browserTabsByWorktree[renderedActiveWorktreeId] ?? [])
      : []
    if (
      activeTabType === 'browser' &&
      renderedActiveWorktreeId &&
      (!activeBrowserTabId ||
        !activeWorktreeBrowserTabs.some((tab) => tab.id === activeBrowserTabId))
    ) {
      const fallbackBrowserTab = activeWorktreeBrowserTabs[0]
      if (fallbackBrowserTab) {
        setActiveBrowserTab(fallbackBrowserTab.id)
      } else {
        setActiveTabType('terminal')
      }
    }
  }, [
    activeTabType,
    renderedActiveWorktreeId,
    activeBrowserTabId,
    activeWorktreeBrowserTabIdsKey,
    setActiveBrowserTab,
    setActiveTabType
  ])
}
