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
import { resolveGuestMouseWheelZoomDirection, setupGuestContextMenu, setupGrabShortcutForwarding, setupGuestShortcutForwarding } from './browser-guest-ui-resolve-guest-mouse-wheel-zoom-direction-setup-guest-shortcut-forwarding'
import { setupGuestMouseWheelZoomForwarding, resolveRendererWebContents } from './browser-guest-ui-setup-guest-mouse-wheel-zoom-forwarding-resolve-renderer-web-contents'

export const recentGuestWheelZoomByGuest = new WeakMap<
  Electron.WebContents,
  { direction: GuestWheelZoomDirection; at: number }
>()


export function markGuestWheelZoom(guest: Electron.WebContents, direction: GuestWheelZoomDirection): void {
  recentGuestWheelZoomByGuest.set(guest, { direction, at: Date.now() })
}


export function consumeRecentGuestWheelZoom(
  guest: Electron.WebContents,
  direction: GuestWheelZoomDirection
): boolean {
  const recent = recentGuestWheelZoomByGuest.get(guest)
  if (!recent) {
    return false
  }
  const elapsed = Date.now() - recent.at
  if (elapsed < 0 || elapsed > GUEST_WHEEL_ZOOM_DEDUPE_MS) {
    recentGuestWheelZoomByGuest.delete(guest)
    return false
  }
  if (recent.direction !== direction) {
    return false
  }
  recentGuestWheelZoomByGuest.delete(guest)
  return true
}


export function hasModifier(mouse: Electron.MouseInputEvent, modifiers: ReadonlySet<string>): boolean {
  return mouse.modifiers?.some((modifier) => modifiers.has(modifier)) ?? false
}
