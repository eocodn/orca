/** Installs keyboard handling in one ordered scope so terminal actions do not race. */
import { useEffect } from 'react'
import type { IDisposable } from '@xterm/xterm'
import type { ManagedPane, PaneManager } from '@/lib/pane-manager/pane-manager'
import type { PtyTransport } from './pty-transport'
import { resolveTerminalKeyboardShortcutAction } from './terminal-keyboard-shortcut-resolution'
import type { SearchState } from './terminal-keyboard-search-shortcuts'
import {
  getSelectedTerminalFileSearchText,
  matchFileSearchShortcut,
  matchSearchNavigate,
  runTerminalSearchNavigation
} from './terminal-keyboard-search-shortcuts'
import { createTerminalNativeOnlyShortcutTracker } from './terminal-native-only-shortcut'
import {
  createTerminalImeDeferredNewlineSender,
  createTerminalImeModifiedEnterChordOwner,
  getTerminalImeModifiedEnterKind,
  isTerminalImeEnterKeyUp,
  isTerminalImeProcessEnter
} from './terminal-ime-deferred-newline'
import { hasPendingTerminalImeComposition } from './terminal-ime-composition-route'
import {
  requestCapturedTerminalReconfirmation,
  sendCapturedTerminalInput
} from './terminal-captured-input-dispatch'
import {
  type KeybindingOverrides,
  type KeybindingPlatform,
  type TerminalShortcutPolicy
} from '../../../../shared/keybindings'
import type { MacOptionAsAlt } from './terminal-shortcut-policy'
import type { PaneCwdMap } from './resolve-split-cwd'
import type { TerminalKittyKeyboardModeTracker } from '../../../../shared/terminal-kitty-keyboard-mode-tracker'
import { keyboardEventBelongsToScope } from './terminal-keyboard-scope'
import {
  getLayoutBaseCharacterForCode,
  prefetchLayoutBaseCharacters
} from '@/lib/keyboard-layout/layout-base-character'
import { handleEmptyFloatingWorkspacePanelCloseShortcut } from '@/lib/floating-workspace-terminal-actions'
import { useAppStore } from '@/store'
import { recordTerminalUserInputForLeaf } from './terminal-input-activity'
import { isLocalWindowsConptyPaneForCtrlArrow } from './terminal-ctrl-arrow-conpty'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { resolveWindowsShiftEnterEncodingForPane } from './terminal-windows-shift-enter'
import { resolveTerminalInputHostPlatform } from './terminal-input-host-platform'
import {
  dispatchTerminalKeyboardShortcutAction,
  type TerminalKeyboardShortcutActionHandlers
} from './terminal-keyboard-shortcut-action-dispatch'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  // xterm.js focuses a hidden <textarea class="xterm-helper-textarea"> for
  // keyboard input.  That element IS an editable target, but we must NOT
  // suppress terminal shortcuts when the terminal itself is focused.
  if (target.classList.contains('xterm-helper-textarea')) {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  const editableAncestor = target.closest(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"]'
  )
  return editableAncestor !== null
}

export type KeyboardHandlersDeps = {
  tabId: string
  worktreeId: string
  isActive: boolean
  keyboardScopeRef: React.RefObject<HTMLElement | null>
  managerRef: React.RefObject<PaneManager | null>
  paneTransportsRef: React.RefObject<Map<number, PtyTransport>>
  panePtyBindingsRef: React.RefObject<Map<number, IDisposable>>
  paneCwdRef: React.RefObject<PaneCwdMap>
  /** Worktree-root cwd used when OSC 7 and pty.getCwd both fail. */
  fallbackCwd: string
  expandedPaneIdRef: React.RefObject<number | null>
  setExpandedPane: (paneId: number | null) => void
  restoreExpandedLayout: () => void
  refreshPaneSizes: (focusActive: boolean) => void
  persistLayoutSnapshot: () => void
  toggleExpandPane: (paneId: number) => void
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  onSearchSelectedText: (text: string) => void
  onRequestClosePane: (paneId: number) => void
  onClearPaneScrollback: (pane: ManagedPane) => void
  onSetTitle: (paneId: number) => void
  onClearPaneTitle: (paneId: number) => void
  searchOpenRef: React.RefObject<boolean>
  searchStateRef: React.RefObject<SearchState>
  macOptionAsAltRef: React.RefObject<MacOptionAsAlt>
  paneKittyKeyboardModesRef?: React.RefObject<Map<number, TerminalKittyKeyboardModeTracker>>
  keybindings?: KeybindingOverrides
  terminalShortcutPolicy?: TerminalShortcutPolicy
}

/**
 * Installs terminal-pane shortcuts on the tab keyboard scope.
 * Uses the shared shortcut policy before forwarding unmatched input to xterm
 * so configurable Orca actions remain consistent across local and SSH panes.
 */
export function useTerminalKeyboardShortcuts({
  tabId,
  worktreeId,
  isActive,
  keyboardScopeRef,
  managerRef,
  paneTransportsRef,
  panePtyBindingsRef,
  paneCwdRef,
  fallbackCwd,
  expandedPaneIdRef,
  setExpandedPane,
  restoreExpandedLayout,
  refreshPaneSizes,
  persistLayoutSnapshot,
  toggleExpandPane,
  setSearchOpen,
  onSearchSelectedText,
  onRequestClosePane,
  onClearPaneScrollback,
  onSetTitle,
  onClearPaneTitle,
  searchOpenRef,
  searchStateRef,
  macOptionAsAltRef,
  paneKittyKeyboardModesRef,
  keybindings,
  terminalShortcutPolicy = 'orca-first'
}: KeyboardHandlersDeps): void {
  useEffect(() => {
    if (!isActive) {
      return
    }

    const isMac = navigator.userAgent.includes('Mac')
    const isWindows = navigator.userAgent.includes('Windows')
    const shortcutPlatform: KeybindingPlatform = isMac ? 'darwin' : isWindows ? 'win32' : 'linux'

    // Why: kitty Option-chord encoding resolves base keys through the async
    // KeyboardLayoutMap; prefetch so the map is cached before the first chord.
    if (isMac) {
      prefetchLayoutBaseCharacters()
    }

    // Why: KeyboardEvent.location on a character key (e.g. Period) always
    // reports that key's own position (0 = standard), not which modifier is
    // held. To distinguish left vs right Option, we record the Option key's
    // location from its own keydown event and clear it on keyup.
    let optionKeyLocation = 0
    const heldImeEnterModifiers = new Set<'shift' | 'ctrl'>()
    const nativeOnlyShortcutTracker = createTerminalNativeOnlyShortcutTracker()
    const deferredNewlineSender = createTerminalImeDeferredNewlineSender()
    const modifiedEnterChordOwner = createTerminalImeModifiedEnterChordOwner()
    const getHeldImeEnterModifier = () =>
      heldImeEnterModifiers.size === 1
        ? (heldImeEnterModifiers.values().next().value ?? null)
        : null
    const getImeEnterModifier = (event: KeyboardEvent) => {
      const eventKind = getTerminalImeModifiedEnterKind(event)
      if (eventKind || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
        return eventKind
      }
      return getHeldImeEnterModifier()
    }
    const getModifiedEnterChord = (event: KeyboardEvent) => {
      const kind = getImeEnterModifier(event)
      return kind ? { kind, code: event.code, timeStamp: event.timeStamp } : null
    }
    const onModifierDown = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') {
        optionKeyLocation = e.location
      }
      if (isWindows && (e.key === 'Shift' || e.key === 'Control')) {
        const manager = managerRef.current
        const keyboardScope = keyboardScopeRef.current
        const pane = manager?.getActivePane() ?? manager?.getPanes()[0]
        if (
          pane &&
          (!keyboardScope || keyboardEventBelongsToScope(e, keyboardScope)) &&
          !isEditableTarget(e.target)
        ) {
          heldImeEnterModifiers.add(e.key === 'Shift' ? 'shift' : 'ctrl')
        }
      }
    }

    // Why: this callback is installed once per active tab and invoked only for
    // Windows Shift+Enter, keeping store work and allocations off ordinary keys.
    const getActivePaneWindowsShiftEnterEncoding = () => {
      const manager = managerRef.current
      const activePane = manager?.getActivePane() ?? manager?.getPanes()[0]
      if (!activePane) {
        return 'alt-enter' as const
      }
      const state = useAppStore.getState()
      const paneKey = makePaneKey(tabId, activePane.leafId)
      return resolveWindowsShiftEnterEncodingForPane(state, paneKey)
    }

    // Why: host metadata is live and can hydrate after the terminal mounts;
    // resolve it only when Shift+Enter needs to choose a byte protocol.
    const isActivePaneWindowsTerminalHost = (): boolean => {
      const manager = managerRef.current
      const activePane = manager?.getActivePane() ?? manager?.getPanes()[0]
      return (
        resolveTerminalInputHostPlatform({
          clientPlatform: shortcutPlatform,
          state: useAppStore.getState(),
          worktreeId,
          transport: activePane ? (paneTransportsRef.current.get(activePane.id) ?? null) : null
        }) === 'win32'
      )
    }

    // Why: the active pane's live PTY session decides whether Ctrl+Arrow should
    // pass through as native \e[1;5C/\e[1;5D or be translated to \eb/\ef.
    // Resolved lazily so session/runtime lookups stay off other keystrokes.
    const isLocalWindowsConptyPane = (): boolean => {
      const manager = managerRef.current
      const activePane = manager?.getActivePane() ?? manager?.getPanes()[0]
      if (!activePane) {
        return false
      }
      const storeState = useAppStore.getState()
      return isLocalWindowsConptyPaneForCtrlArrow({
        isWindows,
        userAgent: navigator.userAgent,
        state: storeState,
        worktreeId,
        tabId,
        paneId: activePane.id,
        paneCwd: paneCwdRef.current,
        fallbackCwd,
        transport: paneTransportsRef.current.get(activePane.id) ?? null
      })
    }

    // Why: the pane's TUI opted into kitty keyboard reporting via CSI > u;
    // the tracker mirrors that from PTY output so the policy can encode
    // Option chords the way the application negotiated.
    const isKittyKeyboardActivePane = (): boolean => {
      const manager = managerRef.current
      const activePane = manager?.getActivePane() ?? manager?.getPanes()[0]
      if (!activePane) {
        return false
      }
      return (paneKittyKeyboardModesRef?.current.get(activePane.id)?.flags ?? 0) > 0
    }

    const resolveShortcutEvent = (
      event: Parameters<typeof resolveTerminalKeyboardShortcutAction>[0]
    ): ReturnType<typeof resolveTerminalKeyboardShortcutAction> =>
      resolveTerminalKeyboardShortcutAction(
        event,
        isMac,
        macOptionAsAltRef.current,
        optionKeyLocation,
        isWindows,
        keybindings,
        isLocalWindowsConptyPane,
        isKittyKeyboardActivePane,
        getLayoutBaseCharacterForCode,
        getActivePaneWindowsShiftEnterEncoding,
        isActivePaneWindowsTerminalHost,
        terminalShortcutPolicy
      )

    const createCapturedInputSender = (
      pane: { id: number; leafId: string },
      data: string
    ): (() => void) => {
      const capturedTransport = paneTransportsRef.current.get(pane.id)
      const capturedPtyId = capturedTransport?.getPtyId() ?? null
      const capturedBinding = panePtyBindingsRef.current.get(pane.id) as
        | (IDisposable & { requestDroidReconfirmation?: () => void })
        | undefined
      const getCurrentManager = () => managerRef.current
      const getCurrentTransport = () => paneTransportsRef.current.get(pane.id)
      const getCurrentBinding = () => panePtyBindingsRef.current.get(pane.id)
      return () => {
        const targetPaneMounted =
          getCurrentManager()
            ?.getPanes()
            .some((candidate) => candidate.id === pane.id && candidate.leafId === pane.leafId) ===
          true
        const sent = sendCapturedTerminalInput({
          targetPaneMounted,
          currentTransport: getCurrentTransport(),
          capturedTransport,
          capturedPtyId,
          data
        })
        if (sent) {
          recordTerminalUserInputForLeaf(tabId, pane.leafId)
          if (data === '\x1b[13;2u') {
            // Why: this write bypasses PTY onData, so no-OSC shells need reconfirmation.
            requestCapturedTerminalReconfirmation(getCurrentBinding(), capturedBinding)
          }
        }
      }
    }

    const actionHandlers: TerminalKeyboardShortcutActionHandlers = {
      managerRef,
      paneTransportsRef,
      paneCwdRef,
      fallbackCwd,
      expandedPaneIdRef,
      setExpandedPane,
      restoreExpandedLayout,
      refreshPaneSizes,
      persistLayoutSnapshot,
      toggleExpandPane,
      setSearchOpen,
      onRequestClosePane,
      onClearPaneScrollback,
      onSetTitle,
      onClearPaneTitle
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      // Why: replace stale state only for this physical key so rollover cannot
      // disarm a still-held native-only chord before its Kitty keyup arrives.
      nativeOnlyShortcutTracker.prepareKeyDown(e)
      const manager = managerRef.current
      if (!manager) {
        return
      }
      const keyboardScope = keyboardScopeRef.current
      if (keyboardScope && !keyboardEventBelongsToScope(e, keyboardScope)) {
        return
      }

      const modifiedEnterChord = isWindows ? getModifiedEnterChord(e) : null
      if (
        e.key === 'Enter' &&
        e.keyCode === 13 &&
        !e.isComposing &&
        ((modifiedEnterChord && modifiedEnterChordOwner.absorb(modifiedEnterChord)) ||
          deferredNewlineSender.absorbRedispatchedEnter(e))
      ) {
        // Chromium can drop the modifier when re-dispatching the committing Enter.
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }

      if (matchFileSearchShortcut(e, shortcutPlatform, keybindings, terminalShortcutPolicy)) {
        const pane = manager.getActivePane() ?? manager.getPanes()[0]
        const selectedText = getSelectedTerminalFileSearchText(pane)
        if (selectedText) {
          e.preventDefault()
          e.stopImmediatePropagation()
          onSearchSelectedText(selectedText)
          return
        }
      }

      // Cmd+G / Cmd+Shift+G navigates terminal search matches even when focus
      // is inside the search input itself, so this check must run before the
      // editable-target guard would otherwise bypass all terminal shortcuts.
      // stopImmediatePropagation prevents App.tsx's Cmd+Shift+G (source-control sidebar) from also firing.
      const direction = matchSearchNavigate(e, isMac, searchOpenRef.current, searchStateRef.current)
      if (direction !== null) {
        if (e.repeat) {
          return
        }
        e.preventDefault()
        e.stopImmediatePropagation()
        const pane = manager.getActivePane() ?? manager.getPanes()[0]
        if (!pane) {
          return
        }
        runTerminalSearchNavigation(pane, direction, searchStateRef.current)
        pane.terminal.focus()
        return
      }

      if (isEditableTarget(e.target)) {
        return
      }

      if (handleEmptyFloatingWorkspacePanelCloseShortcut(e, shortcutPlatform, keybindings)) {
        return
      }

      const terminalPaneForImeShortcut = manager.getActivePane() ?? manager.getPanes()[0]
      const hasPendingImeComposition = hasPendingTerminalImeComposition(
        terminalPaneForImeShortcut?.terminal.element
      )
      const imeProcessEnter = isWindows && hasPendingImeComposition && isTerminalImeProcessEnter(e)
      const shortcutEvent = imeProcessEnter
        ? {
            key: 'Enter',
            code: e.code,
            metaKey: e.metaKey,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
            shiftKey: e.shiftKey,
            repeat: e.repeat
          }
        : e
      const action = resolveShortcutEvent(shortcutEvent)
      if (!action) {
        return
      }

      if (action.type === 'switchInputSource') {
        // Why: the OS must receive its default action, while xterm must receive
        // none of the keydown, keypress, or keyup sequence.
        nativeOnlyShortcutTracker.armKeyDown(e)
        e.stopImmediatePropagation()
        return
      }

      if (action.type === 'sendInput') {
        e.preventDefault()
        e.stopImmediatePropagation()
        const pane = manager.getActivePane() ?? manager.getPanes()[0]
        if (!pane) {
          return
        }
        const sendResolvedInput = createCapturedInputSender(pane, action.data)
        if ((e.isComposing || hasPendingImeComposition) && (e.key === 'Enter' || imeProcessEnter)) {
          if (isWindows) {
            const chord = getModifiedEnterChord(e)
            if (chord && !modifiedEnterChordOwner.claim(chord)) {
              return
            }
          }
          deferredNewlineSender.defer(e, pane.terminal.element, sendResolvedInput)
          return
        }
        sendResolvedInput()
        return
      }

      if (action.type !== 'switchInputSource' && action.type !== 'sendInput') {
        dispatchTerminalKeyboardShortcutAction(e, action, manager, actionHandlers)
      }
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') {
        optionKeyLocation = 0
      }
      const releasedImeEnterModifier =
        e.key === 'Shift' ? 'shift' : e.key === 'Control' ? 'ctrl' : null
      if (releasedImeEnterModifier) {
        const kind = releasedImeEnterModifier
        heldImeEnterModifiers.delete(kind)
        modifiedEnterChordOwner.release({ kind, code: e.code, timeStamp: e.timeStamp })
      }
      if (e.key !== 'Enter') {
        return
      }

      const modifiedEnterKind = getImeEnterModifier(e)
      if (isWindows && modifiedEnterKind && isTerminalImeEnterKeyUp(e)) {
        const chord = { kind: modifiedEnterKind, code: e.code, timeStamp: e.timeStamp }
        if (modifiedEnterChordOwner.absorb(chord)) {
          modifiedEnterChordOwner.release(chord)
          e.preventDefault()
          e.stopImmediatePropagation()
          deferredNewlineSender.releaseRedispatchedEnter(e)
          return
        }

        const manager = managerRef.current
        const keyboardScope = keyboardScopeRef.current
        if (
          manager &&
          !isEditableTarget(e.target) &&
          (!keyboardScope || keyboardEventBelongsToScope(e, keyboardScope))
        ) {
          const pane = manager.getActivePane() ?? manager.getPanes()[0]
          if (pane && hasPendingTerminalImeComposition(pane.terminal.element)) {
            const action = resolveShortcutEvent({
              key: 'Enter',
              code: e.code,
              metaKey: false,
              ctrlKey: modifiedEnterKind === 'ctrl',
              altKey: false,
              shiftKey: modifiedEnterKind === 'shift',
              repeat: false
            })
            if (action?.type === 'sendInput') {
              e.preventDefault()
              e.stopImmediatePropagation()
              deferredNewlineSender.defer(
                e,
                pane.terminal.element,
                createCapturedInputSender(pane, action.data)
              )
              return
            }
          }
        }
      }

      if (modifiedEnterKind) {
        modifiedEnterChordOwner.release({
          kind: modifiedEnterKind,
          code: e.code,
          timeStamp: e.timeStamp
        })
      }
      deferredNewlineSender.releaseRedispatchedEnter(e)
    }

    const onNativeOnlyShortcutCompanion = (e: KeyboardEvent): void => {
      if (nativeOnlyShortcutTracker.consumeCompanion(e)) {
        // Why: canceling only the companion keypress prevents Chromium's text
        // insertion without canceling the keydown default used by the OS switch.
        if (e.type === 'keypress') {
          e.preventDefault()
        }
        e.stopImmediatePropagation()
      }
    }

    // Why: modern Chromium can skip keypress and insert via beforeinput; block
    // only this chord's text so an IME commit in the same window remains intact.
    const onNativeOnlyBeforeInput = (e: Event): void => {
      if (!(e instanceof InputEvent) || !nativeOnlyShortcutTracker.shouldSuppressBeforeInput(e)) {
        return
      }
      e.preventDefault()
      e.stopImmediatePropagation()
    }

    const onNativeOnlyBlur = (): void => {
      nativeOnlyShortcutTracker.clear()
      heldImeEnterModifiers.clear()
      modifiedEnterChordOwner.clear()
      deferredNewlineSender.clearRedispatchedEnters()
    }

    window.addEventListener('keydown', onModifierDown, { capture: true })
    window.addEventListener('keyup', onKeyUp, { capture: true })
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keypress', onNativeOnlyShortcutCompanion, { capture: true })
    window.addEventListener('keyup', onNativeOnlyShortcutCompanion, { capture: true })
    window.addEventListener('beforeinput', onNativeOnlyBeforeInput, { capture: true })
    window.addEventListener('blur', onNativeOnlyBlur)
    return () => {
      modifiedEnterChordOwner.clear()
      deferredNewlineSender.clearRedispatchedEnters()
      window.removeEventListener('keydown', onModifierDown, { capture: true })
      window.removeEventListener('keyup', onKeyUp, { capture: true })
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('keypress', onNativeOnlyShortcutCompanion, { capture: true })
      window.removeEventListener('keyup', onNativeOnlyShortcutCompanion, { capture: true })
      window.removeEventListener('beforeinput', onNativeOnlyBeforeInput, { capture: true })
      window.removeEventListener('blur', onNativeOnlyBlur)
    }
  }, [
    isActive,
    keyboardScopeRef,
    managerRef,
    paneTransportsRef,
    panePtyBindingsRef,
    paneCwdRef,
    fallbackCwd,
    expandedPaneIdRef,
    setExpandedPane,
    restoreExpandedLayout,
    refreshPaneSizes,
    persistLayoutSnapshot,
    toggleExpandPane,
    setSearchOpen,
    onSearchSelectedText,
    onRequestClosePane,
    onClearPaneScrollback,
    onSetTitle,
    onClearPaneTitle,
    searchOpenRef,
    searchStateRef,
    macOptionAsAltRef,
    paneKittyKeyboardModesRef,
    keybindings,
    terminalShortcutPolicy,
    tabId,
    worktreeId
  ])
}
