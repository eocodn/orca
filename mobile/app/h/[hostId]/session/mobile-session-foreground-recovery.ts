import { useEffect } from 'react'
import { AppState, Keyboard, type AppStateStatus, type KeyboardEvent } from 'react-native'
import { loadTerminalAccessoryLayout } from '../../../../src/terminal/terminal-accessory-layout'
import { useTerminalViewportRefit } from '../../../../src/terminal/terminal-viewport-refit'

type SessionRecoveryContext = Record<string, any>

export function useMobileSessionForegroundRecovery(context: SessionRecoveryContext) {
  const {
    loadTerminalAccessoryLayout: loadAccessoryLayout = loadTerminalAccessoryLayout,
    setVisibleBuiltInIds,
    terminalRefs,
    activeHandleRef,
    initializedHandlesRef,
    unsubscribeTerminal,
    subscribeToTerminal,
    terminalFrameHeightRef,
    viewportRef,
    viewportMeasuredRef,
    clientRef,
    deviceTokenRef,
    connState,
    terminals,
    terminalTextScale,
    terminalFrameWidth,
    setKeyboardHeight,
    tabLayoutsRef,
    tabStripViewportWidthRef,
    tabStripContentWidthRef,
    tabStripOffsetRef,
    tabStripRef,
    resolveTabStripScrollOffset,
    activeSessionTabId
  } = context

  useEffect(() => {
    let stale = false
    void loadAccessoryLayout().then((layout: { visibleBuiltInIds: string[] }) => {
      if (!stale) setVisibleBuiltInIds(layout.visibleBuiltInIds)
    })
    return () => {
      stale = true
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const refresh = () => {
      void loadAccessoryLayout().then((layout: { visibleBuiltInIds: string[] }) => {
        if (mounted) setVisibleBuiltInIds(layout.visibleBuiltInIds)
      })
    }
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') refresh()
    })
    return () => {
      mounted = false
      sub.remove()
    }
  }, [])

  const { notifyTerminalFrameHeight, notifyKeyboardVisibility } = useTerminalViewportRefit({
    activeHandleRef,
    terminalRefs,
    terminalFrameHeightRef,
    viewportRef,
    viewportMeasuredRef,
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
    const onShow = (event: KeyboardEvent) => {
      notifyKeyboardVisibility(true)
      setKeyboardHeight(event.endCoordinates?.height ?? 0)
    }
    const onHide = () => {
      notifyKeyboardVisibility(false)
      setKeyboardHeight(0)
    }
    const showEvent = 'keyboardDidShow'
    const hideEvent = 'keyboardDidHide'
    const showSub = Keyboard.addListener(showEvent, onShow)
    const hideSub = Keyboard.addListener(hideEvent, onHide)
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [notifyKeyboardVisibility])

  const scrollActiveTabIntoView = (tabId: string | null, animated: boolean) => {
    if (!tabId) return
    const layout = tabLayoutsRef.current.get(tabId)
    if (!layout) return
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
  }

  useEffect(() => {
    const id = requestAnimationFrame(() => scrollActiveTabIntoView(activeSessionTabId, true))
    return () => cancelAnimationFrame(id)
  }, [activeSessionTabId])

  return {
    notifyTerminalFrameHeight,
    notifyKeyboardVisibility,
    scrollActiveTabIntoView
  }
}
