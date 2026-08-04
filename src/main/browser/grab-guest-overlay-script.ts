// Browser Context Grab — builds self-contained JS strings injected into guests via executeJavaScript().
// Why a string builder not a bundle: guests have no preload/Node; injected code must be plain JS in the page's own world.

import { ARM_SCRIPT } from './grab-guest-arm-script'
import { AWAIT_CLICK_SCRIPT } from './grab-guest-await-click-script'
import { EXTRACT_HOVER_SCRIPT } from './grab-guest-extract-hover-script'
import { FINALIZE_SCRIPT } from './grab-guest-finalize-script'
import { TEARDOWN_SCRIPT } from './grab-guest-teardown-script'

type GuestScriptAction = 'arm' | 'awaitClick' | 'finalize' | 'extractHover' | 'teardown'

/**
 * Build a self-contained JS script for the given grab lifecycle action.
 *
 * - `arm`: install the shadow-root overlay, hover listeners, and extraction logic
 * - `awaitClick`: return a Promise that resolves with the payload when the user clicks
 * - `finalize`: extract the payload for the currently hovered element and return it
 * - `extractHover`: extract the payload for the currently hovered element WITHOUT cleanup
 * - `teardown`: remove the overlay and all listeners
 */
export function buildGuestOverlayScript(action: GuestScriptAction): string {
  switch (action) {
    case 'arm':
      return ARM_SCRIPT
    case 'awaitClick':
      return AWAIT_CLICK_SCRIPT
    case 'finalize':
      return FINALIZE_SCRIPT
    case 'extractHover':
      return EXTRACT_HOVER_SCRIPT
    case 'teardown':
      return TEARDOWN_SCRIPT
  }
}
