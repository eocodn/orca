import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import {
  isEventTargetInsideFloatingWorkspacePanel,
  isFloatingWorkspaceTerminalInputTarget,
  switchFloatingWorkspaceTab
} from '@/lib/floating-workspace-terminal-actions'
import { isTerminalPaneCloseChord } from '@/components/terminal-pane/terminal-shortcut-policy'
import {
  matchFloatingWorkspacePanelOwnedAction,
  matchFloatingWorkspacePanelShortcut,
  type FloatingWorkspacePanelOwnedAction
} from '@/lib/floating-workspace-shortcut-policy'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import {
  keybindingMatchesAction,
  type KeybindingActionId,
  type KeybindingContext,
  type KeybindingMatchOptions,
  type PhysicalModifierToken
} from '../../../../shared/keybindings'
import { toModifierDoubleTapEvent } from '../../../../shared/modifier-double-tap-detector'
import {
  FLOATING_WORKSPACE_GUEST_CLOSE_EVENT,
  FLOATING_WORKSPACE_GUEST_SELECT_INDEX_EVENT,
  type FloatingWorkspaceGuestCloseDetail,
  type FloatingWorkspaceGuestSelectIndexDetail
} from '@/lib/floating-workspace-guest-bridge'
import { useFloatingTerminalPanelState } from './floating-terminal-panel-state'
import { useFloatingTerminalPanelTabActions } from './floating-terminal-panel-tab-actions'
import { useFloatingTerminalPanelBounds } from './floating-terminal-panel-bounds-actions'
import { useFloatingTerminalPanelFocus } from './floating-terminal-panel-focus'

type PanelState = ReturnType<typeof useFloatingTerminalPanelState>
type TabActions = ReturnType<typeof useFloatingTerminalPanelTabActions>
type BoundsActions = ReturnType<typeof useFloatingTerminalPanelBounds>
type FocusActions = ReturnType<typeof useFloatingTerminalPanelFocus>

type FloatingPanelShortcutInput = Partial<Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>> &
  Pick<KeyboardEvent, 'target'> & { doubleTapModifier?: PhysicalModifierToken }
type FloatingShortcutOutcome = 'handled' | 'deferred' | 'unmatched'
type FloatingPanelShortcutResolution =
  | { kind: 'create'; action: Exclude<FloatingWorkspacePanelOwnedAction, 'tab.close'> }
  | { kind: 'close'; focusedFloatingTerminal: boolean }
  | { kind: 'index'; index: number }
  | { kind: 'chrome'; action: KeybindingActionId }

const FLOATING_TERMINAL_SHORTCUT_SURFACE_SELECTOR = '[data-floating-terminal-shortcut-surface]'

export function useFloatingTerminalPanelShortcuts(
  state: PanelState,
  tabs: TabActions,
  bounds: BoundsActions,
  focus: FocusActions,
  open: boolean,
  onOpenChange: (open: boolean) => void
) {
  const {
    activeTab,
    activeClosableTab,
    activeTerminalId,
    terminalPaneRegistry,
    visibleFloatingTabOrder,
    panelRef,
    doubleTapDetectorRef,
  } = { ...state, open }
  const { toggleMaximized } = bounds
  const { focusPanelForShortcuts } = focus
  const {
    activateFloatingItem,
    closeFloatingItemConfirmed,
    createFloatingBrowserTab,
    createFloatingMarkdownTab,
    createFloatingTerminalTab,
    openFloatingMarkdownTab
  } = tabs

  const closeActiveFloatingTerminalPane = useCallback(() => {
    const handle = activeTerminalId ? terminalPaneRegistry.getHandle(activeTerminalId) : null
    if (handle) {
      handle.closeActivePane()
      return
    }
    if (activeClosableTab) closeFloatingItemConfirmed(activeClosableTab.id)
  }, [activeClosableTab, activeTerminalId, closeFloatingItemConfirmed, terminalPaneRegistry])

  const resolveFloatingPanelShortcut = useCallback((input: FloatingPanelShortcutInput): FloatingPanelShortcutResolution | null => {
    const appState = useAppStore.getState()
    const platform = getShortcutPlatform()
    const terminalShortcutPolicy = appState.settings?.terminalShortcutPolicy
    const isFloatingTerminalInput = isFloatingWorkspaceTerminalInputTarget(input.target)
    const context: KeybindingContext = input.doubleTapModifier ? 'app' : isFloatingTerminalInput ? 'terminal' : 'app'
    const matchOptions: KeybindingMatchOptions = { context, terminalShortcutPolicy }
    const floatingChromeMatchOptions: KeybindingMatchOptions = isFloatingTerminalInput && terminalShortcutPolicy === 'terminal-first'
      ? { context: 'app', terminalShortcutPolicy }
      : matchOptions
    const ownedAction = matchFloatingWorkspacePanelOwnedAction(input, platform, appState.keybindings, matchOptions)
    if (ownedAction !== null && ownedAction !== 'tab.close') return { kind: 'create', action: ownedAction }
    const focusedFloatingTerminal = isFloatingTerminalInput && activeTab?.contentType === 'terminal'
    if (ownedAction === 'tab.close' || (focusedFloatingTerminal && isTerminalPaneCloseChord(input, platform, appState.keybindings, matchOptions, matchOptions))) {
      return { kind: 'close', focusedFloatingTerminal }
    }
    const panelShortcut = matchFloatingWorkspacePanelShortcut(input, platform, appState.keybindings, matchOptions, floatingChromeMatchOptions)
    if (panelShortcut === null) return null
    return panelShortcut.kind === 'index' ? { kind: 'index', index: panelShortcut.index } : { kind: 'chrome', action: panelShortcut.action }
  }, [activeTab])

  const applyFloatingPanelShortcut = useCallback((resolution: FloatingPanelShortcutResolution, input: FloatingPanelShortcutInput, consume: () => void): FloatingShortcutOutcome => {
    if (resolution.kind === 'create') {
      consume()
      if (resolution.action === 'tab.newTerminal') createFloatingTerminalTab()
      else if (resolution.action === 'tab.newBrowser') createFloatingBrowserTab()
      else if (resolution.action === 'tab.newMarkdown') createFloatingMarkdownTab()
      else openFloatingMarkdownTab()
      return 'handled'
    }
    if (resolution.kind === 'close') {
      if (resolution.focusedFloatingTerminal) {
        if (input.doubleTapModifier) {
          consume()
          closeActiveFloatingTerminalPane()
          return 'handled'
        }
        return 'deferred'
      }
      consume()
      if (activeClosableTab) closeFloatingItemConfirmed(activeClosableTab.id)
      else onOpenChange(false)
      return 'handled'
    }
    if (resolution.kind === 'index') {
      consume()
      const visibleId = visibleFloatingTabOrder[resolution.index]
      if (visibleId) activateFloatingItem(visibleId)
      return 'handled'
    }
    if (resolution.action === 'tab.rename') {
      if (!activeTab) return 'unmatched'
      consume()
      useAppStore.getState().setRenamingTabId(activeTab.id)
      return 'handled'
    }
    consume()
    if (resolution.action === 'floatingWorkspace.maximize') toggleMaximized()
    else onOpenChange(false)
    return 'handled'
  }, [activeClosableTab, activeTab, activateFloatingItem, closeActiveFloatingTerminalPane, closeFloatingItemConfirmed, createFloatingBrowserTab, createFloatingMarkdownTab, createFloatingTerminalTab, onOpenChange, openFloatingMarkdownTab, toggleMaximized, visibleFloatingTabOrder])

  const handleFloatingPanelShortcutAction = useCallback((input: FloatingPanelShortcutInput, consume: () => void): FloatingShortcutOutcome => {
    const resolution = resolveFloatingPanelShortcut(input)
    return resolution === null ? 'unmatched' : applyFloatingPanelShortcut(resolution, input, consume)
  }, [applyFloatingPanelShortcut, resolveFloatingPanelShortcut])

  const floatingShortcutListenersRef = useRef({ activateFloatingItem, closeFloatingItemConfirmed, handleFloatingPanelShortcutAction, visibleFloatingTabOrder })
  useEffect(() => {
    floatingShortcutListenersRef.current = { activateFloatingItem, closeFloatingItemConfirmed, handleFloatingPanelShortcutAction, visibleFloatingTabOrder }
  }, [activateFloatingItem, closeFloatingItemConfirmed, handleFloatingPanelShortcutAction, visibleFloatingTabOrder])

  const handleShortcutSurfaceKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!open || event.defaultPrevented || event.repeat) return
    const target = event.target
    if (!(target instanceof HTMLElement) || (target !== panelRef.current && target.closest(FLOATING_TERMINAL_SHORTCUT_SURFACE_SELECTOR) === null)) return
    const resolution = resolveFloatingPanelShortcut(event.nativeEvent)
    if (resolution !== null) applyFloatingPanelShortcut(resolution, event.nativeEvent, () => event.preventDefault())
  }, [applyFloatingPanelShortcut, open, panelRef, resolveFloatingPanelShortcut])

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const isPanelFocused = () => {
      const panel = panelRef.current
      const active = document.activeElement
      return Boolean(panel && active instanceof HTMLElement && panel.contains(active))
    }
    const handleFloatingPanelKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (!isEventTargetInsideFloatingWorkspacePanel(event.target) && !isPanelFocused()) {
        doubleTapDetectorRef.current?.reset()
        return
      }
      const detected = doubleTapDetectorRef.current?.process(toModifierDoubleTapEvent({ type: 'keyDown', code: event.code, key: event.key, shift: event.shiftKey, control: event.ctrlKey, alt: event.altKey, meta: event.metaKey, isAutoRepeat: event.repeat }), Date.now())
      if (event.repeat) return
      const appState = useAppStore.getState()
      const context: KeybindingContext = isFloatingWorkspaceTerminalInputTarget(event.target) ? 'terminal' : 'app'
      const matches = (actionId: KeybindingActionId) => keybindingMatchesAction(actionId, event, getShortcutPlatform(), appState.keybindings, { context, terminalShortcutPolicy: appState.settings?.terminalShortcutPolicy })
      const consume = () => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation() }
      const dispatchShortcut = floatingShortcutListenersRef.current.handleFloatingPanelShortcutAction
      if (detected && dispatchShortcut({ doubleTapModifier: detected.modifier, target: event.target }, consume) !== 'unmatched') return
      if (dispatchShortcut(event, consume) !== 'unmatched') return
      const sameTypeDirection = matches('tab.nextSameType') ? 1 : matches('tab.previousSameType') ? -1 : null
      const allTypesDirection = matches('tab.nextAllTypes') ? 1 : matches('tab.previousAllTypes') ? -1 : null
      if (sameTypeDirection !== null || allTypesDirection !== null) {
        consume()
        switchFloatingWorkspaceTab(useAppStore.getState(), allTypesDirection ?? sameTypeDirection ?? 1, allTypesDirection !== null ? 'all-types' : 'same-type')
        return
      }
      const terminalDirection = matches('tab.nextTerminal') ? 1 : matches('tab.previousTerminal') ? -1 : null
      if (terminalDirection !== null) {
        consume()
        switchFloatingWorkspaceTab(useAppStore.getState(), terminalDirection, 'terminal')
      }
    }
    const handleFloatingPanelKeyUp = (event: KeyboardEvent) => {
      if (!isPanelFocused()) {
        doubleTapDetectorRef.current?.reset()
        return
      }
      doubleTapDetectorRef.current?.process(toModifierDoubleTapEvent({ type: 'keyUp', code: event.code, key: event.key, shift: event.shiftKey, control: event.ctrlKey, alt: event.altKey, meta: event.metaKey }), Date.now())
    }
    const handleFloatingPanelBlur = () => doubleTapDetectorRef.current?.reset()
    window.addEventListener('keydown', handleFloatingPanelKeyDown, { capture: true })
    window.addEventListener('keyup', handleFloatingPanelKeyUp, { capture: true })
    window.addEventListener('blur', handleFloatingPanelBlur)
    return () => {
      window.removeEventListener('keydown', handleFloatingPanelKeyDown, { capture: true })
      window.removeEventListener('keyup', handleFloatingPanelKeyUp, { capture: true })
      window.removeEventListener('blur', handleFloatingPanelBlur)
      doubleTapDetectorRef.current?.reset()
    }
  }, [doubleTapDetectorRef, open, panelRef])

  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    const handleGuestClose = (event: Event) => {
      const detail = (event as CustomEvent<FloatingWorkspaceGuestCloseDetail>).detail
      if (detail) floatingShortcutListenersRef.current.closeFloatingItemConfirmed(detail.sourceId, { guestOwned: true })
    }
    const handleGuestSelectIndex = (event: Event) => {
      const detail = (event as CustomEvent<FloatingWorkspaceGuestSelectIndexDetail>).detail
      const visibleId = detail ? floatingShortcutListenersRef.current.visibleFloatingTabOrder[detail.index] : undefined
      if (visibleId) floatingShortcutListenersRef.current.activateFloatingItem(visibleId)
    }
    window.addEventListener(FLOATING_WORKSPACE_GUEST_CLOSE_EVENT, handleGuestClose)
    window.addEventListener(FLOATING_WORKSPACE_GUEST_SELECT_INDEX_EVENT, handleGuestSelectIndex)
    return () => {
      window.removeEventListener(FLOATING_WORKSPACE_GUEST_CLOSE_EVENT, handleGuestClose)
      window.removeEventListener(FLOATING_WORKSPACE_GUEST_SELECT_INDEX_EVENT, handleGuestSelectIndex)
    }
  }, [open])

  return { closeActiveFloatingTerminalPane, resolveFloatingPanelShortcut, applyFloatingPanelShortcut, handleFloatingPanelShortcutAction, floatingShortcutListenersRef, handleShortcutSurfaceKeyDown }
}
