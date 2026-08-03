import {
  GUEST_WHEEL_ZOOM_DEDUPE_MS,
  type GuestWheelZoomDirection
} from './browser-guest-ui-mac-command-modifiers-guest-wheel-zoom-direction'

export const recentGuestWheelZoomByGuest = new WeakMap<
  Electron.WebContents,
  { direction: GuestWheelZoomDirection; at: number }
>()

export function markGuestWheelZoom(
  guest: Electron.WebContents,
  direction: GuestWheelZoomDirection
): void {
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

export function hasModifier(
  mouse: Electron.MouseInputEvent,
  modifiers: ReadonlySet<string>
): boolean {
  return mouse.modifiers?.some((modifier) => modifiers.has(modifier)) ?? false
}
