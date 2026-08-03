import type { BrowserPageZoomDirection } from '../../shared/browser-page-zoom'

export const MAC_COMMAND_MODIFIERS = new Set(['meta', 'command', 'cmd'])

export const WHEEL_ZOOM_BLOCKING_MODIFIERS = new Set(['alt', 'shift'])

export const GUEST_WHEEL_ZOOM_DEDUPE_MS = 250

export type GuestWheelZoomDirection = Exclude<BrowserPageZoomDirection, 'reset'>
