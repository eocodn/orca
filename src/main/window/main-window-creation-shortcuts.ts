import { is } from '@electron-toolkit/utils'
import {
  getWindowShortcutActionId,
  matchesRecentTabSwitcherChord,
  nativeZoomCommandMatchesKeybindings,
  resolveWindowShortcutAction,
  windowShortcutActionCapturesTerminal,
  type WindowShortcutAction
} from '../../shared/window-shortcut-policy'
import {
  ModifierDoubleTapDetector,
  toModifierDoubleTapEvent
} from '../../shared/modifier-double-tap-detector'
import {
  normalizeTerminalShortcutPolicy,
  type KeybindingMatchOptions,
  type KeybindingOverrides
} from '../../shared/keybindings'
import { isMacAppPasteInput } from './main-window-creation'

type ShortcutFocusState = {
  markdownEditorFocused: boolean
  terminalInputFocused: boolean
  floatingTerminalInputFocused: boolean
  floatingPanelFocused: boolean
  shortcutRecorderFocused: boolean
}

type ShortcutLifecycleOptions = {
  mainWindow: Electron.BrowserWindow
  store: any
  getKeybindings?: () => KeybindingOverrides | undefined
  getFocusState: () => ShortcutFocusState
  getIsQuitting?: () => boolean
  onBeforeReload?: (options: { ignoreCache: boolean; webContentsId: number }) => void
}

function sendResolvedWindowShortcutAction(
  mainWindow: Electron.BrowserWindow,
  action: WindowShortcutAction,
  onBeforeReload?: (options: { ignoreCache: boolean; webContentsId: number }) => void
): void {
  switch (action.type) {
    case 'dictationKeyDown':
      mainWindow.webContents.send('ui:dictationKeyDown')
      return
    case 'zoom':
      mainWindow.webContents.send('terminal:zoom', action.direction)
      return
    case 'openSettings':
      mainWindow.webContents.send('ui:openSettings')
      return
    case 'forceReload':
      onBeforeReload?.({ ignoreCache: true, webContentsId: mainWindow.webContents.id })
      mainWindow.webContents.reloadIgnoringCache()
      return
    case 'toggleLeftSidebar':
      mainWindow.webContents.send('ui:toggleLeftSidebar')
      return
    case 'toggleRightSidebar':
      mainWindow.webContents.send('ui:toggleRightSidebar')
      return
    case 'toggleWorktreePalette':
      mainWindow.webContents.send('ui:toggleWorktreePalette')
      return
    case 'toggleFloatingTerminal':
      mainWindow.webContents.send('ui:toggleFloatingTerminal')
      return
    case 'openQuickOpen':
      mainWindow.webContents.send('ui:openQuickOpen')
      return
    case 'toggleQuickCommandsMenu':
      mainWindow.webContents.send('ui:toggleQuickCommandsMenu')
      return
    case 'openNewWorkspace':
      mainWindow.webContents.send('ui:openNewWorkspace')
      return
    case 'deleteCurrentWorkspace':
      mainWindow.webContents.send('ui:deleteCurrentWorkspace')
      return
    case 'openWorkspaceBoard':
      mainWindow.webContents.send('ui:openWorkspaceBoard')
      return
    case 'openTasks':
      mainWindow.webContents.send('ui:openTasks')
      return
    case 'switchRecentTab':
      mainWindow.webContents.send('ui:switchRecentTab')
      return
    case 'jumpToWorktreeIndex':
      mainWindow.webContents.send('ui:jumpToWorktreeIndex', action.index)
      return
    case 'jumpToTabIndex':
      mainWindow.webContents.send('ui:jumpToTabIndex', action.index)
      return
    case 'worktreeHistoryNavigate':
      mainWindow.webContents.send('ui:worktreeHistoryNavigate', action.direction)
  }
}

export function registerMainWindowShortcutLifecycle(options: ShortcutLifecycleOptions): () => void {
  const { mainWindow, store, getFocusState, getKeybindings, getIsQuitting, onBeforeReload } = options
  const doubleTapDetector = new ModifierDoubleTapDetector()

  const dispatch = (
    event: Electron.Event,
    action: WindowShortcutAction,
    context: { isAutoRepeat: boolean; focusedShortcutContext: KeybindingMatchOptions }
  ): boolean => {
    const focus = getFocusState()
    if (
      focus.floatingTerminalInputFocused &&
      (action.type === 'toggleLeftSidebar' || action.type === 'toggleRightSidebar')
    ) {
      return false
    }
    if (
      focus.floatingPanelFocused &&
      (action.type === 'jumpToWorktreeIndex' || action.type === 'jumpToTabIndex')
    ) {
      if (context.isAutoRepeat) {
        event.preventDefault()
        return true
      }
      return false
    }
    const capturedTerminalActionId =
      context.focusedShortcutContext.context === 'terminal' &&
      context.focusedShortcutContext.terminalShortcutPolicy === 'orca-first' &&
      windowShortcutActionCapturesTerminal(action)
        ? getWindowShortcutActionId(action)
        : null
    if (action.type === 'dictationKeyDown') {
      const voiceSettings = store?.getSettings().voice
      if (!voiceSettings?.enabled || !voiceSettings.sttModel || voiceSettings.dictationMode === 'hold') {
        return false
      }
      if (context.isAutoRepeat) {
        event.preventDefault()
        return true
      }
      event.preventDefault()
      if (capturedTerminalActionId) {
        mainWindow.webContents.send('ui:terminalShortcutCaptured', { actionId: capturedTerminalActionId })
      }
      mainWindow.webContents.send('ui:dictationKeyDown')
      return true
    }
    if (action.type === 'toggleQuickCommandsMenu' && context.isAutoRepeat) {
      event.preventDefault()
      return true
    }
    event.preventDefault()
    if (capturedTerminalActionId) {
      mainWindow.webContents.send('ui:terminalShortcutCaptured', { actionId: capturedTerminalActionId })
    }
    sendResolvedWindowShortcutAction(mainWindow, action, onBeforeReload)
    return true
  }

  const onBeforeInput = (event: Electron.Event, input: Electron.Input): void => {
    const focus = getFocusState()
    if (focus.shortcutRecorderFocused) {
      return
    }
    if (input.type === 'keyDown' && is.dev && input.code === 'F12') {
      event.preventDefault()
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools()
      } else {
        mainWindow.webContents.openDevTools({ mode: 'undocked' })
      }
      return
    }
    if (isMacAppPasteInput(input)) {
      event.preventDefault()
      mainWindow.webContents.send('ui:appMenuPaste')
      return
    }
    const keybindings = getKeybindings?.()
    const terminalShortcutContext: KeybindingMatchOptions = {
      context: focus.terminalInputFocused || focus.floatingTerminalInputFocused ? 'terminal' : 'app',
      terminalShortcutPolicy: normalizeTerminalShortcutPolicy(store?.getSettings().terminalShortcutPolicy)
    }
    const appShortcutContext: KeybindingMatchOptions = {
      context: 'app',
      terminalShortcutPolicy: terminalShortcutContext.terminalShortcutPolicy
    }
    if (input.type === 'keyDown' || input.type === 'keyUp') {
      const detected = doubleTapDetector.process(
        toModifierDoubleTapEvent({
          type: input.type,
          code: input.code,
          key: input.key,
          shift: input.shift,
          control: input.control,
          alt: input.alt,
          meta: input.meta,
          isAutoRepeat: input.isAutoRepeat
        }),
        Date.now()
      )
      if (detected) {
        const action = resolveWindowShortcutAction(
          { type: 'keyDown', doubleTapModifier: detected.modifier },
          process.platform,
          keybindings,
          appShortcutContext
        )
        if (action && dispatch(event, action, { isAutoRepeat: false, focusedShortcutContext: terminalShortcutContext })) {
          return
        }
      }
    }
    if (input.type === 'keyDown' && matchesRecentTabSwitcherChord(input, process.platform, keybindings, terminalShortcutContext)) {
      return
    }
    const modForBold = process.platform === 'darwin' ? input.meta : input.control
    if (focus.markdownEditorFocused && input.code === 'KeyB' && !input.alt && !input.shift && modForBold) {
      return
    }
    const action = resolveWindowShortcutAction(input, process.platform, keybindings, terminalShortcutContext)
    if (!action || input.type !== 'keyDown') {
      return
    }
    dispatch(event, action, { isAutoRepeat: Boolean(input.isAutoRepeat), focusedShortcutContext: terminalShortcutContext })
  }

  const onZoomChanged = (event: Electron.Event, zoomDirection: string): void => {
    if (zoomDirection !== 'in' && zoomDirection !== 'out') {
      return
    }
    const focus = getFocusState()
    if (!nativeZoomCommandMatchesKeybindings(zoomDirection, process.platform, getKeybindings?.(), {
      context: focus.terminalInputFocused || focus.floatingTerminalInputFocused ? 'terminal' : 'app',
      terminalShortcutPolicy: normalizeTerminalShortcutPolicy(store?.getSettings().terminalShortcutPolicy)
    })) {
      return
    }
    event.preventDefault()
    mainWindow.webContents.send('terminal:zoom', zoomDirection)
  }
  const onBlur = (): void => doubleTapDetector.reset()

  mainWindow.webContents.on('before-input-event', onBeforeInput)
  mainWindow.webContents.on('zoom-changed', onZoomChanged)
  mainWindow.on('blur', onBlur)
  return () => {
    if (getIsQuitting?.()) {
      doubleTapDetector.reset()
    }
    mainWindow.webContents.removeListener('before-input-event', onBeforeInput)
    mainWindow.webContents.removeListener('zoom-changed', onZoomChanged)
    mainWindow.removeListener('blur', onBlur)
  }
}
