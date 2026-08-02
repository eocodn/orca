import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Image, PixelRatio, View } from 'react-native'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { BrowserScreencastFrame, BrowserScreencastFrameMetadata } from '../transport/browser-screencast-protocol'
import { MOBILE_BROWSER_FRAME_MIN_INTERVAL_MS, buildMobileBrowserScreencastRequest, type MobileBrowserViewMode } from './browser-screencast-request'
import { clampBrowserZoomState, computeBrowserFrameGeometry, type BrowserTouchLayout, type BrowserZoomState } from './browser-touch-geometry'
import { displayBrowserUrl } from './browser-url'
import { browserFrameMetadataEqual, cacheBrowserFrame, createBrowserFrameDataUri, getCachedBrowserFrame, MAX_ZOOM, MIN_ZOOM, shouldSurfaceBrowserError, updateBrowserImageSource, updateBrowserLayerVisibility, type FrameLayer } from './mobile-browser-pane-support'
import type { BrowserDialogState, MobileBrowserTab } from './mobile-browser-pane-types'

type Props = {
  client: import('../transport/rpc-client').RpcClient | null
  worktreeId: string
  tab: MobileBrowserTab
  screencastSupported: boolean | null
  browserViewMode: MobileBrowserViewMode
  appActive: boolean
  cacheKey: string
  layout: BrowserTouchLayout | null
  frameMetadata: BrowserScreencastFrameMetadata | null
  frameMetadataRef: MutableRefObject<BrowserScreencastFrameMetadata | null>
  frameUriRef: MutableRefObject<string | null>
  frameMountedRef: MutableRefObject<boolean>
  browserImageRefs: MutableRefObject<[Image | null, Image | null]>
  browserLayerRefs: MutableRefObject<[View | null, View | null]>
  pendingFrameLayerRef: MutableRefObject<FrameLayer | null>
  visibleFrameLayerRef: MutableRefObject<FrameLayer>
  readyRef: MutableRefObject<boolean>
  busyRef: MutableRefObject<boolean>
  dialogRef: MutableRefObject<BrowserDialogState | null>
  zoomRef: MutableRefObject<BrowserZoomState>
  lastZoomResetUrlRef: MutableRefObject<string>
  setFrameUri: Dispatch<SetStateAction<string | null>>
  setFrameMetadata: Dispatch<SetStateAction<BrowserScreencastFrameMetadata | null>>
  setReady: Dispatch<SetStateAction<boolean>>
  setBusy: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  setDialog: Dispatch<SetStateAction<BrowserDialogState | null>>
  setAddressValue: Dispatch<SetStateAction<string>>
  setZoom: Dispatch<SetStateAction<BrowserZoomState>>
  resetBrowserZoomState: () => void
}

export function useMobileBrowserFrameStream({
  client, worktreeId, tab, screencastSupported, browserViewMode, appActive, cacheKey, layout,
  frameMetadata, frameMetadataRef, frameUriRef, frameMountedRef, browserImageRefs, browserLayerRefs,
  pendingFrameLayerRef, visibleFrameLayerRef, readyRef, busyRef, dialogRef, zoomRef, lastZoomResetUrlRef,
  setFrameUri, setFrameMetadata, setReady, setBusy, setError, setDialog, setAddressValue, setZoom,
  resetBrowserZoomState
}: Props) {
  const streamGenerationRef = useRef(0)
  const lastAppliedFrameAtRef = useRef(0)
  const pendingThrottledFrameRef = useRef<{ frame: BrowserScreencastFrame; cacheKey: string } | null>(null)
  const frameThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastStreamCacheKeyRef = useRef<string | null>(cacheKey)

  const applyFrame = useCallback((frame: BrowserScreencastFrame, frameCacheKey: string): void => {
    if (!browserFrameMetadataEqual(frameMetadataRef.current, frame.metadata)) {
      frameMetadataRef.current = frame.metadata
      setFrameMetadata(frame.metadata)
    }
    const nextFrameUri = createBrowserFrameDataUri(frame)
    cacheBrowserFrame(frameCacheKey, { uri: nextFrameUri, metadata: frame.metadata })
    if (!frameMountedRef.current) {
      frameUriRef.current = nextFrameUri
      frameMountedRef.current = true
      setFrameUri(nextFrameUri)
      updateBrowserImageSource(browserImageRefs.current[0], nextFrameUri)
    } else if (pendingFrameLayerRef.current === null) {
      // Why: decode the next frame offscreen and keep the previous layer visible
      // until onLoad; replacing the visible Image directly flashes black.
      const nextLayer: FrameLayer = visibleFrameLayerRef.current === 0 ? 1 : 0
      frameUriRef.current = nextFrameUri
      pendingFrameLayerRef.current = nextLayer
      updateBrowserImageSource(browserImageRefs.current[nextLayer], nextFrameUri)
    } else {
      // Why: popovers/menus can settle in one final frame while the previous
      // offscreen frame is still decoding. Keep the hidden layer pointed at
      // the newest frame instead of dropping the final static state.
      frameUriRef.current = nextFrameUri
      updateBrowserImageSource(browserImageRefs.current[pendingFrameLayerRef.current], nextFrameUri)
    }
    if (busyRef.current) {
      busyRef.current = false
      setBusy(false)
    }
    if (!readyRef.current) {
      readyRef.current = true
      setReady(true)
    }
  }, [])

  const clearFrameThrottle = useCallback(() => {
    pendingThrottledFrameRef.current = null
    if (frameThrottleTimerRef.current) {
      clearTimeout(frameThrottleTimerRef.current)
      frameThrottleTimerRef.current = null
    }
  }, [])

  const applyFrameThrottled = useCallback(
    (frame: BrowserScreencastFrame, frameCacheKey: string): void => {
      const now = Date.now()
      const elapsed = now - lastAppliedFrameAtRef.current
      if (lastAppliedFrameAtRef.current === 0 || elapsed >= MOBILE_BROWSER_FRAME_MIN_INTERVAL_MS) {
        clearFrameThrottle()
        lastAppliedFrameAtRef.current = now
        applyFrame(frame, frameCacheKey)
        return
      }

      // Why: static UI changes can be the last frame Chromium emits. Coalesce
      // throttled frames so the final visible state is applied after the delay.
      pendingThrottledFrameRef.current = { frame, cacheKey: frameCacheKey }
      if (frameThrottleTimerRef.current) {
        return
      }
      frameThrottleTimerRef.current = setTimeout(
        () => {
          frameThrottleTimerRef.current = null
          const pending = pendingThrottledFrameRef.current
          pendingThrottledFrameRef.current = null
          if (!pending) {
            return
          }
          lastAppliedFrameAtRef.current = Date.now()
          applyFrame(pending.frame, pending.cacheKey)
        },
        Math.max(0, MOBILE_BROWSER_FRAME_MIN_INTERVAL_MS - elapsed)
      )
    },
    [applyFrame, clearFrameThrottle]
  )

  const streamRequest = useMemo(
    () => buildMobileBrowserScreencastRequest(layout, PixelRatio.get(), browserViewMode),
    [browserViewMode, layout]
  )

  const frameGeometry = useMemo(
    () => computeBrowserFrameGeometry(layout, frameMetadata),
    [frameMetadata, layout]
  )

  useEffect(() => {
    if (!frameGeometry) {
      return
    }
    setZoom((current) => {
      const next = clampBrowserZoomState(current, frameGeometry, MIN_ZOOM, MAX_ZOOM)
      if (
        next.scale === current.scale &&
        next.offsetX === current.offsetX &&
        next.offsetY === current.offsetY
      ) {
        return current
      }
      // Why: rotation/layout changes can shrink the legal pan range while the
      // current zoom state still points at the previous viewport geometry.
      zoomRef.current = next
      return next
    })
  }, [frameGeometry])

  useEffect(() => {
    streamGenerationRef.current += 1
    const generation = streamGenerationRef.current
    const sameStream = Boolean(cacheKey) && lastStreamCacheKeyRef.current === cacheKey
    lastStreamCacheKeyRef.current = cacheKey
    if (!sameStream || !frameUriRef.current) {
      const cachedFrame = getCachedBrowserFrame(cacheKey)
      if (cachedFrame) {
        frameUriRef.current = cachedFrame.uri
        frameMountedRef.current = true
        frameMetadataRef.current = cachedFrame.metadata
        setFrameUri(cachedFrame.uri)
        setFrameMetadata(cachedFrame.metadata)
        readyRef.current = true
        setReady(true)
      } else {
        frameUriRef.current = null
        frameMountedRef.current = false
        setFrameUri(null)
        setFrameMetadata(null)
        frameMetadataRef.current = null
        readyRef.current = false
        setReady(false)
      }
    } else {
      frameMountedRef.current = true
    }
    pendingFrameLayerRef.current = null
    if (!sameStream || !frameUriRef.current) {
      visibleFrameLayerRef.current = 0
    }
    updateBrowserLayerVisibility(browserLayerRefs.current, visibleFrameLayerRef.current)
    lastAppliedFrameAtRef.current = 0
    clearFrameThrottle()
    busyRef.current = false
    setDialog(null)
    setError(null)
    if (
      !client ||
      screencastSupported !== true ||
      !tab.browserPageId ||
      !appActive ||
      !streamRequest
    ) {
      busyRef.current = false
      setBusy(false)
      if (screencastSupported === false) {
        setError('Update desktop Orca to stream browser tabs on mobile.')
      } else if (screencastSupported === null) {
        setError('Checking desktop browser streaming support.')
      } else if (!tab.browserPageId) {
        setError('Browser page is not available yet.')
      }
      return
    }
    busyRef.current = true
    setBusy(true)
    let startupTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      if (streamGenerationRef.current !== generation) {
        return
      }
      busyRef.current = false
      setBusy(false)
      setError('Browser stream timed out.')
    }, 15_000)
    const clearStartupTimer = (): void => {
      if (startupTimer) {
        clearTimeout(startupTimer)
        startupTimer = null
      }
    }
    const unsubscribe = client.subscribe(
      'browser.screencast',
      {
        worktree: `id:${worktreeId}`,
        page: tab.browserPageId,
        ...streamRequest
      },
      (payload) => {
        if (streamGenerationRef.current !== generation) {
          return
        }
        const event = payload as {
          type?: string
          message?: string
          error?: { message?: string }
          dialogType?: string
          tab?: { url?: string; title?: string; canGoBack?: boolean; canGoForward?: boolean }
        }
        if (event.type === 'ready') {
          clearStartupTimer()
          if (!readyRef.current) {
            readyRef.current = true
            setReady(true)
          }
          if (busyRef.current) {
            busyRef.current = false
            setBusy(false)
          }
          if (typeof event.tab?.url === 'string') {
            setAddressValue(displayBrowserUrl(event.tab.url))
            if (event.tab.url !== lastZoomResetUrlRef.current) {
              lastZoomResetUrlRef.current = event.tab.url
              resetBrowserZoomState()
            }
          }
        } else if (event.type === 'end') {
          clearStartupTimer()
          if (readyRef.current) {
            readyRef.current = false
            setReady(false)
          }
          if (busyRef.current) {
            busyRef.current = false
            setBusy(false)
          }
        } else if (event.type === 'dialog') {
          setDialog({
            dialogType: event.dialogType ?? 'alert',
            message: event.message ?? 'Browser dialog'
          })
        } else if (event.type === 'dialogClosed') {
          setDialog(null)
        } else if (event.type === 'error') {
          clearStartupTimer()
          if (busyRef.current) {
            busyRef.current = false
            setBusy(false)
          }
          const message = event.message ?? event.error?.message ?? 'Browser stream failed.'
          if (shouldSurfaceBrowserError(message)) {
            if (readyRef.current) {
              readyRef.current = false
              setReady(false)
            }
            setError(message)
          }
        }
      },
      {
        onBinaryFrame: (frame) => {
          if (streamGenerationRef.current !== generation) {
            return
          }
          clearStartupTimer()
          if (cacheKey) {
            applyFrameThrottled(frame, cacheKey)
          }
        }
      }
    )
    return () => {
      clearStartupTimer()
      clearFrameThrottle()
      unsubscribe()
    }
  }, [
    appActive,
    applyFrameThrottled,
    clearFrameThrottle,
    client,
    resetBrowserZoomState,
    screencastSupported,
    streamRequest,
    cacheKey,
    tab.browserPageId,
    worktreeId
  ])


  return { streamRequest, frameGeometry }
}
