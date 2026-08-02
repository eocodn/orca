import { screen, webContents } from 'electron'
import {
  normalizeBrowserNavigationUrl,
  normalizeExternalBrowserUrl,
  redactKagiSessionToken
} from '../../shared/browser-url'
import {
  isRecentTabSwitcherCommitRelease,
  matchesRecentTabSwitcherChord,
  nativeZoomCommandMatchesKeybindings,
  resolveWindowShortcutAction,
  type WindowShortcutInput
} from '../../shared/window-shortcut-policy'
import { readGuestNavigationState } from './browser-guest-navigation-state'
import { keybindingMatchesAction, type KeybindingOverrides } from '../../shared/keybindings'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../shared/constants'
import type { BrowserPageZoomDirection } from '../../shared/browser-page-zoom'
import {
  ModifierDoubleTapDetector,
  toModifierDoubleTapEvent
} from '../../shared/modifier-double-tap-detector'
import type { BrowserFindSource } from '../../shared/browser-find-source'

import { type ResolveRenderer, type ShouldForwardDictationShortcut, type IsMobileEmulatorEnabled, CONTROL_MODIFIERS } from './browser-guest-ui-resolve-renderer-control-modifiers'
import { type GuestWheelZoomDirection, MAC_COMMAND_MODIFIERS, WHEEL_ZOOM_BLOCKING_MODIFIERS, GUEST_WHEEL_ZOOM_DEDUPE_MS } from './browser-guest-ui-mac-command-modifiers-guest-wheel-zoom-direction'
import { recentGuestWheelZoomByGuest, markGuestWheelZoom, consumeRecentGuestWheelZoom, hasModifier } from './browser-guest-ui-recent-guest-wheel-zoom-by-guest-has-modifier'
import { resolveGuestMouseWheelZoomDirection, setupGuestContextMenu, setupGrabShortcutForwarding, setupGuestShortcutForwarding } from './browser-guest-ui-resolve-guest-mouse-wheel-zoom-direction-setup-guest-shortcut-forwarding'

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
