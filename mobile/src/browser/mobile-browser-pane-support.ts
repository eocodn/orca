import { Buffer } from 'buffer'
import { Image, StyleSheet, View, type GestureResponderEvent } from 'react-native'
import type { RpcFailure, RpcSuccess } from '../transport/types'
import type { BrowserScreencastFrame, BrowserScreencastFrameMetadata } from '../transport/browser-screencast-protocol'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import type { MobileBrowserViewMode } from './browser-screencast-request'
import {
  clampBrowserZoomState,
  readLocalTouchPoint,
  type BrowserFrameGeometry,
  type BrowserPoint,
  type BrowserZoomState
} from './browser-touch-geometry'

export type FrameLayer = 0 | 1

export type PinchGesture = {
  distance: number
  scale: number
  anchorX: number
  anchorY: number
}

export type BrowserFrameCacheEntry = {
  uri: string
  metadata: BrowserScreencastFrameMetadata
}

export const MIN_ZOOM = 1
export const MAX_ZOOM = 3.5
export const BROWSER_FRAME_CACHE_LIMIT = 4

export function buttonColor(enabled: boolean): string {
  return enabled ? colors.textSecondary : colors.textMuted
}

export function createBrowserFrameDataUri(frame: BrowserScreencastFrame): string {
  return `data:image/${frame.format};base64,${Buffer.from(frame.image).toString('base64')}`
}

export function makeBrowserFrameCacheKey(
  worktreeId: string,
  browserPageId: string | null,
  viewMode: MobileBrowserViewMode
): string | null {
  return browserPageId ? `${worktreeId}:${browserPageId}:${viewMode}` : null
}

const browserFrameCache = new Map<string, BrowserFrameCacheEntry>()

export function clearCachedBrowserFramesForWorktree(worktreeId: string): void {
  const prefix = `${worktreeId}:`
  for (const key of browserFrameCache.keys()) {
    if (key.startsWith(prefix)) {
      browserFrameCache.delete(key)
    }
  }
}

export function getCachedBrowserFrame(cacheKey: string | null): BrowserFrameCacheEntry | null {
  if (!cacheKey) {
    return null
  }
  const cached = browserFrameCache.get(cacheKey)
  if (!cached) {
    return null
  }
  browserFrameCache.delete(cacheKey)
  browserFrameCache.set(cacheKey, cached)
  return cached
}

export function peekCachedBrowserFrame(cacheKey: string | null): BrowserFrameCacheEntry | null {
  return cacheKey ? (browserFrameCache.get(cacheKey) ?? null) : null
}

export function cacheBrowserFrame(cacheKey: string | null, entry: BrowserFrameCacheEntry): void {
  if (!cacheKey) {
    return
  }
  browserFrameCache.delete(cacheKey)
  browserFrameCache.set(cacheKey, entry)
  while (browserFrameCache.size > BROWSER_FRAME_CACHE_LIMIT) {
    const oldestKey = browserFrameCache.keys().next().value
    if (typeof oldestKey !== 'string') {
      break
    }
    browserFrameCache.delete(oldestKey)
  }
}

export function updateBrowserLayerVisibility(
  layers: [View | null, View | null],
  visible: FrameLayer
): void {
  for (const [index, layer] of layers.entries()) {
    layer?.setNativeProps({ style: { opacity: index === visible ? 1 : 0 } })
  }
}

export function updateBrowserImageSource(image: Image | null, uri: string): void {
  // Mutating only the native Image source avoids re-rendering the tab for every streamed frame.
  const source = [{ uri }]
  image?.setNativeProps({ source, src: source })
}

export function assertRpcOk(
  response: RpcSuccess | RpcFailure,
  fallbackMessage: string
): asserts response is RpcSuccess {
  if (!response.ok) {
    throw new Error(response.error.message || fallbackMessage)
  }
}

export function browserFrameMetadataEqual(
  a: BrowserScreencastFrameMetadata | null,
  b: BrowserScreencastFrameMetadata
): boolean {
  return (
    a?.deviceWidth === b.deviceWidth &&
    a?.deviceHeight === b.deviceHeight &&
    a?.pageScaleFactor === b.pageScaleFactor
  )
}

export function browserErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function shouldSurfaceBrowserError(message: string): boolean {
  const normalized = message.toLowerCase()
  // In-flight page automation can emit selector_not_found while the browser remains usable.
  return !normalized.includes('selector_not_found') && !normalized.includes('selector not found')
}

function touchPair(event: GestureResponderEvent): { a: BrowserPoint; b: BrowserPoint } | null {
  const touches = event.nativeEvent.touches
  if (!touches || touches.length < 2) {
    return null
  }
  const a = readLocalTouchPoint(touches[0])
  const b = readLocalTouchPoint(touches[1])
  return a && b ? { a, b } : null
}

function pointDistance(a: BrowserPoint, b: BrowserPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function createPinchGesture(
  event: GestureResponderEvent,
  geometry: BrowserFrameGeometry | null,
  zoom: BrowserZoomState
): PinchGesture | null {
  if (!geometry) {
    return null
  }
  const pair = touchPair(event)
  if (!pair) {
    return null
  }
  const distance = pointDistance(pair.a, pair.b)
  if (distance < 8) {
    return null
  }
  const centerX = (pair.a.x + pair.b.x) / 2
  const centerY = (pair.a.y + pair.b.y) / 2
  const frameCenterX = geometry.offsetX + geometry.renderedWidth / 2 + zoom.offsetX
  const frameCenterY = geometry.offsetY + geometry.renderedHeight / 2 + zoom.offsetY
  return {
    distance,
    scale: zoom.scale,
    anchorX: (centerX - frameCenterX) / zoom.scale,
    anchorY: (centerY - frameCenterY) / zoom.scale
  }
}

export function updatePinchZoom(
  event: GestureResponderEvent,
  geometry: BrowserFrameGeometry | null,
  pinch: PinchGesture
): BrowserZoomState | null {
  if (!geometry) {
    return null
  }
  const pair = touchPair(event)
  if (!pair) {
    return null
  }
  const nextScale = Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, (pinch.scale * pointDistance(pair.a, pair.b)) / pinch.distance)
  )
  const centerX = (pair.a.x + pair.b.x) / 2
  const centerY = (pair.a.y + pair.b.y) / 2
  const baseCenterX = geometry.offsetX + geometry.renderedWidth / 2
  const baseCenterY = geometry.offsetY + geometry.renderedHeight / 2
  return clampBrowserZoomState(
    {
      scale: nextScale,
      offsetX: centerX - baseCenterX - pinch.anchorX * nextScale,
      offsetY: centerY - baseCenterY - pinch.anchorY * nextScale
    },
    geometry,
    MIN_ZOOM,
    MAX_ZOOM
  )
}

export const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.bgBase
  },
  toolbar: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel
  },
  addressInput: {
    flex: 1,
    minWidth: 0,
    height: 28,
    borderRadius: radii.input,
    backgroundColor: colors.bgRaised,
    color: colors.textPrimary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 0,
    fontSize: 12,
    lineHeight: 16,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontFamily: typography.monoFamily
  },
  viewport: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    backgroundColor: colors.bgBase
  },
  browserImageHost: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden'
  },
  browserImageFill: {
    width: '100%',
    height: '100%'
  },
  browserImageLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center'
  },
  browserImageLayerHidden: {
    opacity: 0
  },
  browserZoomOffset: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  browserFrameBox: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden'
  },
  browserImage: {
    backgroundColor: colors.bgBase
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
    backgroundColor: 'rgba(13, 15, 24, 0.2)'
  },
  errorText: {
    color: colors.textPrimary,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 13,
    textAlign: 'center',
    overflow: 'hidden'
  },
  dialogOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: 'rgba(13, 15, 24, 0.5)'
  },
  dialogCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel,
    padding: spacing.lg
  },
  dialogTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600'
  },
  dialogMessage: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    lineHeight: 20,
    marginTop: spacing.sm
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg
  },
  dialogButton: {
    minHeight: 34,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center'
  },
  dialogButtonPrimary: {
    backgroundColor: colors.textPrimary
  },
  dialogButtonPressed: {
    opacity: 0.75
  },
  dialogButtonText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    fontWeight: '600'
  },
  dialogButtonPrimaryText: {
    color: colors.bgBase
  },
  keyboardDock: {
    zIndex: 20,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs + 2
  },
  keyboardInput: {
    flex: 1,
    height: 34,
    backgroundColor: colors.bgRaised,
    color: colors.textPrimary,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    fontFamily: typography.monoFamily,
    marginRight: spacing.sm
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised
  },
  disabled: {
    opacity: 0.35
  },
  disabledText: {
    color: colors.textMuted
  }
})
