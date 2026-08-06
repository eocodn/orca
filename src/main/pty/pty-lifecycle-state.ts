const activePtyIds = new Set<string>()

export function markPtyExited(ptyId: string): void {
  activePtyIds.delete(ptyId)
}

export function markPtySpawned(ptyId: string): void {
  activePtyIds.add(ptyId)
}

export function hasLivePtys(): boolean {
  return activePtyIds.size > 0
}
