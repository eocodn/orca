type RendererSequenceExitResetRuntime = {
  getRestoredSnapshotBaselinePtyId: () => string | null
  clearRestoredSnapshotBaseline: () => void
  resetRendererSequenceForPtyExit: (ptyId: string) => void
}

export function createPtyConnectionRendererSequenceExitResetController() {
  let runtime: RendererSequenceExitResetRuntime | null = null

  return {
    bindRuntime(nextRuntime: RendererSequenceExitResetRuntime): void {
      runtime = nextRuntime
    },
    resetForExit(ptyId: string): void {
      if (!runtime) {
        return
      }
      if (runtime.getRestoredSnapshotBaselinePtyId() === ptyId) {
        runtime.clearRestoredSnapshotBaseline()
      }
      runtime.resetRendererSequenceForPtyExit(ptyId)
    }
  }
}
