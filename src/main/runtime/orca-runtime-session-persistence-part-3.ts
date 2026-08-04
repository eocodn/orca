import {
  type RuntimeSessionFlushResult,
  type RuntimeSessionSnapshot,
  type AutomationService,
  SESSION_SNAPSHOT_STABILITY_ATTEMPTS
} from './orca-runtime-symbols'
import { OrcaRuntimeGetLocalProviderPart1 } from './orca-runtime-get-local-provider-part-1'

export class OrcaRuntimeSessionPersistencePart3 extends OrcaRuntimeGetLocalProviderPart1 {
  setAutomationService(service: AutomationService): void {
    this.automationService = service
  }
  getRuntimeId(): string {
    return this.runtimeId
  }
  protected async readStableSessionSnapshot(): Promise<RuntimeSessionSnapshot> {
    const store = this.store
    if (!store?.getStateRevision) {
      throw new Error('session_revision_unavailable')
    }
    const readStateRevision = (): string => store.getStateRevision!()
    for (let attempt = 0; attempt < SESSION_SNAPSHOT_STABILITY_ATTEMPTS; attempt += 1) {
      const revisionBefore = readStateRevision()
      const snapshots = await this.listAllMobileSessionTabs()
      const revisionAfter = readStateRevision()
      if (revisionBefore === revisionAfter) {
        return {
          hostGeneration: this.runtimeId,
          revision: revisionAfter,
          snapshots
        }
      }
    }
    throw new Error('session_snapshot_unstable')
  }
  async getSessionSnapshot(): Promise<RuntimeSessionSnapshot> {
    return this.readStableSessionSnapshot()
  }
  async flushSession(): Promise<RuntimeSessionFlushResult> {
    if (!this.store?.flushOrThrow || !this.store?.getStateRevision) {
      throw new Error('session_persistence_unavailable')
    }
    const snapshot = await this.readStableSessionSnapshot()
    this.store.flushOrThrow()
    const flushedRevision = this.store.getStateRevision()
    if (flushedRevision !== snapshot.revision) {
      throw new Error('session_flush_raced')
    }
    return {
      ...snapshot,
      flushed: true
    }
  }
}
