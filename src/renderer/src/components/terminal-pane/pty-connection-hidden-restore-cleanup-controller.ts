type HiddenRestoreCleanupBundle = {
  cancelSnapshotScrollRestore: () => void
  clearDeferredRetry: () => void
  clearForegroundDeadline: () => void
  clearFloodRepaint: () => void
}

export function createPtyConnectionHiddenRestoreCleanupController() {
  let cleanup: HiddenRestoreCleanupBundle | null = null

  return {
    bind(nextCleanup: HiddenRestoreCleanupBundle): void {
      cleanup = nextCleanup
    },
    dispose(): void {
      const current = cleanup
      cleanup = null
      current?.cancelSnapshotScrollRestore()
      current?.clearDeferredRetry()
      current?.clearForegroundDeadline()
      current?.clearFloodRepaint()
    }
  }
}
