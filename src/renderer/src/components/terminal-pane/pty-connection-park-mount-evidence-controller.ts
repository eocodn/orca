export function createPtyConnectionParkMountEvidenceController(initiallyParked: boolean) {
  let available = initiallyParked

  return {
    peek(): boolean {
      return available
    },
    consume(): boolean {
      const current = available
      available = false
      return current
    }
  }
}
