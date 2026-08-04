import { getClientRuntime } from '@/runtime/client-runtime'
import { useAppStore } from '../store'
import type {
  RuntimeBrowserDriverState,
  RuntimeTerminalDriverState
} from '../../../shared/runtime-types'
import { setFitOverride, hydrateOverrides } from '@/lib/pane-manager/mobile-fit-overrides'
import { setDriverForPty, hydrateDrivers } from '@/lib/pane-manager/mobile-driver-state'
import {
  hydrateBrowserDrivers,
  setDriverForBrowserPage
} from '@/lib/pane-manager/browser-mobile-driver-state'
type MobileStateSurfaceContext = {
  unsubs: Array<() => void>
}
function isRuntimeEnvironmentActive(): boolean {
  return Boolean(useAppStore.getState().settings?.activeRuntimeEnvironmentId?.trim())
}

// Why: mobile driver hydration is async; cap replay so a stuck IPC snapshot cannot retain an unbounded startup buffer.
const MAX_PENDING_MOBILE_STATE_EVENTS = 300

export function registerMobileStateEvents({ unsubs }: MobileStateSurfaceContext): void {
let mobileStateHydrated = isRuntimeEnvironmentActive()
type PendingMobileStateEvent =
  | {
      kind: 'fit'
      event: {
        ptyId: string
        mode: 'mobile-fit' | 'remote-desktop-fit' | 'desktop-fit'
        cols: number
        rows: number
      }
    }
  | {
      kind: 'driver'
      event: {
        ptyId: string
        driver: RuntimeTerminalDriverState
      }
    }
  | {
      kind: 'browser-driver'
      event: {
        browserPageId: string
        driver: RuntimeBrowserDriverState
      }
    }
const pendingMobileStateEvents: PendingMobileStateEvent[] = []
let mobileStateHydrationDisposed = false

const applyPendingMobileStateEvents = (): void => {
  for (const pending of pendingMobileStateEvents) {
    if (pending.kind === 'fit') {
      const { ptyId, mode, cols, rows } = pending.event
      setFitOverride(ptyId, mode, cols, rows)
    } else if (pending.kind === 'driver') {
      setDriverForPty(pending.event.ptyId, pending.event.driver)
    } else {
      setDriverForBrowserPage(pending.event.browserPageId, pending.event.driver)
    }
  }
  pendingMobileStateEvents.length = 0
}

const enqueuePendingMobileStateEvent = (event: PendingMobileStateEvent): void => {
  pendingMobileStateEvents.push(event)
  while (pendingMobileStateEvents.length > MAX_PENDING_MOBILE_STATE_EVENTS) {
    pendingMobileStateEvents.shift()
  }
}

unsubs.push(
  getClientRuntime().runtime.onTerminalFitOverrideChanged((event) => {
    if (isRuntimeEnvironmentActive()) {
      return
    }
    if (!mobileStateHydrated) {
      enqueuePendingMobileStateEvent({ kind: 'fit', event })
      return
    }
    setFitOverride(event.ptyId, event.mode, event.cols, event.rows)
  })
)

unsubs.push(
  // Why: mirror presence-lock driver state so TerminalPane / pty-connection guards know which PTYs are mobile-driven. See docs/mobile-presence-lock.md.
  getClientRuntime().runtime.onTerminalDriverChanged((event) => {
    if (isRuntimeEnvironmentActive()) {
      return
    }
    if (!mobileStateHydrated) {
      enqueuePendingMobileStateEvent({ kind: 'driver', event })
      return
    }
    setDriverForPty(event.ptyId, event.driver)
  })
)

unsubs.push(
  getClientRuntime().runtime.onBrowserDriverChanged((event) => {
    if (isRuntimeEnvironmentActive()) {
      return
    }
    if (!mobileStateHydrated) {
      enqueuePendingMobileStateEvent({ kind: 'browser-driver', event })
      return
    }
    setDriverForBrowserPage(event.browserPageId, event.driver)
  })
)

// Why: subscribe before the snapshot round trip and buffer live events; otherwise an older snapshot could overwrite a newer live lock and hide the overlay.
if (!isRuntimeEnvironmentActive()) {
  void Promise.all([
    getClientRuntime().runtime.getTerminalFitOverrides(),
    getClientRuntime().runtime.getTerminalDrivers(),
    getClientRuntime().runtime.getBrowserDrivers()
  ])
    .then(([overrides, drivers, browserDrivers]) => {
      if (mobileStateHydrationDisposed) {
        return
      }
      hydrateOverrides(overrides)
      hydrateDrivers(drivers)
      hydrateBrowserDrivers(browserDrivers)
      mobileStateHydrated = true
      applyPendingMobileStateEvents()
    })
    .catch((error: unknown) => {
      if (mobileStateHydrationDisposed) {
        return
      }
      console.error('Failed to hydrate mobile terminal state:', error)
      mobileStateHydrated = true
      applyPendingMobileStateEvents()
    })
}


  unsubs.push(() => {
    mobileStateHydrationDisposed = true
    pendingMobileStateEvents.length = 0
  })
}
