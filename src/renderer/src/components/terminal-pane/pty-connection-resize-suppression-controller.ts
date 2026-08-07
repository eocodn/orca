export function createPtyConnectionResizeSuppressionController() {
  let structural = false
  let viewportClaim = false

  const runWithSuppression = <T>(
    setSuppressed: (value: boolean) => void,
    operation: () => T
  ): T => {
    setSuppressed(true)
    try {
      return operation()
    } finally {
      setSuppressed(false)
    }
  }

  return {
    shouldSkip(): boolean {
      return structural || viewportClaim
    },
    runStructural<T>(operation: () => T): T {
      return runWithSuppression((value) => {
        structural = value
      }, operation)
    },
    runViewportClaim<T>(operation: () => T): T {
      return runWithSuppression((value) => {
        viewportClaim = value
      }, operation)
    }
  }
}
