import { useCallback } from 'react'
import { useAppStore, type AppState } from '../store'
import { openTabBarEntry } from './tab-bar/tab-create-entry-action'
import type { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import type { translate } from '@/i18n/i18n'
import type { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import type { buildDuplicatedBrowserTabOptions } from '@/lib/duplicate-browser-tab-options'
import type { browserWorkspaceHasRemoteOwner } from '@/runtime/remote-browser-tab-ownership'
import type {
  createWebRuntimeSessionBrowserTab,
  createWebRuntimeSessionTerminal,
  isWebRuntimeSessionActive
} from '@/runtime/web-runtime-session'
import type { toast } from 'sonner'

type TerminalSurfaceCreationContext = Pick<
  AppState,
  | 'activeWorktreeId'
  | 'createTab'
  | 'setActiveTabType'
  | 'openNewTerminalTabInActiveWorkspace'
  | 'setTabBarOrder'
  | 'openNewMarkdownInActiveWorkspace'
  | 'openNewBrowserTabInActiveWorkspace'
  | 'createBrowserTab'
> & {
  launchAgentInNewTab: typeof launchAgentInNewTab
  getActiveWorktreeRuntimeEnvironmentId: (worktreeId: string) => string | null
  isWebRuntimeSessionActive: typeof isWebRuntimeSessionActive
  createWebRuntimeSessionTerminal: typeof createWebRuntimeSessionTerminal
  createWebRuntimeSessionBrowserTab: typeof createWebRuntimeSessionBrowserTab
  buildDuplicatedBrowserTabOptions: typeof buildDuplicatedBrowserTabOptions
  browserWorkspaceHasRemoteOwner: typeof browserWorkspaceHasRemoteOwner
  focusTerminalTabSurface: typeof focusTerminalTabSurface
  toast: typeof toast
  translate: typeof translate
}

export type TerminalSurfaceCreationActions = ReturnType<typeof useTerminalSurfaceCreationActions>

export function useTerminalSurfaceCreationActions(context: TerminalSurfaceCreationContext): {
  handleNewTab: (shellOverride?: string) => void
  handleNewAgentTab: (agent: TuiAgent) => void
  handleNewBrowserTab: () => void
  handleOpenEntry: (args: TabCreateEntryArgs) => Promise<void>
  handleDuplicateBrowserTab: (browserTabId: string) => void
  handleNewFile: () => Promise<void>
} {
  const {
    activeWorktreeId,
    createTab,
    setActiveTabType,
    openNewTerminalTabInActiveWorkspace,
    setTabBarOrder,
    launchAgentInNewTab,
    getActiveWorktreeRuntimeEnvironmentId,
    isWebRuntimeSessionActive,
    createWebRuntimeSessionTerminal,
    createWebRuntimeSessionBrowserTab,
    openNewMarkdownInActiveWorkspace,
    openNewBrowserTabInActiveWorkspace,
    createBrowserTab,
    buildDuplicatedBrowserTabOptions,
    browserWorkspaceHasRemoteOwner,
    focusTerminalTabSurface,
    toast,
    translate
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
      createWebRuntimeSessionTerminal,
      focusTerminalTabSurface,
      getActiveWorktreeRuntimeEnvironmentId,
      isWebRuntimeSessionActive,
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
    [activeWorktreeId, launchAgentInNewTab, toast, translate]
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
  }, [
    activeWorktreeId,
    createBrowserTab,
    createWebRuntimeSessionBrowserTab,
    getActiveWorktreeRuntimeEnvironmentId,
    isWebRuntimeSessionActive,
    openNewBrowserTabInActiveWorkspace,
    translate
  ])

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
    [
      activeWorktreeId,
      browserWorkspaceHasRemoteOwner,
      buildDuplicatedBrowserTabOptions,
      createBrowserTab,
      createWebRuntimeSessionBrowserTab,
      getActiveWorktreeRuntimeEnvironmentId,
      isWebRuntimeSessionActive
    ]
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

  return {
    handleNewTab,
    handleNewAgentTab,
    handleNewBrowserTab,
    handleOpenEntry,
    handleDuplicateBrowserTab,
    handleNewFile
  }
}
