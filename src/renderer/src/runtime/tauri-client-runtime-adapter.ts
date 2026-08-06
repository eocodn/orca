import type { ClientRuntimeHostAdapter } from './client-runtime'
import {
  createCapabilityUnavailableService,
  type ClientRuntimeAdapter
} from './client-runtime-adapter'
import { createTauriHostBridge, type TauriInvoke } from './tauri-host-bridge'

/** Tauri exposes only the typed ade-host command bridge; other services stay unavailable. */
export function createTauriClientRuntimeAdapter(invoke?: TauriInvoke): ClientRuntimeAdapter {
  return {
    kind: 'tauri',
    host: createCapabilityUnavailableService<ClientRuntimeHostAdapter>('tauri'),
    tauriHost: createTauriHostBridge(invoke)
  }
}
