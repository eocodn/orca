/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: mobile browser state mirrors a remote desktop screencast session and CDP dialogs, which are external systems that cannot be derived during render. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AppState,
  Image,
  View
} from 'react-native'
import type { RpcClient } from '../transport/rpc-client'
import type { BrowserScreencastFrameMetadata } from '../transport/browser-screencast-protocol'
import { type MobileBrowserViewMode } from './browser-screencast-request'
import type { BrowserPointerModifier } from './MobileBrowserPointerModifiers'
import {
  getInitialMobileBrowserViewMode,
  saveMobileBrowserViewMode
} from './mobile-browser-view-mode-state'
import { type BrowserTouchLayout, type BrowserZoomState } from './browser-touch-geometry'
import { displayBrowserUrl } from './browser-url'
import { resolveMobileBrowserAddressSync } from './mobile-browser-address-sync'
import {
  clearCachedBrowserFramesForWorktree,
  makeBrowserFrameCacheKey,
  peekCachedBrowserFrame,
  styles,
  updateBrowserImageSource,
  updateBrowserLayerVisibility,
  type FrameLayer,
  type PinchGesture
} from './mobile-browser-pane-support'
import { MobileBrowserPaneView } from './MobileBrowserPaneView'
import { useMobileBrowserFrameStream } from './use-mobile-browser-frame-stream'
import type { BrowserDialogState, MobileBrowserTab, PanGesture, PendingWheelCommand } from './mobile-browser-pane-types'
export type { MobileBrowserTab, PanGesture, PendingWheelCommand } from './mobile-browser-pane-types'
import { useMobileBrowserPaneInteractions } from './use-mobile-browser-pane-interactions'

type MobileBrowserPaneProps = {
  client: RpcClient | null
  worktreeId: string
  tab: MobileBrowserTab
  screencastSupported: boolean | null
  keyboardLift: number
  bottomInset: number
  onToast: (message: string, durationMs?: number) => void
}

const DEFAULT_ZOOM: BrowserZoomState = { scale: 1, offsetX: 0, offsetY: 0 }

export function MobileBrowserPane({
  client,
  worktreeId,
  tab,
  screencastSupported,
  keyboardLift,
  bottomInset,
  onToast
}: MobileBrowserPaneProps) {
  const [browserViewMode, setBrowserViewMode] = useState<MobileBrowserViewMode>(() =>
    getInitialMobileBrowserViewMode(worktreeId, tab.browserPageId)
  )
  const cacheKey = makeBrowserFrameCacheKey(worktreeId, tab.browserPageId, browserViewMode)
  const cachedInitialFrame = peekCachedBrowserFrame(cacheKey)
  const [addressValue, setAddressValue] = useState(displayBrowserUrl(tab.url))
  const [addressFocused, setAddressFocused] = useState(false)
  const [addressSyncState, setAddressSyncState] = useState({
    focused: false,
    url: tab.url
  })
  const [keyboardValue, setKeyboardValue] = useState('')
  const [frameUri, setFrameUri] = useState<string | null>(cachedInitialFrame?.uri ?? null)
  const [frameMetadata, setFrameMetadata] = useState<BrowserScreencastFrameMetadata | null>(
    cachedInitialFrame?.metadata ?? null
  )
  const [ready, setReady] = useState(cachedInitialFrame !== null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<BrowserDialogState | null>(null)
  const [pointerModifiers, setPointerModifiers] = useState<BrowserPointerModifier[]>([])
  const [zoom, setZoom] = useState<BrowserZoomState>(DEFAULT_ZOOM)
  const [layout, setLayout] = useState<BrowserTouchLayout | null>(null)
  const [appActive, setAppActive] = useState(AppState.currentState === 'active')
  const layoutRef = useRef<BrowserTouchLayout | null>(null)
  const frameMetadataRef = useRef<BrowserScreencastFrameMetadata | null>(
    cachedInitialFrame?.metadata ?? null
  )
  const frameUriRef = useRef<string | null>(cachedInitialFrame?.uri ?? null)
  const frameMountedRef = useRef(cachedInitialFrame !== null)
  const browserImageRefs = useRef<[Image | null, Image | null]>([null, null])
  const browserLayerRefs = useRef<[View | null, View | null]>([null, null])
  const pendingFrameLayerRef = useRef<FrameLayer | null>(null)
  const visibleFrameLayerRef = useRef<FrameLayer>(0)
  const readyRef = useRef(cachedInitialFrame !== null)
  const busyRef = useRef(false)
  const dialogRef = useRef<BrowserDialogState | null>(null)
  const startPointRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rightClickSentRef = useRef(false)
  const lastWheelRef = useRef<{ dx: number; dy: number; at: number }>({ dx: 0, dy: 0, at: 0 })
  const wheelGestureIdRef = useRef(0)
  const pendingWheelCommandRef = useRef<PendingWheelCommand | null>(null)
  const wheelCommandInFlightRef = useRef(false)
  const zoomRef = useRef<BrowserZoomState>(DEFAULT_ZOOM)
  const pinchRef = useRef<PinchGesture | null>(null)
  const panRef = useRef<PanGesture | null>(null)
  const scrollingRef = useRef(false)
  const lastZoomResetUrlRef = useRef(tab.url || 'about:blank')

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const setRootViewRef = useCallback(
    (node: View | null) => {
      // Why: long-press right-click timers belong to this responder surface;
      // clearing from ref cleanup preserves the same unmount boundary.
      if (node === null) {
        clearLongPressTimer()
      }
    },
    [clearLongPressTimer]
  )

  const resetBrowserZoomState = useCallback(() => {
    clearLongPressTimer()
    pinchRef.current = null
    panRef.current = null
    scrollingRef.current = false
    startPointRef.current = null
    zoomRef.current = DEFAULT_ZOOM
    setZoom(DEFAULT_ZOOM)
  }, [clearLongPressTimer])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const active = nextState === 'active'
      if (!active) {
        clearCachedBrowserFramesForWorktree(worktreeId)
      }
      setAppActive(active)
    })
    return () => {
      subscription.remove()
    }
  }, [worktreeId])

  const addressSync = resolveMobileBrowserAddressSync(addressSyncState, {
    focused: addressFocused,
    url: tab.url
  })
  if (addressSync.nextState !== addressSyncState) {
    setAddressSyncState(addressSync.nextState)
    if (addressSync.shouldSyncValue) {
      // Why: keep browser stream/goto address updates intact, but avoid a
      // stale post-blur paint when the tab URL is the source of truth.
      setAddressValue(displayBrowserUrl(tab.url))
    }
  }

  useLayoutEffect(() => {
    // Why: gesture and stream handlers need committed values before passive
    // Effects flush, without leaking refs from an uncommitted render.
    frameMetadataRef.current = frameMetadata
    layoutRef.current = layout
    dialogRef.current = dialog
    zoomRef.current = zoom
  }, [dialog, frameMetadata, layout, zoom])

  useEffect(() => {
    lastZoomResetUrlRef.current = tab.url || 'about:blank'
    resetBrowserZoomState()
  }, [resetBrowserZoomState, tab.browserPageId, tab.url])

  const pageParams = useCallback(() => {
    if (!tab.browserPageId) {
      return null
    }
    return {
      worktree: `id:${worktreeId}`,
      page: tab.browserPageId
    }
  }, [tab.browserPageId, worktreeId])

  const { streamRequest, frameGeometry } = useMobileBrowserFrameStream({
    client,
    worktreeId,
    tab,
    screencastSupported,
    browserViewMode,
    appActive,
    cacheKey,
    layout,
    frameMetadata,
    frameMetadataRef,
    frameUriRef,
    frameMountedRef,
    browserImageRefs,
    browserLayerRefs,
    pendingFrameLayerRef,
    visibleFrameLayerRef,
    readyRef,
    busyRef,
    dialogRef,
    zoomRef,
    lastZoomResetUrlRef,
    setFrameUri,
    setFrameMetadata,
    setReady,
    setBusy,
    setError,
    setDialog,
    setAddressValue,
    setZoom,
    resetBrowserZoomState
  })

  const {
    sendBrowserRequest,
    navigateToAddress,
    panResponder,
    sendKeyboardText,
    sendKeypress,
    sendDialogCommand,
    togglePointerModifier
  } = useMobileBrowserPaneInteractions({
    client,
    tab,
    addressValue,
    setAddressValue,
    keyboardValue,
    setKeyboardValue,
    pointerModifiers,
    setPointerModifiers,
    frameGeometry,
    layoutRef,
    frameMetadataRef,
    zoomRef,
    dialogRef,
    setZoom,
    setDialog,
    setBusy,
    busyRef,
    setError,
    onToast,
    pageParams,
    resetBrowserZoomState,
    lastZoomResetUrlRef,
    clearLongPressTimer,
    startPointRef,
    longPressTimerRef,
    rightClickSentRef,
    lastWheelRef,
    wheelGestureIdRef,
    pendingWheelCommandRef,
    wheelCommandInFlightRef,
    pinchRef,
    panRef,
    scrollingRef
  })
  const setBrowserImageRef = useCallback((layer: FrameLayer, image: Image | null) => {
    browserImageRefs.current[layer] = image
    const currentFrameUri = frameUriRef.current
    if (image && currentFrameUri) {
      updateBrowserImageSource(image, currentFrameUri)
    }
  }, [])
  const setBrowserLayerRef = useCallback((layer: FrameLayer, view: View | null) => {
    browserLayerRefs.current[layer] = view
    updateBrowserLayerVisibility(browserLayerRefs.current, visibleFrameLayerRef.current)
  }, [])
  const setBrowserLayer0Ref = useCallback(
    (view: View | null) => setBrowserLayerRef(0, view),
    [setBrowserLayerRef]
  )
  const setBrowserLayer1Ref = useCallback(
    (view: View | null) => setBrowserLayerRef(1, view),
    [setBrowserLayerRef]
  )
  const setBrowserImageLayer0Ref = useCallback(
    (image: Image | null) => setBrowserImageRef(0, image),
    [setBrowserImageRef]
  )
  const setBrowserImageLayer1Ref = useCallback(
    (image: Image | null) => setBrowserImageRef(1, image),
    [setBrowserImageRef]
  )

  const handleBrowserImageLoad = useCallback((layer: FrameLayer) => {
    if (pendingFrameLayerRef.current !== layer) {
      return
    }
    pendingFrameLayerRef.current = null
    visibleFrameLayerRef.current = layer
    updateBrowserLayerVisibility(browserLayerRefs.current, layer)
  }, [])
  const handleBrowserImageLayer0Load = useCallback(
    () => handleBrowserImageLoad(0),
    [handleBrowserImageLoad]
  )
  const handleBrowserImageLayer1Load = useCallback(
    () => handleBrowserImageLoad(1),
    [handleBrowserImageLoad]
  )
  const handleBrowserImageError = useCallback((layer: FrameLayer) => {
    if (pendingFrameLayerRef.current === layer) {
      pendingFrameLayerRef.current = null
    }
  }, [])
  const handleBrowserImageLayer0Error = useCallback(
    () => handleBrowserImageError(0),
    [handleBrowserImageError]
  )
  const handleBrowserImageLayer1Error = useCallback(
    () => handleBrowserImageError(1),
    [handleBrowserImageError]
  )

  const controlsDisabled = !client || !tab.browserPageId || screencastSupported !== true
  const addressSelection = useMemo(
    () => (addressFocused ? undefined : { start: 0, end: 0 }),
    [addressFocused]
  )
  const goBack = useCallback(() => {
    if (controlsDisabled || !tab.canGoBack) {
      return
    }
    void sendBrowserRequest('browser.back', {}, { suppressError: true })
  }, [controlsDisabled, sendBrowserRequest, tab.canGoBack])
  const goForward = useCallback(() => {
    if (controlsDisabled || !tab.canGoForward) {
      return
    }
    void sendBrowserRequest('browser.forward', {}, { suppressError: true })
  }, [controlsDisabled, sendBrowserRequest, tab.canGoForward])
  const reloadPage = useCallback(() => {
    if (controlsDisabled) {
      return
    }
    void sendBrowserRequest('browser.reload', {}, { suppressError: true })
  }, [controlsDisabled, sendBrowserRequest])
  const selectBrowserViewMode = useCallback(
    (mode: MobileBrowserViewMode) => {
      if (browserViewMode === mode) {
        return
      }
      // Why: browser panes can remount during normal tab/workspace navigation;
      // keep a page-scoped choice while new browser pages still default to Web.
      saveMobileBrowserViewMode(worktreeId, tab.browserPageId, mode)
      setBrowserViewMode(mode)
      resetBrowserZoomState()
    },
    [browserViewMode, resetBrowserZoomState, tab.browserPageId, worktreeId]
  )
  const renderedFrameSource =
    frameUriRef.current || frameUri ? { uri: frameUriRef.current ?? frameUri! } : null
  const frameLayerStyle = useCallback((layer: FrameLayer) => {
    return [
      styles.browserImageLayer,
      visibleFrameLayerRef.current !== layer && styles.browserImageLayerHidden
    ]
  }, [])
  const browserLayerRef = useCallback(
    (layer: FrameLayer) => (layer === 0 ? setBrowserLayer0Ref : setBrowserLayer1Ref),
    [setBrowserLayer0Ref, setBrowserLayer1Ref]
  )
  const frameLayerRef = useCallback(
    (layer: FrameLayer) => (layer === 0 ? setBrowserImageLayer0Ref : setBrowserImageLayer1Ref),
    [setBrowserImageLayer0Ref, setBrowserImageLayer1Ref]
  )
  const frameLayerLoadHandler = useCallback(
    (layer: FrameLayer) =>
      layer === 0 ? handleBrowserImageLayer0Load : handleBrowserImageLayer1Load,
    [handleBrowserImageLayer0Load, handleBrowserImageLayer1Load]
  )
  const frameLayerErrorHandler = useCallback(
    (layer: FrameLayer) =>
      layer === 0 ? handleBrowserImageLayer0Error : handleBrowserImageLayer1Error,
    [handleBrowserImageLayer0Error, handleBrowserImageLayer1Error]
  )

  return (
    <MobileBrowserPaneView
      tab={tab}
      controlsDisabled={controlsDisabled}
      browserViewMode={browserViewMode}
      addressValue={addressValue}
      addressSelection={addressSelection}
      keyboardValue={keyboardValue}
      pointerModifiers={pointerModifiers}
      keyboardLift={keyboardLift}
      bottomInset={bottomInset}
      busy={busy}
      ready={ready}
      error={error}
      dialog={dialog}
      zoom={zoom}
      layoutRef={layoutRef}
      frameGeometry={frameGeometry}
      renderedFrameSource={renderedFrameSource}
      panResponder={panResponder}
      setRootViewRef={setRootViewRef}
      onAddressChange={setAddressValue}
      onAddressFocus={() => setAddressFocused(true)}
      onAddressBlur={() => setAddressFocused(false)}
      onAddressSubmit={() => void navigateToAddress()}
      onKeyboardChange={setKeyboardValue}
      onKeyboardSubmit={() => void sendKeyboardText()}
      onGoBack={goBack}
      onGoForward={goForward}
      onReload={reloadPage}
      onViewModeChange={selectBrowserViewMode}
      onViewportLayout={(next) => {
        layoutRef.current = next
        setLayout(next)
      }}
      onTogglePointerModifier={togglePointerModifier}
      onKeypress={(key) => void sendKeypress(key)}
      onSendKeyboardText={() => void sendKeyboardText()}
      onDialogCommand={(method) => void sendDialogCommand(method)}
      frameLayerStyle={frameLayerStyle}
      browserLayerRef={browserLayerRef}
      frameLayerRef={frameLayerRef}
      frameLayerLoadHandler={frameLayerLoadHandler}
      frameLayerErrorHandler={frameLayerErrorHandler}
    />
  )
}
