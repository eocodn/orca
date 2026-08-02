import type { PersistedState } from '../shared/types'
import { StoreFoundation } from './persistence-store-foundation'
import { loadRepositoryState } from './persistence-store-repository-load'

export class StorePhase1 extends StoreFoundation {
  protected load(allowBackupRecovery = true): PersistedState {
    return loadRepositoryState(this, allowBackupRecovery)
  }

  // One-shot telemetry cohort migration: seeds existedBeforeTelemetryRelease, optedIn, and installId (no-op once set).
  // One-shot tab-switch cohort freeze: fileExistedOnLoad tells existing vs fresh only on the first launch, so persist now.
}

export { persistenceLoadDependencies } from './persistence-store-repository-load-dependencies'
