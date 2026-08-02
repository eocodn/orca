import { useCallback, useMemo } from 'react'
import { PanResponder, type GestureResponderEvent, type PanResponderGestureState } from 'react-native'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcFailure, RpcSuccess } from '../transport/types'
import type { BrowserPoint, BrowserTouchLayout, BrowserZoomState, BrowserFrameGeometry } from './browser-touch-geometry'
import { clampBrowserZoomState, computeBrowserFrameGeometry, computeBrowserTouchClickRadiusCss, mapScreenToBrowserPoint, readLocalTouchPoint } from './browser-touch-geometry'
import { displayBrowserUrl, normalizeBrowserUrl } from './browser-url'
import type { BrowserPointerModifier } from './MobileBrowserPointerModifiers'
import { assertRpcOk, browserErrorMessage, createPinchGesture, MAX_ZOOM, MIN_ZOOM, shouldSurfaceBrowserError, updatePinchZoom } from './mobile-browser-pane-support'
import type { MobileBrowserTab, PanGesture, PendingWheelCommand } from './MobileBrowserPane'

const TAP_SLOP = 16
const SCROLL_START_SLOP = 22
const LONG_PRESS_MS = 550
const WHEEL_INTERVAL_MS = 70
const TOUCH_CLICK_RADIUS_DIP = 14

type Props = {
  client: RpcClient | null
  tab: MobileBrowserTab
  addressValue: string
  setAddressValue: (value: string) => void
  keyboardValue: string
  setKeyboardValue: (value: string) => void
  pointerModifiers: BrowserPointerModifier[]
  setPointerModifiers: React.Dispatch<React.SetStateAction<BrowserPointerModifier[]>>
  frameGeometry: BrowserFrameGeometry | null
  layoutRef: React.MutableRefObject<BrowserTouchLayout | null>
  frameMetadataRef: React.MutableRefObject<import('../transport/browser-screencast-protocol').BrowserScreencastFrameMetadata | null>
  zoomRef: React.MutableRefObject<BrowserZoomState>
  dialogRef: React.MutableRefObject<{ dialogType: string; message: string } | null>
  setZoom: (zoom: BrowserZoomState) => void
  setDialog: (dialog: { dialogType: string; message: string } | null) => void
  setBusy: (busy: boolean) => void
  busyRef: React.MutableRefObject<boolean>
  setError: (error: string | null) => void
  onToast: (message: string, durationMs?: number) => void
  pageParams: () => { worktree: string; page: string } | null
  resetBrowserZoomState: () => void
  lastZoomResetUrlRef: React.MutableRefObject<string>
  clearLongPressTimer: () => void
  startPointRef: React.MutableRefObject<{ x: number; y: number; t: number } | null>
  longPressTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
  rightClickSentRef: React.MutableRefObject<boolean>
  lastWheelRef: React.MutableRefObject<{ dx: number; dy: number; at: number }>
  wheelGestureIdRef: React.MutableRefObject<number>
  pendingWheelCommandRef: React.MutableRefObject<PendingWheelCommand | null>
  wheelCommandInFlightRef: React.MutableRefObject<boolean>
  pinchRef: React.MutableRefObject<import('./mobile-browser-pane-support').PinchGesture | null>
  panRef: React.MutableRefObject<PanGesture | null>
  scrollingRef: React.MutableRefObject<boolean>
}

export function useMobileBrowserPaneInteractions({
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
}: Props) {
  const sendBrowserRequest = useCallback(
    async (
      method: string,
      params: Record<string, unknown> = {},
      opts: { showBusy?: boolean; suppressError?: boolean; timeoutMs?: number } = {}
    ): Promise<unknown | null> => {
      const base = pageParams()
      if (!client || !base) {
        return null
      }
      if (opts.showBusy) {
        busyRef.current = true
        setBusy(true)
      }
      try {
        const response = await client.sendRequest(
          method,
          { ...base, ...params },
          { timeoutMs: opts.timeoutMs ?? 15_000 }
        )
        if (!response.ok) {
          throw new Error((response as RpcFailure).error.message)
        }
        setError(null)
        return (response as RpcSuccess).result
      } catch (err) {
        const message = browserErrorMessage(err, 'Browser command failed')
        if (!opts.suppressError && shouldSurfaceBrowserError(message)) {
          setError(message)
        }
        return null
      } finally {
        if (opts.showBusy) {
          busyRef.current = false
          setBusy(false)
        }
      }
    },
    [client, pageParams]
  )

  const navigateToAddress = useCallback(async () => {
    const url = normalizeBrowserUrl(addressValue)
    if (!url) {
      setError('Enter a valid URL.')
      return
    }
    const result = (await sendBrowserRequest(
      'browser.goto',
      { url },
      { showBusy: true, timeoutMs: 30_000 }
    )) as { url?: string } | null
    if (typeof result?.url === 'string') {
      setAddressValue(displayBrowserUrl(result.url))
      lastZoomResetUrlRef.current = result.url
      resetBrowserZoomState()
    }
  }, [addressValue, resetBrowserZoomState, sendBrowserRequest])

  const flushPendingWheelCommand = useCallback(() => {
    if (wheelCommandInFlightRef.current) {
      return
    }
    const pending = pendingWheelCommandRef.current
    if (!pending || !client) {
      return
    }
    pendingWheelCommandRef.current = null
    wheelCommandInFlightRef.current = true
    void (async () => {
      try {
        assertRpcOk(
          await client.sendRequest('browser.mouseMove', {
            ...pending.base,
            x: pending.point.x,
            y: pending.point.y
          }),
          'Browser pointer move failed'
        )
        assertRpcOk(
          await client.sendRequest('browser.mouseWheel', {
            ...pending.base,
            dx: pending.dx,
            dy: pending.dy
          }),
          'Browser scroll failed'
        )
        setError(null)
      } catch {
        // Scroll bursts commonly race page reload/navigation. Avoid replacing
        // the live browser with transient command errors like selector_not_found.
      } finally {
        wheelCommandInFlightRef.current = false
        flushPendingWheelCommand()
      }
    })()
  }, [client])

  const sendPointerClick = useCallback(
    async (point: BrowserPoint, button: 'left' | 'right') => {
      const base = pageParams()
      if (!client || !base) {
        return
      }
      const clickResult = await sendBrowserRequest(
        'browser.mouseClick',
        {
          x: point.x,
          y: point.y,
          button,
          modifiers: pointerModifiers,
          ...(button === 'left'
            ? {
                radius: computeBrowserTouchClickRadiusCss(
                  layoutRef.current,
                  frameMetadataRef.current,
                  zoomRef.current,
                  TOUCH_CLICK_RADIUS_DIP
                )
              }
            : {})
        },
        { suppressError: true, timeoutMs: 5_000 }
      )
      if (clickResult !== null || pointerModifiers.length > 0) {
        return
      }
      try {
        assertRpcOk(
          await client.sendRequest('browser.mouseMove', { ...base, x: point.x, y: point.y }),
          'Browser pointer move failed'
        )
        assertRpcOk(
          await client.sendRequest('browser.mouseDown', { ...base, button }),
          'Browser pointer down failed'
        )
        assertRpcOk(
          await client.sendRequest('browser.mouseUp', { ...base, button }),
          'Browser pointer up failed'
        )
        setError(null)
      } catch {
        // Pointer commands can race page navigation. Keep the stream visible;
        // actionable failures still surface through navigation/stream errors.
      }
    },
    [client, pageParams, pointerModifiers, sendBrowserRequest]
  )

  const togglePointerModifier = useCallback((modifier: BrowserPointerModifier) => {
    setPointerModifiers((current) =>
      current.includes(modifier)
        ? current.filter((candidate) => candidate !== modifier)
        : [...current, modifier]
    )
  }, [])

  const sendWheel = useCallback(
    (point: BrowserPoint, screenDx: number, screenDy: number) => {
      const base = pageParams()
      if (!client || !base) {
        return
      }
      const currentLayout = layoutRef.current
      const geometry = computeBrowserFrameGeometry(currentLayout, frameMetadataRef.current)
      const localZoom = zoomRef.current.scale
      const scale = (geometry?.scale ?? 1) * localZoom
      const cssDx = screenDx / scale
      const cssDy = screenDy / scale
      const delta = { dx: Math.round(-cssDx), dy: Math.round(-cssDy) }
      if (Math.abs(delta.dx) < 1 && Math.abs(delta.dy) < 1) {
        return
      }
      const pending = pendingWheelCommandRef.current
      pendingWheelCommandRef.current =
        pending &&
        pending.base.page === base.page &&
        pending.gestureId === wheelGestureIdRef.current
          ? {
              base,
              point,
              gestureId: wheelGestureIdRef.current,
              dx: pending.dx + delta.dx,
              dy: pending.dy + delta.dy
            }
          : { base, point, gestureId: wheelGestureIdRef.current, ...delta }
      flushPendingWheelCommand()
    },
    [client, flushPendingWheelCommand, pageParams]
  )

  const mapTouchPoint = useCallback((locationX: number, locationY: number): BrowserPoint | null => {
    return mapScreenToBrowserPoint(
      locationX,
      locationY,
      layoutRef.current,
      frameMetadataRef.current,
      zoomRef.current
    )
  }, [])

  const handleResponderGrant = useCallback(
    (event: GestureResponderEvent) => {
      const pinch = createPinchGesture(event, frameGeometry, zoomRef.current)
      if (pinch) {
        clearLongPressTimer()
        pinchRef.current = pinch
        panRef.current = null
        startPointRef.current = null
        return
      }
      const startPoint = readLocalTouchPoint(event.nativeEvent)
      if (!startPoint) {
        return
      }
      startPointRef.current = { x: startPoint.x, y: startPoint.y, t: Date.now() }
      rightClickSentRef.current = false
      scrollingRef.current = false
      wheelGestureIdRef.current += 1
      lastWheelRef.current = { dx: 0, dy: 0, at: 0 }
      panRef.current =
        zoomRef.current.scale > MIN_ZOOM
          ? {
              x: startPoint.x,
              y: startPoint.y,
              offsetX: zoomRef.current.offsetX,
              offsetY: zoomRef.current.offsetY
            }
          : null
      clearLongPressTimer()
      longPressTimerRef.current = setTimeout(() => {
        const start = startPointRef.current
        if (!start) {
          return
        }
        const point = mapTouchPoint(start.x, start.y)
        if (!point) {
          return
        }
        rightClickSentRef.current = true
        void sendPointerClick(point, 'right')
        onToast('Right click')
      }, LONG_PRESS_MS)
    },
    [clearLongPressTimer, frameGeometry, mapTouchPoint, onToast, sendPointerClick]
  )

  const handleResponderMove = useCallback(
    (event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      const startedPinch = pinchRef.current
        ? null
        : createPinchGesture(event, frameGeometry, zoomRef.current)
      if (startedPinch) {
        clearLongPressTimer()
        pinchRef.current = startedPinch
        panRef.current = null
        startPointRef.current = null
      }
      const activePinch = pinchRef.current
      const nextPinch = activePinch ? updatePinchZoom(event, frameGeometry, activePinch) : null
      if (nextPinch) {
        clearLongPressTimer()
        zoomRef.current = nextPinch
        setZoom(nextPinch)
        return
      }
      if (activePinch) {
        pinchRef.current = null
      }
      const moved = Math.hypot(gesture.dx, gesture.dy)
      if (moved > TAP_SLOP) {
        clearLongPressTimer()
      }
      const activePan = panRef.current
      if (activePan && frameGeometry) {
        const currentPoint = readLocalTouchPoint(event.nativeEvent)
        if (!currentPoint) {
          return
        }
        if (!scrollingRef.current && moved <= TAP_SLOP) {
          return
        }
        scrollingRef.current = true
        startPointRef.current = null
        const nextZoom = clampBrowserZoomState(
          {
            scale: zoomRef.current.scale,
            offsetX: activePan.offsetX + currentPoint.x - activePan.x,
            offsetY: activePan.offsetY + currentPoint.y - activePan.y
          },
          frameGeometry,
          MIN_ZOOM,
          MAX_ZOOM
        )
        zoomRef.current = nextZoom
        setZoom(nextZoom)
        return
      }
      if (!scrollingRef.current) {
        if (moved <= SCROLL_START_SLOP) {
          return
        }
        scrollingRef.current = true
        startPointRef.current = null
      }
      const now = Date.now()
      if (now - lastWheelRef.current.at < WHEEL_INTERVAL_MS) {
        return
      }
      const deltaX = gesture.dx - lastWheelRef.current.dx
      const deltaY = gesture.dy - lastWheelRef.current.dy
      if (Math.abs(deltaX) + Math.abs(deltaY) < 8) {
        return
      }
      const currentPoint = readLocalTouchPoint(event.nativeEvent)
      if (!currentPoint) {
        return
      }
      const point = mapTouchPoint(currentPoint.x, currentPoint.y)
      if (!point) {
        return
      }
      lastWheelRef.current = { dx: gesture.dx, dy: gesture.dy, at: now }
      sendWheel(point, deltaX, deltaY)
    },
    [clearLongPressTimer, frameGeometry, mapTouchPoint, sendWheel]
  )

  const handleResponderRelease = useCallback(
    (event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      clearLongPressTimer()
      pinchRef.current = null
      panRef.current = null
      const start = startPointRef.current
      startPointRef.current = null
      const wasScrolling = scrollingRef.current
      scrollingRef.current = false
      if (!start || rightClickSentRef.current || wasScrolling) {
        return
      }
      const moved = Math.hypot(gesture.dx, gesture.dy)
      if (moved <= TAP_SLOP && Date.now() - start.t < LONG_PRESS_MS) {
        // Why: native browser taps resolve at touch-up. Using touch-down makes
        // tiny finger drift feel like the click lands left/up of the finger.
        const release = readLocalTouchPoint(event.nativeEvent) ?? start
        const point = mapTouchPoint(release.x, release.y)
        if (point) {
          void sendPointerClick(point, 'left')
        }
      }
    },
    [clearLongPressTimer, mapTouchPoint, sendPointerClick]
  )

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => dialogRef.current === null,
        onMoveShouldSetPanResponder: () => dialogRef.current === null,
        onPanResponderGrant: handleResponderGrant,
        onPanResponderMove: handleResponderMove,
        onPanResponderRelease: handleResponderRelease,
        onPanResponderTerminate: () => {
          clearLongPressTimer()
          pinchRef.current = null
          panRef.current = null
          scrollingRef.current = false
          startPointRef.current = null
        },
        onPanResponderTerminationRequest: () => true
      }),
    [clearLongPressTimer, handleResponderGrant, handleResponderMove, handleResponderRelease]
  )

  const sendKeyboardText = useCallback(async () => {
    const text = keyboardValue
    if (!text) {
      return
    }
    setKeyboardValue('')
    const result = await sendBrowserRequest(
      'browser.keyboardInsertText',
      { text },
      { suppressError: true }
    )
    if (result !== null) {
      onToast('Sent')
    } else {
      setKeyboardValue(text)
    }
  }, [keyboardValue, onToast, sendBrowserRequest])

  const sendKeypress = useCallback(
    async (key: string) => {
      await sendBrowserRequest('browser.keypress', { key }, { suppressError: true })
    },
    [sendBrowserRequest]
  )

  const sendDialogCommand = useCallback(
    async (method: 'browser.dialogAccept' | 'browser.dialogDismiss') => {
      setDialog(null)
      await sendBrowserRequest(method, {}, { suppressError: true, timeoutMs: 5_000 })
    },
    [sendBrowserRequest]
  )


  return {
    sendBrowserRequest,
    navigateToAddress,
    panResponder,
    sendKeyboardText,
    sendKeypress,
    sendDialogCommand,
    togglePointerModifier
  }
}
