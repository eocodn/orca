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

import { type GuestWheelZoomDirection, MAC_COMMAND_MODIFIERS, WHEEL_ZOOM_BLOCKING_MODIFIERS, GUEST_WHEEL_ZOOM_DEDUPE_MS } from './browser-guest-ui-mac-command-modifiers-guest-wheel-zoom-direction'
import { recentGuestWheelZoomByGuest, markGuestWheelZoom, consumeRecentGuestWheelZoom, hasModifier } from './browser-guest-ui-recent-guest-wheel-zoom-by-guest-has-modifier'
import { resolveGuestMouseWheelZoomDirection, setupGuestContextMenu, setupGrabShortcutForwarding, setupGuestShortcutForwarding } from './browser-guest-ui-resolve-guest-mouse-wheel-zoom-direction-setup-guest-shortcut-forwarding'
import { setupGuestMouseWheelZoomForwarding, resolveRendererWebContents } from './browser-guest-ui-setup-guest-mouse-wheel-zoom-forwarding-resolve-renderer-web-contents'

export type ResolveRenderer = (browserTabId: string) => Electron.WebContents | null

export type ShouldForwardDictationShortcut = () => boolean

export type IsMobileEmulatorEnabled = () => boolean


export const CONTROL_MODIFIERS = new Set(['control', 'ctrl'])
