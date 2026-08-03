import { useCallback, useEffect, useRef } from 'react'
import { Keyboard, Linking } from 'react-native'
import {
  activateOpenedSourceControlDiffTab
} from '../../../../src/session/opened-mobile-session-tab'
import { activateMobileSessionTab } from '../../../../src/session/mobile-session-tab-activation'
import { openMobileTerminalFileTap } from '../../../../src/session/mobile-terminal-file-tap-open'
import { triggerError, triggerSelection } from '../../../../src/platform/haptics'
import {
  buildTerminalSendParams,
  TERMINAL_INPUT_SEND_OPTIONS
} from '../../../../src/terminal/terminal-send-request'
import { normalizeTerminalTextInput } from '../../../../src/terminal/terminal-text-input-normalization'
import { isTerminalSendRpcAccepted } from '../../../../src/terminal/terminal-send-rpc-response'
import { isTerminalLiveInputWithinByteLimit } from '../../../../src/terminal/terminal-live-input'
import {
  clearTerminalLiveInputFocusTimer,
  focusTerminalLiveInputTarget,
  scheduleTerminalLiveInputFocus
} from '../../../../src/terminal/terminal-live-input'
import { dismissTerminalKeyboard } from '../../../../src/terminal/terminal-keyboard-dismiss'
import { sendTerminalLiveAccessoryRawBytes } from '../../../../src/terminal/terminal-live-accessory-raw-send'
import { createTerminalLiveAccessoryInput } from '../../../../src/terminal/terminal-live-accessory-input'
import type { TerminalWebViewHandle } from '../../../../src/terminal/terminal-webview-contract'
import type { MobileSessionTab } from './mobile-session-route-types'

const TERMINAL_KEYBOARD_DISMISS_ACTION_SHEET_FALLBACK_MS = 450

type SessionTabInteractionContext = Record<string, any>

export function useMobileSessionTabInteractions(context: SessionTabInteractionContext) {
  const {
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
    worktreeId, activeHandle,
    readFileTab,
    markdownDocs,
    readMarkdownTab,
    switchSessionTabRef,
    terminalRefs,
    terminalGestureInputBucketsRef,
    terminalGestureInputQueuesRef,
    terminalGestureInputInFlightRef,
    webReadyHandlesRef,
    nativeChatStream,
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
    isFloatingWorkspaceRoute, sendLiveTerminalInputRef, sessionTabActionSheetRequestSeqRef
  } = context

  const switchTab = useCallback(
    (handle: string) => {
      triggerSelection()
      const matchingTab = sessionTabs.find(
        (tab): tab is Extract<MobileSessionTab, { type: 'terminal' }> =>
          tab.type === 'terminal' && tab.terminal === handle
      )
      terminalDiagnosticsRef.current.tabSwitch('terminal', matchingTab?.id ?? '', false, handle)
      pendingActiveSessionTabIdRef.current = matchingTab?.id ?? null
      pendingActiveTerminalHandleRef.current = handle
      activeSessionTabTypeRef.current = 'terminal'
      defaultTerminalHandlesToLiveInput([handle])
      setActiveSessionTabId(matchingTab?.id ?? null)
      const prev = activeHandleRef.current
      activeHandleRef.current = handle
      setActiveHandle(handle)
      if (prev && prev !== handle) {
        unsubscribeTerminal(prev)
        initializedHandlesRef.current.delete(prev)
      }
      // Force a fresh subscribe even if eagerly subscribed without viewport
      if (terminalUnsubsRef.current.has(handle)) {
        unsubscribeTerminal(handle)
        initializedHandlesRef.current.delete(handle)
      }
      subscribeToTerminal(handle)
      if (client) {
        if (matchingTab) {
          void activateMobileSessionTab(client, {
            worktree: `id:${worktreeId}`,
            tabId: matchingTab.id,
            notifyClients: false,
            navigation: 'caller'
          }).catch(() => {})
        }
      }
    },
    [
      client,
      defaultTerminalHandlesToLiveInput,
      sessionTabs,
      subscribeToTerminal,
      unsubscribeTerminal,
      worktreeId
    ]
  )

  const switchSessionTab = useCallback(
    (tab: MobileSessionTab) => {
      if (tab.type === 'terminal') {
        if (typeof tab.terminal === 'string') {
          switchTab(tab.terminal)
          return
        }
        terminalDiagnosticsRef.current.tabSwitch('terminal', tab.id, true)
        triggerSelection()
        pendingActiveSessionTabIdRef.current = tab.id
        pendingActiveTerminalHandleRef.current = null
        activeSessionTabTypeRef.current = 'terminal'
        setActiveSessionTabId(tab.id)
        const prev = activeHandleRef.current
        if (prev) {
          unsubscribeTerminal(prev)
          initializedHandlesRef.current.delete(prev)
        }
        activeHandleRef.current = null
        setActiveHandle(null)
        if (client) {
          void activateMobileSessionTab(client, {
            worktree: `id:${worktreeId}`,
            tabId: tab.id,
            notifyClients: false,
            navigation: 'caller'
          }).catch(() => {})
        }
        return
      }

      triggerSelection()
      terminalDiagnosticsRef.current.tabSwitch(tab.type, tab.id, false)
      pendingActiveSessionTabIdRef.current = tab.id
      pendingActiveTerminalHandleRef.current = null
      activeSessionTabTypeRef.current = tab.type
      setActiveSessionTabId(tab.id)
      const prev = activeHandleRef.current
      if (prev) {
        unsubscribeTerminal(prev)
        initializedHandlesRef.current.delete(prev)
      }
      activeHandleRef.current = null
      setActiveHandle(null)
      if (client) {
        void activateMobileSessionTab(client, {
          worktree: `id:${worktreeId}`,
          tabId: tab.id,
          notifyClients: false,
          navigation: 'caller'
        }).catch(() => {})
      }
      if (tab.type === 'browser') {
        return
      }
      if (tab.type === 'file') {
        void readFileTab(tab)
        return
      }
      const cached = markdownDocs.get(tab.id)
      if (cached?.status === 'ready' && cached.isDirty) {
        return
      }
      // Why: tab list lacks a reliable version for desktop clean saves; re-read on revisit unless the phone has a draft.
      void readMarkdownTab(tab)
    },
    [client, markdownDocs, readFileTab, readMarkdownTab, switchTab, unsubscribeTerminal, worktreeId]
  )
  // Ref to latest switchSessionTab so fetchSessionTabs can activate a synced browser tab without a dependency cycle.
  switchSessionTabRef.current = switchSessionTab

  // Why: only store the ref; subscribe on web-ready to avoid the blank-terminal race (init queued before xterm.js loaded).
  const setTerminalWebViewRef = useCallback((handle: string, ref: TerminalWebViewHandle | null) => {
    terminalDiagnosticsRef.current.webViewRef(handle, ref != null)
    if (ref) {
      terminalRefs.current.set(handle, ref)
    } else {
      terminalRefs.current.delete(handle)
      terminalGestureInputBucketsRef.current.delete(handle)
      const queued = terminalGestureInputQueuesRef.current.get(handle)
      if (queued?.timer) {
        clearTimeout(queued.timer)
      }
      terminalGestureInputQueuesRef.current.delete(handle)
      terminalGestureInputInFlightRef.current.delete(handle)
    }
  }, [])

  const handleTerminalWebReady = useCallback(
    (handle: string) => {
      const wasAlreadyReady = webReadyHandlesRef.current.has(handle)
      webReadyHandlesRef.current.add(handle)
      nativeChatStream.notifyWebReady(handle, wasAlreadyReady)
      terminalDiagnosticsRef.current.webViewReady(
        handle,
        wasAlreadyReady,
        handle === activeHandleRef.current
      )
      if (wasAlreadyReady && initializedHandlesRef.current.has(handle)) {
        // Why: WebView reloaded (hot reload / Android churn); old xterm buffer is gone, so resubscribe for a fresh scrollback.
        unsubscribeTerminal(handle)
        initializedHandlesRef.current.delete(handle)
        if (handle === activeHandleRef.current) {
          subscribeToTerminal(handle)
        }
        return
      }
      // Why: first subscribe may skip (no WebView ref); await measure so it carries the viewport, else it races measureViewportOnce and skips.
      // Why: a just-created tab can lose activeHandleRef to a lagging snapshot; honor the pending marker so its web-ready subscribe still fires.
      const isIntendedActive = () =>
        handle === activeHandleRef.current || handle === pendingActiveTerminalHandleRef.current
      if (isIntendedActive() && !terminalUnsubsRef.current.has(handle)) {
        void (async () => {
          await measureViewportOnce(handle)
          if (isIntendedActive() && !terminalUnsubsRef.current.has(handle)) {
            subscribeToTerminal(handle)
          }
        })()
      }
    },
    [measureViewportOnce, nativeChatStream, subscribeToTerminal, unsubscribeTerminal]
  )

  useEffect(() => {
    if (activeSessionTab?.type !== 'markdown') {
      return
    }
    const doc = markdownDocs.get(activeSessionTab.id)
    if (!doc) {
      void readMarkdownTab(activeSessionTab)
    }
  }, [activeSessionTab, markdownDocs, readMarkdownTab])

  useEffect(() => {
    if (activeSessionTab?.type !== 'file') {
      return
    }
    const doc = fileDocs.get(activeSessionTab.id)
    if (!doc) {
      void readFileTab(activeSessionTab)
    }
  }, [activeSessionTab, fileDocs, readFileTab])

  async function handleSend() {
    // Why: the return key still submits while offline; hold the composed text instead of firing a doomed RPC (#6713).
    if (!client || !activeHandle || sendingRef.current || !canSend) {
      return
    }
    sendingRef.current = true

    const text = normalizeTerminalTextInput(input)
    setInput('')

    try {
      // Why: fail now and restore the text — a send parked across a reconnect would execute long after the tap.
      await client.sendRequest(
        'terminal.send',
        buildTerminalSendParams({
          terminal: activeHandle,
          text,
          enter: true,
          deviceToken: deviceTokenRef.current
        }),
        TERMINAL_INPUT_SEND_OPTIONS
      )
    } catch {
      setInput(text)
    } finally {
      sendingRef.current = false
    }
  }

  async function handleAccessoryKey(input: ReturnType<typeof createTerminalLiveAccessoryInput>) {
    if (!client || !activeHandle || !canSend) {
      return
    }
    const targetHandle = activeHandle
    const accessoryCommit = await handleLiveInputAccessoryBytes(input)
    if (accessoryCommit.kind !== 'allow-raw') {
      return
    }
    await sendTerminalLiveAccessoryRawBytes({
      client: clientRef.current,
      targetHandle,
      activeHandle: activeHandleRef.current,
      activeSessionTabType: activeSessionTabTypeRef.current,
      connState: connStateRef.current,
      bytes: input.bytes,
      deviceToken: deviceTokenRef.current
    })
  }

  const sendLiveTerminalInput = useCallback(
    async (handle: string, bytes: string): Promise<boolean> => {
      const text = normalizeTerminalTextInput(bytes)
      if (text.length === 0) {
        return false
      }
      if (!isTerminalLiveInputWithinByteLimit(text)) {
        triggerError()
        showToast('Input too large (max 256 KiB)', 1500)
        return false
      }
      const rpc = clientRef.current
      // Why: callers suppress follow-up controls/toasts when this live send is stale.
      if (
        !rpc ||
        connStateRef.current !== 'connected' ||
        handle !== activeHandleRef.current ||
        activeSessionTabTypeRef.current !== 'terminal'
      ) {
        return false
      }
      // Why: live-mirror deltas queued behind a dying send drain into the connect
      // wait and replay stale bytes after reconnect (#6713's `YZZYecho …` corruption).
      return rpc
        .sendRequest(
          'terminal.send',
          buildTerminalSendParams({
            terminal: handle,
            text,
            enter: false,
            deviceToken: deviceTokenRef.current
          }),
          TERMINAL_INPUT_SEND_OPTIONS
        )
        .then(isTerminalSendRpcAccepted, () => false)
    },
    [showToast]
  )
  sendLiveTerminalInputRef.current = sendLiveTerminalInput

  const focusLiveInput = useCallback(() => {
    if (!canSend || !liveInputEnabled) {
      return
    }
    focusTerminalLiveInputTarget(liveInputRef.current, {
      keyboardHeight,
      refocus: () =>
        scheduleTerminalLiveInputFocus(liveInputFocusTimerRef, () => liveInputRef.current?.focus())
    })
  }, [canSend, keyboardHeight, liveInputEnabled])

  const clearSessionTabActionSheetKeyboardListener = useCallback(() => {
    sessionTabActionSheetKeyboardHideSubRef.current?.remove()
    sessionTabActionSheetKeyboardHideSubRef.current = null
  }, [])

  const openSessionTabActionSheet = useCallback((tab: MobileSessionTab) => {
    if (tab.type === 'terminal') {
      if (typeof tab.terminal !== 'string') {
        return
      }
      setActionTarget({
        handle: tab.terminal,
        title: tab.title,
        isActive: tab.terminal === activeHandleRef.current
      })
    } else if (tab.type === 'markdown') {
      setMarkdownActionTarget(tab)
    } else if (tab.type === 'file') {
      setFileActionTarget(tab)
    } else {
      setBrowserActionTarget(tab)
    }
  }, [])

  const openSessionTabActionSheetAfterKeyboardDismiss = useCallback(
    (tab: MobileSessionTab) => {
      // Why: live input may queue a refocus; open the action sheet after the keyboard is gone, not racing it under the drawer.
      sessionTabActionSheetRequestSeqRef.current += 1
      const requestSeq = sessionTabActionSheetRequestSeqRef.current
      clearSessionTabActionSheetKeyboardListener()
      let didOpen = false
      const openAfterDismiss = () => {
        if (didOpen || requestSeq !== sessionTabActionSheetRequestSeqRef.current) {
          return
        }
        didOpen = true
        clearSessionTabActionSheetKeyboardListener()
        openSessionTabActionSheet(tab)
      }

      clearTerminalLiveInputFocusTimer(liveInputFocusTimerRef)

      if (keyboardHeight <= 0) {
        liveInputRef.current?.blur()
        Keyboard.dismiss()
        openAfterDismiss()
        return
      }

      sessionTabActionSheetKeyboardHideSubRef.current = Keyboard.addListener(
        'keyboardDidHide',
        openAfterDismiss
      )
      liveInputRef.current?.blur()
      Keyboard.dismiss()
      scheduleDelayedAction(openAfterDismiss, TERMINAL_KEYBOARD_DISMISS_ACTION_SHEET_FALLBACK_MS)
    },
    [
      clearSessionTabActionSheetKeyboardListener,
      keyboardHeight,
      openSessionTabActionSheet,
      scheduleDelayedAction
    ]
  )

  const dismissSoftwareKeyboard = useCallback(() => {
    dismissTerminalKeyboard({
      clearPendingLiveInputFocus: () => clearTerminalLiveInputFocusTimer(liveInputFocusTimerRef),
      commandInput: commandInputRef.current,
      dismissKeyboard: () => Keyboard.dismiss(),
      liveInput: liveInputRef.current
    })
  }, [])

  const handleTerminalTap = useCallback(
    (handle: string) => {
      if (handle !== activeHandleRef.current) {
        return
      }
      focusLiveInput()
    },
    [focusLiveInput]
  )

  // Tap a terminal file path → resolve on host, open as file tab (mirrors desktop Cmd/Ctrl-click); silent on a miss.
  const handleFileTapActivationSeqRef = useRef(0)
  const handleFileTap = useCallback(
    (handle: string, pathText: string, line: number | null, column: number | null) => {
      if (handle !== activeHandleRef.current || !client) {
        return
      }
      const activationSeq = ++handleFileTapActivationSeqRef.current
      openMobileTerminalFileTap<MobileSessionTab>({
        client,
        hostId,
        worktreeId,
        worktreeName: routeWorktreeName,
        terminalHandle: handle,
        pathText,
        cwd: terminalCwdRef.current.get(handle) ?? null,
        line,
        column,
        pushPreviewRoute: (href) => router.push(href),
        openBrowser: (url) => void handleCreateBrowserRef.current?.(url),
        triggerOpenFeedback: triggerSelection,
        fetchSessionTabs,
        getSessionTabs: () => sessionTabsRef.current,
        getActiveSessionTabId: () => activeSessionTabIdRef.current,
        getActivationState: (activated) => ({
          activated,
          activationSeq,
          latestActivationSeq: handleFileTapActivationSeqRef.current,
          sourceTerminalHandle: handle,
          activeTerminalHandle: activeHandleRef.current,
          activeTabType: activeSessionTabTypeRef.current
        }),
        switchSessionTab: (tab) => switchSessionTabRef.current?.(tab),
        scheduleDelayedAction
      })
    },
    [client, fetchSessionTabs, hostId, routeWorktreeName, router, scheduleDelayedAction, worktreeId]
  )

  const handleOpenedFileDiffActivationSeqRef = useRef(0)
  // Capture active tab at tap time; reading it after openDiff would misread a mid-RPC switch and let the retry steal focus.
  const fileOpenStartActiveTabIdRef = useRef<string | null>(null)
  const handleFileOpenStart = useCallback(() => {
    fileOpenStartActiveTabIdRef.current = activeSessionTabIdRef.current
  }, [])
  const handleOpenedFileDiff = useCallback(
    (relativePath: string) => {
      const activationSeq = ++handleOpenedFileDiffActivationSeqRef.current
      const activeTabIdAtTap = fileOpenStartActiveTabIdRef.current

      let activated = false
      const activateOpenedTab = async (): Promise<void> => {
        // Route matching through the shared helper so the repro test exercises the same logic production runs.
        const settled = await activateOpenedSourceControlDiffTab<MobileSessionTab>({
          relativePath,
          activeTabIdAtTap,
          fetchSessionTabs,
          getTabs: () => sessionTabsRef.current,
          getActiveTabId: () => activeSessionTabIdRef.current,
          getActivationState: () => ({
            activated,
            activationSeq,
            latestActivationSeq: handleOpenedFileDiffActivationSeqRef.current
          }),
          switchSessionTab: (tab) => switchSessionTabRef.current?.(tab)
        })
        if (settled) {
          activated = true
        }
      }

      scheduleDelayedAction(() => void activateOpenedTab(), 300)
      scheduleDelayedAction(() => void activateOpenedTab(), 900)
      scheduleDelayedAction(() => void activateOpenedTab(), 1800)
    },
    [fetchSessionTabs, scheduleDelayedAction]
  )

  const handleTerminalOpenUrl = useCallback(
    (handle: string, url: string) => {
      if (handle !== activeHandleRef.current) {
        return
      }
      // Why: browser.tabCreate resolves a real worktree, which the floating
      // sentinel doesn't have — open taps in the phone browser instead.
      if (terminalLinkOpenMode === 'phone-browser' || isFloatingWorkspaceRoute) {
        void Linking.openURL(url).catch(() => {})
        return
      }
      void handleCreateBrowserRef.current?.(url)
    },
    [terminalLinkOpenMode, isFloatingWorkspaceRoute]
  )


  return {
    switchTab,
    switchSessionTab,
    setTerminalWebViewRef,
    handleTerminalWebReady,
    handleSend,
    handleAccessoryKey,
    sendLiveTerminalInput,
    focusLiveInput,
    clearSessionTabActionSheetKeyboardListener,
    openSessionTabActionSheet,
    openSessionTabActionSheetAfterKeyboardDismiss,
    dismissSoftwareKeyboard,
    handleTerminalTap,
    handleFileTapActivationSeqRef,
    handleFileTap,
    handleOpenedFileDiffActivationSeqRef,
    fileOpenStartActiveTabIdRef,
    handleFileOpenStart,
    handleOpenedFileDiff,
    handleTerminalOpenUrl,
    sendLiveTerminalInputRef
  }
}
