export function createPtyConnectionHiddenRestoreIdentityController() {
  let needed = false
  let ptyId: string | null = null
  let generation = 0

  return {
    isNeeded(): boolean {
      return needed
    },
    getPtyId(): string | null {
      return ptyId
    },
    getGeneration(): number {
      return generation
    },
    markNeededFor(nextPtyId: string): void {
      ptyId = nextPtyId
      needed = true
    },
    markNeeded(): void {
      needed = true
    },
    bindPty(nextPtyId: string | null): void {
      ptyId = nextPtyId
    },
    clearNeeded(): void {
      needed = false
    },
    complete(): void {
      needed = false
      ptyId = null
    },
    invalidate(): number {
      needed = false
      ptyId = null
      generation += 1
      return generation
    },
    matches(expectedPtyId: string, expectedGeneration?: number): boolean {
      return (
        ptyId === expectedPtyId &&
        (expectedGeneration === undefined || generation === expectedGeneration)
      )
    },
    hasDifferentPty(currentPtyId: string | null): boolean {
      return ptyId !== null && currentPtyId !== ptyId
    }
  }
}
