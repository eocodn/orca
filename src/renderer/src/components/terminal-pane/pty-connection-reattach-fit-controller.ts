type ReattachFitHandle = {
  completion: Promise<boolean>
}

type ReattachFitTerminal = {
  cols: number
  rows: number
}

type ReattachFitControllerOptions<TFit extends ReattachFitHandle> = {
  terminal: ReattachFitTerminal
  isCurrent: () => boolean
  getPtyId: () => string | null
  hasFitOverride: (ptyId: string) => boolean
  isRemoteRuntimePtyId: (ptyId: string) => boolean
  startFit: (reason: 'reattach-pty-resize', continuation: () => void) => TFit
  setPendingFit: (fit: TFit) => void
  clearPendingFitIf: (fit: TFit) => void
  resizePty: (ptyId: string, cols: number, rows: number) => void
  signalPty: (ptyId: string, signal: 'SIGWINCH') => void
  isVisible: () => boolean
  requestSizeReassertion: () => void
}

export function createPtyConnectionReattachFitController<TFit extends ReattachFitHandle>(
  options: ReattachFitControllerOptions<TFit>
) {
  return {
    async fit(): Promise<void> {
      if (!options.isCurrent()) {
        return
      }
      const reattachPtyId = options.getPtyId()
      if (!reattachPtyId) {
        return
      }
      if (options.hasFitOverride(reattachPtyId)) {
        if (options.isCurrent() && !options.isRemoteRuntimePtyId(reattachPtyId)) {
          options.signalPty(reattachPtyId, 'SIGWINCH')
        }
        return
      }

      const fit = options.startFit('reattach-pty-resize', () => {
        if (!options.isCurrent() || options.getPtyId() !== reattachPtyId) {
          return
        }
        const cols = options.terminal.cols
        const rows = options.terminal.rows
        if (cols > 0 && rows > 0) {
          options.resizePty(reattachPtyId, cols, rows)
        }
        // Why: unchanged POSIX dimensions do not emit SIGWINCH, but replayed TUIs still need a repaint.
        if (!options.isRemoteRuntimePtyId(reattachPtyId)) {
          options.signalPty(reattachPtyId, 'SIGWINCH')
        }
      })
      options.setPendingFit(fit)
      let fitCompleted = false
      try {
        fitCompleted = await fit.completion
      } finally {
        options.clearPendingFitIf(fit)
      }
      if (fitCompleted && options.isCurrent() && options.isVisible()) {
        // Why: reattach resize is fire-and-forget; verify the visible provider grid after fitting settles.
        options.requestSizeReassertion()
      }
    }
  }
}
