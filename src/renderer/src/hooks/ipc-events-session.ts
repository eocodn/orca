import { useAppStore } from '../store'
import { detectLanguage } from '@/lib/language-detect'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { closeMobileSessionTabInStore } from '@/runtime/mobile-session-tab-close'
import { guardPinnedTabClose, resolvePinnedTabLabel } from '../store/pinned-tab-close-guard'
import { persistWorkspaceSessionByHost } from '@/lib/workspace-session-host-persistence'
import { buildWorkspaceSessionPayload } from '@/lib/workspace-session'
import { CLOSE_TERMINAL_PANE_EVENT, type CloseTerminalPaneDetail } from '@/constants/terminal'
type SessionSurfaceContext = {
  unsubs: Array<() => void>
  isRuntimeEnvironmentActive: () => boolean
  isPinnedSessionTab: (store: ReturnType<typeof useAppStore.getState>, worktreeId: string, visibleId: string) => boolean
  resolveBrowserSessionTabTarget: (
    state: Pick<ReturnType<typeof useAppStore.getState>, 'browserTabsByWorktree' | 'unifiedTabsByWorktree'>,
    worktreeId: string,
    tabId: string
  ) => { kind: 'unified-browser'; unifiedTabId: string; workspaceId: string; groupId: string } | { kind: 'fallback-browser'; workspaceId: string } | null
  runSleepWorktree: (worktreeId: string) => Promise<void>
  backgroundSleepingAgentWakeDispatcher: { request: (worktreeId: string) => void }
}
export function registerSessionEvents({
  unsubs,
  isRuntimeEnvironmentActive,
  isPinnedSessionTab,
  resolveBrowserSessionTabTarget,
  runSleepWorktree,
  backgroundSleepingAgentWakeDispatcher
}: SessionSurfaceContext): void {
unsubs.push(
  window.api.ui.onFocusEditorTab(({ tabId, worktreeId }) => {
    const store = useAppStore.getState()
    const tab = (store.unifiedTabsByWorktree[worktreeId] ?? []).find(
      (item) => item.id === tabId
    )
    const browserTarget = resolveBrowserSessionTabTarget(store, worktreeId, tabId)
    if (!tab) {
      if (browserTarget) {
        // Why: older/mobile fallback snapshots identify browser tabs by workspace id when no unified tab wrapper exists.
        store.setActiveWorktree(worktreeId)
        store.markWorktreeVisited(worktreeId)
        store.setActiveView('terminal')
        store.setActiveBrowserTab(browserTarget.workspaceId)
        store.setActiveTabType('browser')
        store.revealWorktreeInSidebar(worktreeId)
      }
      return
    }
    store.setActiveWorktree(worktreeId)
    store.markWorktreeVisited(worktreeId)
    store.setActiveView('terminal')
    store.focusGroup(worktreeId, tab.groupId)
    store.activateTab(tab.id)
    if (browserTarget) {
      // Why: browser tabs need their own active-page state, not the editor file activation path.
      store.setActiveBrowserTab(browserTarget.workspaceId)
      store.setActiveTabType('browser')
    } else {
      store.setActiveFile(tab.entityId)
      store.setActiveTabType('editor')
    }
    store.revealWorktreeInSidebar(worktreeId)
  })
)

unsubs.push(
  window.api.ui.onCloseSessionTab(({ tabId, worktreeId }) => {
    const store = useAppStore.getState()
    const browserTarget = resolveBrowserSessionTabTarget(store, worktreeId, tabId)
    if (browserTarget) {
      guardPinnedTabClose({
        isPinned: isPinnedSessionTab(store, worktreeId, browserTarget.workspaceId),
        tabLabel: resolvePinnedTabLabel(store, worktreeId, browserTarget.workspaceId),
        onClose: () => useAppStore.getState().closeBrowserTab(browserTarget.workspaceId)
      })
      return
    }
    guardPinnedTabClose({
      isPinned: isPinnedSessionTab(store, worktreeId, tabId),
      tabLabel: resolvePinnedTabLabel(store, worktreeId, tabId),
      onClose: () => {
        const currentStore = useAppStore.getState()
        closeMobileSessionTabInStore(currentStore, worktreeId, tabId)
      }
    })
  })
)

unsubs.push(
  window.api.ui.onMoveSessionTab((move) => {
    const { tabId, targetGroupId } = move
    const store = useAppStore.getState()
    if (move.kind === 'reorder') {
      store.reorderUnifiedTabs(targetGroupId, move.tabOrder)
      return
    }
    store.dropUnifiedTab(tabId, {
      groupId: targetGroupId,
      ...(move.kind === 'move-to-group' ? { index: move.index } : {}),
      ...(move.kind === 'split' ? { splitDirection: move.splitDirection } : {})
    })
  })
)

unsubs.push(
  window.api.ui.onOpenFileFromMobile(
    ({ worktreeId, filePath, relativePath, runtimeEnvironmentId }) => {
      const store = useAppStore.getState()
      const basename = relativePath.split(/[\\/]/).pop() || relativePath
      store.setActiveWorktree(worktreeId)
      store.markWorktreeVisited(worktreeId)
      store.setActiveView('terminal')
      // Why: renderer owns tab creation so grouped order and markdown bridges share the desktop File Explorer's store path.
      store.openFile({
        filePath,
        relativePath,
        worktreeId,
        language: detectLanguage(basename),
        runtimeEnvironmentId,
        mode: 'edit'
      })
      store.setActiveTabType('editor')
      store.revealWorktreeInSidebar(worktreeId)
    }
  )
)

unsubs.push(
  window.api.ui.onOpenDiffFromMobile(
    ({ worktreeId, filePath, relativePath, staged, runtimeEnvironmentId }) => {
      const store = useAppStore.getState()
      const language = detectLanguage(relativePath)
      store.setActiveWorktree(worktreeId)
      store.markWorktreeVisited(worktreeId)
      store.setActiveView('terminal')
      // Why: mobile renders diffs from metadata; the editor-local Changes shortcut would send plain markdown back to mobile.
      store.openDiff(worktreeId, filePath, relativePath, language, staged, {
        runtimeEnvironmentId
      })
      store.setActiveTabType('editor')
      store.revealWorktreeInSidebar(worktreeId)
    }
  )
)

unsubs.push(
  window.api.ui.onCloseTerminal(({ tabId, paneRuntimeId }) => {
    if (paneRuntimeId != null) {
      // Why: route pane closes via the lifecycle hook for sibling promotion (falls through to closeTab on the last pane).
      const detail: CloseTerminalPaneDetail = { tabId, paneRuntimeId }
      window.dispatchEvent(new CustomEvent(CLOSE_TERMINAL_PANE_EVENT, { detail }))
    } else {
      closeTerminalTab(tabId)
    }
  })
)

// Why: during an in-place renderer reload an older preload can linger; keep this listener additive at that seam.
if (window.api.ui.onTerminalTabCloseRequest) {
  unsubs.push(
    window.api.ui.onTerminalTabCloseRequest(({ requestId, tabId }) => {
      let responded = false
      const respond = (error?: string): void => {
        if (responded) {
          return
        }
        responded = true
        window.api.ui.respondTerminalTabClose({ requestId, ...(error ? { error } : {}) })
      }
      closeTerminalTab(tabId, {
        rejectPinned: true,
        onCancel: () => respond('terminal_tab_pinned'),
        onClosed: () => {
          void (async () => {
            const state = useAppStore.getState()
            await persistWorkspaceSessionByHost(
              window.api.session,
              buildWorkspaceSessionPayload(state),
              state
            )
            respond()
          })().catch((error: unknown) => {
            respond(error instanceof Error ? error.message : 'terminal_tab_close_failed')
          })
        }
      })
    })
  )
}

unsubs.push(
  window.api.ui.onSleepWorktree(({ worktreeId }) => {
    void runSleepWorktree(worktreeId)
  })
)

unsubs.push(
  window.api.ui.onResumeSleepingAgents(({ worktreeId }) => {
    // Why: a phone opened this worktree; wake its slept agents without changing the desktop's worktree/tab/view.
    backgroundSleepingAgentWakeDispatcher.request(worktreeId)
  })
)

}
