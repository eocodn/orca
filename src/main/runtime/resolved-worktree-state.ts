export type ResolvedWorktreeCacheEntry<Snapshot> = Snapshot & { expiresAt: number }
export type ResolvedWorktreeFlight<Snapshot> = {
  generation: number
  promise: Promise<Snapshot>
}

export class ResolvedWorktreeState<Snapshot> {
  cache: ResolvedWorktreeCacheEntry<Snapshot> | null = null
  inFlight: ResolvedWorktreeFlight<Snapshot> | null = null
  generation = 0

  invalidate(): void {
    this.generation += 1
    this.cache = null
  }
}
