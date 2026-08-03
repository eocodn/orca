import { normalizeExternalBrowserUrl } from '../../shared/browser-url'
import type {
  BrowserDownloadFinishedEvent,
  BrowserDownloadProgressEvent,
  BrowserPermissionDeniedEvent,
  BrowserPopupEvent
} from '../../shared/browser-guest-events'

const AUTOMATION_VISIBILITY_ACQUIRE_TIMEOUT_MS = 2_000

function isChromiumInternalErrorUrl(url: string): boolean {
  return url.startsWith('chrome-error://')
}

function resolveWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallbackValue: T
): Promise<{ value: T; timedOut: boolean }> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<{ value: T; timedOut: boolean }>((resolve) => {
    timeoutId = setTimeout(() => resolve({ value: fallbackValue, timedOut: true }), timeoutMs)
  })
  return Promise.race([
    promise.then((value) => ({ value, timedOut: false })),
    timeoutPromise
  ]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  })
}

function releaseAutomationVisibilityToken(renderer: Electron.WebContents, token: string): void {
  if (renderer.isDestroyed()) {
    return
  }
  renderer
    .executeJavaScript(
      `(function() {
        var bridge = window.__orcaBrowserAutomationVisibility;
        if (!bridge || typeof bridge.release !== 'function') return false;
        return bridge.release(${JSON.stringify(token)});
      })()`
    )
    .catch(() => {})
}

function cleanupLateAutomationVisibilityToken(
  renderer: Electron.WebContents,
  acquirePromise: Promise<unknown>
): void {
  acquirePromise
    .then((lateToken) => {
      if (typeof lateToken !== 'string' || lateToken.length === 0) {
        return
      }
      // Why: the lease is created before paint; if main's acquire timed out, release the late token so hidden webviews don't stay paintable.
      releaseAutomationVisibilityToken(renderer, lateToken)
    })
    .catch(() => {})
}

function createNoopRestoreForTimedOutAutomationAcquire(
  renderer: Electron.WebContents,
  acquirePromise: Promise<unknown>,
  timedOut: boolean
): () => void {
  if (timedOut) {
    cleanupLateAutomationVisibilityToken(renderer, acquirePromise)
  }
  return () => {}
}

function isAutomationVisibilityToken(token: unknown): token is string {
  return typeof token === 'string' && token.length > 0
}

// Why: responsive sites UA-sniff; this is Chrome DevTools' default iPhone UA template with the real Chrome major spliced in to keep sec-ch-ua consistent (see setupClientHintsOverride).
function buildMobileUserAgent(chromeMajor: string): string {
  return `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/${chromeMajor}.0.0.0 Mobile/15E148 Safari/604.1`
}

function extractChromeMajor(ua: string): string {
  const match = ua.match(/Chrome\/(\d+)/)
  return match ? match[1] : '134'
}

export type BrowserGuestRegistration = {
  browserPageId?: string
  browserTabId?: string
  workspaceId?: string
  worktreeId?: string
  sessionProfileId?: string | null
  webContentsId: number
  rendererWebContentsId: number
}

type PendingPermissionEvent = Omit<BrowserPermissionDeniedEvent, 'browserPageId'>
type PendingPopupEvent = Omit<BrowserPopupEvent, 'browserPageId'>
type BrowserDownloadDoneState = 'completed' | 'cancelled' | 'interrupted'
type PopupOwnerContext = {
  browserTabId: string
  rootGuestWebContentsId: number
}
const SAFE_POPUP_WINDOW_OPTIONS = {
  alwaysOnTop: false,
  closable: true,
  focusable: true,
  frame: true,
  fullscreen: false,
  kiosk: false,
  modal: false,
  movable: true,
  opacity: 1,
  show: true,
  simpleFullscreen: false,
  skipTaskbar: false,
  titleBarStyle: 'default',
  transparent: false,
  // Why: Electron applies these before createWindow; feature strings/opener inheritance must not relax the child's isolation.
  webPreferences: {
    allowRunningInsecureContent: false,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webviewTag: false
  }
} satisfies Electron.BrowserWindowConstructorOptions

type ActiveDownload = {
  downloadId: string
  guestWebContentsId: number
  browserTabId: string | null
  rendererWebContentsId: number | null
  origin: string
  filename: string
  totalBytes: number | null
  mimeType: string | null
  item: Electron.DownloadItem
  savePath: string
  reservationKey: string | null
  receivedBytes: number
  transientState: BrowserDownloadProgressEvent['state']
  terminalEvent: BrowserDownloadFinishedEvent | null
  startedSent: boolean
  cleanup: (() => void) | null
}

function safeOrigin(rawUrl: string): string {
  const external = normalizeExternalBrowserUrl(rawUrl)
  const urlToParse = external ?? rawUrl
  try {
    return new URL(urlToParse).origin
  } catch {
    return external ?? 'unknown'
  }
}

export {
  AUTOMATION_VISIBILITY_ACQUIRE_TIMEOUT_MS,
  SAFE_POPUP_WINDOW_OPTIONS,
  buildMobileUserAgent,
  cleanupLateAutomationVisibilityToken,
  createNoopRestoreForTimedOutAutomationAcquire,
  extractChromeMajor,
  isAutomationVisibilityToken,
  isChromiumInternalErrorUrl,
  releaseAutomationVisibilityToken,
  resolveWithTimeout,
  safeOrigin,
  type ActiveDownload,
  type BrowserDownloadDoneState,
  type PendingPermissionEvent,
  type PendingPopupEvent,
  type PopupOwnerContext
}
