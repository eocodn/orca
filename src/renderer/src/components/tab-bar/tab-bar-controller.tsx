import { useMemo } from 'react'
import type {
  BrowserTab as BrowserTabState,
  Tab,
  TerminalTab,
  WorkspaceVisibleTabType
} from '../../../../shared/types'
import { useAppStore } from '../../store'
import { buildStatusMap } from '../right-sidebar/status-display'
import type { OpenFile } from '../../store/slices/editor'
import type { HoveredTabInsertion } from '../tab-group/useTabDragSplit'
import type { TabCreateEntryArgs } from './tab-create-entry-action'
import { useTabBarMenuController } from './tab-bar-menu-controller'
import { createUnifiedTabLookup, getTabLayoutSignature, type TabItem } from './tab-bar-types'
import { buildTabItems, findActiveVisibleTabId, resolveDropIndicators } from './tab-bar-drag'
import { useTabStripOverflowNavigation } from './tab-strip-overflow-navigation'
import { useTabStripDragScrollHandlers } from './tab-strip-drag-scroll'
import { normalizeRelativePath } from '@/lib/path'
import { selectTabBarAgentProjections } from './tab-agent-types-by-tab-id'

type GitStatusEntries = ReturnType<typeof useAppStore.getState>['gitStatusByWorktree'][string]
const EMPTY_GIT_STATUS_ENTRIES: GitStatusEntries = []
const EMPTY_UNIFIED_TABS: readonly Tab[] = []

export type TabBarProps = {
  tabs: (TerminalTab & { unifiedTabId?: string })[]
  activeTabId: string | null
  groupId?: string
  worktreeId: string
  expandedPaneByTabId: Record<string, boolean>
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onCloseOthers: (tabId: string) => void
  onCloseToRight: (tabId: string) => void
  onCloseToLeft: (tabId: string) => void
  onNewTerminalTab: () => void
  onNewTerminalWithShell?: (shell: string) => void
  onNewBrowserTab: () => void
  onOpenEntry?: (args: TabCreateEntryArgs) => Promise<void>
  terminalOnly?: boolean
  showAgentLaunchItems?: boolean
  onNewFileTab?: () => void
  onOpenFileTab?: () => void
  newTabMenuOrder?: 'default' | 'markdown-first'
  onSetCustomTitle: (tabId: string, title: string | null) => void
  onSetTabColor: (tabId: string, color: string | null) => void
  onTogglePaneExpand: (tabId: string) => void
  editorFiles?: (OpenFile & { tabId?: string })[]
  browserTabs?: (BrowserTabState & { tabId?: string })[]
  activeFileId?: string | null
  activeBrowserTabId?: string | null
  activeTabType?: WorkspaceVisibleTabType
  onActivateFile?: (fileId: string) => void
  onCloseFile?: (fileId: string) => void
  onActivateBrowserTab?: (tabId: string) => void
  onCloseBrowserTab?: (tabId: string) => void
  onDuplicateBrowserTab?: (tabId: string) => void
  onCloseAllFiles?: () => void
  onMakePreviewFilePermanent?: (fileId: string, tabId?: string) => void
  onPinFile?: (fileId: string, tabId?: string) => void
  tabBarOrder?: string[]
  hoveredTabInsertion?: HoveredTabInsertion | null
  tabStripChrome?: 'default' | 'floating-panel'
}

export type TabBarControllerModel = {
  includeTopTabBorder: boolean
  resolvedGroupId: string
  generatedTabTitlesEnabled: boolean
  statusByRelativePath: ReturnType<typeof buildStatusMap>
  orderedItems: TabItem[]
  sortableIds: string[]
  activeVisibleTabId: string | null
  dropIndicatorByVisibleId: ReturnType<typeof resolveDropIndicators>
  tabStripRef: (node: HTMLDivElement | null) => void
  tabStripOverflowState: ReturnType<typeof useTabStripOverflowNavigation>['tabStripOverflowState']
  scrollTabStrip: ReturnType<typeof useTabStripOverflowNavigation>['scrollTabStrip']
  tabStripDragScroll: ReturnType<typeof useTabStripDragScrollHandlers>
  togglePinned: (item: TabItem) => void
} & ReturnType<typeof useTabBarMenuController>

export function useTabBarController({
  tabs,
  activeTabId,
  groupId,
  worktreeId,
  expandedPaneByTabId,
  onNewTerminalTab,
  onNewTerminalWithShell,
  onNewBrowserTab,
  onNewFileTab,
  onOpenFileTab,
  terminalOnly = false,
  editorFiles,
  browserTabs,
  activeFileId,
  activeBrowserTabId,
  activeTabType,
  tabBarOrder,
  hoveredTabInsertion,
  tabStripChrome = 'default',
  onPinFile
}: TabBarProps): TabBarControllerModel {
  useAppStore(selectTabBarAgentProjections)
  const includeTopTabBorder = tabStripChrome !== 'floating-panel'
  const generatedTabTitlesEnabled = useAppStore((s) => s.settings?.tabAutoGenerateTitle === true)
  const gitStatusEntries = useAppStore(
    (s) => s.gitStatusByWorktree[worktreeId] ?? EMPTY_GIT_STATUS_ENTRIES
  )
  const unifiedTabs = useAppStore((s) => s.unifiedTabsByWorktree[worktreeId] ?? EMPTY_UNIFIED_TABS)
  const pinTab = useAppStore((s) => s.pinTab)
  const unpinTab = useAppStore((s) => s.unpinTab)
  const activeGroupIdForWorktree = useAppStore((s) => s.activeGroupIdByWorktree[worktreeId])
  const resolvedGroupId = groupId ?? activeGroupIdForWorktree ?? worktreeId
  const statusByRelativePath = useMemo(() => buildStatusMap(gitStatusEntries), [gitStatusEntries])
  const unifiedTabByVisibleId = useMemo(
    () => createUnifiedTabLookup(unifiedTabs, resolvedGroupId),
    [resolvedGroupId, unifiedTabs]
  )
  const menu = useTabBarMenuController({
    worktreeId,
    resolvedGroupId,
    onNewTerminalTab,
    onNewTerminalWithShell,
    onNewBrowserTab,
    onNewFileTab,
    onOpenFileTab,
    terminalOnly
  })
  const terminalMap = useMemo(() => new Map(tabs.map((t) => [t.id, t])), [tabs])
  const editorMap = useMemo(
    () => new Map((editorFiles ?? []).map((f) => [f.tabId ?? f.id, f])),
    [editorFiles]
  )
  const browserMap = useMemo(
    () => new Map((browserTabs ?? []).map((t) => [t.id, t])),
    [browserTabs]
  )
  const terminalIds = useMemo(() => tabs.map((t) => t.id), [tabs])
  const editorFileIds = useMemo(() => editorFiles?.map((f) => f.tabId ?? f.id) ?? [], [editorFiles])
  const browserTabIds = useMemo(() => browserTabs?.map((tab) => tab.id) ?? [], [browserTabs])
  const orderedItems = useMemo(
    () =>
      buildTabItems({
        tabBarOrder,
        terminalIds,
        editorFileIds,
        browserTabIds,
        terminalMap,
        editorMap,
        browserMap,
        unifiedTabByVisibleId
      }),
    [
      tabBarOrder,
      terminalIds,
      editorFileIds,
      browserTabIds,
      terminalMap,
      editorMap,
      browserMap,
      unifiedTabByVisibleId
    ]
  )
  const sortableIds = useMemo(() => orderedItems.map((item) => item.id), [orderedItems])
  const activeIndicator =
    hoveredTabInsertion?.groupId === resolvedGroupId ? hoveredTabInsertion : null
  const dropIndicatorByVisibleId = useMemo(
    () =>
      resolveDropIndicators(
        orderedItems.map((item) => item.id),
        activeIndicator
      ),
    [activeIndicator, orderedItems]
  )
  const activeVisibleTabId = useMemo(
    () =>
      findActiveVisibleTabId(orderedItems, {
        tabType: activeTabType,
        terminalId: activeTabId,
        fileId: activeFileId,
        browserId: activeBrowserTabId
      }),
    [activeBrowserTabId, activeFileId, activeTabId, activeTabType, orderedItems]
  )
  const tabStripLayoutKey = useMemo(
    () =>
      orderedItems
        .map((item) =>
          getTabLayoutSignature(item, {
            generatedTitlesEnabled: generatedTabTitlesEnabled,
            isExpanded: expandedPaneByTabId[item.id] === true,
            status:
              item.type === 'editor'
                ? (statusByRelativePath.get(normalizeRelativePath(item.data.relativePath)) ?? null)
                : null
          })
        )
        .join('\u001f'),
    [expandedPaneByTabId, generatedTabTitlesEnabled, orderedItems, statusByRelativePath]
  )
  const togglePinned = (item: TabItem): void => {
    if (item.isPinned) {
      unpinTab(item.unifiedTabId)
      return
    }
    if (item.type === 'editor' && onPinFile) {
      onPinFile(item.data.id, item.unifiedTabId)
      return
    }
    pinTab(item.unifiedTabId)
  }
  const { tabStripRef, tabStripOverflowState, scrollTabStrip } = useTabStripOverflowNavigation({
    activeVisibleTabId,
    layoutKey: tabStripLayoutKey,
    tabCount: orderedItems.length,
    worktreeId
  })
  const tabStripDragScroll = useTabStripDragScrollHandlers(scrollTabStrip, {
    start: tabStripOverflowState.canScrollStart,
    end: tabStripOverflowState.canScrollEnd
  })
  return {
    ...menu,
    includeTopTabBorder,
    resolvedGroupId,
    generatedTabTitlesEnabled,
    statusByRelativePath,
    orderedItems,
    sortableIds,
    activeVisibleTabId,
    dropIndicatorByVisibleId,
    tabStripRef,
    tabStripOverflowState,
    scrollTabStrip,
    tabStripDragScroll,
    togglePinned
  }
}
