// Concrete surface implementation for useTabGroupWorkspaceModel.ts
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { OpenFile } from '@/store/slices/editor'
import type {
  BrowserTab as BrowserTabState,
  Tab,
  TabGroup,
  TerminalTab
} from '../../../../shared/types'
import { useAppStore } from '../../store'
import { focusTerminalTabSurface } from '../../lib/focus-terminal-tab-surface'
import {
  createWebRuntimeSessionBrowserTab,
  createWebRuntimeSessionTerminal,
  isWebRuntimeSessionActive
} from '../../runtime/web-runtime-session'
import { openTabBarEntry, type TabCreateEntryArgs } from '../tab-bar/tab-create-entry-action'
import { buildDuplicatedBrowserTabOptions } from '@/lib/duplicate-browser-tab-options'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { browserWorkspaceHasRemoteOwner } from '@/runtime/remote-browser-tab-ownership'
import { projectTabGroupWorkspaceItems } from './tab-group-workspace-item-projection'
import { useTabGroupWorkspaceCloseActions } from './tab-group-workspace-close-actions'
import { useTabGroupWorkspaceActivationActions } from './tab-group-workspace-activation-actions'

export function recordTerminalTabGroupSplit(createdTerminal: TerminalTab | null | undefined): void {
  if (!createdTerminal) {
    return
  }
  useAppStore.getState().recordFeatureInteraction('terminal-pane-split')
}
export type GroupEditorItem = OpenFile & { tabId: string }
export type GroupBrowserItem = BrowserTabState & { tabId: string }

const EMPTY_GROUPS: readonly TabGroup[] = []
const EMPTY_UNIFIED_TABS: readonly Tab[] = []
const EMPTY_BROWSER_TABS: readonly BrowserTabState[] = []
const EMPTY_TERMINAL_TABS: readonly TerminalTab[] = []
const EMPTY_TERMINAL_LAYOUTS_BY_TAB_ID: NonNullable<
  ReturnType<typeof useAppStore.getState>['terminalLayoutsByTabId']
> = {}

export function useTabGroupWorkspaceModel({
  groupId,
  worktreeId
}: {
  groupId: string
  worktreeId: string
}) {
  const worktreeState = useAppStore(
    useShallow((state) => ({
      // Why: reuse stable EMPTY_* fallbacks; fresh `?? []` arrays break Zustand v5 snapshot identity and cause an infinite render loop.
      groups: state.groupsByWorktree[worktreeId] ?? EMPTY_GROUPS,
      unifiedTabs: state.unifiedTabsByWorktree[worktreeId] ?? EMPTY_UNIFIED_TABS,
      terminalTabs: state.tabsByWorktree[worktreeId] ?? EMPTY_TERMINAL_TABS,
      openFiles: state.openFiles,
      browserTabs: state.browserTabsByWorktree[worktreeId] ?? EMPTY_BROWSER_TABS,
      expandedPaneByTabId: state.expandedPaneByTabId,
      terminalLayoutsByTabId: state.terminalLayoutsByTabId ?? EMPTY_TERMINAL_LAYOUTS_BY_TAB_ID,
      generatedTabTitlesEnabled: state.settings?.tabAutoGenerateTitle === true
    }))
  )

  const focusGroup = useAppStore((state) => state.focusGroup)
  const activateTab = useAppStore((state) => state.activateTab)
  const closeUnifiedTab = useAppStore((state) => state.closeUnifiedTab)
  const closeEmptyGroup = useAppStore((state) => state.closeEmptyGroup)
  const createTab = useAppStore((state) => state.createTab)
  const closeTab = useAppStore((state) => state.closeTab)
  const setActiveTab = useAppStore((state) => state.setActiveTab)
  const setActiveFile = useAppStore((state) => state.setActiveFile)
  const setActiveTabType = useAppStore((state) => state.setActiveTabType)
  const createBrowserTab = useAppStore((state) => state.createBrowserTab)
  const openNewBrowserTabInActiveWorkspace = useAppStore(
    (state) => state.openNewBrowserTabInActiveWorkspace
  )
  const openNewMarkdownInActiveWorkspace = useAppStore(
    (state) => state.openNewMarkdownInActiveWorkspace
  )
  const openNewTerminalTabInActiveWorkspace = useAppStore(
    (state) => state.openNewTerminalTabInActiveWorkspace
  )
  const closeFile = useAppStore((state) => state.closeFile)
  const makePreviewFilePermanent = useAppStore((state) => state.makePreviewFilePermanent)
  const pinFile = useAppStore((state) => state.pinFile)
  const closeBrowserTab = useAppStore((state) => state.closeBrowserTab)
  const setActiveBrowserTab = useAppStore((state) => state.setActiveBrowserTab)
  const setActiveWorktree = useAppStore((state) => state.setActiveWorktree)
  const createEmptySplitGroup = useAppStore((state) => state.createEmptySplitGroup)
  const setTabCustomTitle = useAppStore((state) => state.setTabCustomTitle)
  const setTabColor = useAppStore((state) => state.setTabColor)

  const group = useMemo(
    () => worktreeState.groups.find((item) => item.id === groupId) ?? null,
    [groupId, worktreeState.groups]
  )
  const groupTabs = useMemo(
    () => worktreeState.unifiedTabs.filter((item) => item.groupId === groupId),
    [groupId, worktreeState.unifiedTabs]
  )
  const activeItemId = group?.activeTabId ?? null
  const activeTab = groupTabs.find((item) => item.id === activeItemId) ?? null
  // Why: shell identity lives on the terminal tab (not the unified tab) so icons survive default-shell changes.
  const terminalTabById = useMemo(
    () => new Map(worktreeState.terminalTabs.map((item) => [item.id, item])),
    [worktreeState.terminalTabs]
  )

  const { terminalTabs, editorItems, browserItems } = useMemo(
    () =>
      projectTabGroupWorkspaceItems({
        groupTabs,
        terminalTabsById: terminalTabById,
        worktreeId,
        generatedTabTitlesEnabled: worktreeState.generatedTabTitlesEnabled,
        openFiles: worktreeState.openFiles,
        browserTabs: worktreeState.browserTabs
      }),
    [
      groupTabs,
      terminalTabById,
      worktreeId,
      worktreeState.generatedTabTitlesEnabled,
      worktreeState.openFiles,
      worktreeState.browserTabs
    ]
  )

  const closeActions = useTabGroupWorkspaceCloseActions({
    group,
    groupTabs,
    worktreeId,
    groupId,
    closeFile,
    setActiveWorktree,
    closeBrowserTab,
    closeUnifiedTab,
    closeTab,
    closeEmptyGroup
  })
  const {
    closeItem,
    closeMany,
    closeGroup,
    closeAllEditorTabsInGroup,
    closeOthers,
    closeToRight,
    closeToLeft
  } = closeActions

  const activationActions = useTabGroupWorkspaceActivationActions({
    groupTabs,
    groupId,
    worktreeId,
    worktreeState,
    focusGroup,
    activateTab,
    setActiveTab,
    setActiveFile,
    setActiveTabType,
    setActiveBrowserTab,
    createEmptySplitGroup,
    createTab
  })
  const {
    activateTerminal,
    toggleTerminalPaneExpand,
    activateEditor,
    activateBrowser,
    createSplitGroup
  } = activationActions

  const tabBarOrder = useMemo(
    () =>
      (group?.tabOrder ?? []).map((itemId) => {
        const item = groupTabs.find((candidate) => candidate.id === itemId)
        if (!item) {
          return itemId
        }
        return item.contentType === 'terminal' || item.contentType === 'browser'
          ? item.entityId
          : item.id
      }),
    [group, groupTabs]
  )

  return {
    group,
    activeTab,
    browserItems,
    editorItems,
    terminalTabs,
    tabBarOrder,
    groupTabs,
    expandedPaneByTabId: worktreeState.expandedPaneByTabId,
    commands: {
      focusGroup: () => {
        focusGroup(worktreeId, groupId)
      },
      activateBrowser,
      activateEditor,
      activateTerminal,
      closeAllEditorTabsInGroup,
      closeGroup,
      closeItem,
      closeOthers,
      closeToRight,
      closeToLeft,
      createSplitGroup,
      newBrowserTab: () => {
        void openNewBrowserTabInActiveWorkspace(groupId)
      },
      openEntry: async (args: TabCreateEntryArgs) => {
        await openTabBarEntry(args)
      },
      duplicateBrowserTab: (browserTabId: string) => {
        void (async () => {
          const state = useAppStore.getState()
          const tabs = state.browserTabsByWorktree[worktreeId] ?? []
          const source = tabs.find((t) => t.id === browserTabId)
          if (!source) {
            return
          }
          const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
          if (
            browserWorkspaceHasRemoteOwner(state, source.id, runtimeEnvironmentId) &&
            (await createWebRuntimeSessionBrowserTab({
              worktreeId,
              environmentId: runtimeEnvironmentId,
              url: source.url,
              profileId: source.sessionProfileId,
              targetGroupId: groupId
            }))
          ) {
            return
          }
          createBrowserTab(worktreeId, source.url, {
            ...buildDuplicatedBrowserTabOptions(source),
            targetGroupId: groupId
          })
        })()
      },
      // Why: target the owning group explicitly; the "+" menu can fire from an unfocused panel without updating global group focus.
      newFileTab: async () => {
        await openNewMarkdownInActiveWorkspace(groupId)
      },
      newTerminalTab: () => {
        void openNewTerminalTabInActiveWorkspace(groupId)
      },
      newTerminalWithShell: (shellOverride: string) => {
        void (async () => {
          const environmentId = getRuntimeEnvironmentIdForWorktree(
            useAppStore.getState(),
            worktreeId
          )
          const outcome = await createWebRuntimeSessionTerminal({
            worktreeId,
            environmentId,
            targetGroupId: groupId,
            command: shellOverride,
            activate: true
          })
          if (outcome.status === 'created' || isWebRuntimeSessionActive(environmentId)) {
            return
          }
          const terminal = createTab(worktreeId, groupId, shellOverride)
          setActiveTab(terminal.id)
          setActiveTabType('terminal')
          focusTerminalTabSurface(terminal.id)
        })()
      },
      makePreviewFilePermanent,
      pinFile,
      setTabColor,
      setTabCustomTitle,
      toggleTerminalPaneExpand
    }
  }
}
