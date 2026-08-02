import type { RuntimeMobileTerminalTheme } from '../../../src/shared/runtime-types'
import { colors } from '../theme/mobile-theme'
import { TERMINAL_TEXT_SCALES } from '../storage/preferences'
import { TERMINAL_PATH_TAP_JS } from './terminal-path-tap-injected'
import { XTERM_ENGINE_CSS, XTERM_ENGINE_JS } from './terminal-webview-engine.generated'
import { TERMINAL_REFLOW_JS } from './terminal-webview-reflow-injected'
import { TERMINAL_SURFACE_SWAP_JS } from './terminal-webview-surface-swap-injected'
import { TERMINAL_TAP_DISPATCH_JS } from './terminal-webview-tap-dispatch-injected'
import { TERMINAL_WEBVIEW_THEME_JS } from './terminal-webview-theme-injected'
import { TERMINAL_QUERY_REPLY_JS } from './terminal-webview-query-reply-injected'
import { URL_TAP_WEBVIEW_JS } from './terminal-webview-url-tap'
import { TERMINAL_WEBGL_RECOVERY_JS } from './terminal-webview-webgl-recovery-injected'
import { TERMINAL_MOUSE_CLICK_DRAG_JS } from './terminal-webview-mouse-click-drag-injected'
import { TERMINAL_MOUSE_REPORT_CELL_JS } from './terminal-webview-mouse-report-cell-injected'
import { TERMINAL_WHEEL_SCROLL_JS } from './terminal-webview-wheel-scroll-injected'

const DEFAULT_TERMINAL_THEME: RuntimeMobileTerminalTheme['theme'] = {
  background: colors.terminalBg,
  foreground: '#c0caf5',
  cursor: '#c0caf5',
  cursorAccent: colors.terminalBg,
  selectionBackground: '#33467c',
  selectionForeground: '#c0caf5',
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5'
}

export const MOBILE_TERMINAL_CARET_OPTIONS = {
  cursorBlink: false,
  cursorStyle: 'bar',
  showCursorImmediately: true,
  cursorInactiveStyle: 'block'
} as const

export const terminalWebviewTemplateValues = {
  colors,
  DEFAULT_TERMINAL_THEME,
  MOBILE_TERMINAL_CARET_OPTIONS,
  TERMINAL_TEXT_SCALES,
  TERMINAL_PATH_TAP_JS,
  XTERM_ENGINE_CSS,
  XTERM_ENGINE_JS,
  TERMINAL_REFLOW_JS,
  TERMINAL_SURFACE_SWAP_JS,
  TERMINAL_TAP_DISPATCH_JS,
  TERMINAL_WEBVIEW_THEME_JS,
  TERMINAL_QUERY_REPLY_JS,
  URL_TAP_WEBVIEW_JS,
  TERMINAL_WEBGL_RECOVERY_JS,
  TERMINAL_MOUSE_CLICK_DRAG_JS,
  TERMINAL_MOUSE_REPORT_CELL_JS,
  TERMINAL_WHEEL_SCROLL_JS
} as const
