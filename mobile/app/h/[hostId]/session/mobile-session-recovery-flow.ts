import { useCallback, useEffect, useRef } from 'react'
import {
  AppState,
  Keyboard,
  Platform,
  type AppStateStatus,
  type KeyboardEvent
} from 'react-native'
import { useFocusEffect } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  loadTerminalAutocompleteEnabled,
  loadTerminalLinkOpenMode,
  loadTerminalTextScale
} from '../../../../src/storage/preferences'
import { loadHosts } from '../../../../src/transport/host-store'
import { startRuntimeCapabilityProbe } from '../../../../src/transport/runtime-capability-probe'
import { MOBILE_AI_VAULT_CAPABILITY } from '../../../../src/agent-history/agent-history-capability'
import { supportsMobileQuickCommands } from '../../../../src/terminal/quick-commands'
import { TERMINAL_QUERY_REPLY_INPUT_RUNTIME_CAPABILITY } from '../../../../../src/shared/protocol-version'
import { loadCustomKeys, saveCustomKeys, type CustomKey } from '../../../../src/components/CustomKeyModal'
import { useMobileSessionTabsFetchReporting } from '../../../../src/session/use-mobile-session-tabs-fetch-reporting'
import { useMobileSessionTabsReconciliation } from '../../../../src/session/use-mobile-session-tabs-reconciliation'
import { runAcceptedMobileSessionTabsEffects } from '../../../../src/session/mobile-session-tabs-accepted-effects'
import { useTerminalViewportRefit } from '../../../../src/terminal/terminal-viewport-refit'
import {
  recoverActiveTerminalAfterForeground,
  shouldRecoverTerminalOnAppStateChange
} from '../../../../src/terminal/terminal-foreground-recovery'
import { resolveTabStripScrollOffset } from '../../../../src/session/tab-strip-scroll'
import { headlessActivationNeedsHostRenderer } from '../../../../src/worktree/worktree-activation-result'
import type { RpcSuccess } from '../../../../src/transport/types'
import type { SessionTabsStreamSource } from '../../../../src/session/mobile-session-tabs-stream-health'
import type {
  MobileSessionTab,
  SessionTabsResult
} from './mobile-session-route-types'
type SessionRecoveryContext = Record<string, any>

export function useMobileSessionRecovery(context: SessionRecoveryContext) {
  const {
    runAcceptedMobileSessionTabsEffects,
    pendingBrowserFocusPageIdRef,
    switchSessionTabRef,
    setMarkdownDocs,
    closedTabTombstonesRef,
    nativeChatStream,
    appliedSessionTabsRevisionRef,
    worktreeId,
    terminalDiagnosticsRef,
    client,
    connState,
    applySessionTabs,
    fetchTerminals,
    terminalGestureInputQueuesRef,
    terminalGestureInputInFlightRef,
    setBrowserScreencastSupported,
    setAgentSessionHistorySupported,
    setQuickCommandsSupported,
    setShowQuickCommands,
    startRuntimeCapabilityProbe,
    MOBILE_AI_VAULT_CAPABILITY,
    supportsMobileQuickCommands,
    TERMINAL_QUERY_REPLY_INPUT_RUNTIME_CAPABILITY,
    hostId,
    deviceTokenRef,
    setHostEndpoint,
    loadHosts,
    loadCustomKeys,
    setCustomKeys,
    loadTerminalAccessoryLayout,
    setVisibleBuiltInIds,
    terminalRefs,
    shouldRecoverTerminalOnAppStateChange,
    Platform,
    recoverActiveTerminalAfterForeground,
    activeHandleRef,
    initializedHandlesRef,
    connStateRef,
    unsubscribeTerminal,
    subscribeToTerminal,
    scheduleDelayedAction,
    terminalFrameHeightRef,
    viewportRef,
    viewportMeasuredRef,
    showNativeChatRef,
    clientRef,
    terminals,
    terminalTextScale,
    terminalFrameWidth,
    setKeyboardHeight,
    Keyboard,
    tabLayoutsRef,
    tabStripViewportWidthRef,
    tabStripContentWidthRef,
    tabStripOffsetRef,
    tabStripRef,
    resolveTabStripScrollOffset,
    activeSessionTabId,
    AsyncStorage,
    customKeys,
    saveCustomKeys,
    router,
    sessionTabActionSheetRequestSeqRef,
    sessionTabActionSheetKeyboardHideSubRef,
    clearTerminalCache,
    pendingActiveSessionTabIdRef,
    pendingActiveTerminalHandleRef,
    pendingTerminalActivationAttemptRef,
    initialSessionAutoCreateRef,
    createInitialSessionAutoCreateState,
    setActiveHandle,
    setTerminals,
    terminalsRef,
    setSessionTabs,
    setActiveSessionTabId,
    clearPendingLiveInputCommit,
    clearDelayedActionTimers,
    setTerminalsLoaded,
    created,
    isFloatingWorkspaceRoute,
    headlessActivationNeedsHostRenderer,
    showToast,
    loadTerminalTextScale,
    setTerminalTextScale,
    loadTerminalAutocompleteEnabled,
    setAutocompleteEnabled,
    loadTerminalLinkOpenMode,
    setTerminalLinkOpenMode
  } = context

  const consumeAcceptedSessionTabs = useCallback(
    (
      _result: SessionTabsResult,
      effectiveTabs: readonly MobileSessionTab[],
      source: SessionTabsStreamSource
    ): void => {
      runAcceptedMobileSessionTabsEffects<MobileSessionTab>({
        effectiveTabs,
        source,
        getPendingBrowserPageId: () => pendingBrowserFocusPageIdRef.current,
        clearPendingBrowserPageId: (pageId) => {
          if (pendingBrowserFocusPageIdRef.current === pageId) {
            pendingBrowserFocusPageIdRef.current = null
          }
        },
        activateBrowserTab: (tab) => switchSessionTabRef.current?.(tab),
        markActiveMarkdownStale: (tabId) => {
          setMarkdownDocs((prev) => {
            const current = prev.get(tabId)
            if (current?.status !== 'ready' || current.isDirty) {
              return prev
            }
            return new Map(prev).set(tabId, { ...current, stale: true })
          })
        }
      })
    },
    []
  )
  const hasSessionTabsRecoveryNeed = useCallback(
    () =>
      closedTabTombstonesRef.current.size > 0 ||
      pendingBrowserFocusPageIdRef.current !== null ||
      // Why: a chat-covered handle that ran out of rearms and left `terminal.list`
      // was reminted by a desktop graph reload. Only a fresh tab snapshot carries
      // the replacement handle, so force one instead of holding the composer locked.
      nativeChatStream.hasTabsRecoveryNeed(),
    [nativeChatStream]
  )
  const getSessionTabsApplicationRevision = useCallback(
    () => appliedSessionTabsRevisionRef.current,
    []
  )
  const sessionTabsFetchReporting = useMobileSessionTabsFetchReporting<SessionTabsResult>({
    worktreeId,
    diagnosticsRef: terminalDiagnosticsRef
  })
  const { fetchSessionTabs, ensureSessionTabs, fetchPendingBrowserSessionTabs } =
    useMobileSessionTabsReconciliation<SessionTabsResult, MobileSessionTab>({
      client,
      connState,
      worktreeId,
      applySessionTabs,
      consumeAcceptedSessionTabs,
      fetchTerminals,
      hasRecoveryNeed: hasSessionTabsRecoveryNeed,
      getApplicationRevision: getSessionTabsApplicationRevision,
      ...sessionTabsFetchReporting
    })

  useEffect(() => {
    if (connState === 'connected') {
      return
    }
    for (const queued of terminalGestureInputQueuesRef.current.values()) {
      if (queued.timer) {
        clearTimeout(queued.timer)
      }
    }
    terminalGestureInputQueuesRef.current.clear()
    terminalGestureInputInFlightRef.current.clear()
  }, [connState])

  const hostQueryReplyInputSupportedRef = useRef(false)

  useEffect(() => {
    if (!client || connState !== 'connected') {
      setBrowserScreencastSupported(null)
      setAgentSessionHistorySupported(null)
      setQuickCommandsSupported(null)
      setShowQuickCommands(false)
      hostQueryReplyInputSupportedRef.current = false
      return
    }
    // Why: a client swap can keep the route connected while moving to an older
    // host; clear the prior capability before exposing host-specific actions.
    setBrowserScreencastSupported(null)
    setAgentSessionHistorySupported(null)
    setQuickCommandsSupported(null)
    setShowQuickCommands(false)
    hostQueryReplyInputSupportedRef.current = false
    // Why: the probe retries — a relay→direct cutover or request timeout rejects
    // status.get without changing connState, which used to latch these hidden.
    return startRuntimeCapabilityProbe(client, (capabilities) => {
      setBrowserScreencastSupported(capabilities.includes('browser.screencast.v1'))
      setAgentSessionHistorySupported(capabilities.includes(MOBILE_AI_VAULT_CAPABILITY))
      setQuickCommandsSupported(supportsMobileQuickCommands(capabilities))
      // Why: hosts without this capability strip inputKind from terminal.send,
      // so a forwarded xterm reply would become floor-stealing shell input.
      hostQueryReplyInputSupportedRef.current = capabilities.includes(
        TERMINAL_QUERY_REPLY_INPUT_RUNTIME_CAPABILITY
      )
    })
  }, [client, connState])

  // Why: read deviceToken from host record so code can pass client.id on subscribe/send for driver-state-machine identity.
  useEffect(() => {
    if (!hostId) {
      return
    }
    let stale = false
    void loadHosts().then((hosts) => {
      if (stale) {
        return
      }
      const host = hosts.find((h) => h.id === hostId)
      if (host) {
        deviceTokenRef.current = host.deviceToken
        setHostEndpoint(host.endpoint)
      }
    })
    return () => {
      stale = true
    }
  }, [hostId])

  useEffect(() => {
    void loadCustomKeys().then(setCustomKeys)
  }, [])

  useFocusEffect(
    useCallback(() => {
      let stale = false
      void loadTerminalAccessoryLayout().then((layout) => {
        if (!stale) {
          setVisibleBuiltInIds(layout.visibleBuiltInIds)
        }
      })
      return () => {
        stale = true
      }
    }, [])
  )

  useEffect(() => {
    let mounted = true
    const refresh = () => {
      void loadTerminalAccessoryLayout().then((layout) => {
        if (mounted) {
          setVisibleBuiltInIds(layout.visibleBuiltInIds)
        }
      })
    }
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') {
        refresh()
      }
    })
    return () => {
      mounted = false
      sub.remove()
    }
  }, [])

  const pendingForegroundRecoveryRef = useRef(false)
  useEffect(() => {
    let previousAppState: AppStateStatus | null = AppState.currentState
    const sub = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      const shouldRecover = shouldRecoverTerminalOnAppStateChange(
        previousAppState,
        nextAppState,
        Platform.OS
      )
      previousAppState = nextAppState
      if (!shouldRecover) {
        return
      }
      for (const terminalRef of terminalRefs.current.values()) {
        terminalRef.prepareForForegroundRecovery()
      }
      // Why: iOS can resume a WKWebView with a blank xterm store and no web-ready; invalidate the latch so init waits for the pong.
      const outcome = recoverActiveTerminalAfterForeground({
        activeHandleRef,
        terminalRefs,
        initializedHandlesRef,
        connStateRef,
        unsubscribeTerminal,
        subscribeToTerminal,
        schedule: scheduleDelayedAction
      })
      pendingForegroundRecoveryRef.current = outcome === 'deferred'
    })
    return () => {
      sub.remove()
    }
  }, [scheduleDelayedAction, subscribeToTerminal, unsubscribeTerminal])

  // Why: resume lands mid-reconnect (socket dies in bg); re-run recovery once connected or a blanked WKWebView stays stale.
  useEffect(() => {
    if (connState !== 'connected' || !pendingForegroundRecoveryRef.current) {
      return
    }
    pendingForegroundRecoveryRef.current = false
    if (AppState.currentState !== 'active') {
      return
    }
    recoverActiveTerminalAfterForeground({
      activeHandleRef,
      terminalRefs,
      initializedHandlesRef,
      connStateRef,
      unsubscribeTerminal,
      subscribeToTerminal,
      schedule: scheduleDelayedAction
    })
  }, [connState, scheduleDelayedAction, subscribeToTerminal, unsubscribeTerminal])

  // Why: non-subscribe layout refits (tab strip, fold, rotation) live in a dedicated hook — see terminal-viewport-refit.ts.
  const { notifyTerminalFrameHeight, notifyKeyboardVisibility } = useTerminalViewportRefit({
    activeHandleRef,
    terminalRefs,
    terminalFrameHeightRef,
    viewportRef,
    viewportMeasuredRef,
    nativeChatCoveredRef: showNativeChatRef,
    clientRef,
    deviceTokenRef,
    initializedHandlesRef,
    connState,
    tabStripVisible: terminals.length > 1,
    textScale: terminalTextScale,
    terminalFrameWidth,
    unsubscribeTerminal,
    subscribeToTerminal
  })

  useEffect(() => {
    const onShow = (e: KeyboardEvent) => {
      notifyKeyboardVisibility(true)
      setKeyboardHeight(e.endCoordinates?.height ?? 0)
    }
    const onHide = () => {
      notifyKeyboardVisibility(false)
      setKeyboardHeight(0)
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const showSub = Keyboard.addListener(showEvent, onShow)
    const hideSub = Keyboard.addListener(hideEvent, onHide)
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [notifyKeyboardVisibility])

  const scrollActiveTabIntoView = useCallback((tabId: string | null, animated: boolean) => {
    if (!tabId) {
      return
    }
    const layout = tabLayoutsRef.current.get(tabId)
    if (!layout) {
      return
    }
    const nextOffset = resolveTabStripScrollOffset({
      tabX: layout.x,
      tabWidth: layout.width,
      viewportWidth: tabStripViewportWidthRef.current,
      contentWidth: tabStripContentWidthRef.current,
      currentOffset: tabStripOffsetRef.current
    })
    if (nextOffset !== tabStripOffsetRef.current) {
      tabStripOffsetRef.current = nextOffset
      tabStripRef.current?.scrollTo({ x: nextOffset, animated })
    }
  }, [])

  // Reveal the active tab on change; defer one frame so freshly mounted tab layouts are recorded.
  useEffect(() => {
    const id = requestAnimationFrame(() => scrollActiveTabIntoView(activeSessionTabId, true))
    return () => cancelAnimationFrame(id)
  }, [activeSessionTabId, scrollActiveTabIntoView])

  useEffect(() => {
    if (hostId && worktreeId) {
      void AsyncStorage.setItem(
        'orca:last-visited-worktree',
        JSON.stringify({ hostId, worktreeId })
      )
    }
  }, [hostId, worktreeId])

  const handleDeleteCustomKey = useCallback(
    async (key: CustomKey) => {
      const updated = customKeys.filter((k) => k.id !== key.id)
      setCustomKeys(updated)
      await saveCustomKeys(updated)
    },
    [customKeys]
  )

  const handleManageShortcuts = useCallback(() => {
    setShowCustomKeyModal(false)
    router.push('/terminal-settings')
  }, [router])

  useEffect(() => {
    // Why: Expo reuses this screen across worktrees; reset route state so it can't open stale UI or reject the next snapshot.
    sessionTabActionSheetRequestSeqRef.current += 1
    sessionTabActionSheetKeyboardHideSubRef.current?.remove()
    sessionTabActionSheetKeyboardHideSubRef.current = null
    clearTerminalCache()
    activeHandleRef.current = null
    activeSessionTabTypeRef.current = null
    pendingActiveSessionTabIdRef.current = null
    pendingActiveTerminalHandleRef.current = null
    pendingBrowserFocusPageIdRef.current = null
    pendingTerminalActivationAttemptRef.current = null
    initialSessionAutoCreateRef.current = createInitialSessionAutoCreateState()
    terminalDiagnosticsRef.current.resetRoute()
    appliedSnapshotMarkerRef.current = { epoch: null, version: -1 }
    closedTabTombstonesRef.current.clear()
    for (const queued of terminalGestureInputQueuesRef.current.values()) {
      if (queued.timer) {
        clearTimeout(queued.timer)
      }
    }
    terminalGestureInputQueuesRef.current.clear()
    terminalGestureInputInFlightRef.current.clear()
    setActiveHandle(null)
    setTerminals([])
    terminalsRef.current = []
    setSessionTabs([])
    setActiveSessionTabId(null)
    clearPendingLiveInputCommit()
    setMarkdownDocs(new Map())
    setFileDocs(new Map())
    clearDelayedActionTimers()
    return () => {
      sessionTabActionSheetRequestSeqRef.current += 1
      sessionTabActionSheetKeyboardHideSubRef.current?.remove()
      clearPendingLiveInputCommit()
      clearDelayedActionTimers()
    }
  }, [
    clearDelayedActionTimers,
    clearPendingLiveInputCommit,
    clearTerminalCache,
    hostId,
    worktreeId
  ])

  useEffect(() => {
    if (connState !== 'connected') {
      return
    }
    // Why: keep the current xterm visible while the reconnect snapshot hydrates, not a blank "Loading terminals" surface.
    if (initializedHandlesRef.current.size === 0) {
      setTerminalsLoaded(false)
    }
    // Why: clear the initialized flag so the reconnect scrollback replaces stale content instead of being dropped.
    initializedHandlesRef.current.clear()
    let disposed = false
    const timers: ReturnType<typeof setTimeout>[] = []
    function addTimer(fn: () => void, ms: number) {
      if (disposed) {
        return
      }
      timers.push(setTimeout(fn, ms))
    }
    void (async () => {
      const reportActivationOutcome = (response: RpcSuccess | null): void => {
        if (!disposed && response && headlessActivationNeedsHostRenderer(response.result)) {
          showToast('Open Orca on the host to wake sleeping agents.', 3000)
        }
      }
      if (client && created !== '1' && !isFloatingWorkspaceRoute) {
        // Why: hydrate host-owned tabs without pulling other paired clients (esp. desktop) into this worktree.
        void client
          .sendRequest('worktree.activate', {
            worktree: `id:${worktreeId}`,
            notifyClients: false,
            navigation: 'caller'
          })
          .then((response) => reportActivationOutcome(response.ok ? response : null))
          .catch(() => null)
      }
      if (disposed) {
        return
      }
      await ensureSessionTabs().catch(() => null)
      if (disposed) {
        return
      }
      await fetchTerminals({ allowEmptyLoaded: false })
      if (disposed) {
        return
      }
      addTimer(() => void fetchTerminals({ allowEmptyLoaded: false }), 750)
      addTimer(() => void fetchTerminals({ allowEmptyLoaded: true }), 1500)
      if (client && created === '1' && !isFloatingWorkspaceRoute) {
        addTimer(() => {
          if (activeHandleRef.current) {
            return
          }
          void (async () => {
            const activationResponse = await client
              .sendRequest('worktree.activate', {
                worktree: `id:${worktreeId}`,
                notifyClients: false,
                navigation: 'caller'
              })
              .catch(() => null)
            reportActivationOutcome(activationResponse?.ok ? activationResponse : null)
            if (disposed) {
              return
            }
            await fetchTerminals({ allowEmptyLoaded: true })
            addTimer(() => void fetchTerminals({ allowEmptyLoaded: true }), 750)
          })()
        }, 1800)
      }
    })()
    return () => {
      disposed = true
      for (const t of timers) {
        clearTimeout(t)
      }
    }
  }, [
    client,
    connState,
    created,
    fetchTerminals,
    ensureSessionTabs,
    isFloatingWorkspaceRoute,
    showToast,
    worktreeId
  ])

  // Why: pick up Settings → Terminal text size on return; panes stay mounted and update in place.
  useFocusEffect(
    useCallback(() => {
      let active = true
      void loadTerminalTextScale().then((scale) => {
        if (active) {
          setTerminalTextScale(scale)
        }
      })
      return () => {
        active = false
      }
    }, [])
  )

  // Why: pick up the Settings → Terminal autocomplete toggle when returning here.
  useFocusEffect(
    useCallback(() => {
      let active = true
      void loadTerminalAutocompleteEnabled().then((enabled) => {
        if (active) {
          setAutocompleteEnabled(enabled)
        }
      })
      return () => {
        active = false
      }
    }, [])
  )

  // Why: link routing is a phone-local choice; reload after Settings → Browser.
  useFocusEffect(
    useCallback(() => {
      let active = true
      void loadTerminalLinkOpenMode().then((mode) => {
        if (active) {
          setTerminalLinkOpenMode(mode)
        }
      })
      return () => {
        active = false
      }
    }, [])
  )


  return {
    consumeAcceptedSessionTabs,
    hasSessionTabsRecoveryNeed,
    getSessionTabsApplicationRevision,
    fetchSessionTabs,
    ensureSessionTabs,
    fetchPendingBrowserSessionTabs,
    hostQueryReplyInputSupportedRef,
    pendingForegroundRecoveryRef,
    notifyTerminalFrameHeight,
    notifyKeyboardVisibility,
    scrollActiveTabIntoView,
    handleDeleteCustomKey,
    handleManageShortcuts
  }
}
