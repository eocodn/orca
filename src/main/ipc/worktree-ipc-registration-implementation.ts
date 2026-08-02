import type { BrowserWindow } from 'electron'
import type { Store } from '../persistence'
import type { OrcaRuntimeService, RuntimeWorktreeLifecycleEvent } from '../runtime/orca-runtime'
import { registerWorktreeHandlers as registerWorktreeHandlersImplementation } from './worktree-ipc-registration'

export {
  DETECTED_WORKTREE_PROVIDER_TIMEOUT_MS,
  LINEAGE_HYDRATION_TIMEOUT_MS,
  __getDetectedWorktreeScanCacheStatsForTests,
  __resetDetectedWorktreeScanCacheForTests
} from './worktree-ipc-creation'

export function registerWorktreeHandlers(
  mainWindow: BrowserWindow,
  store: Store,
  runtime: OrcaRuntimeService,
  options?: { onWorktreeLifecycle?: (event: RuntimeWorktreeLifecycleEvent) => void }
): void {
  registerWorktreeHandlersImplementation(mainWindow, store, runtime, options)
}
