import type { BrowserWindow } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { Store } from '../persistence'
import type { GlobalSettings } from '../../shared/types'
import { LocalPtyProvider } from '../providers/local-pty-provider'
import type {
  GetSelectedCodexHomePath,
  PrepareClaudeAuth,
  PrepareCodexSessionResume
} from './pty-ipc-runtime-host-env-foundation'
import { createPtyRegistrationFoundation } from './pty-ipc-runtime-registration-foundation'
import { installPtyRegistrationSupport } from './pty-ipc-runtime-registration-support'
import { initializePtyRendererDelivery } from './pty-ipc-runtime-renderer-delivery-core'
import { installPtyRendererDeliveryQueue } from './pty-ipc-runtime-renderer-delivery-queue'
import { installPtyRendererExitHandling } from './pty-ipc-runtime-renderer-exit-handling'
import { installPtyProviderListeners } from './pty-ipc-runtime-provider-listeners'
import { installPtyRuntimeRegistrationApis } from './pty-ipc-runtime-registration-api'
import { installPtyInputDeliveryHandlers } from './pty-ipc-runtime-input-delivery-handlers'
import { installPtySnapshotHandlers } from './pty-ipc-runtime-snapshot-handlers'
import { createPtyController } from './pty-ipc-runtime-controller'
import { installPtyIpcSpawnHandler } from './pty-ipc-runtime-ipc-spawn-registration'
import { installPtyIpcControlHandlers } from './pty-ipc-runtime-ipc-control'
import { installPtyIpcQueryHandlers } from './pty-ipc-runtime-ipc-query'
import { getLocalPtyProvider } from './pty-ipc-runtime-provider-lifecycle-state'

export type RegisterPtyHandlersOptions = {
  prepareCodexSessionResume?: PrepareCodexSessionResume
  awaitLocalPtyStartup?: () => Promise<void>
  awaitLocalPtyProviderStartup?: () => Promise<void>
  /** Keeps the recovery reload from sweeping PTYs owned by the previous page. */
  isRecoveryReloadInFlight?: (webContentsId: number) => boolean
}

/**
 * Registration is deliberately staged: every stage adds its methods to one
 * resettable state object, preserving the old closure lifetime on re-register.
 */
export function registerPtyHandlers(
  mainWindow: BrowserWindow,
  runtime?: OrcaRuntimeService,
  getSelectedCodexHomePath?: GetSelectedCodexHomePath,
  getSettings?: () => GlobalSettings,
  prepareClaudeAuth?: PrepareClaudeAuth,
  store?: Store,
  options?: RegisterPtyHandlersOptions
): void {
  createPtyRegistrationFoundation({
    mainWindow,
    runtime,
    getSelectedCodexHomePath,
    getSettings,
    prepareClaudeAuth,
    store,
    options
  })
  installPtyRegistrationSupport()
  const state = initializePtyRendererDelivery()
  installPtyRendererDeliveryQueue()
  installPtyRendererExitHandling()
  installPtyProviderListeners()
  installPtyRuntimeRegistrationApis()
  runtime?.setPtyController(createPtyController(state))
  installPtySnapshotHandlers(state)
  installPtyIpcSpawnHandler()
  installPtyInputDeliveryHandlers(state)
  installPtyIpcControlHandlers()
  installPtyIpcQueryHandlers()
}

export function registerHeadlessPtyRuntime(
  runtime: OrcaRuntimeService,
  getSelectedCodexHomePath?: GetSelectedCodexHomePath,
  getSettings?: () => GlobalSettings,
  prepareClaudeAuth?: PrepareClaudeAuth,
  store?: Store,
  prepareCodexSessionResume?: PrepareCodexSessionResume
): void {
  // Headless clients reuse the same registration graph; the destroyed window prevents renderer sends.
  const headlessWindow = {
    isDestroyed: () => true,
    webContents: {
      send: () => {},
      on: () => {},
      removeListener: () => {}
    }
  } as unknown as BrowserWindow
  registerPtyHandlers(
    headlessWindow,
    runtime,
    getSelectedCodexHomePath,
    getSettings,
    prepareClaudeAuth,
    store,
    { prepareCodexSessionResume }
  )
}

/** Kill only in-process PTYs; daemon-backed sessions survive local adapter loss. */
export function killAllPty(): void {
  const provider = getLocalPtyProvider()
  if (provider instanceof LocalPtyProvider) {
    provider.killAll()
  }
}
