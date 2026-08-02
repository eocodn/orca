import { ResolvedWorktreeState } from './resolved-worktree-state'
import { WorktreeScanState } from './worktree-scan-state'

/** Coordinates independent resolved and per-repository scan state. */
export class WorktreeResolutionState<Snapshot, ScanResult> {
  readonly resolved = new ResolvedWorktreeState<Snapshot>()
  readonly scan = new WorktreeScanState<ScanResult>()

  get resolvedCache() {
    return this.resolved.cache
  }

  set resolvedCache(value: ResolvedWorktreeState<Snapshot>['cache']) {
    this.resolved.cache = value
  }

  get resolvedInFlight() {
    return this.resolved.inFlight
  }

  set resolvedInFlight(value: typeof this.resolved.inFlight) {
    this.resolved.inFlight = value
  }

  get resolvedGeneration(): number {
    return this.resolved.generation
  }

  readonly scanGenerations = this.scan.generations
  readonly scanCache = this.scan.cache
  readonly scanInFlight = this.scan.inFlight

  invalidateResolved(): void {
    this.resolved.invalidate()
  }

  invalidateScan(repoId: string): void {
    this.scan.invalidate(repoId)
  }
}
