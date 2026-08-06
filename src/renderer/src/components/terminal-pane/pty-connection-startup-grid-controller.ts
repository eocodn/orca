import type { ManagedPane, PaneManager } from '@/lib/pane-manager/pane-manager'
import { safeFit } from '@/lib/pane-manager/pane-tree-ops'
import type { SetupSplitDirection } from '../../../../shared/types'
import { isSetupSplitGeometryReady } from './pty-connection-split-geometry'
import {
  waitForStableStartupGrid,
  type TerminalStartupGridSettleHandle
} from './terminal-startup-grid-settle'

type StartupGridControllerArgs = {
  pane: ManagedPane
  manager: PaneManager
  startupCommand?: string
  waitForSetupSplitDirection?: SetupSplitDirection
  connectionId: string | null
  runtimeEnvironmentId: string | null
  isVisible: () => boolean
  isDisposed: () => boolean
  connect: () => void
}

export function createPtyConnectionStartupGridController({
  pane,
  manager,
  startupCommand,
  waitForSetupSplitDirection,
  connectionId,
  runtimeEnvironmentId,
  isVisible,
  isDisposed,
  connect
}: StartupGridControllerArgs) {
  let frame: number | null = null
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null
  let settleHandle: TerminalStartupGridSettleHandle | null = null
  let gridSettled = false
  let connectStarted = false

  const cancelFrame = (): void => {
    if (frame !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frame)
      }
      frame = null
    }
  }

  const clearFallbackTimer = (): void => {
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer)
      fallbackTimer = null
    }
  }

  const measure = (): { cols: number; rows: number } | null => {
    if (!safeFit(pane)) {
      return null
    }
    const cols = pane.terminal.cols
    const rows = pane.terminal.rows
    return cols > 0 && rows > 0 ? { cols, rows } : null
  }

  const shouldSettle = (): boolean =>
    Boolean(startupCommand) && isVisible() && !connectionId && runtimeEnvironmentId === null

  const isReadyToSettle = (): boolean =>
    !waitForSetupSplitDirection ||
    isSetupSplitGeometryReady(pane, manager, waitForSetupSplitDirection)

  const run = (): void => {
    if (connectStarted) {
      return
    }
    if (!gridSettled && shouldSettle()) {
      cancelFrame()
      clearFallbackTimer()
      settleHandle?.cancel()
      let settledSynchronously = false
      const handle = waitForStableStartupGrid({
        isAlive: () => !isDisposed(),
        isReadyToSettle: waitForSetupSplitDirection ? isReadyToSettle : undefined,
        measure,
        onSettled: () => {
          settledSynchronously = true
          settleHandle = null
          gridSettled = true
          run()
        },
        requestFrame: (callback) => requestAnimationFrame(callback),
        cancelFrame: (pendingFrame) => {
          if (typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(pendingFrame)
          }
        }
      })
      if (!settledSynchronously) {
        settleHandle = handle
      }
      return
    }
    connectStarted = true
    cancelFrame()
    clearFallbackTimer()
    if (!isDisposed()) {
      connect()
    }
  }

  return {
    schedule() {
      // Why: Wayland/CI can starve rAF while timers remain responsive.
      fallbackTimer = setTimeout(run, 250)
      frame = requestAnimationFrame(run)
    },
    dispose() {
      settleHandle?.cancel()
      settleHandle = null
      cancelFrame()
      clearFallbackTimer()
    }
  }
}
