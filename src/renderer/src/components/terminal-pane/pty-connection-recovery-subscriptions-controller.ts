export function createPtyConnectionRecoverySubscriptionsController() {
  let unregisterBacklog: (() => void) | null = null
  let unregisterDocumentVisibility: (() => void) | null = null

  return {
    replaceBacklog(unregister: () => void): void {
      unregisterBacklog?.()
      unregisterBacklog = unregister
    },
    replaceDocumentVisibility(unregister: () => void): void {
      unregisterDocumentVisibility?.()
      unregisterDocumentVisibility = unregister
    },
    dispose(): void {
      unregisterBacklog?.()
      unregisterBacklog = null
      unregisterDocumentVisibility?.()
      unregisterDocumentVisibility = null
    }
  }
}
