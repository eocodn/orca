import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import { getFitOverrideForPty } from '@/lib/pane-manager/mobile-fit-overrides'
import { isPtyLocked } from '@/lib/pane-manager/mobile-driver-state'
import {
  PANE_PTY_RESIZE_HOLD_FLUSH_EVENT,
  queuePanePtyResizeIfHeld,
  type PanePtyResizeHoldFlushDetail
} from '@/lib/pane-manager/pane-pty-resize-hold'
import type { PtyTransport } from './pty-transport'
import type { PtyConnectionDeps } from './pty-connection-types'

type ResizeForwardingControllerArgs = {
  pane: ManagedPane
  deps: PtyConnectionDeps
  transport: PtyTransport
  shouldSkipTerminalResize: () => boolean
}

export function createPtyConnectionResizeForwardingController({
  pane,
  deps,
  transport,
  shouldSkipTerminalResize
}: ResizeForwardingControllerArgs) {
  const shouldSuppressDesktopResize = (): boolean => {
    const ptyId = transport.getPtyId()
    return Boolean(ptyId && (getFitOverrideForPty(ptyId) || isPtyLocked(ptyId)))
  }

  const isAuthoritative = (): boolean => {
    // Why: hidden layout churn can reset full-screen TUIs; visible resume owns repair.
    return deps.isVisibleRef.current
  }

  const forward = (cols: number, rows: number): void => {
    if (!isAuthoritative() || shouldSuppressDesktopResize()) {
      return
    }
    if (queuePanePtyResizeIfHeld(pane.container, cols, rows)) {
      return
    }
    transport.resize(cols, rows, { claim: true })
  }

  const onHeldResizeFlush = (event: Event): void => {
    const detail = (event as CustomEvent<PanePtyResizeHoldFlushDetail>).detail
    if (detail) {
      forward(detail.cols, detail.rows)
    }
  }
  pane.container.addEventListener(PANE_PTY_RESIZE_HOLD_FLUSH_EVENT, onHeldResizeFlush)

  const terminalResizeDisposable = pane.terminal.onResize(({ cols, rows }) => {
    if (!shouldSkipTerminalResize()) {
      forward(cols, rows)
    }
  })

  return {
    forward,
    shouldSuppressDesktopResize,
    isAuthoritative,
    dispose() {
      terminalResizeDisposable.dispose()
      pane.container.removeEventListener(PANE_PTY_RESIZE_HOLD_FLUSH_EVENT, onHeldResizeFlush)
    }
  }
}
