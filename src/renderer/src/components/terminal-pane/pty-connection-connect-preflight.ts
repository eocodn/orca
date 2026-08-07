import { createTerminalZeroDimensionsMessage } from '../../../../shared/terminal-zero-dimensions-diagnostic'
import { isWorktreeRemovalFenceError } from '../../../../shared/worktree-removal-fence-error'

type PtyConnectionConnectPreflightArgs = {
  isDisposed: () => boolean
  fitPane: () => void
  readGrid: () => { cols: number; rows: number }
  isVisible: () => boolean
  reportPtyError: (message: string) => void
}

type PtyConnectionConnectPreflight = {
  cols: number
  rows: number
  reportError: (message: string) => void
}

export function preparePtyConnectionConnectPreflight({
  isDisposed,
  fitPane,
  readGrid,
  isVisible,
  reportPtyError
}: PtyConnectionConnectPreflightArgs): PtyConnectionConnectPreflight | null {
  if (isDisposed()) {
    return null
  }
  fitPane()
  const { cols, rows } = readGrid()
  if ((cols === 0 || rows === 0) && isVisible()) {
    reportPtyError(createTerminalZeroDimensionsMessage(cols, rows))
  }
  return {
    cols,
    rows,
    reportError(message) {
      if (isDisposed() || isWorktreeRemovalFenceError(message)) {
        return
      }
      reportPtyError(message)
    }
  }
}
