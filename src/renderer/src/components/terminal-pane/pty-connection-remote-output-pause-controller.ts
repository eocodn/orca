export function createPtyConnectionRemoteOutputPauseController() {
  let pausedPtyId: string | null = null

  return {
    isPaused(ptyId: string | null): boolean {
      return ptyId !== null && pausedPtyId === ptyId
    },
    markPaused(ptyId: string): boolean {
      if (pausedPtyId === ptyId) {
        return false
      }
      pausedPtyId = ptyId
      return true
    },
    clearIfMatches(ptyId: string): boolean {
      if (pausedPtyId !== ptyId) {
        return false
      }
      pausedPtyId = null
      return true
    },
    clearIfRebound(ptyId: string | null): boolean {
      if (pausedPtyId === null || pausedPtyId === ptyId) {
        return false
      }
      pausedPtyId = null
      return true
    },
    clear(): boolean {
      if (pausedPtyId === null) {
        return false
      }
      pausedPtyId = null
      return true
    }
  }
}
