type StartupDeliveryCleanup = {
  disposeDraft: () => void
  disposeCommandDelivery: () => void
}

export function createPtyConnectionStartupDeliveryCleanupController() {
  let cleanup: StartupDeliveryCleanup | null = null

  return {
    bind(nextCleanup: StartupDeliveryCleanup): void {
      cleanup = nextCleanup
    },
    dispose(): void {
      const current = cleanup
      cleanup = null
      current?.disposeDraft()
      current?.disposeCommandDelivery()
    }
  }
}
