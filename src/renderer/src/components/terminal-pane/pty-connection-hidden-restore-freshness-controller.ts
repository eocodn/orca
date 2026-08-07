export function createPtyConnectionHiddenRestoreFreshnessController() {
  let needed = false

  return {
    markNeeded(): void {
      needed = true
    },
    takeNeeded(): boolean {
      const current = needed
      needed = false
      return current
    },
    reset(): void {
      needed = false
    }
  }
}
