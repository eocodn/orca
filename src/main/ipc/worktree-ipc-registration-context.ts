import type { BrowserWindow } from 'electron'
import type { Store } from '../persistence'
import type { OrcaRuntimeService, RuntimeWorktreeLifecycleEvent } from '../runtime/orca-runtime'
import { createSenderScopedRequestCancellations } from './sender-scoped-request-cancellation'
import type { WorktreeRemovalInFlight } from './worktree-ipc-creation'

export type WorktreeIpcRegistrationContext = {
  mainWindow: BrowserWindow
  store: Store
  runtime: OrcaRuntimeService
  options?: { onWorktreeLifecycle?: (event: RuntimeWorktreeLifecycleEvent) => void }
  detectedWorktreeCancellations: ReturnType<typeof createSenderScopedRequestCancellations>
  worktreeRemovalsInFlight: Map<string, WorktreeRemovalInFlight>
}

export function createWorktreeIpcRegistrationContext(
  mainWindow: BrowserWindow,
  store: Store,
  runtime: OrcaRuntimeService,
  options?: { onWorktreeLifecycle?: (event: RuntimeWorktreeLifecycleEvent) => void }
): WorktreeIpcRegistrationContext {
  return {
    mainWindow,
    store,
    runtime,
    options,
    detectedWorktreeCancellations: createSenderScopedRequestCancellations(),
    worktreeRemovalsInFlight: new Map()
  }
}
