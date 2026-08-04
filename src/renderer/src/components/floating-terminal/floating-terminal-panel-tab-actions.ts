import { getClientRuntime } from '@/runtime/client-runtime'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { createUntitledMarkdownFileWithTemplateSelection } from '@/lib/create-untitled-markdown'
import { detectLanguage } from '@/lib/language-detect'
import { getConnectionId } from '@/lib/connection-context'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import { destroyWorkspaceWebviews } from '@/store/slices/browser-webview-cleanup'
import { useAppStore } from '@/store'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { guardPinnedTabClose, resolvePinnedTabLabel } from '@/store/pinned-tab-close-guard'
import { resolveGroupTabFromVisibleId } from '@/components/tab-group/tab-group-visible-id'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import {
  countVisibleFloatingWorkspaceItems,
  isFloatingWorkspacePanelFocused
} from '@/lib/floating-workspace-terminal-actions'
import { armFloatingPanelReclaimIntent } from '@/lib/floating-workspace-focus-reclaim'
import { translate } from '@/i18n/i18n'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { Tab } from '../../../../shared/types'
import { useFloatingTerminalPanelState } from './floating-terminal-panel-state'
import { useFloatingTerminalPanelFileActions } from './floating-terminal-panel-file-actions'

type PanelState = ReturnType<typeof useFloatingTerminalPanelState>
type FileActions = ReturnType<typeof useFloatingTerminalPanelFileActions>

const LOCAL_RUNTIME_SETTINGS = { activeRuntimeEnvironmentId: null } as const

export function useFloatingTerminalPanelTabActions(state: PanelState, files: FileActions) {
  const {
    activeGroup,
    activeTab,
    groupTabs,
    activeClosableTab,
    activateTab,
    setActiveTab,
    createTab,
    createBrowserTab,
    closeTab,
    closeBrowserTab,
    closeFile,
    closeUnifiedTab,
    openFile,
    browserDefaultUrl,
    markdownCwd,
    floatingFiles,
    pendingReclaimArmByFileIdRef
  } = state
  const { queueEditorCloseRequests } = files

  const activateFloatingItem = useCallback((visibleId: string) => {
    const item = resolveGroupTabFromVisibleId(groupTabs, visibleId)
    if (!item) return
    activateTab(item.id)
    if (item.contentType === 'terminal') {
      setActiveTab(item.entityId)
      focusTerminalTabSurface(item.entityId)
    } else if (item.contentType === 'browser') {
      const workspace = useAppStore.getState().browserTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID]?.find(
        (tab) => tab.id === item.entityId
      )
      if (workspace?.activePageId && window.api?.browser) {
        void window.api.browser.notifyActiveTabChanged({ browserPageId: workspace.activePageId })
      }
    }
  }, [activateTab, groupTabs, setActiveTab])

  const createFloatingTerminalTab = useCallback((shellOverride?: string) => {
    const tab = createTab(FLOATING_TERMINAL_WORKTREE_ID, activeGroup?.id, shellOverride, { activate: false })
    activateTab(tab.id)
    focusTerminalTabSurface(tab.id)
  }, [activateTab, activeGroup, createTab])

  const createFloatingBrowserTab = useCallback(() => {
    createBrowserTab(FLOATING_TERMINAL_WORKTREE_ID, browserDefaultUrl ?? 'about:blank', {
      title: translate('auto.components.floating.terminal.FloatingTerminalPanel.8b14ba6c17', 'New Browser Tab'),
      focusAddressBar: true,
      targetGroupId: activeGroup?.id,
      browserRuntimeEnvironmentId: null
    })
  }, [activeGroup, browserDefaultUrl, createBrowserTab])

  const createFloatingMarkdownTab = useCallback(() => {
    if (!markdownCwd) return
    void (async () => {
      try {
        const fileInfo = await createUntitledMarkdownFileWithTemplateSelection(
          markdownCwd,
          FLOATING_TERMINAL_WORKTREE_ID,
          getConnectionId(FLOATING_TERMINAL_WORKTREE_ID) ?? undefined,
          LOCAL_RUNTIME_SETTINGS
        )
        if (fileInfo) {
          openFile(fileInfo, { preview: false, targetGroupId: activeGroup?.id, suppressActiveRuntimeFallback: true })
        }
      } catch (error) {
        toast.error(extractIpcErrorMessage(error, 'Failed to create untitled markdown file.'))
      }
    })()
  }, [activeGroup, markdownCwd, openFile])

  const openFloatingMarkdownTab = useCallback(() => {
    void (async () => {
      try {
        const document = await getClientRuntime().app.pickFloatingMarkdownDocument()
        if (!document) return
        openFile({
          filePath: document.filePath,
          relativePath: document.relativePath,
          worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
          language: detectLanguage(document.relativePath),
          mode: 'edit',
          runtimeEnvironmentId: null
        }, { preview: false, targetGroupId: activeGroup?.id, suppressActiveRuntimeFallback: true })
      } catch (error) {
        toast.error(extractIpcErrorMessage(error, 'Failed to open markdown file.'))
      }
    })()
  }, [activeGroup, openFile])

  const closeFloatingItems = useCallback((visibleIds: string[]) => {
    const snapshot = useAppStore.getState()
    const currentGroupTabs = activeGroup
      ? (snapshot.unifiedTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID] ?? []).filter((tab) => tab.groupId === activeGroup.id)
      : (snapshot.unifiedTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID] ?? [])
    const items = visibleIds.map((id) => resolveGroupTabFromVisibleId(currentGroupTabs, id)).filter((item): item is Tab => item !== null && !item.isPinned)
    const dirtyEditorFileIds: string[] = []
    for (const item of items) {
      if (item.contentType === 'terminal') closeTab(item.entityId, { reason: 'cleanup' })
      else if (item.contentType === 'browser') {
        destroyWorkspaceWebviews(snapshot.browserPagesByWorkspace, item.entityId)
        closeBrowserTab(item.entityId)
      } else if (item.contentType === 'simulator') closeUnifiedTab(item.id)
      else {
        const file = snapshot.openFiles.find((candidate) => candidate.id === item.entityId)
        if (file?.isDirty) dirtyEditorFileIds.push(item.entityId)
        else closeFile(item.entityId)
      }
    }
    if (dirtyEditorFileIds.length > 0) queueEditorCloseRequests(dirtyEditorFileIds)
  }, [activeGroup, closeBrowserTab, closeFile, closeTab, closeUnifiedTab, queueEditorCloseRequests])

  const closeFloatingItemConfirmed = useCallback((visibleId: string, options?: { guestOwned?: boolean }) => {
    const item = resolveGroupTabFromVisibleId(groupTabs, visibleId)
    if (!item) return
    const panelOwnedNow = options?.guestOwned === true || isFloatingWorkspacePanelFocused()
    const itemCountBeforeClose = countVisibleFloatingWorkspaceItems(useAppStore.getState())
    const armIfEmptying = () => {
      if (!panelOwnedNow) return
      const itemCountAfterClose = countVisibleFloatingWorkspaceItems(useAppStore.getState())
      if (itemCountAfterClose === 0 && itemCountAfterClose < itemCountBeforeClose) {
        armFloatingPanelReclaimIntent()
      }
    }
    if (item.contentType === 'terminal') {
      closeTerminalTab(item.entityId, { onClosed: armIfEmptying })
      return
    }
    const snapshot = useAppStore.getState()
    guardPinnedTabClose({
      isPinned: item.isPinned === true,
      tabLabel: resolvePinnedTabLabel(snapshot, FLOATING_TERMINAL_WORKTREE_ID, visibleId),
      onClose: () => {
        const latest = useAppStore.getState()
        if (item.contentType === 'browser') {
          destroyWorkspaceWebviews(latest.browserPagesByWorkspace, item.entityId)
          closeBrowserTab(item.entityId)
        } else if (item.contentType === 'simulator') closeUnifiedTab(item.id)
        else {
          const file = latest.openFiles.find((candidate) => candidate.id === item.entityId)
          if (file?.isDirty) {
            pendingReclaimArmByFileIdRef.current.set(item.entityId, armIfEmptying)
            queueEditorCloseRequests([item.entityId])
            return
          }
          closeFile(item.entityId)
        }
        armIfEmptying()
      }
    })
  }, [closeBrowserTab, closeFile, closeUnifiedTab, groupTabs, pendingReclaimArmByFileIdRef, queueEditorCloseRequests])

  const closeOthers = useCallback((visibleId: string) => {
    const snapshot = useAppStore.getState()
    const currentGroupTabs = activeGroup
      ? (snapshot.unifiedTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID] ?? []).filter((tab) => tab.groupId === activeGroup.id)
      : (snapshot.unifiedTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID] ?? [])
    const item = resolveGroupTabFromVisibleId(currentGroupTabs, visibleId)
    if (item) closeFloatingItems(currentGroupTabs.filter((tab) => tab.id !== item.id && !tab.isPinned).map((tab) => tab.id))
  }, [activeGroup, closeFloatingItems])

  const closeToSide = useCallback((visibleId: string, side: 'left' | 'right') => {
    const snapshot = useAppStore.getState()
    const currentGroup = activeGroup ? snapshot.groupsByWorktree[FLOATING_TERMINAL_WORKTREE_ID]?.find((group) => group.id === activeGroup.id) : null
    const currentGroupTabs = currentGroup
      ? (snapshot.unifiedTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID] ?? []).filter((tab) => tab.groupId === currentGroup.id)
      : []
    const item = resolveGroupTabFromVisibleId(currentGroupTabs, visibleId)
    if (!item || !currentGroup) return
    const index = currentGroup.tabOrder.indexOf(item.id)
    if (index === -1) return
    const sideIds = side === 'right' ? currentGroup.tabOrder.slice(index + 1) : currentGroup.tabOrder.slice(0, index)
    const tabById = new Map(currentGroupTabs.map((tab) => [tab.id, tab]))
    closeFloatingItems(sideIds.filter((tabId) => !tabById.get(tabId)?.isPinned))
  }, [activeGroup, closeFloatingItems])

  const closeToRight = useCallback((visibleId: string) => closeToSide(visibleId, 'right'), [closeToSide])
  const closeToLeft = useCallback((visibleId: string) => closeToSide(visibleId, 'left'), [closeToSide])
  const closeAllFiles = useCallback(() => {
    const snapshot = useAppStore.getState()
    const currentGroupTabs = activeGroup
      ? (snapshot.unifiedTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID] ?? []).filter((tab) => tab.groupId === activeGroup.id)
      : (snapshot.unifiedTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID] ?? [])
    closeFloatingItems(currentGroupTabs.filter((tab) => !['terminal', 'browser', 'simulator'].includes(tab.contentType) && !tab.isPinned).map((tab) => tab.id))
  }, [activeGroup, closeFloatingItems])

  return {
    activateFloatingItem, createFloatingTerminalTab, createFloatingBrowserTab,
    createFloatingMarkdownTab, openFloatingMarkdownTab, closeFloatingItems,
    closeFloatingItemConfirmed, closeOthers, closeToSide, closeToRight, closeToLeft, closeAllFiles,
    activeClosableTab, activeTab, floatingFiles
  }
}
