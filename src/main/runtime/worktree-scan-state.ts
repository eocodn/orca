export type WorktreeScanCacheEntry<Result> = {
  generation: number
  runtimeKey: string
  result: Result
  expiresAt: number
}
export type WorktreeScanFlight<Result> = {
  generation: number
  runtimeKey: string
  promise: Promise<Result>
}

export class WorktreeScanState<Result> {
  readonly generations = new Map<string, number>()
  readonly cache = new Map<string, WorktreeScanCacheEntry<Result>>()
  readonly inFlight = new Map<string, WorktreeScanFlight<Result>>()

  invalidate(repoId: string): void {
    this.generations.set(repoId, (this.generations.get(repoId) ?? 0) + 1)
    this.cache.delete(repoId)
    this.inFlight.delete(repoId)
  }
}
