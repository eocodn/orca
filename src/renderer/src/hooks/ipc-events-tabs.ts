import { useAppStore } from '../store'
import { translate } from '@/i18n/i18n'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { closeMobileSessionTabInStore } from '@/runtime/mobile-session-tab-close'
import { destroyPersistentWebview } from '@/components/browser-pane/webview-registry'
import {
  closeWebRuntimeSessionTab,
  createWebRuntimeSessionTerminal,
  isWebRuntimeSessionActive
} from '@/runtime/web-runtime-session'
import {
  createFloatingWorkspaceBrowserTab,
  createFloatingWorkspaceMarkdownTab,
  createFloatingWorkspaceTerminalTab,
  isEmptyFloatingWorkspacePanelVisible,
  isFloatingWorkspacePanelFocused,
  resolveFloatingWorkspaceBrowserWorkspaceId,
  switchFloatingWorkspaceTab
} from '@/lib/floating-workspace-terminal-actions'
import {
  dispatchFloatingWorkspaceGuestClose,
  dispatchFloatingWorkspaceGuestSelectIndex
} from '@/lib/floating-workspace-guest-bridge'
import { guardPinnedTabClose, resolvePinnedTabLabel } from '../store/pinned-tab-close-guard'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { TOGGLE_FLOATING_TERMINAL_EVENT } from '@/lib/floating-terminal'
import { getWorktreeRuntimeEnvironmentId } from './ipc-events-runtime-environment-model'

type TabSurfaceContext = {
  unsubs: Array<() => void>
  isRuntimeEnvironmentActive: () => boolean
  acquireBrowserAutomationBootstrapLease: (
    worktreeId: string | null | undefined,
    browserPageId?: string | null
  ) => void
  isPinnedSessionTab: (store: ReturnType<typeof useAppStore.getState>, worktreeId: string, visibleId: string) => boolean
  resolveBrowserSessionTabTarget: (
    state: Pick<ReturnType<typeof useAppStore.getState>, 'browserTabsByWorktree' | 'unifiedTabsByWorktree'>,
    worktreeId: string,
    tabId: string
  ) => BrowserSessionTabTarget | null
}

type BrowserSessionTabTarget =
  | { kind: 'unified-browser'; unifiedTabId: string; workspaceId: string; groupId: string }
  | { kind: 'fallback-browser'; workspaceId: string }

export function registerTabEvents({
  unsubs,
  isRuntimeEnvironmentActive,
  acquireBrowserAutomationBootstrapLease,
  isPinnedSessionTab,
  resolveBrowserSessionTabTarget
}: TabSurfaceContext): void {
// Why: reply with the page ID so main can await registerGuest before returning to the CLI.
unsubs.push(
  window.api.ui.onRequestTabCreate((data) => {
    try {
      if (isRuntimeEnvironmentActive()) {
        // Why: browser automation targets client-local Electron webviews that runtime agents can't see or control.
        window.api.ui.replyTabCreate({
          requestId: data.requestId,
          error: translate(
            'auto.hooks.useIpcEvents.291c8ed902',
            'Browser tabs are unavailable while a remote runtime is active'
          )
        })
        return
      }
      const store = useAppStore.getState()
      const worktreeId = data.worktreeId ?? store.activeWorktreeId
      if (!worktreeId) {
        window.api.ui.replyTabCreate({
          requestId: data.requestId,
          error: translate('auto.hooks.useIpcEvents.f000b2ff76', 'No active worktree')
        })
        return
      }
      // Why: CLI-created tabs should land in the active browser tab's group, not the terminal's UI-active group.
      const activeBrowserTabId = store.activeBrowserTabIdByWorktree[worktreeId]
      const activeBrowserUnifiedTab = activeBrowserTabId
        ? (store.unifiedTabsByWorktree[worktreeId] ?? []).find(
            (t) => t.contentType === 'browser' && t.entityId === activeBrowserTabId
          )
        : undefined

      // Why: a user-initiated open (data.activate, e.g. mobile tapping an HTML path) foregrounds the tab so it lands in active-group order and publishes to mobile.
      // Agent/automation opens stay in the background (activate:false) in the active browser group.
      const workspace = store.createBrowserTab(worktreeId, data.url, {
        title: data.url,
        targetGroupId: data.activate ? undefined : activeBrowserUnifiedTab?.groupId,
        sessionProfileId: data.sessionProfileId,
        sessionPartition: data.sessionPartition,
        activate: data.activate === true
      })
      // Why: registerGuest fires with the page ID, not the workspace ID; return it so waitForTabRegistration can correlate.
      const pages = useAppStore.getState().browserPagesByWorkspace[workspace.id] ?? []
      const browserPageId = pages[0]?.id ?? workspace.id
      acquireBrowserAutomationBootstrapLease(worktreeId, browserPageId)
      window.api.ui.replyTabCreate({ requestId: data.requestId, browserPageId })
    } catch (err) {
      window.api.ui.replyTabCreate({
        requestId: data.requestId,
        error: err instanceof Error ? err.message : 'Tab creation failed'
      })
    }
  })
)

unsubs.push(
  window.api.ui.onRequestTabSetProfile((data) => {
    try {
      if (isRuntimeEnvironmentActive()) {
        window.api.ui.replyTabSetProfile({
          requestId: data.requestId,
          error: translate(
            'auto.hooks.useIpcEvents.f45fa2b03c',
            'Browser profiles are unavailable while a remote runtime is active'
          )
        })
        return
      }
      const store = useAppStore.getState()
      const owningWorkspace = Object.values(store.browserTabsByWorktree)
        .flat()
        .find((workspace) => {
          if (workspace.id === data.browserPageId) {
            return true
          }
          const pages = store.browserPagesByWorkspace[workspace.id] ?? []
          return pages.some((page) => page.id === data.browserPageId)
        })
      if (!owningWorkspace) {
        window.api.ui.replyTabSetProfile({
          requestId: data.requestId,
          error: translate(
            'auto.hooks.useIpcEvents.0e3cf53060',
            'Browser tab {{value0}} not found',
            { value0: data.browserPageId }
          )
        })
        return
      }
      // Why: a workspace may host several browser pages; profile switch must tear down all sibling webviews, not just the IPC's.
      const workspacePages = store.browserPagesByWorkspace[owningWorkspace.id] ?? []
      if (workspacePages.length > 0) {
        for (const page of workspacePages) {
          destroyPersistentWebview(page.id)
        }
      } else {
        destroyPersistentWebview(data.browserPageId)
      }
      store.switchBrowserTabProfile(owningWorkspace.id, data.profileId, data.sessionPartition)
      window.api.ui.replyTabSetProfile({ requestId: data.requestId })
    } catch (err) {
      window.api.ui.replyTabSetProfile({
        requestId: data.requestId,
        error: err instanceof Error ? err.message : 'Tab profile update failed'
      })
    }
  })
)

unsubs.push(
  window.api.ui.onRequestTabClose((data) => {
    try {
      if (isRuntimeEnvironmentActive()) {
        window.api.ui.replyTabClose({
          requestId: data.requestId,
          error: translate(
            'auto.hooks.useIpcEvents.291c8ed902',
            'Browser tabs are unavailable while a remote runtime is active'
          )
        })
        return
      }
      const store = useAppStore.getState()
      const explicitTargetId = data.tabId ?? null
      const replyPinnedBrowserCloseCanceled = (tabId: string): void => {
        window.api.ui.replyTabClose({
          requestId: data.requestId,
          error: translate(
            'auto.hooks.useIpcEvents.2f6637fe6c',
            'Browser tab {{value0}} is pinned',
            { value0: tabId }
          )
        })
      }
      const closeBrowserWorkspaceWithReply = (
        worktreeId: string,
        workspaceId: string
      ): void => {
        const currentStore = useAppStore.getState()
        guardPinnedTabClose({
          isPinned: isPinnedSessionTab(currentStore, worktreeId, workspaceId),
          tabLabel: resolvePinnedTabLabel(currentStore, worktreeId, workspaceId),
          onClose: () => {
            useAppStore.getState().closeBrowserTab(workspaceId)
            window.api.ui.replyTabClose({ requestId: data.requestId })
          },
          onCancel: () => replyPinnedBrowserCloseCanceled(workspaceId)
        })
      }
      const tabToClose =
        explicitTargetId ??
        (data.worktreeId
          ? (store.activeBrowserTabIdByWorktree?.[data.worktreeId] ?? null)
          : store.activeBrowserTabId)
      if (!tabToClose) {
        window.api.ui.replyTabClose({
          requestId: data.requestId,
          error: translate(
            'auto.hooks.useIpcEvents.a8d2bf8e9e',
            'No active browser tab to close'
          )
        })
        return
      }
      // Why: the bridge keys tabs by browserPageId, but closeBrowserTab expects a workspace id.
      // Per the CLI's `tab close --page` contract, close only that page unless it is the last in its workspace.
      const isWorkspaceId = Object.values(store.browserTabsByWorktree)
        .flat()
        .some((ws) => ws.id === tabToClose)
      if (!isWorkspaceId) {
        const owningWorkspace = Object.entries(store.browserPagesByWorkspace).find(
          ([, pages]) => pages.some((p) => p.id === tabToClose)
        )
        if (owningWorkspace) {
          const [workspaceId, pages] = owningWorkspace
          if (pages.length <= 1) {
            const owningWorktreeId =
              Object.entries(store.browserTabsByWorktree).find(([, tabs]) =>
                tabs.some((tab) => tab.id === workspaceId)
              )?.[0] ?? null
            if (owningWorktreeId) {
              closeBrowserWorkspaceWithReply(owningWorktreeId, workspaceId)
              return
            }
            store.closeBrowserTab(workspaceId)
          } else {
            store.closeBrowserPage(tabToClose)
          }
          window.api.ui.replyTabClose({ requestId: data.requestId })
          return
        }
      }
      const owningWorktreeId =
        Object.entries(store.browserTabsByWorktree).find(([, tabs]) =>
          tabs.some((tab) => tab.id === tabToClose)
        )?.[0] ?? null
      if (owningWorktreeId) {
        closeBrowserWorkspaceWithReply(owningWorktreeId, tabToClose)
        return
      }
      if (explicitTargetId) {
        window.api.ui.replyTabClose({
          requestId: data.requestId,
          error: translate(
            'auto.hooks.useIpcEvents.0e3cf53060',
            'Browser tab {{value0}} not found',
            { value0: explicitTargetId }
          )
        })
        return
      }
      store.closeBrowserTab(tabToClose)
      window.api.ui.replyTabClose({ requestId: data.requestId })
    } catch (err) {
      window.api.ui.replyTabClose({
        requestId: data.requestId,
        error: err instanceof Error ? err.message : 'Tab close failed'
      })
    }
  })
)

unsubs.push(
  window.api.ui.onNewTerminalTab(() => {
    const store = useAppStore.getState()
    if (isFloatingWorkspacePanelFocused()) {
      void createFloatingWorkspaceTerminalTab(store)
      return
    }
    const worktreeId = store.activeWorktreeId
    if (!worktreeId) {
      return
    }
    void (async () => {
      const environmentId = getWorktreeRuntimeEnvironmentId(worktreeId)
      const outcome = await createWebRuntimeSessionTerminal({
        worktreeId,
        environmentId,
        activate: true
      })
      if (outcome.status === 'created' || isWebRuntimeSessionActive(environmentId)) {
        return
      }
      const newTab = store.createTab(worktreeId)
      store.setActiveTabType('terminal')
      // Why: mirror Terminal.tsx handleNewTab so a new tab appends at the end, not index 0, when tabBarOrder is unset.
      const freshStore = useAppStore.getState()
      const currentTerminals = freshStore.tabsByWorktree[worktreeId] ?? []
      const currentEditors = freshStore.openFiles.filter((f) => f.worktreeId === worktreeId)
      const currentBrowsers = freshStore.browserTabsByWorktree[worktreeId] ?? []
      const stored = freshStore.tabBarOrderByWorktree[worktreeId]
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
      const order = base.filter((id) => id !== newTab.id)
      order.push(newTab.id)
      freshStore.setTabBarOrder(worktreeId, order)
      focusTerminalTabSurface(newTab.id)
    })()
  })
)

unsubs.push(
  window.api.ui.onCloseActiveTab(() => {
    if (isEmptyFloatingWorkspacePanelVisible()) {
      window.dispatchEvent(new Event(TOGGLE_FLOATING_TERMINAL_EVENT))
      return
    }
    const store = useAppStore.getState()
    if (store.activeTabType === 'browser' && store.activeBrowserTabId) {
      const tabId = store.activeBrowserTabId
      const worktreeId = store.activeWorktreeId
      const closeActiveBrowserTab = (): void => {
        const currentStore = useAppStore.getState()
        const environmentId = getWorktreeRuntimeEnvironmentId(worktreeId)
        if (environmentId && worktreeId) {
          if (!isWebRuntimeSessionActive(environmentId)) {
            currentStore.closeBrowserTab(tabId)
            return
          }
          void closeWebRuntimeSessionTab({
            worktreeId,
            tabId,
            environmentId,
            reason: 'user'
          })
          return
        }
        currentStore.closeBrowserTab(tabId)
      }
      if (worktreeId && isPinnedSessionTab(store, worktreeId, tabId)) {
        guardPinnedTabClose({
          isPinned: true,
          tabLabel: resolvePinnedTabLabel(store, worktreeId, tabId),
          onClose: closeActiveBrowserTab
        })
        return
      }
      closeActiveBrowserTab()
    }
  })
)

unsubs.push(
  window.api.ui.onCloseFloatingItem(({ sourceId }) => {
    // Main forwards the guest's browser *page* id; resolve it to the owning live floating
    // browser workspace (the id space the panel closes by), then hand off to the mounted
    // panel's own close closure (pin guard + reclaim intent). Stale id = no-op.
    const workspaceId = resolveFloatingWorkspaceBrowserWorkspaceId(
      useAppStore.getState(),
      sourceId
    )
    if (!workspaceId) {
      return
    }
    dispatchFloatingWorkspaceGuestClose({ sourceId: workspaceId })
  })
)
unsubs.push(
  window.api.ui.onSelectFloatingIndex(({ index }) => {
    dispatchFloatingWorkspaceGuestSelectIndex({ index })
  })
)

unsubs.push(
  window.api.ui.onSwitchTab((direction) => {
    const store = useAppStore.getState()
    if (isFloatingWorkspacePanelFocused()) {
      switchFloatingWorkspaceTab(store, direction, 'same-type')
      return
    }
    handleSwitchTab(direction)
  })
)
unsubs.push(
  window.api.ui.onSwitchTabAcrossAllTypes((direction) => {
    const store = useAppStore.getState()
    if (isFloatingWorkspacePanelFocused()) {
      switchFloatingWorkspaceTab(store, direction, 'all-types')
      return
    }
    handleSwitchTabAcrossAllTypes(direction)
  })
)
unsubs.push(window.api.ui.onSwitchRecentTab(handleSwitchRecentTab))
unsubs.push(
  window.api.ui.onSwitchTerminalTab((direction) => {
    const store = useAppStore.getState()
    if (isFloatingWorkspacePanelFocused()) {
      switchFloatingWorkspaceTab(store, direction, 'terminal')
      return
    }
    handleSwitchTerminalTab(direction)
  })
)

}
