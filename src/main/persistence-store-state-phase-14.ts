import {
  writeFileSync,
  renameSync,
  unlinkSync
} from 'node:fs'




import { getGithubCacheFile } from './persistence-state-foundation'

import { StorePhase13 } from './persistence-store-state-phase-13'

export class StorePhase14 extends StorePhase13 {
  flush(): void {
    try {
      this.flushOrThrow()
    } catch (err) {
      console.error('[persistence] Failed to flush state:', err)
    }
    try {
      this.flushActiveViewPreferenceOrThrow()
    } catch (err) {
      console.error('[active-view] Failed to flush preference:', err)
    }
    this.writeGithubCacheSnapshotSync()
  }

  // Why: a project move rewrote the data file directly; in-memory state is now stale and any write would undo the transfer.
  freezeWrites(): void {
    this.writesFrozen = true
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
  }

  // Why best-effort: the sidecar is a refetchable cache; a failed write only costs a cold badge paint next launch, never data.
  protected writeGithubCacheSnapshotSync(): void {
    if (!this.githubCacheDirty) {
      return
    }
    const cacheFile = getGithubCacheFile(this.dataFile)
    const tmpFile = `${cacheFile}.${process.pid}.tmp`
    try {
      writeFileSync(tmpFile, JSON.stringify(this.state.githubCache), 'utf-8')
      renameSync(tmpFile, cacheFile)
      this.githubCacheDirty = false
    } catch (err) {
      try {
        unlinkSync(tmpFile)
      } catch {
        // Best-effort cleanup.
      }
      console.warn('[persistence] Failed to write github cache snapshot:', err)
    }
  }
}
