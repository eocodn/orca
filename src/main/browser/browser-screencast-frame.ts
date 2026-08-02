import { Buffer } from 'node:buffer'
import type { WebContents } from 'electron'
import {
  BrowserScreencastOpcode,
  encodeBrowserScreencastFrame,
  type BrowserScreencastFormat,
  type BrowserScreencastFrameMetadata
} from '../../shared/browser-screencast-protocol'
import { BrowserError } from './cdp-bridge'
import { acquireElectronDebugger, type ElectronDebuggerLease } from './electron-debugger-lease'
import { readBrowserScreencastImageSize } from './browser-screencast-image-size'

const DEBUGGER_COMMAND_TIMEOUT_MS = 8_000

export type BrowserScreencastOptions = {
  format: BrowserScreencastFormat
  quality: number
  maxWidth: number
  maxHeight: number
  viewportWidth?: number
  viewportHeight?: number
  deviceScaleFactor?: number
  mobile?: boolean
  everyNthFrame: number
  minFrameIntervalMs: number
  onFrame: (bytes: Uint8Array<ArrayBufferLike>) => boolean | void
  onEvent?: (event: BrowserScreencastEvent) => void
  onError?: (message: string) => void
}

export type BrowserScreencastSession = { stop: () => void; done: Promise<void> }

export type BrowserScreencastEvent =
  | { type: 'dialog'; dialogType: string; message: string }
  | { type: 'dialogClosed' }

export type PendingScreencastFrame = {
  metadata: BrowserScreencastFrameMetadata
  image: Uint8Array
  sessionId?: number
}

export type ScreencastImageSize = {
  width: number
  height: number
}

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function readFrameMetadata(raw: unknown): BrowserScreencastFrameMetadata {
  const metadata = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    offsetTop: finiteNumber(metadata.offsetTop),
    pageScaleFactor: finiteNumber(metadata.pageScaleFactor),
    deviceWidth: finiteNumber(metadata.deviceWidth),
    deviceHeight: finiteNumber(metadata.deviceHeight),
    imageWidth: finiteNumber(metadata.imageWidth),
    imageHeight: finiteNumber(metadata.imageHeight),
    scrollOffsetX: finiteNumber(metadata.scrollOffsetX),
    scrollOffsetY: finiteNumber(metadata.scrollOffsetY),
    timestamp: finiteNumber(metadata.timestamp)
  }
}

export function isNear(value: number, expected: number): boolean {
  return Math.abs(value - expected) <= Math.max(2, expected * 0.02)
}

export function scaleToFit(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): {
  width: number
  height: number
} {
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale)
  }
}

export function isNearSize(
  actual: { width: number; height: number },
  expected: { width: number; height: number }
): boolean {
  return isNear(actual.width, expected.width) && isNear(actual.height, expected.height)
}

export function selectFrameDeviceSize(
  reportedSize: number | undefined,
  requestedCssSize: number | null,
  imageSize: number | undefined
): number | undefined {
  if (requestedCssSize) {
    // Why: paired clients own the remote browser viewport. If Chromium briefly
    // reports the host BrowserView size, publishing that size makes the client
    // compensate with crop/contain math and exposes blank compositor space.
    return requestedCssSize
  }
  return reportedSize ?? imageSize
}

export function isLiveFrameCompatibleWithViewport(
  imageSize: ScreencastImageSize | null,
  options: BrowserScreencastOptions
): boolean {
  const viewportWidth = positiveInteger(options.viewportWidth)
  const viewportHeight = positiveInteger(options.viewportHeight)
  if (!viewportWidth || !viewportHeight) {
    return true
  }
  if (!imageSize) {
    return true
  }
  const deviceScaleFactor = positiveNumber(options.deviceScaleFactor) ?? 1
  const cssViewport = { width: viewportWidth, height: viewportHeight }
  const deviceViewport = {
    width: Math.round(viewportWidth * deviceScaleFactor),
    height: Math.round(viewportHeight * deviceScaleFactor)
  }
  const scaledDeviceViewport = scaleToFit(
    deviceViewport.width,
    deviceViewport.height,
    options.maxWidth,
    options.maxHeight
  )
  // Why: Chromium can stream CSS-sized, DPR-sized, or maxWidth/maxHeight-scaled
  // bitmaps for the same emulated viewport. All are client-authoritative; stale
  // host BrowserView frames are the incompatible ones we need to drop.
  return (
    isNearSize(imageSize, cssViewport) ||
    isNearSize(imageSize, deviceViewport) ||
    isNearSize(imageSize, scaledDeviceViewport)
  )
}

export function enrichFrameMetadata(
  metadata: BrowserScreencastFrameMetadata,
  imageSize: ScreencastImageSize | null,
  options: BrowserScreencastOptions
): BrowserScreencastFrameMetadata {
  const viewportWidth = positiveInteger(options.viewportWidth)
  const viewportHeight = positiveInteger(options.viewportHeight)
  const enriched: BrowserScreencastFrameMetadata = { ...metadata }
  const deviceWidth = selectFrameDeviceSize(enriched.deviceWidth, viewportWidth, imageSize?.width)
  const deviceHeight = selectFrameDeviceSize(
    enriched.deviceHeight,
    viewportHeight,
    imageSize?.height
  )
  const imageWidth = imageSize?.width ?? enriched.imageWidth
  const imageHeight = imageSize?.height ?? enriched.imageHeight
  if (deviceWidth !== undefined) {
    enriched.deviceWidth = deviceWidth
  }
  if (deviceHeight !== undefined) {
    enriched.deviceHeight = deviceHeight
  }
  if (imageWidth !== undefined) {
    enriched.imageWidth = imageWidth
  }
  if (imageHeight !== undefined) {
    enriched.imageHeight = imageHeight
  }
  return enriched
}

export function positiveInteger(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null
}

export function positiveNumber(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export async function sendDebuggerCommand(
  dbg: WebContents['debugger'],
  method: string,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      Promise.resolve().then(() => dbg.sendCommand(method, params)),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Timed out while running ${method}.`))
        }, DEBUGGER_COMMAND_TIMEOUT_MS)
      })
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

