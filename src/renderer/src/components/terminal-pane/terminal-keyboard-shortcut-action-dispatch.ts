import type { ManagedPane, PaneManager } from '@/lib/pane-manager/pane-manager'
import {
  markTerminalFollowOutput,
  markTerminalPinnedViewport,
  syncTerminalScrollIntentFromViewport
} from '@/lib/pane-manager/terminal-scroll-intent'
import { useAppStore } from '@/store'
import type { TerminalShortcutAction } from './terminal-shortcut-policy'
import { copyTerminalSelection } from './terminal-selection-copy'
import { splitTerminalPaneWithInheritedCwd } from './terminal-pane-split-with-inherited-cwd'
import type { PaneCwdMap } from './resolve-split-cwd'
import type { PtyTransport } from './pty-transport'

export type TerminalKeyboardShortcutActionHandlers = {
  managerRef: React.RefObject<PaneManager | null>
  paneTransportsRef: React.RefObject<Map<number, PtyTransport>>
  paneCwdRef: React.RefObject<PaneCwdMap>
  fallbackCwd: string
  expandedPaneIdRef: React.RefObject<number | null>
  setExpandedPane: (paneId: number | null) => void
  restoreExpandedLayout: () => void
  refreshPaneSizes: (focusActive: boolean) => void
  persistLayoutSnapshot: () => void
  toggleExpandPane: (paneId: number) => void
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  onRequestClosePane: (paneId: number) => void
  onClearPaneScrollback: (pane: ManagedPane) => void
  onSetTitle: (paneId: number) => void
  onClearPaneTitle: (paneId: number) => void
}

export function dispatchTerminalKeyboardShortcutAction(
  event: KeyboardEvent,
  action: Exclude<TerminalShortcutAction, { type: 'sendInput' } | { type: 'switchInputSource' }>,
  manager: PaneManager,
  handlers: TerminalKeyboardShortcutActionHandlers
): void {
  if (event.repeat) {
    return
  }

  if (action.type === 'copySelection') {
    const pane = manager.getActivePane() ?? manager.getPanes()[0]
    if (!pane || !pane.terminal.getSelection()) {
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    void copyTerminalSelection({
      terminal: pane.terminal,
      writeClipboardText: window.api.ui.writeTerminalClipboardText
    }).catch(() => {
      /* Clipboard failures do not change terminal shortcut routing. */
    })
    return
  }

  if (action.type === 'toggleSearch') {
    event.preventDefault()
    event.stopImmediatePropagation()
    handlers.setSearchOpen((previous) => !previous)
    return
  }

  if (action.type === 'clearActivePane') {
    event.preventDefault()
    event.stopImmediatePropagation()
    const pane = manager.getActivePane() ?? manager.getPanes()[0]
    if (pane) {
      handlers.onClearPaneScrollback(pane)
    }
    return
  }

  if (action.type === 'scrollViewport') {
    event.preventDefault()
    event.stopImmediatePropagation()
    const pane = manager.getActivePane() ?? manager.getPanes()[0]
    if (!pane) {
      return
    }
    if (action.position === 'top') {
      markTerminalPinnedViewport(pane.terminal)
      pane.terminal.scrollToLine(0)
    } else {
      markTerminalFollowOutput(pane.terminal)
      pane.terminal.scrollToBottom()
    }
    syncTerminalScrollIntentFromViewport(pane.terminal)
    return
  }

  if (action.type === 'focusPane') {
    const panes = manager.getPanes()
    if (panes.length < 2) {
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    if (handlers.expandedPaneIdRef.current !== null) {
      handlers.setExpandedPane(null)
      handlers.restoreExpandedLayout()
      handlers.refreshPaneSizes(true)
      handlers.persistLayoutSnapshot()
    }
    const activeId = manager.getActivePane()?.id ?? panes[0].id
    const currentIdx = panes.findIndex((pane) => pane.id === activeId)
    if (currentIdx === -1) {
      return
    }
    const direction = action.direction === 'next' ? 1 : -1
    const nextPane = panes[(currentIdx + direction + panes.length) % panes.length]
    manager.setActivePane(nextPane.id, { focus: true })
    return
  }

  if (action.type === 'equalizePaneSizes') {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (handlers.expandedPaneIdRef.current !== null) {
      return
    }
    manager.equalizePaneSizes()
    const paneToFocus = manager.getActivePane() ?? manager.getPanes()[0]
    paneToFocus?.terminal.focus()
    return
  }

  if (action.type === 'toggleExpandActivePane') {
    const panes = manager.getPanes()
    if (panes.length < 2) {
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    const pane = manager.getActivePane() ?? panes[0]
    if (pane) {
      handlers.toggleExpandPane(pane.id)
    }
    return
  }

  if (action.type === 'setTitle' || action.type === 'clearPaneTitle') {
    event.preventDefault()
    event.stopImmediatePropagation()
    const pane = manager.getActivePane() ?? manager.getPanes()[0]
    if (!pane) {
      return
    }
    if (action.type === 'setTitle') {
      handlers.onSetTitle(pane.id)
    } else {
      handlers.onClearPaneTitle(pane.id)
    }
    return
  }

  if (action.type === 'closeActivePane') {
    event.preventDefault()
    event.stopImmediatePropagation()
    const pane = manager.getActivePane() ?? manager.getPanes()[0]
    if (pane) {
      handlers.onRequestClosePane(pane.id)
    }
    return
  }

  if (action.type === 'splitActivePane') {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (handlers.expandedPaneIdRef.current !== null) {
      handlers.setExpandedPane(null)
      handlers.restoreExpandedLayout()
      handlers.refreshPaneSizes(true)
      handlers.persistLayoutSnapshot()
    }
    const pane = manager.getActivePane() ?? manager.getPanes()[0]
    if (!pane) {
      return
    }
    splitTerminalPaneWithInheritedCwd({
      manager,
      getManager: () => handlers.managerRef.current,
      paneTransports: handlers.paneTransportsRef.current,
      paneCwdMap: handlers.paneCwdRef.current,
      fallbackCwd: handlers.fallbackCwd,
      pane,
      direction: action.direction,
      source: getKeyboardSplitTelemetrySource()
    })
  }
}

function getKeyboardSplitTelemetrySource(): 'contextual_tour' | 'keyboard' {
  return useAppStore.getState().activeContextualTourId === 'workspace-agent-sessions'
    ? 'contextual_tour'
    : 'keyboard'
}
