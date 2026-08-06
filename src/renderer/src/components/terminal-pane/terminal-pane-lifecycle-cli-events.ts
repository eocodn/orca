import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { useAppStore } from '@/store'
import {
  CLOSE_TERMINAL_PANE_EVENT,
  SPLIT_TERMINAL_PANE_EVENT,
  type CloseTerminalPaneDetail,
  type SplitTerminalPaneDetail
} from '@/constants/terminal'
import { closeTerminalTab } from '../terminal/terminal-tab-actions'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { scheduleRuntimeGraphSync } from '@/runtime/sync-runtime-graph'
import type { TerminalPaneLifecycleContext } from './terminal-pane-lifecycle-contracts'
import {
  applyTerminalPaneCloseRequest,
  recordRuntimeCreatedTerminalPaneSplit,
  splitPaneWithOneShotStartup
} from './terminal-pane-lifecycle-support'

export function registerTerminalPaneCliEvents(
  context: TerminalPaneLifecycleContext,
  manager: PaneManager
): () => void {
  const { deps: d, ptyDeps } = context
  const onCliSplitPane = (event: Event): void => {
    const detail = (event as CustomEvent<SplitTerminalPaneDetail>).detail
    if (!detail?.tabId || detail.tabId !== d.tabId) {
      return
    }
    const currentManager = d.managerRef.current
    if (
      !currentManager ||
      (detail.newLeafId && currentManager.getNumericIdForLeaf(detail.newLeafId) !== null)
    ) {
      return
    }
    const sourcePaneId = detail.sourceLeafId
      ? (currentManager.getNumericIdForLeaf(detail.sourceLeafId) ?? detail.paneRuntimeId)
      : detail.paneRuntimeId
    if (sourcePaneId < 0) {
      return
    }
    const splitOptions = {
      ...(detail.newLeafId ? { leafId: detail.newLeafId } : {}),
      ...(detail.ptyId ? { ptyId: detail.ptyId } : {})
    }
    const createPane = (): ReturnType<PaneManager['splitPane']> =>
      currentManager.splitPane(sourcePaneId, detail.direction, splitOptions)
    const createdPane = detail.command
      ? splitPaneWithOneShotStartup(ptyDeps, { command: detail.command }, createPane)
      : createPane()
    recordRuntimeCreatedTerminalPaneSplit(createdPane, {
      source: detail.telemetrySource ?? 'command',
      direction: detail.direction
    })
  }
  const onCliClosePane = (event: Event): void => {
    const detail = (event as CustomEvent<CloseTerminalPaneDetail>).detail
    if (!detail?.tabId || detail.tabId !== d.tabId) {
      return
    }
    const currentManager = d.managerRef.current
    if (!currentManager) {
      return
    }
    const result = applyTerminalPaneCloseRequest({
      detail,
      manager: currentManager,
      getPtyIdForLeaf: (leafId) =>
        useAppStore.getState().terminalLayoutsByTabId[d.tabId]?.ptyIdsByLeafId?.[leafId],
      closeTab: () => closeTerminalTab(d.tabId),
      closeTabPreservingPty: () => {
        const store = useAppStore.getState()
        if (detail.retireSurface && detail.leafId) {
          store.retireAgentPaneAuthority(makePaneKey(d.tabId, detail.leafId), {
            preserveSleepingAgentSession: true
          })
        }
        store.closeTab(d.tabId, { reason: 'pty-exit', captureRecentlyClosed: false })
      }
    })
    if (result !== 'pane') {
      return
    }
    scheduleRuntimeGraphSync()
    context.syncCanExpandState()
    context.queueResizeAll(d.isActive)
    d.persistLayoutSnapshot()
  }
  window.addEventListener(SPLIT_TERMINAL_PANE_EVENT, onCliSplitPane)
  window.addEventListener(CLOSE_TERMINAL_PANE_EVENT, onCliClosePane)

  return () => {
    window.removeEventListener(SPLIT_TERMINAL_PANE_EVENT, onCliSplitPane)
    window.removeEventListener(CLOSE_TERMINAL_PANE_EVENT, onCliClosePane)
    // Why: caller retains manager identity; event handlers resolve the current manager to reject stale callbacks.
    void manager
  }
}
