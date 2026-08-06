import { useMemo, useRef, useState } from 'react'
import { useShortcutKeyDetails } from '@/hooks/useShortcutLabel'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { useTerminalTabColdParking } from '@/components/terminal-pane/use-terminal-tab-cold-parking'
import { createTerminalPaneHandleRegistry } from './terminal-pane-handle-registry'
import {
  getDefaultFloatingTerminalBounds,
  getDefaultFloatingTerminalCommittedBounds,
  readPersistedFloatingTerminalPanelBounds,
  resolveFloatingTerminalPanelBounds,
  resolveFloatingTerminalPanelCommittedBounds,
  shouldReconcileFloatingTerminalPanelBounds,
  type FloatingTerminalPanelBounds,
  type FloatingTerminalPanelBoundsSource,
  type FloatingTerminalPanelCommittedBounds
} from './floating-terminal-panel-bounds'
import { resolveGroupTabFromVisibleId } from '@/components/tab-group/tab-group-visible-id'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { BrowserTab as BrowserTabState, TerminalTab } from '../../../../shared/types'
import { resolveUnifiedTabLabel } from '../../../../shared/tab-title-resolution'
import type { TerminalPaneHandle } from '@/components/terminal-pane/TerminalPane'
import { ModifierDoubleTapDetector } from '../../../../shared/modifier-double-tap-detector'
import { selectFloatingTerminalPanelInputs } from './floating-terminal-panel-inputs'

const NO_ACTIVITY_TERMINAL_PORTALS: never[] = []

export type FloatingTerminalPanelBoundsState = {
  committedBounds: FloatingTerminalPanelCommittedBounds
  renderedBounds: FloatingTerminalPanelBounds
  source: FloatingTerminalPanelBoundsSource
}

function readInitialPanelBounds(): FloatingTerminalPanelBoundsState {
  const defaultCommittedBounds = getDefaultFloatingTerminalCommittedBounds()
  const defaultRenderedBounds = getDefaultFloatingTerminalBounds()
  const persistedBounds = readPersistedFloatingTerminalPanelBounds()
  return persistedBounds
    ? {
        committedBounds: persistedBounds,
        renderedBounds: shouldReconcileFloatingTerminalPanelBounds('user')
          ? resolveFloatingTerminalPanelBounds(persistedBounds, 'user')
          : resolveFloatingTerminalPanelCommittedBounds(persistedBounds),
        source: 'user'
      }
    : {
        committedBounds: defaultCommittedBounds,
        renderedBounds: defaultRenderedBounds,
        source: 'default'
      }
}

export type FloatingTerminalPanelStateOptions = {
  open: boolean
}

export function useFloatingTerminalPanelState({ open }: FloatingTerminalPanelStateOptions) {
  const { tabs, browserTabs, groups, unifiedTabs, floatingFiles, expandedPaneByTabId } = useAppStore(
    selectFloatingTerminalPanelInputs
  )
  const createTab = useAppStore((state) => state.createTab)
  const createBrowserTab = useAppStore((state) => state.createBrowserTab)
  const closeTab = useAppStore((state) => state.closeTab)
  const closeBrowserTab = useAppStore((state) => state.closeBrowserTab)
  const closeFile = useAppStore((state) => state.closeFile)
  const closeUnifiedTab = useAppStore((state) => state.closeUnifiedTab)
  const markFileDirty = useAppStore((state) => state.markFileDirty)
  const activateTab = useAppStore((state) => state.activateTab)
  const setActiveTab = useAppStore((state) => state.setActiveTab)
  const setTabCustomTitle = useAppStore((state) => state.setTabCustomTitle)
  const setTabColor = useAppStore((state) => state.setTabColor)
  const setTabPaneExpanded = useAppStore((state) => state.setTabPaneExpanded)
  const makePreviewFilePermanent = useAppStore((state) => state.makePreviewFilePermanent)
  const pinFile = useAppStore((state) => state.pinFile)
  const openFile = useAppStore((state) => state.openFile)
  const browserDefaultUrl = useAppStore((state) => state.browserDefaultUrl)
  const floatingTerminalCwd = useAppStore((state) => state.settings?.floatingTerminalCwd ?? '')
  const generatedTabTitlesEnabled = useAppStore(
    (state) => state.settings?.tabAutoGenerateTitle === true
  )
  const newTerminalShortcut = useShortcutKeyDetails('tab.newTerminal')
  const newBrowserShortcut = useShortcutKeyDetails('tab.newBrowser')
  const newMarkdownShortcut = useShortcutKeyDetails('tab.newMarkdown')
  const openMarkdownShortcut = useShortcutKeyDetails('tab.openMarkdown')
  const closeShortcut = useShortcutKeyDetails('tab.close')

  const [cwd, setCwd] = useState<string | null>(null)
  const [markdownCwd, setMarkdownCwd] = useState<string | null>(null)
  const initialBoundsStateRef = useRef<FloatingTerminalPanelBoundsState | null>(null)
  if (initialBoundsStateRef.current === null) {
    initialBoundsStateRef.current = readInitialPanelBounds()
  }
  const boundsSourceRef = useRef<FloatingTerminalPanelBoundsSource>(
    initialBoundsStateRef.current.source
  )
  const committedBoundsRef = useRef<FloatingTerminalPanelCommittedBounds>(
    initialBoundsStateRef.current.committedBounds
  )
  const [bounds, setBounds] = useState(initialBoundsStateRef.current.renderedBounds)
  const [maximized, setMaximized] = useState(false)
  const restoreBoundsRef = useRef<FloatingTerminalPanelBoundsState | null>(null)
  const stagedBoundsRef = useRef<FloatingTerminalPanelBounds | null>(null)
  const lastPersistedBoundsRef = useRef<FloatingTerminalPanelCommittedBounds | null>(
    initialBoundsStateRef.current.source === 'user'
      ? initialBoundsStateRef.current.committedBounds
      : null
  )
  const pendingEditorCloseQueueRef = useRef<string[]>([])
  const pendingReclaimArmByFileIdRef = useRef<Map<string, () => void>>(new Map())
  const saveDialogFileIdRef = useRef<string | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [terminalPaneRegistry] = useState(() =>
    createTerminalPaneHandleRegistry<TerminalPaneHandle>()
  )
  const doubleTapDetectorRef = useRef<ModifierDoubleTapDetector | null>(null)
  if (!doubleTapDetectorRef.current) {
    doubleTapDetectorRef.current = new ModifierDoubleTapDetector()
  }
  const shortcutFocusFrameRef = useRef<number | null>(null)
  const shortcutFocusTimeoutRef = useRef<number | null>(null)
  const reclaimTerminalInputOnWindowFocusRef = useRef<{
    helper: HTMLElement
    leafId: string | null
  } | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    bounds: FloatingTerminalPanelBounds
    moved: boolean
  } | null>(null)

  const activeGroup = useMemo(
    () =>
      groups.find((group) => group.activeTabId != null) ??
      (unifiedTabs[0]
        ? (groups.find((group) => group.id === unifiedTabs[0].groupId) ?? null)
        : null),
    [groups, unifiedTabs]
  )
  const groupTabs = useMemo(
    () => (activeGroup ? unifiedTabs.filter((tab) => tab.groupId === activeGroup.id) : unifiedTabs),
    [activeGroup, unifiedTabs]
  )
  const activeTab = useMemo(
    () =>
      (activeGroup?.activeTabId
        ? groupTabs.find((tab) => tab.id === activeGroup.activeTabId)
        : null) ??
      groupTabs[0] ??
      null,
    [activeGroup, groupTabs]
  )
  const activeTerminalId = activeTab?.contentType === 'terminal' ? activeTab.entityId : null
  const activeBrowserId = activeTab?.contentType === 'browser' ? activeTab.entityId : null
  const activeEditorUnifiedId =
    activeTab && !['terminal', 'browser'].includes(activeTab.contentType)
      ? activeTab.id
      : null
  const activeEditorFileId =
    activeTab && !['terminal', 'browser'].includes(activeTab.contentType)
      ? activeTab.entityId
      : null
  const terminalTabById = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab])), [tabs])
  const terminalAssignments = useMemo(() => {
    const assignments = new Map<string, { groupId: string; isActiveInGroup: boolean }>()
    for (const tab of unifiedTabs) {
      if (tab.contentType === 'terminal') {
        assignments.set(tab.entityId, {
          groupId: tab.groupId,
          isActiveInGroup: tab.entityId === activeTerminalId
        })
      }
    }
    return assignments
  }, [activeTerminalId, unifiedTabs])
  const parkedTerminalTabIds = useTerminalTabColdParking({
    worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
    terminalTabs: tabs,
    assignments: terminalAssignments,
    isWorktreeActive: open,
    coldParkTerminalPanes: false,
    shouldMeasureHiddenWorktree: false,
    activityTerminalPortals: NO_ACTIVITY_TERMINAL_PORTALS
  })
  const terminalItems = useMemo<(TerminalTab & { unifiedTabId: string })[]>(
    () =>
      groupTabs
        .filter((tab) => tab.contentType === 'terminal')
        .flatMap((tab) => {
          const terminalTab = terminalTabById.get(tab.entityId)
          if (!terminalTab) return []
          return [{
            ...terminalTab,
            unifiedTabId: tab.id,
            title: resolveUnifiedTabLabel(
              { ...tab, quickCommandLabel: tab.quickCommandLabel ?? terminalTab.quickCommandLabel, generatedLabel: tab.generatedLabel ?? terminalTab.generatedTitle },
              generatedTabTitlesEnabled,
              tab.label
            ),
            generatedTitle: terminalTab.generatedTitle ?? tab.generatedLabel ?? null,
            quickCommandLabel: terminalTab.quickCommandLabel ?? tab.quickCommandLabel ?? null,
            customTitle: tab.customLabel ?? terminalTab.customTitle,
            color: tab.color ?? terminalTab.color
          }]
        }),
    [generatedTabTitlesEnabled, groupTabs, terminalTabById]
  )
  const browserItems = useMemo(
    () => groupTabs.filter((tab) => tab.contentType === 'browser').map((tab) => {
      const browserTab = browserTabs.find((candidate) => candidate.id === tab.entityId)
      return browserTab ? { ...browserTab, tabId: tab.id } : null
    }).filter((tab): tab is BrowserTabState & { tabId: string } => tab !== null),
    [browserTabs, groupTabs]
  )
  const editorItems = useMemo(
    () => groupTabs.filter((tab) => !['terminal', 'browser'].includes(tab.contentType)).map((tab) => {
      const file = floatingFiles.find((candidate) => candidate.id === tab.entityId)
      return file ? { ...file, tabId: tab.id } : null
    }).filter((file): file is OpenFile & { tabId: string } => file !== null),
    [floatingFiles, groupTabs]
  )
  const hasVisibleFloatingTabs = terminalItems.length > 0 || browserItems.length > 0 || editorItems.length > 0
  const visibleFloatingItemCount = terminalItems.length + browserItems.length + editorItems.length
  const activeClosableTab = hasVisibleFloatingTabs ? activeTab : null
  const tabBarOrder = useMemo(() => (activeGroup?.tabOrder ?? []).map((tabId) => {
    const tab = groupTabs.find((candidate) => candidate.id === tabId)
    return tab?.contentType === 'terminal' || tab?.contentType === 'browser' ? tab.entityId : tabId
  }), [activeGroup, groupTabs])
  const visibleFloatingTabOrder = useMemo(() => tabBarOrder.filter((visibleId) => {
    const tab = resolveGroupTabFromVisibleId(groupTabs, visibleId)
    if (!tab) return false
    if (tab.contentType === 'terminal') return terminalItems.some((item) => item.unifiedTabId === tab.id)
    if (tab.contentType === 'browser') return browserItems.some((item) => item.tabId === tab.id)
    return editorItems.some((item) => item.tabId === tab.id)
  }), [browserItems, editorItems, groupTabs, tabBarOrder, terminalItems])
  const activeBrowserTab = activeBrowserId ? browserTabs.find((tab) => tab.id === activeBrowserId) ?? null : null
  const activeEditorFile = activeEditorFileId ? floatingFiles.find((file) => file.id === activeEditorFileId) ?? null : null
  const activeTabType = activeTab?.contentType === 'browser' ? 'browser' : activeTab?.contentType === 'terminal' ? 'terminal' : 'editor'

  return {
    tabs, browserTabs, groups, unifiedTabs, floatingFiles, expandedPaneByTabId,
    createTab, createBrowserTab, closeTab, closeBrowserTab, closeFile, closeUnifiedTab, markFileDirty,
    activateTab, setActiveTab, setTabCustomTitle, setTabColor, setTabPaneExpanded,
    makePreviewFilePermanent, pinFile, openFile, browserDefaultUrl, floatingTerminalCwd,
    generatedTabTitlesEnabled, newTerminalShortcut, newBrowserShortcut, newMarkdownShortcut,
    openMarkdownShortcut, closeShortcut, cwd, setCwd, markdownCwd, setMarkdownCwd,
    initialBoundsStateRef, boundsSourceRef, committedBoundsRef, bounds, setBounds, maximized,
    setMaximized, restoreBoundsRef, stagedBoundsRef, lastPersistedBoundsRef,
    pendingEditorCloseQueueRef, pendingReclaimArmByFileIdRef, saveDialogFileIdRef, panelRef,
    terminalPaneRegistry, doubleTapDetectorRef, shortcutFocusFrameRef, shortcutFocusTimeoutRef,
    reclaimTerminalInputOnWindowFocusRef, dragRef, activeGroup, groupTabs, activeTab,
    activeTerminalId, activeBrowserId, activeEditorUnifiedId, activeEditorFileId, terminalTabById,
    terminalAssignments, parkedTerminalTabIds, terminalItems, browserItems, editorItems,
    hasVisibleFloatingTabs, visibleFloatingItemCount, activeClosableTab,
    tabBarOrder, visibleFloatingTabOrder, activeBrowserTab, activeEditorFile, activeTabType
  }
}
