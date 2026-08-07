export function createPtyConnectionTerminalActivityController() {
  let lastInputAt = Number.NEGATIVE_INFINITY
  let receivedOutput = false

  return {
    markInput(at: number): void {
      lastInputAt = at
    },
    markOutput(): void {
      receivedOutput = true
    },
    getLastInputAt(): number {
      return lastInputAt
    },
    hasReceivedOutput(): boolean {
      return receivedOutput
    }
  }
}
