import { HIDDEN_OUTPUT_RESTORE_FLOOD_SUPPRESS_MS } from './pty-connection-runtime-state'

type HiddenRestoreFloodBackpressureControllerOptions = {
  getCurrentPtyId: () => string | null
  isDisposed: () => boolean
  requestRepaint: () => void
}

export function createPtyConnectionHiddenRestoreFloodBackpressureController(
  options: HiddenRestoreFloodBackpressureControllerOptions
) {
  let suppressedUntil = 0
  let repaintTimer: ReturnType<typeof setTimeout> | null = null

  function clearRepaintTimer(): void {
    if (repaintTimer === null) {
      return
    }
    clearTimeout(repaintTimer)
    repaintTimer = null
  }

  function reset(): void {
    suppressedUntil = 0
    clearRepaintTimer()
  }

  return {
    isSuppressed(): boolean {
      return Date.now() < suppressedUntil
    },
    noteBackpressure(ptyId: string | null): void {
      suppressedUntil = Date.now() + HIDDEN_OUTPUT_RESTORE_FLOOD_SUPPRESS_MS
      if (ptyId === null) {
        return
      }
      clearRepaintTimer()
      repaintTimer = setTimeout(() => {
        repaintTimer = null
        if (options.isDisposed() || options.getCurrentPtyId() !== ptyId) {
          return
        }
        // One authoritative repaint heals bytes discarded under restore backpressure.
        options.requestRepaint()
      }, HIDDEN_OUTPUT_RESTORE_FLOOD_SUPPRESS_MS)
    },
    reset,
    dispose: reset
  }
}
