import { triggerSelection, triggerError } from '../../../../src/platform/haptics'
import { activateMobileSessionTab } from '../../../../src/session/mobile-session-tab-activation'
import { activateOpenedSourceControlDiffTab } from '../../../../src/session/opened-mobile-session-tab'
import { buildTerminalSendParams, TERMINAL_INPUT_SEND_OPTIONS } from '../../../../src/terminal/terminal-send-request'
import { normalizeTerminalTextInput } from '../../../../src/terminal/terminal-text-input-normalization'
import { sendTerminalLiveAccessoryRawBytes } from '../../../../src/terminal/terminal-live-accessory-raw-send'
import {
  clearTerminalLiveInputFocusTimer,
  focusTerminalLiveInputTarget,
  isTerminalLiveInputWithinByteLimit,
  scheduleTerminalLiveInputFocus
} from '../../../../src/terminal/terminal-live-input'
import { isTerminalSendRpcAccepted } from '../../../../src/terminal/terminal-send-rpc-response'
import { dismissTerminalKeyboard } from '../../../../src/terminal/terminal-keyboard-dismiss'
import { useMobileSessionTabInteractions } from './use-mobile-session-tab-interactions'

type WorkspaceContext = Record<string, any>

type DocumentActions = {
  readFileTab: (...args: any[]) => any
  readMarkdownTab: (...args: any[]) => any
}

export function useMobileSessionWorkspaceTerminalInteractions(
  context: WorkspaceContext,
  { readFileTab, readMarkdownTab }: DocumentActions
) {
  const {
    sessionTabs, terminalDiagnosticsRef, pendingActiveSessionTabIdRef, pendingActiveTerminalHandleRef,
    activeSessionTabTypeRef, defaultTerminalHandlesToLiveInput, setActiveSessionTabId, activeHandleRef,
    setActiveHandle, unsubscribeTerminal, initializedHandlesRef, terminalUnsubsRef, subscribeToTerminal,
    client, worktreeId, markdownDocs, switchSessionTabRef, terminalRefs, terminalGestureInputBucketsRef,
    terminalGestureInputQueuesRef, terminalGestureInputInFlightRef, webReadyHandlesRef,
    measureViewportOnce, activeSessionTab, fileDocs, sendingRef, canSend, input, setInput, deviceTokenRef,
    handleLiveInputAccessoryBytes, clientRef, connStateRef, liveInputEnabled, keyboardHeight, liveInputRef,
    liveInputFocusTimerRef, sessionTabActionSheetKeyboardHideSubRef, setActionTarget, setMarkdownActionTarget,
    setFileActionTarget, setBrowserActionTarget, scheduleDelayedAction, commandInputRef,
    handleCreateBrowserRef, hostId, routeWorktreeName, router, terminalCwdRef, fetchSessionTabs,
    sessionTabsRef, activeSessionTabIdRef, terminalLinkOpenMode, isFloatingWorkspaceRoute, showToast
  } = context

  return useMobileSessionTabInteractions({
    triggerSelection,
    sessionTabs,
    terminalDiagnosticsRef,
    pendingActiveSessionTabIdRef,
    pendingActiveTerminalHandleRef,
    activeSessionTabTypeRef,
    defaultTerminalHandlesToLiveInput,
    setActiveSessionTabId,
    activeHandleRef,
    setActiveHandle,
    unsubscribeTerminal,
    initializedHandlesRef,
    terminalUnsubsRef,
    subscribeToTerminal,
    client,
    activateMobileSessionTab,
    worktreeId,
    readFileTab,
    markdownDocs,
    readMarkdownTab,
    switchSessionTabRef,
    terminalRefs,
    terminalGestureInputBucketsRef,
    terminalGestureInputQueuesRef,
    terminalGestureInputInFlightRef,
    webReadyHandlesRef,
    measureViewportOnce,
    activeSessionTab,
    fileDocs,
    sendingRef,
    canSend,
    input,
    setInput,
    deviceTokenRef,
    buildTerminalSendParams,
    TERMINAL_INPUT_SEND_OPTIONS,
    handleLiveInputAccessoryBytes,
    clientRef,
    connStateRef,
    sendTerminalLiveAccessoryRawBytes,
    normalizeTerminalTextInput,
    isTerminalLiveInputWithinByteLimit,
    triggerError,
    showToast,
    isTerminalSendRpcAccepted,
    liveInputEnabled,
    focusTerminalLiveInputTarget,
    keyboardHeight,
    scheduleTerminalLiveInputFocus,
    liveInputRef,
    liveInputFocusTimerRef,
    sessionTabActionSheetKeyboardHideSubRef,
    setActionTarget,
    setMarkdownActionTarget,
    setFileActionTarget,
    setBrowserActionTarget,
    clearTerminalLiveInputFocusTimer,
    scheduleDelayedAction,
    commandInputRef,
    dismissTerminalKeyboard,
    handleCreateBrowserRef,
    hostId,
    routeWorktreeName,
    router,
    terminalCwdRef,
    fetchSessionTabs,
    sessionTabsRef,
    activeSessionTabIdRef,
    activateOpenedSourceControlDiffTab,
    terminalLinkOpenMode,
    isFloatingWorkspaceRoute
  })
}
