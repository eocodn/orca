export * from './browser-ipc-foundation'
import { registerBrowserGrabHandlers } from './browser-grab-ipc-handlers'
import { registerBrowserSessionHandlers } from './browser-session-ipc-handlers'
import { registerBrowserTabHandlers } from './browser-tab-ipc-handlers'
import { grabModeIntentByPageId, grabModeOperationByPageId } from './browser-ipc-foundation'

export function registerBrowserHandlers(): void {
  grabModeIntentByPageId.clear()
  // Why: a stale in-flight chain from a prior registration would block new operations forever.
  grabModeOperationByPageId.clear()
  registerBrowserTabHandlers()
  registerBrowserGrabHandlers()
  registerBrowserSessionHandlers()
}
