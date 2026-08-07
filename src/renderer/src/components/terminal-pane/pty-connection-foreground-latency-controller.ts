import {
  FOREGROUND_BUDGET_WINDOW_MS,
  FOREGROUND_IMMEDIATE_BUDGET_CHARS,
  FOREGROUND_INTERACTIVE_REDRAW_CHARS,
  FOREGROUND_INTERACTIVE_REDRAW_WINDOW_MS,
  FOREGROUND_THROUGHPUT_IMMEDIATE_CHARS
} from './pty-connection-runtime-state'

type PtyConnectionForegroundLatencyControllerArgs = {
  paneId: number
  now: () => number
  getLastTerminalInputAt: () => number
  isPaneMarkedActive: () => boolean
  getActivePaneId: () => number | null
  consumeInactiveBudget: (dataLength: number) => boolean
}

export function createPtyConnectionForegroundLatencyController({
  paneId,
  now,
  getLastTerminalInputAt,
  isPaneMarkedActive,
  getActivePaneId,
  consumeInactiveBudget
}: PtyConnectionForegroundLatencyControllerArgs) {
  let immediateBudgetChars = 0
  let immediateBudgetWindowStart = 0

  const consumeImmediateBudget = (dataLength: number): boolean => {
    const currentTime = now()
    if (currentTime - immediateBudgetWindowStart > FOREGROUND_BUDGET_WINDOW_MS) {
      immediateBudgetChars = 0
      immediateBudgetWindowStart = currentTime
    }
    if (immediateBudgetChars + dataLength > FOREGROUND_IMMEDIATE_BUDGET_CHARS) {
      return false
    }
    immediateBudgetChars += dataLength
    return true
  }

  const isActiveSplitPane = (): boolean => {
    if (!isPaneMarkedActive()) {
      return false
    }
    const activePaneId = getActivePaneId()
    return activePaneId === null || activePaneId === paneId
  }

  return {
    isActiveSplitPane,
    isLatencySensitive(data: string): boolean {
      if (!isActiveSplitPane()) {
        // Why: inactive CSI redraws across many splits can starve typing in the active pane.
        return !data.includes('\x1b[') && consumeInactiveBudget(data.length)
      }
      if (data.length <= FOREGROUND_THROUGHPUT_IMMEDIATE_CHARS) {
        return consumeImmediateBudget(data.length)
      }
      const recentInput =
        now() - getLastTerminalInputAt() <= FOREGROUND_INTERACTIVE_REDRAW_WINDOW_MS
      if (
        recentInput &&
        data.length <= FOREGROUND_INTERACTIVE_REDRAW_CHARS &&
        data.includes('\x1b[')
      ) {
        return consumeImmediateBudget(data.length)
      }
      return false
    }
  }
}
