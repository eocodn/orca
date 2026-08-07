export function createPtyConnectionCertifiedDeadRestoreRecoveryController() {
  let claimed = false

  return {
    claim(): boolean {
      if (claimed) {
        return false
      }
      claimed = true
      return true
    }
  }
}
