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
import { recentGuestWheelZoomByGuest, markGuestWheelZoom, consumeRecentGuestWheelZoom, hasModifier } from './browser-guest-ui-recent-guest-wheel-zoom-by-guest-has-modifier'
import { resolveGuestMouseWheelZoomDirection, setupGuestContextMenu, setupGrabShortcutForwarding, setupGuestShortcutForwarding } from './browser-guest-ui-resolve-guest-mouse-wheel-zoom-direction-setup-guest-shortcut-forwarding'
import { setupGuestMouseWheelZoomForwarding, resolveRendererWebContents } from './browser-guest-ui-setup-guest-mouse-wheel-zoom-forwarding-resolve-renderer-web-contents'

export const MAC_COMMAND_MODIFIERS = new Set(['meta', 'command', 'cmd'])

export const WHEEL_ZOOM_BLOCKING_MODIFIERS = new Set(['alt', 'shift'])

export const GUEST_WHEEL_ZOOM_DEDUPE_MS = 250


export type GuestWheelZoomDirection = Exclude<BrowserPageZoomDirection, 'reset'>
