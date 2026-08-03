import { webContents } from 'electron'
import type { ResolveRenderer } from './browser-guest-ui-resolve-renderer-control-modifiers'
import { markGuestWheelZoom } from './browser-guest-ui-recent-guest-wheel-zoom-by-guest-has-modifier'
import { resolveGuestMouseWheelZoomDirection } from './browser-guest-ui-resolve-guest-mouse-wheel-zoom-direction-setup-guest-shortcut-forwarding'

export function setupGuestMouseWheelZoomForwarding(args: {
  browserTabId: string
  guest: Electron.WebContents
  resolveRenderer: ResolveRenderer
}): () => void {
  const { browserTabId, guest, resolveRenderer } = args
  const handler = (event: Electron.Event, mouse: Electron.MouseInputEvent): void => {
    const direction = resolveGuestMouseWheelZoomDirection(mouse)
    if (!direction) {
      return
    }
    // Why: wheel input over a focused webview never reaches renderer DOM handlers, so consume and forward here.
    event.preventDefault()
    markGuestWheelZoom(guest, direction)
    resolveRenderer(browserTabId)?.send('ui:zoomBrowserPage', direction)
  }

  guest.on('before-mouse-event', handler)
  return () => {
    try {
      guest.off('before-mouse-event', handler)
    } catch {
      // Why: best-effort — guest may already be destroyed during teardown.
    }
  }
}

export function resolveRendererWebContents(
  rendererWebContentsIdByTabId: ReadonlyMap<string, number>,
  browserTabId: string
): Electron.WebContents | null {
  const rendererWcId = rendererWebContentsIdByTabId.get(browserTabId)
  if (!rendererWcId) {
    return null
  }
  const renderer = webContents.fromId(rendererWcId)
  if (!renderer || renderer.isDestroyed()) {
    return null
  }
  return renderer
}
